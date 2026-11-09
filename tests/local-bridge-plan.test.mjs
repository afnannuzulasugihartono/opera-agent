// @last-edited: 2026-11-09 UTC+7.
// @title: local-bridge-plan.test — the meter in the loopback bridge: refuse when the cloud cannot answer, enforce the allowance, report at the end.
// @state: an unaccounted session is refused, the allowance refuses the command past it, the ping proof pays nothing, and the report lands once when the session ends.
// @dependencies: node:test, strict, ../local/bridge-ws.js, ./helpers/scripted-device.mjs, ./helpers/fake-cloud.mjs.

// WHY THIS FILE EXISTS

// The drive is local, but the meter is not: a session that cannot reach the cloud is a session no plan authorises.
// The bridge asks once per session, counts locally, refuses past the allowance with the plan named, and reports the usage when the session ends.
// Every assertion below runs against a real socket with an in-process cloud, so the meter itself is what is under test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer, createCloudMeter } from '../local/bridge-ws.js';
import { createScriptedDevice } from './helpers/scripted-device.mjs';
import { fakeCloud, pilotSession } from './helpers/fake-cloud.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WHY THE RACE.
// A bridge that never refuses a session never closes the socket, and a test that waits for the close would hang the file instead of failing it.
// Bounded waits fail with the reason, which is the point of a red run.

const waitFor = (promise, ms, what) => Promise.race([
  promise,
  sleep(ms).then(() => { throw new Error(`timed out waiting for ${what}`); })
]);

async function startBridge({ cloud, heartbeatMs = 1000 } = {}) {
  const bridge = createBridgeServer({ port: 0, heartbeatMs, cloud });
  await bridge.listen();
  return { bridge, ...bridge.address() };
}

test('a session the cloud cannot reach is refused, and the refusal names the meter', async () => {
  const cloud = fakeCloud({ open: new Error('fetch failed') });
  const { bridge, port } = await startBridge({ cloud });
  const device = createScriptedDevice({ url: `ws://127.0.0.1:${port}`, instanceId: 'no-cloud' });
  await device.connected;

  const close = await waitFor(device.closed, 1500, 'the refused device to close');
  assert.equal(close.code, 4001, 'the fatal close stops the extension retrying a meter it cannot pay');
  const error = device.events.find((frame) => frame.type === 'error');
  assert.match(String(error?.error ?? ''), /meter/i, 'the refusal message names the meter');

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.linked, false, 'an unaccounted session never becomes a ready device');
  assert.match(String(health.meterRefusal ?? ''), /meter/i, 'the health report carries the refusal');

  await bridge.close();
});

test('a session the cloud refuses because the day is spent never becomes ready', async () => {
  const spentDay = { ok: false, message: "today's quota of 200 commands for plan.pilot is used; resets tomorrow" };
  const cloud = fakeCloud({ open: spentDay });
  const { bridge, port } = await startBridge({ cloud });
  const device = createScriptedDevice({ url: `ws://127.0.0.1:${port}`, instanceId: 'spent-day' });
  await device.connected;

  const close = await waitFor(device.closed, 1500, 'the refused device to close');
  assert.equal(close.code, 4001);
  const error = device.events.find((frame) => frame.type === 'error');
  assert.match(String(error?.error ?? ''), /plan.pilot/);
  assert.match(String(error?.error ?? ''), /200/);

  await bridge.close();
});

test('the allowance refuses the command past it, and names the plan', async () => {
  const cloud = fakeCloud({ open: pilotSession({ sessionAllowance: 2 }) });
  const { bridge, port } = await startBridge({ cloud });
  const device = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'allowance',
    handle: () => ({ read: 1 })
  });
  await device.connected;
  await sleep(50);

  const first = await bridge.send('page.read', { view: 'viewport' }, { timeoutMs: 2000 });
  const second = await bridge.send('page.read', { view: 'viewport' }, { timeoutMs: 2000 });
  const third = await bridge.send('page.read', { view: 'viewport' }, { timeoutMs: 2000 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false, 'the command past the allowance is refused');
  assert.equal(third.error?.code, 'PLAN_LIMIT_REACHED');
  assert.match(String(third.error?.message ?? ''), /plan.pilot/);
  assert.match(String(third.error?.message ?? ''), /2/);
  assert.equal(device.seen.filter((command) => command.method === 'page.read').length, 2, 'the device never saw the refused command');

  await device.stop();
  await bridge.close();
});

