// @last-edited: 2026-10-26 UTC+7.
// @title: opera-agent-billing — the invoice a customer opens, and the callback that closes it.
// @state: quotes a delivery into an amount, opens one payable transaction per invoice, serves the page in the state the row is in, closes it from a signed notification or the provider's own answer, records a transfer by hand, and opens a new link when the customer asks.
// @dependencies: edge-runtime, supabase-js, ../_shared/billing.js, ../_shared/invoice-page.js, ../_shared/cors.js, ../_shared/edge-log.js.

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
// Creating an invoice is idempotent so an operator can correct a month before it is paid, but the same write run after the money landed would turn a paid invoice back to open and ask the customer twice.
// So the paid state is terminal here, and a later call is refused with the invoice's name.

import "@supabase/edge-runtime";
import { createEdgeLog } from "../_shared/edge-log.js";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";
import { invoicePage } from "../_shared/invoice-page.js";
import {
  amountFor,
  invoiceToken,
  isSettled,
  linesFromDeliveries,
  manualSettlement,
  needsClosing,
  notificationAcknowledged,
  notificationSignatureValid,
  paidAmountCents,
  planInvoiceLines,
  providerOrderId,
  providerSettlement,
  snapChargeRequest,
  snapPaymentMethods,
  snapRedirect,
  secretShape,
  snapExpireRequest,
  snapStatusRequest,
  verifyInvoiceToken,
  PAY_LINK_EXPIRY,
  payLinkDeadline,
  payLinkState
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
  pay_url_expires_at?: string | null;
  provider?: string | null;
  provider_ref?: string | null;
  provider_order_id?: string | null;
  provider_order_ids?: string[] | null;
  paid_at?: string | null;
  paid_method?: string | null;
  provider_transaction_id?: string | null;
};
type Link = {
  pay_url: string | null;
  pay_url_expires_at: string | null;
  provider: string | null;
  provider_ref: string | null;
  provider_order_id: string | null;
  provider_order_ids: string[];
};
type AttemptClose =
  | { state: "none" }
  | { state: "paid"; status: string; grossAmount: string; paymentType: string; transactionId: string }
  | { state: "closed"; status: string }
  | { state: "refused"; why: string };
type BillingClient = Awaited<ReturnType<typeof db>>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BILLING_SECRET = Deno.env.get("BILLING_SECRET") || "";
const BILLING_TOKEN = Deno.env.get("OPERA_BILLING_TOKEN") || "";

// WHY THE KEY IS KEPT EXACTLY AS IT WAS STORED.
// The signature is computed over this value, so the value is not adjusted here: which reading of it signs is measured against each notification and named in the log.
// A sanitised copy would make the check pass and destroy the evidence that the stored secret needs fixing.

const MIDTRANS_SERVER_KEY = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
const KEY_SHAPE = secretShape(MIDTRANS_SERVER_KEY);
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

// WHY THE BODY IS READ BY ITS CONTENT TYPE.
// The operator and the provider post JSON, and the customer's refresh form is a browser form, which posts urlencoded fields.
// A body that cannot be parsed is an empty object, so a malformed request falls through to "unknown action" instead of a 500 that says nothing about the request.

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData().catch(() => null);
    if (!form) return {};
    const body: Record<string, unknown> = {};
    for (const [name, value] of form.entries()) {
      if (typeof value === "string") body[name] = value;
    }
    return body;
  }
  return await req.json().catch(() => ({})) as Record<string, unknown>;
}

// WHY THE PAGE'S HEADERS SAY WHAT THE PAGE MAY DO.
// The page carries a token in its body, so it must not be cached, must not leak the link that opened it as a referrer, and must not be framed by another site.
// The policy allows the inline styles the page needs and nothing else: no script, no font, no image, and a form that can only post back to this function.
// The CORS map already carries cache-control, so the merge keeps one value for it rather than two spellings of the same rule.

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

async function priceList(supabase: BillingClient): Promise<PriceRow[]> {
  const { data, error } = await supabase.from("opera_price_list").select("kind, unit, amount_cents, currency, active");
  if (error) throw new Error(`price list unreadable: ${error.message}`);
  return data || [];
}

