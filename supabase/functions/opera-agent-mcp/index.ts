// @last-edited: 2026-10-21 UTC+7.
// @title: opera-agent-mcp — the MCP surface: the tools an agent calls, over the protocol it declares.
// @state: the transport, the tool registry, and the program sealing every VM call passes through.
// @dependencies: edge-runtime, mcp, webStandardStreamableHttp, supabase-js, v4, edge-log, cors.

import "@supabase/edge-runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { streamCommandEvents } from "../_shared/command-stream.ts";
import * as z from "zod/v4";
import { createEdgeLog } from "../_shared/edge-log.js";
import {
  CORS_DEFAULT_ORIGINS,
  resolveAllowedOrigin
} from "../_shared/cors.js";
import {
  CommandFailure,
  sealVmProgram
} from "../_shared/seal-vm-program.js";
import { compileAdhocGraph } from "../_shared/adhoc-compile.js";
import { registerTools } from "./tools.ts";

// WHY THE DEPS ARE TYPED FROM THE FUNCTIONS THEMSELVES.
// A hand-written type beside a function is a second version of that function, and the two drift.
// Here the type is taken from the function, so a change to the transport changes the contract the tools are checked against.

export type ToolDeps = {
  execute: typeof execute;
  executeScreenshot: typeof executeScreenshot;
  runWorkflow: typeof runWorkflow;
  runAdhoc: typeof runAdhoc;
  runTask: typeof runTask;
  rpc: typeof rpc;
  textResult: typeof textResult;
  toolError: typeof toolError;
  callVmHost: typeof callVmHost;
  vmRunResult: typeof vmRunResult;
  rpcErrorParts: typeof rpcErrorParts;
  db: typeof db;
  deviceName: string;
  provider: string;
  caller: VmCaller | null;
};


const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STATIC_TOKEN = Deno.env.get("OPERA_AGENT_MCP_TOKEN") || "";
const DEVICE_NAME = Deno.env.get("OPERA_AGENT_MCP_DEVICE_NAME") || "opera";
const ALLOWED_USER_IDS = new Set((Deno.env.get("OPERA_AGENT_MCP_USER_IDS") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
);
const ALLOWED_USER_EMAILS = new Set((Deno.env.get("OPERA_AGENT_MCP_USER_EMAILS") || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
);

// WHY THE CLIENT IS LOADED LAZILY.
// supabase-js is only needed for the handful of table reads and the one auth lookup, none of which are on the hot path.
// Loading it at module scope put it in every isolate's boot, and the platform charges for that before a byte is served: a /health call that touches no database at all still measured a 707 ms median.
// The command path needs only PostgREST, which is a single POST per function call, so it no longer pulls the library in at all.

let clientPromise: Promise<import("@supabase/supabase-js").SupabaseClient> | null = null;

async function db() {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }));
  }
  return clientPromise;
}

const CORS_BASE_HEADERS = {
  "Access-Control-Allow-Headers": [
    "authorization",
    "content-type",
    "last-event-id",
    "mcp-protocol-version",
    "mcp-session-id",
    "x-opera-device",
    "x-opera-provider"
  ].join(", "),
  "Access-Control-Allow-Methods": [
    "GET",
    "POST",
    "DELETE",
    "OPTIONS"
  ].join(", "),
  "Access-Control-Expose-Headers": [
    "mcp-protocol-version",
    "mcp-session-id"
  ].join(", "),
  "Cache-Control": "no-store"
};

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  return origin === null
    ? { ...CORS_BASE_HEADERS }
    : {
      ...CORS_BASE_HEADERS,
      "Access-Control-Allow-Origin": origin
    };
}

type AuthContext = { type: "static" } | {
  type: "user"; userId: string
};
export type VmCaller = { userId: string; token: string };
async function resolveDeviceName(auth: AuthContext, req?: Request): Promise<string | null> {
  if (auth.type === "static") return DEVICE_NAME;
  const deviceFromHeader = req?.headers.get("x-opera-device")?.trim() || "";
  const supabase = await db();
  let query = supabase.from("opera_devices").select("device_name").eq("user_id", auth.userId).neq("status", "disabled");
  if (deviceFromHeader) {
    query = query.eq("device_name", deviceFromHeader);
  }
  query = query.limit(1);
  const { data } = await query.single();
  if (data?.device_name) return data.device_name;

  return null;
}

const PROVIDER_PATTERNS: Array<[
  RegExp,
  string
]> = [
  [
    /opencode/i,
    "opencode"
  ],
  [
    /\bkilo/i,
    "kilo"
  ],
  [
    /chatgpt|openai-connector|oai-mcp/i,
    "chatgpt"
  ],
  [
    /claude/i,
    "claude"
  ],
  [
    /\bcursor/i,
    "cursor"
  ],
  [
    /windsurf/i,
    "windsurf"
  ],
  [
    /\bcline\b/i,
    "cline"
  ],
  [
    /roo[ -]?code/i,
    "roo"
  ],
  [
    /\baider\b/i,
    "aider"
  ],
  [
    /\bgoose\b/i,
    "goose"
  ],
  [
    /\bzed\b/i,
    "zed"
  ],
  [
    /vscode|visual studio code/i,
    "vscode"
  ],
  [
    /mcp-inspector/i,
    "inspector"
  ],
  [
    /postman/i,
    "postman"
  ],
  [
    /\bcurl\b/i,
    "curl"
  ],
  [
    /python|httpx|urllib|aiohttp/i,
    "script"
  ],
  [
    /node|undici|deno/i,
    "script"
  ],
];

