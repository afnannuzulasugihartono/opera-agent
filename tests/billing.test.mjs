// @last-edited: 2026-10-21 UTC+7.
// @title: billing — what a delivery is worth, and what makes a payment claim true.
// @state: the amount of an invoice, the two signatures, and the rule that an undelivered month is not charged.
// @dependencies: node:test, strict, node:crypto, ../supabase/functions/_shared/billing.js.

// WHY THESE RULES ARE TESTED AND NOT ASSUMED.
// Money is the one place where being wrong is not a bug report but a customer's trust.
// Every rule here is a promise to the person paying: they are charged for what was delivered, they can open their own invoice and nobody else's, and nobody can mark an invoice paid without the provider's signature.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';

import {
  amountFor,
  invoiceToken,
  isSettled,
  linesFromDeliveries,
  manualSettlement,
  needsClosing,
  notificationAcknowledged,
  notificationSignatureValid,
  paidAmountCents,
  planInvoiceLines,
  priceFor,
  providerAmount,
  providerOrderId,
  providerSettlement,
  snapChargeRequest,
  snapPaymentMethods,
  snapStatusRequest,
  snapUrlFor,
  readSecret,
  SECRET_READINGS,
  whichReadingSigned,
  snapRedirect,
  SNAP_QRIS_ONLY_BELOW_CENTS,
  verifyInvoiceToken
} from '../supabase/functions/_shared/billing.js';

const seen = [];

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
  const signature_key = createHmac('sha512', key).update(payload).digest('hex');
  assert.equal(notificationSignatureValid({ ...notification, signature_key }, key), true);
  assert.equal(notificationSignatureValid({ ...notification, signature_key: 'wrong' }, key), false);
  assert.equal(notificationSignatureValid({ ...notification, gross_amount: '1', signature_key }, key), false, 'a bigger claim does not pass');
  assert.equal(notificationSignatureValid({ ...notification, signature_key }, 'other-key'), false);
  assert.equal(notificationSignatureValid({ ...notification, signature_key }, ''), false, 'without a key nothing is verified');
});

// WHY THE PROVIDER'S FIELD NAME HAS A TEST OF ITS OWN.
// The first rule read notification.signature while Midtrans sends signature_key, and the test above used the same invented name, so the test agreed with the bug instead of catching it.
// Measured live: a sandbox payment settled, Midtrans answered PAID, and the invoice stayed open, because the signature arrived in a field this code did not read and the comparison was made against nothing.
// A notification is the only way an invoice becomes paid, so the field name is pinned here rather than left to agree with whatever the code happens to say.

test('the signature is read from the field the provider sends, and the field is named', () => {
  const shared = fs.readFileSync(new URL('../supabase/functions/_shared/billing.js', import.meta.url), 'utf8');
  assert.match(shared, /signature_key/, 'the rule must read the field Midtrans sends');
  assert.match(shared, /notification\.signature_key\s*\?\?/, 'the provider field is read first, and the alias is the fallback');

  // The same field name decides whether a notification is recognised at all.
  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /signature_key/, 'the function must look for the field the provider sends');
  assert.doesNotMatch(fn, /Boolean\(body\.signature\)/, 'looking for a field the provider never sends turns every notification into "unknown action"');
  assert.match(fn, /Boolean\(body\.order_id\) && Boolean\(body\.status_code\)/, 'a notification is recognised by what it says happened, not by carrying a signature');
});

// WHY "UNDERSTOOD" AND "PAID" ARE TWO DIFFERENT ANSWERS.
// The provider reads a non-2xx answer as "not delivered" and sends the same body again.
// Measured live: a correctly signed "still pending" answered 400, and the provider's history showed it as undelivered beside a real rejection, so the rejection had no shape of its own.
// The status code answers whether the body was received and understood; the body answers whether money moved.

test('a notification is acknowledged when it is understood, and refused when a human must look', () => {
  assert.equal(notificationAcknowledged({ ok: true, invoice: 'Toko Sinar Jaya:2026-08' }), true, 'a closed invoice is acknowledged');
  assert.equal(notificationAcknowledged({ ok: false, why: 'the transaction is not settled', retry: false }), true, 'a signed pending notification is understood, so it is acknowledged');
  assert.equal(notificationAcknowledged({ ok: false, why: 'no invoice with that order id' }), false, 'an order we cannot place is not something to acknowledge and forget');
  assert.equal(notificationAcknowledged({ ok: false, why: 'the paid amount is not the invoice amount' }), false, 'a wrong amount is a person\'s problem, not a retry');
  assert.equal(notificationAcknowledged(null), false);
});

