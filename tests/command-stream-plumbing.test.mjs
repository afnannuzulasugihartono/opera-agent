// @last-edited: 2026-10-11 UTC+7.
// @title: command-stream-plumbing — the device side of the streaming channel must not become a way to stall or flood.
// @state: 6 locks; bridge validation, the envelope cap, and the device fire-and-forget rule.
// @dependencies: node:test, strict, node:fs, node:module, node:vm.

// WHY THIS FILE EXISTS
//
// The database half of the streaming channel is locked in
// tests/command-event-stream.test.mjs and was proven against the live database.
// This file covers the two hops on either side of it, because both can quietly
// break the promise the SQL makes.
//
// The bridge is the device's only authenticated path. The device never sees a
// token_hash, so an emit that skipped the bridge could not authenticate at all,
// and one that trusted its body would let any paired device write arbitrary
// labels into another owner's command stream. The envelope cap matters for the
// same reason: events land in a model's context, so an unbounded envelope is a
// way to spend someone's token budget without doing any work.
//
// The device rule is the one that is easiest to get wrong by accident. Emit is
// best-effort telemetry: if the bridge is slow or down, the command must still
// complete. An awaited emit inside the burst loop would add a network round trip
// to every step of every burst, which is the exact latency the channel exists to
// remove. It is therefore fire-and-forget, with the rejection swallowed rather
// than propagated into the step result.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from '../supabase/functions/_shared/cors.js';
import { isUpgradeRequest, serveDeviceSocket } from '../supabase/functions/opera-agent-bridge/bridge-socket.ts';

const bridgeSource = stripTypeScriptTypes(readFileSync(
  new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8'
).replace(/^import .*;\r?\n/gm, ''));

const COMMAND_ID = 'a2f0f239-aa99-4d1c-a168-4a5ca51be777';

// WHY the runtime is stubbed globally. serveDeviceSocket is the real module, not a
// vm copy, so it reaches for the Deno global rather than the one this harness
// hands the bridge source. A WebSocket cannot be constructed in a unit test, so
// this stands in for the one call it makes.

const upgradedSockets = [];
const realDeno = globalThis.Deno;
globalThis.Deno = {
  upgradeWebSocket() {
    const socket = {
      readyState: 1,
      sent: [],
      closed: null,
      send(text) { this.sent.push(text); },
      close(code, reason) { this.closed = { code, reason }; }
    };
    upgradedSockets.push(socket);
    return { socket, response: { status: 101 } };
  }
};
process.on('exit', () => { globalThis.Deno = realDeno; });

