// @last-edited: 2026-10-09 UTC+7.
// @title: options-store.test — store.test — Test.
// @state: close the Phase 5 review follow-ups.
// @dependencies: node:test, strict, options-store, endpoints.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOptions, saveBridgeUrl, saveLogLevel, saveModelEndpoint, saveModelKey, saveModelName, readModelConfig, MODEL_PRESETS, DEFAULT_MODEL_PRESET_ID } from '../extension/lib/options-store.js';
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

// The model endpoint receives page content, so it is held to the same rule as the
// bridge: https for anything remote, plain http only on loopback, because a local
// model never leaves the machine.

test('saveModelEndpoint accepts https and loopback, refuses remote http', async () => {
  const s = fake();
  await assert.rejects(saveModelEndpoint(s, 'http://model.example/v1'), /https/);
  await assert.rejects(saveModelEndpoint(s, 'ftp://model.example'), /https/);
  await saveModelEndpoint(s, 'https://api.example/v1');
  assert.equal(s.data.modelEndpoint, 'https://api.example/v1');
  await saveModelEndpoint(s, 'http://127.0.0.1:11434/v1');
  assert.equal(s.data.modelEndpoint, 'http://127.0.0.1:11434/v1');
});

test('saveModelName refuses an empty or oversized model name', async () => {
  const s = fake();
  await saveModelName(s, 'some-model-4b');
  assert.equal(s.data.modelName, 'some-model-4b');
  await assert.rejects(saveModelName(s, '   '), /model name/i);
  await assert.rejects(saveModelName(s, 'x'.repeat(200)), /model name/i);
});

test('an empty key clears it, which is how a user revokes it', async () => {
  const s = fake({ modelKey: 'sk-live-123' });
  await saveModelKey(s, '');
  assert.equal(s.data.modelKey, '');
  const cleared = await readModelConfig(s);
  assert.equal(cleared.configured, false);
  assert.equal(cleared.code, 'MODEL_NOT_CONFIGURED');
});

test('loadOptions never hands the key back to the page, only that one is set', async () => {
  const s = fake({ modelEndpoint: 'https://api.example/v1', modelName: 'm', modelKey: 'sk-live-123' });
  const loaded = await loadOptions(s);
  assert.equal(loaded.modelKeySet, true);
  assert.equal('modelKey' in loaded, false);
  assert.equal(loaded.modelEndpoint, 'https://api.example/v1');
});

test('readModelConfig fails closed until all three are set', async () => {
  const s = fake({ modelEndpoint: 'https://api.example/v1', modelName: 'm' });
  const missing = await readModelConfig(s);
  assert.equal(missing.configured, false);
  assert.equal(missing.code, 'MODEL_NOT_CONFIGURED');
  await saveModelKey(s, 'sk-live-123');
  const ready = await readModelConfig(s);
  assert.equal(ready.configured, true);
  assert.equal(ready.endpoint, 'https://api.example/v1');
  assert.equal(ready.model, 'm');
  assert.equal(ready.key, 'sk-live-123');
});

// Presets ship public endpoint URLs and model names only, never keys: the key stays
// strictly user-supplied, so an empty store still fails closed on the key alone.

test('loadOptions reports the default preset endpoint and model on empty storage', async () => {
  const s = fake();
  const loaded = await loadOptions(s);
  const preset = MODEL_PRESETS.find((entry) => entry.id === DEFAULT_MODEL_PRESET_ID);
  assert.equal(loaded.modelEndpoint, preset.endpoint);
  assert.equal(loaded.modelName, preset.model);
  assert.equal('modelEndpoint' in s.data, false);
  assert.equal('modelName' in s.data, false);
});

test('readModelConfig on empty storage misses only the user-supplied key', async () => {
  const result = await readModelConfig(fake());
  assert.equal(result.configured, false);
  assert.equal(result.code, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual(result.missing, ['key']);
});

test('MODEL_PRESETS is frozen with two endpoints passing the https rule', async () => {
  assert.equal(Object.isFrozen(MODEL_PRESETS), true);
  assert.equal(MODEL_PRESETS.length, 2);
  const s = fake();
  for (const preset of MODEL_PRESETS) {
    await saveModelEndpoint(s, preset.endpoint);
    assert.ok(preset.model.length >= 1 && preset.model.length <= 120);
  }
});

test('stored endpoint and model still override the preset defaults', async () => {
  const s = fake({ modelEndpoint: 'https://custom.example/v1', modelName: 'custom-model', modelKey: 'sk-live-123' });
  const loaded = await loadOptions(s);
  assert.equal(loaded.modelEndpoint, 'https://custom.example/v1');
  assert.equal(loaded.modelName, 'custom-model');
  const ready = await readModelConfig(s);
  assert.equal(ready.configured, true);
  assert.equal(ready.endpoint, 'https://custom.example/v1');
  assert.equal(ready.model, 'custom-model');
});
