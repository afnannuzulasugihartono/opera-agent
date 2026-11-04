// @last-edited: 2026-11-04 UTC+7.
// @title: qris-wiring — the dynamic QRIS rail is env-gated, and the static payload never sits in the tree.
// @state: the function reads the rail from env, derives the payload at render time, and the qris-self branch writes a local order id instead of a provider link.
// @dependencies: node:test, node:assert/strict, node:fs.

// WHY THE WIRING IS PINNED AS TEXT.
// The rail choice is a deploy decision, and a refactor that hardcodes midtrans would silently send every rupiah invoice back to Snap - the exact regression the owner reported.
// The payload secret must not appear in the tree, so the grep below is the guard, not a review habit.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const fn = fs.readFileSync(new URL('supabase/functions/opera-agent-billing/index.ts', root), 'utf8');
const page = fs.readFileSync(new URL('supabase/functions/_shared/invoice-page.js', root), 'utf8');
const tree = fs.readdirSync(new URL('supabase/functions', root), { recursive: true })
  .filter((name) => typeof name === 'string' && /\.(ts|js|json)$/.test(name))
  .map((name) => fs.readFileSync(new URL(`supabase/functions/${name}`, root), 'utf8'));

test('the rail comes from env and defaults to midtrans', () => {
  assert.match(fn, /BILLING_RAIL.*\|\| "midtrans"/, 'an unset BILLING_RAIL must behave exactly as before');
  assert.match(fn, /BILLING_RAIL !== "qris-self"/, 'the QR is only derived when the rail says qris-self');
});

test('the merchant payload is read from env, never written in the tree', () => {
  assert.match(fn, /QRIS_STATIC_PAYLOAD/, 'the static payload is an env read');
  for (const source of tree) {
    assert.doesNotMatch(source, /00020101021126/, 'no QRIS payload string is committed');
  }
});

test('the qris-self rail writes a local order id and no pay url', () => {
  assert.match(fn, /rail === "qris-self"/, 'createInvoice must branch on the rail');
  assert.match(fn, /provider: "qris-self"/, 'the invoice names its rail');
  assert.match(fn, /qris-\$\{id\}-1/, 'the order id is derived from the invoice, so a repeat create is idempotent');
  assert.match(fn, /openTopUp[\s\S]*?rail: BILLING_RAIL/, 'the wallet top-up follows the same rail');
});

test('the invoice page renders the QR only for an open invoice and only when given the svg', () => {
  assert.match(page, /qrisBlockFor/, 'the page decides, not just the caller');
  assert.match(page, /status.*!== 'open'/, 'a paid invoice never carries a scannable code');
  assert.match(page, /the amount is already locked in the code/, 'the page says why the code is safe to scan');
});
