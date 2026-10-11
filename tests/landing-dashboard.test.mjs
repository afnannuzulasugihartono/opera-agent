// @last-edited: 2026-10-10 UTC+7.
// @title: landing-dashboard — the device page shows your devices and your tables, nothing else's.
// @state: 39 locks, green; the page moved out of akun.html when the two split, and grew the read-only #tabel editor.
// @dependencies: test, assert, fs.

// The dashboard is the fulcrum of the full-stack site: the one page that reads the
// user's own device rows and, since the table editor landed, one page of any table
// the reader owns. Every call goes through an owner-scoped reader RPC — opera_my_
// devices for devices, opera_konsol_* for the grid — never a raw table path, so the
// filter, the page caps and the masking live server-side where a modified client
// cannot reach past them. It shows method and status but never page content, and
// sends a stranger back to sign-in instead of leaking an empty state that looks
// broken.
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

test('the dashboard reads through scoped RPCs, never raw tables', () => {
  const html = read('dashboard.html');
  assert.match(html, /rpc\/opera_my_devices/, 'the device list call is the owner-scoped RPC');
  assert.match(html, /\$\{REST\}\/rpc\/\$\{name\}/, 'the konsol dispatcher addresses its target only as an RPC path');
  assert.match(html, /konsolRpc\('opera_konsol_tables'/, 'the table sidebar is listed by the konsol reader');
  assert.match(html, /konsolRpc\('opera_konsol_table'/, 'each page of the grid comes through the konsol reader');

  assert.doesNotMatch(html, /\/rest\/v1\/(?!rpc\/)/, 'no absolute path under /rest/v1/ reaches a table');
  const restUses = [...html.matchAll(/\$\{REST\}[^`)]*/g)].map((match) => match[0]);
  assert.ok(restUses.length > 0, 'the REST constant is actually used, or this proves nothing');
  for (const use of restUses) {
    assert.match(use, /^\$\{REST\}\/rpc\//, `every REST call is an RPC, found: ${use}`);
  }

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

  assert.match(html, /AWAIT_TIMEOUT/, 'a queued-but-pending run is recognised');
  assert.match(html, /masuk antrean/, 'pending is reported as pending, not as failure');

  assert.doesNotMatch(html, /result\s*\.\s*(result|params|value|content|text)\b/i, 'the run payload is never rendered');
});

test('the device card answers "is it reachable" before anything else', () => {
  const html = read('dashboard.html');

  assert.match(html, /<dt>Status<\/dt>/, 'status is a labelled row, not part of a sentence');
  assert.match(html, /<dt>Terakhir terlihat<\/dt>/, 'last seen is its own row');

  assert.match(html, /class="chip">\$\{esc\(device\.extensionVersion \|\| '-'\)\}/, 'the build rides the card head');
  assert.match(html, /<dt>Perintah<\/dt>/, 'the command tally is its own row');
  assert.match(html, /<dt>ID device<\/dt>/, 'the id is a row, so it is not lost in a sentence');

  assert.match(html, /\$\('installState'\)\.className = installed \? 'tone good' : 'tone warn'/,
    'the install state pairs a colour with words');
  assert.doesNotMatch(html, /<span class="online">\$\{esc\(device\.status\)\}<\/span>\s*&middot;/,
    'the device status is not a fragment of a longer line');
});

test('the rail marks the section being read', () => {
  const html = read('dashboard.html');

  assert.match(html, /IntersectionObserver/, 'the rail reads which section is in view');
  assert.match(html, /link\.setAttribute\('aria-current', 'true'\)/, 'and marks that one');
  assert.match(html, /link\.removeAttribute\('aria-current'\)/, 'and unmarks the rest');

  assert.match(html, /rootMargin: '-70px 0px -55% 0px'/, 'the sticky header is offset from the reading line');
});

test('the dashboard re-reads the marker instead of reading it once', () => {
  const html = read('dashboard.html');

  assert.match(html, /MutationObserver/, 'the page watches for the marker arriving late');
  assert.match(html, /attributeFilter:\s*\['data-opera-agent',\s*'data-opera-agent-browser'\]/, 'and watches the browser marker too');
});

test('the device list refreshes itself after pairing elsewhere', () => {
  const html = read('dashboard.html');

  assert.match(html, /async function refreshDevices\(\)/, 'the list fetch is a repeatable function');
  assert.match(html, /setInterval\(\(\) => \{ if \(!document\.hidden\) refreshDevices\(\); \}, 10000\)/, 'it polls every 10 seconds while visible');
  assert.match(html, /visibilitychange/, 'and on every return to the tab');
  assert.match(html, /if \(iso === null \|\| iso === undefined \|\| iso === ''\) return 'belum pernah'/, 'a device that never checked in says so instead of 1970');
});

test('the dashboard says whether the extension is installed in this browser', () => {
  const html = read('dashboard.html');

  assert.match(html, /dataset\.operaAgent/, 'the page reads the marker the content script leaves');
  assert.match(html, /id="installState"/, 'and reports it on its own status line');

  assert.match(html, /Opera Agent belum terpasang di browser ini/, 'the missing case names the extension and the browser');
  assert.match(html, /Opera Agent terpasang di browser ini/, 'and the present case says so too');
});

test('the content script leaves the marker the dashboard reads', () => {
  const content = fs.readFileSync(new URL('extension/content.js', root), 'utf8');

  assert.match(content, /documentElement\.dataset\.operaAgent\s*=/, 'the marker is written on documentElement');

  assert.match(read('dashboard.html'), /documentElement\.dataset\.operaAgent/, 'the page reads it from the DOM, not from a global');
});

test('the dashboard is about devices, not a profile page', () => {
  const html = read('dashboard.html');

  assert.doesNotMatch(html, /profileCard|avatar_url/, 'no profile data renders on the device page');
  assert.doesNotMatch(html, /id="avatar"/, 'no avatar initials here either');
  assert.match(html, /Device milik/, 'the page names whose devices these are, in one line');
  assert.match(html, /aria-current="page"/, 'the nav marks this page as the current one');

  assert.match(html, /<h2>Akun ini<\/h2>/, 'the account facts have their own section');
  assert.doesNotMatch(html, /<input[^>]*id="(fullName|accountName|email)"/i, 'and nothing on this page edits the account');
});

test('the dashboard has a rail, because it has five jobs and no divider', () => {
  const html = read('dashboard.html');

  const sections = ['#ringkasan', '#device', '#dengar', '#pairing', '#aksi', '#akun'];
  for (const href of sections) {
    assert.ok(html.includes(`href="${href}"`), `the rail links to ${href}`);
    assert.ok(html.includes(`id="${href.slice(1)}"`), `and ${href} names a section that exists`);
  }
  assert.match(html, /class="rail"/, 'the rail is the element the lock above is about');
  assert.match(html, /aria-label="Bagian dashboard"/, 'and it is labelled, so a screen reader announces what it is');

  for (const heading of ['Ringkasan', 'Device', 'Sesi dengar', 'Pairing manual', 'Jalankan aksi', 'Akun ini']) {
    assert.ok(html.includes(`<h2>${heading}</h2>`), `${heading} has a heading of its own`);
  }

  assert.match(html, /@media \(max-width: 640px\)/, 'the rail has a narrow-screen form');
  assert.match(html, /grid-auto-flow: column/, 'and it becomes a horizontal strip');
});

test('the destructive control looks destructive', () => {
  const html = read('dashboard.html');

  assert.match(html, /class="btn danger"/, 'the revoke control is marked as the dangerous one');
  assert.match(html, /\.btn\.danger\s*\{[^}]*var\(--danger\)/, 'and the danger colour is defined for it');

  assert.match(html, /globalThis\.confirm\(`Cabut \$\{button\.dataset\.name\}/, 'revoking still asks first');
});

test('every server refusal the dashboard can meet is written in Indonesian', () => {
  const html = read('dashboard.html');

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

  assert.match(html, /dicabut\. Pasang ulang/, 'a successful revoke says so');
  assert.match(html, /Gagal mencabut: \$\{error\.message\}/, 'a refused revoke says what happened');
  assert.match(html, /Gagal membuat kode: \$\{error\.message\}/, 'a refused pairing code says what happened');
  assert.match(html, /\$\('status'\)\.className = 'status warn'/, 'and marks the status line as a warning');
});

test('a stranger is sent to sign-in, never shown an empty dashboard', () => {
  const html = read('dashboard.html');
  assert.match(html, /location\.replace\('\.\/index\.html'\)/, 'no token means the sign-in page, not an empty state');

  const guards = (html.match(/await currentSession\(\)/g) || []).length;
  assert.ok(guards >= 3, `every action re-checks the session, found ${guards}`);
});

test('the page shows each connected device id and can copy it', () => {
  const html = read('dashboard.html');

  assert.match(html, /data-copy="\$\{esc\(device\.id\)\}"/, 'the id is rendered and marked copyable');
  assert.match(html, /Salin ID/, 'copying has a visible control');
  assert.match(html, /navigator\.clipboard\.writeText/, 'copying actually copies');
  assert.match(html, /ID device disalin/, 'copying answers with a status line');

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

  assert.doesNotMatch(dashboard, /opera_my_devices[\s\S]{0,200}profileCard/, 'the device page is not the account page');
  assert.match(account, /id="factProvider"/, 'identity lives on the account page');
  assert.match(dashboard, /opera_my_devices/, 'devices live on the dashboard');
  assert.match(account, /href="\.\/dashboard\.html"/, 'the account page links the dashboard');
  assert.match(dashboard, /href="\.\/akun\.html"/, 'the dashboard links the account page');
});

test('pairing issuance is rate limited per issuing account', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261005150000_opera_agent_pairing_rate_limit.sql', root), 'utf8');

  assert.match(sql, /where issued_by = v_issuer and created_at > now\(\) - interval '1 hour'/, 'the window is per issuer over an hour');
  assert.match(sql, /if v_recent >= 5 then/, 'five an hour is the cap');
  assert.match(sql, /pairing_code\.rate_limited/, 'the refusal is audited');
  assert.match(sql, /revoke execute on function public\.opera_create_pairing_code\(text, integer, uuid\) from public, anon/, 'anon still cannot issue');
});

test('pairing cannot take a device name another account owns, and the issuer is the session', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261007030000_opera_agent_pairing_ownership.sql', root), 'utf8');

  assert.match(sql, /v_issuer := case when auth\.uid\(\) is not null then auth\.uid\(\) else p_issued_by end/, 'only a caller with no session may name an issuer');
  assert.doesNotMatch(sql, /coalesce\(p_issued_by, auth\.uid\(\)\)/, 'a caller-supplied issuer never wins over the session');
  assert.match(sql, /user_id is not null and user_id is distinct from v_issuer/, 'issuing for an owned name is refused');
  assert.match(sql, /user_id is not null and user_id is distinct from v_pair\.issued_by/, 'pairing for an owned name is refused');
  assert.match(sql, /where public\.opera_devices\.user_id is null or public\.opera_devices\.user_id = excluded\.user_id/, 'the upsert itself refuses a foreign owner');
  assert.match(sql, /issued_by is not distinct from v_issuer and consumed_at is null/, 'a new code cancels only its own issuer\'s earlier codes');
  assert.match(sql, /if v_recent >= 5 then/, 'the hourly allowance is carried over');
});

test('commands and runs carry their harness provider for the dashboard', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261007070000_opera_commands_provider.sql', root), 'utf8');

  assert.match(sql, /alter table public\.opera_commands add column if not exists provider text not null default ''/, 'commands carry a provider with a safe default');
  assert.match(sql, /alter table public\.opera_workflow_runs add column if not exists provider text not null default ''/, 'runs carry one too');
  assert.match(sql, /'provider', c\.provider/, 'the owner-scoped reader returns it per command');
});

test('consents can be listed and revoked by their owner only', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261007080000_opera_my_consents.sql', root), 'utf8');

  assert.match(sql, /join auth\.oauth_clients cl on cl\.id = c\.client_id/, 'the list names the application');
  assert.match(sql, /where c\.user_id = v_uid and c\.revoked_at is null/, 'only live consents of the caller are listed');
  assert.match(sql, /update auth\.refresh_tokens set revoked = true/, 'refresh tokens are killed first');
  assert.match(sql, /delete from auth\.sessions where user_id = v_uid and oauth_client_id = p_client_id/, 'then its sessions are gone');
  assert.match(sql, /update auth\.oauth_consents set revoked_at = now\(\)/, 'and the consent itself is marked');
  assert.match(sql, /revoke execute on function public\.opera_revoke_consent\(uuid\) from public, anon/, 'anon cannot revoke');
  assert.match(sql, /grant execute on function public\.opera_my_consents\(\) to authenticated/, 'signed-in callers can list');
});

