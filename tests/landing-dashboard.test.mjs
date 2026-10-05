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
  assert.match(html, /rpc\/opera_my_devices/, 'the only device list call is the owner-scoped RPC');
  assert.doesNotMatch(html, /\/rest\/v1\/opera_commands/, 'the page never queries the raw commands table');
  assert.doesNotMatch(html, /\/rest\/v1\/opera_devices/, 'the page never queries the raw devices table');
  // WHY this one is narrow: "result" appears in DOM ids, so the lock targets the
  // field the dashboard must never render, not the word itself.
  assert.doesNotMatch(html, /\.result\b|\['result'\]|"result"\s*:/, 'command payloads stay on the server; only method and status render');
});

test('the dashboard reads human time, counts work, and acts on devices', () => {
  const html = read('akun.html');
  assert.match(html, /RelativeTimeFormat\('id'/, 'timestamps render as relative Indonesian time');
  assert.match(html, /completedCommands/, 'usage counts give billing-per-result its meter');
  assert.match(html, /opera_revoke_my_device/, 'revocation keeps the terms honest');
  assert.match(html, /opera_create_pairing_code/, 'pairing codes are issued bound to the caller');
  assert.match(html, /opera_run_on_my_device/, 'the account can run one action on its own device');
  assert.match(html, /Buat kode pairing/, 'issuance has a visible control');
  assert.match(html, /Cabut device ini/, 'revocation has a visible control');
  assert.match(html, /Jalankan/, 'running has a visible control');
  // WHY this one: measured on this project, the device picks a queued command up
  // about twelve seconds after it was enqueued, just past the wait window, and
  // then finishes in under half a second. Reporting that as a failure would teach
  // the reader the button is broken when the work actually succeeded.
  assert.match(html, /AWAIT_TIMEOUT/, 'a queued-but-pending run is recognised');
  assert.match(html, /masuk antrean/, 'pending is reported as pending, not as failure');
  // WHY the narrow patterns: the run payload may carry page content, so the page
  // may read status but never a payload field. result.status is the safe read.
  assert.doesNotMatch(html, /result\s*\.\s*(result|params|value|content|text)\b/i, 'the run payload is never rendered');
});

test('the home page notices sign-in without breaking its no-network promise', () => {
  const html = read('index.html');
  assert.match(html, /localStorage/, 'the home page may notice a session');
  assert.doesNotMatch(html, /fetch\s*\(/, 'noticing never calls anyone');
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

test('pairing issuance is rate limited per issuing account', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261005150000_opera_agent_pairing_rate_limit.sql', root), 'utf8');
  // WHY this lock: ROADMAP lists a pairing rate limit as a precondition for mass
  // distribution, and every code invalidates the previous one, so an account that
  // mints freely can keep cancelling a legitimate user's code.
  assert.match(sql, /where issued_by = v_issuer and created_at > now\(\) - interval '1 hour'/, 'the window is per issuer over an hour');
  assert.match(sql, /if v_recent >= 5 then/, 'five an hour is the cap');
  assert.match(sql, /pairing_code\.rate_limited/, 'the refusal is audited');
  assert.match(sql, /revoke execute on function public\.opera_create_pairing_code\(text, integer, uuid\) from public, anon/, 'anon still cannot issue');
});

test('the v2 migration only adds: revoke, counts, and self-issuing codes', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261005130000_opera_agent_dashboard_actions.sql', root), 'utf8');
  assert.match(sql, /opera_revoke_my_device/, 'revocation is a new function');
  assert.match(sql, /completedCommands/, 'counts ride the existing reader');
  assert.match(sql, /coalesce\(p_issued_by, auth\.uid\(\)\)/, 'issuance defaults to the caller');
  assert.doesNotMatch(sql, /revoke all|revoke .* from/i, 'no grant is touched');
  assert.doesNotMatch(sql, /drop /i, 'nothing is dropped');
  assert.doesNotMatch(sql, /alter table/i, 'no table shape changes in v2');
});

test('every account RPC is unreachable to anon, not merely guarded by an IF', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261005140000_opera_agent_account_run.sql', root), 'utf8');
  for (const fn of ['opera_run_on_my_device', 'opera_revoke_my_device', 'opera_my_devices', 'opera_create_pairing_code']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon`), `${fn} is revoked from anon`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`), `${fn} is granted to signed-in callers`);
  }
});

test('the run RPC resolves the device by the caller, never by a name argument', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261005140000_opera_agent_account_run.sql', root), 'utf8');
  assert.match(sql, /where user_id = auth\.uid\(\)/, 'the device comes from the session');
  assert.doesNotMatch(sql, /p_device_name/, 'no device name parameter can name another account browser');
  assert.match(sql, /opera_methods where method = p_method and enabled/, 'the method is checked against the enabled allowlist');
});

test('the migration binds devices without touching existing grants', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261005120000_opera_agent_account_device_binding.sql', root), 'utf8');
  assert.match(sql, /add column if not exists user_id/, 'devices gain an owner column');
  assert.match(sql, /coalesce\(public\.opera_devices\.user_id, excluded\.user_id\)/, 'pairing never steals an owned device');
  assert.match(sql, /for select to authenticated using/, 'owners read their own rows');
  assert.doesNotMatch(sql, /revoke/i, 'no existing grant is touched');
  assert.doesNotMatch(sql, /drop /i, 'nothing is dropped');
});
