// @last-edited: 2026-10-10 UTC+7.
// @title: konsol-tables — the table editor reads through definer functions, never a grant.
// @state: 14 locks, green; pins migration 20261010090000 and the #tabel section of dashboard.html.
// @dependencies: test, assert, fs.

// The console's isolation rests on two layers, and this file pins both copies of the truth: the scope map inside opera_konsol_scope() decides what a table's rows mean, and every USING clause repeats the same parenthesized qual.
// The repetition is the risk, so the drift lock compares the two copies string for string — a policy edited by hand fails here before it ships.
// The page side is pinned in landing-dashboard test one; this file adds the locks only this feature needs: the mask list, the clamps, the operator gate, and a grid that escapes and never writes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const sql = fs.readFileSync(new URL('supabase/migrations/20261010090000_opera_agent_konsol_tables.sql', root), 'utf8');
const html = fs.readFileSync(new URL('landing/dashboard.html', root), 'utf8');

const mapRows = [...sql.matchAll(/^ {4}\('([a-z0-9_]+)', '(owner|operator)', '(.*)'\),?$/gm)]
  .map((match) => ({ table: match[1], scope: match[2], qual: match[3] }));
const map = new Map(mapRows.map((row) => [row.table, row]));

const policyRows = [...sql.matchAll(/^create policy (\w+) on public\.([a-z0-9_]+) for select to authenticated using \((.*)\);$/gm)]
  .map((match) => ({ name: match[1], table: match[2], qual: match[3] }));
const dropRows = [...sql.matchAll(/^drop policy if exists (\w+) on public\.([a-z0-9_]+);$/gm)]
  .map((match) => ({ name: match[1], table: match[2] }));

const balanced = (text) => {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
};

test('the map names exactly the project\'s sixteen tables, seven of them operator-only', () => {
  const expectedOwner = [
    'opera_audit', 'opera_commands', 'opera_devices', 'opera_listen_chunks',
    'opera_listen_segments', 'opera_listen_sessions', 'opera_pairing_codes',
    'opera_watch_events', 'opera_workflow_runs'
  ];
  const expectedOperator = [
    'opera_methods', 'opera_releases', 'opera_skills', 'opera_update_events',
    'opera_v2_releases', 'opera_workflow_versions', 'opera_workflows'
  ];
  assert.equal(mapRows.length, 16, 'the map has one row per table');
  assert.deepEqual(mapRows.filter((row) => row.scope === 'owner').map((row) => row.table).sort(), expectedOwner, 'owner-scoped tables are exactly the nine with an owner path');
  assert.deepEqual(mapRows.filter((row) => row.scope === 'operator').map((row) => row.table).sort(), expectedOperator, 'operator-scoped tables are exactly the seven ownerless ones');
});

test('every qual is one fully parenthesized group', () => {
  for (const row of mapRows) {
    assert.ok(row.qual.startsWith('(') && row.qual.endsWith(')'), `${row.table} wraps its qual in one group`);
    assert.ok(balanced(row.qual), `${row.table} has balanced parentheses`);
  }
});

test('every policy qual equals the map qual, string for string', () => {
  assert.equal(policyRows.length, 16, 'this file creates sixteen read policies');
  for (const row of policyRows) {
    const mapped = map.get(row.table);
    assert.ok(mapped, `${row.table} is in the scope map`);
    assert.equal(row.qual, mapped.qual, `${row.table}: the policy repeats the map verbatim`);
  }
});

test('the sixteen tables each carry exactly one read policy, dropped and rebuilt', () => {
  assert.equal(dropRows.length, 16, 'each policy is dropped before it is created');
  assert.deepEqual(dropRows.map((row) => `${row.name}:${row.table}`).sort(), policyRows.map((row) => `${row.name}:${row.table}`).sort(), 'every drop names the same policy and table as its create');
  for (const row of mapRows) {
    const policy = policyRows.find((candidate) => candidate.table === row.table);
    assert.ok(policy, `${row.table} has a policy`);
    const suffix = row.scope === 'owner' ? '_owner_read' : '_operator_read';
    assert.equal(policy.name, `${row.table}${suffix}`, `${row.table} policy is named for its scope`);
  }
});

