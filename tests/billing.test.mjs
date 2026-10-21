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
  priceFor,
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
