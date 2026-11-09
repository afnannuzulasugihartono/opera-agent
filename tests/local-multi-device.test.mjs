// @last-edited: 2026-11-09 UTC+7.
// @title: multi-device-bridge — two browsers on one machine, carried at once, addressed apart.
// @state: the merged list, the routed CDP call, and the health report, each proven against two scripted devices over real sockets.
// @dependencies: node:test, strict, ../local/bridge-ws.js, ./helpers/scripted-device.mjs, ../extension/lib/socket-protocol.js.

// WHY THIS FILE EXISTS

// Chrome and Brave on one machine used to fight over one device slot, so the second browser was closed out and the first was told nothing about it.
// The bridge now keeps every browser it is given, hands each a numeric namespace, and carries each command to the browser that owns the target it names.
// A namespace cannot collide because the slot rides in the upper digits of a decimal number, while a Chromium build numbers tab ids across the whole 32-bit range; the stride is sized past that range, not past a comfortable guess.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../local/bridge-ws.js';
import { fakeCloud } from './helpers/fake-cloud.mjs';
import { createScriptedDevice } from './helpers/scripted-device.mjs';

process.env.OPERA_BRIDGE_PORT = '0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WHY BOTH DEVICES ARE STARTED AT ONCE.
// The race the old bridge lost was the second browser's arrival while the first held the slot; starting both together proves neither is closed out by the other connecting first.

test('two browsers connect at once, and the merged list names both', async () => {
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chrome = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-chrome',
    handle: () => [{ id: 3, url: 'https://chrome/', title: 'Chrome' }]
  });
  const brave = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-brave',
    handle: () => [{ id: 3, url: 'https://brave/', title: 'Brave' }]
  });
  await Promise.all([chrome.connected, brave.connected]);
  await sleep(50);

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.devices.length, 2, 'the bridge kept both browsers');
  assert.equal(new Set(health.devices.map((device) => device.slot)).size, 2, 'and gave them different slots');

  const answer = await bridge.send('tabs.list', {}, { timeoutMs: 2000 });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.length, 2, 'both browsers are in one list');
  assert.equal(new Set(answer.result.map((tab) => tab.id % 10000000000)).size, 1, 'both number their own tabs from the same start');
  assert.equal(new Set(answer.result.map((tab) => Math.floor(tab.id / 10000000000))).size, 2, 'and neither row can be mistaken for the other browser’s tab');

  await chrome.stop();
  await brave.stop();
  await bridge.close();
});

test('a browser that disconnects and reconnects keeps its namespaced tab ids', async () => {
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const once = async (instanceId, url) => {
    const device = createScriptedDevice({ url: `ws://127.0.0.1:${port}`, instanceId, handle: () => [{ id: 3, url, title: instanceId }] });
    await device.connected;
    await sleep(50);
    const answer = await bridge.send('tabs.list', {}, { timeoutMs: 2000 });
    await device.stop();
    await sleep(80);
    return answer.result.find((tab) => tab.url === url)?.id;
  };

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  const id1 = await once('browser-chrome', 'https://reconnect/');
  // After a fresh connection cycle, a fresh tab read should keep the same namespaced id because the slot map is keyed by instanceId.
  const id2 = await once('browser-chrome', 'https://reconnect/');
  assert.equal(id1, id2, 'the same browser keeps the same tab id across reconnects');

  await bridge.close();
});

test('a command for one browser reaches only that browser, and carries its tab number', async () => {
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chrome = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-chrome',
    handle: (command) => command.method === 'tabs.list'
      ? [{ id: 3, url: 'https://chrome/', title: 'Chrome' }]
      : { method: command.method, tabId: command.params?.tabId ?? null }
  });
  const brave = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-brave',
    handle: (command) => command.method === 'tabs.list'
      ? [{ id: 3, url: 'https://brave/', title: 'Brave' }]
      : { method: command.method, tabId: command.params?.tabId ?? null }
  });
  await Promise.all([chrome.connected, brave.connected]);
  await sleep(50);

  const answer = await bridge.send('tabs.list', {}, { timeoutMs: 2000 });
  const byTitle = new Map(answer.result.map((tab) => [tab.title, tab]));
  const braveTarget = byTitle.get('Brave');
  assert.ok(braveTarget, 'the list names the second browser');

  chrome.seen.length = 0;
  brave.seen.length = 0;
  const cdp = await bridge.send('cdp', { tabId: braveTarget.id, method: 'Page.getLayoutMetrics' }, { timeoutMs: 2000 });
  assert.equal(cdp.ok, true);

  assert.equal(chrome.seen.filter((frame) => frame.method === 'cdp').length, 0, 'the first browser was not disturbed');
  const routed = brave.seen.find((frame) => frame.method === 'cdp');
  assert.equal(routed?.params?.tabId, 3, 'the second browser sees its own local tab id');

  await chrome.stop();
  await brave.stop();
  await bridge.close();
});

test('a 32-bit tab id from a real Chromium build round trips without crossing the namespace', async () => {
  // WHY THIS TEST EXISTS Chrome and Brave mint tab ids that fill a 32-bit int now; a namespace stride that sits inside that range makes every routed id ambiguous, and the drive blackholes every per-tab command.
  const BIG = 1517047131;
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chrome = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-chrome',
    handle: (command) => command.method === 'tabs.list'
      ? [{ id: BIG, url: 'https://big/', title: 'Big' }]
      : { method: command.method, tabId: command.params?.tabId ?? null }
  });
  await chrome.connected;
  await sleep(50);

  const listed = await bridge.send('tabs.list', {}, { timeoutMs: 2000 });
  assert.equal(listed.result[0].id, 10000000000 + BIG, 'the stride clears the whole 32-bit range');

  chrome.seen.length = 0;
  const cdp = await bridge.send('cdp', { tabId: listed.result[0].id, method: 'Page.getLayoutMetrics' }, { timeoutMs: 2000 });
  assert.equal(cdp.ok, true);
  const routed = chrome.seen.find((frame) => frame.method === 'cdp');
  assert.equal(routed?.params?.tabId, BIG, 'the raw tab id crosses the door with the namespace digits gone');

  await chrome.stop();
  await bridge.close();
});

test('two sockets from the same browser collapse to one device', async () => {
  // WHY THIS TEST EXISTS A browser that reconnects before its old socket is reaped was listed twice, and every caller that counts devices counted a phantom: the merged list returned the same tabs twice and the meter charged both sockets for one list.
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const dupe = () => createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-brave',
    handle: () => [{ id: 5, url: 'https://brave/', title: 'Brave' }]
  });
  const first = dupe();
  const second = dupe();
  await Promise.all([first.connected, second.connected]);
  await sleep(80);

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.devices.length, 1, 'one browser, one row');
  assert.equal(health.devices[0].instanceId, 'browser-brave');

  const answer = await bridge.send('tabs.list', {}, { timeoutMs: 2000 });
  assert.equal(answer.result.length, 1, 'the duplicate socket does not bill twice for one list');

  await first.stop();
  await second.stop();
  await bridge.close();
});
