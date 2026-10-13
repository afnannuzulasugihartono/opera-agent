// @last-edited: 2026-10-13 UTC+7.
// @title: device-socket-client — one socket, driven by a fake, with no bridge and no browser present.
// @state: 8 locks; handshake gate, command dispatch, completion, backoff, and the fatal close.
// @dependencies: node:test, strict, ../extension/lib/socket-client.js.

// WHY THIS FILE EXISTS
//
// The client's whole job is behaviour that only shows up over time: it must not run
// work before the bridge says ready, it must reconnect on its own, and it must stop
// permanently when the bridge refuses it. None of that can be checked by reading the
// file, and none of it can be checked against a real bridge without a network.
//
// WHY the socket is a fake rather than a mock. A mock records calls and returns
// canned answers, which cannot model an open transitioning to a close. A fake holds
// the state a socket holds, so a test can open it, drop it, and watch what the
// client does next.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocketClient, connectionPatch } from '../extension/lib/socket-client.js';

class FakeSocket {
  static OPEN = 1;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closes = 0;
    FakeSocket.last = this;
  }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(data) { this.onmessage?.({ data }); }
  send(text) { this.sent.push(text); }
  close() { this.closes += 1; this.readyState = 3; }
  peerClosing() { this.readyState = 2; }
  drop(code = 1006, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
}

function harness(overrides = {}) {
  const timers = [];
  const watchTimers = [];
  const states = [];
  const executed = [];
  const sockets = [];

  const client = createSocketClient({
    url: 'wss://bridge.example/socket',
    token: 'secret',
    deviceName: 'opera',
    WebSocketImpl: function (url) {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    execute: async (command) => {
      executed.push(command);
      return { ok: true, result: { done: true } };
    },
    onState: (s) => states.push(s),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); },
    setWatchTimer: (fn, ms) => { watchTimers.push({ fn, ms }); },
    ...overrides
  });

  return { client, timers, watchTimers, states, executed, sockets };
}

// Each watchdog tick schedules the next one, so only the last recorded timer is
// ever live. Every timing test drives the same crank, which is why it lives here
// instead of being copied into each one.

function runTicks(env, time, count, stepMs = 10000) {
  for (let tick = 0; tick < count; tick += 1) {
    time.now += stepMs;
    env.watchTimers[env.watchTimers.length - 1].fn();
  }
}

function trackTime() {
  return { now: 1000 };
}

test('an opening socket sends the handshake before anything else', () => {
  const { client, sockets } = harness();
  client.start();
  sockets[0].open();

  const first = JSON.parse(sockets[0].sent[0]);
  assert.equal(first.type, 'hello');
  assert.equal(first.token, 'secret');
  assert.equal(first.deviceName, 'opera');
});

test('work arriving before the bridge says ready is refused, because an open socket has not proven the device', async () => {
  const { client, sockets, executed } = harness();
  client.start();
  sockets[0].open();

  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'c1', method: 'browser.ping' } }));
  await Promise.resolve();

  assert.deepEqual(executed, [], 'a command ran against an unproven identity');
});

test('after ready a command runs exactly once and its result goes back up the same socket', async () => {
  const { client, sockets, executed } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'c1', method: 'page.key', params: { key: 'a' } } }));
  await new Promise((r) => setImmediate(r));

  assert.equal(executed.length, 1);
  assert.equal(executed[0].method, 'page.key');

  const done = JSON.parse(sockets[0].sent[sockets[0].sent.length - 1]);
  assert.equal(done.type, 'complete');
  assert.equal(done.commandId, 'c1');
  assert.equal(done.ok, true);
});

test('a command that throws still produces a completion, so the bridge is never left waiting', async () => {
  const { client, sockets } = harness({
    execute: async () => { throw new Error('boom'); }
  });
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'c2', method: 'page.key' } }));
  await new Promise((r) => setImmediate(r));

  const done = JSON.parse(sockets[0].sent[sockets[0].sent.length - 1]);
  assert.equal(done.ok, false);
  assert.match(done.error.message, /boom/);
});

test('a dropped connection reconnects on a backoff that grows and is capped', () => {
  const { client, sockets, timers } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  sockets[0].drop();
  assert.equal(timers.length, 1);
  const first = timers[0].ms;

  timers[0].fn();
  sockets[1].drop();
  assert.ok(timers[1].ms > first, 'backoff must grow, or a downed bridge is hammered');

  for (let i = 0; i < 12; i += 1) {
    const last = timers[timers.length - 1];
    last.fn();
    sockets[sockets.length - 1].drop();
  }
  assert.ok(timers[timers.length - 1].ms <= 30000, 'backoff must be capped');
});

