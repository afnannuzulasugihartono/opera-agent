// @last-edited: 2026-10-26 UTC+7.
// @title: billing — what a delivery is worth, and what makes a payment claim true.
// @state: the amount of an invoice, the two signatures, the attempt id a retry gets, the one rule that says whether a payment link is payable, and the rule that an undelivered month is not charged.
// @dependencies: node:test, strict, node:crypto, ../supabase/functions/_shared/billing.js.

// WHY THESE RULES ARE TESTED AND NOT ASSUMED.
// Money is the one place where being wrong is not a bug report but a customer's trust.
// Every rule here is a promise to the person paying: they are charged for what was delivered, they can open their own invoice and nobody else's, and nobody can mark an invoice paid without the provider's signature.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHash,
  createHmac
} from 'node:crypto';
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
  payLinkDeadline,
  payLinkState,
  PAY_LINK_EXPIRY,
  planInvoiceLines,
  priceFor,
  providerAmount,
  providerOrderId,
  providerSaysMissing,
  providerSettlement,
  snapChargeRequest,
  snapExpireRequest,
  snapPaymentMethods,
  snapStatusRequest,
  snapUrlFor,
  providerSignature,
  secretShape,
  snapRedirect,
  SNAP_QRIS_ONLY_BELOW_CENTS,
  verifyInvoiceToken
} from '../supabase/functions/_shared/billing.js';

const seen = [];

const PRICE_LIST = [
  {
    kind: 'statement.client_month',
    unit: 'delivered client-month',
    amount_cents: 500000,
    currency: 'IDR',
    active: true
  }
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
    {
      kind: 'statement.client_month',
      quantity: 5,
      description: 'Agustus 2026, five clients'
    },
    {
      kind: 'statement.client_month',
      quantity: 3
    }
  ], PRICE_LIST);
  assert.equal(out.amountCents, 8 * 500000);
  assert.equal(out.currency, 'IDR');
  assert.equal(out.priced.length, 2);
  assert.equal(out.unpriced.length, 0);
});

test('a delivery of a kind with no price is reported, not charged and not hidden', () => {
  const out = amountFor([
    {
      kind: 'statement.client_month',
      quantity: 1
    },
    {
      kind: 'slides.deck',
      quantity: 2
    }
  ], PRICE_LIST);
  assert.equal(out.amountCents, 500000, 'only the priced line is charged');
  assert.equal(out.unpriced.length, 1);
  assert.match(out.unpriced[0].reason, /no price/);
});

test('a delivery that was not made is not a line, so it is not on the invoice', () => {
  const delivered = [{
    kind: 'statement.client_month',
    quantity: 2
  }];
  const out = amountFor(delivered, PRICE_LIST);
  assert.equal(out.amountCents, 1000000);
  assert.equal(out.priced[0].quantity, 2, 'the invoice says what was delivered');
});