test('listening sessions keep transcripts owner-scoped with no grants', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/20261007100000_opera_listen_sessions.sql', root), 'utf8');

  assert.match(sql, /create table if not exists public\.opera_listen_sessions/);
  assert.match(sql, /create table if not exists public\.opera_listen_segments/);
  assert.match(sql, /unique \(session_id, seq\)/, 'segments order by cursor');
  assert.match(sql, /opera_listen_sessions_owner_read/, 'sessions filter by ownership');
  assert.match(sql, /opera_listen_segments_owner_read/, 'segments filter through their session');
  assert.doesNotMatch(sql, /grant (select|all)/i, 'no table grant to any role');
});

test('the pairing issuer has exactly one signature, or PostgREST refuses it', () => {
  const binding = fs.readFileSync(new URL('supabase/migrations/20261005120000_opera_agent_account_device_binding.sql', root), 'utf8');
  const drop = fs.readFileSync(new URL('supabase/migrations/20261005160000_opera_agent_pairing_issuer_unambiguous.sql', root), 'utf8');

  assert.match(binding, /create or replace function public\.opera_create_pairing_code\(p_device_name text default 'opera', p_ttl_minutes integer default 10, p_issued_by uuid default null\)/, 'the three-argument issuer is declared once');
  assert.match(drop, /drop function if exists public\.opera_create_pairing_code\(text, integer\)/, 'the ambiguous two-argument form is dropped');
  const signatures = [...binding.matchAll(/create or replace function public\.opera_create_pairing_code\(/g)].length
    + [...drop.matchAll(/create or replace function public\.opera_create_pairing_code\(/g)].length;
  assert.equal(signatures, 1, 'exactly one creator and one dropper, never two overloads');

  assert.match(binding, /for select to authenticated using \(user_id = auth\.uid\(\)\)/, 'a future grant is filtered by ownership');
});

test('account isolation rests on two layers, and both are asserted', () => {
  const binding = fs.readFileSync(new URL('supabase/migrations/20261005120000_opera_agent_account_device_binding.sql', root), 'utf8');

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

test('the summary answers in numbers, not in a sentence that repeats the list', () => {

  const html = read('dashboard.html');
  for (const id of ['statDevices', 'statOnline', 'statCommands']) {
    assert.ok(html.includes(`id="${id}"`), `the summary carries #${id}`);
  }
  assert.match(html, /completedCommands \?\? 0/, 'the command tally sums what the cards show');
  assert.match(html, /\.device.*\.status === 'online'/, 'the online count filters the same list');
});

test('a failed command looks failed, not like every other row', () => {

  const html = read('dashboard.html');

  assert.match(html, /commandInk = \(status\) => status === 'completed' \? 'online' : status === 'failed' \? 'offline' : ''/, 'completed reads green, failed reads amber, anything else stays muted');
  assert.match(html, /class="\$\{commandInk\(command\.status\)\}"/, 'and every history row uses it');
  assert.match(html, /\.commands li \.online/, 'the stylesheet defines the completed ink');
  assert.match(html, /\.commands li \.offline/, 'and the failed ink');
});

test('a device card leads with its state, not its name alone', () => {

  const html = read('dashboard.html');
  assert.match(html, /class="dot \$\{device\.status === 'online' \? 'online' : 'offline'\}"/, 'the name carries a state dot');
  assert.match(html, /class="chip"/, 'and the build rides beside it, not rows down');
});

test('pairing and run sit side by side on a wide screen', () => {

  const html = read('dashboard.html');
  assert.match(html, /class="duo"/, 'one wrapper holds both verbs');
  assert.match(html, /\.duo \{[^}]*grid-template-columns: 1fr 1fr/, 'and the wrapper splits in two');

  const splitAt = html.indexOf('.duo {');
  const queryAt = html.indexOf('@media (max-width: 640px)', splitAt);
  const collapseAt = html.indexOf('.duo { grid-template-columns: 1fr; }', queryAt);
  assert.ok(splitAt > -1 && queryAt > splitAt && collapseAt > queryAt, 'collapsing under it');
});

test('the rail counts what it links to', () => {

  const html = read('dashboard.html');
  assert.match(html, /#device/, 'the device anchor exists');
  assert.match(html, /Device \(\$|Device \($|`Device \(/, 'the rail names the count');
});

test('a new account sees three steps, not a blank console', () => {

  const html = read('dashboard.html');
  assert.match(html, /id="checklist"/, 'the steps have an element of their own');
  assert.match(html, /renderChecklist/, 'and a function that derives them from loaded data');
  assert.match(html, /Pasang extension di browser ini/, 'step one names the install');
  assert.match(html, /Pair device/, 'step two names the pairing');
  assert.match(html, /Jalankan perintah pertama/, 'step three names the first command');
  assert.match(html, /Semua langkah selesai/, 'and completion reads as one line');
});

test('the pairing code is shown, not told', () => {

  const html = read('dashboard.html');
  assert.match(html, /id="pairCodeBox"/, 'the code has a box, not a sentence');
  assert.match(html, /id="pairCopy"/, 'with its own copy control');
  assert.match(html, /id="pairCountdown"/, 'and a countdown');
  assert.match(html, /result\.expiresAt/, 'counted from the server expiry, never a guess');
  assert.match(html, /clearInterval\(pairTimer\)/, 'a new code retires the old countdown');
});

test('the console uses the screen, the prose keeps its measure', () => {

  const html = read('dashboard.html');
  assert.match(html, /wrap wide/, 'the console breaks out of the prose column');
  assert.match(html, /\.wrap\.wide \{[^}]*max-width: 1120px/, 'to eleven-twenty, not infinity');
  assert.match(html, /#devices \{[^}]*grid-template-columns: 1fr 1fr/, 'two cards share a row on desktop');
  const gridAt = html.indexOf('#devices {');
  const queryAt = html.indexOf('@media (max-width: 860px)', gridAt);
  const collapseAt = html.indexOf('#devices { grid-template-columns: 1fr; }', queryAt);
  assert.ok(gridAt > -1 && queryAt > gridAt && collapseAt > queryAt, 'and one column on a phone');
  assert.match(html, /\.duo \{[^}]*grid-template-columns: 1fr 1fr/, 'the verbs keep their shared row');
});

test('the history section lists every command newest first', () => {
  const html = read('dashboard.html');

  for (const head of ['Waktu', 'Status', 'Metode', 'Device', 'Durasi']) {
    assert.ok(html.includes(`<th>${head}</th>`), `the history table heads ${head}`);
  }
  assert.match(html, /<h2>Riwayat<\/h2>/, 'the section names itself');
  assert.match(html, /href="#riwayat"/, 'and the rail links to it');
  assert.match(html, /id="historyRows"/, 'the rows have a body of their own');
  assert.match(html, /renderHistory\(data\.devices\)/, 'and the refresh feeds it the loaded devices');
  assert.match(html, /\.sort\(/, 'newest first, not device order');
  assert.match(html, /relativeTime\(row\.createdAt\)/, 'time reads as relative Indonesian');
  assert.match(html, /formatDuration\(row\.createdAt, row\.completedAt\)/, 'duration spans completed minus created');
  assert.match(html, /class="dot/, 'status pairs a dot with the word');
  assert.match(html, /Belum ada riwayat perintah/, 'emptiness reads as one Indonesian line');
});

test('the history table carries metadata only, like the device cards', () => {
  const html = read('dashboard.html');
  assert.doesNotMatch(html, /command\s*\.\s*(params|value|content|text|result)\b/, 'no payload field is read from a command');
  assert.doesNotMatch(html, /row\s*\.\s*(params|value|content|text|result)\b/, 'neither under its flattened name');
});