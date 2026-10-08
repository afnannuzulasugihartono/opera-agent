// @last-edited: 2026-10-07 UTC+7.
// @title: index — Repository file.
// @state: three more places claimed the background pointer was invisible.
// @dependencies: edge-runtime, mcp, webStandardStreamableHttp, supabase-js, v4, edge-log, cors.

import "@supabase/edge-runtime";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import * as z from "zod/v4";
import { createEdgeLog } from "../_shared/edge-log.js";
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from "../_shared/cors.js";
import { digestCanonical } from "../../../lib/goal-ledger.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STATIC_TOKEN = Deno.env.get("OPERA_AGENT_MCP_TOKEN") || "";
const DEVICE_NAME = Deno.env.get("OPERA_AGENT_MCP_DEVICE_NAME") || "opera";
const ALLOWED_USER_IDS = new Set(
  (Deno.env.get("OPERA_AGENT_MCP_USER_IDS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const ALLOWED_USER_EMAILS = new Set(
  (Deno.env.get("OPERA_AGENT_MCP_USER_EMAILS") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Fail-closed CORS: the allow origin is echoed ONLY for exact allowlist
// matches (CORS_ALLOWED_ORIGINS env override, else the extension + consent
// page defaults). A missing or non-allowlisted Origin gets no ACAO header.

const CORS_BASE_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, content-type, last-event-id, mcp-protocol-version, mcp-session-id, x-opera-device, x-opera-provider",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-protocol-version, mcp-session-id",
  "Cache-Control": "no-store"
};

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req, CORS_DEFAULT_ORIGINS);
  return origin === null
    ? { ...CORS_BASE_HEADERS }
    : { ...CORS_BASE_HEADERS, "Access-Control-Allow-Origin": origin };
}

const tabIdSchema = z.number().int().nonnegative()
  .describe("Explicit Opera automation target tab ID returned by open_url or list_tabs.");
const executionModeSchema = z.enum(["background", "foreground"]).optional()
  .describe("Execution mode. Defaults to background. Foreground never activates a tab automatically.");
const timeoutSchema = z.number().int().min(500).max(30000).optional()
  .describe("Maximum wait in milliseconds.");
const burstTimeoutSchema = z.number().int().min(500).max(12000).optional()
  .describe("Maximum total burst duration in milliseconds; defaults to and cannot exceed 12000.");
const workflowNameSchema = z.string().min(1).max(200).regex(/^[a-z0-9_.-]+$/)
  .describe("Registered workflow name, e.g. youtube.skip_ads.");
const lowercaseLetters = "abcdefghijklmnopqrstuvwxyz".split("");
const uppercaseLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const digits = "0123456789".split("");
const navigationKeySchema = z.enum(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space", "Backspace", "Delete", "Comma", "Period", "Slash", ...lowercaseLetters, ...uppercaseLetters, ...digits]);
const modifierSchema = z.enum(["alt", "control", "ctrl", "shift", "meta", "cmd", "command", "option", "super", "win"]);
const burstStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    tabId: tabIdSchema.optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(300).max(12000).optional(),
    includeElements: z.boolean().optional(),
    maxElements: z.number().int().min(1).max(300).optional()
  }).strict(),
  z.object({
    action: z.literal("find"),
    tabId: tabIdSchema.optional(),
    text: z.string().max(300).optional(),
    role: z.string().max(80).optional(),
    tag: z.string().max(80).optional(),
    exact: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional()
  }).strict(),
  z.object({
    action: z.literal("click"),
    tabId: tabIdSchema.optional(),
    ref: z.string().min(1).max(300).optional(),
    refFromStep: z.number().int().nonnegative().optional()
      .describe("Take the ref from the items of an earlier burst step in the same burst (0-based step index). Keeps find+click atomic for dynamic UIs."),
    refIndex: z.number().int().nonnegative().optional()
  }).strict().refine((step) => !!step.ref || step.refFromStep !== undefined, "Burst click requires ref or refFromStep."),
  z.object({
    action: z.literal("fill"),
    tabId: tabIdSchema.optional(),
    ref: z.string().min(1).max(300).optional(),
    refFromStep: z.number().int().nonnegative().optional(),
    refIndex: z.number().int().nonnegative().optional(),
    value: z.string().max(20000)
  }).strict().refine((step) => !!step.ref || step.refFromStep !== undefined, "Burst fill requires ref or refFromStep."),
  z.object({
    action: z.literal("key"),
    tabId: tabIdSchema.optional(),
    key: navigationKeySchema.optional(),
    modifiers: z.array(modifierSchema).max(4).optional(),
    text: z.string().min(1).max(20000).optional()
  }).strict(),
  z.object({
    action: z.literal("scroll"),
    tabId: tabIdSchema.optional(),
    x: z.number().min(-1000000).max(1000000).optional(),
    y: z.number().min(-1000000).max(1000000),
    absolute: z.boolean().optional(),
    smooth: z.boolean().optional()
  }).strict(),
  z.object({
    action: z.literal("hover"),
    tabId: tabIdSchema.optional(),
    ref: z.string().max(200).optional(),
    refFromStep: z.number().int().nonnegative().max(7).optional(),
    refIndex: z.number().int().nonnegative().max(30).optional(),
    text: z.string().max(300).optional()
      .describe("Optional submenu name to wait for after the hover, e.g. \"Page numbers\"."),
    timeoutMs: z.number().int().min(50).max(8000).optional()
  }).strict(),
  z.object({
    action: z.literal("wait"),
    tabId: tabIdSchema.optional(),
    ref: z.string().min(1).max(300).optional(),
    selector: z.string().min(1).max(500).optional(),
    text: z.string().min(1).max(300).optional(),
    visibleOnly: z.boolean().optional(),
    timeoutMs: z.number().int().min(50).max(8000).optional(),
    intervalMs: z.number().int().min(25).max(1000).optional()
  }).strict().refine((step) => !!(step.ref || step.selector || step.text), "Wait requires ref, selector, or text."),
  z.object({
    action: z.literal("pointer"),
    tabId: tabIdSchema.optional(),
    pointerAction: z.enum(["move", "click", "drag", "wheel"]),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    endX: z.number().nonnegative().optional(),
    endY: z.number().nonnegative().optional(),
    deltaX: z.number().min(-1200).max(1200).optional(),
    deltaY: z.number().min(-1200).max(1200).optional()
  }).strict().superRefine((step, ctx) => {
    if (step.pointerAction === "drag" && (step.endX == null || step.endY == null)) {
      ctx.addIssue({ code: "custom", message: "Drag requires endX and endY." });
    }
    if (step.pointerAction === "wheel" && step.deltaY == null) {
      ctx.addIssue({ code: "custom", message: "Wheel requires deltaY." });
    }
  }),
  z.object({
    action: z.literal("navigate"),
    tabId: tabIdSchema.optional(),
    url: z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed.").describe("HTTP/HTTPS URL to navigate to. A navigation replaces the document: refs minted before it cannot be used after it.")
  }).strict()
]);

const loopSensorSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["regionHash", "pixelDiff", "templateMatch", "timer", "stillness", "track"]),
  region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  threshold: z.number().min(0).max(1).optional(),
  template: z.string().min(1).max(32768).optional(),
  everyMs: z.number().int().min(50).max(60000).optional(),
  stillTicks: z.number().int().min(2).max(600).optional(),
  leadMs: z.number().int().min(50).max(5000).optional(),
  pad: z.number().min(0).max(2000).optional()
});
const loopProgramSchema = z.object({
  tickMs: z.number().int().min(1).max(360000).optional(),
  maxTicks: z.number().int().min(1).max(3600).optional(),
  maxDurationMs: z.number().int().min(50).max(120000).optional(),
  sensors: z.array(loopSensorSchema).min(1).max(8),
  rules: z.array(z.object({
    when: z.object({ sensor: z.string().min(1).max(80) }),
    do: z.record(z.string(), z.unknown())
  })).min(1).max(32),
  stopWhen: z.array(z.object({ sensor: z.string().min(1).max(80) })).optional(),
  trusted: z.boolean().optional()
});