async function readInvoice(invoiceId: string, token: string): Promise<InvoiceRow> {
  if (!verifyInvoiceToken(invoiceId, token, BILLING_SECRET)) throw new HttpError(401, "that link does not open that invoice.");
  const supabase = await db();
  const { data, error } = await supabase.from("opera_invoices").select("*").eq("id", invoiceId).single();
  if (error || !data) throw new HttpError(404, "no such invoice.");
  return data;
}

// WHY A RETRY ASKS THE PROVIDER WHAT THE OLD ATTEMPT IS BEFORE OPENING A NEW ONE.
// A timer is not the provider: the stored deadline says when the link should die, and only the provider knows whether a customer already paid through it.
// So the old attempt is looked up, a settlement closes the invoice through the same amount check as a notification, and a pending attempt is expired at the provider before another charge is opened.
// A refusal - no key, a network answer, a status this function does not understand - leaves the invoice as it was: opening a second payable transaction on a guess is the one mistake that costs a customer money.
// The expire answer is read past its HTTP status: Midtrans documents a 200 whose body carries status_code 412 and "Merchant cannot modify the status of the transaction", which is a refusal in the shape of a success.
// A success carries 407 and transaction_status expire, so the one code that means "not closed" is checked instead of the code that means "settled".
// Treating that 412 as closed would open a second payable transaction beside one the provider refused to kill.

async function closeAttempt(orderId: string | null | undefined): Promise<AttemptClose> {
  if (!orderId) return { state: "none" };
  const request = snapStatusRequest({ orderId, serverKey: MIDTRANS_SERVER_KEY, environment: MIDTRANS_ENVIRONMENT });
  if (!request) return { state: "none" };
  let response: Response;
  let payload: Record<string, unknown> | null;
  try {
    response = await fetch(request.url, { method: request.method, headers: request.headers });
    payload = await response.json().catch(() => null);
  } catch (error) {
    return { state: "refused", why: `the provider could not be asked: ${(error as Error).message}` };
  }
  if (!response.ok) {
    if (response.status === 404) return { state: "closed", status: "not found" };
    return { state: "refused", why: `the provider answered ${response.status} when asked about that order` };
  }
  if (!payload) return { state: "refused", why: "the provider answered with a body that is not JSON" };
  const answer = providerSettlement(payload);
  if (answer.settled) {
    return { state: "paid", status: answer.status, grossAmount: answer.grossAmount, paymentType: answer.paymentType, transactionId: answer.transactionId };
  }
  const status = String(answer.status || "").toLowerCase();
  if (["expire", "deny", "cancel", "failure"].includes(status)) return { state: "closed", status };
  if (status !== "pending") {
    return { state: "refused", why: `the provider reports ${answer.status || "nothing"} for that order` };
  }
  const expire = snapExpireRequest({ orderId, serverKey: MIDTRANS_SERVER_KEY, environment: MIDTRANS_ENVIRONMENT });
  if (!expire) return { state: "refused", why: "the expire request could not be built" };
  try {
    const closed = await fetch(expire.url, { method: expire.method, headers: expire.headers });
    const body = await closed.json().catch(() => null) as Record<string, unknown> | null;
    if (closed.ok && String(body?.status_code || "") !== "412") return { state: "closed", status: "expired" };
    return { state: "refused", why: `the provider answered ${closed.status} to the expire request${body ? `: ${JSON.stringify(body).slice(0, 200)}` : ""}` };
  } catch (error) {
    return { state: "refused", why: `the expire request failed: ${(error as Error).message}` };
  }
}

// WHY THE ATTEMPT NUMBER IS COUNTED FROM THE ARRAY.
// The array holds every attempt this invoice opened, so its length is the number of the next one, and the scalar counts as one even when a row predates the array.
// Counting past a legacy scalar matters: reusing the id of an attempt that was just closed asks the provider for a transaction it already knows.

function nextAttempt(invoice: InvoiceRow): number {
  const opened = Array.isArray(invoice.provider_order_ids)
    ? invoice.provider_order_ids.filter((id) => typeof id === "string" && id)
    : [];
  return Math.max(opened.length, invoice.provider_order_id ? 1 : 0) + 1;
}

