import "jsr:@supabase/functions-js@2.116.0/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// U-T universal fastpath gateway: ONE HTTP round trip from any AI platform
// (ChatGPT GPTs/Actions, Claude/MCP, n8n, plain curl) to a completed browser
// action. GPT Actions cannot set custom headers, so the token may arrive via
// header, body.apiKey, or ?apiKey=. Query tokens are accepted ONLY for the
// read-only /openapi.json + /health surfaces, never for /command.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-opera-agent-token, authorization",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Cache-Control": "no-store"
};

const DEVICE_NAME = "opera";
const METHOD_RE = /^[a-z][a-z0-9_.]{1,48}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_BODY = 256 * 1024;
const WAIT_MIN = 500;
const WAIT_MAX = 32000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
  });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractToken(req: Request, body: Record<string, unknown> | null): string | null {
  const header = req.headers.get("x-opera-agent-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (header) return header.trim();
  if (body && typeof body.apiKey === "string" && body.apiKey.trim()) return body.apiKey.trim();
  return null;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function command(req: Request, _url: URL) {
  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: { code: "INVALID_JSON", message: "Body must be JSON." } }, 400);
  }
  const token = extractToken(req, body);
  if (!token) {
    return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing token (x-opera-agent-token header or body.apiKey)." } }, 401);
  }
  const method = typeof body!.method === "string" ? body!.method.trim() : "";
  if (!METHOD_RE.test(method)) {
    return json({ ok: false, error: { code: "INVALID_METHOD", message: "Missing/invalid method." } }, 400);
  }
  const params = (body!.params && typeof body!.params === "object") ? body!.params as Record<string, unknown> : {};
  const timeoutMs = Math.max(WAIT_MIN, Math.min(WAIT_MAX, Number(body!.waitMs) || 12000));
  const requestId = typeof body!.requestId === "string" && ID_RE.test(body!.requestId) ? body!.requestId : null;

  const tokenHash = await sha256Hex(token.toLowerCase());
  // Verify the device token BEFORE touching the command queue: enqueue
  // resolves the device by name only, so the hash check must happen here.
  const auth = await rpc("opera_verify_device", {
    p_device_name: DEVICE_NAME,
    p_token_hash: tokenHash
  });
  if (!auth?.ok) {
    return json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid token for device." } }, 401);
  }
  // Preserve the former wrapper's pairing/offline preflight before enqueue.
  const { data: device, error: deviceError } = await supabase.from("opera_devices")
    .select("last_seen_at").eq("device_name", DEVICE_NAME).neq("status", "disabled").maybeSingle();
  if (deviceError) throw new Error(`Device lookup failed: ${deviceError.message}`);
  if (!device) return json({ ok: false, error: { code: "DEVICE_NOT_PAIRED", message: "Device is not paired." } }, 401);
  if (!device.last_seen_at || Date.parse(device.last_seen_at) < Date.now() - 90000) {
    return json({ ok: false, error: "Device is offline.", lastSeenAt: device.last_seen_at });
  }
  // Separate awaited RPC requests commit the queue row before the device must
  // claim it. Enqueue + await in one SQL transaction hides it until timeout.
  let result = await rpc("opera_enqueue", {
    p_method: method,
    p_params: params,
    p_timeout_ms: timeoutMs,
    p_device_name: DEVICE_NAME,
    p_request_id: requestId
  });
  if (result?.ok === true) {
    const commandId = result.commandId;
    try {
      result = await rpc("opera_await_adaptive", {
        p_command_id: commandId,
        p_timeout_ms: timeoutMs
      });
    } catch {
      // Enqueue already committed; a lost wait response is not action failure.
      return json({
        ok: false,
        commandId,
        outcome: "unknown",
        error: { code: "GATEWAY_ERROR", message: "Unable to retrieve the command result. The action may still have succeeded; verify page state before repeating it." }
      }, 502);
    }
  }

  if (result && result.ok === false && typeof result.error === "string" && result.error.includes("not paired")) {
    return json({ ok: false, error: { code: "DEVICE_NOT_PAIRED", message: "Device is not paired." } }, 401);
  }
  if (result && result.ok === false && result.error && typeof result.error === "object" && (result.error as { code?: unknown }).code === "AWAIT_TIMEOUT") {
    return json({
      ok: false,
      error: { code: "AWAIT_TIMEOUT", message: "The device did not report back before waitMs. The action may still have succeeded — verify page state before repeating it." }
    }, 504);
  }
  // Structured device results (ok true OR ok false) are 200: AI platforms
  // read the envelope and recover; 5xx bodies can be dropped by GPT Actions.
  return json(result || { ok: false, error: { code: "GATEWAY_ERROR", message: "Empty result." } }, 200);
}

function openApiSpec(basePath: string) {
  return {
    openapi: "3.0.0",
    info: {
      title: "Opera Agent Gateway",
      description: "One-hop browser control for any AI platform. Authenticate with body.apiKey (GPT Actions) or the x-opera-agent-token header.",
      version: "1.0.1"
    },
    servers: [{ url: basePath }],
    paths: {
      "/command": {
        post: {
          operationId: "runBrowserCommand",
          summary: "Run one browser action and wait for its result",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["method"],
                  properties: {
                    apiKey: { type: "string", description: "Device token (x-opera-agent-token header also accepted)." },
                    method: { type: "string", examples: ["tabs.list", "page.find", "browser.burst"] },
                    params: { type: "object" },
                    waitMs: { type: "integer", minimum: 500, maximum: 32000, default: 12000 },
                    requestId: { type: "string", description: "Optional idempotency key." }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Command result: ok true on success, or ok false with a structured error the caller can act on (e.g. stale element, element not found).", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Missing or invalid device token." },
            "504": { description: "Device did not report back within waitMs; the action may still have succeeded — verify page state before repeating."
            }
          }
        }
      }
    }
  };
}

function health() {
  return json({
    ok: true,
    service: "opera-agent-gateway",
    version: "1.0.1",
    time: new Date().toISOString()
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/openapi.json")) {
      // servers must carry the FULL public function base path: GPT Actions
      // appends the spec's paths to servers[url]. The hosted proxy rewrites
      // the request URL (strips /functions/v1, downgrades scheme), so the
      // base path comes from SUPABASE_URL, never from the request URL.
      return json(openApiSpec(`${SUPABASE_URL}/functions/v1/opera-agent-gateway`), 200);
    }
    if (url.pathname.endsWith("/health")) return health();
  }
  if (req.method !== "POST") return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST /command only." } }, 405);
  const url = new URL(req.url);
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json({ ok: false, error: { code: "TOO_LARGE", message: "Request too large." } }, 413);
  try {
    if (url.pathname.endsWith("/command")) return await command(req, url);
    return json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown path." } }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: { code: "GATEWAY_ERROR", message: message.slice(0, 300) } }, 502);
  }
});
