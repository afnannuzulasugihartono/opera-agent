// @last-edited: 2026-10-05 08:41 UTC+7.
// @title: landing-dashboard — the account page shows your devices, nothing else's.
// @state: failing first: the dashboard page does not exist yet.
// @dependencies: test, assert, fs.

// The dashboard is the fulcrum of the full-stack site: the one page that reads
// the user's own rows. It calls exactly one RPC, shows method and status but
// never page content, and sends a stranger back to sign-in instead of leaking
// an empty state that looks broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('landing/vercel.json', root), 'utf8'));
const bySource = Object.fromEntries(vercel.headers.map((h) => [h.source, h.headers]));

test('the dashboard reads through one owner-scoped RPC', () => {
  const html = read('akun.html');
  assert.match(html, /rpc\/opera_my_devices/, 'the only data call is the owner-scoped RPC');
  assert.doesNotMatch(html, /\/rest\/v1\/opera_commands/, 'the page never queries the raw commands table');
  assert.doesNotMatch(html, /\/rest\/v1\/opera_devices/, 'the page never queries the raw devices table');
  assert.doesNotMatch(html, /result[^a-z]/i, 'command payloads stay on the server; only method and status render');
});

test('a stranger is sent to sign-in, never shown an empty dashboard', () => {
  const html = read('akun.html');
  assert.match(html, /location\.replace\('\.\/auth\.html'\)/, 'no token means the sign-in page, not an empty state');
});

test('the dashboard shares the site navigation and footer', () => {
  const html = read('akun.html');
  assert.match(html, /class="brand"[^>]*>Opera Agent</, 'the brand is shared');
  assert.match(html, /privasi\.html/, 'the privacy policy is linked');
  assert.match(html, /syarat\.html/, 'the terms are linked');
  assert.match(html, /Keluar/, 'sign-out lives where the session is shown');
});

test('the dashboard may reach only Supabase like the auth page', () => {
  for (const source of ['/akun', '/akun/:path*', '/akun.html']) {
    const entry = bySource[source];
    assert.ok(entry, `vercel.json must define a header entry for ${source}`);
    const csp = entry.find((h) => h.key === 'Content-Security-Policy').value;
    assert.match(csp, /connect-src https:\/\/\*\.supabase\.co/, `${source} may reach only Supabase`);
  }
});

test('the migration binds devices without touching existing grants', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261005120000_opera_agent_account_device_binding.sql', root), 'utf8');
  assert.match(sql, /add column if not exists user_id/, 'devices gain an owner column');
  assert.match(sql, /coalesce\(public\.opera_devices\.user_id, excluded\.user_id\)/, 'pairing never steals an owned device');
  assert.match(sql, /for select to authenticated using/, 'owners read their own rows');
  assert.doesNotMatch(sql, /revoke/i, 'no existing grant is touched');
  assert.doesNotMatch(sql, /drop /i, 'nothing is dropped');
});
