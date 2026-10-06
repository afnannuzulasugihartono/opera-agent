// @last-edited: 2026-10-06 05:12 UTC+7.
// @title: landing-dashboard — the device page shows your devices, nothing else's.
// @state: 19 locks, green; the page moved out of akun.html when the two split.
// @dependencies: test, assert, fs.

// The dashboard is the fulcrum of the full-stack site: the one page that reads the
// user's own device rows. It calls exactly one RPC, shows method and status but
// never page content, and sends a stranger back to sign-in instead of leaking an
// empty state that looks broken.
//
// It is a separate page from the account page on purpose. Supabase splits profile
// (/account/me) from resources, and opencode splits settings from projects; a reader
// who opened "Akun" to check who they are should not land on a device list, and a
// reader who opened "Dashboard" should not have to scroll past a profile card.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('landing/vercel.json', root), 'utf8'));
const bySource = Object.fromEntries(vercel.headers.map((h) => [h.source, h.headers]));

test('the dashboard reads through one owner-scoped RPC', () => {
  const html = read('dashboard.html');
  assert.match(html, /rpc\/opera_my_devices/, 'the only device list call is the owner-scoped RPC');
  assert.doesNotMatch(html, /\/rest\/v1\/opera_commands/, 'the page never queries the raw commands table');
  assert.doesNotMatch(html, /\/rest\/v1\/opera_devices/, 'the page never queries the raw devices table');
  // WHY this one is narrow: "result" appears in DOM ids, so the lock targets the
  // field the dashboard must never render, not the word itself.
  assert.doesNotMatch(html, /\.result\b|\['result'\]|"result"\s*:/, 'command payloads stay on the server; only method and status render');
});