// WHY A CLOSED INVOICE IS NOT CLOSED AGAIN.
// Measured live on 2026-10-26: a settlement closed an invoice at 08:55:13, a pending notification arrived eleven seconds later, and paid_at moved to 08:55:24.
// The moment money landed is evidence the provider cannot restore, so a second notification may confirm it and must never rewrite it.

test('an invoice that is already paid is not paid again', () => {
  assert.equal(needsClosing({ status: 'paid', paid_at: '2026-10-26T08:55:13Z' }), false, 'a paid invoice keeps the moment it was paid');
  assert.equal(needsClosing({ status: 'paid', paid_at: null }), true, 'a paid row with no moment is repaired rather than left blank');
  assert.equal(needsClosing({ status: 'open', paid_at: null }), true);
  assert.equal(needsClosing(null), false);
});

// WHY THE LOG HAS TO BE WRITTEN FROM BOTH SIDES OF THE VERDICT.
// A refusal used to leave no trace, so "the provider never reached us" and "it reached us and we said no" looked identical, and four payment attempts were spent telling them apart.
// The row is written on the refused branch and on the accepted branch, before the answer is returned.

// WHY THE PROVIDER IS ASKED WHEN THE SIGNATURE DOES NOT MATCH.
// Real notifications arrived from the provider's own user agent and were refused, and the body could not say whether it was forged or signed with a different secret.
// The provider records the transaction, so its answer is stronger than the body: it is about its own transaction, never about the claim in the request.

test('the status of an order is asked on the host the stated environment names', () => {
  const sandbox = snapStatusRequest({ orderId: 'oa-1', serverKey: 'k', environment: 'sandbox' });
  assert.equal(sandbox.url, 'https://api.sandbox.midtrans.com/v2/oa-1/status');
  assert.equal(sandbox.method, 'GET');
  assert.equal(sandbox.headers.Authorization, `Basic ${Buffer.from('k:').toString('base64')}`);
  const production = snapStatusRequest({ orderId: 'oa-1', serverKey: 'k', environment: 'production' });
  assert.equal(production.url, 'https://api.midtrans.com/v2/oa-1/status');
  assert.equal(snapStatusRequest({ orderId: '', serverKey: 'k' }), null, 'without an order there is nothing to ask about');
});

test('only the provider\'s own words for a settlement count as paid', () => {
  assert.deepEqual(providerSettlement({ transaction_status: 'settlement', gross_amount: '99000.00' }),
    { settled: true, status: 'settlement', grossAmount: '99000.00' });
  assert.equal(providerSettlement({ transaction_status: 'capture', fraud_status: 'accept' }).settled, true);
  assert.equal(providerSettlement({ transaction_status: 'capture', fraud_status: 'challenge' }).settled, false, 'a challenged capture is not money');
  assert.equal(providerSettlement({ transaction_status: 'pending' }).settled, false);
  assert.equal(providerSettlement({ transaction_status: 'deny' }).settled, false);
  assert.equal(providerSettlement(null).settled, false);
});