function slugifyProvider(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

async function resolveProvider(req: Request, auth?: AuthContext | null): Promise<string> {
  const header = req.headers.get("x-opera-provider")?.trim().slice(0, 64) || "";
  if (/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(header)) return header.toLowerCase();
  const ua = req.headers.get("user-agent") || "";
  for (const [re, name] of PROVIDER_PATTERNS) if (re.test(ua)) return name;

  if (auth?.type === "user") {
    try {
      const token = bearerToken(req);
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      const clientId = typeof payload.client_id === "string" ? payload.client_id : "";
      if (/^[0-9a-f-]{36}$/i.test(clientId)) {
        const name = await rpc("opera_client_name", { p_client_id: clientId });
        const slug = typeof name === "string" ? slugifyProvider(name) : "";
        if (slug) return slug;
      }
    } catch {}
  }
  return "unknown";
}

function json(
  req: Request,
  data: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeadersFor(req),
      "Content-Type": "application/json",
      ...extraHeaders
    }
  });
}

function secureEqual(
  left: string,
  right: string
) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function bearerToken(req: Request) {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = bearerToken(req);
  if (!token) return null;
  if (STATIC_TOKEN && secureEqual(token, STATIC_TOKEN)) return { type: "static" };
  if (ALLOWED_USER_IDS.size === 0 && ALLOWED_USER_EMAILS.size === 0) return null;
  const supabase = await db();
  const {
    data,
    error
  } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const email = data.user.email.toLowerCase();
  if (!ALLOWED_USER_IDS.has(data.user.id) && !ALLOWED_USER_EMAILS.has(email)) return null;
  return {
    type: "user",
    userId: data.user.id
  };
}

function publicBaseUrl() {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/opera-agent-mcp`;
}

function unauthorized(req: Request) {
  const metadata = `${publicBaseUrl()}/.well-known/oauth-protected-resource`;
  return json(
    req,
    {
      error: "unauthorized",
      error_description: "A valid Opera Agent access token is required."
    },
    401,
    { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"` }
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error || "Unknown error").slice(0, 1000);
}

function textResult(value: unknown) {
  const structuredContent = value && typeof value === "object" ? value as Record<string, unknown> : { value };
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(structuredContent)
    }],
    structuredContent
  };
}

function toolError(error: unknown) {
  const raw = errorMessage(error);
  if (/statement timeout/i.test(raw)) {
    const unknownFailure = {
      code: "AWAIT_OUTCOME_UNKNOWN",
      outcome: "unknown",
      message: "The action result is unknown: the server stopped waiting before the browser reported back. The action may still have succeeded — verify the page state before repeating the action."
    };
    const structuredContent = {
      ok: false,
      error: unknownFailure
    };
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(structuredContent)
      }],
      structuredContent,
      isError: true
    };
  }
  const failure = error instanceof CommandFailure
    ? {
      code: error.code,
      message: error.message,
      ...(error.details && (error.details as {
        outcome?: unknown
      }).outcome === "unknown" ? { outcome: "unknown" } : {}),
      ...(error.details ? { details: error.details } : {})
    }
    : {
      code: "MCP_EXECUTION_ERROR",
      message: errorMessage(error)
    };
  const structuredContent = {
    ok: false,
    error: failure
  };
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(structuredContent)
    }],
    structuredContent,
    isError: true
  };
}

// WHY POSTGREST DIRECTLY.
// Every tool call crosses into the database twice: once to enqueue the command and once to await its result.
// Those two crossings measured 269 ms and 417 ms, and going through supabase-js meant loading a library on every isolate boot to make what is ultimately one HTTP POST per function.
// This is that POST.

// WHY IT SOMETIMES IS NOT POSTGREST.
// A WebSocket connection holds its isolate open, and an isolate that stays open can hold a database connection too.
// The first query on a fresh connection costs the handshake, but every query after it skips the gateway entirely, and measured here that is 162 ms against 603 ms for the same work.
// So when a direct connection exists, these same calls ride it instead.
// The function invoked, its arguments and its return shape are identical either way; only the road changes, and a direct call that fails falls back to the gateway rather than failing the command.

let directDb: {
  sql: (...args: unknown[]) => Promise<unknown[]>
} | null = null;
let directFailReason = "";

async function rpcViaDirect(
  name: string,
  args: Record<string,
  unknown>
) {
  if (!directDb) throw new Error("no direct connection");
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`refused function name: ${name}`);
  const keys = Object.keys(args);
  const values = keys.map((k) => args[k] === undefined ? null : args[k]);
  const placeholders = keys.map((
    k,
    i
  ) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`refused argument name: ${k}`);
    return `${k} := $${i + 1}`;
  }).join(", ");
  const rows = await directDb.sql(`select public."${name}"(${placeholders}) as data`, values) as Array<{
    data: unknown
  }>;
  if (!rows.length) return null;
  return rows[0].data as Record<string, unknown> | null;
}

async function rpcViaPostgrest(
  name: string,
  args: Record<string,
  unknown>
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(args)
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message || parsed.error_description || parsed.msg || detail;
    } catch {}
    throw new Error(`${name} failed: ${detail}`);
  }
  return text ? JSON.parse(text) as Record<string, unknown> : null;
}

async function rpc(
  name: string,
  args: Record<string,
  unknown>
) {
  if (directDb) {
    try {
      return await rpcViaDirect(name, args);
    } catch (error) {
      directDb = null;
      directFailReason = String(error?.message ?? error).slice(0, 200);
    }
  }
  return rpcViaPostgrest(name, args);
}

