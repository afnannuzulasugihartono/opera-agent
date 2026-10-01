import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SUPABASE_PROJECT_REF } from '../extension/lib/endpoints.js';

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

test('api.md documents every path the gateway routes', async () => {
  const gateway = await readFile(gatewayPath, 'utf8');
  const doc = await readFile(docPath, 'utf8');
  const routed = [...gateway.matchAll(/url\.pathname\.endsWith\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...routed].sort(), ['/command', '/health', '/openapi.json']);
  for (const path of routed) {
    assert.ok(doc.includes(`\`${path}\``), `docs/api.md documents ${path}`);
    assert.ok(hasTableRow(doc, `\`${path}\``), `docs/api.md lists ${path} in the endpoint table`);
  }
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