// WHY A REFUSED CHARGE IS WRITTEN DOWN.
// A charge the provider turns away leaves the invoice with no pay button and a transfer instruction instead, and nothing in the answer says why.
// Measured live: a key that did not belong to the host it was sent to produced exactly that silence, and the only way to tell "no key" from "key refused" was a log.
// The status and the provider's own words are logged; the key never is.
// The whole answer is written, not one field of it: Midtrans answered {"error":"Unauthorized"} once, and the log that read only error_messages named nothing.

async function openNewAttempt(invoice: InvoiceRow, { customerId }: { customerId: string }): Promise<Link | null> {
  const previous = invoice.provider_order_id || null;
  if (previous) {
    const closed = await closeAttempt(previous);
    if (closed.state === "paid") {
      const settled = await markPaid({
        order_id: previous,
        gross_amount: closed.grossAmount,
        transaction_status: closed.status,
        payment_type: closed.paymentType,
        transaction_id: closed.transactionId
      });
      throw new HttpError(409, `${invoice.id} has just been paid${settled.ok ? "" : `, and the record could not be closed: ${settled.why}`}; no second charge was opened.`);
    }
    if (closed.state === "refused") {
      throw new HttpError(409, `the previous payment link could not be closed: ${closed.why}`);
    }
  }
  const attempt = nextAttempt(invoice);
  const orderId = providerOrderId(invoice.id, Number(invoice.amount_cents), invoice.currency, attempt);
  const payment = snapPaymentMethods(invoice.amount_cents, invoice.currency);
  const charge = snapChargeRequest({
    orderId,
    amountCents: Number(invoice.amount_cents),
    currency: invoice.currency,
    customerId: customerId,
    enabled: payment.enabled,
    serverKey: MIDTRANS_SERVER_KEY,
    environment: MIDTRANS_ENVIRONMENT,
    expiry: PAY_LINK_EXPIRY
  });
  if (!charge) return null;
  const response = await fetch(charge.url, { method: charge.method, headers: charge.headers, body: charge.body });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const redirect = response.ok ? snapRedirect(body) : null;
  if (!redirect) {
    log.warn("SNAP_CHARGE_REFUSED", JSON.stringify({
      orderId,
      attempt,
      status: response.status,
      environment: charge.url.includes("sandbox") ? "sandbox" : "production",
      why: JSON.stringify(body).slice(0, 300)
    }));
    return null;
  }
  const history = Array.isArray(invoice.provider_order_ids) ? invoice.provider_order_ids.filter((id) => typeof id === "string" && id) : [];
  return {
    pay_url: redirect.payUrl,
    pay_url_expires_at: payLinkDeadline(),
    provider: "midtrans",
    provider_ref: redirect.token || orderId,
    provider_order_id: orderId,
    provider_order_ids: [...history, orderId]
  };
}

// WHY A PAID ROW IS NOT WRITTEN BY A CREATE THAT RACED THE PAYMENT.
// The paid check happens before the provider call because opening a link is the moment money can move, and that call takes time.
// So a write over an existing row is guarded by paid_at is null: a payment that landed in between leaves the row paid and this call answers 409 instead of turning it back to open.
// A new invoice has no payment to race, so it is inserted with on conflict so two operators creating the same month write one row.

