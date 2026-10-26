// @last-edited: 2026-10-21 UTC+7.
// @title: billing — what a delivery is worth, and how an invoice proves it.
// @state: the price of a unit, the amount of an invoice, and the two signatures that make a payment claim true.
// @dependencies: node:crypto.

// WHY THE MONEY IS DATA AND NOT CODE.
// The unit that is sold is the delivered client-month, and its price changes between a pilot, a market and a country.
// So the price lives in a table, and this module only knows how to read it: one rule that turns a list of deliveries into an amount, and two rules that decide whether a payment claim is worth believing.

// WHY THE AMOUNT IS COMPUTED FROM THE DELIVERIES, NOT STORED.
// An invoice that says "Rp 25.000" and lists nothing cannot be checked by the person paying it.
// An invoice that carries the deliveries it charges for can be checked line by line, and a delivery that was not made is not charged: the rule is that only what the proof says was delivered is priced.

// WHY A LINE WITH NO PRICE IS NOT CHARGED AND NOT HIDDEN.
// A delivery of a kind that has no price yet is real work, and silently dropping it would be a lie; pricing it at zero would be a discount nobody agreed to.
// So it comes back as an unpriced line, and the invoice says so.

// WHY THE INVOICE IS DERIVED FROM THE MANIFEST AND NOT FROM A TYPED LIST.
// A list typed by hand is a claim; the manifest is a record, and it already holds one row per delivered client-month with the file, the bytes and the page count.
// So the invoice takes those rows and gives each one a line, and it refuses the whole request when a row has no client or when one client-month appears twice: a bill that quietly drops a month, or charges it twice, is worse than a bill that was never sent.

// WHY THE TOKEN IS AN HMAC AND NOT A RANDOM STRING.
// A random token has to be looked up, which means the server has to trust its own storage.
// An HMAC over the invoice id carries the same authority in the link itself: the server can tell a token it made from a token somebody guessed, without a lookup.

// WHY THE NOTIFICATION SIGNATURE IS OVER THE ORDER, NOT THE WHOLE BODY.
// The provider computes a signature over the order id, the status code and the gross amount with the server key.
// Checking exactly those three fields means a tampered body cannot pass, and a different amount cannot pass.

// WHY ONLY A SETTLED STATUS COUNTS AS PAID.
// A provider sends many notifications for one order, and most of them are not the payment.
// Only the settled one means the money moved, and the invoice is marked paid from that one.
// Midtrans spells that status "settlement", and a card payment arrives as "capture" only when the fraud check accepted it, so both spellings are handled and neither is guessed at.

// WHY THE COMPARISON DOES NOT USE Buffer.
// The same rules run in the edge function, where Node's Buffer does not exist: the first deploy built invoices fine and then answered "Buffer is not defined" to every customer who opened one.
// Comparing two hex strings character by character costs nothing and runs everywhere, and it still takes the same time whether the first character is wrong or the last one is.

// WHY A SMALL INVOICE OFFERS ONLY QRIS.
// Midtrans charges a percentage for QRIS and a fixed fee for a virtual account (Rp 4.000) or a card (Rp 2.000 plus a percentage).
// On a Rp 10.000 invoice the fixed fee is 40% of the money, so offering every method would let the customer choose to hand the margin to the bank.
// QRIS is the one method with no fixed fee, and it is accepted by every Indonesian bank and e-wallet app, so below Rp 100.000 the checkout opens straight into QRIS.
// Above it, a fixed fee is small enough that choice is worth more than the fee, and the provider's own list is used.

// WHY THE PROVIDER GETS ITS OWN ORDER ID.
// Midtrans accepts only letters, digits and dash, underscore, tilde and dot in an order id, and refuses the whole transaction on any other character.
// The invoice id is "<customer>:<period>" and a customer name has spaces, so the id that a person reads cannot be the id the provider is given.
// The provider id is derived from the invoice id, the amount and the currency: it is stable for an unchanged invoice, it changes when the amount changes, and it is always legal.