test('a rejected handshake stops the device for good instead of retrying forever', () => {
  const { client, sockets, timers, states } = harness();
  client.start();
  sockets[0].open();

  sockets[0].drop(4001);
  assert.equal(timers.length, 0, 'no retry after the bridge refuses this device');
  assert.ok(states.some((s) => s.status === 'rejected'));
});

// WHY a timeout reconnects. One slow handshake closed with 4002 used to stop the
// device permanently while its heartbeat stayed green, so every command queued
// and none ever ran. A timeout answers to a retry; only a refusal stops the
// device, because only a refusal says the credentials are wrong.

test('a timed out handshake reconnects with backoff instead of stopping the device', () => {
  const { client, sockets, timers, states } = harness();
  client.start();
  sockets[0].open();

  sockets[0].drop(4002, 'handshake timeout');
  assert.equal(timers.length, 1, 'a timed out handshake scheduled no retry');
  assert.ok(states.some((s) => s.status === 'reconnecting'));

  timers[0].fn();
  assert.equal(sockets.length, 2, 'the retry never opened a new socket');
  sockets[1].open();
  const hello = JSON.parse(sockets[1].sent[0]);
  assert.equal(hello.type, 'hello');
});

test('a malformed frame is ignored rather than allowed to throw inside the socket', async () => {
  const { client, sockets, executed } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  sockets[0].receive('not json at all');
  sockets[0].receive('{}');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(executed, []);
});

test('send refuses before ready, so a stored completion cannot race the handshake', () => {
  const { client, sockets } = harness();
  client.start();
  sockets[0].open();

  assert.equal(client.isReady(), false);
  assert.equal(client.send(JSON.stringify({ type: 'complete', commandId: 'x' })), false);
});

// The reconnect path is the one that matters for correctness: a completion stored
// just before a drop is owed, and the reconnected socket is the only place it fits.

test('a stored completion goes out on the reconnected socket once the bridge is ready again', () => {
  const { client, sockets, timers } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  sockets[0].drop();
  timers[0].fn();
  sockets[1].open();
  sockets[1].receive(JSON.stringify({ type: 'ready' }));

  assert.equal(client.send(JSON.stringify({ type: 'complete', commandId: 'c-lost' })), true);

  const last = JSON.parse(sockets[1].sent[sockets[1].sent.length - 1]);
  assert.equal(last.type, 'complete');
  assert.equal(last.commandId, 'c-lost');
});

// Commands must run one at a time in the order they arrived. The push transport
// makes this easy to get wrong: an async message handler starts the next command
// the instant the previous one awaits something, and two browser actions then
// fight over the same tab with nothing left to report either result.

test('a command that is still running blocks the next one, so work stays ordered', async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { client, sockets } = harness({
    execute: async (command) => {
      order.push(`start:${command.id}`);
      if (command.id === 'first') await gate;
      order.push(`end:${command.id}`);
      return { ok: true, result: {} };
    }
  });

  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'first', method: 'page.key' } }));
  await new Promise((r) => setImmediate(r));
  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'second', method: 'page.key' } }));
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(order, ['start:first'], 'the second command started before the first finished');

  release();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
});

test('a dropped socket keeps the work it already took, so a completion is not lost', async () => {
  const executed = [];
  const { client, sockets, timers } = harness({
    execute: async (command) => {
      executed.push(command.id);
      return { ok: true, result: {} };
    }
  });

  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'lost', method: 'page.key' } }));
  await new Promise((r) => setImmediate(r));

  sockets[0].drop();
  timers[0].fn();
  sockets[1].open();
  sockets[1].receive(JSON.stringify({ type: 'ready' }));
  await new Promise((r) => setImmediate(r));

  assert.ok(executed.includes('lost'), 'work taken before the drop was thrown away');
});

test('stop ends a drain that is already running, so queued work is not run for a stopped device', async () => {
  const executed = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { client, sockets } = harness({
    execute: async (command) => {
      executed.push(command.id);
      if (command.id === 'running') await gate;
      return { ok: true, result: {} };
    }
  });

  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'running', method: 'page.key' } }));
  await new Promise((r) => setImmediate(r));
  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'queued', method: 'page.key' } }));
  await new Promise((r) => setImmediate(r));

  client.stop();
  release();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(executed, ['running'], 'a stopped device went on to run work it had already been given');
});

