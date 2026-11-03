# Public Pricing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell two firm-month plans on a public `/harga` page: the buyer types a firm name and one contact, the function opens one invoice, and the buyer pays it with QRIS without an operator in the loop.

**Architecture:** One pure module (`supabase/functions/_shared/price-page.js`) renders the page and validates the order, so every rule a buyer can reach is proved in Node without a network. The billing edge function reads the live `opera_price_list`, writes one `opera_price_orders` row, and answers 303 to the invoice page. `landing/_worker.js` proxies `/harga` for GET and POST, because the shared function domain labels HTML as `text/plain`. Nothing about the Midtrans path changes, and the invoice action keeps its operator token.

**Tech Stack:** Deno edge functions (TypeScript plus plain ESM JavaScript in `_shared/`), Supabase Postgres, Cloudflare Pages worker, Node 22 ESM tests with `node:test`. No new npm dependency, no new runtime dependency of any kind.

**Spec:** `docs/superpowers/specs/2026-11-03-public-pricing-page-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- The repo keeps **zero npm dependencies** and CI runs `npm test` without `npm install`. This plan adds no package.
- Every source file carries the four header fields `@last-edited`, `@title`, `@state`, `@dependencies`. A file that changes bumps its `@last-edited` to `2026-11-03 UTC+7`.
- A comment block at column zero is a section header and gets a blank line before and after; an indented comment documents the code under it; a sentence is one line. `node scripts/format-comments.mjs --check` must pass.
- The page is server-rendered. No `<script>`, no token, no price literal in the HTML, and no fetch: the page reads the live `opera_price_list` rows or it shows nothing.
- The price comes from the row and never from the request. The browser sends `firm`, `contact` and `kind`; the function derives the amount, the month and the invoice id.
- The public order takes **no operator token**. The operator action `invoice` keeps its token and changes nothing.
- One order per `(firm, period)`; the invoice id is `${firm}:${period}`, derived before the invoice is created, so a resubmit finds the same invoice.
- 30 new orders per rolling hour, counted from `opera_price_orders.created_at`; over the limit is `429` with the page and one line of Indonesian text.
- `opera_price_orders` has RLS on and no policy. Only `service_role` reads and writes it. No IP, no user agent, no token column: the contact is the only personal data.
- The invoice page stays `noindex` and `no-referrer`. The price page carries no token, so it may be indexed.
- The migration writes its own row into `supabase_migrations.schema_migrations`, the way `supabase/migrations/20261012110000_drop_command_insert_signal.sql` does. Never `supabase db push`: the row is already there.
- Per `AGENTS.md`, migrations, edge function deploys and site deploys run one at a time from the main checkout, never from a worktree.
- No secret value is printed to a terminal, a log or a commit. `gh secret list` prints names only.
- The page copy is Indonesian, because the site is Indonesian. The page copy is a product decision, not a translation: it says what is bought, what it costs, and that a first batch we do not accept is refunded by hand.
- Gates that must be green at the end: `npm test`, `npm run check`.

## Review Focus

- **Two buyers, one firm name, one month.** The invoice id is `${firm}:${period}`, so two firms named "KantorAbadi" in November share one invoice and one QR. The page must not pretend this is two purchases, and the operator needs to see it in the handoff. Pinned by Task 2's `the same firm and month is the same invoice` and named as a limit in Task 7.
- **The month belongs to Jakarta, not to the server.** An order sent at 23:30 UTC on 31 October is a November order, because the customers and the deadline read Jakarta time. Pinned by Task 2's `the Jakarta month is the month the invoice is for`.
- **The price on the page and the price on the invoice are the same row.** A buyer who edits the body, or a page built from a stale list, must not buy a price of its own. Pinned by Task 2's `the price comes from the row, never from the body` and `a plan the rows do not carry is not for sale`.
- **A contact nobody can reach.** A landline, a typo in the domain, or an empty field must be refused before a row is written, because the operator has no other way to reach a buyer. Pinned by Task 2's `a contact is an Indonesian mobile number or an email`.
- **A double submit.** Two clicks, a retried form, a browser that posts twice: one row, one invoice, one amount. An invoice that already exists is returned as it is, so no resubmit re-prices it and no buyer is asked for a second payment for the same month. Pinned by Task 2's `the same firm and month is the same invoice` and proved live in Task 6.

---

## File Structure

- `supabase/migrations/20261103110000_opera_price_orders.sql` — the public order table: the firm, the contact, the plan, the price at that moment, the invoice id, and the ledger row the file writes for itself.
- `supabase/functions/_shared/price-page.js` — pure work only: the page renderer, the order rules, the Jakarta month. No clock, no database, no network.
- `supabase/functions/opera-agent-billing/index.ts` — gains the GET `?page=harga` branch, the public `price-order` action, the rate limit and the order write. The operator action and the Midtrans path stay as they are.
- `landing/_worker.js` — gains `/harga`: the GET is proxied with `page=harga`, the POST with its body, and the answer is relabelled as a page that may be indexed.
- `landing/*.html` (12 pages) — gain one nav link to `/harga`; the nine pages that carry a dict gain `nav.price`.
- `tests/price-page.test.mjs` — the page, the form, the month, the refusals, the escaping.
- `tests/invoice-worker.test.mjs` — the four new locks for `/harga`.
- `tests/billing.test.mjs` — one new lock for the public branch, and the operator link assertion moved to the helper that now builds it.
- `tests/landing-consent.test.mjs` — one new lock for the nav link, and the link resolver told that `/harga` is a worker path, not a file.
- `tests/hygiene.test.mjs` — one staged entry while the new module waits for the function to call it, removed in Task 3.
- `docs/product/billing.md`, `docs/product/monetization.md`, `docs/handoff.md` — the page, the order table, the rate limit, and the refund rule.

---

### Task 1: the table the public orders are written to

**Files:**
- Create: `supabase/migrations/20261103110000_opera_price_orders.sql`
- Modify: `supabase/migrations/ledger-map.json`

**Interfaces:**
- Produces:
  - `opera_price_orders` — one row per public order: `id bigserial primary key`, `firm text not null`, `period text not null`, `contact text not null`, `kind text not null`, `amount_cents integer not null`, `invoice_id text not null`, `created_at timestamptz not null default now()`.
  - `opera_price_orders_firm_period_unique` — the unique key `(firm, period)`.
  - `opera_price_orders_created_idx` — the index on `created_at desc`, used by the rate limit and by the operator.
  - RLS on, no policy, `select, insert, update` for `service_role` only.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261103110000_opera_price_orders.sql`:

```sql
-- The public price page's orders: who asked to buy which plan, for which month, and the invoice that was opened.

-- WHY THE ORDER IS A ROW OF ITS OWN.
-- The invoice says what is owed; it does not say how the buyer asked for it.
-- A buyer types a firm name and one contact before any invoice exists, and the operator needs both when the first batch is discussed.
-- So the request is written first, with the invoice id it will open, and the invoice is written on the same request.

-- WHY ONE FIRM AND ONE MONTH IS ONE ORDER.
-- A firm that submits twice in one month means one purchase, not two; a second invoice would ask for the same month twice.
-- The unique key makes the second submit return the row the first one wrote, and the invoice id it already carries.

create table if not exists opera_price_orders (
  id bigserial primary key,
  firm text not null check (char_length(firm) between 2 and 80),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  contact text not null check (char_length(contact) between 3 and 120),
  kind text not null,
  amount_cents integer not null check (amount_cents > 0),
  invoice_id text not null,
  created_at timestamptz not null default now(),
  constraint opera_price_orders_firm_period_unique unique (firm, period)
);

create index if not exists opera_price_orders_created_idx
  on opera_price_orders (created_at desc);

-- WHY THE BROWSER GETS NOTHING.
-- The contact is personal data and the amount is the operator's business.
-- The function writes with the service role, so no policy is needed and none is granted.

alter table opera_price_orders enable row level security;

revoke all on table opera_price_orders from anon, authenticated;
grant select, insert, update on table opera_price_orders to service_role;
grant usage, select on sequence opera_price_orders_id_seq to service_role;

comment on table opera_price_orders is
  'One row per public order: the firm, the contact, the plan, the price at that moment, and the invoice it opened.';

-- WHY THE FILE RECORDS ITSELF.
-- scripts/apply-migrations.mjs sends the file through the Management API as one query and writes no ledger row.
-- So the file writes the version the ledger would have held, and the map can prove it applied from the ledger rather than by guessing.

insert into supabase_migrations.schema_migrations(version, statements)
values ('20261103110000', ARRAY['opera_price_orders'])
on conflict (version) do nothing;
```

- [ ] **Step 2: Name the new file in the ledger map**

Open `supabase/migrations/ledger-map.json`. The file has not run yet, so it enters the map as `no-ledger-row`: the tree holds a file the ledger does not name.

Add this entry at the end of the `map` array:

```json
  {
   "file": "20261103110000_opera_price_orders.sql",
   "remote": null,
   "evidence": "no-ledger-row",
   "cover": null
  }
```

Then move the counts the same way the file moves them:

- `counts.no-ledger-row` goes up by one.
- `treeFiles` goes up by one.
- `resolved` stays where it is, because the entry names no version the ledger holds.
- Every other count stays where it is.

Read the numbers the map holds right now and move them from there. If the QRIS rail plan has landed, the map reads `treeFiles` `110`, `resolved` `106`, `version-and-name` `46`, `no-ledger-row` `2`, and this file takes it to `111` files, `106` resolved, `46` version-and-name, `3` no-ledger-row. If the rail plan has not landed, the map reads `108`, `104`, `44`, `2`, and this file takes it to `109` files, `104` resolved, `44` version-and-name, `3` no-ledger-row.

- [ ] **Step 3: Run the gate to verify it passes**

Run: `node --test tests/migration-ledger-map.test.mjs`
Expected: PASS, 6 tests.

Run: `node scripts/format-comments.mjs --check`
Expected: the file is canonical, and the check exits 0.

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261103110000_opera_price_orders.sql supabase/migrations/ledger-map.json
git commit -m "feat(pricing): add the table the public orders are written to"
```

- [ ] **Step 5: Apply it from the main checkout, one migration at a time**

Per `AGENTS.md`, a migration runs from the main checkout and one at a time. From `D:/GitHub/opera-agent` on `main`:

```bash
node scripts/apply-migrations.mjs supabase/migrations/20261103110000_opera_price_orders.sql
```

Expected: `applied 20261103110000_opera_price_orders.sql`.

**The file writes its own ledger row.** `scripts/apply-migrations.mjs` runs the file through the Management API and records no version of its own, so the file ends by inserting its version into `supabase_migrations.schema_migrations`. The row is written last, after every object exists, so a file that failed halfway leaves no row and can be run again. Do not push this file with `supabase db push`: the row is already there and the CLI would write the same version a second time.

Check that the objects exist, that the browser cannot read the table, and that the ledger names the file. Write the query helper once, outside the tree, and keep it there:

```powershell
@'
const query = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('SUPABASE_ACCESS_TOKEN is not set.'); process.exit(2); }
const response = await fetch(`https://api.supabase.com/v1/projects/nenmkmtvjremqphfqnfw/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
});
console.log(response.status, (await response.text()).slice(0, 4000));
'@ | Set-Content -Encoding utf8 "$env:TEMP\opera-query.mjs"
node "$env:TEMP\opera-query.mjs" "select count(*) from opera_price_orders"
node "$env:TEMP\opera-query.mjs" "select relrowsecurity from pg_class where relname = 'opera_price_orders'"
node "$env:TEMP\opera-query.mjs" "select count(*) from pg_policies where tablename = 'opera_price_orders'"
node "$env:TEMP\opera-query.mjs" "select version from supabase_migrations.schema_migrations where version = '20261103110000'"
```

Expected: `0` rows, `true` for row security, `0` policies, and one ledger row.

- [ ] **Step 6: Record the row the ledger now holds**

Open `supabase/migrations/ledger-map.json` and change the entry Step 2 added:

```json
  {
   "file": "20261103110000_opera_price_orders.sql",
   "remote": "20261103110000",
   "evidence": "version-and-name",
   "cover": null
  }
```

Then move the counts again:

- `counts.version-and-name` goes up by one.
- `counts.no-ledger-row` goes back down by one.
- `resolved` goes up by one, because the entry now names a version the ledger holds.
- `treeFiles` stays where Step 2 left it.

With the QRIS rail plan landed, the map goes from `111` files, `106` resolved, `46` version-and-name, `3` no-ledger-row to `111` files, `107` resolved, `47` version-and-name, `2` no-ledger-row. Without it, from `109`, `104`, `44`, `3` to `109`, `105`, `45`, `2`. `version-and-name` is the house class for a ledger row that carries the file's version, as `20261012110000_drop_command_insert_signal.sql` shows.

Run: `node --test tests/migration-ledger-map.test.mjs`
Expected: PASS, 6 tests.

Run: `npm test`
Expected: PASS, whole suite green.

Commit that with:

```bash
git add supabase/migrations/ledger-map.json
git commit -m "chore(pricing): record the applied order table in the ledger map"
```

---

### Task 2: `_shared/price-page.js` — the page a buyer reads and the order it may place

**Files:**
- Create: `supabase/functions/_shared/price-page.js`
- Create: `tests/price-page.test.mjs`
- Modify: `tests/hygiene.test.mjs`

**Interfaces:**
- Consumes: `_shared/billing.js` → `priceFor(priceList, kind)` → `{ kind, unit, amountCents, currency }` or `null`.
- Produces:
  - `pricePage(prices, { error = '', values = {}, now = Date.now() })` → the HTML of the page, as a string.
  - `priceOrder(body, prices, now = Date.now())` → `{ ok: true, customerId, contact, period, kind, amountCents, currency, lines }` or `{ ok: false, error }`.
  - `currentPeriod(now = Date.now())` → `'YYYY-MM'`, the Jakarta month.

- [ ] **Step 1: Write the failing test**

Create `tests/price-page.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/price-page.test.mjs`
Expected: FAIL with `Cannot find module` or `ERR_MODULE_NOT_FOUND` for `../supabase/functions/_shared/price-page.js`.

- [ ] **Step 3: Write the module**

Create `supabase/functions/_shared/price-page.js`:

```javascript
// @last-edited: 2026-11-03 UTC+7.
// @title: price-page — the public price page, rendered from the price list and nothing else.
// @state: the two plans and the overage note, the order form, the error line, and the rules an order has to pass.
// @dependencies: ./billing.js.

// WHY THE PAGE IS A FUNCTION OF THE PRICE LIST.
// A price written into HTML is a second price list, and the two drift the moment somebody edits one row.
// So the page prints only the rows it is given: a plan missing from opera_price_list is not shown and cannot be ordered.

// WHY THE ORDER RULES LIVE HERE.
// The edge function runs where no Node test can call it, and the rules that decide what an order is are the ones worth proving.
// So the page and the order are one pure module: no clock of its own, no database, no network.

import { priceFor } from './billing.js';

const PLAN_KINDS = Object.freeze(['plan.pilot', 'plan.firm']);
const PLAN_NAMES = Object.freeze({ 'plan.pilot': 'Pilot', 'plan.firm': 'Firm' });
const OVERAGE_KIND = 'statement.client_month';
const PHONE = /^(?:\+62|62|0)8[0-9]{7,12}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const money = (cents, currency) => {
  const value = (Number(cents) || 0) / 100;
  return currency === 'IDR'
    ? `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
    : `${currency} ${value.toFixed(2)}`;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// WHY THE QUOTA IS READ OUT OF THE UNIT RATHER THAN TYPED HERE.
// The plan's row already says how many client-months it includes, and a second copy in this file would drift.
// A unit this page does not recognise is printed as it is, so a new plan is visible before this page learns its words.

const quota = (unit) => {
  const found = /up to (\d+) client-months?/.exec(String(unit || ''));
  return found ? `hingga ${found[1]} client-month` : String(unit || '');
};

// WHY THE MONTH IS THE JAKARTA MONTH.
// The invoice is for a firm-month, the customers read Jakarta time, and the server runs in UTC.
// A month boundary read in UTC would invoice October at 07:00 on 1 November, so the offset is added before the month is taken.

export function currentPeriod(now = Date.now()) {
  const start = Number(now);
  const at = new Date((Number.isFinite(start) ? start : Date.now()) + 7 * 60 * 60 * 1000);
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

// WHY THE ORDER IS VALIDATED BEFORE ANY ROW IS WRITTEN.
// The endpoint takes no token, so the body is the only thing a stranger controls.
// The rules are strict enough to keep the table readable and loose enough that a real buyer never has to guess: a firm name, one reachable contact, and a plan that is for sale.

/**
 * @param {{ firm?: unknown, contact?: unknown, kind?: unknown }} body
 * @param {Array<{ kind: string, unit: string, amount_cents: number, currency: string, active: boolean }>} prices
 * @param {number} [now]
 * @returns {{ ok: true, customerId: string, contact: string, period: string, kind: string, amountCents: number, currency: string, lines: Array<{ kind: string, quantity: number, amountCents: number, description: string }> } | { ok: false, error: string }}
 */

