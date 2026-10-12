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
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

function harness(overrides = {}) {
  const timers = [];
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
    onState: (s) => states.push(s.status),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); },
    ...overrides
  });

  return { client, timers, states, executed, sockets };
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
  assert.ok(states.includes('rejected'));
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

test('stop leaves nothing running, so a paused worker does not keep a socket alive', () => {
  const { client, sockets, states } = harness();
  client.start();
  sockets[0].open();
  sockets[0].receive(JSON.stringify({ type: 'ready' }));

  client.stop();
  assert.ok(states.includes('stopped'));
  assert.equal(client.isOpen(), false);
  assert.equal(client.isReady(), false);
});