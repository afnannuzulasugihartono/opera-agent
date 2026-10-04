// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: api-docs.test — Test..
// @state: Test..
// @dependencies: node:test, strict, promises, endpoints, source-scan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SUPABASE_PROJECT_REF } from '../extension/lib/endpoints.js';
import { stripComments } from './helpers/source-scan.mjs';

// Frozen contract: docs/api.md is the narrative API reference and must cover
// everything the gateway actually serves. The machine source of truth remains
// the live GET /openapi.json; this test exists so narrative drift fails in CI
// rather than silently misleading an integrator.

const gatewayPath = new URL('../supabase/functions/opera-agent-gateway/index.ts', import.meta.url);
const docPath = new URL('../docs/api.md', import.meta.url);

// A bare mention is not coverage: paths and error codes are also named in the
// prose sections, so `doc.includes(...)` keeps passing when the table row that
// actually carries them is deleted. These helpers read the markdown table rows
// so coverage can be asserted in the form the document is read in.

function tableRows(doc) {
  return doc.split('\n').filter((line) => line.trimStart().startsWith('|'));
}

function tableCells(row) {
  return row.split('|').slice(1, -1).map((cell) => cell.trim());
}

function hasTableRow(doc, firstCell) {
  return tableRows(doc).some((row) => tableCells(row)[0] === firstCell);
}

// The gateway section, isolated from the request-body and error-code tables.

function section(doc, heading) {
  const start = doc.indexOf(heading);
  assert.notEqual(start, -1, `docs/api.md has a "${heading}" section`);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function routedPaths(gateway) {
  return [...gateway.matchAll(/url\.pathname\.endsWith\("([^"]+)"\)/g)].map((m) => m[1]);
}

test('api.md documents every path the gateway routes', async () => {
  const gateway = await readFile(gatewayPath, 'utf8');
  const doc = await readFile(docPath, 'utf8');
  const routed = routedPaths(gateway);
  assert.deepEqual([...routed].sort(), ['/command', '/health', '/openapi.json']);
  for (const path of routed) {
    assert.ok(doc.includes(`\`${path}\``), `docs/api.md documents ${path}`);
    assert.ok(hasTableRow(doc, `\`${path}\``), `docs/api.md lists ${path} in the endpoint table`);
  }
});

test('api.md documents no path the gateway stopped serving', async () => {
  // The complement of the test above. Without it, a route deleted from the
  // gateway would leave its row behind in docs/api.md forever, and the
  // operator would keep reading about an endpoint that 404s.
  const gateway = await readFile(gatewayPath, 'utf8');
  const doc = await readFile(docPath, 'utf8');
  // The first-column convention is load-bearing: only a cell that opens with
  // a backticked slash is read as a path, so a request-body or error-code row
  // can never be mistaken for one.
  const listed = tableRows(section(doc, '## Endpoints'))
    .map((row) => tableCells(row)[0])
    .filter((cell) => cell.startsWith('`/') && cell.endsWith('`'))
    .map((cell) => cell.replaceAll('`', ''));
  assert.deepEqual([...listed].sort(), [...routedPaths(gateway)].sort());
});

test('api.md documents every error code the gateway emits', async () => {
  const gateway = await readFile(gatewayPath, 'utf8');
  const doc = await readFile(docPath, 'utf8');
  const codes = [...new Set([...gateway.matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]))];
  assert.ok(codes.length >= 9, `expected the full gateway error set, found ${codes.length}`);
  const rows = tableRows(doc);
  for (const code of codes) {
    assert.ok(doc.includes(code), `docs/api.md documents error code ${code}`);
    const listed = rows.some((row) => {
      const cells = tableCells(row);
      return cells[0] === `\`${code}\`` && (cells[1] ?? '').length > 0;
    });
    assert.ok(listed, `docs/api.md lists ${code} in the error-code table with its status`);
  }
});

test('extractToken accepts exactly the three documented carriers', async () => {
  // The narrative states that ?apiKey= is not a carrier on ANY route. Rather than
  // trying to ban every way a query string could be parsed across the whole file --
  // which misses helpers and rejects legitimate non-token query parameters -- this
  // pins the carrier set POSITIVELY inside the function that decides it.
  //
  // KNOWN LIMITS. This pins the body of `extractToken` as written here. It cannot
  // see a carrier reached by calling a helper (`queryCarrier(req)`), and it cannot
  // see a route handler that reads the query string and ORs the result in
  // afterwards. It also reads the last request member syntactically, so an honest
  // refactor to destructuring (`const { headers } = req`) would fail it. Those are
  // the trade for not rejecting correct code, and they are the shapes a future
  // reviewer should re-examine if a query-string carrier is ever suspected.
  const gateway = await readFile(gatewayPath, 'utf8');
  const code = stripComments(gateway, 'javascript');

  const extract = code.match(/function extractToken[\s\S]*?\n}/);
  assert.ok(extract, 'extractToken is present in the gateway');
  const body = extract[0];

  for (const carrier of ['x-opera-agent-token', 'authorization', 'apiKey']) {
    assert.ok(body.includes(carrier), `extractToken reads the ${carrier} carrier`);
  }
  assert.doesNotMatch(
    body,
    /searchParams|\.search\b|URLSearchParams|\?apiKey=/,
    'extractToken reads no query-string carrier'
  );
  // Reads the request member syntactically; see KNOWN LIMITS above.
  const requestMembers = [...body.matchAll(/\breq(?:uest)?\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(requestMembers)],
    ['headers'],
    'every request member extractToken reads is a header (syntactic check, see KNOWN LIMITS)'
  );
});

test('the security policy states the true carrier set and nothing else', async () => {
  // SECURITY.md is the most-read statement of the topic. An earlier version of
  // this test required it to keep the original false sentence as history; that
  // pinned a history book inside the policy, against the rule that documents
  // state what is true now. What is pinned instead: the true carriers, and the
  // absence of the false one.
  const security = await readFile(new URL('../SECURITY.md', import.meta.url), 'utf8');
  assert.doesNotMatch(
    security,
    /Query tokens[\s>]+are confined to the read-only/,
    'SECURITY.md must not keep the false sentence it once carried'
  );
  assert.match(
    security,
    /No gateway[\s>]+route reads the query string/,
    'SECURITY.md must state that no gateway route reads the query string'
  );
  assert.match(
    security,
    /tests\/api-docs\.test\.mjs/,
    'SECURITY.md must point at the test that enforces it'
  );
});

test('api.md states that the query string is never a carrier', async () => {
  const doc = await readFile(docPath, 'utf8');
  assert.match(
    doc,
    /A `\?apiKey=` query parameter is \*\*never\*\* read by the gateway/,
    'docs/api.md must keep stating that the query string is never read'
  );
});

test('api.md base URL matches the shared endpoint constants', async () => {
  const doc = await readFile(docPath, 'utf8');
  const expected = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/opera-agent-gateway`;
  assert.ok(doc.includes(expected), 'docs/api.md states the gateway base URL derived from the project ref');
});

test('api.md never leaks a token-shaped value', async () => {
  const doc = await readFile(docPath, 'utf8');
  assert.doesNotMatch(doc, /ghp_[A-Za-z0-9]/);
  assert.doesNotMatch(doc, /(token|apiKey|password)\s*[:=]\s*['"][A-Za-z0-9]{16,}/i);
});
