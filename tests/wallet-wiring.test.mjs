// @last-edited: 2026-11-04 UTC+7.
// @title: wallet-wiring — the function calls the wallet with the names the migration declares, and credits on the path that closes the payment.
// @state: the two files read against each other: every rpc the function calls exists, every argument it sends is a parameter, and the owner never comes from the body.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THE TWO FILES ARE READ TOGETHER.
// A renamed parameter is a deploy that fails on the first customer with money in hand, and a function name that only one side knows is the same failure one step later.
// Neither file can be checked alone: the mistake lives in the gap.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const fn = fs.readFileSync(new URL('supabase/functions/opera-agent-billing/index.ts', root), 'utf8');
const sql = fs.readFileSync(new URL('supabase/migrations/20261104120000_opera_wallet.sql', root), 'utf8');
const api = fs.readFileSync(new URL('supabase/functions/_shared/wallet-api.js', root), 'utf8');

function called(source, rpc) {
  return [...source.matchAll(new RegExp(`${rpc}",\\s*\\{([\\s\\S]*?)\\}\\)`, 'g'))].map((match) => match[1]);
}

test('every wallet rpc the function calls is declared by the migration', () => {
  for (const rpc of ['opera_wallet_balance', 'opera_wallet_available', 'opera_wallet_reserve', 'opera_wallet_settle', 'opera_wallet_refund', 'opera_wallet_credit']) {
    assert.match(fn, new RegExp(`"${rpc}"`), `${rpc} is not called by the function`);
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\(`), `${rpc} is not declared by the migration`);
  }
});

test('every argument the function sends is a parameter the migration declares', () => {
  const declared = new Set([...sql.matchAll(/p_[a-z_]+/g)].map((match) => match[0]));
  const sent = new Set([...fn.matchAll(/^\s+(p_[a-z_]+):/gm)].map((match) => match[1]));
  assert.ok(sent.size >= 9, 'the function should send the wallet parameters');
  for (const name of sent) assert.ok(declared.has(name), `${name} is sent but the migration never declares it`);
});

test('the wallet owner is proved by a session or a device, never read from the body', () => {
  assert.match(fn, /supabase\.auth\.getUser\(bearer\)/, 'a dashboard session proves the owner');
  assert.match(fn, /\.eq\("token_hash", await sha256\(deviceToken\.toLowerCase\(\)\)\)/, 'a paired device proves the owner by its hashed token');
  assert.doesNotMatch(fn, /body\.owner_id/, 'an owner the caller names is an owner the caller chose');
});

test('a paid top-up credits the wallet before the notification is answered', () => {
  const markPaid = fn.slice(fn.indexOf('async function markPaid'), fn.indexOf('class HttpError'));
  assert.match(markPaid, /await creditTopUp\(invoice\)/, 'the notification must credit the wallet it closed');
  assert.match(markPaid, /wallet,/, 'the answer must say whether the wallet moved');
  assert.match(fn, /p_ref: invoice\.id/, 'the credit is keyed by the invoice, so a repeated notification credits nothing');
});

test('the wallet action routing is the shared list, not a copy of the names', () => {
  assert.match(fn, /isWalletAction\(String\(body\.action \|\| ""\)\)/, 'the function must use the shared list');
  assert.match(api, /export const WALLET_ACTIONS/, 'the shared list lives in wallet-api');
});
