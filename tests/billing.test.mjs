// @last-edited: 2026-10-21 UTC+7.
// @title: billing — what a delivery is worth, and what makes a payment claim true.
// @state: the amount of an invoice, the two signatures, and the rule that an undelivered month is not charged.
// @dependencies: node:test, strict, node:crypto, ../lib/billing.js.

// WHY THESE RULES ARE TESTED AND NOT ASSUMED. Money is the one place where being
// wrong is not a bug report but a customer's trust. Every rule here is a promise to
// the person paying: they are charged for what was delivered, they can open their
// own invoice and nobody else's, and nobody can mark an invoice paid without the
// provider's signature.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  amountFor,
  invoiceToken,
  isSettled,
  linesFromDeliveries,
  notificationSignatureValid,
  paidAmountCents,
  priceFor,
  providerAmount,
  providerOrderId,
  snapPaymentMethods,
  SNAP_QRIS_ONLY_BELOW_CENTS,
  verifyInvoiceToken
} from '../lib/billing.js';

const PRICE_LIST = [
  { kind: 'statement.client_month', unit: 'delivered client-month', amount_cents: 500000, currency: 'IDR', active: true }
];

test('a delivered client-month is priced from the list, not from the code', () => {
  const price = priceFor(PRICE_LIST, 'statement.client_month');
  assert.equal(price.amountCents, 500000);
  assert.equal(price.unit, 'delivered client-month');
  assert.equal(price.currency, 'IDR');
  assert.equal(priceFor(PRICE_LIST, 'statement.nothing'), null, 'a kind with no price has no price');
});

test('the amount is the deliveries multiplied by the price, and nothing else', () => {
  const out = amountFor([
    { kind: 'statement.client_month', quantity: 5, description: 'Agustus 2026, five clients' },
    { kind: 'statement.client_month', quantity: 3 }
  ], PRICE_LIST);
  assert.equal(out.amountCents, 8 * 500000);
  assert.equal(out.currency, 'IDR');
  assert.equal(out.priced.length, 2);
  assert.equal(out.unpriced.length, 0);
});

test('a delivery of a kind with no price is reported, not charged and not hidden', () => {
  const out = amountFor([
    { kind: 'statement.client_month', quantity: 1 },
    { kind: 'slides.deck', quantity: 2 }
  ], PRICE_LIST);
  assert.equal(out.amountCents, 500000, 'only the priced line is charged');
  assert.equal(out.unpriced.length, 1);
  assert.match(out.unpriced[0].reason, /no price/);
});

test('a delivery that was not made is not a line, so it is not on the invoice', () => {
  const delivered = [{ kind: 'statement.client_month', quantity: 2 }];
  const out = amountFor(delivered, PRICE_LIST);
  assert.equal(out.amountCents, 1000000);
  assert.equal(out.priced[0].quantity, 2, 'the invoice says what was delivered');
});

test('a quantity that is not a number is zero, not a surprise bill', () => {
  const out = amountFor([{ kind: 'statement.client_month', quantity: 'three' }], PRICE_LIST);
  assert.equal(out.amountCents, 0);
});

test('the invoice link carries authority in itself, so it needs no lookup to be trusted', () => {
  const token = invoiceToken('inv-1', 'secret');
  assert.equal(verifyInvoiceToken('inv-1', token, 'secret'), true);
  assert.equal(verifyInvoiceToken('inv-2', token, 'secret'), false, 'a token for one invoice opens another? no');
  assert.equal(verifyInvoiceToken('inv-1', token, 'other-secret'), false);
  assert.equal(verifyInvoiceToken('inv-1', 'x', 'secret'), false);
  assert.equal(verifyInvoiceToken('inv-1', token, ''), false, 'without a secret nothing is verified');
});

test('a payment notification is believed only when the provider signed it', () => {
  const key = 'server-key';
  const notification = { order_id: 'order-1', status_code: '200', gross_amount: '4000000' };
  const payload = `${notification.order_id}${notification.status_code}${notification.gross_amount}`;
  const signature = createHmac('sha512', key).update(payload).digest('hex');
  assert.equal(notificationSignatureValid({ ...notification, signature }, key), true);
  assert.equal(notificationSignatureValid({ ...notification, signature: 'wrong' }, key), false);
  assert.equal(notificationSignatureValid({ ...notification, gross_amount: '1', signature }, key), false, 'a bigger claim does not pass');
  assert.equal(notificationSignatureValid({ ...notification, signature }, 'other-key'), false);
  assert.equal(notificationSignatureValid({ ...notification, signature }, ''), false, 'without a key nothing is verified');
});

test('the invoice is derived from the manifest: one line per delivered client-month', () => {
  const deliveries = [
    { client: 'Toko Sinar Jaya', portal: 'bank', period: '2026-08', pages: 2, bytes: 5120 },
    { client: 'CV Melati', portal: 'bank', period: '2026-08', pages: 4, bytes: 9000 }
  ];
  const { lines, refused } = linesFromDeliveries(deliveries);
  assert.equal(refused.length, 0);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].kind, 'statement.client_month');
  assert.equal(lines[0].quantity, 1, 'one delivery is one client-month, not a page count');
  assert.match(lines[0].description, /Toko Sinar Jaya — 2026-08 \(2 pages\)/);
  const out = amountFor(lines, PRICE_LIST);
  assert.equal(out.amountCents, 1000000, 'two delivered client-months are two units');
});

