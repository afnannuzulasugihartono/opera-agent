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

const bridgeSource = stripTypeScriptTypes(readFileSync(
  new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url), 'utf8'
).replace(/^import .*;\r?\n/gm, ''));

const COMMAND_ID = 'a2f0f239-aa99-4d1c-a168-4a5ca51be777';

function harness(emit = { ok: true, eventId: 7 }) {
  const calls = [];
  let handler;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'opera_emit_command_event') return { data: emit };
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  vm.runInNewContext(bridgeSource, {
    createClient: () => client,
    createEdgeLog: () => ({ error() {} }),
    CORS_DEFAULT_ORIGINS, resolveAllowedOrigin,
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto
  });
  const post = (payload) => handler(new Request('https://example.test/functions/v1/opera-agent-bridge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  }));
  return { calls, post };
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

test('an emit with a bad token is refused before any RPC runs', async () => {
  const h = harness();
  const res = await h.post(validBody({ token: 'short' }));
  assert.equal(res.status, 401);
  assert.equal(h.calls.length, 0, 'an unauthenticated emit reached the database');
});

test('a commandId that is not a uuid is refused before any RPC runs', async () => {
  const h = harness();
  const res = await h.post(validBody({ commandId: 'not-a-uuid' }));
  assert.equal(res.status, 400);
  assert.equal(h.calls.length, 0, 'a malformed command id reached the database');
});

test('an unknown kind is refused, so the allowlist has one owner in the bridge too', async () => {
  const h = harness();
  const res = await h.post(validBody({ kind: 'exfiltrate' }));
  assert.equal(res.status, 400);
  assert.equal(h.calls.length, 0, 'an unknown kind reached the database');
});

test('an oversized envelope is refused, because events are spent from a model budget', async () => {
  const h = harness();
  const res = await h.post(validBody({ envelope: { blob: 'x'.repeat(64 * 1024) } }));
  assert.equal(res.status, 400);
  assert.equal(h.calls.length, 0, 'an oversized envelope reached the database');
});

test('the device emits without awaiting, so a slow bridge cannot slow a burst step', () => {
  const pull = readFileSync(new URL('../extension/worker/execute-pull.js', import.meta.url), 'utf8');
  const emitter = pull.match(/function emitCommandEvent[\s\S]*?\n}/);

  assert.ok(emitter, 'no emitCommandEvent helper on the device');
  assert.match(emitter[0], /\.catch\(\(\) => \{\}\)/,
    'the emit is awaited or its rejection is propagated, so a slow bridge becomes burst latency');
  assert.doesNotMatch(emitter[0], /await\s+fetchJson/, 'the helper awaits the network call itself');
});