test('no table grant appears anywhere; the flag table gives its defaults back', () => {
  assert.doesNotMatch(sql, /\bgrant\s+(select|update|insert|delete|all|truncate|references|trigger)\b/i, 'the migration adds no table grant — the missing grant is layer one');
  assert.match(sql, /revoke all on public\.opera_operator from anon, authenticated;/, 'the flag table takes back the grants Supabase hands every new table');
  assert.match(sql, /revoke execute on function public\.opera_konsol_scope\(\) from public, anon, authenticated;/, 'the scope map itself is callable by nobody');
  assert.match(sql, /revoke execute on function public\.opera_konsol_tables\(\) from public, anon;/, 'anon holds neither reader');
  assert.match(sql, /grant execute on function public\.opera_konsol_tables\(\) to authenticated;/, 'signed-in callers get the sidebar reader');
  assert.match(sql, /revoke execute on function public\.opera_konsol_table\(text, integer, integer, text, text, text\) from public, anon;/, 'anon holds neither reader');
  assert.match(sql, /grant execute on function public\.opera_konsol_table\(text, integer, integer, text, text, text\) to authenticated;/, 'signed-in callers get the page reader');
  assert.doesNotMatch(sql, /grant execute on function public\.opera_konsol_scope/, 'the scope map is never granted to anyone');
});

test('the flag table is row-secured, seeded, and never granted', () => {
  assert.match(sql, /create table if not exists public\.opera_operator \(/, 'the flag table exists');
  assert.equal((sql.match(/enable row level security/g) || []).length, 2, 'the flag table and opera_skills are row-secured');
  assert.doesNotMatch(sql, /enable row security;/, 'the bare grammar this server rejects never appears');
  assert.match(sql, /order by min\(created_at\) asc limit 1/, 'the seed is the earliest paired device owner, not a hardcoded id');
  assert.match(sql, /on conflict \(user_id\) do nothing/, 'the seed is idempotent');
  assert.match(sql, /alter table public\.opera_skills enable row level security;/, 'opera_skills gains the second layer its siblings always had');
});

test('the readers are definer functions behind a session gate', () => {
  assert.equal((sql.match(/security definer/g) || []).length, 2, 'exactly the two readers are definer functions');
  assert.equal((sql.match(/set search_path = public, extensions/g) || []).length, 2, 'both readers pin their search_path');
  assert.equal((sql.match(/'Not signed in\.'/g) || []).length, 2, 'both readers refuse a missing session before anything else');
  assert.match(sql, /create or replace function public\.opera_konsol_scope\(\)\nreturns table \(tbl text, scope text, qual text\)\nlanguage sql stable/, 'the scope map is a plain stable sql function');
  assert.doesNotMatch(sql, /opera_konsol_scope\(\)[\s\S]{0,120}security definer/, 'the scope map is not definer — it holds no rows and no secrets');
  assert.match(sql, /'Unknown table\.'\)/, 'the unknown-table refusal is a fixed sentence for the page to translate');
  assert.match(sql, /'That table belongs to the operator account\.'\)/, 'the operator refusal is its own sentence');
});

test('the row reader clamps every number and name the caller sends', () => {
  assert.match(sql, /v_limit integer := least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\);/, 'limit clamps into 1..200 whatever the caller sends');
  assert.match(sql, /v_offset integer := greatest\(coalesce\(p_offset, 0\), 0\);/, 'a negative offset is a first page');
  assert.match(sql, /v_search text := left\(coalesce\(p_search, ''\), 64\);/, 'search text is cut to 64 characters before it touches a query');
  assert.match(sql, /v_dir text := case when lower\(coalesce\(p_dir, 'desc'\)\) = 'asc' then 'asc' else 'desc' end;/, 'direction is one of two words, never spliced');
  assert.match(sql, /c\.column_name = p_sort/, 'a sort column must exist in the table before it is quoted');
  assert.match(sql, /v_order := format\('%I %s', p_sort, v_dir\);/, 'a proven column still travels quoted');
  assert.match(sql, /s\.tbl = lower\(coalesce\(p_table, ''\)\)/, 'the table name is folded and compared against the map, never spliced');
});

