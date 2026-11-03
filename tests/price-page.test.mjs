// @last-edited: 2026-11-03 UTC+7.
// @title: price-page — the page a buyer reads, and the order it is allowed to place.
// @state: the plans and the overage from the rows, the form and its absent script, the Jakarta month, and every refusal.
// @dependencies: node:test, node:assert/strict, ../supabase/functions/_shared/price-page.js.

// WHY THIS MODULE IS TESTED AND THE FUNCTION IS NOT.
// The page is a pure function of the price list, so every branch a buyer can reach is reachable here.
// The function around it is measured live in Task 6; the rules that decide what an order is are proved here, where a test can read them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { currentPeriod, priceOrder, pricePage } from '../supabase/functions/_shared/price-page.js';

const PRICES = [
  { kind: 'statement.client_month', unit: 'delivered client-month above the plan', amount_cents: 1000000, currency: 'IDR', active: true },
  { kind: 'plan.firm', unit: 'firm-month, up to 50 client-months', amount_cents: 24900000, currency: 'IDR', active: true },
  { kind: 'plan.pilot', unit: 'firm-month, up to 15 client-months', amount_cents: 9900000, currency: 'IDR', active: true }
];

const NOW = Date.parse('2026-11-03T10:00:00+07:00');

test('the page shows both plans and the overage from the rows it was given', () => {
  const html = pricePage(PRICES, { now: NOW });
  assert.match(html, /Rp 99\.000/);
  assert.match(html, /Rp 249\.000/);
  assert.match(html, /Rp 10\.000/);
  assert.match(html, /hingga 15 client-month/);
  assert.match(html, /hingga 50 client-month/);
  assert.match(html, /bulan 2026-11/);
});

test('the page has one form that posts to itself and no script', () => {
  const html = pricePage(PRICES, { now: NOW });
  assert.match(html, /<form method="post" action="\/harga">/);
  assert.match(html, /name="action" value="price-order"/);
  assert.match(html, /name="firm"/);
  assert.match(html, /name="contact"/);
  assert.match(html, /name="kind"/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /token=/);
});

test('a plan the rows do not carry is not for sale', () => {
  const inactive = PRICES.map((row) => row.kind === 'plan.firm' ? { ...row, active: false } : row);
  const html = pricePage(inactive, { now: NOW });
  assert.doesNotMatch(html, /Rp 249\.000/);
  assert.doesNotMatch(html, /value="plan\.firm"/);
  assert.equal(priceOrder({ firm: 'Firma Uji', contact: '081234567890', kind: 'plan.firm' }, inactive, NOW).ok, false);
});

test('no row means nothing to buy, and the page says so', () => {
  const html = pricePage([], { now: NOW });
  assert.match(html, /Belum ada plan yang dijual\./);
  assert.doesNotMatch(html, /Rp \d/);
  assert.doesNotMatch(html, /<form/);
});

test('the Jakarta month is the month the invoice is for', () => {
  assert.equal(currentPeriod(Date.parse('2026-10-31T17:30:00Z')), '2026-11');
  assert.equal(currentPeriod(Date.parse('2026-10-31T16:30:00Z')), '2026-10');
  assert.equal(currentPeriod(Date.parse('2026-01-31T17:00:00Z')), '2026-02');
});

test('a valid order names the firm, the plan and the month', () => {
  const order = priceOrder({ firm: '  Firma Uji  ', contact: '081234567890', kind: 'plan.pilot' }, PRICES, NOW);
  assert.deepEqual(order, {
    ok: true,
    customerId: 'Firma Uji',
    contact: '081234567890',
    period: '2026-11',
    kind: 'plan.pilot',
    amountCents: 9900000,
    currency: 'IDR',
    lines: [{ kind: 'plan.pilot', quantity: 1, amountCents: 9900000, description: 'Pilot — 2026-11' }]
  });
});

test('the price comes from the row, never from the body', () => {
  const order = priceOrder({ firm: 'Firma Uji', contact: '081234567890', kind: 'plan.pilot', amountCents: 1 }, PRICES, NOW);
  assert.equal(order.ok, true);
  assert.equal(order.amountCents, 9900000);
});

test('a contact is an Indonesian mobile number or an email', () => {
  for (const contact of ['081234567890', '+6281234567890', '6281234567890', 'nama@firma.co.id']) {
    assert.equal(priceOrder({ firm: 'Firma Uji', contact, kind: 'plan.pilot' }, PRICES, NOW).ok, true, contact);
  }
  for (const contact of ['12345', '+15551234567', 'nama@firma', 'nama firma@contoh.co', '']) {
    assert.equal(priceOrder({ firm: 'Firma Uji', contact, kind: 'plan.pilot' }, PRICES, NOW).ok, false, contact);
  }
});

test('a firm name is two to eighty characters after the spaces are trimmed', () => {
  assert.equal(priceOrder({ firm: ' A ', contact: '081234567890', kind: 'plan.pilot' }, PRICES, NOW).ok, false);
  assert.equal(priceOrder({ firm: ` ${'A'.repeat(80)} `, contact: '081234567890', kind: 'plan.pilot' }, PRICES, NOW).ok, true);
  assert.equal(priceOrder({ firm: 'A'.repeat(81), contact: '081234567890', kind: 'plan.pilot' }, PRICES, NOW).ok, false);
});

test('a plan outside the two sold plans is refused', () => {
  for (const kind of ['statement.client_month', 'plan.free', '']) {
    const order = priceOrder({ firm: 'Firma Uji', contact: '081234567890', kind }, PRICES, NOW);
    assert.equal(order.ok, false, kind);
    assert.equal(order.error, 'plan tidak dijual');
  }
});

test('the error line keeps the typed values and escapes them', () => {
  const html = pricePage(PRICES, {
    error: 'nama <firma> salah',
    values: { firm: 'A & B <script>alert(1)</script>', contact: '"0812"', kind: 'plan.firm' },
    now: NOW
  });
  assert.match(html, /nama &lt;firma&gt; salah/);
  assert.match(html, /A &amp; B &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;0812&quot;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /value="plan\.firm" selected/);
});

test('the same firm and month is the same invoice', () => {
  const first = priceOrder({ firm: 'Firma Uji', contact: '081234567890', kind: 'plan.pilot' }, PRICES, NOW);
  const second = priceOrder({ firm: 'Firma Uji', contact: '081234567890', kind: 'plan.pilot' }, PRICES, NOW);
  assert.equal(`${first.customerId}:${first.period}`, `${second.customerId}:${second.period}`);
});
