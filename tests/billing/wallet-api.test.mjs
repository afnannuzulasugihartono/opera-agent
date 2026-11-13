// @last-edited: 2026-11-04 UTC+7.
// @title: wallet-api — the order of decisions, driven without a network or a key.
// @state: the refusal that must arrive before any money is promised, the price that must come from the price list, and the two idempotent answers.
// @dependencies: node:test, node:assert/strict, ../hosted/functions/_shared/wallet-api.ts.

// WHY THE ORDER IS THE SUBJECT.
// A wallet that refuses after it reserved is a wallet that holds money for work nobody started, and no later check can undo the promise.
// Each case below fails if a check moves behind the call it protects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWalletAction, isWalletAction } from '../../hosted/functions/_shared/wallet-api.ts';

const PRICES = [
  { kind: 'task.simple', amount_cents: 10000, currency: 'IDR' },
  { kind: 'task.report', amount_cents: 100000, currency: 'IDR' },
  { kind: 'task.batch_item', amount_cents: 8000, currency: 'IDR' }
];

const HASH = 'a'.repeat(64);
const RESERVATION = '11111111-1111-1111-1111-111111111111';

function deps(overrides = {}) {
  const calls = [];
  const base = {
    owner: async () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    prices: async () => PRICES,
    balance: async () => 1000000,
    available: async () => 990000,
    history: async () => [{ at: '2026-11-04T00:00:00Z', kind: 'deposit', amountCents: 1000000, note: null, reservationId: null }],
    reserve: async (args) => { calls.push(['reserve', args]); return { ok: true, reservationId: RESERVATION, amountCents: args.amountCents, availableCents: 980000 }; },
    settle: async (args) => { calls.push(['settle', args]); return { ok: true, amountCents: 10000, balanceCents: 990000 }; },
    refund: async (args) => { calls.push(['refund', args]); return { ok: true, amountCents: 10000, balanceCents: 1000000 }; },
    depositTopUp: async () => { calls.push(['deposit']); return { url: 'https://pay.test/x', amountCents: 1000000 }; }
  };
  const merged = { ...base, ...overrides };
  return { deps: merged, calls };
}

test('only the six wallet actions are routed here', () => {
  assert.equal(isWalletAction('task-reserve'), true);
  assert.equal(isWalletAction('settle-manual'), false, 'the operator action must not become a wallet action');
  assert.equal(isWalletAction(undefined), false);
});

test('a request with no owner is refused before anything is read or reserved', async () => {
  const { deps: d, calls } = deps({ owner: async () => null });
  const out = await handleWalletAction('task-reserve', { plan: { artifact: 'page', estSteps: 3 } }, d);
  assert.equal(out.status, 401);
  assert.deepEqual(calls, []);
});

test('the price comes from the price list and never from the body', async () => {
  const { deps: d, calls } = deps();
  const out = await handleWalletAction('task-reserve', {
    plan: { artifact: 'page', estSteps: 3 },
    amount_cents: 1,
    amountCents: 1,
    balanceCents: 999999
  }, d);
  assert.equal(out.status, 200);
  assert.equal(calls[0][1].amountCents, 10000, 'a caller that names its own price must be ignored');
  assert.equal(calls[0][1].kind, 'task.simple');
});

test('a balance that cannot cover the price is refused with 402, after the price is known', async () => {
  const { deps: d } = deps({ reserve: async () => ({ ok: false, why: 'insufficient', availableCents: 500 }) });
  const out = await handleWalletAction('task-reserve', { plan: { artifact: 'document', estSteps: 4 } }, d);
  assert.equal(out.status, 402);
  assert.equal(out.body.why, 'insufficient');
  assert.equal(out.body.availableCents, 500);
  assert.equal(out.body.quote.amountCents, 100000);
});

test('a plan too long for one job is refused before the reserve is called', async () => {
  const { deps: d, calls } = deps();
  const out = await handleWalletAction('task-reserve', { plan: { artifact: 'page', estSteps: 11 } }, d);
  assert.equal(out.status, 409);
  assert.equal(out.body.why, 'steps-over-cap');
  assert.deepEqual(calls, []);
});

test('a settle with no artifact hash is refused before the database is asked', async () => {
  const { deps: d, calls } = deps();
  const out = await handleWalletAction('task-settle', { reservation_id: RESERVATION, artifact_hash: 'short' }, d);
  assert.equal(out.status, 400);
  assert.equal(out.body.why, 'bad-artifact-hash');
  assert.deepEqual(calls, []);
});

test('a settle that already happened answers 200 and charges once', async () => {
  const { deps: d, calls } = deps({ settle: async (args) => { calls.push(['settle', args]); return { ok: true, already: true, amountCents: 10000 }; } });
  const out = await handleWalletAction('task-settle', { reservation_id: RESERVATION, artifact_hash: HASH }, d);
  assert.equal(out.status, 200);
  assert.equal(out.body.already, true);
  assert.equal(calls.length, 1);
});

test('a refund after a settle is refused, because the work was delivered', async () => {
  const { deps: d } = deps({ refund: async () => ({ ok: false, why: 'settled' }) });
  const out = await handleWalletAction('task-refund', { reservation_id: RESERVATION, reason: 'changed my mind' }, d);
  assert.equal(out.status, 409);
  assert.equal(out.body.why, 'settled');
});

test('the balance answer carries both numbers, because a hold is not a charge', async () => {
  const { deps: d } = deps();
  const out = await handleWalletAction('wallet-balance', {}, d);
  assert.equal(out.status, 200);
  assert.equal(out.body.balanceCents, 1000000);
  assert.equal(out.body.availableCents, 990000);
});

test('a top-up is opened for the owner the request proved, not one the body names', async () => {
  const { deps: d, calls } = deps();
  const out = await handleWalletAction('wallet-deposit', { owner_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, d);
  assert.equal(out.status, 200);
  assert.equal(out.body.kind, 'wallet.deposit');
  assert.deepEqual(calls, [['deposit']], 'the handler must not pass a body field through to the top-up opener');
});

test('the history is one timeline the dashboard reads, and it carries no price of its own', async () => {
  const { deps: d, calls } = deps();
  const out = await handleWalletAction('wallet-history', { amount_cents: 1, owner_id: 'x' }, d);
  assert.equal(out.status, 200);
  assert.equal(out.body.entries[0].kind, 'deposit');
  assert.deepEqual(calls, [], 'a history is a read, so nothing that changes money is called');
});