type ProgressEmitter = {
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: unknown) => Promise<unknown> | void;
};

const progressScope = new AsyncLocalStorage<ProgressEmitter>();

function forwardCommandProgress(
  commandId: string,
  timeoutMs: number,
  progress: (() => ProgressEmitter | null) | null
) {
  const emitter = progress?.();
  if (!emitter?.sendNotification) return Promise.resolve();
  const token = emitter._meta?.progressToken;
  if (token === undefined || token === null) return Promise.resolve();

  return streamCommandEvents({
    rpc,
    commandId,
    deadlineMs: timeoutMs + 2000,
    onEvent: (event) => {
      const message = String(event?.kind ?? 'progress');
      return Promise.resolve(emitter.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: token,
          message
        }
      })).catch(() => {});
    }
  }).catch(() => ({ ok: false }));
}

const edgeClock = () => Date.now();

// Each stage is timed separately because the database clock cannot see any of them.
// opera_commands measures created-at to completed-at, which is the device's work and nothing else; the round trips that carry that work, and the ones that happen before a command exists, are all invisible to it.
// On this deployment those invisible stages dominated: a call reported 0.5-1.9 s of command time inside a 10 s round trip, so without this the remaining time could only be guessed at.

// WHY enqueue and await leave together.
// They used to be two calls: one to create the command, one to wait for it.
// Each is a full HTTPS crossing to the data API, and measured here those two cost 269 ms and 417 ms while the command itself took 729 ms — most of the time inside the function was spent reaching it and coming back.
// opera_enqueue_and_await asks the same question in one visit and returns the shape the two used to return between them, so the lifecycle, the allowlist, the request-id reuse and the expiry deadline are all unchanged.

// WHAT THIS COSTS.
// Progress cannot ride along, because one blocking call has nowhere to put intermediate events.
// The command-event table, its device-side emit and its cursor reader are all untouched, so a transport that can stream again reuses every row already stored; nothing had to be deleted to make this faster.

let progressMs = 0;
let awaitMs = 0;

// WHY THIS IS TWO CALLS AND NOT ONE.
// Merging the enqueue and the wait into a single opera_enqueue_and_await looked like an obvious saving: one HTTPS crossing instead of two, against crossings measured at 269 ms and 417 ms. It does not work, and the reason is worth recording.
// A plpgsql function is one transaction, so the row inserted by the enqueue half is uncommitted for the whole time the function spends waiting.
// The device claims commands by reading that table, and it cannot see an uncommitted row, so the command it was told to run is never claimed and the call waits for its full timeout.
// Measured live, the merged version returned a 9.1 s median where the two-call version returned 2.3 s, which is the shape of a wait that can never be satisfied.

// So the crossing stays, and the wait for it stays.
// What can be removed without a second transaction is the wait for progress: it also ends at the command's terminal status, so asking for it and the result together costs one wait rather than two.

// WHY THE REQUEST ID IS NULL AND THE PROVIDER RIDES ALONG.
// The id used to be a fresh random UUID on every call, which can never collide with anything, so the reuse lookup it triggers inside the enqueue was a SELECT that always missed.
// Passing null skips that lookup without changing idempotency, because there was none to begin with: a retry arrives with a new id, not the old one.
// The provider used to be stamped with a second write after the command finished, a full data-API crossing on the critical path after the answer was already known; it is now set by the enqueue itself, and the update that used to follow it is gone.

async function runCommand(
  method: string,
  params: Record<string,
  unknown> = {},
  timeoutMs = 12000,
  deviceName: string = DEVICE_NAME,
  provider = "",
  progress: (() => ProgressEmitter | null) | null = () => progressScope.getStore() ?? null
) {
  const boundedTimeout = Math.max(500, Math.min(30000, timeoutMs));
  const beganAt = edgeClock();
  const queued = await rpc("opera_enqueue", {
    p_method: method,
    p_params: params,
    p_timeout_ms: boundedTimeout,
    p_device_name: deviceName,
    p_request_id: null,
    p_provider: provider || null
  });
  const enqueuedAt = edgeClock();
  if (!queued?.ok || !queued.commandId) {
    throw new Error(String(queued?.error || `Unable to queue ${method}.`));
  }

  const awaitFunction = method === "page.capture" ? "opera_await_capture" : "opera_await_adaptive";
  const progressStartedAt = edgeClock();
  const [, completed] = await Promise.all([
    forwardCommandProgress(queued.commandId, boundedTimeout, progress)
      .then((result) => {
        progressMs = edgeClock() - progressStartedAt; return result;
      }),
    rpc(awaitFunction, {
      p_command_id: queued.commandId,
      p_timeout_ms: Math.min(32000, boundedTimeout + 2000)
    }).then((result) => {
      awaitMs = edgeClock() - progressStartedAt; return result;
    })
  ]);
  const finishedAt = edgeClock();

  if (!completed?.ok) {
    const detail = completed?.error;
    const code = detail && typeof detail === "object" && "code" in detail
      ? String((detail as {
        code?: unknown
      }).code || "COMMAND_FAILED")
      : "COMMAND_FAILED";
    const message = detail && typeof detail === "object" && "message" in detail
      ? String((detail as {
        message?: unknown
      }).message)
      : String(detail || `${method} failed.`);
    const details = detail && typeof detail === "object" && "details" in detail
      && (detail as {
        details?: unknown
      }).details && typeof (detail as {
        details?: unknown
      }).details === "object"
      ? (detail as {
        details: Record<string, unknown>
      }).details
      : undefined;
    if (code === "AWAIT_TIMEOUT") {
      throw new CommandFailure(
        "AWAIT_OUTCOME_UNKNOWN",
        "The action result is unknown: the server stopped waiting before the browser reported back. The action may still have succeeded — verify the page state before repeating the action.",
        {
          method,
          outcome: "unknown"
        }
      );
    }
    throw new CommandFailure(code, message, {
      method,
      ...(details || {})
    });
  }

  return {
    ok: true,
    commandId: completed.commandId,
    status: completed.status,
    result: completed.result,
    timing: {
      ...completed.timing,
      edge: {
        enqueueMs: enqueuedAt - beganAt,
        progressMs,
        awaitMs,
        edgeTotalMs: finishedAt - beganAt
      }
    }
  };
}

