// @last-edited: 2026-11-02 UTC+7.
// @title: gobiz-probe — log into the GoBiz merchant API from a server and read the transaction feed.
// @state: login asks for one SMS code, keeps the session in the temp dir, and feed prints the last transactions.
// @dependencies: node:fs, node:path, node:os, node:crypto, node:url.

// WHY THIS PROGRAM EXISTS.

// A GoPay Merchant account has no web dashboard of its own, but the phone app and the GoFood merchant dashboard talk to the same JSON API.
// This program drives that API from a server, so the settlement check needs no phone that stays awake and the QRIS rail probe can read the same feed the matcher will use later.

// The phone number and the SMS code are read from files in the temp dir, never from arguments, so they stay out of the shell history and out of this tree.
// The session is written next to them and is never printed in full.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const API = 'https://api.gobiz.co.id';
const ANALYTICS = 'https://api.gojekapi.com';
const CLIENT_ID = 'go-biz-web-new';
const APP_ID = 'go-biz-web-dashboard';
const APP_VERSION = 'platform-v3.129.0-edffae48';
const PORTAL = 'https://portal.gofoodmerchant.co.id';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

const homeDir = () => process.env.GOBIZ_HOME || path.join(os.tmpdir(), 'opera-gobiz');
const fileIn = (name) => path.join(homeDir(), name);

// WHY THE PHONE IS NORMALIZED.

// The GoID login wants a bare national number without the country code and without the leading zero, so one file can hold any format a person types and still reach the same account.

export function barePhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('62')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 8 || digits.length > 13) throw new Error('that does not look like a phone number');
  return digits;
}

// WHY THE AUTH CALLS CARRY DEVICE HEADERS.

// The portal sends a device header set on the login calls, and the server checks it.
// These headers describe a desktop browser session, which is what the merchant portal itself sends.

export function deviceHeaders(token) {
  return {
    ...dataHeaders(token),
    'Accept-Language': 'id',
    'Gojek-Country-Code': 'ID',
    'Gojek-Timezone': 'Asia/Jakarta',
    'X-AppVersion': APP_VERSION,
    'X-PhoneMake': 'Windows 10 64-bit',
    'X-PhoneModel': 'Chrome 153.0.0.0 on Windows 10 64-bit',
    'X-Platform': 'Web',
    'X-User-Locale': 'en-US',
    'X-User-Type': 'merchant',
    'x-DeviceOS': 'Web',
    'x-appId': APP_ID,
    'x-uniqueid': crypto.randomUUID()
  };
}

export function dataHeaders(token) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Authentication-Type': 'go-id',
    Authorization: `Bearer ${token || ''}`,
    'Content-Type': 'application/json',
    Origin: PORTAL,
    Referer: `${PORTAL}/`,
    'User-Agent': UA
  };
}

// WHY PRINTED VALUES ARE CLEANED.

// Every field printed here came from a remote server, and a terminal that receives control characters can be made to show something the operator never sent.
// Printed values lose their control characters and are cut to a readable length.

export function safeText(value, length = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, length);
}

