// @last-edited: 2026-10-28 UTC+7.
// @title: billing — what a delivery is worth, and how an invoice proves it.
// @state: the price of a unit, the amount of an invoice, the two signatures that make a payment claim true, the provider order id an attempt carries, and the one rule that says whether a payment link is still payable.
// @dependencies: node:crypto.

// WHY THE MONEY IS DATA AND NOT CODE.
// The unit that is sold is the delivered client-month, and its price changes between a pilot, a market and a country.
// So the price lives in a table, and this module only knows how to read it.

// WHY THE AMOUNT IS COMPUTED FROM THE DELIVERIES, NOT STORED.
// An invoice that lists nothing cannot be checked by the person paying it; one that carries its deliveries can be checked line by line.
// A delivery that was not made is not charged: only what the proof says was delivered is priced.

// WHY A LINE WITH NO PRICE IS NOT CHARGED AND NOT HIDDEN.
// Dropping a delivery of a kind with no price yet would hide real work, and pricing it at zero would be a discount nobody agreed to.
// So it comes back as an unpriced line, and the invoice says so.

// WHY THE INVOICE IS DERIVED FROM THE MANIFEST AND NOT FROM A TYPED LIST.
// A list typed by hand is a claim, while the manifest is a record holding one row per delivered client-month with the file, the bytes and the page count.
// The invoice gives each row a line and refuses the request when a row has no client or a client-month appears twice: a bill that drops a month or charges it twice is worse than a bill never sent.

// WHY THE TOKEN IS AN HMAC AND NOT A RANDOM STRING.
// A random token has to be looked up, which means the server has to trust its own storage.
// An HMAC over the invoice id carries the same authority in the link itself, so a token the server made can be told from a guessed one without a lookup.

// WHY THE NOTIFICATION SIGNATURE IS OVER THE ORDER, NOT THE WHOLE BODY.
// The provider signs the order id, the status code and the gross amount with the server key, so checking exactly those three refuses a tampered body and a different amount.

// WHY ONLY A SETTLED STATUS COUNTS AS PAID.
// The provider sends many notifications for one order and most are not the payment, so only the settled one marks the money moved.
// Midtrans spells it "settlement", and a card arrives as "capture" only when the fraud check accepted it, so both are handled and neither is guessed at.

// WHY THE COMPARISON DOES NOT USE Buffer.
// The same rules run in the edge function where Node's Buffer does not exist, and the first deploy answered "Buffer is not defined" to every customer who opened an invoice.
// Character-by-character comparison runs everywhere and still takes the same time whether the first or the last character is wrong.

// WHY A SMALL INVOICE OFFERS ONLY QRIS.
// Midtrans charges a fixed fee for a virtual account or a card and a percentage for QRIS, which has none.
// On a small invoice the fixed fee is a large share of the money, so only the method with no fixed fee is offered, and the provider's own list is used once a fixed fee is small.

// WHY THE PROVIDER GETS ITS OWN ORDER ID.
// Midtrans accepts only a short alphabet in an order id and refuses the whole transaction on any other character, while the invoice id a person reads carries spaces.
// So the provider id is derived from the invoice id, the amount and the currency: stable for an unchanged invoice, changed when the amount changes, and always legal.

// WHY A RETRY HAS ITS OWN ORDER ID.
// A link runs out or a customer asks for a new one, and the provider refuses a second charge under an order id it already knows.
// So from the second attempt the number is part of the hash input, while the first attempt keeps the id it has always had because an invoice that never retried must not change the id under a link already in a customer's hands.

// WHY THE PROVIDER AMOUNT IS NOT THE LEDGER AMOUNT.
// The ledger stores cents because a price can have a fractional unit, and Midtrans charges whole rupiah because the rupiah has no subunit in a card transaction.
// Sending the cents figure would ask the customer for a hundred times the money, so the conversion happens at the provider boundary in both directions: out to the charge, and back from the notification before it is compared.

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

