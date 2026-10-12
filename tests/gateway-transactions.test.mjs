// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: gateway-transactions.test — transactions.test — Test.
// @state: fold the gateway offline check into the auth call.
// @dependencies: node:test, strict, node:fs, node:module, node:vm, cors.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from '../supabase/functions/_shared/cors.js';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/opera-agent-gateway/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, ''));
const commandId = '00000000-0000-4000-8000-000000000001';

function harness({ auth = { ok: true, last_seen_at: new Date().toISOString() }, user = null, enqueue = { ok: true, commandId }, result = { ok: true, commandId, result: { tabs: [] } }, fail, release, env = {} } = {}) {
  const calls = [];
  let handler;
  let committed = false;
  const client = {
    auth: {
      async getUser() {
        if (user) return { data: { user }, error: null };
        return { data: { user: null }, error: { message: 'invalid token' } };
      }
    },
    from(table) {
      if (user && table === 'opera_devices') {
        return {
          select() { return this; },
          eq() { return this; },
          neq() { return this; },
          order() { return this; },
          limit() { return this; },
          async single() { return { data: { device_name: user.device, last_seen_at: new Date().toISOString() } }; }
        };
      }

      throw new Error(`REST read removed: gateway must not query ${table}`);
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'opera_await_adaptive' && fail === 'transport') throw new Error('connection reset');
      if (name === fail) return { data: null, error: { message: 'RPC failed' } };
      if (name === 'opera_verify_device') return { data: auth };
      if (name === 'opera_enqueue') {
        if (release) await release;
        committed = true;
        return { data: enqueue };
      }
      if (name === 'opera_await_adaptive') {
        assert.equal(committed, true, 'enqueue must commit before the wait request');
        return { data: result };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };

  vm.runInNewContext(source, { createClient: () => client, CORS_DEFAULT_ORIGINS, resolveAllowedOrigin, Deno: { env: { get: (key) => (key in env ? env[key] : 'test') }, serve: (fn) => { handler = fn; } }, Request, Response, URL, TextEncoder, TextDecoder, crypto });
  return { calls, request: (body = {}, headers = {}) => handler(new Request('https://example.test/functions/v1/opera-agent-gateway/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ apiKey: 'TEST-TOKEN', method: 'tabs.list', ...body })
  })), raw: (req) => handler(req), getOpenApi: () => handler(new Request('https://proxy.test/opera-agent-gateway/openapi.json')) };
}

test('one caller request waits for committed enqueue, then adaptive await with unchanged arguments', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ release: gate });
  const response = h.request({ params: { active: false }, waitMs: 2000, requestId: 'retry-1' });
  const deadline = Date.now() + 2000;
  while (!h.calls.some((c) => c.name === 'opera_enqueue')) {
    assert.ok(Date.now() < deadline, 'gateway did not reach enqueue');
    if (h.calls.some((c) => c.name === 'opera_run_fast')) assert.fail('combined transaction cannot expose the queued command');
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(h.calls.some((c) => c.name === 'opera_await_adaptive'), false);
  release();
  assert.equal((await response).status, 200);
  const calls = JSON.parse(JSON.stringify(h.calls));
  assert.deepEqual(calls.map((c) => c.name || c), ['opera_verify_device', 'opera_enqueue', 'opera_await_adaptive']);
  assert.deepEqual(calls[1].args, { p_method: 'tabs.list', p_params: { active: false }, p_timeout_ms: 2000, p_device_name: 'opera', p_request_id: 'retry-1' });
  assert.deepEqual(calls[2].args, { p_command_id: commandId, p_timeout_ms: 2000 });
});

test('missing and invalid tokens cannot read devices or enqueue', async () => {
  for (const missing of [true, false]) {
    const h = harness({ auth: { ok: false } });
    assert.equal((await h.request(missing ? { apiKey: null } : {})).status, 401);
    assert.equal(h.calls.length, missing ? 0 : 1);
  }
});

test('gateway 401 responses never echo the submitted token', async () => {
  const marker = 'TEST-TOKEN-UNIQUE-12345';
  const h = harness({ auth: { ok: false } });
  const r1 = await h.request({ apiKey: marker });
  assert.equal(r1.status, 401);
  assert.doesNotMatch(await r1.text(), /TEST-TOKEN-UNIQUE-12345/);
  const r2 = await h.request({ apiKey: null }, { authorization: 'Bearer ' + marker });
  assert.equal(r2.status, 401);
  assert.doesNotMatch(await r2.text(), /TEST-TOKEN-UNIQUE-12345/);
});

test('unpaired and offline devices are rejected before enqueue', async () => {

  {
    const h = harness({ auth: { ok: false } });
    const response = await h.request();
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
    assert.equal(h.calls.some((c) => c.name === 'opera_enqueue'), false);
  }
  for (const last_seen_at of [null, '2000-01-01T00:00:00Z']) {
    const h = harness({ auth: { ok: true, last_seen_at } });
    const response = await h.request();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).error, 'Device is offline.');
    assert.equal(h.calls.some((c) => c.name === 'opera_enqueue'), false);
  }
});

