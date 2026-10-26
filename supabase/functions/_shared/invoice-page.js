// @last-edited: 2026-10-26 UTC+7.
// @title: invoice-page — the page a customer opens, rendered from one invoice row and nothing else.
// @state: every state an invoice or a payment link can be in, said in words, with no script and no asset to load.
// @dependencies: ./billing.js.

// WHY THE PAGE IS A MODULE AND NOT A STRING INSIDE THE FUNCTION.
// The page is what a customer sees when they owe money, and the function that serves it runs where no test can call it.
// So the page is a plain function of the row, readable and drivable from Node, and the function only chooses the headers around it.
// It uses no Deno API, no template file the deploy has to carry, and no clock of its own.

// WHY EVERY STATE IS SAID IN WORDS.
// A colour, a disabled control or a missing button is not an answer to "can I pay this?".
// So the page names the state - paid, cancelled, open - and then says what the customer can do about it, including that a link has expired or that nobody knows when it stops working.
// A dead Pay button is never rendered, because it invites a tap that cannot work.

// WHY THE TOKEN APPEARS IN ONE HIDDEN FIELD AND NOWHERE ELSE.
// The token is the authority to open this invoice, so a copy in a heading or a second link is the capability written where a shoulder or a screenshot can read it.
// The only thing that needs it again is the refresh form, so that hidden field is the only place the page carries it.

// WHY THE TIMES ARE PRINTED IN UTC.
// The stored moment is a moment in UTC and the customer's clock is not ours to guess, so the page states the zone rather than printing a number that means nothing without one.
// The format is spelled out instead of taken from a locale, so the same row renders the same text wherever the function runs.

import { payLinkState } from './billing.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const money = (cents, currency) => {
  const value = (Number(cents) || 0) / 100;
  return currency === 'IDR'
    ? `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
    : `${currency} ${value.toFixed(2)}`;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const moment = (value) => {
  if (!value) return '';
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
};

// WHY THE METHOD IS TRANSLATED AND NOT PRINTED RAW.
// "qris" is a token from the provider's payload; "QRIS" is a word a person recognises, and an operator reading the invoice should not have to know the provider's vocabulary.
// A method this page does not know is still shown, with its underscores opened into spaces, because hiding it would make the page quieter than the ledger.

const METHOD_WORDS = Object.freeze({
  qris: 'QRIS',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  dana: 'DANA',
  ovo: 'OVO',
  bank_transfer: 'bank transfer',
  credit_card: 'card',
  echannel: 'Mandiri bill',
  cstore: 'a convenience store',
  akulaku: 'Akulaku'
});

const methodWords = (method) => {
  const key = String(method || '').trim().toLowerCase();
  if (!key) return '';
  return METHOD_WORDS[key] || key.replace(/[_-]+/g, ' ');
};

const STATUS_WORDS = Object.freeze({ open: 'Open, awaiting payment', paid: 'Paid', void: 'Cancelled' });

const statusWords = (status) => STATUS_WORDS[String(status || '').toLowerCase()] || String(status || 'Unknown');

function refreshForm(invoice, token, failed) {
  const notice = failed
    ? '<p class="notice" role="status">The new payment link could not be opened just now. Please try again.</p>'
    : '';
  return `${notice}<form method="post">
<input type="hidden" name="action" value="refresh-payment">
<input type="hidden" name="invoice_id" value="${escapeHtml(invoice.id)}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit">Get a new payment link</button>
</form>`;
}

function paidBlock(invoice) {
  const at = moment(invoice.paid_at);
  const method = methodWords(invoice.paid_method);
  const transaction = String(invoice.provider_transaction_id || '').trim();
  const manual = invoice.lines?.manual;
  const how = at
    ? `<p>Paid on ${escapeHtml(at)}${method ? ` with ${escapeHtml(method)}` : ''}.</p>`
    : '<p>The payment has been recorded.</p>';
  return `<p class="paid">Paid — thank you.</p>${how}${transaction ? `<p><small>Provider transaction ${escapeHtml(transaction)}</small></p>` : ''}${manual ? `<p><small>Recorded by hand: ${escapeHtml(manual.note)} (${escapeHtml(moment(manual.at) || manual.at)})</small></p>` : ''}`;
}

// WHY THE PAYMENT BLOCK IS ONE FUNCTION OF THE STATE.
// Every state shows a different sentence and a different set of controls, and a page that chose them in two places would sooner or later show a Pay button under "cancelled".
// The state comes from payLinkState, the one rule the create path also uses, so the page and the writer cannot disagree about a link that has died.

function paymentBlock(invoice, { token, bank, canRefresh, now, refreshFailed }) {
  const total = escapeHtml(money(invoice.amount_cents, invoice.currency));
  const status = String(invoice.status || '').toLowerCase();
  if (status === 'paid') return paidBlock(invoice);
  if (status === 'void') return '<p class="state">This invoice is cancelled. Nothing is owed and no payment is due.</p>';
  const state = payLinkState(invoice, now);
  if (state === 'live') {
    return `<p><a class="pay" href="${escapeHtml(invoice.pay_url)}">Pay ${total}</a></p>