function execute(
  method: string,
  params: Record<string,
  unknown>,
  timeoutMs?: number,
  deviceName: string = DEVICE_NAME,
  provider = ""
) {
  return runCommand(method, params, timeoutMs, deviceName, provider).then(textResult).catch(toolError);
}

function executeScreenshot(
  params: Record<string,
  unknown>,
  timeoutMs?: number,
  deviceName: string = DEVICE_NAME,
  provider = ""
) {
  return runCommand("page.capture", params, timeoutMs, deviceName, provider).then(screenshotResult).catch(toolError);
}

function screenshotResult(
  value: Record<string,
  unknown>
) {
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : {};
  const screenshot = result.screenshot && typeof result.screenshot === "object" ? result.screenshot as Record<string, unknown> : {};
  const data = typeof screenshot.data === "string" ? screenshot.data : "";
  const mimeType = typeof screenshot.mimeType === "string" ? screenshot.mimeType : "image/jpeg";
  const metadataScreenshot = { ...screenshot };
  delete metadataScreenshot.data;
  const structuredContent = {
    ...value,
    result: {
      ...result,
      screenshot: metadataScreenshot
    }
  };
  const content: Array<
    {
      type: "text"; text: string
    } |
    {
      type: "image"; data: string; mimeType: string
    }
  > = [{
    type: "text",
    text: JSON.stringify(structuredContent)
  }];
  if (data) content.unshift({
    type: "image",
    data,
    mimeType
  });
  return {
    content,
    structuredContent
  };
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkflow(
  name: string,
  input: Record<string,
  unknown>,
  waitTimeoutMs: number,
  deviceName: string = DEVICE_NAME,
  provider = ""
) {
  const started = await rpc("opera_start_workflow", {
    p_name: name,
    p_input: input,
    p_timeout_ms: Math.max(1000, Math.min(120000, waitTimeoutMs)),
    p_device_name: deviceName
  });
  if (!started?.ok || !started.runId) {
    const detail = started?.error;
    const code = detail && typeof detail === "object" && "code" in detail
      ? String((detail as {
        code?: unknown
      }).code || "WORKFLOW_START_FAILED")
      : "WORKFLOW_START_FAILED";
    const message = detail && typeof detail === "object" && "message" in detail
      ? String((detail as {
        message?: unknown
      }).message)
      : "Unable to start workflow.";
    throw new CommandFailure(code, message);
  }
  const runId = String(started.runId);
  if (provider) {
    try {
      const supabase = await db();
      await supabase.from("opera_workflow_runs").update({ provider }).eq("id", runId);
    } catch {}
  }
  const startedAt = Date.now();
  let last: Record<string, unknown> | null = null;
  while (Date.now() - startedAt < waitTimeoutMs + 8000) {
    await sleepMs(400);
    last = await rpc("opera_get_workflow_run", { p_run_id: runId }) as Record<string, unknown> | null;
    if (last?.ok && ![
      "queued",
      "running"
    ].includes(String(last.status))) break;
  }
  if (!last?.ok) {
    throw new CommandFailure("WORKFLOW_RUN_LOST", "Workflow run could not be read.");
  }
  const status = String(last.status);
  const timing = last.timing && typeof last.timing === "object" ? last.timing as Record<string, unknown> : {};
  return {
    ok: status === "completed",
    runId,
    workflow: name,
    status,
    result: last.result ?? null,
    error: last.error ?? null,
    timing
  };
}

function rpcErrorParts(
  error: unknown,
  fallbackCode: string
) {
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as {
      code?: unknown; message?: unknown
    };
    const code = typeof record.code === "string" && record.code ? record.code : fallbackCode;
    const message = typeof record.message === "string" && record.message ? record.message : String(code);
    return {
      code,
      message
    };
  }
  if (typeof error === "string" && error) return {
    code: error,
    message: error
  };
  return {
    code: fallbackCode,
    message: fallbackCode
  };
}

async function runTask(
  task: unknown,
  tabId: unknown,
  confirm: unknown,
  requestId: unknown,
  timeoutMs: unknown,
  deviceName: string = DEVICE_NAME,
  provider = ""
) {
  throw new CommandFailure("NOT_IMPLEMENTED", "run_task lands in the next task of docs/superpowers/plans/2026-10-30-run-task.md.");
}

