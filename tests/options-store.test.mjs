// @last-edited: 2026-10-04 11:10 UTC.
// @title: options-store.test — store.test — Test.
// @context: Test.
// @state: close the Phase 5 review follow-ups.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:test, strict, options-store, endpoints.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOptions, saveBridgeUrl, saveLogLevel } from '../extension/lib/options-store.js';
import { DEFAULT_BRIDGE_URL } from '../extension/lib/endpoints.js';

const fake = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    async get(keys) { const out = {}; for (const k of keys) out[k] = data[k]; return out; },
    async set(patch) { Object.assign(data, patch); }
  };
};

test('loadOptions returns defaults for empty storage', async () => {
  const loaded = await loadOptions(fake());
  assert.equal(loaded.bridgeUrl, DEFAULT_BRIDGE_URL);
  assert.equal(loaded.logLevel, 'warn');
});

test('saveBridgeUrl rejects non-https, empty resets to default', async () => {
  const s = fake();
  await assert.rejects(saveBridgeUrl(s, 'http://evil.example/hook'), /https/);
  await assert.rejects(saveBridgeUrl(s, 'not a url'), /https/);
  await saveBridgeUrl(s, '');
  assert.equal(s.data.bridgeUrl, DEFAULT_BRIDGE_URL);
  await saveBridgeUrl(s, 'https://my-bridge.example/hook');
  assert.equal(s.data.bridgeUrl, 'https://my-bridge.example/hook');
});

test('saveLogLevel accepts only the three levels', async () => {
  const s = fake();
  await saveLogLevel(s, 'debug');
  assert.equal(s.data.logLevel, 'debug');
  await assert.rejects(saveLogLevel(s, 'verbose'), /level/i);
  await assert.rejects(saveLogLevel(s, ''), /level/i);
});

test('stored values round-trip verbatim', async () => {
  const s = fake({ bridgeUrl: 'https://x.example/', logLevel: 'error' });
  const loaded = await loadOptions(s);
  assert.equal(loaded.bridgeUrl, 'https://x.example/');
  assert.equal(loaded.logLevel, 'error');
});