test('a quantity that is not a number is zero, not a surprise bill', () => {
  const out = amountFor([{
    kind: 'statement.client_month',
    quantity: 'three'
  }], PRICE_LIST);
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

// WHY THE PROVIDER'S OWN FORMULA IS PINNED AND NOT RE-DERIVED HERE.
// Midtrans documents signature_key as SHA512(order_id + status_code + gross_amount + ServerKey): the key is appended, not used as an HMAC secret.
// The first version used HMAC and this test made the same call, so the test agreed with the bug while four live payments were refused.
// The vector below was computed by .NET's SHA512 over "oa-1" + "200" + "99000.00" + "SB-Mid-server-test", so agreement is two implementations agreeing.

test('a payment notification is believed only when the provider signed it, by the provider\'s own formula', () => {
  const key = 'SB-Mid-server-test';
  const notification = {
    order_id: 'oa-1',
    status_code: '200',
    gross_amount: '99000.00'
  };
  const expected = '878c25a28679403c167be585e7705708901f13ae769009e499d26b379212361e4edcf331ea90680bbb5023e55db87d48b79bfad6eea45364acb045e48dd17f67';
  assert.equal(providerSignature(notification, key), expected, 'SHA-512 of order, status, amount and key, in that order');
  assert.equal(notificationSignatureValid({
    ...notification,
    signature_key: expected
  }, key), true);
  assert.equal(notificationSignatureValid({
    ...notification,
    signature_key: 'wrong'
  }, key), false);
  assert.equal(notificationSignatureValid({
    ...notification,
    gross_amount: '1',
    signature_key: expected
  }, key), false, 'a bigger claim does not pass');
  assert.equal(notificationSignatureValid({
    ...notification,
    signature_key: expected
  }, 'other-key'), false);
  assert.equal(notificationSignatureValid({
    ...notification,
    signature_key: expected
  }, ''), false, 'without a key nothing is verified');
  assert.equal(notificationSignatureValid({ ...notification }, key), false, 'a body with no signature is not signed');

  // The retired rule: the key as an HMAC secret over the three fields.
  // This is the value the function computed while every real notification was refused.
  const retired = createHmac('sha512', key).update(`${notification.order_id}${notification.status_code}${notification.gross_amount}`).digest('hex');
  assert.equal(notificationSignatureValid({
    ...notification,
    signature_key: retired
  }, key), false, 'an HMAC with the key is not what Midtrans sends');
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
  assert.equal(notificationAcknowledged({
    ok: true,
    invoice: 'Toko Sinar Jaya:2026-08'
  }), true, 'a closed invoice is acknowledged');
  assert.equal(notificationAcknowledged({
    ok: false,
    why: 'the transaction is not settled',
    retry: false
  }), true, 'a signed pending notification is understood, so it is acknowledged');
  assert.equal(notificationAcknowledged({
    ok: false,
    why: 'no invoice with that order id'
  }), false, 'an order we cannot place is not something to acknowledge and forget');
  assert.equal(notificationAcknowledged({
    ok: false,
    why: 'the paid amount is not the invoice amount'
  }), false, 'a wrong amount is a person\'s problem, not a retry');
  assert.equal(notificationAcknowledged(null), false);
});

// WHY A CLOSED INVOICE IS NOT CLOSED AGAIN.
// Measured live on 2026-10-26: a settlement closed an invoice at 08:55:13, a pending notification arrived eleven seconds later, and paid_at moved to 08:55:24.
// The moment money landed is evidence the provider cannot restore, so a second notification may confirm it and must never rewrite it.

test('an invoice that is already paid is not paid again', () => {
  assert.equal(needsClosing({
    status: 'paid',
    paid_at: '2026-10-26T08:55:13Z'
  }), false, 'a paid invoice keeps the moment it was paid');
  assert.equal(needsClosing({
    status: 'paid',
    paid_at: null
  }), true, 'a paid row with no moment is repaired rather than left blank');
  assert.equal(needsClosing({
    status: 'open',
    paid_at: null
  }), true);
  assert.equal(needsClosing(null), false);
});

// WHY THE LOG HAS TO BE WRITTEN FROM BOTH SIDES OF THE VERDICT.
// A refusal used to leave no trace, so "the provider never reached us" and "it reached us and we said no" looked identical, and four payment attempts were spent telling them apart.
// The row is written on the refused branch and on the accepted branch, before the answer is returned.

// WHY THE PROVIDER IS ASKED WHEN THE SIGNATURE DOES NOT MATCH.
// Real notifications arrived from the provider's own user agent and were refused, and the body could not say whether it was forged or signed with a different secret.
// The provider records the transaction, so its answer is stronger than the body: it is about its own transaction, never about the claim in the request.

test('the status of an order is asked on the host the stated environment names', () => {
  const sandbox = snapStatusRequest({
    orderId: 'oa-1',
    serverKey: 'k',
    environment: 'sandbox'
  });
  assert.equal(sandbox.url, 'https://api.sandbox.midtrans.com/v2/oa-1/status');
  assert.equal(sandbox.method, 'GET');
  assert.equal(sandbox.headers.Authorization, `Basic ${Buffer.from('k:').toString('base64')}`);
  const production = snapStatusRequest({
    orderId: 'oa-1',
    serverKey: 'k',
    environment: 'production'
  });
  assert.equal(production.url, 'https://api.midtrans.com/v2/oa-1/status');
  assert.equal(snapStatusRequest({
    orderId: '',
    serverKey: 'k'
  }), null, 'without an order there is nothing to ask about');
});

// WHY A MISSING TRANSACTION IS READ FROM THE BODY AND NOT THE HTTP STATUS.
// Midtrans documents a 200 whose body carries status_code 404 and "Transaction doesn't exist.", and the live attempt on 2026-10-26 answered exactly that while its payment page still showed a pending QRIS.
// A retry that read only the HTTP status refused to close an attempt that was not there, so the customer could never get a second link.
// The rule is a helper because the call site that uses it runs where no Node test can follow.

test('a transaction the provider says does not exist is read from the body, where the 404 hides', () => {
  assert.equal(providerSaysMissing({
    status_code: '404',
    status_message: "Transaction doesn't exist."
  }), true);
  assert.equal(providerSaysMissing({ status_code: 404 }), true, 'the code means the same as a string or a number');
  assert.equal(providerSaysMissing({
    status_code: '201',
    transaction_status: 'pending'
  }), false);
  assert.equal(providerSaysMissing({
    status_code: '401',
    status_message: 'Access denied'
  }), false, 'a refused key is not a missing transaction');
  assert.equal(providerSaysMissing(null), false);

  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /if \(providerSaysMissing\(payload\)\) return \{\s*state: "closed",\s*status: "not found"\s*\}/,
    'the call site treats a missing transaction as nothing to close before it judges the status');
  assert.match(fn, /status_code \$\{\s*code\s*\}/, 'a refused status names the provider code an operator needs');
});

// WHY A RETRY ASKS THE PROVIDER TO EXPIRE THE OLD ATTEMPT.
// A customer who asks for a second link has said the first one is not the one they will pay, and two payable transactions for one invoice is how somebody pays twice.
// The expire call sits beside the status question on the same host, names the order in the path, and carries the key in the header so it never appears in a URL.

test('the expire request closes an attempt on the host the environment names', () => {
  const sandbox = snapExpireRequest({
    orderId: 'oa-1',
    serverKey: 'k',
    environment: 'sandbox'
  });
  assert.equal(sandbox.url, 'https://api.sandbox.midtrans.com/v2/oa-1/expire');
  assert.equal(sandbox.method, 'POST');
  assert.equal(sandbox.headers.Authorization, `Basic ${Buffer.from('k:').toString('base64')}`);
  assert.equal(sandbox.headers.Accept, 'application/json');
  assert.ok(!sandbox.url.includes('k'), 'the key is a header, never part of the URL');
  assert.equal(snapExpireRequest({
    orderId: 'oa-1',
    serverKey: 'k'
  }).url, 'https://api.midtrans.com/v2/oa-1/expire');
  assert.equal(snapExpireRequest({
    orderId: '',
    serverKey: 'k'
  }), null, 'without an order there is nothing to expire');
});

test('only the provider\'s own words for a settlement count as paid', () => {
  assert.deepEqual(providerSettlement({
    transaction_status: 'settlement',
    gross_amount: '99000.00'
  }),
    {
      settled: true,
      status: 'settlement',
      grossAmount: '99000.00',
      paymentType: '',
      transactionId: ''
    });
  assert.equal(providerSettlement({
    transaction_status: 'capture',
    fraud_status: 'accept'
  }).settled, true);
  assert.equal(providerSettlement({
    transaction_status: 'capture',
    fraud_status: 'challenge'
  }).settled, false, 'a challenged capture is not money');
  assert.equal(providerSettlement({ transaction_status: 'pending' }).settled, false);
  assert.equal(providerSettlement({ transaction_status: 'deny' }).settled, false);
  assert.equal(providerSettlement(null).settled, false);
});

// WHY A SETTLEMENT CARRIES HOW THE MONEY CAME.
// "Paid" is the least an operator can be told: a QRIS settlement, a card capture and a transfer are different evidence.
// The provider names the method and its own transaction in every answer, so both are carried back and stored when the invoice closes, and an absent field is an empty string rather than undefined.

test('a settlement carries the method and the transaction the provider named', () => {
  const out = providerSettlement({
    transaction_status: 'settlement',
    gross_amount: '99000.00',
    payment_type: 'qris',
    transaction_id: 'b1e3-4c'
  });
  assert.equal(out.paymentType, 'qris');
  assert.equal(out.transactionId, 'b1e3-4c');
  assert.equal(out.settled, true);
  const bare = providerSettlement({
    transaction_status: 'settlement',
    gross_amount: '99000.00'
  });
  assert.equal(bare.paymentType, '');
  assert.equal(bare.transactionId, '');
  assert.equal(providerSettlement(null).transactionId, '');
  assert.equal(providerSettlement({
    transaction_status: 'capture',
    fraud_status: 'challenge',
    payment_type: 'credit_card'
  }).settled, false, 'a challenged capture is still not money');
});

test('a refused signature asks the provider, and the provider formula is the only one believed', () => {
  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /providerSaysSettled\(String\(notification\.order_id/, 'a refusal must become a question, not an ending');
  assert.match(fn, /notificationSignatureValid\(notification, MIDTRANS_SERVER_KEY\)/, 'the signature is checked by the provider rule');
  assert.doesNotMatch(fn, /whichReadingSigned/, 're-reading the key cannot substitute for the formula the provider uses');
});

// WHY THE SHAPE IS MEASURED AND THE VALUE IS NOT.
// A masked dashboard field cannot show a key that arrived one character too long, and the value must never reach a log.
// A count and a boolean answer the same question without carrying any part of the secret.
// The sandbox prefix SB-Mid-server- was missing from the first version of this rule, so a correct sandbox key was reported as "not a provider key".

test('the shape of a stored secret names a paste artifact without the secret', () => {
  assert.equal(secretShape('Mid-server-abc'), '14 chars, prefix Mid-server-, 0 outside the key alphabet');
  assert.equal(secretShape('SB-Mid-server-abc'), '17 chars, prefix SB-Mid-server-, 0 outside the key alphabet');
  assert.equal(secretShape('SB-Mid-server-abc\n'), '18 chars, prefix SB-Mid-server-, 1 outside the key alphabet');
  assert.equal(secretShape('"Mid-server-abc"'), '16 chars, prefix not a provider key, 2 outside the key alphabet');
  assert.equal(secretShape(''), '0 chars, prefix not a provider key, 0 outside the key alphabet');
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
    {
      client: 'Toko Sinar Jaya',
      portal: 'bank',
      period: '2026-08',
      pages: 2,
      bytes: 5120
    },
    {
      client: 'CV Melati',
      portal: 'bank',
      period: '2026-08',
      pages: 4,
      bytes: 9000
    }
  ];
  const {
    lines,
    refused
  } = linesFromDeliveries(deliveries);
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
    {
      client: 'Toko Sinar Jaya',
      portal: 'bank',
      period: '2026-08'
    },
    {
      client: 'Toko Sinar Jaya',
      portal: 'bank',
      period: '2026-08'
    }
  ];
  const {
    lines,
    refused
  } = linesFromDeliveries(twice);
  assert.equal(lines.length, 1);
  assert.equal(refused.length, 1);
  assert.match(refused[0].reason, /twice/);
});