async function runAdhoc(
  graph: unknown,
  requestId: unknown,
  input: Record<string,
  unknown> | undefined,
  waitTimeoutMs: number | undefined,
  deviceName: string = DEVICE_NAME,
  provider = ""
) {
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) {
    throw new CommandFailure("INVALID_REQUEST", "requestId must match /^[A-Za-z0-9_-]{1,100}$/.");
  }
  const compiled = compileAdhocGraph(graph as Record<string, unknown>);
  if (!compiled.ok) {
    throw new CommandFailure(compiled.code, compiled.message);
  }
  const waitMs = Math.max(1000, Math.min(120000, waitTimeoutMs ?? 60000));
  try {
    await rpc("opera_sweep_ephemeral_workflows", {});
  } catch {}
  const registered = await rpc("opera_register_ephemeral_workflow", {
    p_request_id: requestId,
    p_definition: compiled.definition,
    p_description: "run_adhoc one-off write"
  });
  if (!registered?.ok || typeof registered.name !== "string") {
    const parts = rpcErrorParts(registered?.error, "WORKFLOW_REGISTER_FAILED");
    throw new CommandFailure(parts.code, parts.message);
  }
  const name = String(registered.name);
  const started = await rpc("opera_start_workflow", {
    p_name: name,
    p_input: input ?? {},
    p_timeout_ms: waitMs,
    p_device_name: deviceName
  });
  if (!started?.ok || !started.runId) {
    const parts = rpcErrorParts(started?.error, "WORKFLOW_START_FAILED");
    throw new CommandFailure(parts.code, parts.message);
  }
  const runId = String(started.runId);
  if (provider) {
    try {
      const supabase = await db();
      await supabase.from("opera_workflow_runs").update({ provider }).eq("id", runId);
    } catch {}
  }
  const startedAt = Date.now();
  let last: Record<string, unknown> | null = null;
  while (Date.now() - startedAt < waitMs + 10000) {
    await sleepMs(400);
    last = await rpc("opera_get_workflow_run", { p_run_id: runId }) as Record<string, unknown> | null;
    if (last?.ok && ![
      "queued",
      "running"
    ].includes(String(last.status))) break;
  }
  if (!last?.ok) {
    throw new CommandFailure("WORKFLOW_RUN_LOST", "Workflow run could not be read.");
  }
  let deleted = false;
  let deleteError: {
    code: string; message: string
  } | undefined;
  try {
    const removed = await rpc("opera_delete_workflow", { p_name: name });
    if (removed?.ok) {
      deleted = (removed as {
        deleted?: unknown
      }).deleted !== false;
    } else {
      deleteError = rpcErrorParts(removed?.error, "WORKFLOW_DELETE_FAILED");
    }
  } catch (error) {
    deleteError = {
      code: "WORKFLOW_DELETE_FAILED",
      message: errorMessage(error)
    };
  }
  const status = String(last.status);
  const timing = last.timing && typeof last.timing === "object" ? last.timing as Record<string, unknown> : {};
  return {
    ok: status === "completed",
    runId,
    workflow: name,
    status,
    result: last.result ?? null,
    error: last.error ?? null,
    timing,
    deleted,
    ...(deleteError ? { deleteError } : {})
  };
}

async function callVmHost(
  operation: string,
  body: {
    program: unknown; requestId: unknown
  },
  deviceName: string = DEVICE_NAME,
  provider = "",
  caller: VmCaller | null = null
): Promise<Record<string, unknown>> {
  if (!caller) {
    throw new CommandFailure("UNAUTHORIZED", "run_program needs a user access token; the static token names no tenant, so the VM host could not scope the run.");
  }
  if (typeof body.requestId !== "string" || body.requestId.length < 1) {
    throw new CommandFailure("INVALID_REQUEST", "requestId is required.");
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId)) {
    throw new CommandFailure("INVALID_REQUEST", "requestId must match /^[A-Za-z0-9_-]{1,100}$/.");
  }
  const program = await sealVmProgram(body.program, caller);
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/opera-agent-vm`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${caller.token}`,
    "x-opera-device": deviceName
  };
  if (provider) headers["x-opera-provider"] = provider;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operation,
        program,
        requestId: body.requestId
      })
    });
  } catch (error) {
    throw new CommandFailure("VM_HOST_UNREACHABLE", errorMessage(error));
  }
  let envelope: unknown = null;
  try {
    envelope = await res.json();
  } catch {
    envelope = null;
  }
  if (!res.ok || !envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    const detail = envelope && typeof envelope === "object" ? (envelope as {
      error?: unknown
    }).error : null;
    const inner = detail && typeof detail === "object" ? (detail as {
      code?: unknown; message?: unknown
    }) : {};
    const code = typeof inner.code === "string" && inner.code
      ? inner.code.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64)
      : `VM_HOST_${res.status}`;
    const message = typeof inner.message === "string" && inner.message
      ? inner.message.slice(0, 1000)
      : `VM host ${operation} failed with HTTP ${res.status}.`;
    throw new CommandFailure(code, message);
  }
  return envelope as Record<string, unknown>;
}

function vmRunResult(value: unknown) {
  return textResult(value);
}

const SERVER_VERSION = "1.6.27";

// WHY A SOCKET NEXT TO THE HTTP.
// Every HTTPS call pays for an isolate that has never run before: the platform boots one per request, measured here as twenty distinct isolates for twenty probes, and the boot plus the round trips it cannot reuse cost roughly 1.8 s against work the browser answers in under a millisecond.
// A WebSocket holds one isolate open, so the second call on it pays no boot at all, and an isolate that stays open can hold a database connection too, which skips the data-API gateway on every call after the first.
// Measured here that is 162 ms against 603 ms for the same work.
// The socket speaks the same tools with the same authentication and the same handlers as the HTTP; only the road changes, and a client the socket refuses falls back to HTTPS without losing anything but time.