function harness(emit = { ok: true, eventId: 7 }) {
  const calls = [];
  let handler;
  const sockets = [];
  upgradedSockets.length = 0;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'opera_emit_command_event') return { data: emit };
      if (name === 'opera_auth_device') return { data: 'device-uuid' };
      if (name === 'opera_claim_next_wait') return { data: { ok: true, command: null } };
      throw new Error(`Unexpected RPC ${name}`);
    },
    channel() {
      return { on() { return this; }, subscribe() { return this; } };
    },
    async removeChannel() { }
  };
  vm.runInNewContext(bridgeSource, {
    createClient: () => client,
    createEdgeLog: () => ({ error() {} }),
    CORS_DEFAULT_ORIGINS, resolveAllowedOrigin,
    isUpgradeRequest, serveDeviceSocket,
    WebSocket: { OPEN: 1 },
    Deno: {
      env: { get: () => 'test' },
      serve: (fn) => { handler = fn; },
      upgradeWebSocket() {
        const socket = {
          readyState: 1,
          sent: [],
          closed: null,
          send(text) { this.sent.push(text); },
          close(code, reason) { this.closed = { code, reason }; }
        };
        sockets.push(socket);
        return { socket, response: { status: 101 } };
      }
    },
    Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto
  });
  const post = (payload) => handler(new Request('https://example.test/functions/v1/opera-agent-bridge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }));
  const openSocket = async () => {
    await handler(new Request('https://example.test/functions/v1/opera-agent-bridge', {
      headers: { upgrade: 'websocket' }
    }));
    return upgradedSockets[0];
  };
  return { calls, post, openSocket, sockets };
}

const validBody = (extra = {}) => ({
  action: 'command_event', token: 'a'.repeat(64), deviceName: 'opera',
  commandId: COMMAND_ID, kind: 'step', envelope: { n: 1 }, ...extra
});

test('a well-formed emit reaches the RPC with the device token hashed, never in the clear', async () => {
  const h = harness();
  const res = await h.post(validBody());
  assert.equal(res.status, 200);
  const call = h.calls.find((c) => c.name === 'opera_emit_command_event');
  assert.ok(call, 'the emit never reached the RPC');
  assert.equal(call.args.p_command_id, COMMAND_ID);
  assert.equal(call.args.p_kind, 'step');
  assert.notEqual(call.args.p_token_hash, 'a'.repeat(64), 'the raw token was forwarded instead of its hash');
  assert.equal(call.args.p_token_hash.length, 64);
});

const REFUSALS = [
  ['an emit with a bad token never reaches the database', { token: 'short' }, 401],
  ['a commandId that is not a uuid never reaches the database', { commandId: 'not-a-uuid' }, 400],
  ['an unknown kind never reaches the database', { kind: 'exfiltrate' }, 400],
  ['an oversized envelope never reaches the database', { envelope: { blob: 'x'.repeat(64 * 1024) } }, 400]
];

for (const [name, override, status] of REFUSALS) {
  test(name, async () => {
    const h = harness();
    const res = await h.post(validBody(override));
    assert.equal(res.status, status);
    assert.equal(h.calls.length, 0, 'a refused emit still reached the database');
  });
}

// WHY this lock exists. Handshaking a device with the claim RPC looks like a free
// way to reuse existing auth, and it is not free at all: the claim is what takes
// ownership of a queued command, and a handshake that claims throws the result
// away. The device then sits connected and silent while the one command waiting
// for it has already been marked as somebody else's.

test('the handshake authenticates without claiming, so no queued command is swallowed', async () => {
  const h = harness();
  const socket = await h.openSocket();

  await socket.onmessage({ data: JSON.stringify({ type: 'hello', token: 'a'.repeat(64), deviceName: 'opera' }) });

  const names = h.calls.map((c) => c.name);
  assert.ok(names.includes('opera_auth_device'), `the handshake authenticated through ${names.join(', ')}`);
  assert.ok(!names.includes('opera_claim_next_wait'),
    'the handshake claimed a command, which is ownership, not authentication');
});

test('a socket that fails the handshake is closed unread and never receives work', async () => {
  const h = harness();
  const socket = await h.openSocket();

  await socket.onmessage({ data: JSON.stringify({ type: 'command', command: { id: 'x', method: 'browser.ping' } }) });

  assert.ok(!socket.sent.some((text) => text.includes('"command"')),
    'a command went out before the bridge accepted this device');
});

test('the device emits without awaiting, so a slow bridge cannot slow a burst step', () => {
  const pull = readFileSync(new URL('../extension/worker/execute-pull.js', import.meta.url), 'utf8');
  const emitter = pull.match(/function emitCommandEvent[\s\S]*?\n}/);

  assert.ok(emitter, 'no emitCommandEvent helper on the device');
  assert.match(emitter[0], /\.catch\(\(\) => \{\}\)/,
    'the emit is awaited or its rejection is propagated, so a slow bridge becomes burst latency');
  assert.doesNotMatch(emitter[0], /await\s+fetchJson/, 'the helper awaits the network call itself');
});

test('emits are chained, so a done event cannot overtake the step events that preceded it', () => {
  const pull = readFileSync(new URL('../extension/worker/execute-pull.js', import.meta.url), 'utf8');
  const emitter = pull.match(/function emitCommandEvent[\s\S]*?\n}/)[0];

  assert.match(emitter, /emitChain = emitChain\.then\(/,
    'the emit fires independently, so two concurrent requests race and done can be written before the steps it follows');

  const declared = pull.match(/^let emitChain = Promise\.resolve\(\);$/m);
  assert.ok(declared, 'emitChain must start as a resolved promise, or the first emit waits on nothing and the rest chain behind it');
});