type AuthContext = { type: "static" } | { type: "user"; userId: string };
type TargetTab = { tabId: number };
type ExecutionMode = "background" | "foreground";
type VmCaller = { userId: string; token: string };

async function resolveDeviceName(auth: AuthContext, req?: Request): Promise<string> {
  if (auth.type === "static") return DEVICE_NAME;
  const deviceFromHeader = req?.headers.get("x-opera-device")?.trim() || "";
  let query = supabase.from("opera_devices").select("device_name").eq("user_id", auth.userId).neq("status", "disabled");
  if (deviceFromHeader) {
    query = query.eq("device_name", deviceFromHeader);
  }
  query = query.limit(1);
  const { data } = await query.single();
  if (data?.device_name) return data.device_name;
  if (deviceFromHeader) return deviceFromHeader;
  return DEVICE_NAME;
}

// WHY a header first, User-Agent second: harnesses that can send headers
// (OpenCode, Kilo, Claude Code) name themselves exactly via X-Opera-Provider,
// while harnesses that cannot (ChatGPT, Claude.ai connectors) are identified by
// their server-side User-Agent. Either way the provider is advisory metadata for
// the dashboard, never an access decision — isolation rests on user_id.

const PROVIDER_PATTERNS: Array<[RegExp, string]> = [
  [/opencode/i, "opencode"],
  [/\bkilo/i, "kilo"],
  [/chatgpt|openai-connector|oai-mcp/i, "chatgpt"],
  [/claude/i, "claude"],
  [/\bcursor/i, "cursor"],
  [/windsurf/i, "windsurf"],
  [/\bcline\b/i, "cline"],
  [/roo[ -]?code/i, "roo"],
  [/\baider\b/i, "aider"],
  [/\bgoose\b/i, "goose"],
  [/\bzed\b/i, "zed"],
  [/vscode|visual studio code/i, "vscode"],
  [/mcp-inspector/i, "inspector"],
  [/postman/i, "postman"],
  [/\bcurl\b/i, "curl"],
  [/python|httpx|urllib|aiohttp/i, "script"],
  [/node|undici|deno/i, "script"],
];

function slugifyProvider(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

// WHY the OAuth client name last: ChatGPT-style connectors cannot send custom
// headers and their server-side User-Agent carries no product name, but their
// dynamically registered OAuth client does ("ChatGPT"). The JWT is already
// verified by authenticate(); only its client_id claim is read here, and the
// result stays advisory metadata — isolation rests on user_id.

async function resolveProvider(req: Request, auth?: AuthContext | null): Promise<string> {
  const header = req.headers.get("x-opera-provider")?.trim().slice(0, 64) || "";
  if (/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(header)) return header.toLowerCase();
  const ua = req.headers.get("user-agent") || "";
  for (const [re, name] of PROVIDER_PATTERNS) if (re.test(ua)) return name;

  // WHY the OAuth client name last: ChatGPT-style connectors cannot send custom
  // headers and their server-side User-Agent carries no product name, but their
  // dynamically registered OAuth client does ("ChatGPT"). The JWT is already
  // verified by authenticate(); only its client_id claim is read here, and the
  // result stays advisory metadata — isolation rests on user_id.

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
    } catch { /* dashboard metadata only */ }
  }
  return "unknown";
}

class CommandFailure extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CommandFailure";
    this.code = code;
    this.details = details;
  }
}

function json(req: Request, data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json", ...extraHeaders }
  });
}

function secureEqual(left: string, right: string) {
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

// WHY an empty allowlist admits nobody rather than every confirmed account: every
// caller drives the same device, DEVICE_NAME, and sign-up is open, so admitting
// whoever Supabase confirms would hand a stranger the owner's browser. Access is the
// static token or a named account until the device is resolved per account.

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = bearerToken(req);
  if (!token) return null;
  if (STATIC_TOKEN && secureEqual(token, STATIC_TOKEN)) return { type: "static" };
  if (ALLOWED_USER_IDS.size === 0 && ALLOWED_USER_EMAILS.size === 0) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const email = data.user.email.toLowerCase();
  if (!ALLOWED_USER_IDS.has(data.user.id) && !ALLOWED_USER_EMAILS.has(email)) return null;
  return { type: "user", userId: data.user.id };
}

