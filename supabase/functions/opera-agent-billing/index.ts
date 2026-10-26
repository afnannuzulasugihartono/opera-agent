// @last-edited: 2026-10-21 UTC+7.
// @title: opera-agent-billing — the invoice a customer opens, and the callback that closes it.
// @state: quotes a delivery into an amount, opens an invoice, serves it to its owner, marks it paid from a signed notification, and records a transfer by hand.
// @dependencies: edge-runtime, supabase-js, ../_shared/billing.js, ../_shared/cors.js, ../_shared/edge-log.js.

// WHY THIS FUNCTION EXISTS.
// The product sells a delivered client-month, and a sale that nobody can pay for is a demo.
// So the deliveries the manifest recorded are priced, the priced deliveries are written on an invoice, and the invoice is reachable by the person who owes it through a link that carries its own authority.

// WHY THE INVOICE IS SERVED HERE AND NOT FROM THE SITE.
// The link a customer gets has to keep working after the site is redeployed, and it has to work for a customer who has never seen the site.
// So the function serves the page, and the page is the invoice: the deliveries it charges for, the amount, and the way to pay.

// WHY THE NOTIFICATION IS THE ONLY WAY AN INVOICE BECOMES PAID.
// A browser could post "this invoice is paid" to this function, and so could a stranger.
// The provider's signature is computed with a key only the server holds, so only a real settlement can move the invoice.
// Without the key the callback refuses rather than trusting the caller.

// WHY THE CALLBACK DOES NOT ASK FOR AN "action" FIELD.
// A provider posts its own body to the URL it was given, so a notification is recognised by the order id and the signature it carries, not by a field the provider never sends.
// The operator's own calls still name their action, and the two shapes cannot be confused: one carries a signature, the other carries a bearer token.

// WHY THE CALLBACK ALSO CHECKS THE AMOUNT.
// A signature proves the provider sent the notification; it does not prove the invoice was for this much.
// So the gross amount in the notification has to equal the invoice once both are in cents, or the invoice stays open and the difference is somebody's problem to look at.

// WHY A PAID INVOICE IS NEVER REOPENED.
// Creating an invoice is idempotent so an operator can correct a month before it is paid, but the same upsert run after the money landed would turn a paid invoice back to open and ask the customer twice.
// So the paid state is terminal here, and a later call is refused with the invoice's name.

import "@supabase/edge-runtime";
import { createEdgeLog } from "../_shared/edge-log.js";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";
import {
  amountFor,
  invoiceToken,
  isSettled,
  linesFromDeliveries,
  manualSettlement,
  notificationSignatureValid,
  paidAmountCents,
  planInvoiceLines,
  providerAmount,
  providerOrderId,
  snapChargeRequest,
  snapPaymentMethods,
  snapRedirect,
  verifyInvoiceToken
} from "../_shared/billing.js";

type PriceRow = { kind: string; unit: string; amount_cents: number; currency: string; active: boolean };
type Line = { kind: string; unit?: string; description?: string | null; quantity: number; amountCents: number; reason?: string };
type InvoiceRow = {
  id: string;
  customer_id: string;
  period: string;
  status: string;
  amount_cents: number;
  currency: string;
  lines: { priced: Line[]; unpriced: Line[]; manual?: { note: string; at: string } };
  pay_url?: string | null;
  provider_order_id?: string | null;
};
type BillingClient = Awaited<ReturnType<typeof db>>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BILLING_SECRET = Deno.env.get("BILLING_SECRET") || "";
const BILLING_TOKEN = Deno.env.get("OPERA_BILLING_TOKEN") || "";
const MIDTRANS_SERVER_KEY = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
const MIDTRANS_ENVIRONMENT = Deno.env.get("MIDTRANS_ENVIRONMENT") || "production";

// The first customers pay by transfer; the account line is theirs to read, so it is configuration and never code.

const BILLING_BANK = Deno.env.get("BILLING_BANK") || "";
const log = createEdgeLog("opera-agent-billing");

