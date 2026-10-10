// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: edge-token-hygiene.test — Test..
// @state: Test..
// @dependencies: node:test, strict, promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Frozen contract (deliberate source-form lock): device/user tokens must
// never flow into edge logs or error payloads. These tests pin the exact
// console call sites and 401/405 body literals, so any new log call naming
// token material — or any credential echo in an auth-error body — fails
// loudly instead of leaking silently. The four functions below are the
// token-handling surfaces: each authenticates before it does anything else,
// and each has a path where a rejection body could otherwise echo the value
// it rejected.

const FUNCTIONS = [
  'opera-agent-gateway',
  'opera-agent-mcp',
  'opera-agent-bridge',
  'opera-agent-runner',
];

// Token-material identifiers that must never appear inside a log call.
// Case-sensitive on purpose: `code`/`message`/`error` literals stay legal,
// and `\breq\b` does not match inside `request`.

const TOKEN_MATERIAL = /\b(?:token|apiKey|authorization|body|headers|req)\b/;
const CONSOLE_CALL = /console\.(?:error|warn|log|debug)\s*\(/g;

// String-aware balanced-delimiter span: returns [start, end] of the
// bracketed expression beginning at openIdx, or null when unbalanced.

function balanced(source, openIdx, open, close) {
  let quote = null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return [openIdx, i + 1];
    }
  }
  return null;
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

// Every console.(error|warn|log|debug)(...) call expression in the source.

function consoleCalls(source) {
  const calls = [];
  for (const m of source.matchAll(CONSOLE_CALL)) {
    const span = balanced(source, m.index + m[0].length - 1, '(', ')');
    assert.ok(span, `unbalanced console call at line ${lineOf(source, m.index)}`);
    calls.push({ text: source.slice(m.index, span[1]), line: lineOf(source, m.index) });
  }
  return calls;
}

// Response-body literals of `json(req, {...}, <status>)` calls at 401/405:
// the auth-error surfaces whose bodies must never echo the credential.

function errorBodies(source, statuses) {
  const bodies = [];
  for (const m of source.matchAll(/\bjson\(\s*req\s*,/g)) {
    let i = m.index + m[0].length;
    while (/\s/.test(source[i])) i += 1;
    if (source[i] !== '{') continue;
    const bodySpan = balanced(source, i, '{', '}');
    assert.ok(bodySpan, `unbalanced json body at line ${lineOf(source, m.index)}`);
    let j = bodySpan[1];
    while (/\s/.test(source[j])) j += 1;
    if (source[j] !== ',') continue; // default-status (200) call: not an error surface
    const status = /^,\s*(\d{3})/.exec(source.slice(j, j + 32));
    if (status && statuses.includes(Number(status[1]))) {
      bodies.push({ text: source.slice(bodySpan[0], bodySpan[1]), status: Number(status[1]), line: lineOf(source, m.index) });
    }
  }
  return bodies;
}

async function functionSource(name) {
  const source = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  assert.ok(source.length > 0, `${name} source must be non-empty`);
  return source;
}

for (const name of FUNCTIONS) {
  test(`${name}: no console call references token material`, async () => {
    const source = await functionSource(name);
    for (const call of consoleCalls(source)) {
      assert.doesNotMatch(call.text, TOKEN_MATERIAL, `${name}:${call.line} logs token material`);
    }
  });
}

for (const name of ['opera-agent-gateway', 'opera-agent-mcp']) {
  test(`${name}: 401/405 bodies contain no Bearer echo`, async () => {
    const source = await functionSource(name);
    const bodies = errorBodies(source, [401, 405]);

    // Vacuous-pass guard: both auth-error surfaces must exist to be locked.
    assert.ok(bodies.some((b) => b.status === 401), `${name} must have a 401 json site`);
    assert.ok(bodies.some((b) => b.status === 405), `${name} must have a 405 json site`);
    for (const body of bodies) {
      assert.doesNotMatch(body.text, /Bearer/, `${name}:${body.line} ${body.status} body echoes Bearer`);
    }
  });
}

test('extractor self-check: locks trip on token-shaped calls', async () => {
  // Positive control: the update function has known literal-only log calls,
  // so the extractor must find them — proving a zero-call result on the
  // four audited functions is a true negative, not a blind scanner.
  const update = await functionSource('opera-agent-update');
  const calls = consoleCalls(update);
  assert.ok(calls.length >= 1, 'extractor must find the known update log calls');
  for (const call of calls) {
    assert.doesNotMatch(call.text, TOKEN_MATERIAL, `update:${call.line} logs token material`);
  }

  // The patterns themselves must fire on genuinely bad input.
  assert.match('console.log(token)', TOKEN_MATERIAL);
  assert.match('console.error(req.headers)', TOKEN_MATERIAL);
  assert.match('{ error: "x", detail: "Bearer abc123" }', /Bearer/);
});
