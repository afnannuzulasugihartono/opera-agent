// @last-edited: 2026-10-08 UTC+7.
// @title: model-client.test — Test.
// @state: locks the device-local model compiler: config gate, single destination, bounded call, key never leaks.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composeModelPlan, buildProbeRequest, endpointOk, MODEL_TIMEOUT_MS, MODEL_MAX_TOKENS } from '../lib/model-client.js';

const storageOf = (cfg) => ({ get: async () => cfg });
const program = { root: { type: 'SEQUENCE', children: [{ type: 'COMMAND', method: 'page.find', arguments: { text: 'Skip' }, resultBinding: 'hit' }] } };
const fetchOk = (t, body = program) => {
  t.calls = [];
  return async (url, init) => {
    t.calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }) };
  };
};
const full = { modelEndpoint: 'https://llm.example.com/v1/chat/completions', modelName: 'm', modelKey: 'fixture-model-key-abc123' };
const target = { deviceId: 'opera', tabId: 1 };
const budgets = { astDepth: 12, browserCommandLeavesPerRun: 12 };

test('unconfigured device never fetches', async () => {
  const t = {};
  const out = await composeModelPlan({ storage: storageOf({}), fetchImpl: fetchOk(t) }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual(t.calls, []);
});

test('http remote endpoint is refused before fetch', async () => {
  const t = {};
  const out = await composeModelPlan({ storage: storageOf({ ...full, modelEndpoint: 'http://evil.example.com/x' }), fetchImpl: fetchOk(t) }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.deepEqual(t.calls, []);
});

test('one bounded POST to the configured endpoint only, key never in body or result', async () => {
  const t = {};
  const out = await composeModelPlan({ storage: storageOf(full), fetchImpl: fetchOk(t) }, { goal: 'find skip', page: {}, target, budgets });
  assert.equal(out.ok, true);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, full.modelEndpoint);
  const sent = JSON.parse(t.calls[0].init.body);
  assert.equal(sent.model, 'm');
  assert.equal(sent.temperature, 0);
  assert.ok(!JSON.stringify(sent).includes('fixture-model-key-abc123'), 'key must not be in the body');
  assert.equal(t.calls[0].init.headers.Authorization, 'Bearer fixture-model-key-abc123');
  assert.ok(!JSON.stringify(out).includes('fixture-model-key-abc123'), 'key must not be in the result');
});

test('non-conforming response is refused, never a program', async () => {
  const t = {};
  const bad = async (url, init) => { t.calls = [{ url }]; return { ok: true, status: 200, json: async () => ({ choices: [] }) }; };
  const out = await composeModelPlan({ storage: storageOf(full), fetchImpl: bad }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_BAD_RESPONSE');
});

test('probe carries no page content and no goal', () => {
  const probe = buildProbeRequest({ model: 'm' });
  assert.equal(probe.temperature, 0);
  assert.ok(JSON.stringify(probe).length < 300);
});

test('a hung endpoint surfaces MODEL_TIMEOUT, never a hang', async () => {
  const hanging = () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  const out = await composeModelPlan({ storage: storageOf(full), fetchImpl: hanging }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_TIMEOUT');
});
test('compiler bounds are pinned', () => {
  assert.equal(MODEL_TIMEOUT_MS, 30000);
  assert.equal(MODEL_MAX_TOKENS, 2000);
});

test('endpoint allowlist: https or loopback only', () => {
  assert.equal(endpointOk('https://llm.example.com/v1/chat/completions'), true);
  assert.equal(endpointOk('http://127.0.0.1:11434/v1/chat/completions'), true);
  assert.equal(endpointOk('http://evil.example.com/x'), false);
  assert.equal(endpointOk('not-a-url'), false);
});

test('background routes the options probe action to the compiler module', async () => {
  const bg = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.ok(bg.includes(`scope === 'opera-agent-options'`));
  assert.ok(bg.includes(`action === 'testModel'`));
  assert.ok(bg.includes('buildProbeRequest'));
});
