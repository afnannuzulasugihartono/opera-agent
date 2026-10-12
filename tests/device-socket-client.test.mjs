// @last-edited: 2026-10-11 UTC+7.
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
import { createSocketClient } from '../extension/lib/socket-client.js';

class FakeSocket {
  static OPEN = 1;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.last = this;
  }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(data) { this.onmessage?.({ data }); }
  send(text) { this.sent.push(text); }
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
  const { client, sockets, watchTimers } = harness({ now: () => clock });
  let clock = 1000;
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));
  assert.equal(client.isReady(), true);

  for (let round = 0; round < 10; round += 1) {
    clock += 10000;
    watchTimers[watchTimers.length - 1].fn();
  }

  assert.ok(sockets.length >= 2, 'a silent socket was never replaced');
  assert.equal(client.isReady(), false, 'the device still believes a dead peer is ready');
});

test('a ping from the bridge is proof the peer is alive, so the deadline resets', () => {
  const { client, sockets, watchTimers } = harness({ now: () => clock });
  let clock = 1000;
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  for (let round = 0; round < 4; round += 1) {
    for (let tick = 0; tick < 4; tick += 1) {
      clock += 10000;
      watchTimers[watchTimers.length - 1].fn();
    }
    sockets[sockets.length - 1].receive(JSON.stringify({ type: 'ping', serverTime: 'now' }));
  }

  assert.equal(sockets.length, 1, 'a device that keeps hearing from the bridge was still replaced');
  assert.equal(client.isReady(), true);
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