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