// A socket that dies leaves a number behind, and today nothing records it. A
// device that reconnects forever with no reason in any log is indistinguishable
// from a device that is working, which is the one failure this transport cannot
// afford.

test('a dropped socket says why, so a reconnect loop is not silent', () => {
  const { client, sockets, states } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  sockets[0].drop(1011, 'service restarting');

  const dropped = states.filter((s) => s.status === 'reconnecting').pop();
  assert.ok(dropped, 'the close carried no reason at all');
  assert.equal(dropped.code, 1011);
  assert.match(dropped.reason || '', /./, 'a numeric code with no text is still no explanation');
});

// A keepalive only proves the bridge can still write. Observed live: a device
// socket held for twenty minutes across an edge instance being replaced, still
// receiving pings, with a change subscription that had died with the old instance.
// Nothing looked wrong, so nothing reconnected. The device has to answer, so the
// bridge can tell an open socket from a dead one.

test('a ping is answered, because a one-way keepalive cannot detect a dead bridge', () => {
  const { client, sockets } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  const before = sockets[0].sent.length;

  sockets[0].receive(JSON.stringify({ type: 'ping', serverTime: '2026-10-12T00:00:00.000Z' }));

  const reply = sockets[0].sent.slice(before).map((text) => JSON.parse(text));
  assert.equal(reply.length, 1, 'the device read a keepalive and said nothing back');
  assert.equal(reply[0].type, 'pong');
});

// A socket whose peer has vanished leaves nothing to react to. Observed live: a
// device reported ready for nineteen minutes on a connection whose far end had
// been replaced, because the zombie TCP connection was never closed and no ping
// ever came. Every signal read healthy and no command ever arrived. The only
// remaining evidence is time, so the device takes its own deadline.

// Each watchdog tick schedules the next one, so the queue grows as it is drained
// and only the last entry is live. Iterating the whole array would never end,
// which is a lesson the first version of this test learned the hard way.

test('a socket that stops hearing anything is torn down and replaced', () => {
  const time = trackTime();
  const env = harness({ now: () => time.now });
  const { client, sockets } = env;
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  assert.equal(client.isReady(), true);

  runTicks(env, time, 10);

  assert.ok(sockets.length >= 2, 'a silent socket was never replaced');
  assert.equal(client.isReady(), false, 'the device still believes a dead peer is ready');
});

test('a ping from the bridge is proof the peer is alive, so the deadline resets', () => {
  const time = trackTime();
  const env = harness({ now: () => time.now });
  const { client, sockets } = env;
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  for (let round = 0; round < 4; round += 1) {
    runTicks(env, time, 4, 5000);
    sockets[sockets.length - 1].receive(JSON.stringify({ type: 'ping', serverTime: 'now' }));
  }

  assert.equal(sockets.length, 1, 'a device that keeps hearing from the bridge was still replaced');
  assert.equal(client.isReady(), true);
});

// The mapping from socket events to reported connection state is the one piece of
// the transport that used to be untestable, and it hid a crash: a bare `retryMs`
// with no binding threw the first time onState fired, which killed start() before
// the socket opened and left the device at "connecting" forever with no error.
// Every branch below is a state the popup has to render, so every branch is
// stated.

test('a connected socket reports ready and stamps the moment it connected', () => {
  assert.deepEqual(connectionPatch({ status: 'connected' }, '2026-10-12T00:00:00.000Z'), {
    status: 'ready',
    lastConnectedAt: '2026-10-12T00:00:00.000Z',
    lastError: null
  });
});

test('an error frame reports only its message, because the socket it arrived on is alive', () => {
  const patch = connectionPatch({ status: 'error', message: 'Dispatch failed.' }, 'stamp');
  assert.equal(patch.lastError, 'Bridge: Dispatch failed.');
  assert.equal(patch.status, undefined, 'an error frame must not rewrite the connection status');
  assert.equal(patch.lastConnectedAt, undefined, 'an error is not a fresh connection');
});

test('a rejected handshake says the bridge refused this device, not a code', () => {
  const patch = connectionPatch({ status: 'rejected', code: 4001, reason: 'unauthorized' }, 'stamp');
  assert.equal(patch.status, 'rejected');
  assert.equal(patch.lastError, 'Bridge refused this device.');
});

test('a dropped socket carries its reason into the reported state', () => {
  const patch = connectionPatch({ status: 'reconnecting', code: 1006, reason: '' }, 'stamp');
  assert.equal(patch.status, 'reconnecting');
  assert.match(patch.lastError, /1006/);
});