function publicBaseUrl() {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/opera-agent-mcp`;
}

function unauthorized(req: Request) {
  const metadata = `${publicBaseUrl()}/.well-known/oauth-protected-resource`;
  return json(
    req,
    { error: "unauthorized", error_description: "A valid Opera Agent access token is required." },
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
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function toolError(error: unknown) {
  // Statement timeouts cancel the server-side wait, not the browser action:
  // the outcome is unknown, so the model must verify state before retrying
  // instead of treating the tool result as a definite failure.
  const raw = errorMessage(error);
  if (/statement timeout/i.test(raw)) {
    const unknownFailure = {
      code: "AWAIT_OUTCOME_UNKNOWN",
      outcome: "unknown",
      message: "The action result is unknown: the server stopped waiting before the browser reported back. The action may still have succeeded — verify the page state before repeating the action."
    };
    const structuredContent = { ok: false, error: unknownFailure };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
      structuredContent,
      isError: true
    };
  }
  const failure = error instanceof CommandFailure
    ? {
        code: error.code, message: error.message,
        ...(error.details && (error.details as { outcome?: unknown }).outcome === "unknown" ? { outcome: "unknown" } : {}),
        ...(error.details ? { details: error.details } : {})
      }
    : { code: "MCP_EXECUTION_ERROR", message: errorMessage(error) };
  const structuredContent = { ok: false, error: failure };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true
  };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function runCommand(method: string, params: Record<string, unknown> = {}, timeoutMs = 12000, deviceName: string = DEVICE_NAME, provider = "") {
  const boundedTimeout = Math.max(500, Math.min(30000, timeoutMs));
  const queued = await rpc("opera_enqueue", {
    p_method: method,
    p_params: params,
    p_timeout_ms: boundedTimeout,
    p_device_name: deviceName,
    p_request_id: crypto.randomUUID()
  });
  if (!queued?.ok || !queued.commandId) {
    throw new Error(String(queued?.error || `Unable to queue ${method}.`));
  }
  if (provider) {
    // WHY best-effort and never fatal: the provider is dashboard metadata, and a
    // stamp failure must not fail a command that is already queued and billable.
    try {
      await supabase.from("opera_commands").update({ provider }).eq("id", String(queued.commandId));
    } catch { /* dashboard metadata only */ }
  }
  // opera_await_adaptive rather than opera_await: identical signature and
  // response envelope, but its ramp starts at 5ms instead of a flat 50ms, so a
  // fast action is noticed sooner. Phase A measured the two at the same loop
  // iteration count, so this is latency, not database cost. page.capture keeps
  // opera_await_capture, which scrubs and rewrites the stored screenshot.
  const awaitFunction = method === "page.capture" ? "opera_await_capture" : "opera_await_adaptive";
  const completed = await rpc(awaitFunction, {
    p_command_id: queued.commandId,
    p_timeout_ms: Math.min(32000, boundedTimeout + 2000)
  });
    if (!completed?.ok) {
    const detail = completed?.error;
    const code = detail && typeof detail === "object" && "code" in detail
      ? String((detail as { code?: unknown }).code || "COMMAND_FAILED")
      : "COMMAND_FAILED";
    const message = detail && typeof detail === "object" && "message" in detail
      ? String((detail as { message?: unknown }).message)
      : String(detail || `${method} failed.`);
    const details = detail && typeof detail === "object" && "details" in detail
      && (detail as { details?: unknown }).details && typeof (detail as { details?: unknown }).details === "object"
      ? (detail as { details: Record<string, unknown> }).details
      : undefined;
    if (code === "AWAIT_TIMEOUT") {
      // The await deadline cancels the server-side wait, not the
      // browser action — the outcome is unknown (parity with the
      // statement-timeout envelope), so the model must verify page state
      // before repeating the action instead of treating it as a failure.
      throw new CommandFailure(
        "AWAIT_OUTCOME_UNKNOWN",
        "The action result is unknown: the server stopped waiting before the browser reported back. The action may still have succeeded — verify the page state before repeating the action.",
        { method, outcome: "unknown" }
      );
    }
    throw new CommandFailure(code, message, { method, ...(details || {}) });
  }
  return {
    ok: true,
    commandId: completed.commandId,
    status: completed.status,
    result: completed.result,
    timing: completed.timing
  };
}

function execute(method: string, params: Record<string, unknown>, timeoutMs?: number, deviceName: string = DEVICE_NAME, provider = "") {
  return runCommand(method, params, timeoutMs, deviceName, provider).then(textResult).catch(toolError);
}

// Variant for screenshot captures
function executeScreenshot(params: Record<string, unknown>, timeoutMs?: number, deviceName: string = DEVICE_NAME, provider = "") {
  return runCommand("page.capture", params, timeoutMs, deviceName, provider).then(screenshotResult).catch(toolError);
}

function screenshotResult(value: Record<string, unknown>) {
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : {};
  const screenshot = result.screenshot && typeof result.screenshot === "object" ? result.screenshot as Record<string, unknown> : {};
  const data = typeof screenshot.data === "string" ? screenshot.data : "";
  const mimeType = typeof screenshot.mimeType === "string" ? screenshot.mimeType : "image/jpeg";
  const metadataScreenshot = { ...screenshot };
  delete metadataScreenshot.data;
  const structuredContent = { ...value, result: { ...result, screenshot: metadataScreenshot } };
  const content: Array<
    { type: "text"; text: string } |
    { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: JSON.stringify(structuredContent) }];
  if (data) content.unshift({ type: "image", data, mimeType });
  return { content, structuredContent };
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Versioned site workflows are the normal path for repeated multi-step
// intents: opera_start_workflow snapshots the definition, inserts the run, and
// fires the runner itself via pg_net, so a single RPC starts the whole plan.
// The runner re-queries fresh controls on every retry iteration, which keeps
// fast-changing UIs (ad overlays) from dying between observation and action.
async function runWorkflow(name: string, input: Record<string, unknown>, waitTimeoutMs: number, deviceName: string = DEVICE_NAME, provider = "") {
  const started = await rpc("opera_start_workflow", {
    p_name: name,
    p_input: input,
    p_timeout_ms: Math.max(1000, Math.min(120000, waitTimeoutMs)),
    p_device_name: deviceName
  });
  if (!started?.ok || !started.runId) {
    const detail = started?.error;
    const code = detail && typeof detail === "object" && "code" in detail
      ? String((detail as { code?: unknown }).code || "WORKFLOW_START_FAILED")
      : "WORKFLOW_START_FAILED";
    const message = detail && typeof detail === "object" && "message" in detail
      ? String((detail as { message?: unknown }).message)
      : "Unable to start workflow.";
    throw new CommandFailure(code, message);
  }
  const runId = String(started.runId);
  if (provider) {
    try {
      await supabase.from("opera_workflow_runs").update({ provider }).eq("id", runId);
    } catch { /* dashboard metadata only */ }
  }
  const startedAt = Date.now();
  let last: Record<string, unknown> | null = null;
  while (Date.now() - startedAt < waitTimeoutMs + 8000) {
    await sleepMs(400);
    last = await rpc("opera_get_workflow_run", { p_run_id: runId }) as Record<string, unknown> | null;
    if (last?.ok && !["queued", "running"].includes(String(last.status))) break;
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

// Sealing for run_program mirrors the producer contract pinned by
// tests/vm-program-intake.test.mjs: children, read-only methods, full budgets,
// single-call digestCanonical, tenantId of the caller. Anything unsealable is
// refused here, never widened, because the VM host re-validates regardless.

const VM_PROGRAM_VERSION = "OA_REACTIVE_VM_V1";

const VM_READ_ONLY_METHODS = new Set([
  "browser.ping", "browser.burst", "tabs.list", "tabs.get", "tabs.find",
  "page.read", "page.query", "page.find", "page.collect_links", "page.capture",
  "page.wait_for", "media.state"
]);

const VM_OBSERVATION_METHODS = new Set([
  "page.read", "page.query", "page.find", "page.collect_links", "page.capture",
  "page.wait_for", "media.state"
]);

const VM_BURST_STEP_ACTIONS = new Set(["read", "find", "wait"]);

// Maxima copied verbatim from validateBudgets in lib/reactive-vm.js. A missing
// key is filled from VM_BUDGET_DEFAULTS one at a time; a provided key outside
// its maximum is refused, never clamped, so the tool cannot widen the VM.

const VM_BUDGET_MAXIMA: Record<string, number> = {
  serializedProgramBytes: 131072,
  astNodes: 256,
  astDepth: 12,
  controlFlowDepth: 4,
  executedNodesPerRun: 1000,
  browserCommandLeavesPerRun: 200,
  iterationsPerLoop: 50,
  totalIterationsPerRun: 250,
  waitEventTimeoutMs: 15000,
  cumulativeWaitMs: 60000,
  retryAttemptsPerNode: 3,
  collectionItemsPerBinding: 1000,
  bindings: 64,
  persistedCheckpointBytes: 131072,
  returnedResultBytes: 131072,
  executionSliceMs: 20000,
  runDeadlineMs: 300000
};

const VM_BUDGET_DEFAULTS: Record<string, number> = {
  serializedProgramBytes: 16384,
  astNodes: 64,
  astDepth: 8,
  controlFlowDepth: 2,
  executedNodesPerRun: 200,
  browserCommandLeavesPerRun: 12,
  iterationsPerLoop: 10,
  totalIterationsPerRun: 50,
  waitEventTimeoutMs: 5000,
  cumulativeWaitMs: 15000,
  retryAttemptsPerNode: 2,
  collectionItemsPerBinding: 100,
  bindings: 16,
  persistedCheckpointBytes: 16384,
  returnedResultBytes: 16384,
  executionSliceMs: 8000,
  runDeadlineMs: 60000
};

function isVmRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertSealableNode(node: unknown, path: string, depth = 1): void {
  if (depth > 64) throw new CommandFailure("INVALID_PROGRAM", `${path} nests deeper than the sealing walk.`);
  if (!isVmRecord(node)) throw new CommandFailure("INVALID_PROGRAM", `${path} must be an object.`);
  if (Object.hasOwn(node, "steps")) {
    throw new CommandFailure("INVALID_PROGRAM", `${path} must use children, never steps.`);
  }
  switch (node.type) {
    case "SEQUENCE": {
      if (!Array.isArray(node.children)) throw new CommandFailure("INVALID_PROGRAM", `${path}.children must be an array.`);
      node.children.forEach((child, index) => assertSealableNode(child, `${path}.children[${index}]`, depth + 1));
      return;
    }
    case "IF": {
      assertSealableNode(node.then, `${path}.then`, depth + 1);
      if (node.else !== undefined) assertSealableNode(node.else, `${path}.else`, depth + 1);
      return;
    }
    case "LOOP":
    case "UNTIL":
    case "RETRY": {
      assertSealableNode(node.body, `${path}.body`, depth + 1);
      return;
    }
    case "COMMAND": {
      if (typeof node.method !== "string" || !VM_READ_ONLY_METHODS.has(node.method)) {
        throw new CommandFailure("DISALLOWED_COMMAND", `${path}.method is not read-only in OA_REACTIVE_VM_V1.`);
      }
      if (node.method === "browser.burst") {
        const args = isVmRecord(node.arguments) ? node.arguments : null;
        const steps = args && Array.isArray(args.steps) ? args.steps : null;
        if (!steps || steps.length < 1 || steps.some((step) => !isVmRecord(step) || !VM_BURST_STEP_ACTIONS.has(String(step.action)))) {
          throw new CommandFailure("DISALLOWED_COMMAND", `${path} carries a disallowed browser.burst step.`);
        }
      }
      return;
    }
    case "WAIT_EVENT": {
      const observation = isVmRecord(node.observation) ? node.observation : null;
      if (!observation || typeof observation.method !== "string" || !VM_OBSERVATION_METHODS.has(observation.method)) {
        throw new CommandFailure("DISALLOWED_COMMAND", `${path}.observation.method is not read-only.`);
      }
      return;
    }
    case "ASSERT":
    case "COLLECT":
    case "DEDUP":
    case "RETURN":
    case "SUSPEND":
      return;
    default:
      throw new CommandFailure("INVALID_PROGRAM", `${path}.type is not executable in OA_REACTIVE_VM_V1.`);
  }
}

async function sealVmProgram(programInput: unknown, caller: VmCaller): Promise<Record<string, unknown>> {
  if (!isVmRecord(programInput)) throw new CommandFailure("INVALID_PROGRAM", "program must be an object.");
  if (programInput.schemaVersion !== VM_PROGRAM_VERSION) {
    throw new CommandFailure("INVALID_PROGRAM", "program.schemaVersion must be OA_REACTIVE_VM_V1.");
  }
  for (const field of ["programId", "goalId"]) {
    const value = programInput[field];
    if (typeof value !== "string" || value.length < 1 || new TextEncoder().encode(value).length > 128) {
      throw new CommandFailure("INVALID_PROGRAM", `program.${field} must be a bounded string.`);
    }
  }
  if (!Number.isSafeInteger(programInput.goalRevision) || programInput.goalRevision < 1) {
    throw new CommandFailure("INVALID_PROGRAM", "program.goalRevision must be a positive integer.");
  }
  if (!isVmRecord(programInput.target)) throw new CommandFailure("INVALID_PROGRAM", "program.target must be an object.");
  const root = programInput.root;
  if (!isVmRecord(root) || !Array.isArray(root.children)) {
    throw new CommandFailure("INVALID_PROGRAM", "program.root must use children, never steps.");
  }
  assertSealableNode(root, "program.root");
  const provided = isVmRecord(programInput.budgets) ? programInput.budgets : {};
  const budgets: Record<string, number> = {};
  for (const key of Object.keys(VM_BUDGET_MAXIMA)) {
    if (!(key in provided)) {
      budgets[key] = VM_BUDGET_DEFAULTS[key];
      continue;
    }
    const value = provided[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new CommandFailure("INVALID_SCHEMA", `program.budgets.${key} must be a positive integer.`);
    }
    if (value > VM_BUDGET_MAXIMA[key]) {
      throw new CommandFailure("OVER_LIMIT", `program.budgets.${key} exceeds the frozen maximum ${VM_BUDGET_MAXIMA[key]}.`);
    }
    budgets[key] = value;
  }
  for (const key of Object.keys(provided)) {
    if (!(key in VM_BUDGET_MAXIMA)) throw new CommandFailure("INVALID_SCHEMA", `program.budgets.${key} is not a VM budget.`);
  }
  const { programDigest: _ignored, ...body } = programInput;
  const sealed: Record<string, unknown> = { ...body, budgets, tenantId: caller.userId };
  sealed.programDigest = await digestCanonical(sealed);
  return sealed;
}

// The VM host authenticates the same allowlisted user JWT the caller used on
// this server, so the POST forwards Authorization unchanged: minting identity
// here would let one tenant enqueue as another. No new header names, and the
// token never travels in the URL.

async function callVmHost(
  operation: string,
  body: { program: unknown; requestId: unknown },
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
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ operation, program, requestId: body.requestId }) });
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
    const detail = envelope && typeof envelope === "object" ? (envelope as { error?: unknown }).error : null;
    const inner = detail && typeof detail === "object" ? (detail as { code?: unknown; message?: unknown }) : {};
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

function createServer(deviceName: string = DEVICE_NAME, provider = "", caller: VmCaller | null = null) {
  const server = new McpServer(
    { name: "opera-agent", version: "1.6.0" },
    {
      instructions: "Use Opera Agent whenever the user asks to open, navigate, inspect, click, type, scroll, visually inspect, or otherwise operate their local Opera browser. Check browser_status first. Keep normal automation in background: open_url defaults to an inactive tab, retain its returned tabId, and pass that exact tabId to every later page or navigation tool. Never substitute the user's active tab during a multi-step task. Prefer run_browser_burst for two or more dependent actions on one target tab and prefer element references from read_page/find_elements. For dynamic or fast-changing UIs (video players, ad overlays, countdown controls) run find, click, and a wait verification inside ONE run_browser_burst call, passing the found ref to the click step via refFromStep so the reference is consumed within milliseconds of being minted; do not split find and click into separate round trips there. The same rule applies to MENUS and DIALOGS, which re-render their own DOM every time they open: a ref for a menu entry or a dialog control is usually stale by the next round trip. Open a menu, then immediately find the entry and click it by refFromStep inside one burst rather than reading it in a separate call. For multi-level menus, use a hover burst step with the found ref via refFromStep, passing text for the submenu entry you expect it to reveal, so each level is one step that hovers and settles, and then find the submenu entry by text in the next step of the same burst; chain the levels in a single burst rather than hovering by coordinate across separate calls. Use capture_page adaptively only for initial visual observation, canvas/dynamic interfaces, low-confidence targeting, meaningful state changes, or failed verification; pass previousHash to avoid retransmitting unchanged images. Treat coordinates as stale when documentId, viewport, zoomFactor, visualScale, or screenshot hash changes. For lazy result lists, call wheel_at inside the intended list, inspect scroll.after, moved, contentChanged, and reachedBoundary, collect stableKey/href values, and repeat only with an explicit bound until the boundary is reached and no new stable keys appear. Coordinate actions default to background CDP input and draw a visible cursor marker; use them only when no reliable element ref exists and verify the resulting page state. A visible pointer is a foreground diagnostic: call activate_tab only when the user explicitly asks to watch or permits foreground interaction, then pass executionMode foreground. Never use activate_tab as an implicit recovery step. If a tool returns FOREGROUND_REQUIRED, explain the limitation and request foreground permission instead of activating anything. Never enter passwords, OTPs, payment data, upload files, publish, purchase, send, or delete without the user's explicit instruction. Surfaces rendered as canvas, editors, games, or remote screens expose little or no DOM: when read_page returns little or no useful text while the task needs visual content, use capture_page and reason from the screenshot. Icon-only controls expose a computed accessibleName that find_elements matches; when a text-poor canvas-class page still returns almost no text, read_page also includes a read-only axSummary accessibility snapshot (role and name facts only, never field values; entries are not clickable refs). If find_elements returns nothing while read_page shows the text, target an ancestor clickable element or capture the page instead of retrying the same query. Maps search results are viewport-scoped: after panning or zooming, re-read or re-search rather than trusting the earlier list, and re-find targets after any large page redraw before clicking them. When a tool reports a timeout or an unknown outcome, verify the page state before repeating the action. For OAuth/login/SSO flows, click the login control and read openedTabs in the click result: if a popup tab opened, continue inside that popup by passing its exact tabId to every later page tool — never activate it as an implicit recovery step, and ask before bringing it to the foreground. Verification on state-changing clicks and fills is expect-based: a result with verified:false means the expectation did not pass within the bounded post-action window, so re-check the page instead of immediately repeating the action; a slow SPA or OAuth redirect may still be settling. In a rich editor or canvas surface, click the editing surface first so it takes focus, then use press_key to select all with key \"a\" and modifiers [\"control\"], paste with key \"v\" and modifiers [\"control\"], insert a line break with key \"Enter\" and modifiers [\"shift\"], or pass text to type into the surface, and re-read the page to confirm the result rather than assuming the keystroke landed. If a click reports that the ref moved beyond its geometry tolerance, that stale ref is refused on purpose; the error carries candidates, each entry holding a freshRef that already passed validation, so act on one of those freshRef values directly instead of re-running find_elements. For a page that changes on its own — video players, ad overlays, countdown controls, live lists — prefer start_watch to arm a device-local trigger and then wait_events to collect what it fired. The device acts locally, so no model round trip sits between the page changing and the action happening, and you learn of it once in a single wait_events result instead of re-reading the page to notice. Arm a trigger you expect to fire later, then wait, rather than polling. For an intent you run repeatedly on a known site, prefer run_workflow, which executes the whole versioned sequence server-side, including its own re-queries and retries, instead of hand-driving each click and risking a stale reference. Supabase is internal transport and should not be mentioned to the user unless troubleshooting.",
      capabilities: { logging: {} }
    }
  );

  server.registerTool("browser_status", {
    title: "Check Opera Agent",
    description: "Check whether the user's local Opera Agent extension is online and list its capabilities. Call this first for browser-control requests.",
    inputSchema: { timeoutMs: timeoutSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ timeoutMs }: { timeoutMs?: number }) => execute("browser.ping", {}, timeoutMs, deviceName, provider));

  server.registerTool("run_browser_burst", {
    title: "Run fast Opera action burst",
    description: "Run 1-8 dependent page actions sequentially. Each step may name its own tab and defaults to the burst tab. Defaults to background execution, and coordinate steps draw a visible cursor marker. Foreground mode displays pointer steps and requires a tab the user already allowed to be activated. A step that consumes another step's ref must run on the tab that minted it, and no ref survives a navigate step on that tab. It stops at the first failure, has a 12-second total limit, and cannot open, close, loop, branch, or execute JavaScript.",
    inputSchema: {
      tabId: tabIdSchema,
      steps: z.array(burstStepSchema).min(1).max(8),
      executionMode: executionModeSchema,
      timeoutMs: burstTimeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, steps, executionMode, timeoutMs }: TargetTab & { steps: Array<Record<string, unknown>>; executionMode?: ExecutionMode; timeoutMs?: number }) => {
    const params = executionMode === "foreground" ? { tabId, steps, executionMode } : { tabId, steps };
    return execute("browser.burst", params, timeoutMs, deviceName, provider);
  });

  server.registerTool("run_workflow", {
    title: "Run Opera Agent workflow",
    description: "Run a versioned site workflow (for example youtube.skip_ads) end to end on the paired Opera device: ad detection, retrying skip clicks against freshly re-queried controls, and ad-state verification all happen inside one run. Use this for known repeated intents instead of hand-driving each click and risking stale element references.",
    inputSchema: {
      name: workflowNameSchema,
      input: z.record(z.string(), z.unknown()).optional()
        .describe("Workflow input object, shaped by the workflow definition."),
      timeoutMs: z.number().int().min(1000).max(120000).optional()
        .describe("Workflow timeout in milliseconds; defaults to 60000.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ name, input, timeoutMs }: { name: string; input?: Record<string, unknown>; timeoutMs?: number }) =>
    runWorkflow(name, input || {}, timeoutMs ?? 60000, deviceName, provider).then(textResult).catch(toolError));

  server.registerTool("run_program", {
    title: "Run Opera Agent program",
    description: "Run a gate-approved OA_REACTIVE_VM_V1 read-only program end to end on the paired Opera device without the model in the loop: the VM host enqueues it, the device executes read/verify commands, and verification evidence returns in status/result. Use this for ad-hoc multi-step read intents instead of hand-driving each find. Write actions are refused here; they run as registered workflows via run_workflow.",
    inputSchema: {
      program: z.object({}).passthrough()
        .describe("A compileGoalPlan-approved program object (schemaVersion OA_REACTIVE_VM_V1) with children (never steps) and read-only methods. The tool fills full budgets, sets tenantId to the caller, and seals programDigest before enqueue; anything unsealable is refused."),
      requestId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]{1,100}$/)
        .describe("Idempotency key; a malformed key is rejected so replay protection is never silent here."),
    },
  }, async ({ program, requestId }: { program: Record<string, unknown>; requestId: string }) =>
    callVmHost("enqueue", { program, requestId }, deviceName, provider, caller).then(vmRunResult).catch(toolError));

  server.registerTool("start_watch", {
    title: "Start live watch",
    description: "Arm a device-local trigger on an Opera tab: when the trigger condition becomes true (already-true-at-arm fires immediately), the device executes the action locally and an event appears in wait_events — no model round trip in between. Prefer this over polling with repeated find/read calls on fast-changing pages (ad overlays, countdowns, dynamic lists). Trigger kinds: selectorPresence, selectorGone, textMatch, urlChange, navigation, adState, mediaTime. Action types: report (default), click, burst, workflow, confirm.",
    inputSchema: {
      tabId: tabIdSchema,
      rule: z.object({
        ruleId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
        trigger: z.object({
          kind: z.enum(['selectorPresence', 'selectorGone', 'textMatch', 'urlChange', 'navigation', 'adState', 'mediaTime']),
          selector: z.string().min(1).max(500).optional(),
          adSelectors: z.array(z.string().min(1).max(500)).max(8).optional(),
          text: z.string().min(1).max(500).optional(),
          mode: z.enum(['contains', 'exact']).optional(),
          state: z.enum(['on', 'off', 'any']).optional(),
          atSeconds: z.number().min(0).max(86400).optional(),
          withinSeconds: z.number().min(0).max(60).optional()
        }),
        action: z.object({
          type: z.enum(['report', 'click', 'burst', 'workflow', 'confirm']).default('report'),
          selector: z.string().max(500).optional(),
          trusted: z.boolean().optional(),
          steps: z.array(z.record(z.string(), z.unknown())).max(8).optional(),
          workflowName: z.string().max(100).optional(),
          params: z.record(z.string(), z.unknown()).optional(),
          message: z.string().max(500).optional()
        }),
        mode: z.enum(['once', 'repeat']).optional(),
        maxEvents: z.number().int().min(1).max(100).optional(),
        deadlineMs: z.number().int().min(1000).max(600000).optional(),
        debounceMs: z.number().int().min(0).max(60000).optional()
      }),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, rule, timeoutMs }: TargetTab & { rule: Record<string, unknown>; timeoutMs?: number }) => execute("watch.start", { tabId, rule }, timeoutMs, deviceName, provider));

  server.registerTool("wait_events", {
    title: "Wait for watch events",
    description: "Long-poll for device-local watch events (from start_watch). Returns immediately when one or more events arrive; returns an empty list after the wait window. Pass the returned cursor on the next call to receive only newer events. Events carry the fired rule, the page URL/adState/mediaTime, and the local action result (click/burst/workflow outcome).",
    inputSchema: {
      watcherId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().describe("Only events from this watcher."),
      cursor: z.number().int().min(0).optional().describe("Pass the cursor from the previous wait_events result."),
      waitMs: z.number().int().min(500).max(30000).optional().describe("Alias for timeoutMs, kept for existing callers."),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      events: z.array(z.object({
        id: z.number().int(),
        watcher_id: z.string(),
        device_name: z.string(),
        envelope: z.record(z.string(), z.unknown()),
        created_at: z.string()
      })),
      cursor: z.number().int(),
      count: z.number().int()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, ({ watcherId, cursor, waitMs, timeoutMs }: { watcherId?: string; cursor?: number; waitMs?: number; timeoutMs?: number }) =>
    rpc("opera_watch_events_wait", {
      p_watcher: watcherId ?? null,
      p_after_seq: cursor ?? 0,
      p_timeout_ms: Math.max(500, Math.min(30000, timeoutMs ?? waitMs ?? 25000))
    }).then(textResult).catch(toolError));

  server.registerTool("stop_watch", {
    title: "Stop live watch",
    description: "Disarm one watcher by id (stop_watch) or every active watcher (stopAll). Watchers also self-retire at their deadline/maxEvents, when their tab closes, or via the popup kill switch.",
    inputSchema: {
      watcherId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
      stopAll: z.boolean().optional(),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, ({ watcherId, stopAll, timeoutMs }: { watcherId?: string; stopAll?: boolean; timeoutMs?: number }) =>
    stopAll
      ? execute("watch.stop_all", {}, timeoutMs, deviceName, provider)
      : execute("watch.stop", { watcherId }, timeoutMs, deviceName, provider));

  server.registerTool("loop_start", {
    title: "Start sense-act loop",
    description: "Start a device-local sense-act loop on an Opera tab for real-time tasks (games): the device senses pixels on a 50-100ms tick and acts locally with no model round trip per action, returning a loopId immediately. Calibrate once with capture_page (identify sprites/controls), then read the text trace with loop_read and send a revised program when the trace shows a new state. tickMs below 50 is clamped by the device.",
    inputSchema: {
      tabId: tabIdSchema,
      program: loopProgramSchema,
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, program, timeoutMs }: TargetTab & { program: Record<string, unknown>; timeoutMs?: number }) => execute("loop.start", { tabId, program }, timeoutMs, deviceName, provider));

  server.registerTool("loop_read", {
    title: "Read sense-act loop",
    description: "Read a running or finished sense-act loop: tick count, fired totals, tick-band trace (green/yellow/orange/red), degrade mode, and stop reason. Cheap text — prefer this over capture_page every outer-loop turn; capture only when the trace reports an unfamiliar state.",
    inputSchema: {
      loopId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ loopId, timeoutMs }: { loopId: string; timeoutMs?: number }) => execute("loop.read", { loopId }, timeoutMs, deviceName, provider));

  server.registerTool("loop_stop", {
    title: "Stop sense-act loop",
    description: "Stop a sense-act loop and return its final trace. Loops also stop on their own at maxTicks, maxDurationMs, a stopWhen condition, repeated tick overruns, a closed tab, or a sensitive surface.",
    inputSchema: {
      loopId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ loopId, timeoutMs }: { loopId: string; timeoutMs?: number }) => execute("loop.stop", { loopId }, timeoutMs, deviceName, provider));

  server.registerTool("loop_state_start", {
    title: "Start frame-rate state loop",
    description: "Start a MAIN-world frame-rate game loop on an Opera tab (currently only the t-rex reader): the device reads exact game state and acts every animation frame locally with no screenshots and no model round trip, returning a loopId immediately. Calibrate leadMs (milliseconds of jump lead time) from observed play; read jumps and game-over events with loop_state_read.",
    inputSchema: {
      tabId: tabIdSchema,
      reader: z.enum(["trex"]),
      leadMs: z.number().int().min(50).max(2000).optional(),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, reader, leadMs, timeoutMs }: TargetTab & { reader: string; leadMs?: number; timeoutMs?: number }) => execute("loop.state_start", { tabId, reader, leadMs }, timeoutMs, deviceName, provider));

  server.registerTool("loop_state_read", {
    title: "Read frame-rate state loop",
    description: "Read a running or finished state loop: tick and jump counters plus the compact event trail (started, jump, duck-start/end, heartbeat, game-over, stopped). Cheap text; use it to supervise instead of screenshots.",
    inputSchema: {
      loopId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ loopId, timeoutMs }: { loopId: string; timeoutMs?: number }) => execute("loop.state_read", { loopId }, timeoutMs, deviceName, provider));

  server.registerTool("loop_state_stop", {
    title: "Stop frame-rate state loop",
    description: "Stop a state loop and return its final counters. Loops also stop on game-over, a closed tab, or a sensitive surface.",
    inputSchema: {
      loopId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      timeoutMs: timeoutSchema
    },
    outputSchema: {
      ok: z.boolean(),
      commandId: z.string(),
      status: z.string(),
      result: z.record(z.string(), z.unknown()),
      timing: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ loopId, timeoutMs }: { loopId: string; timeoutMs?: number }) => execute("loop.state_stop", { loopId }, timeoutMs, deviceName, provider));

  server.registerTool("list_tabs", {
    description: "List open Opera tabs, including tab IDs, titles, URLs, and active state.",
    inputSchema: { currentWindow: z.boolean().optional().describe("Only return tabs in the current Opera window.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ currentWindow }: { currentWindow?: boolean }) => execute("tabs.list", { currentWindow: currentWindow ?? false }, undefined, deviceName, provider));

  server.registerTool("open_url", {
    title: "Open URL in Opera",
    description: "Open an HTTP or HTTPS URL in a new background Opera tab and return its tab ID. Set active true only when the user explicitly asks to see the new tab or permits foreground interaction.",
    inputSchema: {
      url: z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed."),
      active: z.boolean().optional().describe("Make the new tab active. Defaults to false; use true only with explicit user permission."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ url, active, timeoutMs }: { url: string; active?: boolean; timeoutMs?: number }) => execute("tabs.open", { url, active: active ?? false, wait: true }, timeoutMs, deviceName, provider));

  server.registerTool("activate_tab", {
    title: "Activate Opera tab",
    description: "Explicitly activate an Opera tab and focus its window. Use only when the user asks to see that tab or permits foreground interaction; never use as automatic recovery.",
    inputSchema: { tabId: z.number().int().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.activate", { tabId, focusWindow: true }, undefined, deviceName, provider));

  server.registerTool("navigate_tab", {
    title: "Navigate Opera tab",
    description: "Navigate an explicit Opera target tab to an HTTP/HTTPS URL without activating it, then wait for it to load.",
    inputSchema: {
      tabId: tabIdSchema,
      url: z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, url, timeoutMs }: TargetTab & { url: string; timeoutMs?: number }) => execute("tabs.navigate", { tabId, url, wait: true }, timeoutMs, deviceName, provider));

  server.registerTool("close_tab", {
    title: "Close Opera tab",
    description: "Close one Opera tab by ID. Use only when the user asks to close it.",
    inputSchema: { tabId: z.number().int().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.close", { tabId }, undefined, deviceName, provider));

  server.registerTool("read_page", {
    title: "Read Opera page",
    description: "Read a compact task-facing page observation with reusable refs, stable keys, relevant change evidence, screen rectangles, true viewport presence, document identity, viewport geometry, and zoom. Icon-only controls carry a computed accessibleName that find_elements matches; text-poor canvas-class pages also include a read-only axSummary accessibility snapshot (role/name facts only, not clickable refs). Use pagination for long pages.",
    inputSchema: {
      tabId: tabIdSchema,
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(300).max(12000).optional(),
      includeElements: z.boolean().optional(),
      maxElements: z.number().int().min(1).max(300).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, (args: TargetTab & { offset?: number; limit?: number; includeElements?: boolean; maxElements?: number }) =>
    execute("page.read", { ...args, view: "compact" }, undefined, deviceName, provider));

  server.registerTool("capture_page", {
    title: "Capture Opera page",
    description: "Capture a bounded JPEG of an explicit Opera tab without activating it. Use adaptively for visual pages, canvas, low-confidence targets, state changes, or failed verification—not after every action. Pass the previous SHA-256 hash to suppress unchanged image data. The extension blocks incognito, user-private, password, OTP, payment, and other sensitive surfaces locally.",
    inputSchema: {
      tabId: tabIdSchema,
      crop: z.object({
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        width: z.number().positive(),
        height: z.number().positive()
      }).strict().optional().describe("Optional viewport-relative crop rectangle; it must remain fully inside the visible viewport."),
      quality: z.number().int().min(40).max(80).optional().describe("JPEG quality. Defaults to 60 and may be reduced locally to satisfy the byte limit."),
      maxWidth: z.number().int().min(320).max(1600).optional().describe("Maximum returned image width. Defaults to 1280."),
      maxHeight: z.number().int().min(240).max(1200).optional().describe("Maximum returned image height. Defaults to 900."),
      previousHash: z.string().regex(/^[a-f0-9]{64}$/i).optional().describe("SHA-256 from the prior capture; matching images return metadata without duplicate image bytes."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, crop, quality, maxWidth, maxHeight, previousHash, timeoutMs }: TargetTab & {
    crop?: { x: number; y: number; width: number; height: number };
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    previousHash?: string;
    timeoutMs?: number;
  }) => executeScreenshot({ tabId, ...(crop ? { crop } : {}), ...(quality != null ? { quality } : {}), ...(maxWidth != null ? { maxWidth } : {}), ...(maxHeight != null ? { maxHeight } : {}), ...(previousHash ? { previousHash } : {}) }, timeoutMs, deviceName, provider));

  server.registerTool("find_elements", {
    title: "Find page elements",
    description: "Find visible interactive elements by human-readable text, ARIA role, or HTML tag. Returns refs for click_element/fill_element and rectangles for pointer tools.",
    inputSchema: {
      tabId: tabIdSchema,
      text: z.string().max(300).optional(),
      role: z.string().max(80).optional(),
      tag: z.string().max(80).optional(),
      exact: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, (args: TargetTab & { text?: string; role?: string; tag?: string; exact?: boolean; limit?: number }) => execute("page.find", args, undefined, deviceName, provider));

  server.registerTool("click_element", {
    title: "Click page element",
    description: "Click an element ref on an explicit target tab using trusted browser input. Background execution is the default and does not activate the tab.",
    inputSchema: { tabId: tabIdSchema, ref: z.string().min(1).max(300), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, ref, executionMode }: TargetTab & { ref: string; executionMode?: ExecutionMode }) => execute("page.click", { tabId, ref, trusted: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("fill_element", {
    title: "Fill page field",
    description: "Fill a non-sensitive editable element by ref. The extension blocks passwords, OTPs, payment fields, and file uploads.",
    inputSchema: { tabId: tabIdSchema, ref: z.string().min(1).max(300), value: z.string().max(20000), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, ref, value, executionMode }: TargetTab & { ref: string; value: string; executionMode?: ExecutionMode }) => execute("page.fill", { tabId, ref, value, trusted: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("press_key", {
    title: "Press a key chord or type text",
    description: "Send trusted keyboard input to the focused element. Either an allowlisted key with optional modifiers (Ctrl+A selects all, Ctrl+V pastes, Shift+Enter inserts a line break in an editor, Ctrl+Shift+Z redoes), or a text string of up to 20000 characters to type into the currently focused surface, which is how you fill a rich or canvas editor. Pass exactly one of key or text. Keyboard input is refused on password, OTP, and payment fields.",
    inputSchema: {
      tabId: tabIdSchema,
      key: navigationKeySchema.optional(),
      modifiers: z.array(modifierSchema).max(4).optional()
        .describe("Held modifiers for the key chord, e.g. [\"control\"] or [\"control\",\"shift\"]. Aliases: ctrl for control, cmd for meta, option for alt, win for meta."),
      text: z.string().min(1).max(20000).optional()
        .describe("Text to type into the focused surface. Cannot be combined with key or modifiers."),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, key, modifiers, text, executionMode }: TargetTab & { key?: string; modifiers?: string[]; text?: string; executionMode?: ExecutionMode }) => execute("page.key", { tabId, ...(key != null ? { key } : {}), ...(modifiers != null ? { modifiers } : {}), ...(text != null ? { text } : {}), trusted: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("scroll_page", {
    title: "Scroll page",
    description: "Scroll an explicit target page by a relative horizontal/vertical amount, or to an absolute document position, without activating its tab. Returns before/after document scroll metrics, movement, DOM-change, settling, and boundary status.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().min(-1000000).max(1000000).optional(),
      y: z.number().min(-1000000).max(1000000),
      absolute: z.boolean().optional(),
      smooth: z.boolean().optional(),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, absolute, smooth, executionMode }: TargetTab & { x?: number; y: number; absolute?: boolean; smooth?: boolean; executionMode?: ExecutionMode }) => execute("page.scroll", { tabId, x: x ?? 0, y, absolute: absolute ?? false, behavior: smooth ? "smooth" : "instant", executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("move_pointer", {
    title: "Move pointer",
    description: "Move CDP pointer coordinates on an explicit target. A visible cursor marker is drawn in both modes so an owner can follow the run; background mode does not activate the tab. Foreground mode additionally requires an already active/focused target explicitly permitted by the user.",
    inputSchema: { tabId: tabIdSchema, x: z.number().nonnegative(), y: z.number().nonnegative(), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, x, y, executionMode }: TargetTab & { x: number; y: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "move", x, y, showCursor: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("click_at", {
    title: "Click at coordinates",
    description: "Click CDP viewport coordinates. A visible cursor marker is drawn in both modes so an owner can follow the run; background mode does not activate the tab. Foreground mode additionally requires an already active/focused target explicitly permitted by the user. Prefer click_element and verify page state.",
    inputSchema: { tabId: tabIdSchema, x: z.number().nonnegative(), y: z.number().nonnegative(), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, executionMode }: TargetTab & { x: number; y: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "click", x, y, showCursor: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("drag_pointer", {
    title: "Drag at coordinates",
    description: "Drag between CDP viewport coordinates. A visible cursor marker is drawn in both modes so an owner can follow the run; background mode does not activate the tab. Foreground mode additionally requires an already active/focused target explicitly permitted by the user.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().nonnegative(), y: z.number().nonnegative(),
      endX: z.number().nonnegative(), endY: z.number().nonnegative(),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, endX, endY, executionMode }: TargetTab & { x: number; y: number; endX: number; endY: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "drag", x, y, endX, endY, showCursor: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("wheel_at", {
    title: "Wheel at coordinates",
    description: "Wheel at viewport coordinates and report the actual scroll container, before/after metrics, movement, lazy DOM changes, settling, and reachedBoundary. A visible cursor marker is drawn in both modes so an owner can follow the run; background mode does not activate the tab and uses a deterministic DOM fallback only when the debugger event cannot move an available scroll container. Foreground mode requires an already active/focused target explicitly permitted by the user.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().nonnegative(), y: z.number().nonnegative(),
      deltaX: z.number().min(-1200).max(1200).optional(),
      deltaY: z.number().min(-1200).max(1200),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, deltaX, deltaY, executionMode }: TargetTab & { x: number; y: number; deltaX?: number; deltaY: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "wheel", x, y, deltaX: deltaX ?? 0, deltaY, showCursor: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  // WHY four separate tools and not one "media" tool with an action enum: ChatGPT-style
  // connectors list one row per tool, and a single media tool hides play behind a
  // parameter the router never offers. The device already implements all four
  // primitives; the surface simply never exposed them, so capability discovery
  // advertised what no caller could invoke.

  server.registerTool("media_state", {
    title: "Read media playback state",
    description: "Report the page audio/video elements: presence and count, paused/ended, currentTime, duration, mute and volume. Read-only. Verify playback from this state, never from the wall clock.",
    inputSchema: {
      tabId: tabIdSchema,
      index: z.number().int().min(0).optional().describe("Which media element on the page, defaulting to the first."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ tabId, index, timeoutMs }: TargetTab & { index?: number; timeoutMs?: number }) => execute("media.state", { tabId, index }, timeoutMs, deviceName, provider));

  server.registerTool("media_play", {
    title: "Start media playback",
    description: "Start playing the page media element, then report its state. If the browser blocks playback for lack of a user gesture, click the player's Play control with page.click instead.",
    inputSchema: {
      tabId: tabIdSchema,
      index: z.number().int().min(0).optional().describe("Which media element on the page, defaulting to the first."),
      executionMode: executionModeSchema,
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, index, executionMode, timeoutMs }: TargetTab & { index?: number; executionMode?: ExecutionMode; timeoutMs?: number }) => execute("media.play", { tabId, index, executionMode: executionMode ?? "background" }, timeoutMs, deviceName, provider));

  server.registerTool("media_pause", {
    title: "Pause media playback",
    description: "Pause the page media element, then report its state.",
    inputSchema: {
      tabId: tabIdSchema,
      index: z.number().int().min(0).optional().describe("Which media element on the page, defaulting to the first."),
      executionMode: executionModeSchema,
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, index, executionMode, timeoutMs }: TargetTab & { index?: number; executionMode?: ExecutionMode; timeoutMs?: number }) => execute("media.pause", { tabId, index, executionMode: executionMode ?? "background" }, timeoutMs, deviceName, provider));

  server.registerTool("media_seek", {
    title: "Seek media playback",
    description: "Jump the page media element to a position in seconds, then report its state. Out-of-range positions clamp to the media duration.",
    inputSchema: {
      tabId: tabIdSchema,
      index: z.number().int().min(0).optional().describe("Which media element on the page, defaulting to the first."),
      seconds: z.number().min(0).describe("Position in seconds to jump to."),
      executionMode: executionModeSchema,
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, index, seconds, executionMode, timeoutMs }: TargetTab & { index?: number; seconds: number; executionMode?: ExecutionMode; timeoutMs?: number }) => execute("media.seek", { tabId, index, seconds, executionMode: executionMode ?? "background" }, timeoutMs, deviceName, provider));

  // WHY three tools and not one: start and stop drive the device through the
  // normal command queue (audited, budgeted, offline-aware), while read serves
  // the transcript that already landed. Collapsing them would mix a device
  // action with a database read, and the two fail in different ways.

  server.registerTool("media_stream_start", {
    title: "Start listening to tab audio",
    description: "Start a listening session on a tab: the page media element is tapped and its audio transcribed in windows. Refused on incognito and private tabs. Returns a sessionId; read the transcript with media_listen_read and end with media_stream_stop.",
    inputSchema: {
      tabId: tabIdSchema,
      index: z.number().int().min(0).optional().describe("Which media element on the page, defaulting to the first."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, index, timeoutMs }: TargetTab & { index?: number; timeoutMs?: number }) => execute("media.stream_start", { tabId, index }, timeoutMs, deviceName, provider));

  server.registerTool("media_stream_stop", {
    title: "Stop the listening session",
    description: "End the live listening session: the recorder stops, the tail window is transcribed, and no further audio is captured.",
    inputSchema: {
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ timeoutMs }: { timeoutMs?: number }) => execute("media.stream_stop", {}, timeoutMs, deviceName, provider));

  server.registerTool("media_listen_read", {
    title: "Read listening transcript",
    description: "Read transcript segments from a listening session, newest windows first after the given cursor. Without a sessionId, reads the device's most recent session. Transcript text travels only in this tool result, never on the dashboard.",
    inputSchema: {
      sessionId: z.string().regex(/^[0-9a-f-]{36}$/i).optional().describe("Listening session id from media_stream_start."),
      cursor: z.number().int().min(0).optional().describe("Return segments after this sequence number; defaults to 0."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum segments; defaults to 50."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ sessionId, cursor, limit }: { sessionId?: string; cursor?: number; limit?: number }) => {
    try {
      let sid = sessionId || "";
      if (sid) {
        const { data } = await supabase.from("opera_listen_sessions").select("id, device_id").eq("id", sid).single();
        if (!data) throw new Error("No such listening session.");
        const { data: owned } = await supabase.from("opera_devices").select("id").eq("id", (data as { device_id: string }).device_id).eq("device_name", deviceName).single();
        if (!owned) throw new Error("That session belongs to another device.");
      } else {
        const { data: device } = await supabase.from("opera_devices").select("id").eq("device_name", deviceName).single();
        if (!device) throw new Error("This device is not paired.");
        const { data: latest } = await supabase.from("opera_listen_sessions").select("id").eq("device_id", (device as { id: string }).id).order("started_at", { ascending: false }).limit(1).single();
        if (!latest) throw new Error("This device has no listening session yet.");
        sid = (latest as { id: string }).id;
      }
      const { data: segments } = await supabase.from("opera_listen_segments")
        .select("seq, start_s, end_s, text").eq("session_id", sid)
        .gt("seq", cursor ?? 0).order("seq").limit(limit ?? 50);
      return textResult({ ok: true, sessionId: sid, segments: segments || [] });
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  const url = new URL(req.url);

  if (url.pathname.endsWith("/health")) {
    return json(req, { ok: true, service: "opera-agent-mcp", transport: "streamable-http", authConfigured: !!STATIC_TOKEN || ALLOWED_USER_IDS.size > 0 || ALLOWED_USER_EMAILS.size > 0 });
  }

  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json(req, {
      resource: publicBaseUrl(),
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email"]
    });
  }

  if (req.method !== "POST") return json(req, { error: "method_not_allowed", error_description: "Use POST for stateless Streamable HTTP MCP." }, 405);
  // Only unreachable when GoTrue itself is unconfigured, which no secret here
  // controls. An unset allowlist is not a fault: it answers 401 to every caller.
  if (!SUPABASE_URL) {
    return json(req, { error: "server_misconfigured", error_description: "MCP authentication is not configured." }, 503);
  }
  const authContext = await authenticate(req);
  if (!authContext) return unauthorized(req);
  const deviceName = await resolveDeviceName(authContext, req);
  const provider = await resolveProvider(req, authContext);
  const caller: VmCaller | null = authContext.type === "user"
    ? { userId: authContext.userId, token: bearerToken(req) }
    : null;

  try {
    const server = createServer(deviceName, provider, caller);

    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    const headers = new Headers(response.headers);
    // Fail-closed: strip anything the transport set, then apply exactly the
    // per-request allowlist headers (no ACAO unless the origin matched).
    headers.delete("Access-Control-Allow-Origin");
    for (const [key, value] of Object.entries(corsHeadersFor(req))) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    createEdgeLog({}).error("opera-agent-mcp", errorMessage(error));
    return json(req, { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null }, 500);
  }
});
