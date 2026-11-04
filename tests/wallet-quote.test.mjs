// @last-edited: 2026-11-04 UTC+7.
// @title: wallet-quote — a plan becomes one price, and a list becomes chunks before any money is held.
// @state: the shape rules, the quote against a price list, and the split that keeps every reservation one bounded job.
// @dependencies: node:test, node:assert/strict, ../supabase/functions/_shared/wallet.js.

// WHY THESE CASES AND NOT MORE.
// Each one is a way the price could be wrong for a real customer: a list that is one job per ten items, a document priced as a report, a plan too long for one job, and a price list that does not name the kind the plan needs.
// The arithmetic is the whole product here, so the arithmetic is what is pinned.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CAP, HOLD_MS, classifyPlan, quotePlan, splitBatch } from '../supabase/functions/_shared/wallet.js';

const PRICES = [
  { kind: 'wallet.deposit', amount_cents: 1000000, currency: 'IDR' },
  { kind: 'task.simple', amount_cents: 10000, currency: 'IDR' },
  { kind: 'task.report', amount_cents: 100000, currency: 'IDR' },
  { kind: 'task.batch_item', amount_cents: 8000, currency: 'IDR' }
];

test('one page is one simple task at its listed price', () => {
  const quote = quotePlan({ artifact: 'page', estSteps: 4 }, PRICES);
  assert.equal(quote.ok, true);
  assert.equal(quote.kind, 'task.simple');
  assert.equal(quote.chunks, 1);
  assert.equal(quote.amountCents, 10000);
});

test('a document is priced as a report, because that is the artifact it promises', () => {
  const quote = quotePlan({ artifact: 'document', estSteps: 9 }, PRICES);
  assert.equal(quote.kind, 'task.report');
  assert.equal(quote.amountCents, 100000);
});

test('a list of thirty items is three reservations of ten, priced per item', () => {
  const quote = quotePlan({ artifact: 'list', items: 30, estSteps: 30 }, PRICES);
  assert.equal(quote.mode, 'batch');
  assert.equal(quote.chunks, 3);
  assert.equal(quote.stepsPerChunk, 10);
  assert.equal(quote.amountCents, 8000 * 30);
});

test('a list whose steps do not fit in ten per chunk is refused before any hold', () => {
  const quote = quotePlan({ artifact: 'list', items: 30, estSteps: 35 }, PRICES);
  assert.equal(quote.ok, false);
  assert.equal(quote.why, 'steps-per-chunk-over-cap');
  assert.equal(quote.chunks, 3);
});

test('a single job over the action cap is refused rather than half charged', () => {
  const quote = quotePlan({ artifact: 'page', estSteps: ACTION_CAP + 1 }, PRICES);
  assert.equal(quote.ok, false);
  assert.equal(quote.why, 'steps-over-cap');
});

test('a plan with no step estimate cannot be priced', () => {
  assert.equal(quotePlan({ artifact: 'page' }, PRICES).why, 'no-step-estimate');
  assert.equal(quotePlan(null, PRICES).why, 'no-plan');
});

test('an artifact nobody named a price for is refused, never guessed', () => {
  const quote = quotePlan({ artifact: 'spreadsheet', estSteps: 2 }, PRICES);
  assert.equal(quote.ok, false);
  assert.equal(quote.why, 'unknown-artifact');
});

test('the batch split is by items, and the last chunk is the remainder', () => {
  assert.deepEqual(splitBatch(30), [10, 10, 10]);
  assert.deepEqual(splitBatch(23), [10, 10, 3]);
  assert.deepEqual(splitBatch(1), [1]);
  assert.deepEqual(splitBatch(0), []);
});

test('the hold is thirty minutes and the action cap is ten', () => {
  assert.equal(HOLD_MS, 30 * 60 * 1000);
  assert.equal(ACTION_CAP, 10);
});