let clientPromise: Promise<import("@supabase/supabase-js").SupabaseClient> | null = null;
function db() {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    }));
  }
  return clientPromise;
}

const money = (cents: number, currency: string): string => {
  const value = (Number(cents) || 0) / 100;
  return currency === 'IDR'
    ? `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
    : `${currency} ${value.toFixed(2)}`;
};

const escapeHtml = (value: unknown): string => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// WHY THE PAGE IS BUILT HERE AND NOT IN A TEMPLATE FILE.
// A template is a file the deploy has to carry, and this function is the thing that must never 500 on a customer who opens a link.
// One function, one page, no moving parts.

function invoicePage(invoice: InvoiceRow): string {
  const lines = (invoice.lines?.priced || []).map((line: Line) => `<tr><td>${escapeHtml(line.description || line.unit || line.kind)}</td><td>${line.quantity}</td><td>${escapeHtml(money(line.amountCents, invoice.currency))}</td></tr>`).join("");
  const unpriced = (invoice.lines?.unpriced || []).map((line: Line) => `<tr><td>${escapeHtml(line.description || line.kind)}</td><td colspan="2">not charged: ${escapeHtml(line.reason)}</td></tr>`).join("");
  const paid = invoice.status === 'paid';
  const manual = invoice.lines?.manual;
  const bank = !paid && !invoice.pay_url && BILLING_BANK
    ? `<p><small>${escapeHtml(BILLING_BANK)}</small></p>`
    : '';
  const pay = paid
    ? `<p class="paid">Paid. Thank you.</p>${manual ? `<p><small>Recorded by hand: ${escapeHtml(manual.note)} (${escapeHtml(manual.at)})</small></p>` : ''}`
    : invoice.pay_url
      ? `<p><a class="pay" href="${escapeHtml(invoice.pay_url)}">Pay ${escapeHtml(money(invoice.amount_cents, invoice.currency))}</a></p>`
      : `<p class="pay">Transfer ${escapeHtml(money(invoice.amount_cents, invoice.currency))} and quote invoice ${escapeHtml(invoice.id)}.</p>${bank}`;
  return `<!doctype html><meta charset="utf-8"><title>Invoice ${escapeHtml(invoice.id)}</title>
<style>
 body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;color:#111}
 h1{font-size:1.4rem} table{border-collapse:collapse;width:100%;margin:1rem 0}
 td,th{border-bottom:1px solid #ddd;padding:.5rem .4rem;text-align:left}
 .amount{font-size:1.3rem;font-weight:700} .pay a.pay{background:#1d4ed8;color:#fff;padding:.7rem 1.1rem;border-radius:.4rem;text-decoration:none}
 .paid{color:#0f7664;font-weight:700} small{color:#666}
</style>
<h1>Invoice ${escapeHtml(invoice.id)}</h1>
<p>${escapeHtml(invoice.customer_id)} &middot; period ${escapeHtml(invoice.period)} &middot; status ${escapeHtml(invoice.status)}</p>
<table><tr><th>What was delivered</th><th>Qty</th><th>Amount</th></tr>${lines}${unpriced}</table>
<p class="amount">Total ${escapeHtml(money(invoice.amount_cents, invoice.currency))}</p>
${pay}
<p><small>Only what was delivered is charged. A delivery that failed is not on this invoice.</small></p>`;
}

async function priceList(supabase: BillingClient): Promise<PriceRow[]> {
  const { data, error } = await supabase.from("opera_price_list").select("kind, unit, amount_cents, currency, active");
  if (error) throw new Error(`price list unreadable: ${error.message}`);
  return data || [];
}

async function createInvoice({ customer_id, period, lines }: { customer_id: string; period: string; lines: Line[] }): Promise<{ invoice: InvoiceRow; token: string }> {
  if (!BILLING_SECRET) throw new HttpError(500, "BILLING_SECRET is not set; invoices cannot be signed.");
  const supabase = await db();
  const prices = await priceList(supabase);
  const out = amountFor(lines, prices);
  // A plan is one price; if its row is missing, charging only the overage would undercharge the month and still look like a bill.
  if (out.unpriced.length && lines.some((line) => String(line.kind).startsWith("plan."))) {
    throw new HttpError(409, `the plan cannot be priced: ${out.unpriced.map((line) => line.kind).join(", ")}`);
  }
  const id = `${customer_id}:${period}`;
  const token = invoiceToken(id, BILLING_SECRET);

  // WHY THE PAID CHECK COMES BEFORE THE PROVIDER CALL.
  // Creating a payment link is the moment money can move.
  // If a paid invoice were priced and sent to the provider first, a later call would open a second payable transaction and then refuse to write it: the customer could pay twice and the database would never know.
  // So the row is read first, a paid invoice is refused before any provider call, and an unchanged open invoice keeps the link its customer already has.
  const { data: existing } = await supabase.from("opera_invoices").select("*").eq("id", id).maybeSingle();
  if (existing?.status === "paid") {
    throw new HttpError(409, `${id} is paid; a later call does not reopen an invoice that has been paid.`);
  }

  const payment = snapPaymentMethods(out.amountCents, out.currency);
  const unchanged = Boolean(existing)
    && Number(existing.amount_cents) === out.amountCents
    && existing.currency === out.currency;
  let pay_url = unchanged ? existing?.pay_url || null : null;
  let provider = unchanged ? existing?.provider || null : null;
  let provider_ref = unchanged ? existing?.provider_ref || null : null;
  let provider_order_id = unchanged ? existing?.provider_order_id || null : null;

  if (MIDTRANS_SERVER_KEY && payment.chargeable && !pay_url) {
    const orderId = providerOrderId(id, out.amountCents, out.currency);
    const charge = snapChargeRequest({
      orderId,
      amountCents: out.amountCents,
      currency: out.currency,
      customerId: customer_id,
      enabled: payment.enabled,
      serverKey: MIDTRANS_SERVER_KEY,
      environment: MIDTRANS_ENVIRONMENT
    });
    if (charge) {
      const response = await fetch(charge.url, { method: charge.method, headers: charge.headers, body: charge.body });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const redirect = response.ok ? snapRedirect(body) : null;

      // WHY A REFUSED CHARGE IS WRITTEN DOWN.
      // A charge the provider turns away leaves the invoice with no pay button and a transfer instruction instead, and nothing in the answer says why.
      // Measured live: a key that did not belong to the host it was sent to produced exactly that silence, and the only way to tell "no key" from "key refused" was a log.
      // The status and the provider's own words are logged; the key never is.
      if (!redirect) {
        // WHY THE WHOLE ANSWER IS WRITTEN, NOT ONE FIELD OF IT.
        // The first version read error_messages and status_message, and Midtrans answered {"error":"Unauthorized"} instead, so the log said "no redirect and no token" and named nothing.
        // The provider's own words are the diagnosis, so the body is written down as it came; the key never is.
        const why = JSON.stringify(body).slice(0, 300);
        log.warn("SNAP_CHARGE_REFUSED", JSON.stringify({
          orderId,
          status: response.status,
          environment: charge.url.includes("sandbox") ? "sandbox" : "production",
          why
        }));
      }
      if (redirect) {
        pay_url = redirect.payUrl;
        provider = "midtrans";
        provider_ref = redirect.token || orderId;
        provider_order_id = orderId;
      }
    }
  }
  const { data, error } = await supabase.from("opera_invoices").upsert({
    id,
    customer_id,
    period,
    status: "open",
    amount_cents: out.amountCents,
    currency: out.currency,
    lines: { priced: out.priced, unpriced: out.unpriced },
    provider,
    provider_ref,
    provider_order_id,
    pay_url
  }, { onConflict: "id" }).select().single();
  if (error) throw new Error(`invoice not written: ${error.message}`);
  return { invoice: data, token };
}

// WHY A TRANSFER IS RECORDED WITH THE SAME CARE AS A CALLBACK.
// The money can arrive before a provider account exists, and the ledger still has to show who confirmed it and when.
// The note is stored on the invoice itself, so the page the customer already holds shows the same record the operator sees.

async function settleManual({ invoice_id, amount_cents, note }: { invoice_id: string; amount_cents?: unknown; note?: unknown }): Promise<InvoiceRow> {
  const supabase = await db();
  const { data: invoice, error } = await supabase.from("opera_invoices").select("*").eq("id", invoice_id).maybeSingle();
  if (error) throw new Error(`invoice unreadable: ${error.message}`);
  const check = manualSettlement(invoice, {
    amountCents: amount_cents === undefined || amount_cents === null || amount_cents === "" ? null : Number(amount_cents),
    note
  });
  if (!check.ok) throw new HttpError(409, check.why);
  const text = String(note || "").trim();
  const at = new Date().toISOString();
  const { data, error: updateError } = await supabase.from("opera_invoices")
    .update({
      status: "paid",
      paid_at: at,
      provider: invoice.provider || "manual",
      lines: { ...(invoice.lines || {}), manual: { note: text, at } }
    })
    .eq("id", invoice.id)
    .eq("status", "open")
    .select()
    .maybeSingle();
  if (updateError) throw new Error(`invoice not closed: ${updateError.message}`);
  if (!data) throw new HttpError(409, "the invoice changed while it was being settled; check it and try again");
  return data;
}

async function readInvoice(invoiceId: string, token: string): Promise<InvoiceRow> {
  if (!verifyInvoiceToken(invoiceId, token, BILLING_SECRET)) throw new HttpError(401, "that link does not open that invoice.");
  const supabase = await db();
  const { data, error } = await supabase.from("opera_invoices").select("*").eq("id", invoiceId).single();
  if (error || !data) throw new HttpError(404, "no such invoice.");
  return data;
}

// WHY THE CALLBACK RE-CHECKS THE AMOUNT.
// A signature proves the provider sent the notification; it does not prove the invoice was for this much.
// So the gross amount in the notification has to equal the invoice once both are in cents, or the invoice stays open and the difference is somebody's problem to look at.

async function markPaid(notification: Record<string, unknown>): Promise<{ ok: boolean; why?: string; invoice?: string }> {
  const supabase = await db();
  const orderId = String(notification.order_id || "");

  // WHY THE LOOKUP TRIES THE PROVIDER ID FIRST.
  // The id a person reads ("Toko Sinar Jaya:2026-08") contains characters the provider refuses, so the transaction carries a derived id.
  // The invoice id is still accepted for a notification signed by hand and for invoices written before the derived id existed.
  const byProvider = await supabase.from("opera_invoices").select("*").eq("provider_order_id", orderId).maybeSingle();
  let invoice = byProvider.data;
  if (!invoice) {
    const byId = await supabase.from("opera_invoices").select("*").eq("id", orderId).maybeSingle();
    invoice = byId.data;
  }
  if (!invoice) return { ok: false, why: "no invoice with that order id" };
  if (!isSettled(notification)) return { ok: false, why: "the transaction is not settled" };
  const paidCents = paidAmountCents(notification.gross_amount, invoice.currency);
  if (paidCents === null || paidCents !== Number(invoice.amount_cents)) {
    return { ok: false, why: `the paid amount (${String(notification.gross_amount)}) is not the invoice amount (${invoice.amount_cents} cents)` };
  }
  const { error: updateError } = await supabase.from("opera_invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", invoice.id);
  if (updateError) throw new Error(`invoice not closed: ${updateError.message}`);
  return { ok: true, invoice: invoice.id };
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers }
});

Deno.serve(async (req: Request) => {
  const cors = {
    "access-control-allow-origin": resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS) || "",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store"
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const invoiceId = url.searchParams.get("invoice_id") || "";
      const token = url.searchParams.get("token") || "";
      if (!invoiceId || !token) return json({ error: "invoice_id and token are required" }, 400, cors);
      const invoice = await readInvoice(invoiceId, token);
      if (url.searchParams.get("format") === "json") return json({ invoice }, 200, cors);
      return new Response(invoicePage(invoice), { headers: { "content-type": "text/html; charset=utf-8", ...cors } });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const looksLikeNotification = body.action === "notify" || (!body.action && Boolean(body.order_id) && Boolean(body.signature));
      if (looksLikeNotification) {
        const notification = body as Record<string, unknown>;
        if (!notificationSignatureValid(notification, MIDTRANS_SERVER_KEY)) {
          return json({ ok: false, error: "the notification was not signed by the provider" }, 400, cors);
        }
        const out = await markPaid(notification);
        return json(out, out.ok ? 200 : 400, cors);
      }
      if (body.action === "settle-manual") {
        const token = req.headers.get("authorization") || "";
        if (!BILLING_TOKEN || token !== `Bearer ${BILLING_TOKEN}`) {
          return json({ error: "the operator token is missing or wrong" }, 401, cors);
        }
        const invoiceId = String(body.invoice_id || "");
        if (!invoiceId) return json({ error: "invoice_id is required" }, 400, cors);
        const invoice = await settleManual({ invoice_id: invoiceId, amount_cents: body.amount_cents, note: body.note });
        return json({ ok: true, invoice }, 200, cors);
      }
      if (body.action === "invoice") {
        const token = req.headers.get("authorization") || "";
        if (!BILLING_TOKEN || token !== `Bearer ${BILLING_TOKEN}`) {
          return json({ error: "the operator token is missing or wrong" }, 401, cors);
        }
        const customerId = String(body.customer_id || "");
        const period = String(body.period || "");
        if (!customerId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
          return json({ error: "customer_id and a YYYY-MM period are required" }, 400, cors);
        }
        const typed = Array.isArray(body.lines) ? body.lines as Line[] : [];
        const deliveries = Array.isArray(body.deliveries) ? body.deliveries as Record<string, unknown>[] : [];
        const plan = String(body.plan || "");
        if (typed.length && deliveries.length) {
          return json({ error: "send either the manifest rows or the lines, not both: the amount has one source" }, 400, cors);
        }
        if (plan && typed.length) {
          return json({ error: "send either a plan and its deliveries, or typed lines, not both" }, 400, cors);
        }
        if (plan && !deliveries.length) {
          return json({ error: "a plan invoice needs at least one delivered client-month; a month nobody delivered is not charged" }, 400, cors);
        }
        let lines = typed;
        if (plan) {
          const derived = planInvoiceLines(deliveries, plan, period);
          if (derived.refused.length) {
            return json({ error: "the plan cannot be billed", refused: derived.refused.map((row) => row.reason) }, 400, cors);
          }
          lines = derived.lines;
        } else if (deliveries.length) {
          const derived = linesFromDeliveries(deliveries);
          if (derived.refused.length) {
            return json({ error: "some deliveries cannot be billed", refused: derived.refused.map((row) => row.reason) }, 400, cors);
          }
          lines = derived.lines;
        }
        if (!lines.length) return json({ error: "no deliveries to charge for" }, 400, cors);
        const out = await createInvoice({ customer_id: customerId, period, lines });
        const link = `${SUPABASE_URL}/functions/v1/opera-agent-billing?invoice_id=${encodeURIComponent(out.invoice.id)}&token=${out.token}`;
        return json({ invoice: out.invoice, url: link }, 200, cors);
      }
      return json({ error: "unknown action" }, 400, cors);
    }
    return json({ error: "method not allowed" }, 405, cors);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpError ? error.status : 500;
    log.error("BILLING_FAILED", why);
    return json({ error: why }, status, cors);
  }
});
