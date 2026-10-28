// @last-edited: 2026-10-28 UTC+7.
// @title: landing-dashboard — the device page shows your devices and your tables, nothing else's.
// @state: 77 locks, green; the page moved out of akun.html when the two split, grew the read-only #tabel editor, and became an app shell — the hash decides the active view, the numbers and the status line sit above it so a tab change cannot hide them, and the shell is squared to the radius and the label scale the benchmarks measure.
// @dependencies: test, assert, fs.

// The dashboard is the fulcrum of the full-stack site: the one page that reads the user's own device rows and, since the table editor landed, one page of any table the reader owns.
// Every call goes through an owner-scoped reader RPC — opera_my_ devices for devices, opera_konsol_* for the grid — never a raw table path, so the filter, the page caps and the masking live server-side where a modified client cannot reach past them.
// It shows method and status but never page content, and sends a stranger back to sign-in instead of leaking an empty state that looks broken.

// It is a separate page from the account page on purpose.
// Supabase splits profile (/account/me) from resources, and opencode splits settings from projects; a reader who opened "Akun" to check who they are should not land on a device list, and a reader who opened "Dashboard" should not have to scroll past a profile card.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`landing/${name}`, root), 'utf8');
const css = read('dashboard.css');
const app = read('app.css');
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

test('the hash marks the section being read, and nothing else does', () => {
  const html = read('dashboard.html');

  assert.match(html, /function showSection\(\)/, 'one function owns which view is open');
  assert.match(html, /globalThis\.location\.hash/, 'the hash is the source of truth');
  assert.match(html, /addEventListener\('hashchange', showSection\)/, 'a deep link moves the rail');
  assert.match(html, /link\.setAttribute\('aria-current', 'true'\)/, 'and marks that one');
  assert.match(html, /link\.removeAttribute\('aria-current'\)/, 'and unmarks the rest');
  assert.match(html, /section\.classList\.toggle\('active'/, 'and shows that section alone');

  assert.doesNotMatch(html, /IntersectionObserver/, 'no second source of truth competes with the hash');
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

  assert.match(html, /<h1>Akun ini<\/h1>/, 'the account facts have their own section');
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
    assert.ok(html.includes(`<h1>${heading}</h1>`), `${heading} has a heading of its own`);
  }

  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.rail \{[^}]*grid-auto-flow: column/s, 'the rail has a narrow-screen form, and becomes a horizontal strip below 760px');
});

test('the destructive control looks destructive', () => {
  const html = read('dashboard.html');

  assert.match(html, /class="btn danger"/, 'the revoke control is marked as the dangerous one');
  assert.match(css, /\.btn\.danger\s*\{[^}]*var\(--danger\)/, 'and the danger colour is defined for it');

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
  assert.match(html, /class="brand"[^>]*>[\s\S]{0,400}?Opera Agent</, 'the brand is shared');
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
  assert.match(css, /\.commands li \.online/, 'the stylesheet defines the completed ink');
  assert.match(css, /\.commands li \.offline/, 'and the failed ink');
});

test('a device card leads with its state, not its name alone', () => {

  const html = read('dashboard.html');
  assert.match(html, /class="dot \$\{device\.status === 'online' \? 'online' : 'offline'\}"/, 'the name carries a state dot');
  assert.match(html, /class="chip"/, 'and the build rides beside it, not rows down');
});

test('pairing and run share one wrapper, and one verb at a time takes the row', () => {

  const html = read('dashboard.html');
  assert.match(html, /class="duo"/, 'one wrapper holds both verbs');
  assert.match(css, /\.duo \{[^}]*grid-template-columns: 1fr 1fr/, 'the wrapper knows its two-column form');

  const splitAt = css.indexOf('\n.duo {');
  const queryAt = css.indexOf('@media (max-width: 640px)', splitAt);
  const collapseAt = css.indexOf('.duo { grid-template-columns: 1fr; }', queryAt);
  assert.ok(splitAt > -1 && queryAt > splitAt && collapseAt > queryAt, 'collapsing under it');
  assert.match(css, /\.content\.tabbed > \.duo:has\(> section\.active\) \{[^}]*display: block/, 'and the console shows one verb at a time, so the card takes the row');
});

