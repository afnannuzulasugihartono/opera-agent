// @last-edited: 2026-10-12 UTC+7.
// @title: cf-gateway — POST /command with the exact public shape, fulfilled by one device call.
// @state: 14 locks; parsing, auth incl. OAuth fallback, provider, wait, and error shapes verbatim.
// @dependencies: node:test, strict, ../cloudflare/src/gateway.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientIdFromJwt,
  createGateway,
  extractToken,
  normalizeInput,
  openApiSpec,
  providerFromUA,
  readBoundedBody
} from '../cloudflare/src/gateway.js';

const COMMAND_ID = 'a2f0f239-aa99-4d1c-a168-4a5ca51be777';

function harness(overrides = {}) {
  const calls = [];
  const base = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'opera_verify_device') return overrides.verify ?? { ok: true, last_seen_at: new Date(1000000).toISOString() };
      if (name === 'opera_enqueue') return overrides.enqueue ?? { ok: true, commandId: COMMAND_ID };
      if (name === 'opera_client_name') return overrides.clientName ?? 'Some Client';
      throw new Error(`Unexpected RPC ${name}`);
    },
    authUser: async () => overrides.authUserId ?? null,
    deviceForUser: async () => overrides.deviceForUser ?? null,
    setProvider: async (commandId, provider) => {
      calls.push({ name: 'setProvider', args: { commandId, provider } });
    },
    runOnDevice: async (input) => {
      calls.push({ name: 'device.run', args: input });
      return overrides.run ?? { ok: true, result: { ok: true } };
    },
    now: () => 1000000
  };
  return { gateway: createGateway(base), calls };
}

const headersOf = (entries = {}) => new Headers({ 'content-type': 'application/json', ...entries });

const runValid = (h, extra = {}) => h.gateway.handleCommand({
  headers: headersOf({ 'x-opera-agent-token': 'tok' }),
  rawBody: JSON.stringify({ method: 'tabs.list', params: {}, waitMs: 2000, requestId: 'r1' }),
  userAgent: 'test',
  ...extra
});

test('a valid command verifies, enqueues, then waits on the device exactly once', async () => {
  const h = harness({});
  const res = await runValid(h);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(h.calls.map((c) => c.name), ['opera_verify_device', 'opera_enqueue', 'device.run']);
  assert.equal(h.calls[2].args.commandId, COMMAND_ID);
});

test('a bad token answers 401 without touching enqueue', async () => {
  const h = harness({ verify: { ok: false } });
  const res = await runValid(h);

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.ok(!h.calls.some((c) => c.name === 'opera_enqueue'));
});

test('a chatgpt plugin token resolves its own device instead of failing closed', async () => {
  const h = harness({
    verify: { ok: false },
    authUserId: 'user-1',
    deviceForUser: { device_name: 'opera', last_seen_at: new Date(1000000).toISOString() }
  });
  const res = await runValid(h);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(h.calls.some((c) => c.name === 'opera_enqueue'), 'the oauth device never got its command queued');
});

test('an unknown oauth user still answers 401', async () => {
  const h = harness({ verify: { ok: false }, authUserId: null });
  const res = await runValid(h);

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('an offline device answers without enqueuing', async () => {
  const h = harness({ verify: { ok: true, last_seen_at: new Date(0).toISOString() } });
  const res = await runValid(h);

  assert.equal(res.body.ok, false);
  assert.ok(!h.calls.some((c) => c.name === 'opera_enqueue'));
});

test('a device timeout surfaces as AWAIT_TIMEOUT with the command attached', async () => {
  const h = harness({ run: { ok: false, error: { code: 'AWAIT_TIMEOUT', message: 'slow' } } });
  const res = await runValid(h);

  assert.equal(res.status, 504);
  assert.equal(res.body.error.code, 'AWAIT_TIMEOUT');
  assert.equal(res.body.error.message, 'The device did not report back before waitMs. The action may still have succeeded — verify page state before repeating it.');
});

test('a chatgpt caller is attributed without slowing the command', async () => {
  const h = harness({});
  const res = await runValid(h, { userAgent: 'ChatGPT/1.0' });

  assert.equal(res.status, 200);
  const set = h.calls.find((c) => c.name === 'setProvider');
  assert.ok(set, 'no provider attribution happened');
  assert.equal(set.args.provider, 'chatgpt');
  assert.equal(set.args.commandId, COMMAND_ID);
});

test('a body past the cap is refused before parsing', async () => {
  const req = new Request('https://x/command', { method: 'POST', body: 'x'.repeat(100) });
  assert.equal(await readBoundedBody(req, 10), null);

  const small = new Request('https://x/command', { method: 'POST', body: '{"a":1}' });
  assert.equal(await readBoundedBody(small, 10), '{"a":1}');
});

test('garbage in answers 400 with the exact public shapes', async () => {
  const h = harness({});

  const notJson = await h.gateway.handleCommand({ headers: headersOf(), rawBody: 'nope{', userAgent: '' });
  assert.equal(notJson.status, 400);
  assert.equal(notJson.body.error.code, 'INVALID_JSON');

  const badMethod = await h.gateway.handleCommand({
    headers: headersOf({ 'x-opera-agent-token': 'tok' }), rawBody: JSON.stringify({ method: '??', params: {} }), userAgent: ''
  });
  assert.equal(badMethod.status, 400);
  assert.equal(badMethod.body.error.code, 'INVALID_METHOD');
});

test('token, provider, and client id helpers match the source exactly', () => {
  assert.equal(extractToken(headersOf({ 'x-opera-agent-token': ' abc ' }), {}), 'abc');
  assert.equal(extractToken(headersOf({ authorization: 'Bearer xyz' }), {}), 'xyz');
  assert.equal(extractToken(headersOf(), { apiKey: 'k' }), 'k');
  assert.equal(extractToken(headersOf(), {}), null);

  assert.equal(providerFromUA('ChatGPT/1.0'), 'chatgpt');
  assert.equal(providerFromUA('openai-sdk'), 'chatgpt');
  assert.equal(providerFromUA('curl'), '');

  const jwt = `h.${Buffer.from(JSON.stringify({ client_id: 'c1' })).toString('base64url')}.s`;
  assert.equal(clientIdFromJwt(jwt), 'c1');
  assert.equal(clientIdFromJwt('not-a-jwt'), '');
});

test('timeout clamps and request id validation match the source', () => {
  assert.equal(normalizeInput({ method: 'tabs.list', waitMs: 999999 }).input.timeoutMs, 32000);
  assert.equal(normalizeInput({ method: 'tabs.list', waitMs: 1 }).input.timeoutMs, 500);
  assert.equal(normalizeInput({ method: 'tabs.list', requestId: 'ok-1_2' }).input.requestId, 'ok-1_2');
  assert.equal(normalizeInput({ method: 'tabs.list', requestId: 'no spaces!' }).input.requestId, null);
  assert.deepEqual(normalizeInput({ method: 'tabs.list' }).input.params, {});
});

test('the openapi document keeps its shape and version', () => {
  const spec = openApiSpec('https://x/functions/v1/opera-agent-gateway');
  assert.equal(spec.openapi, '3.0.0');
  assert.equal(spec.info.version, '1.0.1');
  assert.ok(spec.paths['/command'].post);
  assert.equal(spec.servers[0].url, 'https://x/functions/v1/opera-agent-gateway');
});
