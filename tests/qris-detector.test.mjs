// @last-edited: 2026-11-04 UTC+7.
// @title: qris-detector — the feed query that was accepted, the parser, and amount-FIFO matching in both units.
// @state: query validation, header shape with one stable x-uniqueid, feed normalization, exact-amount FIFO matching, and dry mode that closes nothing.
// @dependencies: node:test, node:assert/strict, ../supabase/functions/_shared/qris-detector.js.

// WHY THE UNVERIFIED FACTS DRIVE THE TESTS.
// The feed's amount unit and whether self-made QRIS payments appear in it were never proven, so the tests pin the two readings separately and pin that dry mode closes nothing.
// A detector that matched only one unit would silently assume the answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_URL, TOKEN_URL, feedQuery, feedHeaders, parseFeed, matchOpenInvoices, detectorPlan } from '../supabase/functions/_shared/qris-detector.js';

const MERCHANT = 'G274351871';

test('the feed query carries exactly the fields that were accepted', () => {
  const query = feedQuery({ merchantId: MERCHANT, from: 0, size: 50, startTime: '2026-11-04T00:00:00Z', endTime: '2026-11-04T23:59:59Z' });
  assert.ok(query.includes('merchant_id=G274351871'));
  assert.ok(query.includes('from=0'));
  assert.ok(query.includes('size=50'));
  assert.ok(query.includes('start_time=2026-11-04T00%3A00%3A00Z') || query.includes('start_time=2026-11-04T00:00:00Z'));
  assert.equal(feedQuery({ merchantId: MERCHANT, from: 0, size: 50, startTime: 'yesterday', endTime: '2026-11-04T23:59:59Z' }), null, 'epoch or day-only windows were refused by the API');
  assert.equal(feedQuery({ merchantId: '', from: 0, size: 50, startTime: '2026-11-04T00:00:00Z', endTime: '2026-11-04T23:59:59Z' }), null);
  assert.equal(feedQuery({ merchantId: MERCHANT, from: -1, size: 50, startTime: '2026-11-04T00:00:00Z', endTime: '2026-11-04T23:59:59Z' }), null, 'from is required and must be a non-negative offset');
  assert.equal(FEED_URL, 'https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions');
  assert.equal(TOKEN_URL, 'https://api.gobiz.co.id/goid/token');
});

test('the feed headers carry one stable device id', () => {
  const headers = feedHeaders({ accessToken: 'tok', uniqueId: 'device-1' });
  assert.equal(headers['x-uniqueid'], 'device-1');
  assert.equal(headers.authorization, 'Bearer tok');
  assert.equal(feedHeaders({ accessToken: '', uniqueId: 'device-1' }), null);
  assert.equal(feedHeaders({ accessToken: 'tok', uniqueId: '' }), null);
});

test('the feed parser normalizes rows and drops rows without an amount', () => {
  const rows = parseFeed({ data: [
    { id: 'tx-1', amount: 10000, created_at: '2026-11-04T10:00:00Z', payment_method: 'QRIS', status: 'SUCCESS' },
    { transaction_id: 'tx-2', nominal: 10000, transaction_time: '2026-11-04T10:05:00Z' },
    { id: 'tx-3', created_at: '2026-11-04T10:06:00Z' }
  ] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 10000);
  assert.equal(rows[1].id, 'tx-2');
});

test('matching is exact amount, FIFO, and one transaction closes one invoice', () => {
  const invoices = [
    { id: 'inv-b', status: 'open', amount_cents: 1000000, created_at: '2026-11-04T09:00:00Z' },
    { id: 'inv-a', status: 'open', amount_cents: 1000000, created_at: '2026-11-04T08:00:00Z' },
    { id: 'inv-paid', status: 'paid', amount_cents: 1000000, created_at: '2026-11-04T07:00:00Z' }
  ];
  const txns = parseFeed({ data: [
    { id: 'tx-1', amount: 10000, created_at: '2026-11-04T10:00:00Z' },
    { id: 'tx-2', amount: 10000, created_at: '2026-11-04T10:01:00Z' },
    { id: 'tx-3', amount: 999, created_at: '2026-11-04T10:02:00Z' }
  ] });
  const matches = matchOpenInvoices(invoices, txns, 'rupiah');
  assert.deepEqual(matches.map((m) => m.invoiceId), ['inv-a', 'inv-b'], 'oldest open invoice first, paid invoices skipped, one transaction per invoice');
  const minor = matchOpenInvoices(invoices, parseFeed({ data: [{ id: 'tx-9', amount: 1000000 }] }), 'minor');
  assert.equal(minor.length, 1, 'the same transaction reads as 10.000 rupiah in minor units');
  assert.equal(minor[0].amountRupiah, 10000);
});

test('dry mode closes nothing and reports both unit readings', () => {
  const byUnit = {
    rupiah: [{ invoiceId: 'inv-a', transactionId: 'tx-1', amountRupiah: 10000 }],
    minor: []
  };
  const dry = detectorPlan('dry', byUnit);
  assert.equal(dry.mode, 'dry');
  assert.deepEqual(dry.closes, []);
  assert.equal(dry.wouldClose.length, 1);
  const live = detectorPlan('live', byUnit);
  assert.equal(live.closes.length, 1, 'live closes the rupiah reading when it matches');
  const liveMinor = detectorPlan('live', { rupiah: [], minor: byUnit.rupiah });
  assert.equal(liveMinor.closes.length, 1, 'live falls back to the minor reading only when rupiah has none');
  assert.equal(detectorPlan(undefined, byUnit).mode, 'dry', 'the default mode is dry');
});
