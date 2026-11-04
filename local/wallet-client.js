// @last-edited: 2026-11-04 UTC+7.
// @title: wallet-client — the device's wallet, spoken from the machine that does the work.
// @state: the device file, the pairing that fills it, and the six calls whose answers are money.
// @dependencies: node:fs, node:path, node:os, node:crypto, ../extension/lib/endpoints.js.

// WHY THE LOCAL MACHINE PAIRS INSTEAD OF PASTING A SESSION.
// The extension is paired once and then signs every command with a device token; a terminal that pasted a session token would be a second, weaker identity with an hour of life and a copy in shell history.
// Pairing reuses the same table the extension uses, so the wallet sees one owner whichever surface the work came from.

// WHY NO BALANCE IS KEPT HERE.
// A cached balance is a number that was true once, and the machine that spends it is the machine most likely to be offline when it changes.
// Every call asks the server; the last answer is printed and thrown away.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { BILLING_URL, DEFAULT_BRIDGE_URL } from '../extension/lib/endpoints.js';

export const DEVICE_FILE = path.join(os.homedir(), '.opera-agent', 'device.json');

function devicePath(home) {
  return home ? path.join(home, '.opera-agent', 'device.json') : DEVICE_FILE;
}

export function readDevice({ home = null } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(devicePath(home), 'utf8'));
    if (typeof raw?.deviceName !== 'string' || typeof raw?.token !== 'string') return null;
    if (!/^[a-f0-9]{64}$/i.test(raw.token)) return null;
    return { deviceName: raw.deviceName, token: raw.token };
  } catch {
    return null;
  }
}

// WHY THE FILE IS WRITTEN WITH ITS OWN MODE.
// The token is the device's whole authority: it spends the wallet.
// A file another user on the same machine can read is a wallet another user can spend.

export function saveDevice({ deviceName, token }, { home = null } = {}) {
  const file = devicePath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ deviceName, token }, null, 2), { mode: 0o600 });
  return file;
}

// WHY THE TOKEN IS GENERATED HERE AND NEVER SENT ANYWHERE BUT ITS HASH.
// The server stores a hash, so a database that leaks still cannot spend a wallet.
// The plaintext lives in one file on the machine that earned it.

export async function pairDevice({ code, deviceName, home = null, bridgeUrl = DEFAULT_BRIDGE_URL, fetchImpl = fetch, version = '0.0.0' }) {
  const name = String(deviceName || '').trim();
  if (!name) throw new Error('a device name is required: it is the name the dashboard will show');
  const token = randomBytes(32).toString('hex');
  const response = await fetchImpl(bridgeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'pair', code: String(code || '').trim(), token, deviceName: name, extensionVersion: version, protocolVersion: 1 })
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok || answer?.ok !== true) {
    throw new Error(answer?.error || `the pairing was refused (${response.status})`);
  }
  saveDevice({ deviceName: name, token }, { home });
  return { deviceName: name, deviceId: answer.deviceId ?? null };
}

async function call(action, body = {}, { home = null, billingUrl = BILLING_URL, fetchImpl = fetch, device = null } = {}) {
  const held = device || readDevice({ home });
  if (!held) throw new Error('this machine is not paired: run wallet_pair with the code from the dashboard');
  const response = await fetchImpl(billingUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body, device_name: held.deviceName, device_token: held.token })
  });
  const answer = await response.json().catch(() => ({ ok: false, why: `the server answered ${response.status} with no body` }));
  return { status: response.status, ...answer };
}

export function walletBalance(options) {
  return call('wallet-balance', {}, options);
}

export function walletQuote(plan, options) {
  return call('wallet-quote', { plan }, options);
}

export function walletTopUp(options) {
  return call('wallet-deposit', {}, options);
}

export function taskReserve(plan, options) {
  return call('task-reserve', { plan }, options);
}

export function taskSettle({ reservationId, artifactHash, actionsActual = null }, options) {
  return call('task-settle', {
    reservation_id: reservationId,
    artifact_hash: artifactHash,
    actions_actual: actionsActual
  }, options);
}

export function taskRefund({ reservationId, reason = null }, options) {
  return call('task-refund', { reservation_id: reservationId, reason }, options);
}
