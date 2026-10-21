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
// WHY THE INVOICE IS DERIVED FROM THE MANIFEST AND NOT FROM A TYPED LIST. A list typed
// by hand is a claim; the manifest is a record, and it already holds one row per
// delivered client-month with the file, the bytes and the page count. So the invoice
// takes those rows and gives each one a line, and it refuses the whole request when a
// row has no client or when one client-month appears twice: a bill that quietly drops a
// month, or charges it twice, is worse than a bill that was never sent.
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
// money moved, and the invoice is marked paid from that one. Midtrans spells that
// status "settlement", and a card payment arrives as "capture" only when the fraud
// check accepted it, so both spellings are handled and neither is guessed at.
//
// WHY THE COMPARISON DOES NOT USE Buffer. The same rules run in the edge function,
// where Node's Buffer does not exist: the first deploy built invoices fine and then
// answered "Buffer is not defined" to every customer who opened one. Comparing two
// hex strings character by character costs nothing and runs everywhere, and it still
// takes the same time whether the first character is wrong or the last one is.

import { createHmac } from 'node:crypto';

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

export function notificationSignatureValid(notification, serverKey) {
  if (!notification || !serverKey) return false;
  const orderId = String(notification.order_id || '');
  const statusCode = String(notification.status_code || '');
  const grossAmount = String(notification.gross_amount || '');
  if (!orderId || !statusCode || !grossAmount) return false;
  const expected = hmacSha512(serverKey, `${orderId}${statusCode}${grossAmount}`);
  return sameText(expected, String(notification.signature || ''));
}

export function isSettled(notification) {
  const status = String(notification?.transaction_status || notification?.status || '').toLowerCase();
  if (status === 'capture') {
    const fraud = String(notification?.fraud_status || '').toLowerCase();
    return fraud === '' || fraud === 'accept';
  }
  return status === 'settlement' || status === 'settled' || status === 'paid' || status === 'success';
}
