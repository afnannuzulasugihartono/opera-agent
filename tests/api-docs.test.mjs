// @last-edited: 2026-10-21 UTC+7.
// @title: api-docs.test — the documented API is the API the gateway serves.
// @state: the tool table in docs/api.md against the gateway source, so the document cannot drift from the code.
// @dependencies: node:test, strict, promises, endpoints, source-scan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SUPABASE_PROJECT_REF } from '../extension/lib/endpoints.js';
import { stripComments } from './helpers/source-scan.mjs';

const gatewayPath = new URL('../supabase/functions/opera-agent-gateway/index.ts', import.meta.url);
const docPath = new URL('../docs/api.md', import.meta.url);

function tableRows(doc) {
  return doc.split('\n').filter((line) => line.trimStart().startsWith('|'));
}

function tableCells(row) {
  return row.split('|').slice(1, -1).map((cell) => cell.trim());
}

function hasTableRow(
  doc,
  firstCell
) {
  return tableRows(doc).some((row) => tableCells(row)[0] === firstCell);
}

function section(
  doc,
  heading
) {
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
  assert.deepEqual([...routed].sort(), [
    '/command',
    '/health',
    '/openapi.json'
  ]);
  for (const path of routed) {
    assert.ok(doc.includes(`\`${path}\``), `docs/api.md documents ${path}`);
    assert.ok(hasTableRow(doc, `\`${path}\``), `docs/api.md lists ${path} in the endpoint table`);
  }
});

test('api.md documents no path the gateway stopped serving', async () => {
  const gateway = await readFile(gatewayPath, 'utf8');
  const doc = await readFile(docPath, 'utf8');

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

  const requestMembers = [...body.matchAll(/\breq(?:uest)?\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(requestMembers)],
    ['headers'],
    'every request member extractToken reads is a header (syntactic check, see KNOWN LIMITS)'
  );
});

test('command resolves a user JWT to the caller-owned first device, never the fixed name', async () => {
  const gateway = await readFile(gatewayPath, 'utf8');
  const code = stripComments(gateway, 'javascript');
  assert.match(code, /supabase\.auth\.getUser\(token\)/, 'the gateway verifies a user JWT when the device token fails');
  assert.match(code, /\.eq\("user_id", userId\)/, 'the JWT path resolves the device by owner');
  assert.match(code, /\.neq\("status", "disabled"\)/, 'the JWT path skips disabled devices');
  assert.match(code, /deviceName = device\.device_name/, 'the JWT path drives the resolved device, not the fixed name');
});

test('the security policy states the true carrier set and nothing else', async () => {
  const security = await readFile(new URL('../docs/security.md', import.meta.url), 'utf8');
  assert.doesNotMatch(
    security,
    /Query tokens[\s>]+are confined to the read-only/,
    'docs/security.md must not keep the false sentence it once carried'
  );
  assert.match(
    security,
    /No gateway[\s>]+route reads the query string/,
    'docs/security.md must state that no gateway route reads the query string'
  );
  assert.match(
    security,
    /tests\/api-docs\.test\.mjs/,
    'docs/security.md must point at the test that enforces it'
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