test('a stale socket reports reconnecting, because a new socket is already opening', () => {
  const patch = connectionPatch({ status: 'stale', silenceMs: 61400 }, 'stamp');
  assert.equal(patch.status, 'reconnecting');
  assert.match(patch.lastError, /61400/);
});

test('a fresh attempt never erases why the previous one ended', () => {
  const patch = connectionPatch({ status: 'connecting' }, 'stamp');
  assert.equal(patch.status, 'connecting');
  assert.equal('lastError' in patch, false,
    'connecting clears the error, so a reconnect cycle reports nothing');
});

// WHY a close is never sent twice. Observed live on the extension errors page:
// "Close received after close", raised from the send path when the client closed
// a socket the bridge was already closing. Chromium logs that to the errors page
// even though it is caught, so every user sees it. Closing a socket that is
// already closing answers nothing and reports an error for free.

test('tearing down a socket the peer is already closing sends no second close', () => {
  const time = trackTime();
  const env = harness({ now: () => time.now });
  const { client, sockets } = env;
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  sockets[0].peerClosing();

  runTicks(env, time, 10);

  assert.equal(sockets[0].closes, 0, 'a close was sent on a socket already closing');
  assert.ok(sockets.length >= 2, 'the dead socket was kept because its close was skipped');
});

test('stop does not close a socket that is already closed', () => {
  const { client, sockets } = harness();
  client.start();
  sockets[0].open();
  sockets[0].drop();

  client.stop();

  assert.equal(sockets[0].closes, 0, 'stop closed an already closed socket');
});

// WHY the socket recycles itself on a timer. Edge isolates have a hard wall clock
// limit — about 150 seconds here — and waitUntil only prevents early retirement,
// never extends it. Observed live as code 1006 at a metronomic 151 seconds after
// waitUntil fixed the 76-second EarlyDrop deaths. Recycling on our own schedule,
// and only when idle, turns a surprise kill mid-anything into a routine reconnect
// nothing ever notices.

test('an idle socket past its age is replaced before the platform kills it', () => {
  const time = trackTime();
  const env = harness({ now: () => time.now });
  const { client, sockets, states } = env;
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  for (let tick = 0; tick < 14; tick += 1) {
    sockets[sockets.length - 1].receive(JSON.stringify({ type: 'ping', serverTime: 'now' }));
    runTicks(env, time, 1);
  }

  assert.ok(sockets.length >= 2, 'an aged socket was never recycled');
  assert.ok(states.some((s) => s.status === 'recycling'), 'the recycle reported no reason');
  assert.equal(sockets[0].closes, 1, 'the old socket was abandoned, not closed cleanly');

  const replacement = sockets[sockets.length - 1];
  replacement.open();
  const hello = JSON.parse(replacement.sent[0]);
  assert.equal(hello.type, 'hello', 'the replacement never handshaked');
});

test('a socket past its age keeps serving while a command is running', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const executed = [];
  const time = trackTime();
  const env = harness({
    now: () => time.now,
    execute: async (command) => {
      executed.push(command.id);
      await gate;
      return { ok: true, result: {} };
    }
  });
  const { client, sockets } = env;
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  sockets[0].receive(JSON.stringify({ type: 'command', command: { id: 'long', method: 'page.read' } }));
  await new Promise((r) => setImmediate(r));

  for (let tick = 0; tick < 14; tick += 1) {
    sockets[sockets.length - 1].receive(JSON.stringify({ type: 'ping', serverTime: 'now' }));
    runTicks(env, time, 1);
  }

  assert.equal(sockets.length, 1, 'a running command was interrupted for a recycle');

  release();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  runTicks(env, time, 1);

  assert.ok(sockets.length >= 2, 'the overdue socket was kept after its command finished');
  assert.deepEqual(executed, ['long']);
});

test('a recycled socket reports reconnecting with no error, because nothing failed', () => {
  const patch = connectionPatch({ status: 'recycling', ageMs: 121000 }, 'stamp');
  assert.equal(patch.status, 'reconnecting');
  assert.equal(patch.lastError, null);
});

test('stop leaves nothing running, so a paused worker does not keep a socket alive', () => {
  const { client, sockets, states } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  client.stop();
  assert.ok(states.some((s) => s.status === 'stopped'));
  assert.equal(client.isOpen(), false);
  assert.equal(client.isReady(), false);
});