async function call(url, { method = 'GET', body, token, auth = false } = {}) {
  const res = await fetch(url, {
    method,
    headers: auth ? deviceHeaders(token) : dataHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const error = new Error(`${method} ${url} -> ${res.status} ${safeText(JSON.stringify(data), 200)}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function readInput(name) {
  const raw = await fs.readFile(fileIn(name), 'utf8');
  return raw.trim();
}

// WHY THE CODE ARRIVES BY FILE.

// The SMS code lives for twelve minutes, and a code typed into a shell argument would sit in the history file.
// The program waits for a file instead, reads four digits from it, and deletes it.

async function waitForOtp(seconds) {
  const file = fileIn('otp.txt');
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      const code = (await fs.readFile(file, 'utf8')).replace(/\D/g, '');
      if (code.length >= 4) {
        await fs.rm(file, { force: true });
        return code.slice(0, 4);
      }
    } catch { }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('no OTP file appeared in time');
}

async function saveSession(session) {
  await fs.mkdir(homeDir(), { recursive: true });
  await fs.writeFile(fileIn('session.json'), JSON.stringify(session, null, 2));
}

async function loadSession() {
  return JSON.parse(await fs.readFile(fileIn('session.json'), 'utf8'));
}

async function refresh(session) {
  const data = await call(`${API}/goid/token`, {
    method: 'POST',
    auth: true,
    body: { client_id: CLIENT_ID, grant_type: 'refresh_token', data: { refresh_token: session.refresh_token } }
  });
  return { ...session, ...data };
}

async function withSession(run) {
  let session = await loadSession();
  try {
    return await run(session);
  } catch (error) {
    if (error.status !== 401 || !session.refresh_token) throw error;
    session = await refresh(session);
    await saveSession(session);
    return run(session);
  }
}

async function login() {
  const phone = barePhone(await readInput('phone.txt'));
  const body = { client_id: CLIENT_ID, phone_number: phone, country_code: '62' };
  const request = await call(`${API}/goid/login/request`, { method: 'POST', auth: true, body });
  console.log('otp requested, expires in', safeText(request.data?.otp_expires_in), 'seconds');
  let session = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3 && !session; attempt += 1) {
    console.log('attempt', attempt, '- write the code into', fileIn('otp.txt'));
    try {
      const otp = await waitForOtp(600);
      session = await call(`${API}/goid/token`, {
        method: 'POST',
        auth: true,
        body: { client_id: CLIENT_ID, grant_type: 'otp', data: { otp, otp_token: request.data.otp_token } }
      });
    } catch (error) {
      lastError = error;
      console.log('attempt', attempt, 'failed:', safeText(error.message, 160));
    }
  }
  if (!session) throw lastError;
  await saveSession(session);
  console.log('session saved:', fileIn('session.json'));
  console.log('access token length', String(session.access_token || '').length, ', refresh token length', String(session.refresh_token || '').length);
}

async function feed() {
  const rows = await withSession(async (session) => {
    const me = await call(`${API}/v1/users/me`, { token: session.access_token });
    const user = me.user || me.data || me;
    const found = await call(`${API}/v1/merchants/search`, {
      method: 'POST',
      token: session.access_token,
      body: { from: 0, size: 20 }
    });
    const hits = found.hits || found.data?.hits || [];
    console.log('user:', JSON.stringify({
      id: safeText(user.id),
      email: safeText(user.email),
      phone: safeText(user.phone),
      merchant_id: safeText(user.merchant_id),
      roles: safeText([].concat(user.roles || []).join(','))
    }));
    console.log('merchants:', JSON.stringify(hits.map((hit) => ({ id: safeText(hit.id), name: safeText(hit.merchant_name) }))));
    const ids = [...new Set(hits.map((hit) => hit.id).concat(user.merchant_id ? [user.merchant_id] : []))];
    const out = [];
    for (const id of ids) {
      const query = new URLSearchParams({
        merchant_id: id,
        days: '7',
        size: '20',
        statuses: 'SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND',
        payment_types: 'QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD'
      });
      const data = await call(`${ANALYTICS}/merchant-analytics/v2/merchants/transactions?${query}`, { token: session.access_token });
      for (const t of data.transactions || []) {
        out.push({
          merchant_id: safeText(id),
          id: safeText(t.id),
          order_id: safeText(t.order_id),
          transaction_time: safeText(t.transaction_time),
          settlement_time: safeText(t.settlement_time),
          gross_amount_minor: Number(t.gross_amount),
          currency: safeText(t.currency),
          status: safeText(t.transaction_status),
          payment_type: safeText(t.payment_type),
          channel_type: safeText(t.channel_type),
          source: safeText(t.transaction_source),
          issuer: safeText(t.qris_provider_aspi_issuer)
        });
      }
    }
    return out;
  });
  console.log('transactions:', JSON.stringify(rows, null, 2));
}

const modes = { login, feed };

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const mode = process.argv[2] || 'login';
  const run = modes[mode];
  if (!run) {
    console.error(`unknown mode ${mode}, use login or feed`);
    process.exit(2);
  }
  await run();
}
