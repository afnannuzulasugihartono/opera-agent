// @last-edited: 2026-11-04 UTC+7.
// @title: wallet-schema — the money tables keep the invariants the wallet functions rely on.
// @state: the migration text read as the shape a deploy will create: one settle and one refund per task, signed movements, a ten-action cap, and a hold that expires.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THIS GATE READS THE MIGRATION AND NOT A DATABASE.
// CI has no Postgres, so the behaviour was proven by hand on 2026-11-04 against the live database inside a transaction that was rolled back: deposit replay credited once, an over-balance reserve refused, a settle replayed charged once, a late settle refunded instead of charged, and a sweep refunded an abandoned hold once.
// What a later deploy can still break silently is the text that carries those invariants, so the text is read here: a dropped unique index or a loosened check would pass a test that ran once and fail nothing afterwards.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const sql = fs.readFileSync(new URL('supabase/migrations/20261104120000_opera_wallet.sql', root), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

test('a reservation can be settled once and refunded once, never twice', () => {
  assert.match(
    sql,
    /create unique index if not exists opera_ledger_once_idx\s+on public\.opera_ledger \(reservation_id, kind\) where reservation_id is not null/,
    'without this index a network retry charges the same task twice'
  );
});

test('a repeated deposit reference credits nothing the second time', () => {
  assert.match(
    sql,
    /create unique index if not exists opera_ledger_ref_once_idx\s+on public\.opera_ledger \(kind, ref\) where ref is not null/,
    'the provider repeats a settlement, and the reference is the only thing that says it is the same money'
  );
  assert.match(sql, /on conflict do nothing/, 'the credit path must rely on the index, not on a read-then-write');
});

test('the sign of a movement is decided by its kind', () => {
  assert.match(sql, /kind in \('deposit', 'refund'\) and amount_cents > 0/, 'a deposit or refund adds money');
  assert.match(sql, /kind = 'settle' and amount_cents < 0/, 'a settle takes money');
});

test('a task may plan at most ten actions', () => {
  assert.match(sql, /actions_planned integer check \(actions_planned between 1 and 10\)/, 'eleven actions is not one job and must be split before money is held');
});

test('a hold expires in thirty minutes by default', () => {
  assert.match(sql, /expires_at timestamptz not null default now\(\) \+ interval '30 minutes'/, 'a hold with no deadline never ends');
});

test('the wallet stores no balance that could disagree with the ledger', () => {
  const table = sql.match(/create table if not exists public\.opera_wallets \(([\s\S]*?)\);/);
  assert.ok(table, 'opera_wallets is missing');
  assert.doesNotMatch(table[1], /balance/, 'a balance column is a number nobody can explain later');
  assert.match(sql, /select coalesce\(sum\(amount_cents\), 0\)::bigint/, 'the balance is the sum of the movements');
});

test('a settled reservation cannot exist without the artifact it was paid for', () => {
  assert.match(sql, /status <> 'settled' or artifact_hash is not null/, 'money must not be taken for work no artifact claims');
});

test('every wallet function is server-only', () => {
  for (const fn of ['opera_wallet_balance', 'opera_wallet_available', 'opera_wallet_reserve', 'opera_wallet_expire', 'opera_wallet_settle', 'opera_wallet_refund', 'opera_wallet_credit']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`), `${fn} is missing`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`), `${fn} must be closed to browsers`);
  }
  assert.match(sql, /alter table public\.opera_ledger enable row level security/, 'the ledger must deny every browser role');
});

test('the top-up and the task prices are rows, not constants in a client', () => {
  assert.match(sql, /\('wallet\.deposit', 'wallet top-up', 1000000, 'IDR', true\)/, 'the smallest top-up is Rp10.000');
  for (const kind of ['task.simple', 'task.report', 'task.batch_item']) {
    assert.match(sql, new RegExp(`\\('${kind.replace('.', '\\.')}'`), `${kind} has no price`);
  }
});