// WHY THE WRAPPER WAITS FOR ITS OWN VIEW.
// Measured live in the reader's own browser after the shell landed: the table pane was 204px tall in a 650px shell, and the grid sat on its 140px floor while a third of the window stood empty.
// A flex column gives every child room, and the wrapper was a child that was always there: the pairing card nobody opened was taking the table's space.

test('a view nobody opened takes no room from the view that is open', () => {
  assert.match(css, /\.content\.tabbed > \.duo \{ display: none; \}/, 'the wrapper is out of the column until one of its views is open');
  assert.match(css, /\.content\.tabbed > \.duo:has\(> section\.active\)/, 'and it comes back with the view that asks for it');
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
  assert.match(html, /class="wrap wide console"/, 'the console breaks out of the prose column');
  assert.match(css, /\.wrap\.wide \{[^}]*max-width: 1200px/, 'the other wide pages keep the named twelve-hundred measure');
  assert.match(css, /main\.console\.wide \{[^}]*width: 100%/, 'and the console itself runs edge to edge');
  assert.match(css, /main\.console\.wide \{[^}]*max-width: none/, 'because a reader who resizes the window expects the console to follow it');
  assert.match(css, /#devices \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(340px, 1fr\)\)/, 'cards share a row, and one card does not leave half the page empty');
  const gridAt = css.indexOf('#devices {');
  const queryAt = css.indexOf('@media (max-width: 860px)', gridAt);
  const collapseAt = css.indexOf('#devices { grid-template-columns: 1fr; }', queryAt);
  assert.ok(gridAt > -1 && queryAt > gridAt && collapseAt > queryAt, 'and one column on a phone');
  assert.match(css, /\.duo \{[^}]*grid-template-columns: 1fr 1fr/, 'the verbs keep their shared row');
  assert.match(css, /section > \.meta \{[^}]*max-width: 68ch/, 'while the prose inside keeps a readable measure');
});

// WHY THE CONSOLE BECAME AN APP SHELL.
// The reader asked for it twice: the table was still raw, and the sidebar was not where a sidebar belongs.
// Measured in their own browser: the console was a 1200px column floating in a 1455px window, so the rail sat 160px in from the edge, and the table pane stood 148px tall while the window had room for twice that.
// Cline and OpenCode, measured side by side in Chrome, are both an app shell: the sidebar is the window's left column, flush to the edge and full height, and the content beside it takes what is left.

test('the sidebar is the window\'s left column, not a column in the middle of it', () => {
  assert.match(css, /\.layout \{[^}]*grid-template-columns: 220px minmax\(0, 1fr\)/, 'the rail is the first column and the content takes the rest');
  assert.match(css, /\.layout \{[^}]*gap: 0/, 'the two columns touch, the way an app shell has them');
  assert.match(css, /\.rail \{[^}]*border-right: 1px solid var\(--line\)/, 'the rail carries its own edge');
  assert.match(css, /\.rail \{[^}]*padding: 16px 12px/, 'and its own space, so the items are not flush against the window');
  assert.match(css, /\.content \{[^}]*padding: 0 24px/, 'while the content keeps the measure it reads well at');
});

test('the shell is sized by the window, not by a number of pixels', () => {
  assert.match(css, /body:has\(main\.console\) \{[^}]*height: 100dvh/, 'the page is the window');
  assert.match(css, /main\.console \{[^}]*flex: 1/, 'the console takes the space the chrome leaves');
  assert.match(css, /main\.console \{[^}]*min-height: 0/, 'and can shrink to nothing when the window does');
  assert.match(css, /\.layout \{[^}]*min-height: 0/, 'the layout can shrink, so the grid inside it can too');
  assert.match(css, /\.layout \{[^}]*grid-template-rows: minmax\(0, 1fr\)/, 'and the rail is bounded by the shell, not by its longest list');
  assert.match(css, /\.content \{[^}]*overflow: hidden/, 'the content column does not scroll the page; the view inside it does');
  assert.doesNotMatch(css, /calc\(100vh/, 'no view height is written as an offset from the window');
  assert.doesNotMatch(css, /height: clamp\(/, 'and none is clamped to a fixed measure');
});

test('the table pane takes the room the window leaves', () => {
  assert.match(css, /#tabel \{[^}]*flex: 1/, 'the view fills the content column');
  assert.match(css, /#tabel \{[^}]*min-height: 0/, 'and can shrink when the window does');
  assert.match(css, /\.konsolScroll \{[^}]*flex: 1 1 auto/, 'so the grid is what grows');
  assert.match(css, /\.konsolScroll \{[^}]*min-height: 140px/, 'and what keeps a floor for a short window');
});

test('the numbers and the status line sit in a head of their own', () => {
  const html = read('dashboard.html');

  assert.match(html, /class="contentHead"/, 'the head is one element, so it cannot scroll away from the views');
  assert.match(html, /class="contentHead"[\s\S]{0,900}?id="status"/, 'and the status line is in it');
  assert.match(html, /class="contentHead"[\s\S]{0,900}?id="metrics"/, 'and so are the numbers');
});

// WHY THE GRID WAS REBUILT.
// Measured live: the table editor was one block of monospace on the canvas, with no head band and no rule about which values are ids.
// A grid where every character is the same width reads as a terminal dump, not as data, and the reader named it before I did.

test('the grid reads like a table, not a terminal dump', () => {
  const html = read('dashboard.html');

  assert.match(css, /\.konsolGrid \{[^}]*font-family: var\(--font\)/, 'the cells wear the interface font');
  assert.doesNotMatch(css, /\.konsolGrid \{[^}]*font: 12\.5px\/1\.55 var\(--mono\)/, 'a whole grid in mono is a dump');
  assert.match(css, /\.konsolGrid th \{[^}]*text-transform: uppercase/, 'the header is a band, the way every production table prints it');
  assert.match(css, /\.konsolGrid th button \{[^}]*text-transform: inherit/, 'and the browser default on a button cannot undo it');
  assert.match(css, /\.konsolGrid th \{[^}]*color: var\(--muted\)/, 'and it steps back so the values lead');
  assert.match(css, /\.konsolGrid td\.mono,/, 'only the id-like columns keep the mono face');
  assert.match(html, /const konsolMono = \(name\) =>/, 'and the choice comes from the column name, never from the shape of one value');
});

test('the history section lists every command newest first', () => {
  const html = read('dashboard.html');

  for (const head of ['Waktu', 'Status', 'Metode', 'Device', 'Durasi']) {
    assert.ok(html.includes(`<th>${head}</th>`), `the history table heads ${head}`);
  }
  assert.match(html, /<h1>Riwayat<\/h1>/, 'the section names itself');
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

test('the console opens with an app bar, not a marketing hero', () => {
  const html = read('dashboard.html');

  assert.match(html, /class="appBar"/, 'the page opens with a bar that carries state and actions');
  assert.doesNotMatch(html, /class="eyebrow"/, 'no eyebrow announces a release on the console');
  assert.doesNotMatch(html, /<h1>Dashboard<\/h1>/, 'the product name is not the page title');
  assert.match(html, /id="primaryCta"/, 'one action is marked as the next step');
});

test('each view is a page of its own, with one visible title', () => {
  const html = read('dashboard.html');

  for (const id of ['ringkasan', 'device', 'riwayat', 'tabel', 'dengar', 'pairing', 'aksi', 'akun']) {
    assert.match(html, new RegExp(`<section id="${id}"[^>]*>[\\s\\S]{0,160}?<h1>`), `${id} opens with its own h1`);
  }
  assert.equal((html.match(/class="active"/g) || []).length, 1, 'exactly one view is open on load');
  assert.match(css, /section h1 \{/, 'and that title has a rule of its own');
});

test('a tab change never hides the status line or the numbers', () => {
  const html = read('dashboard.html');
  const firstSection = html.indexOf('<section id="ringkasan"');
  assert.ok(firstSection > 0, 'the first view exists');

  for (const id of ['status', 'metrics', 'statDevices', 'statOnline', 'statCommands']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0 && at < firstSection, `#${id} sits above the views, so switching tabs cannot hide it`);
  }
});

test('the rail groups its links instead of listing eight equals', () => {
  const html = read('dashboard.html');
  const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
  const groups = [...rail.matchAll(/<p class="railGroup">([^<]+)<\/p>/g)].map((match) => match[1]);

  assert.deepEqual(groups.filter((group) => group !== 'Tabel data'), ['Pantau', 'Kelola', 'Akun'], 'three named view groups, in reading order');
  assert.equal(groups.length, 4, 'and one contextual group, which only the view that needs it asks for');
  assert.match(rail, /<p class="railGroup">Tabel data<\/p>/, 'that group names the tables, so views and objects never read as one list');
  assert.match(css, /\.railGroup \{/, 'and a rule that sets them apart from the links');
});

// WHY THE TABLE LIST MOVED UNDER THE ITEM THAT ASKS FOR IT.
// Measured against Cline: the list of objects of a view opens directly under that view's item, not at the far end of the rail.
// The reader arrived at Tabel and found its list of tables below "Akun", at the end of a column they had to scroll to find.

test('the table list opens under the item that asks for it', () => {
  const html = read('dashboard.html');
  const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));

  const tabelAt = rail.indexOf('href="#tabel"');
  const listAt = rail.indexOf('id="railTables"');
  const pairingAt = rail.indexOf('href="#pairing"');
  assert.ok(tabelAt > -1 && listAt > tabelAt && pairingAt > listAt, 'Tabel, then its own list, then the next item — the way the benchmarks place it');
});

test('the browser tab names the view being read', () => {
  const html = read('dashboard.html');

  assert.match(html, /document\.title = `\$\{heading\} — Opera Agent`/, 'the title is written by the tab controller, from the view it opened');
});

test('the history can be narrowed without reading every command', () => {
  const html = read('dashboard.html');

  assert.match(html, /id="historySearch"/, 'a search box narrows the list');
  assert.match(html, /data-filter="failed"/, 'and a status filter names the failing rows');
  assert.match(html, /id="historyCount"/, 'the count says how many rows the filter left');
  assert.match(html, /function paintHistory\(\)/, 'one function repaints from the rows already loaded');
  assert.match(css, /\.history th \{[^}]*position: sticky/, 'the head holds while the list scrolls');
});

test('an empty view offers the step that fills it', () => {
  const html = read('dashboard.html');

  assert.match(html, /Belum ada device\.<\/strong>[\s\S]{0,240}?href="#pairing"/, 'the empty device list points at pairing');
  assert.match(html, /Belum ada riwayat perintah\.[\s\S]{0,240}?href="#aksi"/, 'the empty history points at the first run');
});

// WHY THE EMPTY STATE WAS REBUILT.
// Measured on the reader's own screen: the empty state was a dashed box with a bold sentence and a link inside the sentence.
// Both benchmarks centre theirs, give the sentence its own line under the title, and mark the surface with the product's own glyph.
// A dashed box is a form field that was left blank, and it is the first thing every new account sees.

test('an empty view looks like a page, not a dashed box', () => {
  assert.match(css, /\.empty \{[^}]*text-align: center/, 'the empty state is centred, the way both benchmarks centre theirs');
  assert.match(css, /\.empty \{[^}]*border: 1px solid var\(--line\)/, 'and its edge is the card edge the whole console uses');
  assert.doesNotMatch(css, /\.empty \{[^}]*border: 1px dashed/, 'a dashed edge says a field was left blank');
  assert.match(css, /\.empty::before \{[^}]*mask/, 'the site mark is the watermark on it');
});

test('the title of an empty view stands on its own line', () => {
  const html = read('dashboard.html');

  assert.match(html, /<strong>Belum ada riwayat perintah\.<\/strong>\s*<p>/, 'the sentence under the title is a block of its own');
  assert.match(html, /<strong>Belum ada device\.<\/strong>\s*<p>/, 'and so is the one the device list writes');
  assert.match(html, /<strong>Belum ada sesi dengar\.<\/strong>\s*<p>/, 'and the one the listen list writes');
});

test('the numbers are three cards, not one ruled row', () => {
  assert.match(css, /\.metrics \{[^}]*gap: 12px/, 'the figures stand apart, the way the benchmark stands its cards apart');
  assert.match(css, /\.metrics > div \{[^}]*border: 1px solid var\(--line\)/, 'and each carries its own edge');
  assert.doesNotMatch(css, /\.metrics \{[^}]*background: var\(--line\)/, 'the strip is not one table row with hairlines between its cells');
  assert.doesNotMatch(css, /\.metrics \{[^}]*gap: 1px/, 'and not a grid of hairlines either');
});

test('the main action follows the state the page already knows', () => {
  const html = read('dashboard.html');

  assert.match(html, /function paintPrimaryAction\(\)/, 'one function decides the next step');
  assert.match(html, /if \(!lastSeen\.installed\)/, 'a missing extension is offered the download');
  assert.match(html, /cta\.textContent = 'Pair device'/, 'an installed browser with no device is offered pairing');
  assert.match(html, /cta\.textContent = 'Jalankan aksi'/, 'a live device is offered a run');
});

test('the console keeps its own scale without redefining a shared token', () => {
  assert.match(css, /--app-radius:/, 'the page adds a token of its own');
  assert.doesNotMatch(css, /:root\s*\{/, 'and never opens the shared token block');
  for (const token of ['--paper', '--surface', '--ink', '--accent', '--radius', '--shadow']) {
    assert.doesNotMatch(css, new RegExp(`${token}\\s*:`), `the page does not restate ${token}`);
  }
});

test('the table editor keeps its row rhythm and its first column in view', () => {
  assert.match(css, /\.railList button \{[^}]*white-space: nowrap/, 'one sidebar row stays one row high');
  assert.match(css, /\.konsolGrid tbody td:first-child \{[^}]*position: sticky/, 'the first column stays put while the grid scrolls sideways');
});

// Measured live: the Tabel view stacked two left columns — the rail, and the editor's own list of tables — and the second one decided the height of the page.
// A view whose object is a list belongs to one column, and that column is the rail.

test('the table list lives in the rail, so a view has one left column', () => {
  const html = read('dashboard.html');

  assert.match(html, /<div class="railContext" id="railTables" hidden>/, 'the rail has a contextual part, empty until a view needs it');
  assert.match(html, /<div class="railList" id="konsolList" role="group" aria-label="Daftar tabel"><\/div>/, 'and the table list is what fills it');

  const from = html.indexOf('<section id="tabel"');
  const section = html.slice(from, html.indexOf('</section>', from));
  assert.doesNotMatch(section, /railList|konsolSide/, 'the view itself carries no second sidebar');
  assert.match(section, /class="konsolScroll"/, 'the grid is the view, from the search bar to the pager');
});

test('the rail scrolls itself, because a list of tables is longer than a window', () => {
  assert.match(css, /\.rail \{[^}]*overflow-y: auto/, 'the rail is its own scroll container');
  assert.match(css, /\.rail \{[^}]*min-height: 0/, 'and it can shrink inside the shell');
  assert.match(css, /\.layout \{[^}]*grid-template-rows: minmax\(0, 1fr\)/, 'bounded by the shell, not by its longest list');
});

test('the active rail item is filled, not a shade of paper', () => {
  assert.match(css, /\.rail a\[aria-current="true"\] \{[^}]*background: var\(--accent\)/, 'the current item carries the accent');
  assert.match(css, /\.rail a\[aria-current="true"\] \{[^}]*color: var\(--on-fill, #fff\)/, 'and reads in an ink that answers the fill — white on paper, dark on the brand green');
});

test('the row count on a filled rail row is readable', () => {
  assert.match(css, /\.railList button\[aria-current="true"\] \.meta \{[^}]*color: inherit/, 'the count takes the row\'s own ink, because the muted grey on the brand green is 1.5:1');
});

test('the table view is one box bounded by the window', () => {
  assert.match(css, /#tabel \{[^}]*display: flex/, 'the view is a column, not a grid with a second sidebar');
  assert.match(css, /#tabel \{[^}]*flex: 1/, 'and it fills the room the shell leaves it');
  assert.match(css, /\.konsolScroll \{[^}]*flex: 1/, 'the grid takes the space the bar and the pager leave, so the pager stays on screen');
  assert.doesNotMatch(css, /\.konsolScroll \{[^}]*max-height: 460px/, 'no fixed pixel height decides what the reader can see');
});

test('a table row in the rail is one row high, not two', () => {
  assert.match(css, /\.railList button \{[^}]*height: 30px/, 'the row carries its own height, so an inherited line-height cannot double it');
  assert.match(css, /\.railList button \{[^}]*white-space: nowrap/, 'and stays one row high');
});

test('a rail that carries a table list stays vertical on a phone', () => {
  assert.match(css, /\.rail:has\(> \.railContext:not\(\[hidden\]\)\)/, 'twenty-seven items in a horizontal strip is a strip nobody can use');
});

// MEASURED LIVE ON THE #DENGAR VIEW, IN THE READER'S OWN BROWSER.
// #tabel is an id and the rule that hides a view that is not active is a class rule, so the id outranked it: the table editor was still on screen, 376px tall, above the view the reader had chosen.
// The table was on every page of the console, and the reader named it before I did.

test('the table view is a view, not a fixture on every page', () => {
  const html = read('dashboard.html');

  assert.match(css, /#tabel:not\(\.active\) \{ display: none; \}/, 'the table editor leaves the screen the moment another view is chosen');

  const sections = [...html.matchAll(/<section id="([a-z]+)"/g)].map((match) => match[1]);
  assert.ok(sections.length >= 8, `the console has eight views, found ${sections.length}`);

  for (const id of sections) {
    if (!new RegExp(`^#${id}\\s*\\{[^}]*display:`, 'm').test(css)) continue;
    assert.match(css, new RegExp(`^#${id}:not\\(\\.active\\)\\s*\\{[^}]*display: none;`, 'm'), `#${id} owns its own display, so it needs the hidden state too — an id outranks the class rule`);
  }
});

test('the rail opens with a head, and it can be put away', () => {
  const html = read('dashboard.html');

  assert.match(html, /class="railHead"/, 'the rail opens with a head, the way every app shell does');
  assert.match(html, /id="railCollapse"/, 'with one control that puts it away');
  assert.match(html, /classList\.toggle\('rail-collapsed'\)/, 'and a state that control writes');
  assert.match(css, /\.railHead \{/, 'the head has a rule of its own');
  assert.match(css, /body\.rail-collapsed \.layout/, 'collapsed, the column gives its width back to the content');
  assert.match(css, /\.railIcon/, 'and each item carries a mark');
});

test('every view is named by a mark, not by a word alone', () => {
  const html = read('dashboard.html');

  for (const href of ['#ringkasan', '#device', '#riwayat', '#dengar', '#tabel', '#pairing', '#aksi', '#akun']) {
    assert.match(html, new RegExp(`href="${href}"[^>]*>[\\s\\S]{0,240}?<svg class="railIcon"`), `${href} carries its mark`);
  }
  const marks = html.match(/<svg class="railIcon"/g) || [];
  assert.ok(marks.length >= 9, `the marks are written once per item, found ${marks.length}`);
  for (const mark of html.matchAll(/<svg class="railIcon"[^>]*>/g)) {
    assert.match(mark[0], /aria-hidden="true"/, 'and every mark is decorative, so the accessible name stays the word beside it');
  }
});

test('the rail count cannot wipe the mark it rides beside', () => {
  const html = read('dashboard.html');

  assert.match(html, /id="railDeviceLabel"/, 'the device count has a label of its own to write into');
  assert.match(html, /\$\('railDeviceLabel'\)\.textContent = `Device \(/, 'and the count writes the label, never the link that holds the mark');
  assert.doesNotMatch(html, /querySelector\('\.rail a\[href="#device"\]'\)\.textContent/, 'writing the link itself would delete the mark');
});

// WHY THE CONSOLE RE-POINTS THE CORE TOKENS AT ALL.
// The shared sheet's components read var(--paper), var(--surface) and var(--ink) directly, so a dark canvas cannot be expressed with new tokens alone.
// The site's rule says a page may add a token and never override a core one, so this is the one deliberate exception, scoped to the two signed-in surfaces.

test('the console declares its own dark scale, and the site keeps its own', () => {
  assert.match(app, /body\.app-dark \{/, 'the app pages name the dark scale');

  for (const token of ['--paper', '--surface', '--ink', '--muted', '--line', '--accent']) {
    assert.match(app, new RegExp(`body\\.app-dark \\{[^}]*${token}\\s*:`), `${token} is re-pointed for the console, and nowhere else`);
  }
  assert.match(app, /--ink-panel|--panel-text/, 'and the dark scale reuses the language .panelDark already speaks');
  assert.match(app, /--accent:\s*#3ecf8e|--accent:\s*var\(--brand\)/, 'the accent is the site\'s own brand green, which reads on a dark canvas');

  assert.doesNotMatch(css, /:root\s*\{/, 'the page sheet still never opens the shared block');
  for (const token of ['--paper', '--surface', '--ink', '--line', '--accent', '--radius', '--shadow']) {
    assert.doesNotMatch(css, new RegExp(`${token}\\s*:`), `dashboard.css restates no core token, ${token} least of all`);
  }
  assert.doesNotMatch(app, /:root\s*\{/, 'and neither does the shared app sheet');
});

test('the chrome of an app page answers in the same ink as its canvas', () => {
  const html = read('dashboard.html');
  assert.match(html, /<body class="app-dark">/, 'the console names itself dark');
  assert.match(app, /body\.app-dark header/, 'the shared header answers in it');
  assert.match(app, /body\.app-dark footer/, 'and so does the footer');
  assert.match(app, /body\.app-dark header nav \.navCta \{/, 'the sign-in pill cannot stay white ink on a dark canvas');
  assert.match(app, /body\.app-dark \.brandMark rect \{/, 'and the brand mark answers in light, not in the canvas it sits on');
  assert.match(app, /body\.app-dark \.chip\.warn \{/, 'the one tint site.css hardcodes is re-pointed too');
});

test('a primary action on a dark canvas carries dark ink', () => {
  assert.match(app, /body\.app-dark \.btn\.primary \{/, 'the filled action is re-inked');
  assert.match(app, /body\.app-dark \.btn\.primary \{[^}]*color: #06120d/, 'white on the brand green is 1.9:1, so the console inks it dark');
});

// Measured live on the dark canvas: the checklist tick still painted #fff on the brand green, and the danger button painted it on the light salmon.
// Both read at under 2.4:1, which is a tick nobody can see.

test('no white ink sits on a bright fill', () => {
  for (const sheet of [css, app]) {
    assert.doesNotMatch(sheet, /background: var\(--(?:accent|danger)\)[^}]*color: #fff/, 'a bright fill takes the ink its canvas asks for');
    assert.doesNotMatch(sheet, /background: var\(--accent\)[^}]*color: #fff/, 'and the accent fill least of all');
  }
  assert.match(css, /\.checklist li\.done \.box \{[^}]*color: var\(--on-fill, #fff\)/, 'the readiness tick answers the canvas');
  assert.match(css, /\.btn\.danger:hover \{[^}]*color: var\(--on-fill, #fff\)/, 'and so does the destructive hover');
});

// WHY THE SHELL IS SQUARED AND NOT PILLED.
// Measured live on the reader's own screen: every control in the console was a 980px pill, and the pill is the consumer shape — Cline's button is 6px, Cohere's control is 0-2px.
// A pill in a control panel reads as a sticker: it says "look at me", and a console is full of controls that all say it at once.
// The numbers below are the benchmarks' own, measured in the reader's browser.

test('the shell is squared to the benchmark, not pill-shaped', () => {
  assert.match(css, /main\.console \{[^}]*--app-radius: 10px/, 'a card is 10px, the radius Cline measures');
  assert.match(css, /main\.console \{[^}]*--app-radius-sm: 6px/, 'and a control is 6px, the radius Cline measures');
  assert.match(app, /body\.app-dark \{[^}]*--radius: 10px/, 'the account page answers in the same shape');
  assert.match(app, /body\.app-dark \{[^}]*--radius-sm: 6px/, 'controls included');
  assert.match(app, /body\.app-dark \.btn \{[^}]*border-radius: var\(--radius-sm\)/, 'and the shared pill never reaches the shell');
});

test('the account nav label is a label, and the rule that sets it reaches the page', () => {
  assert.match(app, /\.appCard\.accountNav h2 \{[^}]*font-size: 11px/, 'the nav label is 11px, the label scale the console uses');
  assert.match(app, /\.appCard\.accountNav h2 \{[^}]*letter-spacing: \.08em/, 'and it tracks .08em');
  assert.doesNotMatch(app, /^\.accountNav h2 \{/m, 'the rule that .appCard h2 outranked is gone, not left behind');
});

test('one label scale in the console: 11px, .08em, 600', () => {
  for (const selector of ['\\.metrics dt', '\\.railGroup', '\\.railList \\.konsolGroup', '\\.konsolGrid th']) {
    assert.match(css, new RegExp(`${selector} \\{[^}]*font-size: 11px`), `${selector} is 11px, the size Cline prints its labels in`);
    assert.match(css, new RegExp(`${selector} \\{[^}]*letter-spacing: \\.08em`), `${selector} tracks .08em, the way Cline tracks`);
    assert.match(css, new RegExp(`${selector} \\{[^}]*font-weight: 600`), `${selector} carries the same weight`);
  }
  assert.match(css, /\.konsolGrid th\.mono \{[^}]*font-family: var\(--font\)/, 'and the band is one band, even over a column of ids');
});

test('the pager ends on the rail\'s line', () => {
  assert.match(css, /\.content\.tabbed > section\.active \{[^}]*margin-bottom: 0/, 'the open view has no margin under it');
  assert.match(css, /\.content\.tabbed \.duo > section\.active \{[^}]*margin-bottom: 0/, 'and neither has the other half of the wrapper');
  assert.match(css, /\.konsolFoot \{[^}]*margin: 12px 0 0/, 'the pager has none under it either, so it ends where the rail ends');
});

test('the console\'s spacing sits on one scale', () => {
  assert.match(css, /main\.console \{[^}]*--app-title: 18px/, 'a view title is 18px, the size Cline prints a panel title in');
  assert.match(css, /\.contentHead \{[^}]*padding-top: 16px/, 'the head starts on 16');
  assert.match(css, /\.metrics > div \{[^}]*padding: 12px 16px/, 'a card breathes on 12 and 16');
  assert.match(css, /section > \.meta \{[^}]*margin: 0 0 16px/, 'a note is followed by 16');
  assert.match(css, /\.konsolBar \{[^}]*margin: 0 0 8px/, 'a bar is followed by 8');
  assert.match(css, /\.railHead \{[^}]*min-height: 36px/, 'and the rail head is as tall as the row it shares a line with');
});