// WHY THE PROVIDER AMOUNT IS NOT THE LEDGER AMOUNT.
// The ledger stores cents, because a price can have a fractional unit; Midtrans charges whole rupiah, because the rupiah has no subunit in a card transaction.
// Sending 500000 for a Rp 5.000 invoice would ask the customer for Rp 500.000, so the conversion happens at the provider boundary in both directions: out to the charge, and back from the notification before it is compared.
// A notification for Rp 500.000 therefore cannot close a Rp 5.000 invoice.

import { createHash, createHmac } from 'node:crypto';

function hmacSha512(secret, payload) {
  return createHmac('sha512', secret).update(payload).digest('hex');
}

function sameText(expected, given) {
  if (typeof expected !== 'string' || typeof given !== 'string') return false;
  if (expected.length !== given.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  }
  return difference === 0;
}

export function invoiceToken(invoiceId, secret) {
  return hmacSha512(secret, `invoice:${invoiceId}`).slice(0, 32);
}

export function verifyInvoiceToken(invoiceId, token, secret) {
  if (!invoiceId || !token || !secret) return false;
  const expected = invoiceToken(invoiceId, secret);
  return sameText(expected, token);
}

export function priceFor(priceList, kind) {
  const entry = (priceList || []).find((row) => row.kind === kind && row.active !== false);
  if (!entry) return null;
  return { kind: entry.kind, unit: entry.unit, amountCents: Number(entry.amount_cents), currency: entry.currency || 'IDR' };
}

export function amountFor(lines, priceList) {
  const priced = [];
  const unpriced = [];
  let amountCents = 0;
  let currency = 'IDR';
  for (const line of lines || []) {
    const price = priceFor(priceList, line.kind);
    if (!price) {
      unpriced.push({ ...line, reason: 'no price for this kind' });
      continue;
    }
    const quantity = Math.max(0, Number(line.quantity) || 0);
    const lineAmount = price.amountCents * quantity;
    amountCents += lineAmount;
    currency = price.currency;
    priced.push({
      kind: line.kind,
      unit: price.unit,
      quantity,
      amountCents: lineAmount,
      description: line.description || null
    });
  }
  return { amountCents, currency, priced, unpriced };
}

export function providerAmount(amountCents, currency = 'IDR') {
  if (String(currency || '').toUpperCase() !== 'IDR') return null;
  const cents = Number(amountCents);
  if (!Number.isFinite(cents) || cents < 100) return null;
  return Math.round(cents / 100);
}

export function paidAmountCents(grossAmount, currency = 'IDR') {
  const value = Number(grossAmount);
  if (!Number.isFinite(value)) return null;
  const unit = String(currency || '').toUpperCase();
  if (unit !== 'IDR' && unit !== 'USD') return null;
  return Math.round(value * 100);
}