test('a refused signature asks the provider, and the reading that verified is named', () => {
  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /providerSaysSettled\(String\(notification\.order_id/, 'a refusal must become a question, not an ending');
  assert.match(fn, /whichReadingSigned\(notification, MIDTRANS_SERVER_KEY\)/, 'the stored key is read as stored, and the reading that signed is reported');
  assert.doesNotMatch(fn, /MIDTRANS_SERVER_KEY = .*\.trim\(\)/, 'cleaning the key would hide the evidence that the stored secret needs fixing');
});

// WHY A KEY THAT A CLIPBOARD TOUCHED MUST STILL BE READABLE.
// A pasted key can carry a newline or a zero-width space, and the signature is computed over the exact stored value.
// Measured live: the charge opened with the stored key while every notification signed with it was refused, and trim() alone did not close the gap.
// The reading that worked is named, so the stored secret is reported as needing a clean paste instead of being silently repaired.

test('the same key still signs when the clipboard added something to it', () => {
  const key = 'mid-server-abc';
  const notification = { order_id: 'order-1', status_code: '200', gross_amount: '99000.00' };
  const payload = `${notification.order_id}${notification.status_code}${notification.gross_amount}`;
  const signed = { ...notification, signature_key: createHmac('sha512', key).update(payload).digest('hex') };

  assert.equal(whichReadingSigned(signed, key), 'as-stored');
  assert.equal(whichReadingSigned(signed, `${key}\n`), 'trimmed', 'a newline from a paste survives trim only');
  assert.equal(whichReadingSigned(signed, `${key}\u200b`), 'printable-ascii', 'a zero-width space survives trim, so the reading has to name it');
  assert.equal(whichReadingSigned(signed, `${key}\u00a0`), 'trimmed', 'a non-breaking space ends the value, so trim reaches it');
  assert.equal(whichReadingSigned(signed, 'another-key'), 'none');
  assert.equal(readSecret(`${key}\u200b`, 'printable-ascii'), key);
  assert.deepEqual([...SECRET_READINGS], ['as-stored', 'trimmed', 'printable-ascii']);
});

test('every notification that arrives is written down, refused or accepted', () => {
  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  const calls = fn.match(/await noteNotification\(/g) || [];
  assert.equal(calls.length, 2, 'the refused branch and the accepted branch both write the row');
  assert.match(fn, /from\("opera_notification_log"\)/, 'the row goes to the table the migration created');
  assert.match(fn, /signature_field/, 'which field carried the signature is what separates a contract mismatch from a bad secret');
  assert.doesNotMatch(fn, /signature_key:\s*String\(notification\.signature_key/, 'the signature itself is never stored');
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

// WHY THE SNAP REQUEST IS DRIVEN AGAINST A PROVIDER THAT IS STOOD UP IN THE TEST.
// The one step that was never proved was the request itself, because it lived inside a Deno handler and no test could reach it.
// A real HTTP server in this test now carries the exact bytes the function would send, so the order id, the amount, the method list and the Basic header are checked by something that parses them the way Midtrans does.

const SNAP_INVOICE = {
  orderId: providerOrderId('Toko Sinar Jaya:2026-10', 9900000, 'IDR'),
  amountCents: 9900000,
  currency: 'IDR',
  customerId: 'Firma Contoh'
};

test('the charge request carries a legal order id, whole rupiah and the QRIS-only list under the threshold', () => {
  const request = snapChargeRequest({ ...SNAP_INVOICE, enabled: ['other_qris'], serverKey: 'server-key' });
  assert.ok(request, 'a chargeable invoice produces a request');
  const body = JSON.parse(request.body);
  assert.match(body.transaction_details.order_id, /^[A-Za-z0-9._~-]{1,50}$/);
  assert.equal(body.transaction_details.gross_amount, 99000, 'the ledger is cents and the provider is rupiah');
  assert.equal(body.customer_details.first_name, 'Firma Contoh');
  assert.deepEqual(body.enabled_payments, ['other_qris']);
  assert.equal(request.headers['Content-Type'], 'application/json');
  const expected = Buffer.from('server-key:').toString('base64');
  assert.equal(request.headers.Authorization, `Basic ${expected}`);
});

test('an invoice the provider cannot charge produces no request at all', () => {
  assert.equal(snapChargeRequest({ ...SNAP_INVOICE, amountCents: 50, enabled: ['other_qris'] }), null);
  assert.equal(snapChargeRequest({ ...SNAP_INVOICE, currency: 'USD', enabled: ['other_qris'] }), null);
});

test('a redirect without a token is not a way to pay, and a good one is', () => {
  assert.equal(snapRedirect({ redirect_url: 'https://pay.test/x' }), null);
  assert.equal(snapRedirect({ token: 'tok' }), null);
  assert.equal(snapRedirect(null), null);
  assert.deepEqual(snapRedirect({ redirect_url: 'https://pay.test/x', token: 'tok' }), { payUrl: 'https://pay.test/x', token: 'tok' });
});

test('the request is answered by a provider that parses it the way Midtrans does', async () => {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: 'snap-token-1', redirect_url: 'https://app.midtrans.com/snap/v1/checkout/snap-token-1' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const request = snapChargeRequest({ ...SNAP_INVOICE, enabled: ['other_qris'], serverKey: 'server-key' });
    const response = await fetch(`http://127.0.0.1:${port}/snap/v1/transactions`, {
      method: request.method, headers: request.headers, body: request.body
    });
    const body = await response.json();
    const redirect = snapRedirect(body);
    assert.ok(redirect, 'a 200 with a redirect and a token is a charge that was opened');
    assert.equal(redirect.token, 'snap-token-1');
    assert.equal(redirect.payUrl, 'https://app.midtrans.com/snap/v1/checkout/snap-token-1');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].authorization, `Basic ${Buffer.from('server-key:').toString('base64')}`);
    assert.equal(JSON.parse(seen[0].body).transaction_details.gross_amount, 99000);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// WHY THE CALL SITE IS TESTED AND NOT ONLY THE HELPER.
// The Snap request was extracted into a helper and the helper was proved against a provider stood up here, while the call inside the Deno function passed a name that did not exist in its scope.
// The function answered 500 to a real invoice and the helper's tests stayed green, because a test of a function says nothing about the call that feeds it.
// So the call is read here and the names it passes are checked against the names its own signature destructures.

// WHY THE ENVIRONMENT IS STATED AND NOT READ FROM THE KEY.
// The first rule read it from the key's prefix on the belief that a sandbox key starts with SB-.
// Measured live for this merchant that was false: both keys start Mid-server-, so a sandbox key reached the production host and was turned away with 401.
// A key cannot name its own environment when the two look alike, so the environment is stated and the refusal log names the host that was used.

test('the charge URL follows the stated environment, because the key cannot say which one it is', () => {
  assert.equal(snapUrlFor('sandbox'), 'https://app.sandbox.midtrans.com/snap/v1/transactions');
  assert.equal(snapUrlFor('production'), 'https://app.midtrans.com/snap/v1/transactions');
  assert.equal(snapUrlFor(''), 'https://app.midtrans.com/snap/v1/transactions', 'an unstated environment is production, and a sandbox key must not reach it by default');
  assert.equal(snapUrlFor('nonsense'), 'https://app.midtrans.com/snap/v1/transactions', 'a typo in the setting is production, not sandbox');
  const sandbox = snapChargeRequest({ ...SNAP_INVOICE, serverKey: 'Mid-server-4zljU5Q', environment: 'sandbox' });
  assert.match(sandbox.url, /sandbox/, 'a sandbox key with sandbox stated reaches the sandbox host');
  const production = snapChargeRequest({ ...SNAP_INVOICE, serverKey: 'Mid-server-4zljU5Q' });
  assert.match(production.url, /app\.midtrans\.com/, 'the same key with nothing stated stays on production');
});

test('the snap charge call passes the customer the function actually has', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  const from = source.indexOf('snapChargeRequest({');
  assert.ok(from >= 0, 'the billing function must call the shared charge builder');
  const call = source.slice(from, source.indexOf('});', from));
  assert.match(call, /customerId:\s*customer_id/,
    'the helper takes customerId and the function has customer_id; a shorthand here is a silent undefined');
  assert.match(source, /createInvoice\(\{\s*customer_id/,
    'the name the call reads must be the name the signature destructures');
  for (const field of ['orderId', 'amountCents', 'currency', 'enabled', 'serverKey']) {
    assert.ok(call.includes(`${field}`), `the call must still pass ${field}`);
  }
});

test('the money rules run where Buffer does not exist, which is where they failed first', () => {
  const saved = globalThis.Buffer;
  const token = invoiceToken('inv-1', 'secret');
  const notification = { order_id: 'order-1', status_code: '200', gross_amount: '4000000' };
  const payload = `${notification.order_id}${notification.status_code}${notification.gross_amount}`;
  const signature_key = createHmac('sha512', 'server-key').update(payload).digest('hex');
  try {
    delete globalThis.Buffer;
    assert.equal(verifyInvoiceToken('inv-1', token, 'secret'), true);
    assert.equal(verifyInvoiceToken('inv-1', 'x'.repeat(32), 'secret'), false);
    assert.equal(notificationSignatureValid({ ...notification, signature_key }, 'server-key'), true);
    assert.equal(notificationSignatureValid({ ...notification, signature_key: 'wrong' }, 'server-key'), false);
  } finally {
    globalThis.Buffer = saved;
  }
});

// WHY A MANUAL SETTLEMENT IS A FIRST-CLASS ROAD AND NOT A BACKDOOR.
// The first customers pay by transfer, because a provider account is not open yet, and an invoice that cannot record that money is a page that lies.
// The rules are the same as the provider's: only an open invoice, only the amount it says, and a note naming who confirmed it - so the ledger can still be checked a year later.

const OPEN = { id: 'Toko Sinar Jaya:2026-09', status: 'open', amount_cents: 9900000, currency: 'IDR' };

test('an open invoice can be settled by a transfer that names who confirmed it', () => {
  const out = manualSettlement(OPEN, { amountCents: 9900000, note: 'BCA 2026-10-22 Rp 99.000, confirmed by owner' });
  assert.equal(out.ok, true);
});

test('a paid invoice is terminal, so a second transfer cannot settle it again', () => {
  const out = manualSettlement({ ...OPEN, status: 'paid' }, { amountCents: 9900000, note: 'second transfer' });
  assert.equal(out.ok, false);
  assert.match(out.why, /paid/);
});

test('a manual settlement for another amount is refused, not rounded', () => {
  const out = manualSettlement(OPEN, { amountCents: 9800000, note: 'underpaid' });
  assert.equal(out.ok, false);
  assert.match(out.why, /amount/);
});

test('a manual settlement without a note is refused, because nobody can check it later', () => {
  const out = manualSettlement(OPEN, { amountCents: 9900000, note: '  ' });
  assert.equal(out.ok, false);
  assert.match(out.why, /note/);
});

test('a void invoice cannot be settled by hand', () => {
  const out = manualSettlement({ ...OPEN, status: 'void' }, { amountCents: 9900000, note: 'called off' });
  assert.equal(out.ok, false);
  assert.match(out.why, /open/);
});

// WHY A PLAN IS PRICED IN ONE LINE AND THE CLIENTS ABOVE IT IN ANOTHER.
// The offer is one number a firm can compare with the hours it saves, not fifteen downloads at a unit price.
// So the plan line carries the month, and only the clients beyond the cap carry a second line: a firm never pays twice for the clients the plan already includes.

const PLAN_PRICES = [
  { kind: 'plan.pilot', unit: 'firm-month, up to 15 clients', amount_cents: 9900000, currency: 'IDR', active: true },
  { kind: 'plan.firm', unit: 'firm-month, up to 50 clients', amount_cents: 24900000, currency: 'IDR', active: true },
  { kind: 'statement.client_month', unit: 'delivered client-month above the plan', amount_cents: 1000000, currency: 'IDR', active: true }
];

const deliveriesFor = (count) => Array.from({ length: count }, (_, index) => ({
  client: `Klien ${index + 1}`,
  period: '2026-10',
  portal: 'BCA'
}));

test('a pilot plan charges one plan line and only the clients above fifteen', () => {
  const out = planInvoiceLines(deliveriesFor(18), 'plan.pilot', '2026-10');
  assert.equal(out.refused.length, 0);
  assert.equal(out.lines.length, 4);
  assert.equal(out.lines[0].kind, 'plan.pilot');
  assert.equal(out.lines[0].quantity, 1);
  assert.match(out.lines[0].description, /up to 15 client-months/);
  assert.deepEqual(out.lines.slice(1).map((line) => line.kind), ['statement.client_month', 'statement.client_month', 'statement.client_month']);
  assert.match(out.lines[1].description, /Klien 16/);
  assert.equal(amountFor(out.lines, PLAN_PRICES).amountCents, 9900000 + 3 * 1000000);
});

test('a firm plan includes fifty clients, so a batch inside the cap is one line', () => {
  const out = planInvoiceLines(deliveriesFor(50), 'plan.firm', '2026-10');
  assert.equal(out.refused.length, 0);
  assert.equal(out.lines.length, 1);
  assert.equal(amountFor(out.lines, PLAN_PRICES).amountCents, 24900000);
});

test('a plan nobody can price is refused instead of billed as zero', () => {
  const out = planInvoiceLines(deliveriesFor(3), 'plan.enterprise', '2026-10');
  assert.equal(out.lines.length, 0);
  assert.match(out.refused[0].reason, /plan/);
});

test('a duplicate client-month is refused inside a plan too', () => {
  const rows = deliveriesFor(2);
  const out = planInvoiceLines([...rows, rows[0]], 'plan.pilot', '2026-10');
  assert.equal(out.lines.length, 0);
  assert.match(out.refused[0].reason, /twice/);
});
