import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONSENT_CONFIG_URL, DEFAULT_BRIDGE_URL, SUPABASE_PROJECT_REF } from '../extension/lib/endpoints.js';

test('extension background has exactly one endpoint source', async () => {
  const bg = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(bg, /from '\.\/lib\/endpoints\.js'/);
  assert.equal((bg.match(/supabase\.co\/functions\/v1/g) || []).length, 0);
});

test('consent config endpoint equals the shared constant (separate deploys)', async () => {
  const html = await readFile(new URL('../oauth-consent/index.html', import.meta.url), 'utf8');
  const m = html.match(/const configEndpoint = '([^']+)'/);
  assert.ok(m, 'configEndpoint literal not found');
  assert.equal(m[1], CONSENT_CONFIG_URL);
});

test('update function derives base from SUPABASE_URL, no literal ref', async () => {
  const src = await readFile(new URL('../supabase/functions/opera-agent-update/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /nenmkmtvjremqphfqnfw/);
});