async function writeInvoice(row: Record<string, unknown>, existing: InvoiceRow | null): Promise<InvoiceRow> {
  const supabase = await db();
  if (!existing) {
    const { data, error } = await supabase.from("opera_invoices").upsert(row, { onConflict: "id" }).select().single();
    if (error) throw new Error(`invoice not written: ${error.message}`);
    return data;
  }
  const { id, ...fields } = row;
  const { data, error } = await supabase.from("opera_invoices")
    .update(fields)
    .eq("id", String(id))
    .is("paid_at", null)
    .select()
    .maybeSingle();
  if (error) throw new Error(`invoice not written: ${error.message}`);
  if (!data) throw new HttpError(409, `${String(id)} was paid while its payment link was being opened; nothing was written over it.`);
  return data;
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

  // WHY A LINK IS REUSED ONLY WHILE IT IS ALIVE.
  // An idempotent invoice_create must not kill a customer's live QR, so an unchanged amount and currency keep the link and the deadline the row already carries.
  // An expired link is not reused, because the page would have to render a Pay button the provider will refuse.
  // A legacy row with no stored deadline is "unknown" and is kept: it has a link, it may still work, and replacing it would be the create path deciding something nobody measured.

  const payment = snapPaymentMethods(out.amountCents, out.currency);
  const unchanged = Boolean(existing)
    && Number(existing.amount_cents) === out.amountCents
    && existing.currency === out.currency;
  const state = existing ? payLinkState(existing) : "none";
  const history = Array.isArray(existing?.provider_order_ids)
    ? existing.provider_order_ids.filter((orderId) => typeof orderId === "string" && orderId)
    : [];
  let link: Link = {
    pay_url: null,
    pay_url_expires_at: null,
    provider: null,
    provider_ref: null,
    provider_order_id: null,
    provider_order_ids: history
  };
  if (unchanged && (state === "live" || state === "unknown")) {
    link = {
      pay_url: existing?.pay_url || null,
      pay_url_expires_at: existing?.pay_url_expires_at || null,
      provider: existing?.provider || null,
      provider_ref: existing?.provider_ref || null,
      provider_order_id: existing?.provider_order_id || null,
      provider_order_ids: history
    };
  } else if (MIDTRANS_SERVER_KEY && payment.chargeable) {
    const opened = await openNewAttempt(existing ?? {
      id,
      customer_id,
      period,
      status: "open",
      amount_cents: out.amountCents,
      currency: out.currency,
      lines: { priced: out.priced, unpriced: out.unpriced }
    }, { customerId: customer_id });
    if (opened) link = opened;
  }

  const data = await writeInvoice({
    id,
    customer_id,
    period,
    status: "open",
    amount_cents: out.amountCents,
    currency: out.currency,
    lines: { priced: out.priced, unpriced: out.unpriced },
    ...link
  }, existing ?? null);
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

// WHY EVERY NOTIFICATION IS WRITTEN DOWN BEFORE IT IS JUDGED.
// A notification is the only thing that closes an invoice, so "the invoice is still open" had two completely different causes and no way to tell them apart: the provider never reached the endpoint, or it reached the endpoint and the endpoint refused what it sent.
// Measured on 2026-10-26: the provider's history showed eleven notifications, every one marked undelivered, and nothing in the function said which of the two it was.
// The row is written before the answer is returned; the signature value is never stored, because which field carried it is what separates a contract mismatch from a bad secret.
// The write is an instrument, never a gate: a failed insert must not change the answer the provider gets, so a failure is reported by its absence instead.

async function noteNotification(
  notification: Record<string, unknown>,
  signatureField: string | null,
  accepted: boolean,
  why: string,
  req: Request
): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("opera_notification_log").insert({
      order_id: String(notification.order_id || ""),
      transaction_status: String(notification.transaction_status || ""),
      status_code: String(notification.status_code || ""),
      gross_amount: String(notification.gross_amount || ""),
      signature_field: signatureField,
      accepted,
      why: String(why || "").slice(0, 300),
      environment: MIDTRANS_ENVIRONMENT,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 200)
    });
  } catch {
    return;
  }
}

// WHY A REFUSED SIGNATURE BECOMES A QUESTION TO THE PROVIDER.
// A signature that does not match has causes that look identical from the body: it was not signed by the provider, or it was signed with a secret other than the one stored here.
// Measured live on 2026-10-26: real notifications arrived from the provider's own user agent with the right order id and amount, and every one was refused; the body could not say why, and the cause turned out to be this module's own formula.
// The provider records the transaction, so asking it what happened is a stronger proof than the body: the answer is about its own transaction, never about the claim in the request.
// It stays as the answer to a refusal now that the formula matches, because a rotated key and a forged body must both end somewhere honest.
// The status code and the key never leave the function; only the settlement and the amount it reports come back.