test('a user JWT resolves the caller device, never the fixed name', async () => {

  const h = harness({ auth: { ok: false }, user: { id: 'user-1', device: 'opera-brave' } });
  const response = await h.request();
  assert.equal(response.status, 200);
  const enqueue = h.calls.find((c) => c.name === 'opera_enqueue');
  assert.ok(enqueue, 'the user path reaches enqueue');
  assert.equal(enqueue.args.p_device_name, 'opera-brave');
});

test('enqueue rejection is preserved and never followed by await', async () => {
  for (const enqueue of [{ ok: false, error: 'Method is not allowlisted.' }, { ok: false, error: 'Device is not paired.' }, null]) {
    const h = harness({ enqueue });
    const response = await h.request();
    assert.equal(response.status, enqueue?.error.includes('not paired') ? 401 : 200);
    const body = await response.json();
    if (enqueue?.error === 'Method is not allowlisted.') assert.deepEqual(body, enqueue);
    if (!enqueue) assert.equal(body.error.code, 'GATEWAY_ERROR');
    assert.equal(h.calls.some((c) => c.name === 'opera_await_adaptive'), false);
  }
});

test('reused command IDs, result envelopes and timeout semantics are preserved', async () => {
  for (const result of [{ ok: true, result: { value: 1 } }, { ok: false, error: { code: 'STALE_REF' } }, { ok: false, error: { code: 'AWAIT_TIMEOUT' } }]) {
    const h = harness({ enqueue: { ok: true, commandId, reused: true }, result });
    const response = await h.request({ apiKey: null, requestId: 'same-key', waitMs: 999999 }, { authorization: 'Bearer TEST-TOKEN' });
    assert.equal(response.status, result.error?.code === 'AWAIT_TIMEOUT' ? 504 : 200);
    const body = await response.json();
    if (response.status === 504) assert.match(body.error.message, /may still have succeeded/);
    else assert.deepEqual(body, result);
    assert.equal(h.calls.at(-1).args.p_command_id, commandId);
    assert.equal(h.calls.at(-1).args.p_timeout_ms, 32000);
  }
});

test('RPC failures retain gateway errors and do not retry enqueue', async () => {
  for (const fail of ['opera_verify_device', 'opera_enqueue', 'opera_await_adaptive']) {
    const h = harness({ fail });
    const response = await h.request();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'GATEWAY_ERROR');
    assert.ok(h.calls.filter((c) => c.name === 'opera_enqueue').length <= 1);
    if (fail !== 'opera_await_adaptive') assert.equal(h.calls.some((c) => c.name === 'opera_await_adaptive'), false);
  }
});

test('post-enqueue RPC and transport failures preserve command identity and unknown outcome without retries', async () => {
  for (const fail of ['opera_await_adaptive', 'transport']) {
    const h = harness({ fail });
    const response = await h.request();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error.code, 'GATEWAY_ERROR');
    assert.equal(body.commandId, commandId);
    assert.equal(body.outcome, 'unknown');
    assert.match(body.error.message, /may still have succeeded/);
    assert.match(body.error.message, /verify page state before repeating/i);
    assert.equal(h.calls.filter((c) => c.name === 'opera_enqueue').length, 1);
    assert.equal(h.calls.filter((c) => c.name === 'opera_await_adaptive').length, 1);
    assert.equal(h.calls.find((c) => c.name === 'opera_enqueue').args.p_request_id, null);
  }
});

test('openapi servers url is the full public base path from SUPABASE_URL, never the rewritten request URL', async () => {
  const h = harness({ env: { SUPABASE_URL: 'https://nenmkmtvjremqphfqnfw.supabase.co' } });
  const response = await h.getOpenApi();
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.info.version, '1.0.1');
  assert.equal(spec.servers[0].url, 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway');
});

function streamRequest(payload, { chunked = true } = {}) {

  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  return new Request('https://example.test/functions/v1/opera-agent-gateway/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half'
  });
}

test('a chunked body without content-length is still capped at 256 KiB', async () => {
  const h = harness({});
  const response = await h.raw(streamRequest('x'.repeat(300 * 1024)));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'TOO_LARGE');
  assert.equal(h.calls.length, 0, 'an oversized body never reaches authentication or enqueue');
});

test('a small chunked body still parses and runs the normal path', async () => {
  const h = harness({});
  const response = await h.raw(streamRequest(JSON.stringify({ apiKey: 'TEST-TOKEN', method: 'tabs.list' })));
  assert.equal(response.status, 200);
  assert.ok(h.calls.some((c) => c.name === 'opera_enqueue'), 'legit chunked traffic is unaffected');
});

test('a declared content-length over 256 KiB is still rejected before parsing', async () => {
  const h = harness({});
  const response = await h.request({ params: { padding: 'x'.repeat(300 * 1024) } });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'TOO_LARGE');
  assert.equal(h.calls.length, 0);
});

test('an oversize chunked body aborts at the cap instead of buffering whole', async () => {

  const TOTAL = 64;
  const CHUNK = 16 * 1024;
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > TOTAL) { controller.close(); return; }
      controller.enqueue(new Uint8Array(CHUNK));
    }
  });
  const h = harness({});
  const response = await h.raw(new Request('https://example.test/functions/v1/opera-agent-gateway/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half'
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'TOO_LARGE');
  assert.equal(h.calls.length, 0, 'an oversized body never reaches authentication or enqueue');
  assert.ok(pulled < TOTAL, `the reader stopped early after ${pulled} of ${TOTAL} chunks`);
});

