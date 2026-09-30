import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  cancelLedger,
  createLedger,
  expireLedger,
  inspectLedger,
  reviseLedger,
} from "../_shared/goal-ledger.js";
import {
  decodeLedgerKey,
  LEDGER_SERVER_LIMITS,
  openLedgerToken,
  sealLedgerToken,
} from "../_shared/ledger-token.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED_USER_IDS = new Set(
  (Deno.env.get("OPERA_AGENT_MCP_USER_IDS") || "").split(",").map((value) => value.trim()).filter(Boolean),
);
const ALLOWED_USER_EMAILS = new Set(
  (Deno.env.get("OPERA_AGENT_MCP_USER_EMAILS") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rateWindows = new Map<string, { startedAt: number; mutations: number; reads: number }>();

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function bearer(req: Request) {
  return req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

async function authenticatedUser(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || (ALLOWED_USER_IDS.size === 0 && ALLOWED_USER_EMAILS.size === 0)) return null;
  const email = data.user.email?.toLowerCase() || "";
  return ALLOWED_USER_IDS.has(data.user.id) || ALLOWED_USER_EMAILS.has(email) ? data.user : null;
}

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: "STORAGE_ERROR" });
  return data as Record<string, unknown> | null;
}

function checkRate(userId: string, mutation: boolean) {
  const now = Date.now();
  let window = rateWindows.get(userId);
  if (!window || now - window.startedAt >= 60000) {
    window = { startedAt: now, mutations: 0, reads: 0 };
    rateWindows.set(userId, window);
  }
  const field = mutation ? "mutations" : "reads";
  window[field] += 1;
  const limit = mutation ? LEDGER_SERVER_LIMITS.mutationRequestsPerMinute : LEDGER_SERVER_LIMITS.readRequestsPerMinute;
  if (window[field] > limit) throw Object.assign(new Error("Ledger request rate exceeded."), { code: "RATE_LIMITED", status: 429 });
  if (rateWindows.size > 1000) {
    for (const [key, item] of rateWindows) if (now - item.startedAt >= 60000) rateWindows.delete(key);
  }
}

async function readBody(req: Request) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > LEDGER_SERVER_LIMITS.requestBytes) throw Object.assign(new Error("Request payload is too large."), { code: "OVER_LIMIT", status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > LEDGER_SERVER_LIMITS.requestBytes) throw Object.assign(new Error("Request payload is too large."), { code: "OVER_LIMIT", status: 413 });
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("Request body must be a JSON object."), { code: "INVALID_REQUEST", status: 400 });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function bindTenant(input: unknown, userId: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("ledger must be an object."), { code: "INVALID_REQUEST" });
  const ledger = input as Record<string, unknown>;
  if (ledger.tenantId !== undefined && ledger.tenantId !== userId) throw Object.assign(new Error("Cross-tenant ledger access is forbidden."), { code: "CROSS_TENANT", status: 403 });
  return { ...ledger, tenantId: userId };
}

async function cryptoKey() {
  const result = await rpc("opera_goal_crypto_key");
  if (!result?.enabled || typeof result.key !== "string") throw Object.assign(new Error("Milestone 6 ledger is disabled."), { code: "FEATURE_DISABLED", status: 503 });
  return decodeLedgerKey(result.key);
}

async function assertCurrentHead(ledger: Record<string, unknown>) {
  const head = await rpc("opera_goal_head_get", { p_tenant_id: ledger.tenantId, p_goal_id: ledger.goalId });
  if (!head?.ok) throw Object.assign(new Error(String(head?.error || "Ledger head was not found.")), { code: String(head?.code || "HEAD_NOT_FOUND"), status: 409 });
  if (head.headRevision !== ledger.revision || head.headDigest !== ledger.ledgerDigest || head.status !== ledger.status) {
    throw Object.assign(new Error("Ledger token does not match the current head."), { code: "STALE_HEAD", status: 409 });
  }
  return head;
}

async function applyHead(previous: Record<string, unknown> | null, next: Record<string, unknown>) {
  const result = await rpc("opera_goal_head_apply", {
    p_tenant_id: next.tenantId,
    p_goal_id: next.goalId,
    p_expected_revision: previous?.revision || 0,
    p_expected_digest: previous?.ledgerDigest || null,
    p_new_revision: next.revision,
    p_new_digest: next.ledgerDigest,
    p_new_status: next.status,
    p_created_at: next.createdAt,
    p_expires_at: next.expiresAt,
  });
  if (!result?.ok) throw Object.assign(new Error(String(result?.error || "Unable to update ledger head.")), { code: String(result?.code || "HEAD_UPDATE_FAILED"), status: 409 });
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return response({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
  const user = await authenticatedUser(req);
  if (!user) return response({ ok: false, error: { code: "UNAUTHORIZED", message: "A valid user access token is required." } }, 401);

  try {
    const body = await readBody(req);
    const operation = body.operation;
    const mutation = operation !== "inspect";
    checkRate(user.id, mutation);
    const key = await cryptoKey();
    const now = nowIso();

    if (operation === "open") {
      if (typeof body.requestId !== "string") throw Object.assign(new Error("requestId is required."), { code: "INVALID_REQUEST" });
      const candidate = bindTenant(body.ledger, user.id);
      const ledger = await createLedger(candidate, { now, authoritySource: "USER" });
      const token = await sealLedgerToken(ledger, key, { requestId: body.requestId, issuedAt: now });
      const head = await applyHead(null, ledger);
      return response({ ok: true, replayed: !!head.replayed, ledger: inspectLedger(ledger), token });
    }

    if (typeof body.token !== "string") throw Object.assign(new Error("token is required."), { code: "INVALID_REQUEST" });
    const allowExpired = operation === "expire";
    const opened = await openLedgerToken(body.token, key, { now, allowExpired });
    if (opened.ledger.tenantId !== user.id) throw Object.assign(new Error("Cross-tenant ledger access is forbidden."), { code: "CROSS_TENANT", status: 403 });

    if (operation === "inspect") {
      await assertCurrentHead(opened.ledger);
      return response({ ok: true, ledger: inspectLedger(opened.ledger) });
    }
    if (typeof body.requestId !== "string") throw Object.assign(new Error("requestId is required."), { code: "INVALID_REQUEST" });

    let ledger;
    if (operation === "revise") ledger = await reviseLedger(opened.ledger, body.revision, { now, authoritySource: "USER" });
    else if (operation === "cancel") ledger = await cancelLedger(opened.ledger, body.transition, { now });
    else if (operation === "expire") ledger = await expireLedger(opened.ledger, body.transition, { now });
    else throw Object.assign(new Error("Unsupported ledger operation."), { code: "INVALID_OPERATION", status: 400 });

    const token = await sealLedgerToken(ledger, key, { requestId: body.requestId, issuedAt: now });
    const head = await applyHead(opened.ledger, ledger);
    return response({ ok: true, replayed: !!head.replayed, ledger: inspectLedger(ledger), token });
  } catch (error) {
    const failure = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
    const code = typeof failure.code === "string" ? failure.code : "LEDGER_ERROR";
    const status = Number.isInteger(failure.status) ? Number(failure.status) : code === "CROSS_TENANT" ? 403 : code === "OVER_LIMIT" ? 413 : 400;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Ledger request failed.";
    return response({ ok: false, error: { code, message } }, status);
  }
});