export function priceOrder(body, prices, now = Date.now()) {
  const firm = String(body?.firm ?? '').trim();
  const contact = String(body?.contact ?? '').trim();
  const kind = String(body?.kind ?? '').trim();
  if (firm.length < 2 || firm.length > 80) return { ok: false, error: 'nama firma 2–80 karakter' };
  if (!PHONE.test(contact) && !EMAIL.test(contact)) return { ok: false, error: 'kontak berupa nomor WhatsApp atau email' };
  if (!PLAN_KINDS.includes(kind)) return { ok: false, error: 'plan tidak dijual' };
  const price = priceFor(prices, kind);
  if (!price) return { ok: false, error: 'plan tidak dijual' };
  const period = currentPeriod(now);
  return {
    ok: true,
    customerId: firm,
    contact,
    period,
    kind,
    amountCents: price.amountCents,
    currency: price.currency,
    lines: [{ kind, quantity: 1, amountCents: price.amountCents, description: `${PLAN_NAMES[kind]} — ${period}` }]
  };
}

// WHY THE ERROR IS RENDERED WITH THE VALUES STILL IN THE FORM.
// A rejected order must not make a buyer type the firm name again, and the values are the buyer's own bytes.
// So they are escaped into the same page, and the one line above the form says what to fix.

export function pricePage(prices, { error = '', values = {}, now = Date.now() } = {}) {
  const plans = PLAN_KINDS.map((kind) => priceFor(prices, kind)).filter(Boolean);
  const overage = priceFor(prices, OVERAGE_KIND);
  const period = currentPeriod(now);
  const chosen = plans.some((plan) => plan.kind === values.kind) ? values.kind : plans[0]?.kind || '';
  const options = plans.map((plan) => `<option value="${escapeHtml(plan.kind)}"${plan.kind === chosen ? ' selected' : ''}>${escapeHtml(PLAN_NAMES[plan.kind])} — ${escapeHtml(money(plan.amountCents, plan.currency))}, ${escapeHtml(quota(plan.unit))}</option>`).join('');
  const cards = plans.map((plan) => `<li><strong>${escapeHtml(PLAN_NAMES[plan.kind])}</strong> — ${escapeHtml(money(plan.amountCents, plan.currency))}<br><small>${escapeHtml(quota(plan.unit))}, bulan ${escapeHtml(period)}</small></li>`).join('');
  const notice = error ? `<p class="notice" role="alert">${escapeHtml(error)}</p>` : '';
  const order = plans.length
    ? `<form method="post" action="/harga">
<input type="hidden" name="action" value="price-order">
${notice}
<label for="firm">Nama firma</label>
<input id="firm" name="firm" type="text" required minlength="2" maxlength="80" autocomplete="organization" value="${escapeHtml(values.firm || '')}">
<label for="contact">WhatsApp atau email</label>
<input id="contact" name="contact" type="text" required maxlength="120" autocomplete="off" value="${escapeHtml(values.contact || '')}">
<label for="kind">Plan</label>
<select id="kind" name="kind">${options}</select>
<button type="submit">Buat invoice dan bayar</button>
</form>`
    : '<p class="state">Belum ada plan yang dijual.</p>';
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Harga Opera Agent: satu firma, satu bulan, dibayar dengan QRIS.">
<title>Harga — Opera Agent</title>
<style>
 *{box-sizing:border-box}
 body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:44rem;margin:1.5rem auto;padding:0 1rem;color:#111;background:#fff}
 h1{font-size:1.35rem;line-height:1.25;margin:0 0 .25rem}
 .meta{color:#444;margin:.25rem 0 1.5rem;font-size:.95rem}
 .plans{padding-left:1.2rem;margin:1rem 0}
 .plans li{margin:.6rem 0}
 .notice{color:#7a1d1d}
 .state{margin:1rem 0}
 label{display:block;margin:.9rem 0 .25rem;font-weight:600}
 input,select{font:inherit;padding:.6rem .7rem;border:1px solid #999;border-radius:.35rem;width:100%;max-width:26rem;background:#fff;color:#111}
 button{font:inherit;background:#1d4ed8;color:#fff;border:1px solid #1d4ed8;padding:.8rem 1.2rem;border-radius:.4rem;font-weight:600;cursor:pointer;margin-top:1rem}
 button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}
 small{color:#555}
 form{margin:1.5rem 0}
 @media (min-width:36rem){body{margin:3rem auto}h1{font-size:1.5rem}}
</style>
</head>
<body>
<main>
<p class="meta"><a href="/beranda.html">Opera Agent</a></p>
<h1>Harga</h1>
<p class="meta">Satu firma, satu bulan. Bayar dengan QRIS, invoice terbit langsung.</p>
<ul class="plans">${cards}</ul>
${overage ? `<p>Di atas kuota: ${escapeHtml(money(overage.amountCents, overage.currency))} per client-month.</p>` : ''}
${order}
<p><small>Pembayaran lewat QRIS di halaman invoice. Batch pertama yang tidak kami terima dikembalikan penuh oleh operator; tidak ada refund otomatis.</small></p>
<p><small>Kontak hanya dipakai untuk menghubungi firma tentang order ini.</small></p>
</main>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/price-page.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Stage the module until the function calls it**

The tree refuses a module that only its own test reaches, and `price-page.js` reaches nothing until Task 3 wires it into the billing function. Open `tests/hygiene.test.mjs` and add one entry to `STAGED_FOR_THE_OPEN_TASK`:

```javascript
  ['supabase/functions/_shared/price-page.js', 'Task 3 of docs/superpowers/plans/2026-11-03-public-pricing-page.md: the billing function calls it for the public page and the public order'],
```

Run: `node --test tests/hygiene.test.mjs`
Expected: PASS. The stage says why the module is not reached yet, and Task 3 removes the entry.

Run: `node scripts/format-comments.mjs --check`
Expected: the two new files are canonical, and the check exits 0.

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/price-page.js tests/price-page.test.mjs tests/hygiene.test.mjs
git commit -m "feat(pricing): render the price page and rule what an order may be"
```

---

### Task 3: the billing function serves the page and takes the order

**Files:**
- Modify: `supabase/functions/opera-agent-billing/index.ts`
- Modify: `tests/billing.test.mjs`
- Modify: `tests/hygiene.test.mjs`

**Interfaces:**
- Consumes: `_shared/price-page.js` → `pricePage(prices, { error, values })` → the HTML; `priceOrder(body, prices, now)` → the order or the refusal.
- Produces:
  - `GET ?page=harga` → the price page, 200, `text/html`, indexable headers.
  - `POST` with `action=price-order` → one order row, one invoice, `303` to the invoice page; `400` on a refusal, `429` over the limit, `500` when the invoice cannot be made.
  - `PRICE_ORDER_LIMIT = 30` and `PRICE_ORDER_WINDOW_MS = 3600000` — the rate limit.
  - `invoiceLink(invoiceId, token)` → the invoice page URL, now built in one place for both callers.

- [ ] **Step 1: Write the failing test**

Open `tests/billing.test.mjs`. In the test `the operator link names the page host, and falls back to the function`, change the last assertion to the spelling the helper now uses:

```javascript
  assert.match(fn, /return `\$\{base\}\?invoice_id=\$\{encodeURIComponent\(invoiceId\)\}&token=\$\{token\}`/,
    'the link carries the invoice and the token, encoded');
```

Then append this test at the end of the file:

```javascript
// WHY THE PUBLIC BRANCH IS PINNED BY ITS SOURCE.
// The function runs on Deno where no Node test can call it, so the house rule is the one the operator link already follows: the source is read for the shape the promise needs.

test('the public price page and the public order are there, and the order asks for no token', () => {
  const fn = fs.readFileSync(new URL('../supabase/functions/opera-agent-billing/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /url\.searchParams\.get\("page"\) === "harga"/, 'the page is named in the query');
  assert.match(fn, /pricePage\(prices\)/, 'the page is rendered from the live price list');
  assert.match(fn, /priceOrder\(values, prices\)/, 'the rules are the ones the module proves');
  assert.match(fn, /body\.action === "price-order"/, 'the order is named in the body');
  assert.match(fn, /from\("opera_price_orders"\)/, 'the order is written');
  assert.match(fn, /PRICE_ORDER_LIMIT = 30/, 'the rate limit is thirty new orders an hour');
  const branch = fn.slice(fn.indexOf('body.action === "price-order"'), fn.indexOf('const looksLikeNotification'));
  assert.doesNotMatch(branch, /BILLING_TOKEN/, 'the public branch never asks for the operator token');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/billing.test.mjs`
Expected: FAIL. The new test fails because the function has no `harga` branch, and the link assertion fails because the link is still built inline.

- [ ] **Step 3: Write the code**

Open `supabase/functions/opera-agent-billing/index.ts` and make these six edits.

**Edit 1 — the header.** Replace the four header lines with:

```typescript
// @last-edited: 2026-11-03 UTC+7.
// @title: opera-agent-billing — the invoice a customer opens, the public price page, and the callback that closes it.
// @state: quotes a delivery into an amount, opens one payable transaction per invoice, serves the public price page and takes a public order without an operator, serves the invoice page in the state the row is in, closes it from a signed notification or the provider's own answer, records a transfer by hand, and opens a new link when the customer asks.
// @dependencies: edge-runtime, supabase-js, ../_shared/billing.js, ../_shared/invoice-page.js, ../_shared/price-page.js, ../_shared/cors.js, ../_shared/edge-log.js.
```

**Edit 2 — the import.** After the line `import { invoicePage } from "../_shared/invoice-page.js";` add:

```typescript
import { priceOrder, pricePage } from "../_shared/price-page.js";
```

**Edit 3 — the page headers.** Replace:

```typescript
const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function pageHeaders(cors: Record<string, string>): Record<string, string> {
  return {
    ...cors,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": PAGE_POLICY
  };
}
```

with:

```typescript
const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// WHY ONE PAGE MAY BE INDEXED AND THE OTHER MAY NOT.
// The invoice page carries a token in its query string, so a crawler that followed it would hold somebody's invoice.
// The price page carries no token and is meant to be found, so it keeps the policy and drops the no-referrer rule.

function pageHeaders(cors: Record<string, string>, { indexable = false } = {}): Record<string, string> {
  return {
    ...cors,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": indexable ? "strict-origin-when-cross-origin" : "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": PAGE_POLICY
  };
}
```

**Edit 4 — the limit and the one link builder.** After the `priceList` function, replace its closing brace and blank line with the same closing brace, the blank line, and these two blocks:

```typescript
// WHY THE PUBLIC ORDER IS LIMITED BY THE ROWS IT WRITES.
// The action takes no token, so a script can post as fast as the function answers.
// The order table is the only place that knows how many were written, so the count of the last hour is the limit: far above a day of real buyers, low enough that a loop cannot fill the table before an operator looks.

const PRICE_ORDER_LIMIT = 30;
const PRICE_ORDER_WINDOW_MS = 60 * 60 * 1000;

// WHY THE INVOICE LINK IS BUILT IN ONE PLACE.
// The operator's action and the public order both answer with the page that opens the invoice, and a second spelling of the query would drift.
// BILLING_PAGE_URL names the site when it is set; the function's own URL is the fallback for a deployment that never set it.

function invoiceLink(invoiceId: string, token: string): string {
  const base = BILLING_PAGE_URL || `${SUPABASE_URL}/functions/v1/opera-agent-billing`;
  return `${base}?invoice_id=${encodeURIComponent(invoiceId)}&token=${token}`;
}
```

**Edit 5 — the GET branch.** Replace:

```typescript
    if (req.method === "GET") {
      const invoiceId = url.searchParams.get("invoice_id") || "";
```

with:

```typescript
    if (req.method === "GET") {
      if (url.searchParams.get("page") === "harga") {
        const supabase = await db();
        const prices = await priceList(supabase);
        return new Response(pricePage(prices), { status: 200, headers: pageHeaders(cors, { indexable: true }) });
      }
      const invoiceId = url.searchParams.get("invoice_id") || "";
```

**Edit 6 — the POST branch.** Replace:

```typescript
    if (req.method === "POST") {
      const body = await readBody(req);
```

with:

```typescript
    if (req.method === "POST") {
      const body = await readBody(req);
      // WHY A PRICE ORDER NEEDS NO OPERATOR TOKEN.
      // The page is for a person who has nothing yet: no account, no invoice, no link.
      // The body is the only thing a stranger controls, so the price, the month and the invoice id are derived here and never read from the request.
      if (body.action === "price-order") {
        const supabase = await db();
        const prices = await priceList(supabase);
        const values = {
          firm: String(body.firm || ""),
          contact: String(body.contact || ""),
          kind: String(body.kind || "")
        };
        const order = priceOrder(values, prices);
        if (!order.ok) {
          return new Response(pricePage(prices, { error: order.error, values }), {
            status: 400,
            headers: pageHeaders(cors, { indexable: true })
          });
        }
        const { data: placed, error: placedError } = await supabase
          .from("opera_price_orders")
          .select("invoice_id, kind, amount_cents")
          .eq("firm", order.customerId)
          .eq("period", order.period)
          .maybeSingle();
        if (placedError) throw new HttpError(500, `price orders unreadable: ${placedError.message}`);
        if (!placed) {
          const { count, error: counted } = await supabase
            .from("opera_price_orders")
            .select("id", { count: "exact", head: true })
            .gte("created_at", new Date(Date.now() - PRICE_ORDER_WINDOW_MS).toISOString());
          if (counted) throw new HttpError(500, `price orders unreadable: ${counted.message}`);
          if ((count || 0) >= PRICE_ORDER_LIMIT) {
            return new Response(pricePage(prices, { error: "terlalu banyak order, coba lagi nanti", values }), {
              status: 429,
              headers: pageHeaders(cors, { indexable: true })
            });
          }
        }
        const invoiceId = placed?.invoice_id || `${order.customerId}:${order.period}`;
        try {
          // WHY THE INVOICE IS READ BEFORE THE ORDER IS WRITTEN.
          // The order row fixes the plan and the amount that were agreed, and the invoice holds what it charged.
          // So a resubmit returns that invoice as it is, touches only the contact, and never re-prices what was agreed.
          const { data: current } = await supabase.from("opera_invoices").select("status").eq("id", invoiceId).maybeSingle();
          if (current) {
            const { error: contactError } = await supabase
              .from("opera_price_orders")
              .update({ contact: order.contact })
              .eq("firm", order.customerId)
              .eq("period", order.period);
            if (contactError) throw new HttpError(500, `the order could not be updated: ${contactError.message}`);
            const token = invoiceToken(invoiceId, BILLING_SECRET);
            return new Response(null, { status: 303, headers: { location: invoiceLink(invoiceId, token), ...cors } });
          }
          // WHY THE FIRST ORDER DECIDES THE PLAN.
          // The order row is the record of what was agreed, so an order that already exists keeps the plan it names and the amount it holds.
          const fixed = placed ? priceOrder({ firm: order.customerId, contact: order.contact, kind: placed.kind }, prices) : order;
          const lines = fixed.ok ? fixed.lines : order.lines;
          const { error: orderError } = await supabase.from("opera_price_orders").upsert({
            firm: order.customerId,
            period: order.period,
            contact: order.contact,
            kind: placed?.kind || order.kind,
            amount_cents: placed?.amount_cents || order.amountCents,
            invoice_id: invoiceId
          }, { onConflict: "firm,period" });
          if (orderError) throw new HttpError(500, `the order could not be written: ${orderError.message}`);
          const out = await createInvoice({ customer_id: order.customerId, period: order.period, lines });
          return new Response(null, { status: 303, headers: { location: invoiceLink(out.invoice.id, out.token), ...cors } });
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          log.error("PRICE_ORDER_FAILED", why);
          return new Response(pricePage(prices, { error: "invoice belum bisa dibuat, coba lagi", values }), {
            status: 500,
            headers: pageHeaders(cors, { indexable: true })
          });
        }
      }
```

**Edit 7 — the operator action.** Replace:

```typescript
        const out = await createInvoice({ customer_id: customerId, period, lines });
        const base = BILLING_PAGE_URL || `${SUPABASE_URL}/functions/v1/opera-agent-billing`;
        const link = `${base}?invoice_id=${encodeURIComponent(out.invoice.id)}&token=${out.token}`;
        return json({ invoice: out.invoice, url: link }, 200, cors);
```

with:

```typescript
        const out = await createInvoice({ customer_id: customerId, period, lines });
        return json({ invoice: out.invoice, url: invoiceLink(out.invoice.id, out.token) }, 200, cors);
```

- [ ] **Step 4: Unstage the module**

The function now reaches `price-page.js`, so the staged entry from Task 2 is stale. Open `tests/hygiene.test.mjs` and delete this line from `STAGED_FOR_THE_OPEN_TASK`:

```javascript
  ['supabase/functions/_shared/price-page.js', 'Task 3 of docs/superpowers/plans/2026-11-03-public-pricing-page.md: the billing function calls it for the public page and the public order'],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/billing.test.mjs`
Expected: PASS, 48 tests.

Run: `node --test tests/hygiene.test.mjs`
Expected: PASS. The module is reached by the product, so the staged list must not name it.

Run: `node --test tests/price-page.test.mjs`
Expected: PASS, 12 tests.

Run: `node scripts/format-comments.mjs --check`
Expected: every file is canonical, and the check exits 0.

Run: `npm test`
Expected: PASS, whole suite green.

Run: `npm run check`
Expected: PASS.

Run: `cd supabase/functions/opera-agent-billing && deno check index.ts`
Expected: the same nine pre-existing type errors the unmodified file already prints. The count must not grow; those nine are a known baseline and are not fixed here.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/opera-agent-billing/index.ts tests/billing.test.mjs tests/hygiene.test.mjs
git commit -m "feat(pricing): serve the price page and take a public order"
```

---

### Task 4: the worker serves `/harga` from the product's own domain

**Files:**
- Modify: `landing/_worker.js`
- Modify: `tests/invoice-worker.test.mjs`

**Interfaces:**
- Consumes: the deployed `opera-agent-billing` function, `env.ASSETS`.
- Produces: `GET /harga` → the price page with `content-type: text/html; charset=utf-8` and no `x-robots-tag`; `POST /harga` → the function's answer, including its `303`; a failure → a `502` page with no reason a customer can use.

- [ ] **Step 1: Write the failing test**

Append to `tests/invoice-worker.test.mjs`:

```javascript
const PRICE_PAGE = 'https://opera-agent.pages.dev/harga';
const PRICE_UPSTREAM = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing?page=harga';

test('the price page is fetched from the function and answered as an indexable page', async () => {
  reset(() => new Response('<!doctype html><html lang="id"><body>Pilot Rp 99.000</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/plain' }
  }));

  const response = await worker.fetch(new Request(PRICE_PAGE), env);

  assert.equal(calls.length, 1, 'one question to the function, not a second one');
  assert.equal(calls[0].url, PRICE_UPSTREAM, 'the function hears which page it must render');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), null, 'the price page may be indexed');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
  assert.match(await response.text(), /Rp 99\.000/);
});

test('an order posted from the price page reaches the function with its body', async () => {
  reset(() => new Response(null, {
    status: 303,
    headers: { location: 'https://opera-agent.pages.dev/invoice?invoice_id=Uji%3A2026-11&token=tok' }
  }));

  const body = 'action=price-order&firm=Uji&contact=081234567890&kind=plan.pilot';
  const response = await worker.fetch(new Request(PRICE_PAGE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  }), env);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing', 'a post names the page in its body');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(await new Response(calls[0].init.body).text(), body, 'the form arrives whole');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://opera-agent.pages.dev/invoice?invoice_id=Uji%3A2026-11&token=tok', 'the buyer lands on the invoice page');
});

test('a refused order is the page again, with the status the function chose', async () => {
  reset(() => new Response('<!doctype html><html lang="id"><body>terlalu banyak order, coba lagi nanti</body></html>', {
    status: 429,
    headers: { 'content-type': 'text/plain' }
  }));

  const response = await worker.fetch(new Request(PRICE_PAGE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'action=price-order'
  }), env);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await response.text(), /terlalu banyak order/);
});

test('a price page that cannot be reached is a page and says nothing technical', async () => {
  reset(() => {
    throw new Error('connect ECONNREFUSED 203.0.113.1:443');
  });

  const response = await worker.fetch(new Request(PRICE_PAGE), env);

  assert.equal(response.status, 502);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await response.text();
  assert.match(html, /Halaman harga tidak bisa dimuat sekarang\./);
  assert.match(html, /Coba lagi sebentar lagi\./);
  assert.doesNotMatch(html, /ECONNREFUSED/, 'the worker\'s reason stays in the log');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/invoice-worker.test.mjs`
Expected: FAIL. The four new tests fail because the worker sends `/harga` to the asset server, and the asset server answers `asset` with `text/plain`.

- [ ] **Step 3: Write the worker**

Replace `landing/_worker.js` with:

```javascript
// @last-edited: 2026-11-03 UTC+7.
// @title: _worker — serves the invoice and price pages from the product's own domain, because the function's domain refuses HTML.
// @state: proxies /invoice and /harga to the billing function with their query and body, relabels the pages, rewrites the function's redirects back to /invoice, and leaves every other path to the asset server.
// @dependencies: the deployed opera-agent-billing function, env.ASSETS.

// WHY THIS FILE EXISTS.
// Measured live on 2026-10-26: Supabase's shared function domain answered the function's HTML with Content-Type text/plain and content-security-policy default-src 'none'; sandbox.
// The browser showed the page as source and the refresh form could not be submitted, so a customer holding a real invoice had no way to pay it.
// The gateway does that on purpose on a domain shared by every project, so the page is served from the product's own domain and the function stays the only thing that knows the invoice.

// WHY THE WORKER IS THE WHOLE SITE ONCE IT EXISTS.
// A Pages project has one _worker.js, and every request passes through it.
// So this worker owns /invoice and /harga and hands every other request to the asset server unchanged: the site is one directory, and the pages are two paths in it.

// WHY THE PAGE'S HEADERS ARE SET HERE AND NOT READ FROM THE FUNCTION.
// The function sets them, and the gateway keeps the policy but replaces the content type with text/plain.
// A page that carries a token must not be cached, must not leak the link as a referrer, and must not be framed or indexed, so the worker states all of it on the answer the browser actually receives.

const FUNCTION_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-billing';
const INVOICE_PATH = '/invoice';
const PRICE_PATH = '/harga';
const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const PAGE_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': PAGE_POLICY
});

// WHY THE PRICE PAGE IS ALLOWED TO BE INDEXED.
// The invoice page carries a capability in its query string, so a crawler that followed it would hold somebody's invoice.
// The price page carries no token and is meant to be found, so it keeps the policy and drops the two headers that hide a page.

const PRICE_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': PAGE_POLICY
});

// WHY ONLY TWO HEADERS CROSS TO THE FUNCTION.
// The page link is a capability in the query string, and the function needs the method, the query, the body and its type to answer.
// A browser's cookies and origin headers belong to the site, not to this invoice, and forwarding them would hand the function a session it has no use for.

async function askFunction(request, search) {
  const target = new URL(FUNCTION_URL);
  target.search = search === undefined ? new URL(request.url).search : search;
  const headers = new Headers();
  for (const name of ['accept', 'content-type']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  return fetch(target.toString(), init);
}

// WHY A REDIRECT IS REWRITTEN INSTEAD OF FOLLOWED.
// The refresh form posts here, and the function answers 303 to the address it knows: its own path.
// Following that answer would leave the browser at the old address with a 200, so a reload would post the form again.
// Rewriting the Location keeps the address and the method honest, and only the function's own answer is rewritten, so another host cannot be turned into a link on the product's domain.

// WHY THE PATH THE FUNCTION SEES IS NOT THE PATH IN THIS FILE.
// Measured live on 2026-10-26: the same function answered a redirect to /opera-agent-billing, not to /functions/v1/opera-agent-billing, because the gateway strips the prefix before the function reads its own URL.
// So the rule is the shape of the answer, not a path this file guessed: a root-relative Location belongs to the function, and an absolute one is rewritten only when its host is the function's.

function pageLocation(location) {
  if (!location) return '';
  let at;
  try {
    at = new URL(location, FUNCTION_URL);
  } catch {
    return '';
  }
  const fn = new URL(FUNCTION_URL);
  const ours = location.startsWith('/') || at.origin === fn.origin;
  if (!ours) return '';
  return `${INVOICE_PATH}${at.search}`;
}

// WHY THE BODY DECIDES WHAT THE PAGE IS, NOT THE CONTENT TYPE.
// The gateway labels every function answer text/plain, so the content type the function sent no longer says what the body is.
// The page starts with a doctype and an error is JSON, so the first characters are the only honest way to tell them apart.

const looksLikePage = (body) => /^\s*(<!doctype html|<html[\s>])/i.test(body);

// WHY A FAILURE IS A PAGE AND NOT A STACK TRACE.
// The customer cannot do anything with the worker's error, and the worker cannot say whether the invoice changed.
// So a failure says only that the page could not be loaded and that nothing has changed, and the reason goes to the Pages log.

const FAILURES = Object.freeze({
  [INVOICE_PATH]: ['The invoice could not be loaded just now.', 'Nothing has changed. Try again in a moment.'],
  [PRICE_PATH]: ['Halaman harga tidak bisa dimuat sekarang.', 'Coba lagi sebentar lagi. Tidak ada yang berubah.']
});

function failure(path = INVOICE_PATH) {
  const [heading, body] = FAILURES[path] || FAILURES[INVOICE_PATH];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice</title><style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:44rem;margin:1.5rem auto;padding:0 1rem;color:#111}</style></head><body><h1>${heading}</h1><p>${body}</p></body></html>`;
  return new Response(html, { status: 502, headers: path === PRICE_PATH ? PRICE_HEADERS : PAGE_HEADERS });
}

function redirectAnswer(upstream) {
  const location = upstream.headers.get('location') || '';
  const headers = new Headers({ 'cache-control': 'no-store' });
  const rewritten = pageLocation(location);
  if (rewritten) headers.set('location', rewritten);
  else if (location) headers.set('location', location);
  return new Response(null, { status: upstream.status, headers });
}

async function serveInvoice(request) {
  let upstream;
  try {
    upstream = await askFunction(request);
  } catch (error) {
    console.error('INVOICE_PROXY_FAILED', error instanceof Error ? error.message : String(error));
    return failure();
  }
  if (upstream.status >= 300 && upstream.status < 400) return redirectAnswer(upstream);
  const body = await upstream.text();
  const type = upstream.headers.get('content-type') || '';
  if (type.includes('text/html') || looksLikePage(body)) {
    return new Response(body, { status: upstream.status, headers: PAGE_HEADERS });
  }
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': type || 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
}

// WHY THE PRICE PAGE ASKS A DIFFERENT QUESTION.
// The function has one URL for both pages, so the page is named in the query for a GET and in the body for a POST.
// A GET carries no body, and a POST that names the page in the body is the form the buyer submitted; neither path needs a second endpoint.

async function servePrice(request) {
  let upstream;
  try {
    upstream = await askFunction(request, request.method === 'GET' ? '?page=harga' : undefined);
  } catch (error) {
    console.error('PRICE_PROXY_FAILED', error instanceof Error ? error.message : String(error));
    return failure(PRICE_PATH);
  }
  if (upstream.status >= 300 && upstream.status < 400) return redirectAnswer(upstream);
  const body = await upstream.text();
  if (!looksLikePage(body)) return failure(PRICE_PATH);
  return new Response(body, { status: upstream.status, headers: PRICE_HEADERS });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === INVOICE_PATH || path === `${INVOICE_PATH}/`) return serveInvoice(request);
    if (path === PRICE_PATH || path === `${PRICE_PATH}/`) return servePrice(request);
    return env.ASSETS.fetch(request);
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/invoice-worker.test.mjs`
Expected: PASS, 13 tests. The nine old locks still hold, and the four new ones pass.

Run: `node scripts/format-comments.mjs --check`
Expected: every file is canonical, and the check exits 0.

Run: `npm test`
Expected: PASS, whole suite green.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/_worker.js tests/invoice-worker.test.mjs
git commit -m "feat(pricing): serve the price page from the site"
```

---

### Task 5: every page carries the way to the price page

**Files:**
- Modify: `landing/beranda.html`, `landing/404.html`, `landing/akun.html`, `landing/dashboard.html`, `landing/dukungan.html`, `landing/fitur.html`, `landing/index.html`, `landing/privasi.html`, `landing/syarat.html`, `landing/unduh.html`, `landing/unduh-berkas.html`, `landing/oauth/consent.html`
- Modify: `tests/landing-consent.test.mjs`

**Interfaces:**
- Consumes: the worker path `/harga` from Task 4.
- Produces: one nav entry "Harga" on all twelve pages, at the same place on every one of them, and `nav.price` in the nine dicts that carry one.

- [ ] **Step 1: Write the failing test**

Open `tests/landing-consent.test.mjs`. Change the header to:

```javascript
// @last-edited: 2026-11-03 UTC+7.
// @title: landing-consent — the OAuth permission screen, and the two defects it removes.
// @state: 9 locks green; the separate deployment it replaced is still on disk until the production site URL moves.
// @dependencies: node:test, node:assert, node:fs.
```

In the test `every page link resolves, including on the page that lives in a subdirectory`, add this above the `for (const page of pages)` loop:

```javascript
  // WHY ONE LINK IS NOT A FILE.
  // The price page is served by the worker at /harga and has no file in landing/, so there is nothing on disk to resolve it to.
  // The worker test in tests/invoice-worker.test.mjs proves that path answers.
  const workerPages = new Set(['harga']);
```

and inside the loop over the links, right before the `assert.ok(exists(target), ...)` line, add:

```javascript
      if (workerPages.has(target)) continue;
```

Then append this test at the end of the file:

```javascript
test('every page that carries the nav offers the price page', () => {
  for (const page of ['beranda.html', 'index.html', 'akun.html', 'dashboard.html', 'privasi.html', 'syarat.html', 'unduh.html', 'unduh-berkas.html', 'fitur.html', 'dukungan.html', '404.html', 'oauth/consent.html']) {
    const nav = read(`landing/${page}`).match(/<nav>[\s\S]*?<\/nav>/)[0];
    assert.match(nav, /<a href="\/harga"/, `${page} offers the price page`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/landing-consent.test.mjs`
Expected: FAIL. The new test fails because no page links to `/harga` yet; the other eight locks still hold.

- [ ] **Step 3: Add the nav entry to the twelve pages**

The nav entry goes after the `Dukungan` anchor, which is the last link of the row on every page, so the order is the same on all twelve and the nav-consistency lock keeps passing.

On the nine pages that carry a dict — `beranda.html`, `404.html`, `dukungan.html`, `fitur.html`, `index.html`, `privasi.html`, `syarat.html`, `unduh.html`, `unduh-berkas.html` — replace:

```html
data-i18n="nav.support">Dukungan</a>
```

with:

```html
data-i18n="nav.support">Dukungan</a>        <a href="/harga" data-i18n="nav.price">Harga</a>
```

On the three pages with no dict, replace the whole anchor, because `>Dukungan</a>` alone also appears on the nine pages above. In `akun.html` and `dashboard.html` replace:

```html
<a class="nav-sec" href="./dukungan.html">Dukungan</a>
```

with:

```html
<a class="nav-sec" href="./dukungan.html">Dukungan</a>        <a href="/harga">Harga</a>
```

and in `oauth/consent.html` replace:

```html
<a class="nav-sec" href="/dukungan.html">Dukungan</a>
```

with:

```html
<a class="nav-sec" href="/dukungan.html">Dukungan</a>        <a href="/harga">Harga</a>
```

On each of the same nine dict pages, add the English string right after the `"nav.support": "Support",` line inside the `i18n-dict` script:

```json
    "nav.price": "Pricing",
```

Finally, on each of the twelve pages, change the first line from `<!-- @last-edited: 2026-10-26 UTC+7. -->` (or the date that page carries) to:

```html
<!-- @last-edited: 2026-11-03 UTC+7. -->
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/landing-consent.test.mjs`
Expected: PASS, 9 tests.

Run: `node --test tests/landing-i18n.test.mjs`
Expected: PASS. The nine dicts carry `nav.price`, and the three pages without a dict mark nothing.

Run: `node --test tests/landing-visual.test.mjs tests/landing-company.test.mjs tests/landing-page.test.mjs tests/landing-claims.test.mjs tests/landing-download.test.mjs`
Expected: PASS. The nav row keeps its own measure, the secondary items still hide on a narrow screen, and no page claims a price it cannot sell.

Run: `node scripts/format-comments.mjs --check`
Expected: every file is canonical, and the check exits 0.

Run: `npm test`
Expected: PASS, whole suite green.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/beranda.html landing/404.html landing/akun.html landing/dashboard.html landing/dukungan.html landing/fitur.html landing/index.html landing/privasi.html landing/syarat.html landing/unduh.html landing/unduh-berkas.html landing/oauth/consent.html tests/landing-consent.test.mjs
git commit -m "feat(pricing): link the price page from every page"
```

---

### Task 6: deploy it and drive it with a real rupiah

**Files:** none. This task is driven against the live account, and nothing in the tree changes.

**Why this task cannot be automated:** the facts it measures are facts about the world — that a buyer can reach the page, that the page opens an invoice, and that a payment closes it. A test cannot make a real rupiah arrive.

- [ ] **Step 1: Deploy the function and the site, one at a time, from the main checkout**

Per `AGENTS.md`, a deploy runs from the main checkout and one at a time. From `D:/GitHub/opera-agent` on `main`:

```bash
npx supabase functions deploy opera-agent-billing --project-ref nenmkmtvjremqphfqnfw --no-verify-jwt
gh workflow run "Deploy site" -f reason="public price page"
gh run list --workflow "Deploy site" --limit 1
```

Expected: the function deploy finishes, and the site workflow turns green. A push that does not deploy leaves CI green and the old build live, so the site is published by the dispatch, not by the push.

- [ ] **Step 2: Read the live page**

```powershell
curl.exe -sS -D - -o "$env:TEMP\harga.html" https://opera-agent.pages.dev/harga
```

Expected: `200`, `content-type: text/html; charset=utf-8`, no `x-robots-tag`, and the body holds `Rp 99.000`, `Rp 249.000`, `Rp 10.000` and no `<script`.

```powershell
Select-String -Path "$env:TEMP\harga.html" -Pattern "Rp 99.000|Rp 249.000|<script|token="
```

Expected: the three prices, and no script and no token.

- [ ] **Step 3: Place one order**

```powershell
curl.exe -sS -D - -o NUL -X POST https://opera-agent.pages.dev/harga -H "content-type: application/x-www-form-urlencoded" --data "action=price-order&firm=Firma Uji Harga&contact=081234567890&kind=plan.pilot"
```

Expected: `303` and a `Location` that holds `/invoice?invoice_id=Firma%20Uji%20Harga%3A2026-11&token=`.

- [ ] **Step 4: Open the invoice the buyer was sent to**

Open the `Location` from Step 3 in a browser, or fetch it:

```powershell
curl.exe -sS -D - -o "$env:TEMP\invoice.html" "<the Location from Step 3>"
```

Expected: `200`, `text/html`, and the page says `Rp 99.000`. If the QRIS rail is live, the page carries a QR to scan; if it is not, the page carries the transfer instruction. Write down which one it was: the rail's own plan measures that separately.

- [ ] **Step 5: Check the rows the order wrote**

```powershell
node "$env:TEMP\opera-query.mjs" "select firm, period, contact, kind, amount_cents, invoice_id, created_at from opera_price_orders order by created_at desc limit 5"
node "$env:TEMP\opera-query.mjs" "select id, status, amount_cents, currency, paid_at from opera_invoices where id like 'Firma Uji Harga:%'"
```

Expected: one order row with `amount_cents` `9900000` and the invoice id `Firma Uji Harga:2026-11`, and one invoice row with `amount_cents` `9900000` and `status` `open`.

- [ ] **Step 6: Pay it with a real app**

If the QRIS rail is live, scan the QR on the invoice page with a real banking app and pay Rp 99.000. The detector closes the invoice within a minute.

```powershell
node "$env:TEMP\opera-query.mjs" "select id, status, amount_cents, paid_at from opera_invoices where id = 'Firma Uji Harga:2026-11'"
```

Expected: `status` `paid` and a `paid_at`. If the rail is not live yet, the invoice stays `open`, and this step is left open with the reason written in the handoff: the page and the order work, the automatic close waits for the rail.

- [ ] **Step 7: Submit the same order again**

```powershell
curl.exe -sS -D - -o NUL -X POST https://opera-agent.pages.dev/harga -H "content-type: application/x-www-form-urlencoded" --data "action=price-order&firm=Firma Uji Harga&contact=081234567890&kind=plan.pilot"
node "$env:TEMP\opera-query.mjs" "select count(*) from opera_price_orders where firm = 'Firma Uji Harga' and period = '2026-11'"
```

Expected: the same `Location` as Step 3, and `1` row. A resubmit never opens a second invoice and never rewrites the amount of an order that is already paid.

- [ ] **Step 8: Clean up what was only a test**

```powershell
node "$env:TEMP\opera-query.mjs" "delete from opera_price_orders where firm = 'Firma Uji Harga' and period = '2026-11' and invoice_id in (select id from opera_invoices where paid_at is null)"
```

Expected: the unpaid test order is gone. **A paid order and its invoice stay**: the paid invoice is the money's record, and the order row is the operator's record of who paid. The handoff carries the query that removes an unpaid test row.

- [ ] **Step 9: Write the measurements down**

Write the answers to Steps 2, 4, 5, 6 and 7 into `docs/handoff.md` in Task 7, with the date and what was actually seen. A measurement nobody wrote down is a measurement nobody can trust.

---

### Task 7: the documents say what is now true

**Files:**
- Modify: `docs/product/billing.md`
- Modify: `docs/product/monetization.md`
- Modify: `docs/handoff.md`

**Interfaces:**
- Consumes: the measurements Task 6 wrote down.
- Produces: three documents that name the page, the public action, the order table, the rate limit, the refund rule, and the known limit.

- [ ] **Step 1: Write the billing page**

In `docs/product/billing.md`, insert this section before the line `## Measured live, against the deployed functions`:

```markdown
## The price page, and the order behind it

The site sells one plan at a time from `https://opera-agent.pages.dev/harga`. The page
is not a file: it is rendered by `opera-agent-billing` from the live `opera_price_list`
rows, so a price exists in exactly one place and a plan that is switched off cannot be
bought. The page carries no token, no script and no price literal, and it is the one
public page that may be indexed; the invoice page stays `noindex`.

The form posts to the same path. The worker forwards it to the function, the function
answers `303`, and the buyer lands on the invoice page. That action takes **no
operator token**: it is for a person who has no account, no invoice and no link yet.
What it accepts is a firm name, one contact and a plan; what it derives is the amount,
the Jakarta month and the invoice id `${firm}:${period}`. The price is read from the
row, never from the request.

Every accepted order writes one row to `opera_price_orders`: the firm, the contact,
the plan, the amount in cents at that moment, and the invoice id. The table has RLS on
and no policy, so only the service role reads it; it holds no IP, no user agent and no
token. One `(firm, period)` is one order, so a resubmit returns the same invoice and
writes no second row, and an invoice that already exists is never re-priced by a
resubmit: the resubmit only updates the contact. Thirty new orders in a rolling hour is
the limit; over it the page answers `429` with one line of Indonesian text.

Two firms with the same name in the same month share one invoice, because the invoice
id is the firm name and the month. That is the known limit of this shape: separating
them needs a customer table, which this plan does not build.

A first batch the firm does not accept is refunded by hand. No provider API used here
can refund, so the operator does it outside the system and records it there; the page
says so in the same words.
```

- [ ] **Step 2: Correct the monetization promise**

In `docs/product/monetization.md`, replace:

```markdown
client-month is one client, one portal, one month. A batch that is not delivered is
not charged: the invoice is issued only after the firm accepts the first batch, and
the proof is the reason the charge is defensible.
```

with:

```markdown
client-month is one client, one portal, one month. A batch that is not delivered is
not charged, and the proof is the reason the charge is defensible.

The **public price page** changes when the invoice is issued. A buyer who orders from
`https://opera-agent.pages.dev/harga` pays first: the invoice is issued the moment the
order arrives, not after the first batch is accepted. A first batch the firm does not
accept is refunded in full by the operator by hand, and there is no automatic refund,
because no provider used here can refund. The operator's way back to the buyer is the
`opera_price_orders` row, which holds the name and the contact the buyer typed.
```

- [ ] **Step 3: Write the handoff**

In `docs/handoff.md`, change item 11 of "Still open" so it says what is true now:

```markdown
11. **The price is decided and applied, and the public page sells it.** `plan.pilot` Rp 99.000
    up to 15 client-months, `plan.firm` Rp 249.000 up to 50, extra Rp 10.000; the operator path
    still invoices after the first accepted batch, and the public page at
    `opera-agent.pages.dev/harga` invoices the moment the order arrives.
```

Then add the next item to the same list:

```markdown
14. **The public price page is live.** `GET /harga` renders from `opera_price_list`, and
    `POST /harga` takes `action=price-order` with no operator token: it writes one
    `opera_price_orders` row, opens the invoice `${firm}:${period}`, and answers `303`. Thirty new
    orders a rolling hour is the limit. The operator's query is:
    `select o.created_at, o.firm, o.contact, o.kind, o.amount_cents, i.status, i.paid_at from
    opera_price_orders o join opera_invoices i on i.id = o.invoice_id order by o.created_at desc;`.
    An unpaid test row is removed with `delete from opera_price_orders where firm = '...' and
    period = '...';`; a paid row stays, because it is the money's record. An invoice nobody pays stays
    open: there is no automatic expiry on the QRIS path, so the operator closes it by hand with
    `settle-manual` or voids it, and a voided invoice stays voided until the operator opens a new
    one by hand. The known limit: two
    firms with the same name in one month share one invoice.
```

And in the "State" section, add this bullet:

```markdown
- **The price page is served from the product's domain, not from a file.** `landing/_worker.js`
  proxies `/harga` to `opera-agent-billing` because the shared function domain answers HTML as
  `text/plain`; the page is rendered by `_shared/price-page.js` and proved by
  `tests/price-page.test.mjs` (12 tests) and `tests/invoice-worker.test.mjs` (13 tests).
```

Finally, write the Task 6 measurements into "Measured, not assumed" as one bullet, with the date and what was actually seen: the status of the live page, the status of the invoice after the order, whether the QRIS rail closed it, the number of order rows after the resubmit, and what was deleted.

- [ ] **Step 4: Run the gates**

Run: `npm test`
Expected: PASS. The hygiene gate reads the Markdown for a rule stated twice, so a sentence that repeats another file's rule in another form fails here.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/product/billing.md docs/product/monetization.md docs/handoff.md
git commit -m "docs(pricing): name the price page, the order table and the refund rule"
```

---

## Verification

The plan is done when all of this is true.

| Gate | How it is checked |
|---|---|
| The page and the order rules are right | `node --test tests/price-page.test.mjs` — 12 tests |
| The function has the public branch and asks for no token in it | `node --test tests/billing.test.mjs` — 48 tests |
| The site serves the page and forwards the order | `node --test tests/invoice-worker.test.mjs` — 13 tests |
| Every page links the price page | `node --test tests/landing-consent.test.mjs` — 9 tests |
| The dicts and the marked strings agree | `node --test tests/landing-i18n.test.mjs` |
| The table exists and the ledger names it | `node --test tests/migration-ledger-map.test.mjs` — 6 tests |
| The tree is honest | `npm test`, `npm run check` |
| The page works with real money | Task 6: an order from the live page, one invoice, and a real rupiah that closes it without an operator |

## Definition of done

- [ ] `opera_price_orders` exists in the live database, with the unique `(firm, period)`, RLS on and no policy, and a ledger row the file wrote for itself. **Task 1.**
- [ ] `GET /harga` shows the two plans and the overage note from `opera_price_list`, with no script, no token and no price literal in the HTML. **Tasks 2, 3, 4.**
- [ ] `POST /harga` writes one order row, opens one invoice, and answers `303` to the invoice page, without an operator token. **Task 3.**
- [ ] A resubmit for the same firm and month returns the same invoice, writes no second row, and never re-prices an invoice that already exists. **Tasks 2, 3, 6.**
- [ ] Over thirty new orders in a rolling hour, the answer is `429` and a page, not an error. **Task 3.**
- [ ] Every page of the site carries the way to the price page. **Task 5.**
- [ ] A real Rp 99.000 payment closes the invoice, or the handoff says plainly that the rail is not live yet. **Task 6.**
- [ ] `docs/product/billing.md`, `docs/product/monetization.md` and `docs/handoff.md` name the page, the public action, the order table, the rate limit, the refund rule and the known limit. **Task 7.**

## Out of scope

- **Automatic refund.** No provider used here can refund, so the operator does it by hand and the page says so.
- **Recurring billing.** The page sells one firm-month. The next month is still the operator's, or another spec's.
- **A customer table.** Two firms with the same name in one month share one invoice; separating them needs an identity this plan does not build.
- **Captcha, customer accounts, transactional email.** The rate limit and the contact rule are the defence.
- **A second payment rail on this page.** The page sells what `BILLING_RAIL` says; it does not choose a provider.
- **The Vercel backup serving `/harga`.** Vercel has no worker, so the path answers the site's own 404 there. The price page lives on Cloudflare, where the site lives.
- **A plan outside `plan.pilot` and `plan.firm`.** `statement.client_month` is a note about the overage, not a thing to buy.