export function providerOrderId(invoiceId, amountCents, currency = 'IDR') {
  const stamp = createHash('sha256')
    .update(`${invoiceId}\u0000${Number(amountCents) || 0}\u0000${currency || 'IDR'}`)
    .digest('hex')
    .slice(0, 10);
  const readable = String(invoiceId || '')
    .replace(/[^A-Za-z0-9._~-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 36);
  return `oa-${stamp}-${readable}`.slice(0, 50);
}

export const SNAP_QRIS_ONLY_BELOW_CENTS = 10_000_000;

export function snapPaymentMethods(amountCents, currency = 'IDR') {
  const amount = Number(amountCents);
  if (String(currency || '').toUpperCase() !== 'IDR') {
    return {
      chargeable: false,
      enabled: null,
      why: 'Midtrans charges rupiah only; an invoice in another currency needs a provider that settles it'
    };
  }
  if (!(amount >= 100)) {
    return { chargeable: false, enabled: null, why: 'a rupiah charge needs at least one whole rupiah' };
  }
  if (amount < SNAP_QRIS_ONLY_BELOW_CENTS) {
    return {
      chargeable: true,
      enabled: ['other_qris'],
      why: 'QRIS is the only method with no fixed fee, and a fixed fee would eat a small invoice'
    };
  }
  return { chargeable: true, enabled: null, why: 'the amount can carry a fixed fee, so the provider lists the methods' };
}

// WHY THE SNAP REQUEST IS A FUNCTION AND NOT AN INLINE FETCH.
// The one step nobody had driven was the request itself, and the reason was that it was a fetch inside a Deno handler, so no test could reach it.
// Building the request here means the shape - the legal order id, the whole rupiah, the QRIS-only list, the Basic header - is checkable against a provider that is stood up in a test, and only the network call stays in the function.
// The provider is still Midtrans and the URL is still theirs: the function decides nothing this module did not decide first.

// WHY THE ENVIRONMENT IS NAMED AND NOT GUESSED FROM THE KEY.
// Midtrans serves sandbox and production on different hosts and each refuses the other's key.
// The first version of this rule read the environment from the key's prefix, on the belief that a sandbox key starts with SB-.
// Measured live, that belief was false for this merchant: the sandbox key and the production key both start Mid-server-, so the sandbox key was sent to the production host and turned away with 401.
// A key cannot name its own environment when both look alike, so the environment is stated, and the refusal log names the host that was used so a mismatch is visible instead of silent.

export const SNAP_ENVIRONMENTS = Object.freeze({
  production: 'https://app.midtrans.com/snap/v1/transactions',
  sandbox: 'https://app.sandbox.midtrans.com/snap/v1/transactions'
});

export function snapUrlFor(environment) {
  return SNAP_ENVIRONMENTS[String(environment || 'production')] || SNAP_ENVIRONMENTS.production;
}

export function snapChargeRequest({ orderId, amountCents, currency = 'IDR', customerId = '', enabled = null, serverKey = '', environment = 'production' }) {
  const gross = providerAmount(amountCents, currency);
  if (gross === null) return null;
  const request = {
    transaction_details: { order_id: String(orderId), gross_amount: gross },
    customer_details: { first_name: String(customerId || '').slice(0, 50) }
  };
  if (enabled) request.enabled_payments = enabled;
  return {
    url: snapUrlFor(environment),
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${serverKey}:`)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  };
}

// WHY A REFUSED SIGNATURE ASKS THE PROVIDER INSTEAD OF ENDING THE CONVERSATION.
// A signature that does not match has two causes that look identical from the body: it was not signed by the provider, or it was signed with a different secret than the one stored here.
// Measured live on 2026-10-26: real notifications arrived from the provider's own user agent, carried signature_key and the right amount, and every one was refused, with nothing in the body able to say which cause it was.
// The provider records the transaction and will say what happened to it, over the same key the charge already used, so the answer to a refused signature is a question, not a rejection.
// A forged body cannot pass this: the provider answers about its own transaction, never about the claim in the request.

export const SNAP_STATUS = Object.freeze({
  production: 'https://api.midtrans.com/v2',
  sandbox: 'https://api.sandbox.midtrans.com/v2'
});

export function snapStatusUrl(environment, orderId) {
  const base = SNAP_STATUS[String(environment || 'production')] || SNAP_STATUS.production;
  return `${base}/${encodeURIComponent(String(orderId || ''))}/status`;
}

export function snapStatusRequest({ orderId, serverKey = '', environment = 'production' }) {
  if (!orderId) return null;
  return {
    url: snapStatusUrl(environment, orderId),
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${serverKey}:`)}`,
      Accept: 'application/json'
    }
  };
}

export function providerSettlement(payload) {
  if (!payload || typeof payload !== 'object') return { settled: false, status: '', grossAmount: '' };
  const status = String(payload.transaction_status || '');
  const fraud = String(payload.fraud_status === undefined ? 'accept' : payload.fraud_status);
  const settled = status === 'settlement' || (status === 'capture' && (fraud === 'accept' || fraud === ''));
  return { settled, status, grossAmount: String(payload.gross_amount === undefined ? '' : payload.gross_amount) };
}

// WHY THE REDIRECT IS READ BY ONE RULE.
// The provider answers with a redirect_url and a token, and either one missing means the charge was not opened even though the HTTP status said otherwise.
// One function decides what a good answer is, so the function cannot accept a 200 that carries no way to pay.

export function snapRedirect(response) {
  if (!response || typeof response !== 'object') return null;
  const url = typeof response.redirect_url === 'string' ? response.redirect_url : '';
  const token = typeof response.token === 'string' ? response.token : '';
  if (!url || !token) return null;
  return { payUrl: url, token };
}

export function linesFromDeliveries(deliveries, kind = 'statement.client_month') {
  const seen = new Set();
  const lines = [];
  const refused = [];
  for (const row of deliveries || []) {
    const client = String(row?.client || '').trim();
    const period = String(row?.period || '').trim();
    const portal = String(row?.portal || '').trim();
    if (!client || !period) {
      refused.push({ row, reason: 'a delivery without a client and a month cannot be billed' });
      continue;
    }
    const key = `${client}\u0000${portal}\u0000${period}`;
    if (seen.has(key)) {
      refused.push({ row, reason: `${client} ${period} is in the list twice; one client-month is one line` });
      continue;
    }
    seen.add(key);
    const pages = Number(row?.pages);
    lines.push({
      kind,
      quantity: 1,
      description: pages > 0 ? `${client} — ${period} (${pages} pages)` : `${client} — ${period}`
    });
  }
  return { lines, refused };
}

// WHY A TRANSFER IS THE FIRST ROAD AND NOT A SPECIAL CASE.
// The first customer pays before a provider account exists, and an invoice that cannot record that money is a page that lies.
// So a transfer follows the same rules the provider does: only an open invoice, only the amount it says, and a note that names who confirmed it, because the ledger has to be checkable a year later.

export function manualSettlement(invoice, { amountCents = null, note = '' } = {}) {
  if (!invoice) return { ok: false, why: 'no invoice to settle' };
  const status = String(invoice.status || '').toLowerCase();
  if (status === 'paid') return { ok: false, why: 'this invoice is already paid, and a paid invoice is terminal' };
  if (status !== 'open') return { ok: false, why: `only an open invoice can be settled, and this one is ${status || 'stateless'}` };
  if (amountCents !== null && amountCents !== undefined && Number(amountCents) !== Number(invoice.amount_cents)) {
    return { ok: false, why: `the amount does not match the invoice: expected ${invoice.amount_cents}, got ${amountCents}` };
  }
  const text = String(note || '').trim();
  if (text.length < 3) return { ok: false, why: 'a manual settlement needs a note, so the ledger can be checked later' };
  return { ok: true };
}

// WHY A PLAN IS A PRICE AND NOT A DISCOUNT APPLIED AFTERWARDS.
// The offer is one number a firm compares with the hours it saves, so the plan is its own kind of line.
// The clients the plan includes are not lines at all, and only the clients above the cap are: a discount line would make the invoice say two numbers for one agreement, and the customer would have to trust the arithmetic.

export const PLAN_INCLUDED = { 'plan.pilot': 15, 'plan.firm': 50 };

export function planInvoiceLines(deliveries, plan, period) {
  const included = PLAN_INCLUDED[plan];
  if (!included) {
    return { lines: [], refused: [{ reason: `no plan named ${plan || 'nothing'} in the price list` }] };
  }
  const derived = linesFromDeliveries(deliveries);
  if (derived.refused.length) return { lines: [], refused: derived.refused };
  const label = plan === 'plan.pilot' ? 'Pilot' : 'Firm';
  const lines = [{
    kind: plan,
    quantity: 1,
    description: `${label} — up to ${included} client-months, ${period}`
  }];
  for (const row of derived.lines.slice(included)) {
    lines.push({ ...row, kind: 'statement.client_month', description: `${row.description} (above plan)` });
  }
  return { lines, refused: [], included: Math.min(derived.lines.length, included) };
}

// WHY THE FIELD IS signature_key AND NOT signature.
// Midtrans names the field signature_key, and the first version of this rule read notification.signature instead.
// Measured live: a sandbox payment settled, Midtrans said PAID, and the invoice stayed open, because the signature it sent arrived in a field this code did not read and the comparison was made against nothing.
// A notification is the only way an invoice becomes paid, so a field name that does not match the provider's contract is a payment that silently never lands.
// The alias is accepted because the value still has to match the HMAC; the field name is not the secret.

// WHY A STORED SECRET IS READ MORE THAN ONE WAY.
// A key is copied by a person and pasted into a dashboard, so it can carry what a clipboard adds: a newline, a zero-width space, a non-breaking space.
// The signature is computed over the exact value stored here, so one invisible character makes every notification fail while nothing about the body looks wrong.
// Measured live on 2026-10-26: the charge opened with the stored key and every notification signed with it was refused, and trim() alone did not explain it.
// The readings are tried against the notification itself and the one that matched is named, so a paste artifact is reported instead of hidden behind a fallback.

export const SECRET_READINGS = Object.freeze(['as-stored', 'trimmed', 'printable-ascii']);

export function readSecret(secret, reading) {
  const raw = secret === undefined || secret === null ? '' : String(secret);
  if (reading === 'trimmed') return raw.trim();
  if (reading === 'printable-ascii') return raw.replace(/[^\x21-\x7e]/g, '');
  return raw;
}

export function whichReadingSigned(notification, secret) {
  for (const reading of SECRET_READINGS) {
    if (notificationSignatureValid(notification, readSecret(secret, reading))) return reading;
  }
  return 'none';
}

export function notificationSignatureValid(notification, serverKey) {
  if (!notification || !serverKey) return false;
  const orderId = String(notification.order_id || '');
  const statusCode = String(notification.status_code || '');
  const grossAmount = String(notification.gross_amount || '');
  if (!orderId || !statusCode || !grossAmount) return false;
  const expected = hmacSha512(serverKey, `${orderId}${statusCode}${grossAmount}`);
  const given = notification.signature_key ?? notification.signature;
  return sameText(expected, String(given || ''));
}

// WHY THE ANSWER TO A NOTIFICATION IS NOT THE PAYMENT RESULT.
// The provider reads a non-2xx answer as "not delivered" and sends the same body again.
// So the status code answers one question — did this endpoint receive and understand it — while the body says whether money moved.
// Measured live: a correctly signed "still pending" answered 400, and the provider's history showed it as undelivered beside a real rejection, which buried the rejection.
// A body the function cannot act on and a human should look at still answers no.

// WHY A CLOSED INVOICE IS NOT CLOSED AGAIN.
// The provider repeats itself, so the same settlement arrives more than once and a late notification can follow the one that closed the invoice.
// The moment money landed is evidence: a second notification may confirm it, never move it.

export function needsClosing(invoice) {
  if (!invoice) return false;
  return invoice.status !== 'paid' || !invoice.paid_at;
}

export function notificationAcknowledged(outcome) {
  if (!outcome) return false;
  if (outcome.ok) return true;
  return outcome.retry === false;
}

export function isSettled(notification) {
  const status = String(notification?.transaction_status || notification?.status || '').toLowerCase();
  if (status === 'capture') {
    const fraud = String(notification?.fraud_status || '').toLowerCase();
    return fraud === '' || fraud === 'accept';
  }
  return status === 'settlement' || status === 'settled' || status === 'paid' || status === 'success';
}