// WHAT IT DELIBERATELY DOES NOT DO.
// It does not list tools: the relay fetches the tool list once over HTTPS at startup, where one slow call costs nothing, so the socket carries only calls and pings.
// It does not multiplex: one request is answered before the next is read, because a browser drive is a sequence of dependent actions and parallel commands to one device would execute out of order.
// It does not keep its own dispatch table: each message is run through a fresh server exactly as an HTTP request would be, so a tool added to the HTTP surface exists here too without a second place to remember it.
// Reusing one server across messages is not possible: the SDK refuses a second transport on a connected server, so the rebuild cost per message is the SDK's price, measured at about 15 ms, and not worth working around.

const WS_MAX_MESSAGE_BYTES = 1024 * 1024;

function isWsUpgrade(req: Request) {
  return (req.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
}

async function connectDirectDb(): Promise<void> {
  const url = Deno.env.get("SUPABASE_DB_URL") ?? "";
  if (!url) throw new Error("No direct database url is configured.");
  const { default: postgres } = await import("postgres");
  const pg = postgres(url, {
    max: 3,
    connect_timeout: 10,
    idle_timeout: 30
  });
  await pg`select 1`;
  directDb = { sql: (
    text: unknown,
    values: unknown
  ) => pg.unsafe(text as string, values as unknown[], { prepare: true }) as unknown as Promise<unknown[]> };
}

async function handleWsMessage(
  message: unknown,
  ctx: {
    deviceName: string; provider: string; caller: VmCaller | null
  }
) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new CommandFailure("INVALID_REQUEST", "The message must be a JSON object.");
  }
  const {
    id,
    method,
    params
  } = message as {
    id?: unknown; method?: unknown; params?: unknown
  };
  if (method === "ping") {
    let dbHost = "";
    try {
      dbHost = new URL(Deno.env.get("SUPABASE_DB_URL") ?? "").hostname;
    } catch {
      dbHost = "unparseable";
    }
    const region = {
      FLY_REGION: Deno.env.get("FLY_REGION") ?? null,
      DENO_REGION: Deno.env.get("DENO_REGION") ?? null,
      SB_REGION: Deno.env.get("SB_REGION") ?? null,
      AWS_REGION: Deno.env.get("AWS_REGION") ?? null,
      FLY_ALLOC_ID: Deno.env.get("FLY_ALLOC_ID") ? "set" : null
    };
    return {
      id: id ?? null,
      result: {
        ok: true,
        pong: true,
        direct: directDb !== null,
        directFailReason,
        dbHost,
        edgeRegion: region
      }
    };
  }
  if (method !== "tools/call") {
    throw new CommandFailure("INVALID_REQUEST", `Unsupported socket method: ${String(method)}.`);
  }
  const {
    name,
    args
  } = (params ?? {}) as {
    name?: unknown; args?: unknown
  };
  if (typeof name !== "string" || !name) {
    throw new CommandFailure("INVALID_REQUEST", "A tools/call message needs a tool name.");
  }
  const request = new Request("https://socket/tools/call", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: (args ?? {}) as Record<string,
        unknown>
      }
    })
  });
  const server = createServer(ctx.deviceName, ctx.provider, ctx.caller);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const envelope = await response.json() as {
    result?: unknown; error?: { code?: unknown; message?: unknown }
  };
  if (envelope.error) {
    throw new CommandFailure("COMMAND_FAILED", String(envelope.error.message ?? "The tool call failed."));
  }
  return {
    id: id ?? null,
    result: envelope.result ?? null
  };
}

function serveMcpSocket(req: Request) {
  const {
    socket,
    response
  } = Deno.upgradeWebSocket(req, { idleTimeout: 0 });

  let resolveClosed: (() => void) | null = null;
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    EdgeRuntime.waitUntil(closed);
  }
  const teardown = () => {
    if (resolveClosed) {
      const done = resolveClosed;
      resolveClosed = null;
      done();
    }
  };

  let authed: {
    deviceName: string; provider: string; caller: VmCaller | null
  } | null = null;
  let queue: Promise<void> = Promise.resolve();

  socket.onmessage = (event: MessageEvent) => {
    const run = queue.then(async () => {
      const text = typeof event.data === "string" ? event.data : "";
      if (!text || text.length > WS_MAX_MESSAGE_BYTES) {
        socket.send(JSON.stringify({
          id: null,
          error: {
            code: "INVALID_REQUEST",
            message: "The message is empty or too large."
          }
        }));
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        socket.send(JSON.stringify({
          id: null,
          error: {
            code: "INVALID_REQUEST",
            message: "The message is not JSON."
          }
        }));
        return;
      }
      const m = message as {
        id?: unknown; method?: unknown; params?: unknown
      };
      if (!authed) {
        if (m.method !== "auth") {
          socket.close(4401, "authenticate first");
          return;
        }
        const p = (m.params ?? {}) as {
          token?: unknown; device?: unknown; provider?: unknown
        };
        const fake = new Request("https://socket/auth", {
          headers: {
            authorization: `Bearer ${typeof p.token === "string" ? p.token : ""}`,
            "x-opera-device": typeof p.device === "string" ? p.device : "",
            "x-opera-provider": typeof p.provider === "string" ? p.provider : ""
          }
        });
        const authContext = await authenticate(fake);
        if (!authContext) {
          socket.close(4401, "unauthorized");
          return;
        }
        const deviceName = await resolveDeviceName(authContext, fake);
        if (!deviceName) {
          socket.close(4401, "unauthorized");
          return;
        }
        const provider = await resolveProvider(fake, authContext);
        const caller: VmCaller | null = authContext.type === "user"
          ? {
            userId: authContext.userId,
            token: bearerToken(fake)
          }
          : null;
        authed = {
          deviceName,
          provider,
          caller
        };
        try {
          await connectDirectDb();
        } catch {
          directDb = null;
        }
        socket.send(JSON.stringify({
          id: m.id ?? null,
          result: {
            ok: true,
            direct: directDb !== null
          }
        }));
        return;
      }
      try {
        const reply = await handleWsMessage(message, authed);
        socket.send(JSON.stringify(reply));
      } catch (error) {
        const failure = error instanceof CommandFailure
          ? {
            code: error.code,
            message: error.message
          }
          : {
            code: "COMMAND_FAILED",
            message: errorMessage(error)
          };
        socket.send(JSON.stringify({
          id: m.id ?? null,
          error: failure
        }));
      }
    });
    queue = run.then(() => {}, () => {});
  };

  socket.onclose = () => {
    teardown();
  };
  socket.onerror = () => {
    teardown();
  };

  return response;
}