test('the dashboard reads human time, counts work, and acts on devices', () => {
  const html = read('dashboard.html');
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

test('the dashboard re-reads the marker instead of reading it once', () => {
  const html = read('dashboard.html');
  // WHY this lock: the content script runs at document_idle, so the marker can land
  // after the dashboard has already rendered. A single read tells a reader who has the
  // extension that it is missing, and the obvious reaction is to install a second copy.
  assert.match(html, /MutationObserver/, 'the page watches for the marker arriving late');
  assert.match(html, /attributeFilter:\s*\['data-opera-agent'\]/, 'and only for that attribute');
});

test('the dashboard says whether the extension is installed in this browser', () => {
  const html = read('dashboard.html');
  // WHY this lock: a signed-in reader whose browser has no extension sees an empty
  // device list and a status line about pairing, which reads as a broken product
  // rather than as the one step they have not done. The content script runs on every
  // page and can leave a marker; the dashboard reads it and names the missing step.
  assert.match(html, /dataset\.operaAgent/, 'the page reads the marker the content script leaves');
  assert.match(html, /id="installState"/, 'and reports it on its own status line');
  // WHY both words are required: "terpasang" alone could describe the account, and
  // "belum" alone could describe a device that is offline. The copy has to say which.
  assert.match(html, /Opera Agent belum terpasang di browser ini/, 'the missing case names the extension and the browser');
  assert.match(html, /Opera Agent terpasang di browser ini/, 'and the present case says so too');
});

test('the content script leaves the marker the dashboard reads', () => {
  const content = fs.readFileSync(new URL('extension/content.js', root), 'utf8');
  // WHY the exact name: the dashboard matches a string, so two spellings would leave
  // the page permanently reporting "not installed" on a browser that has it.
  assert.match(content, /documentElement\.dataset\.operaAgent\s*=/, 'the marker is written on documentElement');
  // WHY it must be a dataset attribute and not a JS global: the dashboard is a
  // separate document context and can only read the DOM, never the content script's
  // own globals. A global would be invisible to the page for the same reason the page
  // cannot message the extension.
  assert.match(read('dashboard.html'), /documentElement\.dataset\.operaAgent/, 'the page reads it from the DOM, not from a global');
});

test('the dashboard is about devices, not about the person', () => {
  const html = read('dashboard.html');
  // WHY this lock exists: the two pages were one file, and the split is only real if
  // the dashboard stops carrying identity. A profile card here would put the reader
  // back to scrolling past themselves to reach their devices.
  assert.doesNotMatch(html, /profileCard|full_name|avatar_url/, 'no profile data renders on the device page');
  assert.doesNotMatch(html, /id="avatar"/, 'no avatar initials here either');
  assert.match(html, /Device milik/, 'the page names whose devices these are, in one line');
  assert.match(html, /aria-current="page"/, 'the nav marks this page as the current one');
});

test('every server refusal the dashboard can meet is written in Indonesian', () => {
  const html = read('dashboard.html');
  // WHY this lock: the server speaks English and the page speaks Indonesian. A raw
  // server string to an operator reads as a broken product, and the rate-limit
  // refusal is the message a real person will actually meet.
  const refusals = [
    'Too many pairing codes this hour. Try again later.',
    'No paired device on this account.',
    'Device is offline. Open the extension so it can check in.',
    'Unknown or disabled method.',
    'Not signed in.'
  ];
  const block = html.slice(html.indexOf('const TRANSLATED'), html.indexOf('};', html.indexOf('const TRANSLATED')));
  for (const refusal of refusals) {
    assert.ok(block.includes(refusal), `the page must carry a translation for: ${refusal}`);
  }
  assert.doesNotMatch(html, /Gagal: \$\{result\?\.error \|\| response\.status\}/, 'no raw server string reaches the reader');
});

test('a refusal on the dashboard answers with a status line, not a silent failure', () => {
  const html = read('dashboard.html');
  // WHY: the revoke handler used to swallow the server's answer entirely, so a
  // refused revoke looked identical to a successful one until the list reloaded.
  assert.match(html, /dicabut\. Pasang ulang/, 'a successful revoke says so');
  assert.match(html, /Gagal mencabut: \$\{error\.message\}/, 'a refused revoke says what happened');
  assert.match(html, /Gagal membuat kode: \$\{error\.message\}/, 'a refused pairing code says what happened');
  assert.match(html, /\$\('status'\)\.className = 'status warn'/, 'and marks the status line as a warning');
});

test('a stranger is sent to sign-in, never shown an empty dashboard', () => {
  const html = read('dashboard.html');
  assert.match(html, /location\.replace\('\.\/auth\.html'\)/, 'no token means the sign-in page, not an empty state');
  // WHY every action re-reads the session: the token can be revoked in another tab,
  // and an expired token must send the reader to sign-in rather than failing opaquely.
  const guards = (html.match(/await currentSession\(\)/g) || []).length;
  assert.ok(guards >= 3, `every action re-checks the session, found ${guards}`);
});

test('the page shows each connected device id and can copy it', () => {
  const html = read('dashboard.html');
  // WHY this lock: support asks which browser is misbehaving before anything else,
  // and an operator should not have to re-type a UUID to answer. The id already
  // travels in the RPC payload, so no new query is needed.
  assert.match(html, /data-copy="\$\{esc\(device\.id\)\}"/, 'the id is rendered and marked copyable');
  assert.match(html, /Salin ID/, 'copying has a visible control');
  assert.match(html, /navigator\.clipboard\.writeText/, 'copying actually copies');
  assert.match(html, /ID device disalin/, 'copying answers with a status line');
  // WHY delegated: the device list is re-rendered on every load, so a per-button
  // listener would be rebound each time and the affordance would die on refresh.
  assert.match(html, /\$\('devices'\)\.onclick/, 'the copy listener survives re-renders');
});

test('the dashboard shares the site navigation and footer', () => {
  const html = read('dashboard.html');
  assert.match(html, /class="brand"[^>]*>Opera Agent</, 'the brand is shared');
  assert.match(html, /privasi\.html/, 'the privacy policy is linked');
  assert.match(html, /syarat\.html/, 'the terms are linked');
  assert.match(html, /Keluar|akun\.html/, 'the way to the account page is one click away');
});

test('the dashboard may reach only Supabase like the auth page', () => {
  for (const source of ['/dashboard', '/dashboard/:path*', '/dashboard.html']) {
    const entry = bySource[source];
    assert.ok(entry, `vercel.json must define a header entry for ${source}`);
    const csp = entry.find((h) => h.key === 'Content-Security-Policy').value;
    assert.match(csp, /connect-src https:\/\/\*\.supabase\.co/, `${source} may reach only Supabase`);
  }
});

test('the account and device pages are separate files, not one page with tabs', () => {
  const account = read('akun.html');
  const dashboard = read('dashboard.html');
  // WHY: one page with both on it was the original problem. A tab switch would keep
  // the same ambiguity, and the reader would still not know which page to bookmark.
  assert.doesNotMatch(dashboard, /opera_my_devices[\s\S]{0,200}profileCard/, 'the device page is not the account page');
  assert.match(account, /id="factProvider"/, 'identity lives on the account page');
  assert.match(dashboard, /opera_my_devices/, 'devices live on the dashboard');
  assert.match(account, /href="\.\/dashboard\.html"/, 'the account page links the dashboard');
  assert.match(dashboard, /href="\.\/akun\.html"/, 'the dashboard links the account page');
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

test('the pairing issuer has exactly one signature, or PostgREST refuses it', () => {
  const binding = fs.readFileSync(new URL('supabase/migrations/20261005120000_opera_agent_account_device_binding.sql', root), 'utf8');
  const drop = fs.readFileSync(new URL('supabase/migrations/20261005160000_opera_agent_pairing_issuer_unambiguous.sql', root), 'utf8');
  // WHY this lock: the binding migration added a three-argument issuer while the
  // core migration left a two-argument one. PostgREST then answered PGRST203
  // "function is not unique" and the dashboard pairing button could never work.
  assert.match(binding, /create or replace function public\.opera_create_pairing_code\(p_device_name text default 'opera', p_ttl_minutes integer default 10, p_issued_by uuid default null\)/, 'the three-argument issuer is declared once');
  assert.match(drop, /drop function if exists public\.opera_create_pairing_code\(text, integer\)/, 'the ambiguous two-argument form is dropped');
  const signatures = [...binding.matchAll(/create or replace function public\.opera_create_pairing_code\(/g)].length
    + [...drop.matchAll(/create or replace function public\.opera_create_pairing_code\(/g)].length;
  assert.equal(signatures, 1, 'exactly one creator and one dropper, never two overloads');
  // WHY the RLS policies are still load-bearing even though nothing grants SELECT:
  // measured on this project, an authenticated role reaching opera_devices asks for
  // a grant it does not have. The isolation therefore rests on the missing grant
  // today, and the policies are what keep it true the day someone adds one.
  assert.match(binding, /for select to authenticated using \(user_id = auth\.uid\(\)\)/, 'a future grant is filtered by ownership');
});

test('account isolation rests on two layers, and both are asserted', () => {
  const binding = fs.readFileSync(new URL('supabase/migrations/20261005120000_opera_agent_account_device_binding.sql', root), 'utf8');
  // WHY this test names the architecture: an authenticated role has no grant at all
  // on the tables, only EXECUTE on the RPCs, so the missing grant is layer one and
  // RLS is layer two for the day a grant appears. Proved on this project by
  // SET LOCAL ROLE authenticated against public.opera_devices: permission denied.
  assert.doesNotMatch(binding, /grant select/i, 'no SELECT is granted to any role');
  assert.match(binding, /create policy opera_devices_owner_read/, 'ownership filtering exists for devices');
  assert.match(binding, /create policy opera_commands_owner_read/, 'commands filter through their device');
  assert.match(binding, /create policy opera_pairing_codes_owner_read/, 'issued codes filter through their issuer');
  assert.match(binding, /not signed in/i, 'every RPC refuses without a session');
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