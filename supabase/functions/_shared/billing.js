// @last-edited: 2026-10-21 UTC+7.
// @title: billing — what a delivery is worth, and how an invoice proves it.
// @state: the price of a unit, the amount of an invoice, and the two signatures that make a payment claim true.
// @dependencies: node:crypto.

// WHY THE MONEY IS DATA AND NOT CODE. The unit that is sold is the delivered
// client-month, and its price changes between a pilot, a market and a country. So the
// price lives in a table, and this module only knows how to read it: one rule that
// turns a list of deliveries into an amount, and two rules that decide whether a
// payment claim is worth believing.
//
// WHY THE AMOUNT IS COMPUTED FROM THE DELIVERIES, NOT STORED. An invoice that says
// "Rp 25.000" and lists nothing cannot be checked by the person paying it. An
// invoice that carries the deliveries it charges for can be checked line by line, and
// a delivery that was not made is not charged: the rule is that only what the proof
// says was delivered is priced.
//
// WHY A LINE WITH NO PRICE IS NOT CHARGED AND NOT HIDDEN. A delivery of a kind that
// has no price yet is real work, and silently dropping it would be a lie; pricing it
// at zero would be a discount nobody agreed to. So it comes back as an unpriced
// line, and the invoice says so.
//
// WHY THE TOKEN IS AN HMAC AND NOT A RANDOM STRING. A random token has to be looked
// up, which means the server has to trust its own storage. An HMAC over the invoice
// id carries the same authority in the link itself: the server can tell a token it
// made from a token somebody guessed, without a lookup.
//
// WHY THE NOTIFICATION SIGNATURE IS OVER THE ORDER, NOT THE WHOLE BODY. The provider
// computes a signature over the order id, the status code and the gross amount with
// the server key. Checking exactly those three fields means a tampered body cannot
// pass, and a different amount cannot pass.
//
// WHY ONLY A SETTLED STATUS COUNTS AS PAID. A provider sends many notifications for
// one order, and most of them are not the payment. Only the settled one means the
// money moved, and the invoice is marked paid from that one.

import { createHmac, timingSafeEqual } from 'node:crypto';

function hmacSha512(secret, payload) {
  return createHmac('sha512', secret).update(payload).digest('hex');
}

export function invoiceToken(invoiceId, secret) {
  return hmacSha512(secret, `invoice:${invoiceId}`).slice(0, 32);
}

export function verifyInvoiceToken(invoiceId, token, secret) {
  if (!invoiceId || !token || !secret) return false;
  const expected = invoiceToken(invoiceId, secret);
  if (expected.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
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

export function notificationSignatureValid(notification, serverKey) {
  if (!notification || !serverKey) return false;
  const orderId = String(notification.order_id || '');
  const statusCode = String(notification.status_code || '');
  const grossAmount = String(notification.gross_amount || '');
  if (!orderId || !statusCode || !grossAmount) return false;
  const expected = hmacSha512(serverKey, `${orderId}${statusCode}${grossAmount}`);
  const given = String(notification.signature || '');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export function isSettled(notification) {
  const status = String(notification?.transaction_status || notification?.status || '').toLowerCase();
  return status === 'settled' || status === 'capture' || status === 'paid' || status === 'success';
}
