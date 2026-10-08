// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: index — Repository file.
// @state: retry Chrome's transient tab-drag refusal on all tab mutations.
// @dependencies: edge-runtime, supabase-js, edge-log.

import "@supabase/edge-runtime";
import { createClient } from "@supabase/supabase-js";
import { createEdgeLog } from "../_shared/edge-log.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store"
};

const MAX_BODY = 1024 * 1024;

// WHY the wait lives in Postgres: client-side polling minted ~52
// `opera_claim_next` calls per 12s window (~13k/hour/device, 95% of all edge
// traffic) and a new command waited p50 830ms / p95 1910ms, of which ~97% was
// spent at the idle rate. One `opera_claim_next_wait` per window cut that to a
// single round trip while the DB owns the wait. Recorded figures and the
// rejected ramp live in `tests/efficiency.test.mjs`.

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
  });
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);
}

function validDeviceName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 64;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function pair(body: Record<string, unknown>) {
  if (typeof body.code !== "string" || body.code.trim().length < 8 || body.code.length > 64) {
    return json({ ok: false, error: "Invalid pairing code." }, 400);
  }
  if (!validToken(body.token) || !validDeviceName(body.deviceName)) {
    return json({ ok: false, error: "Invalid pairing request." }, 400);
  }
  const browserName = typeof body.browserName === "string" ? body.browserName.trim().slice(0, 64) : "";
  const result = await rpc("opera_pair_device", {
    p_code: body.code.trim(),
    p_token_hash: await sha256(body.token.toLowerCase()),
    p_device_name: body.deviceName.trim(),
    p_extension_version: String(body.extensionVersion || "").slice(0, 64),
    p_protocol_version: clamp(body.protocolVersion, 1, 1000, 1),
    p_capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 100) : [],
    p_browser_name: browserName
  });
  return json(result || { ok: false, error: "Pairing failed." }, result?.ok ? 200 : 401);
}

async function heartbeat(body: Record<string, unknown>) {
  if (!validToken(body.token) || !validDeviceName(body.deviceName)) {
    return json({ ok: false, error: "Unauthorized device." }, 401);
  }
  const result = await rpc("opera_heartbeat", {
    p_device_name: body.deviceName.trim(),
    p_token_hash: await sha256(body.token.toLowerCase()),
    p_extension_version: String(body.extensionVersion || "").slice(0, 64),
    p_protocol_version: clamp(body.protocolVersion, 1, 1000, 1),
    p_capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 100) : []
  });
  return json(result || { ok: false }, result?.ok ? 200 : 401);
}

async function pull(body: Record<string, unknown>) {
  if (!validToken(body.token) || !validDeviceName(body.deviceName)) {
    return json({ ok: false, error: "Unauthorized device." }, 401);
  }
  const tokenHash = await sha256(body.token.toLowerCase());
  const waitMs = clamp(body.waitMs, 0, 25000, 12000);

  // The wait lives in Postgres, next to the queue. This handler used to sleep
  // between `opera_claim_next` calls, which minted one HTTP round trip per poll
  // -- 14 per 12s window per idle device -- and left a command waiting up to
  // 2000ms for the device to ask again. Phase A measured that queue wait at
  // p50 830ms and p95 1910ms. `opera_claim_next_wait` polls with a ramp that
  // stays under 50ms for the first 720ms of an idle window, which is where
  // follow-up commands actually arrive. One call, one response.
  const result = await rpc("opera_claim_next_wait", {
    p_device_name: body.deviceName.trim(),
    p_token_hash: tokenHash,
    p_extension_version: String(body.extensionVersion || "").slice(0, 64),
    p_protocol_version: clamp(body.protocolVersion, 1, 1000, 1),
    p_capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 100) : [],
    p_wait_ms: waitMs
  });
  if (!result?.ok) return json(result || { ok: false }, 401);
  return json({ ...result, serverTime: new Date().toISOString() }, 200);
}

async function complete(body: Record<string, unknown>) {
  if (!validToken(body.token) || !validDeviceName(body.deviceName) || typeof body.commandId !== "string") {
    return json({ ok: false, error: "Unauthorized or invalid completion request." }, 401);
  }
  const result = await rpc("opera_complete_command", {
    p_device_name: body.deviceName.trim(),
    p_token_hash: await sha256(body.token.toLowerCase()),
    p_command_id: body.commandId,
    p_ok: body.ok === true,
    p_result: body.ok === true ? (body.result ?? {}) : null,
    p_error: body.ok === true ? null : (body.error ?? { code: "EXECUTION_ERROR", message: "Command failed." })
  });
  return json(result || { ok: false }, result?.ok ? 200 : 400);
}

// Event-Triggered Workflows: device pushes a fired watcher event. The
// envelope is device-supplied but capped; the watcher identity is carried in
// the envelope itself (the relay does not resolve watcher rows).
async function watchEvent(body: Record<string, unknown>) {
  if (!validToken(body.token) || !validDeviceName(body.deviceName)) {
    return json({ ok: false, error: "Unauthorized device." }, 401);
  }
  const tokenHash = await sha256(body.token.toLowerCase());
  const env = (body.envelope && typeof body.envelope === "object") ? body.envelope as Record<string, unknown> : null;
  if (!env || typeof env.watcherId !== "string" || env.watcherId.length > 64) {
    return json({ ok: false, error: "Invalid watch event envelope." }, 400);
  }
  const result = await rpc("opera_watch_event_ingest", {
    p_device_name: body.deviceName.trim(),
    p_token_hash: tokenHash,
    p_watcher_id: env.watcherId,
    p_envelope: env
  });
  return json(result || { ok: false }, result?.ok ? 200 : 400);
}

async function startWorkflow(body: Record<string, unknown>) {
  if (!validToken(body.token) || !validDeviceName(body.deviceName)) {
    return json({ ok: false, error: "Unauthorized device." }, 401);
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return json({ ok: false, error: "Invalid workflow name." }, 400);
  const result = await rpc("opera_start_workflow", {
    p_name: name,
    p_input: (body.params && typeof body.params === "object") ? body.params : {},
    p_timeout_ms: clamp(body.timeoutMs, 5000, 300000, 60000),
    p_device_name: body.deviceName.trim()
  });
  return json(result || { ok: false }, result?.ok ? 200 : 400);
}

async function readBoundedBody(req: Request, maxBytes: number): Promise<string | null> {
  // WHY a bounded reader instead of req.text(): text() buffers the entire
  // body before the length check, so a huge chunked body exhausts isolate
  // memory first. This stops at maxBytes + 1 and never holds more.
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* oversize is the answer */ }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405);
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json({ ok: false, error: "Request too large." }, 413);

  try {
    // WHY the cap rides the stream, not just the header: the gate above reads
    // content-length alone, so a chunked body without one skipped it and the
    // parse buffered an unbounded body before authentication. Pull envelopes
    // are small, so refusing past exactly MAX_BODY is the whole fix.
    const raw = await readBoundedBody(req, MAX_BODY);
    if (raw === null) {
      return json({ ok: false, error: "Request too large." }, 413);
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "pair") return await pair(body);
    if (action === "pull") return await pull(body);
    if (action === "complete") return await complete(body);
    if (action === "heartbeat") return await heartbeat(body);
    if (action === "watch_event") return await watchEvent(body);
    if (action === "start_workflow") return await startWorkflow(body);
    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ ok: false, error: "Body must be JSON." }, 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    createEdgeLog({}).error("opera-agent-bridge error", message);
    return json({ ok: false, error: "Bridge request failed." }, 500);
  }
});