export function providerOrderId(invoiceId, amountCents, currency = 'IDR', attempt = 1) {
  const counted = Math.trunc(Number(attempt));
  const number = Number.isFinite(counted) && counted > 1 ? counted : 1;
  const retry = number > 1 ? `\u0000${number}` : '';
  const stamp = createHash('sha256')
    .update(`${invoiceId}\u0000${Number(amountCents) || 0}\u0000${currency || 'IDR'}${retry}`)
    .digest('hex')
    .slice(0, 10);
  const readable = String(invoiceId || '')
    .replace(/[^A-Za-z0-9._~-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 36);
  return `oa-${stamp}-${readable}`.slice(0, 50);
}

// WHY THE LINK'S LIFE IS ONE CONSTANT AND NOT A NUMBER IN TWO PLACES.
// The provider is asked for the same window the page promises, and two numbers would drift apart, so the page would either promise time it does not have or hide a link that still works.
// Midtrans accepts minutes through seven days, and the deadline is computed from this constant because the charge answer carries no expiry field and the clock starts when the charge is created.

export const PAY_LINK_EXPIRY = Object.freeze({ unit: 'hour', duration: 24 });

const EXPIRY_MS = Object.freeze({ second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 });

export function payLinkDeadline(now = Date.now()) {
  const start = Number(now);
  const step = EXPIRY_MS[PAY_LINK_EXPIRY.unit] || EXPIRY_MS.hour;
  return new Date((Number.isFinite(start) ? start : Date.now()) + step * PAY_LINK_EXPIRY.duration).toISOString();
}

// WHY ONE RULE DECIDES WHAT A LINK IS.
// The page, the create path and the refresh action answer the same question about the same row, and three answers would disagree the day one of them moved.
// A deadline that cannot be parsed is "unknown" rather than "expired": an honest page shows the link and says it does not know when it stops working.

export function payLinkState(invoice, now = Date.now()) {
  if (!invoice || !invoice.pay_url) return 'none';
  const deadline = Date.parse(String(invoice.pay_url_expires_at || ''));
  if (!Number.isFinite(deadline)) return 'unknown';
  const at = Number(now);
  const moment = Number.isFinite(at) ? at : Date.now();
  return deadline > moment ? 'live' : 'expired';
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
// The one step nobody had driven was the request itself, because it was a fetch inside a Deno handler and no test could reach it.
// Building it here means the legal order id, the whole rupiah, the QRIS-only list and the Basic header are checkable against a provider stood up in a test, and only the network call stays in the function.

// WHY THE ENVIRONMENT IS NAMED AND NOT GUESSED FROM THE KEY.
// Midtrans serves sandbox and production on different hosts and each refuses the other's key, so a host inferred from the key's prefix breaks silently the day the provider changes that format.
// The environment is stated, and the refusal log names the host that was used so a mismatch is visible rather than silent.

export const SNAP_ENVIRONMENTS = Object.freeze({
  production: 'https://app.midtrans.com/snap/v1/transactions',
  sandbox: 'https://app.sandbox.midtrans.com/snap/v1/transactions'
});

export function snapUrlFor(environment) {
  return SNAP_ENVIRONMENTS[String(environment || 'production')] || SNAP_ENVIRONMENTS.production;
}

// WHY THE EXPIRY IS PASSED IN AND NOT INVENTED HERE.
// The page prints the moment the link stops working and the provider has to stop it there, so the caller passes the one expiry the stored deadline is computed from.

export function snapChargeRequest({ orderId, amountCents, currency = 'IDR', customerId = '', enabled = null, serverKey = '', environment = 'production', expiry = null }) {
  const gross = providerAmount(amountCents, currency);
  if (gross === null) return null;
  const request = {
    transaction_details: { order_id: String(orderId), gross_amount: gross },
    customer_details: { first_name: String(customerId || '').slice(0, 50) }
  };
  if (enabled) request.enabled_payments = enabled;
  if (expiry) request.expiry = expiry;
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
// Measured live on 2026-10-26: real notifications arrived from the provider's own user agent, carried signature_key and the right amount, and every one was refused, with nothing in the body able to say which of two causes it was.
// The provider records the transaction and will say what happened to it over the same key, so the answer to a refusal is a question, not a rejection.
// A forged body cannot pass: the provider answers about its own transaction, never about the claim in the request.

export const SNAP_STATUS = Object.freeze({
  production: 'https://api.midtrans.com/v2',
  sandbox: 'https://api.sandbox.midtrans.com/v2'
});

export function snapStatusUrl(environment, orderId) {
  const base = SNAP_STATUS[String(environment || 'production')] || SNAP_STATUS.production;
  return `${base}/${encodeURIComponent(String(orderId || ''))}/status`;
}

export function snapExpireUrl(environment, orderId) {
  const base = SNAP_STATUS[String(environment || 'production')] || SNAP_STATUS.production;
  return `${base}/${encodeURIComponent(String(orderId || ''))}/expire`;
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

// WHY A 404 HIDES INSIDE A 200.
// Midtrans documents this endpoint as answering 200 with a body whose status_code is 404, so the HTTP status cannot say whether the transaction exists.
// Measured live on 2026-10-26: a live Snap transaction answered exactly that through the status endpoint while its payment page still showed a pending QRIS.
// A missing transaction is nothing to close, because a charge with this key cannot open a payable link for an order the provider does not know.

export function providerSaysMissing(payload) {
  return Boolean(payload && typeof payload === 'object' && String(payload.status_code || '') === '404');
}

// WHY A RETRY ASKS THE PROVIDER TO EXPIRE THE OLD ATTEMPT.
// A customer who asks for a second link has said the first is not the one they will pay, and two payable transactions for one invoice is how somebody pays twice.
// The provider accepts an expire call while the transaction is pending and answers with its own status, so the answer says whether the first attempt is dead.

export function snapExpireRequest({ orderId, serverKey = '', environment = 'production' }) {
  if (!orderId) return null;
  return {
    url: snapExpireUrl(environment, orderId),
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${serverKey}:`)}`,
      Accept: 'application/json'
    }
  };
}

// WHY THE SETTLEMENT ANSWER CARRIES HOW THE MONEY CAME.
// Paid is the fact the invoice needs and the least an operator can be told, because a QRIS settlement, a card capture and a transfer are different evidence.
// The provider names the method and the transaction in every answer, and an absent field is an empty string so a caller never has to tell missing from not read.

export function providerSettlement(payload) {
  if (!payload || typeof payload !== 'object') return { settled: false, status: '', grossAmount: '', paymentType: '', transactionId: '' };
  const status = String(payload.transaction_status || '');
  const fraud = String(payload.fraud_status === undefined ? 'accept' : payload.fraud_status);
  const settled = status === 'settlement' || (status === 'capture' && (fraud === 'accept' || fraud === ''));
  return {
    settled,
    status,
    grossAmount: String(payload.gross_amount === undefined ? '' : payload.gross_amount),
    paymentType: String(payload.payment_type === undefined ? '' : payload.payment_type),
    transactionId: String(payload.transaction_id === undefined ? '' : payload.transaction_id)
  };
}

// WHY THE REDIRECT IS READ BY ONE RULE.
// The provider answers with a redirect_url and a token, and either one missing means the charge was not opened even though the HTTP status said otherwise.

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
// So a transfer follows the same rules the provider does: only an open invoice, only the amount it says, and a note naming who confirmed it.

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
// The clients the plan includes are not lines at all, and only those above the cap are, so the invoice never says two numbers for one agreement.

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
// Measured live: a sandbox payment settled, Midtrans said PAID, and the invoice stayed open, because the signature arrived in a field this code did not read and was compared against nothing.
// The alias is accepted because the value still has to match the signature; the field name is not the secret.

// WHY THE SHAPE OF A STORED SECRET IS MEASURED AND ITS VALUE IS NOT.
// A paste artifact is invisible, while a length that is one too long or a character outside the alphabet says what no amount of staring at a masked field can.
// The shape is a count and a boolean, so it can be written to a log without putting any part of the key there.

export function secretShape(secret) {
  const raw = secret === undefined || secret === null ? '' : String(secret);
  const outside = raw.replace(/[A-Za-z0-9_-]/g, '').length;
  const prefix = ['SB-Mid-server-', 'Mid-server-'].find((known) => raw.startsWith(known)) || 'not a provider key';
  return `${raw.length} chars, prefix ${prefix}, ${outside} outside the key alphabet`;
}

// WHY THE SIGNATURE IS A HASH AND NOT AN HMAC.
// Measured live on 2026-10-26: four sandbox payments settled and every notification was refused, while the same key opened the charge and answered the status question, so a wrong key could not be the cause.
// Midtrans documents the key as appended to the string and hashed in one pass, and the test agreed with the code because it was written from the same belief.

export function providerSignature(notification, serverKey) {
  if (!notification || !serverKey) return '';
  const orderId = String(notification.order_id || '');
  const statusCode = String(notification.status_code || '');
  const grossAmount = String(notification.gross_amount || '');
  if (!orderId || !statusCode || !grossAmount) return '';
  return createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest('hex');
}

export function notificationSignatureValid(notification, serverKey) {
  if (!notification || !serverKey) return false;
  const given = notification.signature_key ?? notification.signature;
  if (!given) return false;
  return sameText(providerSignature(notification, serverKey), String(given));
}

// WHY THE ANSWER TO A NOTIFICATION IS NOT THE PAYMENT RESULT.
// The provider reads a non-2xx answer as not delivered and sends the same body again, so the status code answers only whether this endpoint received and understood it.
// Measured live: a correctly signed still-pending answered 400 and the provider's history showed it as undelivered beside a real rejection, which buried the rejection.

// WHY A CLOSED INVOICE IS NOT CLOSED AGAIN.
// The provider repeats itself, so the same settlement arrives more than once and a late notification can follow the one that closed the invoice.

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