async function providerSaysSettled(orderId: string): Promise<{ settled: boolean; status: string; grossAmount: string; paymentType: string; transactionId: string; why: string }> {
  const empty = { settled: false, status: "", grossAmount: "", paymentType: "", transactionId: "" };
  const request = snapStatusRequest({ orderId, serverKey: MIDTRANS_SERVER_KEY, environment: MIDTRANS_ENVIRONMENT });
  if (!request) return { ...empty, why: "there is no order id to ask about" };
  try {
    const response = await fetch(request.url, { method: request.method, headers: request.headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { ...empty, why: `the provider answered ${response.status} when asked about that order` };
    }
    const answer = providerSettlement(payload);
    return { ...answer, why: `the provider reports ${answer.status || "nothing"} for that order` };
  } catch (error) {
    return { ...empty, why: `the provider could not be asked: ${(error as Error).message}` };
  }
}

// WHY THE CALLBACK RE-CHECKS THE AMOUNT.
// A signature proves the provider sent the notification; it does not prove the invoice was for this much.
// So the gross amount in the notification has to equal the invoice once both are in cents, or the invoice stays open and the difference is somebody's problem to look at.

// WHY A PAID INVOICE IS NOT PAID AGAIN.
// The provider sends the same outcome more than once, and a late notification can arrive after the one that closed the invoice.
// Measured live on 2026-10-26: a settlement closed the invoice at 08:55:13 and a pending notification arrived eleven seconds later, moving paid_at to 08:55:24.
// The moment money landed is evidence, and a second notification must not rewrite it.

// WHY THE NOTIFICATION FINDS THE INVOICE BY ANY ATTEMPT IT OPENED.
// A retry opens a new order id, so a settlement for the first attempt carries an id that is no longer the current one.
// The array holds every attempt, and containment finds the invoice whichever attempt the provider is talking about; the scalar would only find the last one.
// The invoice id is still accepted after that, for a notification signed by hand and for an invoice written before a derived id existed.

async function invoiceForOrder(orderId: string): Promise<InvoiceRow | null> {
  const supabase = await db();
  const byAttempt = await supabase.from("opera_invoices").select("*").contains("provider_order_ids", [orderId]).maybeSingle();
  if (byAttempt.data) return byAttempt.data;
  const byId = await supabase.from("opera_invoices").select("*").eq("id", orderId).maybeSingle();
  return byId.data || null;
}

// WHY A TERMINAL NOTIFICATION CLEARS ONLY THE CURRENT LINK.
// The provider says expire, deny, cancel or failure about the transaction it is naming, and an invoice may have opened several.
// Clearing the link a customer is holding because an older attempt died would take away the one way to pay that still works.
// So the row is left open and only the current attempt's link is removed; a pending or settled notification never clears a link, because one means money may still arrive and the other means it did.

async function markPaid(notification: Record<string, unknown>): Promise<{ ok: boolean; why?: string; invoice?: string; retry?: boolean }> {
  const supabase = await db();
  const orderId = String(notification.order_id || "");
  const invoice = await invoiceForOrder(orderId);
  if (!invoice) return { ok: false, why: "no invoice with that order id" };

  if (!isSettled(notification)) {
    const status = String(notification.transaction_status || notification.status || "").toLowerCase();
    const terminal = ["expire", "deny", "cancel", "failure"].includes(status);
    const current = String(invoice.provider_order_id || "") === orderId;
    if (terminal && current) {
      const { error } = await supabase.from("opera_invoices")
        .update({ pay_url: null, pay_url_expires_at: null })
        .eq("id", invoice.id)
        .eq("status", "open");
      if (error) throw new Error(`the payment link was not cleared: ${error.message}`);
      return { ok: false, why: "the transaction is not settled; the provider closed the current payment link", retry: false };
    }
    return { ok: false, why: "the transaction is not settled", retry: false };
  }

  const paidCents = paidAmountCents(notification.gross_amount, invoice.currency);
  if (paidCents === null || paidCents !== Number(invoice.amount_cents)) {
    return { ok: false, why: `the paid amount (${String(notification.gross_amount)}) is not the invoice amount (${invoice.amount_cents} cents)` };
  }
  if (!needsClosing(invoice)) {
    return { ok: true, invoice: invoice.id, why: `the invoice was already paid at ${invoice.paid_at}` };
  }
  const paidMethod = String(notification.payment_type || "").trim();
  const transactionId = String(notification.transaction_id || "").trim();
  const { data: closed, error: updateError } = await supabase.from("opera_invoices")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_method: paidMethod || null,
      provider_transaction_id: transactionId || null
    })
    .eq("id", invoice.id)
    .is("paid_at", null)
    .select("id");
  if (updateError) throw new Error(`invoice not closed: ${updateError.message}`);
  if (!closed || closed.length === 0) return { ok: true, invoice: invoice.id, why: "another notification closed the invoice first" };
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
      const canRefresh = Boolean(MIDTRANS_SERVER_KEY)
        && snapPaymentMethods(invoice.amount_cents, invoice.currency).chargeable;
      return new Response(invoicePage(invoice, {
        token,
        bank: BILLING_BANK,
        canRefresh,
        refreshFailed: url.searchParams.get("refresh") === "failed"
      }), { headers: pageHeaders(cors) });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      // WHY A NOTIFICATION IS RECOGNISED BY THE ORDER AND THE STATUS CODE.
      // Recognition used to demand a signature field, so a provider payload whose signature arrived under a different name fell through to "unknown action" and left no trace anywhere.
      // What makes a body a notification is what the provider says happened; whether it is believed is a separate question, answered by the signature.
      const looksLikeNotification = body.action === "notify"
        || (!body.action && Boolean(body.order_id) && Boolean(body.status_code));
      if (looksLikeNotification) {
        const notification = body as Record<string, unknown>;
        const signatureField = notification.signature_key != null
          ? "signature_key"
          : notification.signature != null ? "signature" : null;
        const signed = notificationSignatureValid(notification, MIDTRANS_SERVER_KEY);
        let judged = notification;
        let source = "the provider signed it";
        if (!signed) {
          const provider = await providerSaysSettled(String(notification.order_id || ""));
          if (!provider.settled) {
            await noteNotification(notification, signatureField, false, `the signature did not match (${KEY_SHAPE}) and ${provider.why}`, req);
            return json({ ok: false, error: "the notification was not signed by the provider" }, 400, cors);
          }
          judged = {
            order_id: notification.order_id,
            gross_amount: provider.grossAmount,
            transaction_status: provider.status,
            payment_type: provider.paymentType,
            transaction_id: provider.transactionId
          };
          source = `the signature did not match (${KEY_SHAPE}) and ${provider.why}`;
        }
        const out = await markPaid(judged);
        await noteNotification(notification, signatureField, out.ok, `${source}; ${out.why || "the invoice is closed"}`, req);

        return json(out, notificationAcknowledged(out) ? 200 : 400, cors);
      }

      // WHY THE REFRESH FORM IS A POST AND NOT A LINK.
      // A link that opens a payable transaction can be fired by a prefetcher, a mail scanner or a stray click, and every one of those would open a new charge.
      // A POST carries the token from the form body, verifies it exactly as the page did, and answers with a redirect so a reload cannot post again.
      // The customer never sees the provider's words: a refusal is one line on the page, and the reason is written to the log.

      if (body.action === "refresh-payment") {
        const invoiceId = String(body.invoice_id || "");
        const token = String(body.token || "");
        const page = new URL(req.url);
        page.search = new URLSearchParams({ invoice_id: invoiceId, token }).toString();
        const invoice = await readInvoice(invoiceId, token);
        const status = String(invoice.status || "");
        let failed = false;
        if (status !== "paid" && status !== "void" && payLinkState(invoice) !== "live") {
          if (MIDTRANS_SERVER_KEY && snapPaymentMethods(invoice.amount_cents, invoice.currency).chargeable) {
            try {
              const opened = await openNewAttempt(invoice, { customerId: invoice.customer_id });
              if (opened) {
                const supabase = await db();
                const { error } = await supabase.from("opera_invoices")
                  .update(opened)
                  .eq("id", invoice.id)
                  .is("paid_at", null);
                if (error) throw new Error(`invoice not written: ${error.message}`);
              } else {
                failed = true;
              }
            } catch (error) {
              if (!(error instanceof HttpError && error.status === 409)) throw error;
              log.warn("PAYMENT_REFRESH_REFUSED", error.message);
              failed = true;
            }
          } else {
            failed = true;
          }
        }
        if (failed) page.searchParams.set("refresh", "failed");
        return new Response(null, { status: 303, headers: { location: `${page.pathname}${page.search}`, ...cors } });
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