test('the ping proof is never metered, so proving a link cannot spend the allowance', async () => {
  const cloud = fakeCloud({ open: pilotSession({ sessionAllowance: 1 }) });
  const { bridge, port } = await startBridge({ cloud });
  const device = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    instanceId: 'ping-proof',
    handle: () => ({ read: 1 })
  });
  await device.connected;
  await sleep(50);

  const ping = await bridge.send('ping', {}, { timeoutMs: 2000 });
  assert.equal(ping.ok, true);
  const spent = await bridge.send('page.read', {}, { timeoutMs: 2000 });
  assert.equal(spent.ok, true);
  const pingAgain = await bridge.send('ping', {}, { timeoutMs: 2000 });
  assert.equal(pingAgain.ok, true, 'the proof answers even when the allowance is spent');

  await device.stop();
  await bridge.close();
});

test('the usage report lands once when the session ends, with the device credentials', async () => {
  const cloud = fakeCloud({ open: pilotSession({ sessionAllowance: 50 }) });
  const { bridge, port } = await startBridge({ cloud });
  const device = createScriptedDevice({
    url: `ws://127.0.0.1:${port}`,
    deviceName: 'meter-report',
    instanceId: 'report',
    handle: () => ({ read: 1 })
  });
  await device.connected;
  await sleep(50);

  await bridge.send('page.read', {}, { timeoutMs: 2000 });
  await bridge.send('page.read', {}, { timeoutMs: 2000 });
  await device.stop();
  await sleep(50);

  const reports = cloud.reports.filter((entry) => entry.phase === 'report');
  assert.equal(reports.length, 1, 'one report per session');
  assert.equal(reports[0].commands, 2, 'the report carries the counted commands');
  assert.equal(reports[0].deviceName, 'meter-report');
  assert.equal(typeof reports[0].token, 'string');

  await bridge.close();
  await sleep(50);
  assert.equal(cloud.reports.filter((entry) => entry.phase === 'report').length, 1, 'closing the bridge after the session ended reports nothing twice');
});

test('a fresh session that ran nothing reports nothing, so an idle browser never spends a round trip', async () => {
  const cloud = fakeCloud({ open: pilotSession() });
  const { bridge, port } = await startBridge({ cloud });
  const device = createScriptedDevice({ url: `ws://127.0.0.1:${port}`, instanceId: 'idle' });
  await device.connected;
  await sleep(50);

  await device.stop();
  await sleep(50);
  await bridge.close();
  await sleep(50);

  assert.equal(cloud.reports.filter((entry) => entry.phase === 'report').length, 0);
});

test('the cloud meter speaks exactly the two calls the cloud answers', async () => {
  const seen = [];
  const answer = pilotSession();
  const meter = createCloudMeter({
    url: 'http://cloud.invalid/',
    fetchImpl: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const opened = await meter.sessionOpen({ deviceName: 'meter-test', token: 't'.repeat(64) });
  assert.equal(opened.plan, 'plan.pilot');
  assert.equal(seen[0].body.action, 'session_open');
  assert.equal(seen[0].body.deviceName, 'meter-test');
  assert.equal(seen[0].body.token, 't'.repeat(64));
  const reported = await meter.sessionReport({ deviceName: 'meter-test', token: 't'.repeat(64), commands: 3 });
  assert.equal(seen[1].body.action, 'session_report');
  assert.equal(seen[1].body.commands, 3);
  assert.equal(reported.ok, true);
});

test('the cloud meter throws with the server words when the call is refused', async () => {
  const meter = createCloudMeter({
    url: 'http://cloud.invalid/',
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: 'Unauthorized device.' }), { status: 401 })
  });
  await assert.rejects(() => meter.sessionOpen({ deviceName: 'meter-test', token: 'x'.repeat(64) }), /Unauthorized device/);
});
