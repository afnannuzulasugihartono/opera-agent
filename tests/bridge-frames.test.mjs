// @last-edited: 2026-10-14 UTC+7.
// @title: bridge-frames.test — one protocol serves the loopback socket and the cloud socket.
// @state: unit pins the frame shapes and the heartbeat the loopback server sends.
// @dependencies: node:test, strict, ../extension/lib/socket-protocol.js.

// WHY ONE PROTOCOL FOR BOTH ROADS.
// The device already speaks frames: hello, ready, command, complete, ping, pong.
// The loopback server emits the same frames the cloud bridge emits, so the device runs one client and one drain instead of a socket road and a separate long-poll road with its own wedge, its own timeout, and its own failures.
// The heartbeat is what keeps an MV3 worker alive: a frame that asks nothing resets the idle timer, which is why the push road works where a silent socket did not.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handshakeFrame,
  completionFrame,
  pongFrame,
  parseFrame,
  isRunnableCommand,
  normalizeCommand
} from '../extension/lib/socket-protocol.js';

test('a hello frame carries the identity and the protocol version', () => {
  const parsed = parseFrame(handshakeFrame('tok', 'opera'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.type, 'hello');
  assert.equal(parsed.message.deviceName, 'opera');
  assert.equal(parsed.message.token, 'tok');
  assert.equal(typeof parsed.message.protocolVersion, 'number');
});

test('a complete frame states success or failure, never both', () => {
  const good = parseFrame(completionFrame('c1', true, { ok: true })).message;
  assert.equal(good.ok, true);
  assert.deepEqual(good.result, { ok: true });
  assert.equal(good.error, undefined);

  const bad = parseFrame(completionFrame('c1', false, null, {
    code: 'X',
    message: 'y'
  })).message;
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'X');
  assert.equal(bad.result, undefined);
});

test('a command frame is only runnable when it has an id and a method', () => {
  const runnable = {
    type: 'command',
    command: {
      id: 'c1',
      method: 'tabs.list'
    }
  };
  assert.equal(isRunnableCommand(runnable), true);
  assert.deepEqual(normalizeCommand(runnable).method, 'tabs.list');
  assert.equal(isRunnableCommand({
    type: 'command',
    command: { method: 'tabs.list' }
  }), false);
  assert.equal(isRunnableCommand({
    type: 'command',
    command: { id: 'c1' }
  }), false);
  assert.equal(isRunnableCommand({ type: 'pong' }), false);
  assert.equal(isRunnableCommand(null), false);
});

test('the heartbeat answers a ping so an idle worker never dies', () => {
  assert.deepEqual(JSON.parse(pongFrame()), { type: 'pong' });
});

test('an oversized or malformed frame is refused instead of parsed', () => {
  assert.equal(parseFrame('not json').ok, false);
  assert.equal(parseFrame(JSON.stringify({ type: 'command' }), 4).ok, false);
});
