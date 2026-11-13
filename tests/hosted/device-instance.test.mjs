// @last-edited: 2026-11-09 UTC+7.
// @title: device-instance — a browser keeps an identity, so a second browser is a second device.
// @state: the identity on the handshake, its absence tolerated, and the bridge naming the browser it heard.
// @dependencies: node:test, strict, ../extension/worker/instance-id.js, ../extension/lib/socket-protocol.js, ../hosted/functions/opera-agent-bridge/bridge-socket.ts, ../local/bridge-ws.js.

// WHY THIS FILE EXISTS

// Two browsers on one machine presented one device name, so the second pairing replaced the first browser's token and the first was refused on its next connection.
// The identity is the fact that tells them apart, and it has to survive both roads: the cloud socket that authenticates a device and the loopback socket that drives one.
// A build without it must still connect, because the extension that is already installed predates this field.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../../local/bridge-ws.js';
import { fakeCloud } from '../helpers/fake-cloud.mjs';
import { DEVICE_PROTOCOL_VERSION, handshakeFrame } from '../../extension/lib/socket-protocol.js';
import { handshakePayload } from '../../hosted/functions/opera-agent-bridge/bridge-socket.ts';
import { newInstanceId } from '../../extension/worker/instance-id.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a browser sends the identity it keeps with its handshake', () => {
  const frame = JSON.parse(handshakeFrame('token', 'opera', 'instance-a'));
  assert.equal(frame.type, 'hello');
  assert.equal(frame.instanceId, 'instance-a');
  assert.equal(frame.protocolVersion, DEVICE_PROTOCOL_VERSION);
});

test('a browser without an identity still handshakes', () => {
  const frame = JSON.parse(handshakeFrame('token', 'opera'));
  assert.equal('instanceId' in frame, false, 'an older build sends no identity rather than an empty one');
  assert.equal(frame.deviceName, 'opera');
});

test('the cloud handshake accepts a per-browser identity and bounds it', () => {
  const identity = handshakePayload({ token: 't', deviceName: 'opera', instanceId: '  instance-a  ' });
  assert.deepEqual(identity, { token: 't', deviceName: 'opera', instanceId: 'instance-a' });
  const long = handshakePayload({ token: 't', deviceName: 'opera', instanceId: 'x'.repeat(200) });
  assert.equal(long.instanceId.length, 64, 'the identity is bounded like every other handshake field');
  const absent = handshakePayload({ token: 't', deviceName: 'opera' });
  assert.deepEqual(absent, { token: 't', deviceName: 'opera' });
});

test('a generated identity is unique per call', () => {
  const seen = new Set(Array.from({ length: 50 }, () => newInstanceId()));
  assert.equal(seen.size, 50);
  for (const id of seen) assert.match(id, /^[A-Za-z0-9._:-]{8,64}$/);
});

test('the loopback bridge names the browser it heard, not only its socket', async () => {
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 500 });
  await bridge.listen();
  const { port } = bridge.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('the identity probe could not connect')), { once: true });
    });
    socket.send(handshakeFrame('', 'bridge', 'instance-a'));
    const deadline = Date.now() + 3000;
    while (!bridge.linked() && Date.now() < deadline) await sleep(20);
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
    assert.equal(health.deviceInstanceId, 'instance-a');
  } finally {
    try { socket.close(); } catch { }
    await bridge.close();
  }
});
