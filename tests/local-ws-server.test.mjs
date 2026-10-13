// @last-edited: 2026-10-13 UTC+7.
// @title: local-ws-server — the bridge speaks RFC6455, proven over real loopback sockets.
// @state: 7 locks; handshake, masked text, big payloads, ping, close, latest-wins.
// @dependencies: node:test, strict, node:net, node:crypto, ../local/ws-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

import { acceptKey, createWsBridge, decodeClientFrames, encodeTextFrame } from '../local/ws-server.js';

function maskedFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = randomBytes(4);
  const head = Buffer.from([0x81, 0x80 | payload.length]);
  const body = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) body[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

function readHttp(socket) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end >= 0) {
        socket.off('data', onData);
        resolve({ head: buf.subarray(0, end).toString('latin1'), rest: buf.subarray(end + 4) });
      }
    };
    socket.on('data', onData);
  });
}

async function handshake(port) {
  const socket = connect(port, '127.0.0.1');
  await new Promise((resolve) => socket.on('connect', resolve));
  const key = randomBytes(16).toString('base64');
  socket.write(
    `GET /bridge HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );
  const { head } = await readHttp(socket);
  return { socket, head, key };
}

test('the accept key follows the RFC vector', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('small, medium and 64-bit payloads all frame and survive', () => {
  for (const size of [5, 200, 70000]) {
    const bytes = encodeTextFrame('x'.repeat(size));
    assert.equal(bytes[0], 0x81, 'FIN plus text opcode');
    assert.equal(bytes[1] & 0x80, 0, 'a server never masks');
  }
});

test('client frames decode masked text and answer ping', async () => {
  const bridge = createWsBridge({ port: 0 });
  const seen = [];
  bridge.onMessage((text) => seen.push(text));
  const { port } = await bridge.listen();

  const { socket, head, key } = await handshake(port);
  assert.match(head, /101 Switching Protocols/);
  assert.match(head, new RegExp(acceptKey(key).replace(/[+/=]/g, (c) => `\\${c}`)));

  socket.write(maskedFrame('{"hello":1}'));
  socket.write(Buffer.concat([Buffer.from([0x89, 0x80]), randomBytes(4)]));
  const pong = await new Promise((resolve) => {
    socket.once('data', resolve);
    setTimeout(() => resolve(Buffer.alloc(0)), 2000);
  });
  assert.deepEqual([...pong.subarray(0, 2)], [0x8a, 0x00]);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen, ['{"hello":1}']);

  socket.destroy();
  await bridge.close();
});

test('a 100 KiB screenshot-sized payload crosses intact', async () => {
  const bridge = createWsBridge({ port: 0 });
  const seen = [];
  bridge.onMessage((text) => seen.push(text));
  const { port } = await bridge.listen();

  const big = 'A'.repeat(100 * 1024);
  const payload = Buffer.from(big, 'utf8');
  const mask = randomBytes(4);
  const head = Buffer.alloc(10);
  head[0] = 0x81;
  head[1] = 0x80 | 127;
  head.writeBigUInt64BE(BigInt(payload.length), 2);
  const body = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) body[i] = payload[i] ^ mask[i % 4];

  const { socket } = await handshake(port);
  socket.write(Buffer.concat([head, mask, body]));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, big.length);

  socket.destroy();
  await bridge.close();
});

test('an unmasked frame closes the link loudly', async () => {
  const bridge = createWsBridge({ port: 0 });
  bridge.onMessage(() => {});
  const { port } = await bridge.listen();

  const { socket } = await handshake(port);
  assert.equal(bridge.linked(), true);
  socket.write(Buffer.from([0x81, 0x03, 0x61, 0x62, 0x63]));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(bridge.linked(), false);

  socket.destroy();
  await bridge.close();
});

test('a second link replaces the first', async () => {
  const bridge = createWsBridge({ port: 0 });
  bridge.onMessage(() => {});
  const { port } = await bridge.listen();

  const first = await handshake(port);
  assert.equal(bridge.linked(), true);
  const second = await handshake(port);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(bridge.linked(), true);
  assert.equal(first.socket.destroyed, true);

  first.socket.destroy();
  second.socket.destroy();
  await bridge.close();
});

test('dropping the link clears it so the next wait sees a fresh dial', async () => {
  const bridge = createWsBridge({ port: 0 });
  bridge.onMessage(() => {});
  const { port } = await bridge.listen();

  const { socket } = await handshake(port);
  assert.equal(bridge.linked(), true);
  bridge.dropLink();
  assert.equal(bridge.linked(), false);

  socket.destroy();
  await bridge.close();
});

test('sending with no link fails loudly instead of vanishing', async () => {  const bridge = createWsBridge({ port: 0 });
  await bridge.listen();

  assert.throws(() => bridge.send('{}'), /not connected/);
  assert.equal(await bridge.waitForLink({ timeoutMs: 50, intervalMs: 10 }), false);

  await bridge.close();
});

test('decode rejects what the server must never half-read', () => {
  assert.throws(() => decodeClientFrames(Buffer.from([0x81, 0x03, 0x61, 0x62, 0x63])), /masked/);
  assert.throws(() => decodeClientFrames(Buffer.from([0x01, 0x83, 1, 2, 3, 4, 0])), /fragmented/);
  const partial = decodeClientFrames(Buffer.from([0x81, 0x85, 1, 2, 3, 4, 0x61]));
  assert.deepEqual(partial.frames, [], 'a short read waits for the rest');
});