test('a client-month listed twice is refused, not billed twice and not dropped', () => {
  const twice = [
    { client: 'Toko Sinar Jaya', portal: 'bank', period: '2026-08' },
    { client: 'Toko Sinar Jaya', portal: 'bank', period: '2026-08' }
  ];
  const { lines, refused } = linesFromDeliveries(twice);
  assert.equal(lines.length, 1);
  assert.equal(refused.length, 1);
  assert.match(refused[0].reason, /twice/);
});

test('a row without a client or a month cannot be billed', () => {
  const { lines, refused } = linesFromDeliveries([{ client: '', period: '2026-08' }, { client: 'CV Melati' }]);
  assert.equal(lines.length, 0);
  assert.equal(refused.length, 2);
  assert.match(refused[0].reason, /client and a month/);
});

test('only a settled notification is a payment, in the spellings a provider uses', () => {
  assert.equal(isSettled({ transaction_status: 'settlement' }), true, 'Midtrans calls a settled transfer settlement');
  assert.equal(isSettled({ transaction_status: 'settled' }), true);
  assert.equal(isSettled({ transaction_status: 'capture' }), true);
  assert.equal(isSettled({ transaction_status: 'capture', fraud_status: 'accept' }), true);
  assert.equal(isSettled({ transaction_status: 'capture', fraud_status: 'challenge' }), false, 'a card under challenge is not money yet');
  assert.equal(isSettled({ transaction_status: 'pending' }), false);
  assert.equal(isSettled({ transaction_status: 'deny' }), false);
  assert.equal(isSettled({}), false);
});

test('a small invoice opens straight into QRIS, because a fixed fee would eat it', () => {
  const small = snapPaymentMethods(500000, 'IDR');
  assert.equal(small.chargeable, true);
  assert.deepEqual(small.enabled, ['other_qris'], 'Rp 5.000: QRIS only, because a Rp 4.000 VA fee is 80% of the bill');
  assert.deepEqual(snapPaymentMethods(SNAP_QRIS_ONLY_BELOW_CENTS - 1, 'IDR').enabled, ['other_qris']);
  const large = snapPaymentMethods(SNAP_QRIS_ONLY_BELOW_CENTS, 'IDR');
  assert.equal(large.chargeable, true);
  assert.equal(large.enabled, null, 'Rp 100.000: the provider may offer every method');
});

test('a rupiah-only provider is not asked to charge another currency', () => {
  const usd = snapPaymentMethods(500000, 'USD');
  assert.equal(usd.chargeable, false);
  assert.equal(usd.enabled, null);
  assert.match(usd.why, /rupiah/);
  assert.equal(snapPaymentMethods(0, 'IDR').chargeable, false, 'nothing to charge');
});

test('the provider order id is legal, stable, and changes when the amount changes', () => {
  const id = 'Toko Sinar Jaya:2026-08';
  const orderId = providerOrderId(id, 500000, 'IDR');
  assert.match(orderId, /^[A-Za-z0-9._~-]{1,50}$/, 'Midtrans refuses spaces and colons');
  assert.ok(orderId.length <= 50);
  assert.equal(orderId, providerOrderId(id, 500000, 'IDR'), 'the same invoice keeps the same order id');
  assert.notEqual(orderId, providerOrderId(id, 1000000, 'IDR'), 'a corrected amount is a different transaction');
  const long = providerOrderId('a'.repeat(200), 500000, 'IDR');
  assert.ok(long.length <= 50);
  assert.match(long, /^[A-Za-z0-9._~-]+$/);
});

test('the ledger is cents and the provider is rupiah, so the boundary converts both ways', () => {
  assert.equal(providerAmount(500000, 'IDR'), 5000, 'Rp 5.000 is 5.000 rupiah, not 500.000');
  assert.equal(providerAmount(500000, 'USD'), null, 'a rupiah provider cannot charge dollars');
  assert.equal(providerAmount(99, 'IDR'), null, 'half a rupiah is not a charge');
  assert.equal(paidAmountCents('5000.00', 'IDR'), 500000);
  assert.equal(paidAmountCents('500000.00', 'IDR'), 50000000, 'the 100x amount is not the invoice');
  assert.equal(paidAmountCents('nonsense', 'IDR'), null);
  assert.equal(snapPaymentMethods(50, 'IDR').chargeable, false, 'nothing to charge below one rupiah');
});

test('the money rules run where Buffer does not exist, which is where they failed first', () => {
  const saved = globalThis.Buffer;
  const token = invoiceToken('inv-1', 'secret');
  const notification = { order_id: 'order-1', status_code: '200', gross_amount: '4000000' };
  const payload = `${notification.order_id}${notification.status_code}${notification.gross_amount}`;
  const signature = createHmac('sha512', 'server-key').update(payload).digest('hex');
  try {
    delete globalThis.Buffer;
    assert.equal(verifyInvoiceToken('inv-1', token, 'secret'), true);
    assert.equal(verifyInvoiceToken('inv-1', 'x'.repeat(32), 'secret'), false);
    assert.equal(notificationSignatureValid({ ...notification, signature }, 'server-key'), true);
    assert.equal(notificationSignatureValid({ ...notification, signature: 'wrong' }, 'server-key'), false);
  } finally {
    globalThis.Buffer = saved;
  }
});
