// @last-edited: 2026-10-26 UTC+7.
// @title: invoice-page — every state a customer can open, as one readable and honest page.
// @state: paid, live, expired, unknown, no link and cancelled, each said in words, escaped, and carrying the token only where a form needs it.
// @dependencies: node:test, strict, ../supabase/functions/_shared/invoice-page.js.

// WHY THE PAGE IS DRIVEN BY A TEST RATHER THAN LOOKED AT ONCE.
// The page is the only part of the money path a customer sees, and a state that renders nothing, a dead Pay button or an unescaped name is a failure nobody notices until it is in someone's inbox.
// So each state is rendered here and read for the things the page promises: what happened, what the customer can do, and what the page refuses to carry.

import test from 'node:test';
import assert from 'node:assert/strict';

import { invoicePage } from '../supabase/functions/_shared/invoice-page.js';

const NOW = Date.parse('2026-10-26T09:00:00Z');
const TOKEN = 'tok-1234';
const PAY_URL = 'https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-1';

const INVOICE = {
  id: 'Toko Sinar Jaya:2026-10',
  customer_id: 'Toko Sinar Jaya',
  period: '2026-10',
  status: 'open',
  amount_cents: 9900000,
  currency: 'IDR',
  lines: {
    priced: [
      { kind: 'plan.pilot', unit: 'firm-month, up to 15 clients', description: 'Pilot — up to 15 client-months, 2026-10', quantity: 1, amountCents: 9900000 }
    ],
    unpriced: [
      { kind: 'slides.deck', description: 'Slides — 2026-10', reason: 'no price for this kind' }
    ]
  }
};

const withLink = (deadline) => ({ ...INVOICE, pay_url: PAY_URL, pay_url_expires_at: deadline });

const PAID = {
  ...withLink('2026-10-27T09:00:00.000Z'),
  status: 'paid',
  paid_at: '2026-10-26T08:55:13Z',
  paid_method: 'qris',
  provider_transaction_id: 'b1e3-4c'
};

const LIVE = withLink('2026-10-27T09:00:00.000Z');
const EXPIRED = withLink('2026-10-25T09:00:00.000Z');
const UNKNOWN = withLink(undefined);
const CANCELLED = { ...withLink('2026-10-27T09:00:00.000Z'), status: 'void' };

const render = (invoice, options = {}) => invoicePage(invoice, { token: TOKEN, now: NOW, ...options });

test('every state is one readable page with no script and no asset to load', () => {
  for (const html of [PAID, LIVE, EXPIRED, UNKNOWN, INVOICE, CANCELLED].map((invoice) => render(invoice))) {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
    assert.match(html, /<style>/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<link\b/i);
    assert.doesNotMatch(html, /<img\b/i);
    assert.doesNotMatch(html, /\bsrc=/i);
    assert.doesNotMatch(html, /@import/i);
    assert.match(html, /Status:/);
    assert.match(html, /Pilot — up to 15 client-months, 2026-10/);
    assert.match(html, /<td>1<\/td>/);
    assert.match(html, /Rp 99\.000/);
    assert.match(html, /no price for this kind/, 'an unpriced delivery is named, not hidden');
    assert.match(html, /Only what was delivered is charged\. A delivery that failed is not on this invoice\./);
  }
});

test('a paid invoice says when and how the money came, and offers no way to pay again', () => {
  const html = render(PAID);
  assert.match(html, /Status: Paid/);
  assert.match(html, /Paid on 26 Oct 2026, 15:55 UTC\+7 with QRIS\./);
  assert.match(html, /Provider transaction b1e3-4c/);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /app\.sandbox\.midtrans\.com/);
  assert.doesNotMatch(html, /Get a new payment link/);
  assert.ok(!html.includes(TOKEN), 'a paid page has no form, so it has no reason to carry the token');
});

test('a method the page knows is said in words, and one it does not is still shown', () => {
  assert.match(render({ ...PAID, paid_method: 'bank_transfer' }), /with bank transfer/);
  assert.match(render({ ...PAID, paid_method: 'akulaku' }), /with Akulaku/);
  assert.match(render({ ...PAID, paid_method: 'some_wallet' }), /with some wallet/, 'the provider vocabulary is opened, not hidden');
  assert.doesNotMatch(render({ ...PAID, paid_method: null }), / with \./, 'a method nobody recorded is not printed as blank');
});

