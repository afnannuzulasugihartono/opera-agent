// @last-edited: 2026-11-04 UTC+7.
// @title: qris-detector — the feed query the API accepts, the parser for the feed it really returns, and amount-FIFO matching on settled dynamic QRIS money.
// @state: query validation with the server-side filters, header shape with one stable x-uniqueid, the token route's own headers and nested body, feed normalization on the measured field names, exact-amount FIFO matching with a clock check, and dry mode that closes nothing.
// @dependencies: node:test, node:assert/strict, ../hosted/functions/_shared/qris-detector.ts.

// WHY THESE TESTS PIN MEASURED FACTS.
// The feed was read for real on 2026-11-04: a Rp1.000 payment arrives as gross_amount 100000, the payment scanned from our own page is channel_type DYNAMIC_QR, the printed static QR is STATIC_QR, size=200 is refused with 422 and size=100 is accepted, and the token route answers 400 for a flat body and 201 for the nested one.
// A detector that assumes any other shape closes nothing or closes the wrong invoice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_URL, TOKEN_URL, feedQuery, feedHeaders, parseFeed, matchOpenInvoices, detectorPlan, sessionHeaders, refreshBody } from '../../hosted/functions/_shared/qris-detector.ts';

const MERCHANT = 'G274351871';

test('the feed query carries exactly the fields that were accepted', () => {
  const query = feedQuery({ merchantId: MERCHANT, from: 0, size: 50, startTime: '2026-11-04T00:00:00Z', endTime: '2026-11-04T23:59:59Z' });
  assert.ok(query.includes('merchant_id=G274351871'));
  assert.ok(query.includes('from=0'));
  assert.ok(query.includes('size=50'));
  assert.ok(query.includes('start_time=2026-11-04T00%3A00%3A00Z') || query.includes('start_time=2026-11-04T00:00:00Z'));
  assert.ok(query.includes('statuses=SETTLEMENT'), 'only settled money can close an invoice');
  assert.ok(query.includes('payment_types=QRIS'), 'only QRIS money is read');
  assert.equal(feedQuery({ merchantId: MERCHANT, from: 0, size: 50, startTime: 'yesterday', endTime: '2026-11-04T23:59:59Z' }), null, 'epoch or day-only windows were refused by the API');
  assert.equal(feedQuery({ merchantId: '', from: 0, size: 50, startTime: '2026-11-04T00:00:00Z', endTime: '2026-11-04T23:59:59Z' }), null);
  assert.equal(feedQuery({ merchantId: MERCHANT, from: -1, size: 50, startTime: '2026-11-04T00:00:00Z', endTime: '2026-11-04T23:59:59Z' }), null, 'from is required and must be a non-negative offset');
  assert.equal(feedQuery({ merchantId: MERCHANT, from: 0, size: 200, startTime: '2026-11-04T00:00:00Z', endTime: '2026-11-04T23:59:59Z' }), null, 'the API answered 422 for a page of 200');
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

test('the token route has its own headers and a nested body', () => {
  const headers = sessionHeaders({ accessToken: 'tok', uniqueId: 'device-1' });
  assert.equal(headers['x-uniqueid'], 'device-1');
  assert.equal(headers['x-appId'], 'go-biz-web-dashboard');
  assert.equal(headers['X-User-Type'], 'merchant');
  assert.equal(sessionHeaders({ accessToken: '', uniqueId: 'device-1' }), null);
  assert.equal(sessionHeaders({ accessToken: 'tok', uniqueId: '' }), null);
  const body = refreshBody('refresh-token');
  assert.equal(body.client_id, 'go-biz-web-new');
  assert.equal(body.grant_type, 'refresh_token');
  assert.equal(body.data.refresh_token, 'refresh-token');
  assert.equal(refreshBody(''), null);
});

test('the feed parser reads the fields the feed really returns', () => {
  const rows = parseFeed({ transactions: [
    {
      id: 'tx-1',
      gross_amount: 100000,
      transaction_time: '2026-11-04T15:29:04+07:00',
      transaction_status: 'SETTLEMENT',
      payment_type: 'QRIS',
      channel_type: 'DYNAMIC_QR'
    },
    { id: 'tx-2', gross_amount: 100000, transaction_time: '2026-11-04T15:13:18+07:00', transaction_status: 'SETTLEMENT', payment_type: 'QRIS', channel_type: 'STATIC_QR' },
    { id: 'tx-3', transaction_time: '2026-11-04T15:30:00+07:00' }
  ] });
  assert.equal(rows.length, 2, 'a row without an amount is dropped');
  assert.equal(rows[0].amount, 100000, 'the feed counts minor units');
  assert.equal(rows[0].at, '2026-11-04T15:29:04+07:00');
  assert.equal(rows[0].method, 'qris');
  assert.equal(rows[0].usable, true, 'our own dynamic QR money is usable');
  assert.equal(rows[1].usable, false, 'money paid against the printed static QR belongs to the merchant, not to a wallet');
});

test('matching is exact amount, FIFO, one transaction per invoice, and after the invoice opened', () => {
  const invoices = [
    { id: 'inv-b', status: 'open', amount_cents: 1000000, created_at: '2026-11-04T09:00:00Z' },
    { id: 'inv-a', status: 'open', amount_cents: 1000000, created_at: '2026-11-04T08:00:00Z' },
    { id: 'inv-paid', status: 'paid', amount_cents: 1000000, created_at: '2026-11-04T07:00:00Z' }
  ];
  const txns = parseFeed({ transactions: [
    { id: 'tx-1', gross_amount: 1000000, transaction_time: '2026-11-04T10:00:00Z', transaction_status: 'SETTLEMENT', payment_type: 'QRIS', channel_type: 'DYNAMIC_QR' },
    { id: 'tx-2', gross_amount: 1000000, transaction_time: '2026-11-04T10:01:00Z', transaction_status: 'SETTLEMENT', payment_type: 'QRIS', channel_type: 'DYNAMIC_QR' },
    { id: 'tx-3', gross_amount: 999, transaction_time: '2026-11-04T10:02:00Z', transaction_status: 'SETTLEMENT', payment_type: 'QRIS', channel_type: 'DYNAMIC_QR' }
  ] });
  const matches = matchOpenInvoices(invoices, txns, 'minor');
  assert.deepEqual(matches.map((m) => m.invoiceId), ['inv-a', 'inv-b'], 'oldest open invoice first, paid invoices skipped, one transaction per invoice');
  assert.equal(matches[0].amountRupiah, 10000);
});

test('money that arrived before the invoice opened never closes it', () => {
  const invoices = [{ id: 'inv-a', status: 'open', amount_cents: 100000, created_at: '2026-11-04T15:20:00Z' }];
  const old = parseFeed({ transactions: [{ id: 'tx-old', gross_amount: 100000, transaction_time: '2026-11-04T13:00:00Z', transaction_status: 'SETTLEMENT', payment_type: 'QRIS', channel_type: 'DYNAMIC_QR' }] });
  assert.equal(matchOpenInvoices(invoices, old, 'minor').length, 0, 'yesterday money of the same amount is not this invoice money');
  const fresh = parseFeed({ transactions: [{ id: 'tx-new', gross_amount: 100000, transaction_time: '2026-11-04T15:25:00Z', transaction_status: 'SETTLEMENT', payment_type: 'QRIS', channel_type: 'DYNAMIC_QR' }] });
  assert.equal(matchOpenInvoices(invoices, fresh, 'minor').length, 1);
});

test('unsettled or non-QRIS money closes nothing', () => {
  const invoices = [{ id: 'inv-a', status: 'open', amount_cents: 100000, created_at: '2026-11-04T15:00:00Z' }];
  const rows = parseFeed({ transactions: [
    { id: 'tx-refund', gross_amount: 100000, transaction_time: '2026-11-04T15:30:00Z', transaction_status: 'REFUND', payment_type: 'QRIS', channel_type: 'DYNAMIC_QR' },
    { id: 'tx-card', gross_amount: 100000, transaction_time: '2026-11-04T15:30:00Z', transaction_status: 'SETTLEMENT', payment_type: 'CREDIT_CARD', channel_type: 'DYNAMIC_QR' }
  ] });
  assert.equal(matchOpenInvoices(invoices, rows, 'minor').length, 0);
});

test('dry mode closes nothing and live closes only the measured minor reading', () => {
  const byUnit = {
    rupiah: [{ invoiceId: 'inv-a', transactionId: 'tx-1', amountRupiah: 10000 }],
    minor: []
  };
  const dry = detectorPlan('dry', byUnit);
  assert.equal(dry.mode, 'dry');
  assert.deepEqual(dry.closes, []);
  assert.equal(dry.wouldClose.length, 0);
  const live = detectorPlan('live', byUnit);
  assert.equal(live.closes.length, 0, 'the rupiah reading of a minor-unit amount is a wrong amount and may not close money');
  const liveMinor = detectorPlan('live', { rupiah: [], minor: byUnit.rupiah });
  assert.equal(liveMinor.closes.length, 1, 'the measured minor reading closes the invoice');
  assert.equal(detectorPlan(undefined, byUnit).mode, 'dry', 'the default mode is dry');
});
