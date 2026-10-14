// @last-edited: 2026-10-14 UTC+7.
// @title: bridge-server.test — the loopback server pushes, settles, and keeps the worker alive.
// @state: integration pins over a real socket pair on an ephemeral port.
// @dependencies: node:test, strict, node:http, ../local/bridge-server.js, ../extension/lib/socket-protocol.js.

// WHY A REAL SOCKET HERE. The frame codec is unit-pinned separately; what can
// only be proven over a real connection is the part that actually failed in
// production: a handshake that completes, a command that arrives the instant it
// is sent, a completion that settles the caller, and a heartbeat that keeps an
// otherwise idle worker from dying. A mock proves none of those.

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect as netConnect } from 'node:net';

import { createBridgeServer } from '../local/bridge-server.js';
import { acceptKey, encodeText } from '../local/ws-server.js';
import { parseFrame } from '../extension/lib/socket-protocol.js';

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1');
    const key = Buffer.from(`opera-${Date.now()}-${Math.random()}`).toString('base64');
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const queue = [];

    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write([
        'GET / HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', ''
      ].join('\r\n'));
    });
    socket.on('data', (incoming) => {
      let chunk = incoming;
      if (!upgraded) {
        buffer = Buffer.concat([buffer, chunk]);
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        upgraded = true;
        const head = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 4);
        chunk = Buffer.alloc(0);
        resolve({
          frames: queue,
          key,
          accepted: head.includes(acceptKey(key)),
          push: (text) => socket.write(encodeText(text)),
          close: () => socket.destroy()
        });
      }
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        const length = buffer[1] & 0x7f;
        const offset = length < 126 ? 2 : length === 126 ? 4 : 10;
        if (buffer.length < offset + length) return;
        const payload = buffer.subarray(offset, offset + length).toString('utf8');
        buffer = buffer.subarray(offset + length);
        queue.push({ ...parseFrame(payload), raw: payload });
      }
    });
  });
}

test('a handshake completes and a pushed command arrives without being asked for', async () => {
  const bridge = createBridgeServer({ port: 0, heartbeatMs: 50 });
  await bridge.listen();
  const port = bridge.address().port;
  const device = await connect(port);
  try {
    assert.equal(device.accepted, true, 'the browser-verified accept key came back');
    device.push(JSON.stringify({ type: 'hello', token: 't', deviceName: 'opera' }));

    const deadline = Date.now() + 2000;
    while (!bridge.linked() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.equal(bridge.linked(), true, 'the ready frame answered the hello');

    const pending = bridge.send('tabs.list', {}, { timeoutMs: 5000 });
    pending.catch(() => {});
    const commandAt = Date.now();
    while (!device.frames.some((f) => f.ok && f.message.type === 'command') && Date.now() < commandAt + 2000) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const seen = device.frames.map((f) => (f.ok ? f.message.type : `${f.error}:${f.raw}`));
    assert.ok(seen.includes('command'), `the command was pushed, not polled (saw ${seen.join(',')})`);
    const command = device.frames.find((f) => f.ok && f.message.type === 'command')?.message;
    assert.equal(command.command.method, 'tabs.list', 'the command arrived pushed, not polled');

    device.push(JSON.stringify({ type: 'complete', commandId: command.command.id, ok: true, result: { tabs: [] } }));
    const answer = await pending;
    assert.equal(answer.ok, true);
    assert.deepEqual(answer.result, { tabs: [] });
    assert.ok(answer.ms < 200, 'a loopback round trip is milliseconds, not the relay second');
  } finally {
    device.close();
    await bridge.close();
  }
});

test('an idle connection keeps receiving heartbeats so the worker never dies', async () => {
  const bridge = createBridgeServer({ port: 0, heartbeatMs: 40 });
  await bridge.listen();
  const port = bridge.address().port;
  const device = await connect(port);
  try {
    device.push(JSON.stringify({ type: 'hello', token: 't', deviceName: 'opera' }));
    const deadline = Date.now() + 2000;
    while (device.frames.filter((f) => f.ok && f.message.type === 'ping').length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const pings = device.frames.filter((f) => f.ok && f.message.type === 'ping').length;
    assert.ok(pings >= 2, `heartbeat frames arrived without being asked for (saw ${pings})`);
  } finally {
    device.close();
    await bridge.close();
  }
});

test('a device that never answers fails the caller instead of hanging forever', async () => {
  const bridge = createBridgeServer({ port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const port = bridge.address().port;
  const device = await connect(port);
  try {
    device.push(JSON.stringify({ type: 'hello', token: 't', deviceName: 'opera' }));
    const deadline = Date.now() + 2000;
    while (!bridge.linked() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(() => bridge.send('tabs.list', {}, { timeoutMs: 120 }), /no answer for tabs.list within 120 ms/);
  } finally {
    device.close();
    await bridge.close();
  }
});
