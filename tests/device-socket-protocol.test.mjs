// @last-edited: 2026-10-13 UTC+7.
// @title: socket-protocol — the push protocol, checked without a socket, a bridge, or a browser.
// @state: 8 locks; handshake, runnable commands, completion frames, and what must be refused.
// @dependencies: node:test, strict, ../extension/lib/socket-protocol.js.

// WHY THIS FILE EXISTS

// This is the whole reason the protocol is a separate file.
// A WebSocket cannot be constructed in a unit test, so any rule written inside a socket callback is a rule nothing can check.
// Every decision here is a function over a string, which is what lets the refusal cases be stated at all.

// WHY the handshake is the load-bearing lock.
// The device will execute whatever arrives on this socket, so anything that runs before the bridge has confirmed the device is a way to run work for an unproven identity.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_PROTOCOL_VERSION,
  FRAME_MAX_BYTES,
  completionFrame,
  encodeCompletionFrame,
  handshakeFrame,
  isFatalClose,
  isReady,
  isRunnableCommand,
  normalizeCommand,
  parseFrame
} from '../extension/lib/socket-protocol.js';
import { MAX_RESULT_BYTES } from '../extension/lib/serialize.js';

test('the handshake carries the token and the device name the bridge verifies', () => {
  const frame = JSON.parse(handshakeFrame('secret-token', 'opera'));
  assert.equal(frame.type, 'hello');
  assert.equal(frame.token, 'secret-token');
  assert.equal(frame.deviceName, 'opera');
  assert.equal(frame.protocolVersion, DEVICE_PROTOCOL_VERSION);
});

test('a completion reports success without an error key, or a reader cannot tell which won', () => {
  const frame = JSON.parse(completionFrame('c-1', true, { ok: true }));
  assert.equal(frame.ok, true);
  assert.equal(frame.error, undefined);
});

test('a failed completion always carries an error, so a failure is never a silent success', () => {
  const frame = JSON.parse(completionFrame('c-2', false, null, {
    code: 'BOOM',
    message: 'no'
  }));
  assert.equal(frame.ok, false);
  assert.equal(frame.result, undefined);
  assert.equal(frame.error.code, 'BOOM');
});

test('a command is only runnable with an id and a method, because both are needed to act', () => {
  assert.equal(isRunnableCommand({
    type: 'command',
    command: {
      id: 'a',
      method: 'browser.ping'
    }
  }), true);
  assert.equal(isRunnableCommand({
    type: 'command',
    command: { method: 'browser.ping' }
  }), false);
  assert.equal(isRunnableCommand({
    type: 'command',
    command: { id: 'a' }
  }), false);
  assert.equal(isRunnableCommand({
    type: 'command',
    command: {
      id: '',
      method: 'a'
    }
  }), false);
});

test('a non-command frame is never runnable, so an ack or an error cannot execute anything', () => {
  assert.equal(isRunnableCommand({ type: 'ready' }), false);
  assert.equal(isRunnableCommand({
    type: 'ack',
    command: {
      id: 'a',
      method: 'browser.ping'
    }
  }), false);
  assert.equal(isRunnableCommand(null), false);
});

test('a command arrives with params defaulted and a timeout that cannot be zero or negative', () => {
  const bare = normalizeCommand({
    type: 'command',
    command: {
      id: 'a',
      method: 'browser.ping'
    }
  });
  assert.deepEqual(bare.params, {});
  assert.equal(bare.timeoutMs, 30000);

  const given = normalizeCommand({
    type: 'command',
    command: {
      id: 'b',
      method: 'page.key',
      params: { key: 'a' },
      timeoutMs: 9000
    }
  });
  assert.deepEqual(given.params, { key: 'a' });
  assert.equal(given.timeoutMs, 9000);

  const bad = normalizeCommand({
    type: 'command',
    command: {
      id: 'c',
      method: 'x',
      timeoutMs: -5
    }
  });
  assert.equal(bad.timeoutMs, 30000);
});

test('only the ready frame unlocks work, because an open socket has not proven the device', () => {
  assert.equal(isReady({ type: 'ready' }), true);
  assert.equal(isReady({ type: 'command' }), false);
  assert.equal(isReady(null), false);
});

test('only an unauthorized handshake is fatal, because a timeout is answered by one retry', () => {
  assert.equal(isFatalClose(4001), true);
  assert.equal(isFatalClose(4002), false);
  assert.equal(isFatalClose(1006), false);
});

// The device parses what the bridge sends, and the bridge answers within the same bound, so the device cap carries the same proof as the bridge side: a lawful completion near the product bound must parse.

test('a frame near the product bound parses on the device side too', () => {
  assert.ok(FRAME_MAX_BYTES >= MAX_RESULT_BYTES * 1.5);
  const frame = JSON.stringify({
    type: 'command',
    command: {
      id: 'cmd-big',
      method: 'page.read',
      params: { blob: 'y'.repeat(400 * 1024) }
    }
  });
  assert.equal(parseFrame(frame).ok, true);
});

// WHY completions compress.
// A page.read result runs to hundreds of kilobytes, and on a slow link the transfer dwarfs everything else — measured: an 88 KiB read completed in 1914 ms against ~600 ms of fixed costs.
// gzip shrinks page JSON five to fifty times, so a big completion travels as one small binary frame instead.
// Small completions stay text: readable in logs, and the few hundred bytes saved are not worth a second code path per message.

test('a small completion stays a text frame', async () => {
  const frame = await encodeCompletionFrame('c-1', true, { ok: true }, null);
  assert.equal(typeof frame, 'string');
  assert.equal(JSON.parse(frame).commandId, 'c-1');
});

test('a large completion becomes a versioned gzip frame', async () => {
  const frame = await encodeCompletionFrame('c-2', true, { blob: 'civil-engineering-semantic-reader '.repeat(3000) }, null);
  assert.ok(frame instanceof Uint8Array, 'large completions must leave as binary');
  assert.equal(frame[0], 1, 'first byte is the frame version');
  assert.ok(frame.length < 20000, `98 KiB of text must shrink, got ${frame.length} bytes`);
});

test('a runtime without compression still sends text, never throws', async () => {
  const real = globalThis.CompressionStream;
  globalThis.CompressionStream = undefined;
  try {
    const frame = await encodeCompletionFrame('c-3', true, { blob: 'y'.repeat(100000) }, null);
    assert.equal(typeof frame, 'string');
  } finally {
    globalThis.CompressionStream = real;
  }
});
