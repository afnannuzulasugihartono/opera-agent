// @last-edited: 2026-10-11 UTC+7.
// @title: claim-clock — the long-poll claim must never stamp a command with a frozen clock.
// @state: 4 locks; the clock invariant, the overload count, the signature the bridge calls, and the grants.
// @dependencies: node:test, assert, fs.

// WHY THIS FILE EXISTS
//
// opera_claim_next_wait holds ONE transaction for up to 25 seconds while it waits for
// a command. In PostgreSQL now() is transaction_timestamp(), frozen at BEGIN, so every
// now() inside it reads a clock that is up to 25 seconds stale. clock_timestamp()
// reads the real clock, and the function's own elapsed-time measurements already used
// it — the claim stamp did not.
//
// The live consequence, measured before the fix: 306 of 9732 commands (3.1%) carried
// a claimed_at EARLIER than their created_at, the worst by 5029ms — almost exactly
// the 5s wait window the extension sends. Every latency number derived from those
// columns was wrong for exactly the fastest claims.
//
// The second read was worse in kind: expires_at > now() in the candidate SELECT meant
// a command that expired while the caller waited was still handed out.
//
// WHY THIS RUNS WITHOUT POSTGRES, AND WHY THAT IS STILL A LOCK
//
// The behavioural proof needs a real database and lives in tests/postgres/. This file
// pins the things that can be checked from the migration and the call site, and the
// second of those four is the one that would have caught the mistake actually made
// while writing the fix: it was first written with the parameter order
// (text,text,integer,text,integer,jsonb). PostgreSQL matches CREATE OR REPLACE on the
// argument type list INCLUDING ORDER, so that did not replace the function — it
// created a second overload and left the buggy body live. With two overloads PostgREST
// cannot choose one for a named-argument call, so the extension's pull loop could not
// resolve the function at all. The bug was found by reading pg_proc, not by a test.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

const MIGRATION = 'supabase/migrations/20261011120000_opera_agent_claim_clock_timestamps.sql';
const migration = read(MIGRATION);

// The function body only: between the first $$ and the SECOND one, with every SQL
// comment line removed. Ending at the second $$ matters — the trailing
// `comment on function` string after it names now() in prose, and including it would
// make the count check unsatisfiable while teaching the next reader to delete the
// comment instead of the bug. A comment that mentions now() is documentation; a
// statement that calls it is the defect.

const open = migration.indexOf('$$');
const close = migration.indexOf('$$', open + 2);
const body = migration.slice(open + 2, close).split('\n')
  .filter((l) => !l.trimStart().startsWith('--')).join('\n');

test('the long-poll claim reads a clock that moves, never the one frozen at BEGIN', () => {
  // WHY this is the lock and not a lint: the failure mode is silent. With now() the
  // function still returns a correct command and a correct waitedMs — waitedMs was
  // always measured with clock_timestamp() — so nothing at runtime looks wrong. Only
  // the row it writes disagrees with reality, and only for the claims that came
  // fastest, which are the ones nobody re-examines.
  assert.doesNotMatch(body, /now\(\)/,
    'no executable now() survives in the claim function');

  const clocks = body.match(/clock_timestamp\(\)/g) || [];
  assert.ok(clocks.length >= 8,
    `every elapsed-time read uses clock_timestamp() (found ${clocks.length})`);

  // WHY this pair specifically, rather than the bare count: a function rewritten with
  // one clock_timestamp() and the rest of the drift left would pass a count check and
  // keep the bug on exactly these two lines.
  assert.match(body, /claimed_at\s*=\s*clock_timestamp\(\)/,
    'the claim stamp is the moment of the claim, not the start of the transaction');
  assert.match(body, /expires_at\s*>\s*v_now/,
    'the candidate SELECT reads the expiry against the current clock, so an expired command is not handed out');
});

test('exactly one overload of the claim function can exist', () => {
  // WHY the drop is part of the fix and not a cleanup: a second overload makes the
  // function unresolvable for a named-argument call, which is how the bridge calls it.
  // That is a production break, not a warning, so the migration has to remove the
  // wrong-signature copy before it writes the right one.
  const wrong = /drop function if exists public\.opera_claim_next_wait\(text, text, integer, text, integer, jsonb\);/;
  assert.match(migration, wrong,
    'the overload that a wrong parameter order would create is dropped explicitly');

  const declared = migration.match(/create or replace function public\.opera_claim_next_wait\(/g) || [];
  assert.equal(declared.length, 1, 'the migration declares the function exactly once');

  // WHY the second token and not the last: a parameter line reads
  // "p_wait_ms integer default 12000", so the LAST token is the default and the type
  // is in the middle. Reading the last token would have compared ["text","text",
  // "null","null","null","12000"] against the real signature and failed on correct
  // SQL -- which is how a lock teaches people to stop reading it.

  const signature = /create or replace function public\.opera_claim_next_wait\(([^)]*)\)/.exec(migration)[1];
  const types = signature.split(',').map((s) => s.trim().split(/\s+/)[1]);
  assert.deepEqual(types, ['text', 'text', 'text', 'integer', 'jsonb', 'integer'],
    'and its parameter types are the ones the database already holds');
});

test('the signature the migration writes is the signature the bridge calls', () => {
  // WHY this cross-check is the one that would have caught the mistake: the migration
  // and the call site live in different files and were written at different times, and
  // nothing in PostgreSQL warns when they disagree. It agrees only by luck otherwise.
  const bridge = read('supabase/functions/opera-agent-bridge/index.ts');
  assert.match(bridge, /rpc\("opera_claim_next_wait", \{/,
    'the bridge still calls the long-poll claim');

  // WHY the call is scoped to the rpc block and not the whole file: p_token_hash is
  // computed in a statement ABOVE the rpc call, so scanning the file for parameter
  // names finds it first and reports an order that does not exist at the call site.
  // The order inside the object literal is the call site's real order, which is what
  // PostgREST resolves.
  const call = /rpc\("opera_claim_next_wait", \{([\s\S]*?)\}/.exec(bridge);
  assert.ok(call, 'the bridge calls the long-poll claim with a named-argument object');
  const named = [...call[1].matchAll(/^\s*(p_[a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(named,
    ['p_device_name', 'p_token_hash', 'p_extension_version', 'p_protocol_version', 'p_capabilities', 'p_wait_ms'],
    'and it sends exactly the parameters the function declares, in the declared order, so no overload is ambiguous');

  const declared = /create or replace function public\.opera_claim_next_wait\(([^)]*)\)/.exec(migration)[1];
  const declaredNames = declared.split(',').map((s) => s.trim().split(/\s+/)[0]);
  assert.deepEqual(declaredNames, named,
    'the migration declares the same names in the same order the bridge sends them');
});

test('the claim stays callable by exactly the role that runs it', () => {
  // WHY this is re-stated: create or replace keeps an existing function's grants, but
  // a migration that re-created the function from scratch would not, and a revoked
  // service_role here looks like a network fault from the extension's side rather
  // than a permission fault from here.
  assert.match(migration,
    /revoke all on function public\.opera_claim_next_wait\(text, text, text, integer, jsonb, integer\) from public, anon, authenticated;/,
    'the queue is not readable by an anonymous or signed-in browser');
  assert.match(migration,
    /grant execute on function public\.opera_claim_next_wait\(text, text, text, integer, jsonb, integer\) to service_role;/,
    'and the bridge role can still claim');
});