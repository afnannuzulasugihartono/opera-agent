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

test('every inline module on a page is balanced, or the browser discards it whole', () => {
  for (const page of ['index.html', 'auth.html', 'akun.html']) {
    const html = read(page);
    const opened = (html.match(/<script type="module">/g) || []).length;
    const closed = (html.match(/<\/script>/g) || []).length;
    // WHY this lock is not pedantry: an unclosed tag makes the browser swallow
    // everything up to the last close as one script, hit the literal "<script" of
    // the next tag, and discard the whole module. Measured on the live home page:
    // one script element instead of two, and clicking "Salin" did nothing at all,
    // because not one listener was ever attached.
    assert.equal(opened, closed, `${page} opens ${opened} module scripts but closes ${closed}`);
  }
});

test('the home page model form has a listener that answers a click', () => {
  const html = read('index.html');
  // WHY: the form is the only path a stranger has to hand their key to their own
  // browser without typing it into a popup. A dead form is a dead onboarding path.
  assert.match(html, /\$\('modelForm'\)\.addEventListener\('submit'/, 'the form submits');
  assert.match(html, /\$\('copyButton'\)\.addEventListener\('click'/, 'the copy button answers');
  assert.match(html, /\$\('preset'\)\.addEventListener\('change'/, 'the preset fills the endpoint');
  assert.match(html, /EXTENSION_ID = '([a-p]{32})'/, 'the extension is named by id');
});

test('every server refusal the dashboard can meet is written in Indonesian', () => {
  const html = read('akun.html');
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

test('the account page shows the connected provider identity, like any profile page', () => {
  const html = read('akun.html');
  // WHY this lock: a reader must see which Google or GitHub identity their device is
  // bound to before pairing anything else, and every other site they know shows that
  // identity next to the thing they are managing.
  assert.match(html, /id="profileCard"/, 'the page has a profile card');
  assert.match(html, /user_metadata/, 'the name comes from the identity the provider issued');
  // WHY the providers array and not app_metadata.provider: measured on this project,
  // an account that signed in with Google still carries provider "email" with
  // providers ["email","google"], because a magic link created it first. Reading
  // provider alone would tell the operator they signed in by email when they did not.
  assert.match(html, /app_metadata\?\.providers/, 'the provider comes from the session, not from a guess');
  assert.match(html, /\['google', 'github'\]\.find\(\(name\) => list\.includes\(name\)\)/, 'a named provider wins over the email entry');
  assert.match(html, /providerOf\(user\)/, 'the card renders the resolved provider');
  assert.match(html, /Masuk lewat/, 'the provider is named in Indonesian');
  assert.match(html, /google: 'Google'/, 'Google is spelled the way Google spells it');
  assert.match(html, /github: 'GitHub'/, 'and so is GitHub');
  assert.match(html, /full_name/, 'the full name is preferred over a handle');
  assert.match(html, /user\.email/, 'the address is shown too');
  // WHY initials and not the provider's avatar image: every page may reach one
  // network origin, pinned in vercel.json. An <img> from a provider CDN would be a
  // second origin and would send a third party a request on every page view.
  assert.doesNotMatch(html, /<img[^>]+src=.*(googleusercontent|githubusercontent)/i, 'no provider image is fetched');
  assert.doesNotMatch(html, /avatar_url/, 'not even the URL is read');
  assert.match(html, /class="avatar"/, 'the avatar is drawn locally from initials');
});

test('the page shows each connected device id and can copy it', () => {
  const html = read('akun.html');
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
