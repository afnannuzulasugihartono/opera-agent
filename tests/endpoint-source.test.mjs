// Last edited: 2026-10-04 17:52. Title: endpoint-source.test — Test. Now: activate the options tab before waiting on its async prefill.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONSENT_CONFIG_URL, DEFAULT_BRIDGE_URL, SUPABASE_PROJECT_REF, UPDATE_BASE_URL } from '../extension/lib/endpoints.js';

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
  // Source form is required here: the contract is "this deploy unit derives its
  // base from the environment rather than hard-coding it", which is only
  // observable as source text. The positive assertion matters as much as the
  // negative one -- without it, replacing the derivation with any other literal
  // URL would still pass.
  assert.doesNotMatch(src, /nenmkmtvjremqphfqnfw/);
  // Quote-style tolerant on purpose: the contract is that this deploy unit
  // derives its base from the environment rather than hard-coding it. The
  // replacement pattern is deliberately NOT asserted; only the
  // SUPABASE_URL-derived interpolation is.
  assert.match(src, /\$\{SUPABASE_URL\.replace\(\/[^)]*\/,\s*["']["']\)\}/);
});

test('every exported endpoint constant is derived from the project ref', () => {
  const base = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
  assert.equal(DEFAULT_BRIDGE_URL, `${base}/functions/v1/opera-agent-bridge`);
  assert.equal(UPDATE_BASE_URL, `${base}/functions/v1/opera-agent-update`);
  assert.equal(CONSENT_CONFIG_URL, `${base}/functions/v1/opera-agent-auth/config`);
});
