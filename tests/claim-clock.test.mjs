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

const open = migration.indexOf('$$');
const close = migration.indexOf('$$', open + 2);
const body = migration.slice(open + 2, close).split('\n')
  .filter((l) => !l.trimStart().startsWith('--')).join('\n');

test('the long-poll claim reads a clock that moves, never the one frozen at BEGIN', () => {

  assert.doesNotMatch(body, /now\(\)/,
    'no executable now() survives in the claim function');

  const clocks = body.match(/clock_timestamp\(\)/g) || [];
  assert.ok(clocks.length >= 8,
    `every elapsed-time read uses clock_timestamp() (found ${clocks.length})`);

  assert.match(body, /claimed_at\s*=\s*clock_timestamp\(\)/,
    'the claim stamp is the moment of the claim, not the start of the transaction');
  assert.match(body, /expires_at\s*>\s*v_now/,
    'the candidate SELECT reads the expiry against the current clock, so an expired command is not handed out');
});

test('exactly one overload of the claim function can exist', () => {

  const wrong = /drop function if exists public\.opera_claim_next_wait\(text, text, integer, text, integer, jsonb\);/;
  assert.match(migration, wrong,
    'the overload that a wrong parameter order would create is dropped explicitly');

  const declared = migration.match(/create or replace function public\.opera_claim_next_wait\(/g) || [];
  assert.equal(declared.length, 1, 'the migration declares the function exactly once');

  const signature = /create or replace function public\.opera_claim_next_wait\(([^)]*)\)/.exec(migration)[1];
  const types = signature.split(',').map((s) => s.trim().split(/\s+/)[1]);
  assert.deepEqual(types, ['text', 'text', 'text', 'integer', 'jsonb', 'integer'],
    'and its parameter types are the ones the database already holds');
});

test('the signature the migration writes is the signature the bridge calls', () => {

  const bridge = read('supabase/functions/opera-agent-bridge/index.ts');
  assert.match(bridge, /rpc\("opera_claim_next_wait", \{/,
    'the bridge still calls the long-poll claim');

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

  assert.match(migration,
    /revoke all on function public\.opera_claim_next_wait\(text, text, text, integer, jsonb, integer\) from public, anon, authenticated;/,
    'the queue is not readable by an anonymous or signed-in browser');
  assert.match(migration,
    /grant execute on function public\.opera_claim_next_wait\(text, text, text, integer, jsonb, integer\) to service_role;/,
    'and the bridge role can still claim');
});