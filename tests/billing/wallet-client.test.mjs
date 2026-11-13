// @last-edited: 2026-11-04 UTC+7.
// @title: wallet-client — the local machine pairs once, then spends only what the server confirms.
// @state: the device file, the pairing refusal, and the body each call sends.
// @dependencies: node:test, node:assert/strict, node:fs, node:os, node:path, ../local/wallet-client.js.

// WHY THE BODY IS THE SUBJECT HERE.
// The server identifies the owner by the device it was given, so a client that forgets the device, or sends a session-shaped field instead, is a client the server refuses.
// The mapping from a readable call to the server's field names is also where a settle would quietly become a second charge if the reservation id were dropped.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pairDevice, readDevice, saveDevice, taskRefund, taskReserve, taskSettle, walletBalance, walletQuote, walletTopUp } from '../../local/wallet-client.js';
import { BILLING_URL, DEFAULT_BRIDGE_URL } from '../../extension/lib/endpoints.js';

const RESERVATION = '11111111-1111-1111-1111-111111111111';
const TOKEN = 'a'.repeat(64);

function home() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opera-wallet-'));
}

function fakeFetch(answer, status = 200) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: status < 400, status, json: async () => answer };
  };
  return { impl, calls };
}

test('a pairing that the server accepts writes the device file and keeps the token local', async () => {
  const dir = home();
  const { impl, calls } = fakeFetch({ ok: true, deviceId: 'device-1' });
  const out = await pairDevice({ code: 'ABCDEF1234567890', deviceName: 'laptop', home: dir, fetchImpl: impl, bridgeUrl: 'https://bridge.test' });
  assert.equal(out.deviceName, 'laptop');
  assert.equal(calls[0].body.action, 'pair');
  assert.match(calls[0].body.token, /^[a-f0-9]{64}$/, 'the token is generated, not chosen by the server');
  assert.equal(readDevice({ home: dir }).token, calls[0].body.token);
  assert.equal(readDevice({ home: dir }).deviceName, 'laptop');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a pairing the server refuses writes nothing', async () => {
  const dir = home();
  const { impl } = fakeFetch({ ok: false, error: 'Pairing code is invalid or expired.' }, 401);
  await assert.rejects(() => pairDevice({ code: 'BAD', deviceName: 'laptop', home: dir, fetchImpl: impl }), /invalid or expired/);
  assert.equal(readDevice({ home: dir }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unpaired machine refuses to call the wallet before any request is made', async () => {
  const dir = home();
  let called = false;
  const impl = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
  await assert.rejects(() => walletBalance({ home: dir, fetchImpl: impl }), /not paired/);
  assert.equal(called, false, 'a wallet call without a device must not reach the network');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every call carries the device that proves the owner', async () => {
  const dir = home();
  fs.mkdirSync(path.join(dir, '.opera-agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.opera-agent', 'device.json'), JSON.stringify({ deviceName: 'laptop', token: TOKEN }));
  const { impl, calls } = fakeFetch({ ok: true, balanceCents: 1000000, availableCents: 990000 });
  const out = await walletBalance({ home: dir, fetchImpl: impl, billingUrl: 'https://billing.test' });
  assert.equal(out.balanceCents, 1000000);
  assert.equal(calls[0].body.device_name, 'laptop');
  assert.equal(calls[0].body.device_token, TOKEN);
  assert.equal(calls[0].body.action, 'wallet-balance');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a settle names the reservation and the artifact, and nothing else', async () => {
  const { impl, calls } = fakeFetch({ ok: true, amountCents: 10000 });
  await taskSettle({ reservationId: RESERVATION, artifactHash: 'b'.repeat(64), actionsActual: 4 }, {
    device: { deviceName: 'laptop', token: TOKEN }, fetchImpl: impl
  });
  assert.deepEqual(calls[0].body, {
    action: 'task-settle',
    reservation_id: RESERVATION,
    artifact_hash: 'b'.repeat(64),
    actions_actual: 4,
    device_name: 'laptop',
    device_token: TOKEN
  });
});

test('a reserve sends the plan and never a price', async () => {
  const { impl, calls } = fakeFetch({ ok: true, reservation: { reservationId: RESERVATION } });
  await taskReserve({ artifact: 'list', items: 12, estSteps: 8 }, {
    device: { deviceName: 'laptop', token: TOKEN }, fetchImpl: impl
  });
  assert.deepEqual(calls[0].body.plan, { artifact: 'list', items: 12, estSteps: 8 });
  assert.equal('amount_cents' in calls[0].body, false, 'the client never states its own price');
});

test('a refund carries the reason the person would read', async () => {
  const { impl, calls } = fakeFetch({ ok: true, amountCents: 10000 });
  await taskRefund({ reservationId: RESERVATION, reason: 'the page was behind a login' }, {
    device: { deviceName: 'laptop', token: TOKEN }, fetchImpl: impl
  });
  assert.equal(calls[0].body.reason, 'the page was behind a login');
  assert.equal(calls[0].body.reservation_id, RESERVATION);
});

test('the wallet and the bridge are two functions of one project', () => {
  assert.equal(BILLING_URL, DEFAULT_BRIDGE_URL.replace('opera-agent-bridge', 'opera-agent-billing'));
  assert.match(BILLING_URL, /^https:\/\/[a-z]+\.supabase\.co\/functions\/v1\/opera-agent-billing$/);
});

test('a device file written here reads back with the same token', () => {
  const dir = home();
  const file = saveDevice({ deviceName: 'desk', token: TOKEN }, { home: dir });
  assert.equal(file, path.join(dir, '.opera-agent', 'device.json'));
  assert.deepEqual(readDevice({ home: dir }), { deviceName: 'desk', token: TOKEN });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a quote and a top-up ask, and never state a price', async () => {
  const { impl, calls } = fakeFetch({ ok: true });
  await walletQuote({ artifact: 'page', estSteps: 3 }, { device: { deviceName: 'laptop', token: TOKEN }, fetchImpl: impl });
  await walletTopUp({ device: { deviceName: 'laptop', token: TOKEN }, fetchImpl: impl });
  assert.deepEqual(calls[0].body.plan, { artifact: 'page', estSteps: 3 });
  assert.equal(calls[0].body.action, 'wallet-quote');
  assert.equal(calls[1].body.action, 'wallet-deposit');
  for (const call of calls) assert.equal('amount_cents' in call.body, false);
});
