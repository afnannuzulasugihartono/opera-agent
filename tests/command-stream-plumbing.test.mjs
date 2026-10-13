// @last-edited: 2026-10-13 UTC+7.
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
const upgradeOptions = [];
const realDeno = globalThis.Deno;
globalThis.Deno = {
  upgradeWebSocket(req, options) {
    upgradeOptions.push(options);
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

// WHY the runtime is stubbed globally alongside Deno. serveDeviceSocket keeps one
// promise pending through EdgeRuntime.waitUntil until the socket closes, which is
// what stops the platform retiring the isolate while a device is connected. The
// stub records the promise so a test can prove it is held and then released.

const waitedPromises = [];
const realEdgeRuntime = globalThis.EdgeRuntime;
globalThis.EdgeRuntime = {
  waitUntil(promise) { waitedPromises.push(promise); }
};
process.on('exit', () => { globalThis.EdgeRuntime = realEdgeRuntime; });

// WHY the timers are stubbed globally too. serveDeviceSocket is the real module,
// so its setInterval and setTimeout are the globals, exactly like its Deno. A
// real keepalive interval holds the process open after the last test, so the suite
// would never exit; recording the handles also makes it possible to prove the
// interval is cleared when the socket closes.

// WHY the handles are plain numbers and not real timers. A stand-in built on
// setInterval(fn, 0) is itself an interval that never stops, which holds the
// process open after the last test and makes the whole suite look like it hung.
// Nothing here needs a real timer; the assertions are about which handles were
// created and which were released.

let nextTimerId = 0;
let activeTimers = null;

globalThis.setInterval = function stubbedSetInterval(fn, ms) {
  const id = ++nextTimerId;
  activeTimers?.intervals.add(id);
  activeTimers?.intervalsById.set(id, { fn, ms });
  return id;
};
globalThis.clearInterval = function stubbedClearInterval(id) {
  activeTimers?.intervals.delete(id);
  activeTimers?.cleared.push(id);
};
globalThis.setTimeout = function stubbedSetTimeout(fn, ms) {
  const id = ++nextTimerId;
  activeTimers?.timeouts.push({ id, ms });
  return id;
};
globalThis.clearTimeout = function stubbedClearTimeout(id) {
  activeTimers?.cleared.push(id);
};

// WHY the sandbox shares the stubbed timers. The bridge source runs inside the vm
// context with its own globals, so the outer stubs are invisible to it — without
// sharing, the drain poll would be a real interval the test can neither see nor
// stop, and the suite would hang on exit.

function harness(emit = { ok: true, eventId: 7 }) {
  const calls = [];
  let handler;
  const sockets = [];
  const timers = { intervals: new Set(), intervalsById: new Map(), cleared: [], timeouts: [] };
  activeTimers = timers;
  upgradedSockets.length = 0;
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'opera_emit_command_event') return { data: emit };
      if (name === 'opera_auth_device') return { data: 'device-uuid' };
      if (name === 'opera_claim_next_wait') return { data: { ok: true, command: null } };
      throw new Error(`Unexpected RPC ${name}`);
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
      },
      setTimeout(fn, ms) {
        timers.timeouts.push({ fn, ms });
        return -1;
      },
      clearTimeout() { }
    },
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
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
  return { calls, post, openSocket, sockets, timers };
}

// Every socket test opens the same way and waits for the same settled state. The
// wait is a turn loop rather than a fixed count because the handshake hashes on
// the threadpool, which queues behind the rest of the suite when everything runs
// at once, and a fixed count would make these locks flaky under load.