test('the default page never serialises a row the search did not ask for', () => {
  assert.match(sql, /v_where := v_rec\.qual;/, 'the default path is the bare qual');
  assert.match(sql, /if v_search <> '' then/, 'the serialising path is taken only behind a typed search');
  assert.match(sql, /to_jsonb\(%I\)::text ilike \$1/, 'the search binds a placeholder, never concatenates text');
  assert.equal((sql.match(/using \('%' \|\| v_search \|\| '%'\)/g) || []).length, 2, 'both counts and rows bind the same parameter');
});

test('secrets are masked in the database, never in the page', () => {
  assert.match(sql, /array\['token_hash', 'code_hash'\]/, 'the short-hash list is fixed here');
  assert.match(sql, /array\['audio_base64', 'crx_base64'\]/, 'the blob list is fixed here');
  assert.match(sql, /left\(v_row ->> v_key, 4\) \|\| '…'/, 'a hash keeps four characters and an ellipsis');
  assert.match(sql, /length\(v_row ->> v_key\) \|\| ' chars omitted'/, 'a blob reports its length and nothing else');
  assert.match(sql, /jsonb_build_object\('token_hash', '…'\)/, 'a token hash nested in details is masked too');
  assert.match(sql, /length\(v_detail ->> 'archive_b64'\) \|\| ' chars omitted'/, 'an archive nested in details reports its length');
});

test('the tautology is gone and workflow runs stay owned', () => {

  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /device_name = d\.device_name/, 'the silent drift that opened every run to every device is not reintroduced');
  assert.match(map.get('opera_workflow_runs').qual, /\(opera_workflow_runs\.user_id = auth\.uid\(\)\) or exists/, 'a run is readable to its user and to the owner of its device');
  assert.equal((sql.match(/auth\.uid\(\)/g) || []).length >= 20, true, 'the map filters by session identity throughout');
});

test('the dashboard section exists, is reachable, and reads through the readers', () => {
  assert.match(html, /<section id="tabel">/, 'the console has its own section');
  assert.match(html, /<h2>Tabel<\/h2>/, 'the section names itself');
  assert.equal((html.match(/<a href="#tabel">Tabel<\/a>/g) || []).length, 2, 'the rail and the tab strip both lead to it');
  assert.match(html, /if \(target === 'tabel'\) konsolInit\(\);/, 'the console initialises on first visit, not on page load');
  assert.match(html, /konsolRpc\('opera_konsol_tables'/, 'the sidebar lists through the table reader');
  assert.match(html, /konsolRpc\('opera_konsol_table'/, 'each page comes through the row reader');
});

test('the dashboard grid escapes, caps, and never writes', () => {
  assert.match(html, /title="\$\{esc\(cell\.full\)\}">\$\{esc\(cell\.text\)\}/, 'every cell escapes the whole value into the title and the shown text into the cell');
  assert.match(html, /\$\('konsolJson'\)\.textContent = JSON\.stringify\(record, null, 2\)/, 'the JSON pane sets text, never markup');
  assert.match(html, /const cap = 5000;/, 'an export stops at five thousand rows');
  assert.match(html, /p_limit: 200/, 'an export page is the reader\'s own maximum');
  assert.match(html, /id="konsolSearch"[^>]*maxlength="64"/, 'the search box mirrors the reader\'s 64-character cut');
  assert.doesNotMatch(html, /method: '(PUT|PATCH|DELETE)'/, 'the console issues no write verb — it reads');
  assert.match(html, /if \(seq !== konsol\.seq\) return;/, 'a stale response cannot land over a newer one');
  assert.match(html, /const guarded = \/\^\[=\+\\-@\]\/\.test\(text\)/, 'a cell that begins with =, +, - or @ cannot become a spreadsheet formula');
  assert.match(html, /'Unknown table\.'\s*:\s*'Tabel itu tidak dikenal\.'/, 'the unknown-table refusal is translated');
  assert.match(html, /'That table belongs to the operator account\.'\s*:\s*'Tabel itu hanya untuk akun operator\.'/, 'the operator refusal is translated');
});

test('the grid declares a header cell before any data arrives', () => {
  assert.match(html, /<thead id="konsolHead"><tr><th scope="col">/, 'a static header row exists so the table is never headerless');
  assert.match(html, /if \(!\$\('konsolRows'\)\.children\.length\) \$\('konsolHead'\)\.innerHTML = '';/, 'a first load that fails takes the promise down with it');
});
