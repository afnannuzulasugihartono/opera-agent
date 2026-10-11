// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: edge-token-hygiene.test — Test..
// @state: Test..
// @dependencies: node:test, strict, promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FUNCTIONS = [
  'opera-agent-gateway',
  'opera-agent-mcp',
  'opera-agent-bridge',
  'opera-agent-runner',
];

const TOKEN_MATERIAL = /\b(?:token|apiKey|authorization|body|headers|req)\b/;
const CONSOLE_CALL = /console\.(?:error|warn|log|debug)\s*\(/g;

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

function consoleCalls(source) {
  const calls = [];
  for (const m of source.matchAll(CONSOLE_CALL)) {
    const span = balanced(source, m.index + m[0].length - 1, '(', ')');
    assert.ok(span, `unbalanced console call at line ${lineOf(source, m.index)}`);
    calls.push({ text: source.slice(m.index, span[1]), line: lineOf(source, m.index) });
  }
  return calls;
}

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
    if (source[j] !== ',') continue;
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

    assert.ok(bodies.some((b) => b.status === 401), `${name} must have a 401 json site`);
    assert.ok(bodies.some((b) => b.status === 405), `${name} must have a 405 json site`);
    for (const body of bodies) {
      assert.doesNotMatch(body.text, /Bearer/, `${name}:${body.line} ${body.status} body echoes Bearer`);
    }
  });
}

test('extractor self-check: locks trip on token-shaped calls', async () => {

  const update = await functionSource('opera-agent-update');
  const calls = consoleCalls(update);
  assert.ok(calls.length >= 1, 'extractor must find the known update log calls');
  for (const call of calls) {
    assert.doesNotMatch(call.text, TOKEN_MATERIAL, `update:${call.line} logs token material`);
  }

  assert.match('console.log(token)', TOKEN_MATERIAL);
  assert.match('console.error(req.headers)', TOKEN_MATERIAL);
  assert.match('{ error: "x", detail: "Bearer abc123" }', /Bearer/);
});