function createServer(
  deviceName: string = DEVICE_NAME,
  provider = "",
  caller: VmCaller | null = null
) {
  const server = new McpServer(
    {
      name: "opera-agent",
      version: SERVER_VERSION
    },
    {
      instructions: "Use Opera Agent whenever the user asks to open, navigate, inspect, click, type, scroll, visually inspect, or otherwise operate their local Opera browser. Check browser_status first. Keep normal automation in background: open_url defaults to an inactive tab, retain its returned tabId, and pass that exact tabId to every later page or navigation tool. Never substitute the user's active tab during a multi-step task. Prefer run_browser_burst for two or more dependent actions on one target tab and prefer element references from read_page/find_elements. For dynamic or fast-changing UIs (video players, ad overlays, countdown controls) run find, click, and a wait verification inside ONE run_browser_burst call, passing the found ref to the click step via refFromStep so the reference is consumed within milliseconds of being minted; do not split find and click into separate round trips there. The same rule applies to MENUS and DIALOGS, which re-render their own DOM every time they open: a ref for a menu entry or a dialog control is usually stale by the next round trip. Open a menu, then immediately find the entry and click it by refFromStep inside one burst rather than reading it in a separate call. For multi-level menus, use a hover burst step with the found ref via refFromStep, passing text for the submenu entry you expect it to reveal, so each level is one step that hovers and settles, and then find the submenu entry by text in the next step of the same burst; chain the levels in a single burst rather than hovering by coordinate across separate calls. Use capture_page adaptively only for initial visual observation, canvas/dynamic interfaces, low-confidence targeting, meaningful state changes, or failed verification; pass previousHash to avoid retransmitting unchanged images. Treat coordinates as stale when documentId, viewport, zoomFactor, visualScale, or screenshot hash changes. For lazy result lists, call pointer with pointerAction wheel inside the intended list, inspect scroll.after, moved, contentChanged, and reachedBoundary, collect stableKey/href values, and repeat only with an explicit bound until the boundary is reached and no new stable keys appear. Coordinate actions default to background CDP input and draw a visible cursor marker; use them only when no reliable element ref exists and verify the resulting page state. A visible pointer is a foreground diagnostic: call activate_tab only when the user explicitly asks to watch or permits foreground interaction, then pass executionMode foreground. Never use activate_tab as an implicit recovery step. If a tool returns FOREGROUND_REQUIRED, explain the limitation and request foreground permission instead of activating anything. Never enter passwords, OTPs, payment data, upload files, publish, purchase, send, or delete without the user's explicit instruction. Surfaces rendered as canvas, editors, games, or remote screens expose little or no DOM: when read_page returns little or no useful text while the task needs visual content, use capture_page and reason from the screenshot. Icon-only controls expose a computed accessibleName that find_elements matches; when a text-poor canvas-class page still returns almost no text, read_page also includes a read-only axSummary accessibility snapshot (role and name facts only, never field values; entries are not clickable refs). If find_elements returns nothing while read_page shows the text, target an ancestor clickable element or capture the page instead of retrying the same query. Maps search results are viewport-scoped: after panning or zooming, re-read or re-search rather than trusting the earlier list, and re-find targets after any large page redraw before clicking them. When a tool reports a timeout or an unknown outcome, verify the page state before repeating the action. For OAuth/login/SSO flows, click the login control and read openedTabs in the click result: if a popup tab opened, continue inside that popup by passing its exact tabId to every later page tool — never activate it as an implicit recovery step, and ask before bringing it to the foreground. Verification on state-changing clicks and fills is expect-based: a result with verified:false means the expectation did not pass within the bounded post-action window, so re-check the page instead of immediately repeating the action; a slow SPA or OAuth redirect may still be settling. In a rich editor or canvas surface, click the editing surface first so it takes focus, then use press_key with key \"a\" and modifiers [\"control\"] to select all, key \"Delete\" to clear that selection, and only then pass text to type into the surface. Typed text is inserted at the caret and does NOT replace an active selection: selecting all and then typing appends instead of overwriting, duplicating the content silently with no error to notice. Use key \"v\" and modifiers [\"control\"] to paste, key \"Enter\" with modifiers [\"shift\"] for a line break, and capture_page to confirm the result rather than assuming the keystroke landed, because a canvas surface returns little or no DOM text to re-read. Two further rules were measured against a live Google Docs canvas and both return success while doing nothing, so neither is visible without a capture: a paragraph break must be carried as a newline INSIDE the text payload, because press_key with key \"Enter\" is ignored by that editor and merges every paragraph into one; and a paragraph style must be applied to the EMPTY paragraph before its text is written (press_key the digit with modifiers [\"control\",\"alt\"] first, then pass the heading text), because styling a paragraph that already holds text does not take. Style the paragraph, type its heading, pass a newline, reset with press_key key \"0\" modifiers [\"control\",\"alt\"], then type the body. Two more were measured the same way, one per surface. In a sheet a cell ignores inserted text until a character keystroke opens the editor, and the opening character joins the value, so press a letter, press key \"Backspace\" to erase it, then pass the value; clicking the next cell commits the last one, and reading the cell reference from the name box before each write is the only way to know the click landed. In a deck a placeholder takes text straight after a click with no such trick, press_key key \"m\" modifiers [\"control\"] adds a slide, and key \"Escape\" leaves the box so the next placeholder can be clicked. Three traps are shared by all three. The first key event after a write is swallowed, so send one harmless key before the real one: a dispatched Enter never breaks a paragraph and a toggle never switches off until something has absorbed that event. Clearing a surface removes its text but NOT its formatting, so the next paragraph inherits the old bullets; clear, then send the formatting toggle once, then write. And a menu item that owns a submenu opens on hover, so use pointer hover and settle there rather than pressing, because the press closes the menu instead. If a click reports that the ref moved beyond its geometry tolerance, that stale ref is refused on purpose; the error carries candidates, each entry holding a freshRef that already passed validation, so act on one of those freshRef values directly instead of re-running find_elements. For a page that changes on its own — video players, ad overlays, countdown controls, live lists — prefer start_watch to arm a device-local trigger and then wait_events to collect what it fired. The device acts locally, so no model round trip sits between the page changing and the action happening, and you learn of it once in a single wait_events result instead of re-reading the page to notice. Arm a trigger you expect to fire later, then wait, rather than polling. For an intent you run repeatedly on a known site, prefer run_workflow, which executes the whole versioned sequence server-side, including its own re-queries and retries, instead of hand-driving each click and risking a stale reference. Supabase is internal transport and should not be mentioned to the user unless troubleshooting.",
      capabilities: { logging: {} }
    }
  );

  const defineTool = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    handler: (
      args: never,
      extra: ProgressEmitter
    ) => unknown
  ) => unknown;
  (server as unknown as {
    registerTool: unknown
  }).registerTool = (
    name: string,
    config: unknown,
    handler: (
      args: never,
      extra: ProgressEmitter
    ) => unknown
  ) => defineTool(name, config, (
    args: never,
    extra: ProgressEmitter
  ) =>
    progressScope.run(extra, () => handler(args, extra)));

  registerTools(server, {
    execute,
    executeScreenshot,
    runWorkflow,
    runAdhoc,
    runTask,
    rpc,
    textResult,
    toolError,
    callVmHost,
    vmRunResult,
    rpcErrorParts,
    db,
    deviceName,
    provider,
    caller
  });

  return server;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: corsHeadersFor(req)
  });
  if (isWsUpgrade(req)) return serveMcpSocket(req);
  const url = new URL(req.url);

  if (url.pathname.endsWith("/health")) {
    return json(req, {
      ok: true,
      service: "opera-agent-mcp",
      transport: "streamable-http",
      authConfigured: !!STATIC_TOKEN || ALLOWED_USER_IDS.size > 0 || ALLOWED_USER_EMAILS.size > 0
    });
  }

  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json(req, {
      resource: publicBaseUrl(),
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ["header"],
      scopes_supported: [
        "openid",
        "email"
      ]
    });
  }

  if (req.method !== "POST") return json(req, {
    error: "method_not_allowed",
    error_description: "Use POST for stateless Streamable HTTP MCP."
  }, 405);

  if (!SUPABASE_URL) {
    return json(req, {
      error: "server_misconfigured",
      error_description: "MCP authentication is not configured."
    }, 503);
  }
  const requestStartedAt = Date.now();
  const authContext = await authenticate(req);
  if (!authContext) return unauthorized(req);
  const deviceName = await resolveDeviceName(authContext, req);
  if (!deviceName) return unauthorized(req);
  const provider = await resolveProvider(req, authContext);
  const caller: VmCaller | null = authContext.type === "user"
    ? {
      userId: authContext.userId,
      token: bearerToken(req)
    }
    : null;
  const identityDoneAt = Date.now();

  try {
    const server = createServer(deviceName, provider, caller);
    const serverBuiltAt = Date.now();

    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: false });
    await server.connect(transport);
    const connectedAt = Date.now();
    const response = await transport.handleRequest(req);
    const handledAt = Date.now();
    const headers = new Headers(response.headers);

    headers.delete("Access-Control-Allow-Origin");
    for (const [key, value] of Object.entries(corsHeadersFor(req))) headers.set(key, value);
    headers.set("x-opera-edge-identity-ms", String(identityDoneAt - requestStartedAt));
    headers.set("x-opera-edge-build-ms", String(serverBuiltAt - identityDoneAt));
    headers.set("x-opera-edge-connect-ms", String(connectedAt - serverBuiltAt));
    headers.set("x-opera-edge-handle-ms", String(handledAt - connectedAt));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (error) {
    createEdgeLog({}).error("opera-agent-mcp", errorMessage(error));
    return json(req, {
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error."
      },
      id: null
    }, 500);
  }
});