test('a live link is a Pay button and the deadline the provider was given', () => {
  const html = render(LIVE);
  assert.match(html, new RegExp(`href="${PAY_URL}"`));
  assert.match(html, /Pay Rp 99\.000/);
  assert.match(html, /This payment link is valid until 27 Oct 2026, 16:00 UTC\+7\./);
  assert.doesNotMatch(html, /2026-10-27T09:00:00\.000Z/, 'the deadline is a date a person can read, not a raw ISO string');
  assert.doesNotMatch(html, /<form/i, 'a live link needs no refresh');
});

test('an expired link says so, renders no dead Pay button and offers the refresh form', () => {
  const html = render(EXPIRED, { canRefresh: true });
  assert.match(html, /This payment link expired on 25 Oct 2026, 16:00 UTC\+7\. It can no longer be used\./);
  assert.doesNotMatch(html, /app\.sandbox\.midtrans\.com/);
  assert.doesNotMatch(html, /Pay Rp/);
  assert.match(html, /<form method="post">/);
  assert.match(html, /name="action" value="refresh-payment"/);
  assert.match(html, /Get a new payment link/);
  const noKey = render(EXPIRED, { canRefresh: false, bank: 'BCA 123-456 a/n Firma Contoh' });
  assert.match(noKey, /Transfer Rp 99\.000 and quote invoice Toko Sinar Jaya:2026-10\./, 'without a provider the bank line is the only way left');
  assert.match(noKey, /BCA 123-456/);
  assert.doesNotMatch(noKey, /<form/i);
});

test('a link with no known deadline is still shown, and the page says what it does not know', () => {
  const html = render(UNKNOWN, { canRefresh: true });
  assert.match(html, new RegExp(`href="${PAY_URL}"`));
  assert.match(html, /This payment link is open\. Its deadline is unknown\./);
  assert.match(html, /<form method="post">/);
});

test('no link means a transfer instruction, the bank line when there is one, and a way to ask again', () => {
  const html = render(INVOICE, { canRefresh: true, bank: 'BCA 123-456 a/n Firma Contoh' });
  assert.match(html, /Transfer Rp 99\.000 and quote invoice Toko Sinar Jaya:2026-10\./);
  assert.match(html, /BCA 123-456 a\/n Firma Contoh/);
  assert.match(html, /<form method="post">/);
  const noKey = render(INVOICE, { canRefresh: false });
  assert.doesNotMatch(noKey, /<form/i, 'a form that cannot open a link is a dead end, not an offer');
  assert.doesNotMatch(noKey, /BCA 123-456/, 'a bank line that was not configured is not printed');
});

test('a cancelled invoice says so and offers neither payment nor a new link', () => {
  const html = render(CANCELLED, { canRefresh: true });
  assert.match(html, /Status: Cancelled/);
  assert.match(html, /This invoice is cancelled/);
  assert.doesNotMatch(html, /app\.sandbox\.midtrans\.com/);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /Get a new payment link/);
  assert.ok(!html.includes(TOKEN));
});

test('the token is a capability and appears only in the form field that carries it', () => {
  const html = render(EXPIRED, { canRefresh: true });
  assert.equal(html.split(TOKEN).length - 1, 1, 'one copy of the token, in the hidden field');
  assert.match(html, /<input type="hidden" name="token" value="tok-1234">/);
  assert.match(html, /<input type="hidden" name="invoice_id" value="Toko Sinar Jaya:2026-10">/);
});

test('a customer name and a line description cannot become markup', () => {
  const hostile = {
    ...INVOICE,
    customer_id: 'Toko <script>alert(1)</script> & Sons',
    lines: {
      priced: [{ kind: 'x', description: 'Makan <b>"siang"</b>', quantity: 1, amountCents: 100 }],
      unpriced: [{ kind: 'y', description: '<img src=x onerror=1>', reason: 'no price for this kind' }]
    }
  };
  const html = render(hostile);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<b>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Sons/);
  assert.match(html, /&lt;b&gt;&quot;siang&quot;&lt;\/b&gt;/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/, 'the reason is escaped as text, not carried as an attribute');
});

test('a refresh that failed is one honest line above the form, with no provider words', () => {
  const html = render(EXPIRED, { canRefresh: true, refreshFailed: true });
  assert.match(html, /The new payment link could not be opened just now\. Please try again\./);
  assert.equal(html.split('could not be opened just now').length - 1, 1);
  assert.doesNotMatch(html, /the previous payment link could not be closed/, 'the reason is for the log, not for the customer');
  const clean = render(EXPIRED, { canRefresh: true });
  assert.doesNotMatch(clean, /could not be opened just now/);
});