async function handshakenSocket(h) {
  const socket = await h.openSocket();
  socket.onopen();
  await socket.onmessage({ data: JSON.stringify({ type: 'hello', token: 'a'.repeat(64), deviceName: 'opera' }) });
  for (let turn = 0; turn < 5000; turn += 1) {
    if ([...h.timers.intervalsById.values()].some((t) => t.ms === 20000)) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return socket;
}

function pollTick(h) {
  const poll = [...h.timers.intervalsById.entries()].find(([, t]) => t.ms !== 20000);
  assert.ok(poll, 'no drain poll interval to drive');
  assert.ok(poll[1].ms >= 50 && poll[1].ms <= 300,
    `a ${poll[1].ms}ms poll is either wasteful or felt`);
  return poll;
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

// WHY this lock exists. The change channel is the only thing that claims a command
// now that the device stopped polling, and a channel only exists while a socket is
// connected. So work that queued while the device was away sat unclaimed until the
// next command happened to arrive, which means the first command after any outage
// could wait indefinitely. Claiming once on subscribe is what makes a reconnect
// self-healing instead of dependent on luck.

// WHY the drain is given turns rather than a fixed count of microtasks. The drain
// is deliberately not awaited by the handshake, and asserting on an exact number
// of turns makes this lock itself flaky under load, which is worse than not having
// it at all. The bound is generous because each turn is nearly free when idle and
// the handshake's hashing runs on the threadpool, which queues behind the rest of
// the suite when everything runs at once.

test('a fresh socket drains the backlog on arrival, so work queued while away still runs', async () => {
  const h = harness();
  const socket = await handshakenSocket(h);

  for (let turn = 0; turn < 5000; turn += 1) {
    if (h.calls.some((c) => c.name === 'opera_claim_next_wait')) break;
    await new Promise((resolve) => setImmediate(resolve));
  }

  const claims = h.calls.filter((c) => c.name === 'opera_claim_next_wait');
  assert.ok(claims.length >= 1, 'connecting claimed nothing, so the backlog waits for the next insert');
  assert.equal(claims[0].args.p_wait_ms, 0, 'the drain must not block the handshake that triggered it');
});

// The keepalive is what keeps the device's worker alive, and an interval that
// outlives its socket is a leak that grows with every reconnect and never shows
// up in a log. Closing must clear it.
//
// The handshake carries two deadlines rather than one: arrival answers the first,
// and verification is bounded by the second. Both must be answered on a socket
// that became ready, or a live device leaks a timer per reconnect the same way.

test('closing the socket stops the keepalive, so a gone device leaks no timer', async () => {
  const h = harness();
  const socket = await handshakenSocket(h);

  const keepalive = [...h.timers.intervalsById.entries()].find(([, t]) => t.ms === 20000);
  assert.ok(keepalive, 'a handshaken socket runs no keepalive at all');
  assert.equal(h.timers.timeouts.length, 2, 'the handshake ran without both of its deadlines');
  for (const { id } of h.timers.timeouts) {
    assert.ok(h.timers.cleared.includes(id), 'a ready socket still holds a handshake deadline');
  }

  socket.onclose({ code: 1006, reason: 'worker stopped' });

  assert.ok(!h.timers.intervals.has(keepalive[0]), 'the keepalive survived the socket it belonged to');
  assert.equal(h.timers.cleared.length, 4,
    'both handshake deadlines, the keepalive and the poll must be cleared too, or they fire on a dead socket');
});

// WHY the worker is kept alive by a promise the test can see. Without an
// unresolved waitUntil, the platform retires the isolate as idle and every device
// socket dies at a consistent interval — observed live as code 1006 every
// seventy-some seconds. Holding the promise is what keeps the socket's worker
// alive, and resolving it on close is what lets the worker end.

test('an upgraded socket holds the worker until it closes, or the platform retires it early', async () => {
  waitedPromises.length = 0;
  const h = harness();
  const socket = await h.openSocket();

  assert.equal(waitedPromises.length, 1, 'the upgrade held no promise, so the worker looks idle');

  let released = false;
  waitedPromises[0].then(() => { released = true; });
  socket.onclose({ code: 1006, reason: '' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(released, true, 'closing the socket never released the worker');
});

// WHY the drain runs on a fast poll instead of listening. Two event feeds were
// tried and measured: postgres_changes delivered in 650-1000 ms, and a broadcast
// fired 46 ms after insert still claimed anywhere between 200 and 1300 ms,
// because the Realtime subscriber held by the edge isolate proved flaky. A 200 ms
// poll is deterministic where both feeds were not. This test turns that crank by
// hand and proves each tick claims.

test('each poll tick claims, so a queued command waits one interval at most', async () => {
  const h = harness();
  await handshakenSocket(h);

  const poll = pollTick(h);

  const claimsBefore = h.calls.filter((c) => c.name === 'opera_claim_next_wait').length;
  poll[1].fn();
  for (let turn = 0; turn < 5000; turn += 1) {
    if (h.calls.filter((c) => c.name === 'opera_claim_next_wait').length > claimsBefore) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const claimsAfter = h.calls.filter((c) => c.name === 'opera_claim_next_wait').length;

  assert.ok(claimsAfter > claimsBefore, 'a poll tick ran and claimed nothing');
});

// WHY overlapping drains are refused rather than queued. Two drains in flight can
// claim two commands and push the second before the first, which would execute
// same-device commands out of order. A tick that arrives mid-drain is skipped;
// the next tick picks up whatever is still queued 200 ms later.

test('a poll tick during a running drain is skipped, so commands stay ordered', async () => {
  const h = harness();
  await handshakenSocket(h);

  const poll = pollTick(h);
  const tick = poll[1].fn;

  for (let turn = 0; turn < 5000; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const settled = h.calls.filter((c) => c.name === 'opera_claim_next_wait').length;

  tick();
  tick();
  for (let turn = 0; turn < 5000; turn += 1) {
    if (h.calls.filter((c) => c.name === 'opera_claim_next_wait').length > settled) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (let turn = 0; turn < 200; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(
    h.calls.filter((c) => c.name === 'opera_claim_next_wait').length,
    settled + 1,
    'two overlapping ticks both drained, so two commands can overtake each other'
  );
});

test('closing the socket stops the poll, so a gone device costs no queries', async () => {
  const h = harness();
  const socket = await handshakenSocket(h);

  const poll = pollTick(h);
  assert.ok(h.timers.intervals.has(poll[0]), 'the poll is not running');

  socket.onclose({ code: 1006, reason: '' });

  assert.ok(!h.timers.intervals.has(poll[0]), 'the poll survived the socket it belonged to');
});

// WHY the protocol idle timeout stays disabled. Deno's default closes a socket
// whose peer misses a protocol-level pong, and observed live that killed a fully
// healthy client. Liveness is decided by the application ping instead, so the
// transport guess must stay off or the two verdicts fight.

test('upgraded sockets disable the protocol idle timeout', async () => {
  upgradeOptions.length = 0;
  const h = harness();
  await h.openSocket();

  assert.equal(upgradeOptions.length, 1, 'no upgrade happened to check');
  assert.equal(upgradeOptions[0]?.idleTimeout, 0,
    'the protocol timeout is back on, so healthy clients can be closed without reason');
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