// @last-edited: 2026-11-14 UTC+7.
// @title: device-switch - the pinned browser answers tab-less commands until another pin says otherwise.
// @state: the pin, the clear, the loud refusal, and the door's validation, each proven against two scripted devices over real sockets.
// @dependencies: node:test, strict, ../local/bridge-ws.js, ./helpers/scripted-device.mjs, ../extension/lib/socket-protocol.js.

// WHY THIS FILE EXISTS

// Tab-less commands used to follow the first ready browser, so an agent asked to drive Brave typed into Chrome whenever both were up.
// The pin is the answer: a person names the browser, every tab-less command follows it until another pin says otherwise, and a missing pin is refused by name instead of falling back into the wrong signed-in profile.
// Tab-scoped commands never consult the pin; a tab id already names its browser, so a drive never jumps mid-drive.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../../local/bridge-ws.js';
import { fakeCloud } from '../helpers/fake-cloud.mjs';
import { createScriptedDevice } from '../helpers/scripted-device.mjs';

process.env.OPERA_BRIDGE_PORT = '0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slotOf = (id) => Math.floor(Number(id) / 10000000000);

test('a pinned browser answers tab-less commands until the pin is cleared', async () => {
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chrome = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-chrome',
    deviceName: 'ChromeBox',
    handle: (command) => command.method === 'tabs.list'
      ? [{ id: 3, url: 'https://chrome/', title: 'Chrome' }]
      : { method: command.method, where: 'chrome' }
  });
  await chrome.connected;
  const brave = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-brave',
    deviceName: 'BraveBox',
    handle: (command) => command.method === 'tabs.list'
      ? [{ id: 3, url: 'https://brave/', title: 'Brave' }]
      : { method: command.method, where: 'brave' }
  });
  await brave.connected;
  await sleep(50);

  // Connected in order, so the slots are deterministic: chrome is slot 1, brave slot 2.
  const health0 = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health0.preferredSlot, null, 'no pin starts unset');

  const first = await bridge.send('tabs.open', { url: 'https://example.com/' }, { timeoutMs: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.result.where, 'chrome', 'the first ready browser answers when nothing is pinned');

  // Pin Brave by its device name; the answer names the slot it chose.
  const pin = await fetch(`http://127.0.0.1:${port}/prefer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceName: 'BraveBox' })
  }).then((response) => response.json());
  assert.equal(pin.ok, true);
  assert.equal(pin.preferred, 2, 'Brave was handshaken second, so slot 2');
  assert.equal(pin.device.deviceName, 'BraveBox');

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.preferredSlot, 2, 'the health answer carries the pin');

  const pinned = await bridge.send('tabs.open', { url: 'https://example.com/' }, { timeoutMs: 2000 });
  assert.equal(pinned.ok, true);
  assert.equal(pinned.result.where, 'brave', 'tab-less commands follow the pin');

  chrome.seen.length = 0;
  brave.seen.length = 0;
  const cdp = await bridge.send('cdp', { tabId: 10000000003, method: 'Page.getLayoutMetrics' }, { timeoutMs: 2000 });
  assert.equal(cdp.ok, true);
  assert.equal(chrome.seen.filter((frame) => frame.method === 'cdp').length, 1, 'the tab names its own browser');
  assert.equal(brave.seen.filter((frame) => frame.method === 'cdp').length, 0, 'the pin did not steal a tab-scoped command');

  // Clear the pin; the first ready browser answers again.
  const cleared = await fetch(`http://127.0.0.1:${port}/prefer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slot: null })
  }).then((response) => response.json());
  assert.equal(cleared.ok, true);
  assert.equal(cleared.preferred, null);

  const back = await bridge.send('tabs.open', { url: 'https://example.com/' }, { timeoutMs: 2000 });
  assert.equal(back.result.where, 'chrome', 'clearing the pin restores the first ready browser');

  await chrome.stop();
  await brave.stop();
  await bridge.close();
});

test('a pin whose browser is not awake is refused loudly, naming the awake ones', async () => {
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chrome = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-chrome',
    deviceName: 'ChromeBox',
    handle: (command) => command.method === 'tabs.list' ? [{ id: 3, url: 'https://chrome/', title: 'Chrome' }] : { method: command.method, where: 'chrome' }
  });
  const brave = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-brave',
    deviceName: 'BraveBox',
    handle: (command) => command.method === 'tabs.list' ? [{ id: 3, url: 'https://brave/', title: 'Brave' }] : { method: command.method, where: 'brave' }
  });
  await Promise.all([chrome.connected, brave.connected]);
  await sleep(50);

  const pin = await fetch(`http://127.0.0.1:${port}/prefer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slot: 2 })
  }).then((response) => response.json());
  assert.equal(pin.ok, true);

  await brave.stop();
  await sleep(120);

  const refused = await bridge.send('tabs.open', { url: 'https://example.com/' }, { timeoutMs: 2000 });
  assert.equal(refused.ok, false, 'the pinned browser is gone; the command is refused');
  assert.equal(refused.error.code, 'PREFERRED_DEVICE_NOT_READY');
  assert.match(refused.error.message, /awake:/);
  assert.match(refused.error.message, /"any"/);

  const cleared = await fetch(`http://127.0.0.1:${port}/prefer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceName: 'ChromeBox' })
  }).then((response) => response.json());
  assert.equal(cleared.ok, true);
  const back = await bridge.send('tabs.open', { url: 'https://example.com/' }, { timeoutMs: 2000 });
  assert.equal(back.ok, true);
  assert.equal(back.result.where, 'chrome', 'switching to an awake browser takes effect immediately');

  await chrome.stop();
  await bridge.close();
});

test('the preference door refuses what it cannot pin, and names the awake browsers', async () => {
  const bridge = createBridgeServer({ cloud: fakeCloud(), port: 0, heartbeatMs: 1000 });
  await bridge.listen();
  const { port } = bridge.address();

  const chrome = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'browser-chrome',
    deviceName: 'ChromeBox',
    handle: () => [{ id: 3, url: 'https://chrome/', title: 'Chrome' }]
  });
  await chrome.connected;
  await sleep(50);

  const missing = await fetch(`http://127.0.0.1:${port}/prefer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slot: 7 })
  }).then((response) => response.json());
  assert.equal(missing.ok, false, 'a pin on an absent slot is refused');
  assert.match(missing.error.message, /not awake/);

  const unknown = await fetch(`http://127.0.0.1:${port}/prefer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceName: 'NoSuchBrowser' })
  }).then((response) => response.json());
  assert.equal(unknown.ok, false, 'a pin on an unknown name is refused');
  assert.match(unknown.error.message, /awake:/);

  const malformed = await fetch(`http://127.0.0.1:${port}/prefer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slot: 'lots' })
  });
  assert.equal(malformed.status, 400, 'a slot that is not a number is rejected outright');

  await chrome.stop();
  await bridge.close();
});