test('a row without a client or a month cannot be billed', () => {
  const {
    lines,
    refused
  } = linesFromDeliveries([
    {
      client: '',
      period: '2026-08'
    },
    { client: 'CV Melati' }
  ]);
  assert.equal(lines.length, 0);
  assert.equal(refused.length, 2);
  assert.match(refused[0].reason, /client and a month/);
});

test('only a settled notification is a payment, in the spellings a provider uses', () => {
  assert.equal(isSettled({ transaction_status: 'settlement' }), true, 'Midtrans calls a settled transfer settlement');
  assert.equal(isSettled({ transaction_status: 'settled' }), true);
  assert.equal(isSettled({ transaction_status: 'capture' }), true);
  assert.equal(isSettled({
    transaction_status: 'capture',
    fraud_status: 'accept'
  }), true);
  assert.equal(isSettled({
    transaction_status: 'capture',
    fraud_status: 'challenge'
  }), false, 'a card under challenge is not money yet');
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

// WHY A RETRY MUST NOT REUSE AN ORDER ID.
// Midtrans refuses a second charge under an order id it already knows, and a notification names the attempt it belongs to.
// So the attempt number is part of the hash input from the second attempt on, while the first keeps the id it has always had: an invoice that never retried must not change the id under a link already in a customer's hands.

test('a retry opens a new provider order id and the first attempt keeps the old one', () => {
  const id = 'Toko Sinar Jaya:2026-08';
  const first = 'oa-fa2ed682bf-Toko-Sinar-Jaya-2026-08';
  assert.equal(providerOrderId(id, 500000, 'IDR'), first, 'the first charge keeps the id it has always had');
  assert.equal(providerOrderId(id, 500000, 'IDR', 1), first, 'attempt one spelled out is the same id');
  assert.equal(providerOrderId(id, 500000, 'IDR', 2), 'oa-d81632ac38-Toko-Sinar-Jaya-2026-08');
  assert.equal(providerOrderId(id, 500000, 'IDR', 3), 'oa-20a026b1c5-Toko-Sinar-Jaya-2026-08');
  assert.notEqual(providerOrderId(id, 500000, 'IDR', 2), providerOrderId(id, 500000, 'IDR', 3), 'two retries are two transactions');
  for (const attempt of [1, 2, 3, 99]) {
    const orderId = providerOrderId(id, 500000, 'IDR', attempt);
    assert.match(orderId, /^[A-Za-z0-9._~-]{1,50}$/);
    assert.ok(orderId.length <= 50);
  }
  assert.match(providerOrderId('a'.repeat(200), 500000, 'IDR', 7), /^[A-Za-z0-9._~-]{1,50}$/);
  assert.equal(providerOrderId(id, 500000, 'IDR', 'nonsense'), first, 'an attempt that is not a number is the first one');
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
  const request = snapChargeRequest({
    ...SNAP_INVOICE,
    enabled: ['other_qris'],
    serverKey: 'server-key'
  });
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
  assert.equal(snapChargeRequest({
    ...SNAP_INVOICE,
    amountCents: 50,
    enabled: ['other_qris']
  }), null);
  assert.equal(snapChargeRequest({
    ...SNAP_INVOICE,
    currency: 'USD',
    enabled: ['other_qris']
  }), null);
});

// WHY THE DEADLINE IS THE PROVIDER'S AND THE PAGE'S AT ONCE.
// The provider is asked for a 24-hour link and the page prints the moment it stops working; two numbers would drift and the page would lie about a link that had already died.
// The deadline is computed from the same constant the request carries, so the customer reads the provider's own clock rather than a second opinion.

test('the charge carries the expiry only when asked, and the deadline is the same 24 hours', () => {
  const plain = JSON.parse(snapChargeRequest({
    ...SNAP_INVOICE,
    serverKey: 'server-key'
  }).body);
  assert.equal(plain.expiry, undefined, 'a charge without an expiry keeps the provider default');
  const timed = snapChargeRequest({
    ...SNAP_INVOICE,
    serverKey: 'server-key',
    expiry: PAY_LINK_EXPIRY
  });
  assert.deepEqual(JSON.parse(timed.body).expiry, {
    unit: 'hour',
    duration: 24
  });
  assert.equal(Object.isFrozen(PAY_LINK_EXPIRY), true);
  assert.equal(payLinkDeadline(Date.parse('2026-10-26T00:00:00Z')), '2026-10-27T00:00:00.000Z');
  const sandbox = snapChargeRequest({
    ...SNAP_INVOICE,
    serverKey: 'SB-Mid-server-4zljU5Q',
    environment: 'sandbox',
    expiry: PAY_LINK_EXPIRY
  });
  assert.match(sandbox.url, /sandbox/, 'the expiry does not change the host the environment names');
  assert.equal(JSON.parse(timed.body).transaction_details.gross_amount, 99000, 'the expiry does not change the amount');
});

// WHY THE LINK'S STATE IS ONE RULE.
// The page, the create path and the refresh action all have to answer "can this link be paid?", and three answers would disagree the day one of them moved.
// An unparseable deadline is "unknown" and not "expired": a link that may work is shown with an honest sentence, never hidden behind a guess.

test('a payment link is none, unknown, live or expired, and one rule says which', () => {
  const now = Date.parse('2026-10-26T09:00:00Z');
  assert.equal(payLinkState({ pay_url: null }, now), 'none');
  assert.equal(payLinkState(null, now), 'none');
  assert.equal(payLinkState({ pay_url: 'https://pay.test/x' }, now), 'unknown', 'a link with no deadline is not a dead link');
  assert.equal(payLinkState({
    pay_url: 'https://pay.test/x',
    pay_url_expires_at: 'not a date'
  }, now), 'unknown');
  assert.equal(payLinkState({
    pay_url: 'https://pay.test/x',
    pay_url_expires_at: '2026-10-27T09:00:00.000Z'
  }, now), 'live');
  assert.equal(payLinkState({
    pay_url: 'https://pay.test/x',
    pay_url_expires_at: '2026-10-25T09:00:00.000Z'
  }, now), 'expired');
  assert.equal(payLinkState({
    pay_url: 'https://pay.test/x',
    pay_url_expires_at: '2026-10-26T09:00:00.000Z'
  }, now), 'expired', 'the deadline itself is the end');
});

test('a redirect without a token is not a way to pay, and a good one is', () => {
  assert.equal(snapRedirect({ redirect_url: 'https://pay.test/x' }), null);
  assert.equal(snapRedirect({ token: 'tok' }), null);
  assert.equal(snapRedirect(null), null);
  assert.deepEqual(snapRedirect({
    redirect_url: 'https://pay.test/x',
    token: 'tok'
  }), {
    payUrl: 'https://pay.test/x',
    token: 'tok'
  });
});

test('the request is answered by a provider that parses it the way Midtrans does', async () => {
  const server = http.createServer((
    req,
    res
  ) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8')
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        token: 'snap-token-1',
        redirect_url: 'https://app.midtrans.com/snap/v1/checkout/snap-token-1'
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const request = snapChargeRequest({
      ...SNAP_INVOICE,
      enabled: ['other_qris'],
      serverKey: 'server-key'
    });
    const response = await fetch(`http://127.0.0.1:${port}/snap/v1/transactions`, {
      method: request.method,
      headers: request.headers,
      body: request.body
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
// The prefix does name the environment today - sandbox keys start SB-Mid-server-, production keys Mid-server- - but the host is a setting the operator controls, not a fact parsed out of a secret.
// A key sent to the wrong host is refused with 401 and no charge, which looks exactly like a bad key, so the rule states the environment and the refusal log names the host that was used.

test('the charge URL follows the stated environment, and is never inferred from the key', () => {
  assert.equal(snapUrlFor('sandbox'), 'https://app.sandbox.midtrans.com/snap/v1/transactions');
  assert.equal(snapUrlFor('production'), 'https://app.midtrans.com/snap/v1/transactions');
  assert.equal(snapUrlFor(''), 'https://app.midtrans.com/snap/v1/transactions', 'an unstated environment is production, and a sandbox key must not reach it by default');
  assert.equal(snapUrlFor('nonsense'), 'https://app.midtrans.com/snap/v1/transactions', 'a typo in the setting is production, not sandbox');
  const sandbox = snapChargeRequest({
    ...SNAP_INVOICE,
    serverKey: 'SB-Mid-server-4zljU5Q',
    environment: 'sandbox'
  });
  assert.match(sandbox.url, /sandbox/, 'a sandbox key with sandbox stated reaches the sandbox host');
  const production = snapChargeRequest({
    ...SNAP_INVOICE,
    serverKey: 'Mid-server-4zljU5Q'
  });
  assert.match(production.url, /app\.midtrans\.com/, 'a production key with nothing stated stays on production');
});

test('the snap charge call passes the customer the function actually has', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  const from = source.indexOf('snapChargeRequest({');
  assert.ok(from >= 0, 'the billing function must call the shared charge builder');
  const call = source.slice(from, source.indexOf('});', from));
  assert.match(call, /customerId:\s*customerId/,
    'the helper takes customerId and the attempt builder has it; a shorthand here is a silent undefined');
  assert.match(source, /openNewAttempt\([^)]*\{ customerId/,
    'the name the call reads must be the name the caller holds');
  assert.match(source, /createInvoice\(\{\s*customer_id/,
    'the name the call reads must be the name the signature destructures');
  for (const field of ['orderId', 'amountCents', 'currency', 'enabled', 'serverKey']) {
    assert.ok(call.includes(`${field}`), `the call must still pass ${field}`);
  }
});

// WHY THE LIFECYCLE IS PINNED IN THE SOURCE AND NOT ONLY IN THE HELPERS.
// The helpers decide what a link is and what an attempt id is; the function decides when a link is replaced, which attempt a notification closes, and which row a write may touch.
// A helper test says nothing about a call that reads the wrong row, so the three rules that keep one payable transaction per invoice are named here.

test('one invoice keeps one payable transaction, and an older attempt cannot kill the current link', () => {
  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /contains\("provider_order_ids", \[orderId\]\)/, 'a notification is placed by every attempt the invoice opened');
  assert.doesNotMatch(fn, /eq\("provider_order_id", orderId\)/, 'the scalar is one attempt, not the index');
  assert.match(fn, /String\(invoice\.provider_order_id \|\| ""\) === orderId/, 'only the current attempt may clear the link');
  assert.match(fn, /payLinkState\(/, 'the create path and the page share one rule for a live link');
  assert.match(fn, /expiry: PAY_LINK_EXPIRY/, 'the stored deadline and the provider request use one constant');
  assert.match(fn, /is\("paid_at", null\)/, 'a write never reopens a paid row');
});

// WHY THE OPERATOR'S LINK IS PINNED TO THE SITE.
// Measured live on 2026-10-26: the shared function domain answers the page as text/plain under a sandbox policy, so the function's own URL shows a customer source instead of a bill.
// The site serves the same page through landing/_worker.js, so the link an operator hands out is built from BILLING_PAGE_URL, and the function's URL remains only the fallback for a deployment that never set it.

test('the operator link names the page host, and falls back to the function', () => {
  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /BILLING_PAGE_URL = \(Deno\.env\.get\("BILLING_PAGE_URL"\) \|\| ""\)\.replace\(\/\\\/\+\$\/, ""\)/,
    'the setting is read once and its trailing slash cannot double the page path');
  assert.match(fn, /const base = BILLING_PAGE_URL \|\| `\$\{SUPABASE_URL\}\/functions\/v1\/opera-agent-billing`/,
    'a deployment without the setting still answers with a link that works');
  assert.match(fn, /const link = `\$\{base\}\?invoice_id=\$\{encodeURIComponent\(out\.invoice\.id\)\}&token=\$\{out\.token\}`/,
    'the link carries the invoice and the token, encoded');
});

test('the money rules run where Buffer does not exist, which is where they failed first', () => {
  const saved = globalThis.Buffer;
  const token = invoiceToken('inv-1', 'secret');
  const notification = {
    order_id: 'order-1',
    status_code: '200',
    gross_amount: '4000000'
  };
  const signature_key = createHash('sha512')
    .update(`${notification.order_id}${notification.status_code}${notification.gross_amount}server-key`)
    .digest('hex');
  try {
    delete globalThis.Buffer;
    assert.equal(verifyInvoiceToken('inv-1', token, 'secret'), true);
    assert.equal(verifyInvoiceToken('inv-1', 'x'.repeat(32), 'secret'), false);
    assert.equal(notificationSignatureValid({
      ...notification,
      signature_key
    }, 'server-key'), true);
    assert.equal(notificationSignatureValid({
      ...notification,
      signature_key: 'wrong'
    }, 'server-key'), false);
  } finally {
    globalThis.Buffer = saved;
  }
});

// WHY A MANUAL SETTLEMENT IS A FIRST-CLASS ROAD AND NOT A BACKDOOR.
// The first customers pay by transfer, because a provider account is not open yet, and an invoice that cannot record that money is a page that lies.
// The rules are the same as the provider's: only an open invoice, only the amount it says, and a note naming who confirmed it - so the ledger can still be checked a year later.

const OPEN = {
  id: 'Toko Sinar Jaya:2026-09',
  status: 'open',
  amount_cents: 9900000,
  currency: 'IDR'
};

test('an open invoice can be settled by a transfer that names who confirmed it', () => {
  const out = manualSettlement(OPEN, {
    amountCents: 9900000,
    note: 'BCA 2026-10-22 Rp 99.000, confirmed by owner'
  });
  assert.equal(out.ok, true);
});

test('a paid invoice is terminal, so a second transfer cannot settle it again', () => {
  const out = manualSettlement({
    ...OPEN,
    status: 'paid'
  }, {
    amountCents: 9900000,
    note: 'second transfer'
  });
  assert.equal(out.ok, false);
  assert.match(out.why, /paid/);
});

test('a manual settlement for another amount is refused, not rounded', () => {
  const out = manualSettlement(OPEN, {
    amountCents: 9800000,
    note: 'underpaid'
  });
  assert.equal(out.ok, false);
  assert.match(out.why, /amount/);
});

test('a manual settlement without a note is refused, because nobody can check it later', () => {
  const out = manualSettlement(OPEN, {
    amountCents: 9900000,
    note: '  '
  });
  assert.equal(out.ok, false);
  assert.match(out.why, /note/);
});

test('a void invoice cannot be settled by hand', () => {
  const out = manualSettlement({
    ...OPEN,
    status: 'void'
  }, {
    amountCents: 9900000,
    note: 'called off'
  });
  assert.equal(out.ok, false);
  assert.match(out.why, /open/);
});

// WHY A PLAN IS PRICED IN ONE LINE AND THE CLIENTS ABOVE IT IN ANOTHER.
// The offer is one number a firm can compare with the hours it saves, not fifteen downloads at a unit price.
// So the plan line carries the month, and only the clients beyond the cap carry a second line: a firm never pays twice for the clients the plan already includes.

const PLAN_PRICES = [
  {
    kind: 'plan.pilot',
    unit: 'firm-month, up to 15 clients',
    amount_cents: 9900000,
    currency: 'IDR',
    active: true
  },
  {
    kind: 'plan.firm',
    unit: 'firm-month, up to 50 clients',
    amount_cents: 24900000,
    currency: 'IDR',
    active: true
  },
  {
    kind: 'statement.client_month',
    unit: 'delivered client-month above the plan',
    amount_cents: 1000000,
    currency: 'IDR',
    active: true
  }
];

const deliveriesFor = (count) => Array.from({ length: count }, (
  _,
  index
) => ({
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
  assert.deepEqual(out.lines.slice(1).map((line) => line.kind), [
    'statement.client_month',
    'statement.client_month',
    'statement.client_month'
  ]);
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
  const out = planInvoiceLines([
    ...rows,
    rows[0]
  ], 'plan.pilot', '2026-10');
  assert.equal(out.lines.length, 0);
  assert.match(out.refused[0].reason, /twice/);
});