<p class="state">This payment link is valid until ${escapeHtml(moment(invoice.pay_url_expires_at))}.</p>`;
  }
  if (state === 'expired') {
    const form = canRefresh ? refreshForm(invoice, token, refreshFailed) : '';
    return `<p class="state">This payment link expired on ${escapeHtml(moment(invoice.pay_url_expires_at))}. It can no longer be used.</p>${form}`;
  }
  if (state === 'unknown') {
    const form = canRefresh ? refreshForm(invoice, token, refreshFailed) : '';
    return `<p><a class="pay" href="${escapeHtml(invoice.pay_url)}">Pay ${total}</a></p>
<p class="state">This payment link is open. Its deadline is unknown.</p>${form}`;
  }
  const bankLine = bank ? `<p><small>${escapeHtml(bank)}</small></p>` : '';
  const form = canRefresh ? refreshForm(invoice, token, refreshFailed) : '';
  return `<p>Transfer ${total} and quote invoice ${escapeHtml(invoice.id)}.</p>${bankLine}${form}`;
}

function lineRows(invoice) {
  const priced = (invoice.lines?.priced || []).map((line) => `<tr><td>${escapeHtml(line.description || line.unit || line.kind)}</td><td>${escapeHtml(line.quantity)}</td><td class="amount">${escapeHtml(money(line.amountCents, invoice.currency))}</td></tr>`).join('');
  const unpriced = (invoice.lines?.unpriced || []).map((line) => `<tr><td>${escapeHtml(line.description || line.kind)}</td><td colspan="2">not charged: ${escapeHtml(line.reason)}</td></tr>`).join('');
  return `${priced}${unpriced}`;
}

export function invoicePage(invoice, { token, bank = '', now = Date.now(), canRefresh = false, refreshFailed = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Invoice ${escapeHtml(invoice.id)}</title>
<style>
 *{box-sizing:border-box}
 body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:44rem;margin:1.5rem auto;padding:0 1rem;color:#111;background:#fff}
 h1{font-size:1.35rem;line-height:1.25;margin:0 0 .25rem;overflow-wrap:anywhere}
 .meta{color:#444;margin:.25rem 0 1.5rem;font-size:.95rem}
 table{border-collapse:collapse;width:100%;margin:1rem 0}
 th,td{border-bottom:1px solid #ddd;padding:.6rem .4rem;text-align:left;vertical-align:top}
 th{font-size:.85rem;color:#444;font-weight:600}
 td.amount,th.amount{text-align:right;white-space:nowrap}
 .amount{font-size:1.25rem;font-weight:700}
 .state{margin:1rem 0}
 .pay{display:inline-block;background:#1d4ed8;color:#fff;padding:.85rem 1.25rem;border-radius:.4rem;text-decoration:none;font-weight:600}
 .paid{color:#0f7664;font-weight:700}
 .notice{color:#7a1d1d}
 button{font:inherit;background:#fff;color:#1d4ed8;border:1px solid #1d4ed8;padding:.8rem 1.2rem;border-radius:.4rem;font-weight:600;cursor:pointer}
 .pay:focus-visible,button:focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}
 small{color:#555}
 form{margin:1rem 0}
 @media (min-width:36rem){body{margin:3rem auto}h1{font-size:1.5rem}}
</style>
</head>
<body>
<main>
<h1>Invoice ${escapeHtml(invoice.id)}</h1>
<p class="meta">${escapeHtml(invoice.customer_id)} &middot; period ${escapeHtml(invoice.period)}<br>Status: ${escapeHtml(statusWords(invoice.status))}</p>
<table>
<tr><th>What was delivered</th><th>Qty</th><th class="amount">Amount</th></tr>
${lineRows(invoice)}
</table>
<p class="amount">Total ${escapeHtml(money(invoice.amount_cents, invoice.currency))}</p>
${paymentBlock(invoice, { token, bank, canRefresh, now, refreshFailed })}
<p><small>Only what was delivered is charged. A delivery that failed is not on this invoice.</small></p>
</main>
</body>
</html>`;
}
