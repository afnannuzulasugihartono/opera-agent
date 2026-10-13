// @last-edited: 2026-10-13 UTC+7.
// @title: local-bridge — the local bridge end, proven against a scripted extension over loopback.
// @state: 5 locks; link wait, tab ops, CDP round trip, timeouts, teardown.
// @dependencies: node:test, strict, node:net, node:crypto, ../local/bridge.js, ../local/cdp.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';

import {
  bridgeAddress,
  closeBridge,
  closeBridgeTarget,
  connectBridgeTarget,
  listBridgeTargets,
  openBridgeTarget,
  waitForBridgeLink
} from '../local/bridge.js';
import { createCdpClient } from '../local/cdp.js';

process.env.OPERA_BRIDGE_PORT = '0';

function masked(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = randomBytes(4);
  const head = Buffer.alloc(payload.length < 126 ? 6 : 8);
  head[0] = 0x81;
  if (payload.length < 126) {
    head[1] = 0x80 | payload.length;
    mask.copy(head, 2);
  } else {
    head[1] = 0x80 | 126;
    head.writeUInt16BE(payload.length, 2);
    mask.copy(head, 4);
  }
  const body = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) body[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([head, body]);
}

async function fakeExtension(port, onRequest) {
  const socket = connect(port, '127.0.0.1');
  await new Promise((resolve) => socket.on('connect', resolve));
  const key = randomBytes(16).toString('base64');
  socket.write(
    `GET /bridge HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );
  await new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.indexOf('\r\n\r\n') >= 0) {
        socket.off('data', onData);
        resolve();
      }
    };
    socket.on('data', onData);
  });
  let tail = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    tail = Buffer.concat([tail, chunk]);
    for (;;) {
      if (tail.length < 2) return;
      const length = tail[1] & 0x7f;
      let head = 2;
      let size = length;
      if (length === 126) {
        if (tail.length < 4) return;
        size = tail.readUInt16BE(2);
        head = 4;
      } else if (length === 127) {
        if (tail.length < 10) return;
        size = Number(tail.readBigUInt64BE(2));
        head = 10;
      }
      if (tail.length < head + size) return;
      const text = tail.subarray(head, head + size).toString('utf8');
      tail = tail.subarray(head + size);
      void onRequest(JSON.parse(text), (reply) => socket.write(masked(JSON.stringify(reply))));
    }
  });
  return socket;
}

test('a session waits for its link instead of failing a slow extension', async () => {
  const { port } = await bridgeAddress();
  assert.equal(await waitForBridgeLink({ timeoutMs: 60 }), false);

  const socket = await fakeExtension(port, () => {});
  assert.equal(await waitForBridgeLink({ timeoutMs: 2000 }), true);

  socket.destroy();
  await closeBridge();
});

test('tab operations round-trip through the fake extension', async () => {
  const { port } = await bridgeAddress();
  const seen = [];
  const socket = await fakeExtension(port, (request, reply) => {
    seen.push(request);
    if (request.tabs?.op === 'list') reply({ id: request.id, result: [{ id: 7, url: 'https://x/', title: 'X' }] });
    if (request.tabs?.op === 'open') reply({ id: request.id, result: { id: 8, url: request.tabs.url, title: '' } });
    if (request.tabs?.op === 'close') reply({ id: request.id, result: { id: 8, closed: true } });
  });

  assert.deepEqual(await listBridgeTargets(), [{ id: 7, url: 'https://x/', title: 'X' }]);
  assert.equal((await openBridgeTarget('https://y/')).id, 8);
  assert.deepEqual(await closeBridgeTarget(8), { id: 8, closed: true });
  assert.ok(seen.every((r) => r.id !== undefined), 'every bridge message carries its id');

  socket.destroy();
  await closeBridge();
});

test('a CDP client drives through the bridge transport untouched', async () => {
  const { port } = await bridgeAddress();
  const seen = [];
  const socket = await fakeExtension(port, (request, reply) => {
    seen.push(request);
    reply({ id: request.id, result: { value: 42 } });
  });

  const transport = connectBridgeTarget(77);
  const cdp = createCdpClient(transport);
  const out = await cdp.send('Runtime.evaluate', { expression: '6*7' });

  assert.deepEqual(out, { value: 42 });
  assert.equal(seen[0].tab, 77);
  assert.equal(seen[0].method, 'Runtime.evaluate');
  cdp.close();

  socket.destroy();
  await closeBridge();
});

test('an extension error arrives as a CDP error on the same id', async () => {
  const { port } = await bridgeAddress();
  const socket = await fakeExtension(port, (request, reply) => {
    reply({ id: request.id, error: { message: 'No such tab' } });
  });

  const transport = connectBridgeTarget(99);
  const cdp = createCdpClient(transport);
  await assert.rejects(() => cdp.send('Page.bringToFront', {}), /No such tab/);
  cdp.close();

  socket.destroy();
  await closeBridge();
});

test('a silent link is dropped and the retry rides a fresh dial', async () => {
  const { port } = await bridgeAddress();
  let dials = 0;
  let answered = false;
  const dial = async () => {
    dials += 1;
    const socket = connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.on('connect', resolve));
    const key = randomBytes(16).toString('base64');
    socket.write(
      `GET /bridge HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );
    await new Promise((resolve) => {
      let buf = Buffer.alloc(0);
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.indexOf('\r\n\r\n') >= 0) {
          socket.off('data', onData);
          resolve();
        }
      };
      socket.on('data', onData);
    });
    let tail = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      tail = Buffer.concat([tail, chunk]);
      for (;;) {
        if (tail.length < 2) return;
        const length = tail[1] & 0x7f;
        if (tail.length < 2 + length) return;
        const text = tail.subarray(2, 2 + length).toString('utf8');
        tail = tail.subarray(2 + length);
        if (dials === 1) return;
        const request = JSON.parse(text);
        const payload = Buffer.from(JSON.stringify({ id: request.id, result: [{ id: 3, url: '', title: '' }] }), 'utf8');
        const mask = randomBytes(4);
        const head = Buffer.from([0x81, 0x80 | payload.length]);
        const body = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) body[i] = payload[i] ^ mask[i % 4];
        socket.write(Buffer.concat([head, mask, body]));
        answered = true;
      }
    });
    socket.on('close', () => {
      if (dials === 1) void dial();
    });
    return socket;
  };

  const first = await dial();
  const tabs = await listBridgeTargets({ timeoutMs: 500 });
  assert.deepEqual(tabs, [{ id: 3, url: '', title: '' }]);
  assert.equal(dials, 2, 'the silent first link is dropped and answered on the redial');
  assert.equal(answered, true);

  first.destroy();
  await closeBridge();
});

test('teardown settles the pending and drops the server', async () => {  const { port } = await bridgeAddress();
  const socket = await fakeExtension(port, () => {});

  const transport = connectBridgeTarget(1);
  const cdp = createCdpClient(transport);
  const hanging = cdp.send('Page.bringToFront', {});
  await closeBridge();
  await assert.rejects(() => hanging, /bridge closed/);
  assert.equal(await waitForBridgeLink({ timeoutMs: 60 }), false);

  socket.destroy();
  await closeBridge();
});
