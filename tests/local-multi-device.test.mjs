// @last-edited: 2026-11-09 UTC+7.
// @title: multi-device-bridge — two browsers on one machine, carried at once, addressed apart.
// @state: the merged list, the routed CDP call, and the health report, each proven against two scripted devices over real sockets.
// @dependencies: node:test, strict, ../local/bridge-ws.js, ../extension/lib/socket-protocol.js.

// WHY THIS FILE EXISTS

// Chrome and Brave on one machine used to fight over one device slot, so the second browser was closed out and the first was told nothing about it.
// The bridge now keeps every browser it is given, hands each a numeric namespace, and carries each command to the browser that owns the target it names.
// A namespace cannot collide because the slot rides in the upper digits of a decimal number, while the browser's own tab ids never exceed a million.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../local/bridge-ws.js';
import { completionFrame, handshakeFrame, normalizeCommand, pongFrame } from '../extension/lib/socket-protocol.js';

process.env.OPERA_BRIDGE_PORT = '0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WHY THE SCRIPTED DEVICE IS A REAL SOCKET.
// The claim worth pinning is routing, and routing cannot be shown by a stub: one command must leave the door and arrive at exactly one browser, carrying that browser's tab number, never the other's.

function scriptedDevice(url, handle, frames = []) {
  let socket = null;
  const connected = new Promise((resolve, reject) => {
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      socket.send(handshakeFrame('', 'scripted', `instance-${Math.random().toString(36).slice(2, 10)}`));
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => reject(new Error('the scripted device could not connect')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : String(event.data);
    let frame;
    try { frame = JSON.parse(text); } catch { return; }
    if (frame.type === 'ping') { socket.send(pongFrame()); return; }
    if (frame.type !== 'command') return;
    const command = normalizeCommand(frame);
    frames.push(command);
    Promise.resolve()
      .then(() => handle(command))
      .then((result) => { socket.send(completionFrame(command.id, true, result ?? null)); })
      .catch((error) => socket.send(completionFrame(command.id, false, null, { code: 'EXECUTION_ERROR', message: String(error) })));
  });
  return { frames, connected, close: () => { try { socket.close(); } catch {} } };
}

test('two browsers connect at once, and the merged list names both', async () => {
  const bridge = createBridgeServer({ port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chromeDevice = scriptedDevice(`ws://127.0.0.1:${port}`, () => [{ id: 3, url: 'https://chrome/', title: 'Chrome' }]);
  const braveDevice = scriptedDevice(`ws://127.0.0.1:${port}`, () => [{ id: 3, url: 'https://brave/', title: 'Brave' }]);
  await Promise.all([chromeDevice.connected, braveDevice.connected]);
  await sleep(50);

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.devices.length, 2, 'the bridge kept both browsers');
  assert.equal(new Set(health.devices.map((device) => device.slot)).size, 2, 'and gave them different slots');

  const answer = await bridge.send('tabs.list', {}, { timeoutMs: 2000 });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.length, 2, 'both browsers are in one list');
  assert.equal(new Set(answer.result.map((tab) => tab.id % 1000000000)).size, 1, 'both number their own tabs from the same start');
  assert.equal(new Set(answer.result.map((tab) => Math.floor(tab.id / 1000000000))).size, 2, 'and neither row can be mistaken for the other browser’s tab');

  chromeDevice.close();
  braveDevice.close();
  await bridge.close();
});

test('a command for one browser reaches only that browser, and carries its tab number', async () => {
  const bridge = createBridgeServer({ port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chromeFrames = [];
  const braveFrames = [];
  const chromeDevice = scriptedDevice(`ws://127.0.0.1:${port}`, (command) => {
    if (command.method === 'tabs.list') return [{ id: 3, url: 'https://chrome/', title: 'Chrome' }];
    return { method: command.method, tabId: command.params?.tabId ?? null };
  }, chromeFrames);
  const braveDevice = scriptedDevice(`ws://127.0.0.1:${port}`, (command) => {
    if (command.method === 'tabs.list') return [{ id: 3, url: 'https://brave/', title: 'Brave' }];
    return { method: command.method, tabId: command.params?.tabId ?? null };
  }, braveFrames);
  await Promise.all([chromeDevice.connected, braveDevice.connected]);
  await sleep(50);

  const answer = await bridge.send('tabs.list', {}, { timeoutMs: 2000 });
  const byTitle = new Map(answer.result.map((tab) => [tab.title, tab]));
  const brave = byTitle.get('Brave');
  assert.ok(brave, 'the list names the second browser');

  chromeFrames.length = 0;
  braveFrames.length = 0;
  const cdp = await bridge.send('cdp', { tabId: brave.id, method: 'Page.getLayoutMetrics' }, { timeoutMs: 2000 });
  assert.equal(cdp.ok, true);

  assert.equal(chromeFrames.filter((frame) => frame.method === 'cdp').length, 0, 'the first browser was not disturbed');
  const routed = braveFrames.find((frame) => frame.method === 'cdp');
  assert.equal(routed?.params?.tabId, 3, 'the second browser sees its own local tab id');

  chromeDevice.close();
  braveDevice.close();
  await bridge.close();
});
