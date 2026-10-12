// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: index — Repository file.
// @state: retry Chrome's transient tab-drag refusal on all tab mutations.
// @dependencies: edge-runtime, supabase-js, edge-log.

import "@supabase/edge-runtime";
import { createClient } from "@supabase/supabase-js";
import { createEdgeLog } from "../_shared/edge-log.js";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";
import { isUpgradeRequest, serveDeviceSocket } from "./bridge-socket.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const cors = {
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store"
};

function withCors(req: Request, res: Response): Response {
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  const headers = new Headers(res.headers);
  if (origin === null) headers.delete("Access-Control-Allow-Origin");
  else headers.set("Access-Control-Allow-Origin", origin);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const MAX_BODY = 1024 * 1024;

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
  const waitMs = clamp(body.waitMs, 0, 25000, 12000);

  const claimed = await claimForDevice(
    { deviceName: body.deviceName, token: body.token },
    {
      extensionVersion: String(body.extensionVersion || ""),
      protocolVersion: body.protocolVersion,
      capabilities: body.capabilities,
      waitMs
    }
  );
  if (!claimed) return json({ ok: false }, 401);
  return json({ ...claimed.raw, serverTime: new Date().toISOString() }, 200);
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

const COMMAND_EVENT_KINDS = ["received", "step", "observation", "note", "done"];
const COMMAND_EVENT_ENVELOPE_MAX = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function commandEvent(body: Record<string, unknown>) {
  if (!validToken(body.token) || !validDeviceName(body.deviceName)) {
    return json({ ok: false, error: "Unauthorized device." }, 401);
  }
  const commandId = String(body.commandId || "").trim();
  if (!UUID_RE.test(commandId)) {
    return json({ ok: false, error: "Invalid command id." }, 400);
  }
  const kind = String(body.kind || "").trim();
  if (!COMMAND_EVENT_KINDS.includes(kind)) {
    return json({ ok: false, error: "Unknown event kind." }, 400);
  }
  const envelope = (body.envelope && typeof body.envelope === "object") ? body.envelope as Record<string, unknown> : {};
  if (JSON.stringify(envelope).length > COMMAND_EVENT_ENVELOPE_MAX) {
    return json({ ok: false, error: "Event envelope too large." }, 400);
  }
  const result = await rpc("opera_emit_command_event", {
    p_device_name: String(body.deviceName).trim(),
    p_token_hash: await sha256(String(body.token).toLowerCase()),
    p_command_id: commandId,
    p_kind: kind,
    p_envelope: envelope
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

  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {
 }
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

async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405);
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json({ ok: false, error: "Request too large." }, 413);

  try {

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
    if (action === "command_event") return await commandEvent(body);
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
}

// WHY the socket is checked before handle(). A device that opens a socket must never
// reach the HTTP body parser, and the upgrade handshake has to be answered by the
// runtime itself, which handle() cannot do.

// WHY this is the part that removes polling. The device used to ask whether work
// existed, which cost a round trip and a blocking wait on every action. A change
// channel inverts it: the database says a row appeared, and the socket already
// open carries it. Nothing asks, so nothing waits.
//
// WHY the claim still runs. Delivery is not ownership. Two sockets, or a restart
// after delivery but before completion, would otherwise run the same command
// twice, so the claim RPC is still the thing that decides who executes.

// WHY the channel is drained the moment it opens, and then drained again for as
// long as it stays open. A change channel only reports rows inserted while it is
// listening, so anything that queued while the device was disconnected would
// otherwise sit unclaimed until the next command happened to arrive, which makes
// the first command after an outage depend on luck. The loop keeps draining
// because one insert can leave more than one command queued behind a claim.

// WHY there is one function that claims. The HTTP pull and the socket drain used
// to build the same RPC call separately, which meant two places to get the hash,
// the clamps, and the capability cap right. A claim is a claim no matter who
// asked, so both paths go through here now.

async function claimForDevice(
  identity: { deviceName: string; token: string },
  detail: { extensionVersion?: unknown; protocolVersion?: unknown; capabilities?: unknown; waitMs?: unknown } = {}
) {
  const claimed = await rpc("opera_claim_next_wait", {
    p_device_name: identity.deviceName.trim(),
    p_token_hash: await sha256(identity.token.toLowerCase()),
    p_extension_version: String(detail.extensionVersion || "").slice(0, 64),
    p_protocol_version: clamp(detail.protocolVersion, 1, 1000, 1),
    p_capabilities: Array.isArray(detail.capabilities) ? detail.capabilities.slice(0, 100) : [],
    p_wait_ms: clamp(detail.waitMs, 0, 25000, 0)
  });

  if (!claimed?.ok) return null;
  return { command: claimed.command ?? null, raw: claimed };
}

// WHY the channel listens twice. postgres_changes measured 650-1000 ms from
// insert to claim; the broadcast the enqueue side sends lands in tens of
// milliseconds. Both call the same drain, and the claim RPC arbitrates, so a
// double trigger costs one cheap empty claim. The postgres listener stays because
// writers that never broadcast — direct SQL, future code — must still work, just
// slower. Removing it would make the fast path mandatory instead of preferred.

function subscribe(identity: { deviceName: string; token: string }, onCommand: (command: unknown) => void) {
  const drain = async () => {
    const claimed = await claimForDevice(identity);
    if (!claimed?.command) return false;
    onCommand(claimed.command);
    return true;
  };

  const channel = supabase
    .channel(`opera-commands-${identity.deviceName}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "opera_commands" },
      drain
    )
    .on(
      "broadcast",
      { event: "new-command" },
      drain
    )
    .subscribe();

  void (async () => {
    for (;;) {
      try {
        if (!await drain()) return;
      } catch (error) {
        createEdgeLog({}).error("bridge socket drain failed", String(error?.message || error));
        return;
      }
    }
  })();

  return () => {
    void supabase.removeChannel(channel);
  };
}

// WHY the handshake authenticates instead of claiming. The claim RPC is the only
// existing check that a token belongs to a device name, which makes reusing it look
// free. It is not: claiming is what takes ownership of a queued command, and a
// handshake that claims discards the result. The device then sits connected and
// silent while the one command waiting for it has been marked as somebody else's.
// opera_auth_device answers exactly the question a handshake asks, and nothing more.

async function verifyDeviceSocket(identity: { token: string; deviceName: string }) {
  if (!validToken(identity.token) || !validDeviceName(identity.deviceName)) {
    return { ok: false };
  }
  const deviceId = await rpc("opera_auth_device", {
    p_device_name: identity.deviceName.trim(),
    p_token_hash: await sha256(identity.token.toLowerCase())
  });
  return deviceId ? { ok: true, deviceId } : { ok: false };
}

Deno.serve((req: Request) => {
  if (isUpgradeRequest(req)) {
    return serveDeviceSocket(req, {
      verifyDevice: verifyDeviceSocket,
      onTick: async (identity) => (await claimForDevice(identity))?.command ?? null,
      complete,
      subscribe,
      log: createEdgeLog({})
    }).response;
  }
  return handle(req).then((res) => withCors(req, res));
});
