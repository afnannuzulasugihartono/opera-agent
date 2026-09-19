import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import * as z from "zod/v4";

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, last-event-id, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-protocol-version, mcp-session-id",
  "Cache-Control": "no-store"
};

const tabIdSchema = z.number().int().nonnegative()
  .describe("Explicit Opera automation target tab ID returned by open_url or list_tabs.");
const executionModeSchema = z.enum(["background", "foreground"]).optional()
  .describe("Execution mode. Defaults to background. Foreground never activates a tab automatically.");
const timeoutSchema = z.number().int().min(500).max(30000).optional()
  .describe("Maximum wait in milliseconds.");
const burstTimeoutSchema = z.number().int().min(500).max(12000).optional()
  .describe("Maximum total burst duration in milliseconds; defaults to and cannot exceed 12000.");
const navigationKeySchema = z.enum(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space"]);
const burstStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(300).max(12000).optional(),
    includeElements: z.boolean().optional(),
    maxElements: z.number().int().min(1).max(300).optional()
  }).strict(),
  z.object({
    action: z.literal("find"),
    text: z.string().max(300).optional(),
    role: z.string().max(80).optional(),
    tag: z.string().max(80).optional(),
    exact: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional()
  }).strict(),
  z.object({ action: z.literal("click"), ref: z.string().min(1).max(300) }).strict(),
  z.object({ action: z.literal("fill"), ref: z.string().min(1).max(300), value: z.string().max(20000) }).strict(),
  z.object({ action: z.literal("key"), key: navigationKeySchema }).strict(),
  z.object({
    action: z.literal("scroll"),
    x: z.number().min(-1000000).max(1000000).optional(),
    y: z.number().min(-1000000).max(1000000),
    absolute: z.boolean().optional(),
    smooth: z.boolean().optional()
  }).strict(),
  z.object({
    action: z.literal("wait"),
    ref: z.string().min(1).max(300).optional(),
    selector: z.string().min(1).max(500).optional(),
    text: z.string().min(1).max(300).optional(),
    visibleOnly: z.boolean().optional(),
    timeoutMs: z.number().int().min(50).max(8000).optional(),
    intervalMs: z.number().int().min(25).max(1000).optional()
  }).strict().refine((step) => !!(step.ref || step.selector || step.text), "Wait requires ref, selector, or text."),
  z.object({
    action: z.literal("pointer"),
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
  })
]);

type AuthContext = { type: "static" } | { type: "user"; userId: string };
type TargetTab = { tabId: number };
type ExecutionMode = "background" | "foreground";

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

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders }
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

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = bearerToken(req);
  if (!token) return null;
  if (STATIC_TOKEN && secureEqual(token, STATIC_TOKEN)) return { type: "static" };
  if (ALLOWED_USER_IDS.size === 0 && ALLOWED_USER_EMAILS.size === 0) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email?.toLowerCase() || "";
  if (error || !data.user || (!ALLOWED_USER_IDS.has(data.user.id) && !ALLOWED_USER_EMAILS.has(email))) return null;
  return { type: "user", userId: data.user.id };
}

function publicBaseUrl() {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/opera-agent-mcp`;
}

function unauthorized(req: Request) {
  const metadata = `${publicBaseUrl()}/.well-known/oauth-protected-resource`;
  return json(
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
    ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
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

async function runCommand(method: string, params: Record<string, unknown> = {}, timeoutMs = 12000) {
  const boundedTimeout = Math.max(500, Math.min(30000, timeoutMs));
  const queued = await rpc("opera_enqueue", {
    p_method: method,
    p_params: params,
    p_timeout_ms: boundedTimeout,
    p_device_name: DEVICE_NAME,
    p_request_id: crypto.randomUUID()
  });
  if (!queued?.ok || !queued.commandId) {
    throw new Error(String(queued?.error || `Unable to queue ${method}.`));
  }
  const awaitFunction = method === "page.capture" ? "opera_await_capture" : "opera_await";
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

function execute(method: string, params: Record<string, unknown>, timeoutMs?: number) {
  return runCommand(method, params, timeoutMs).then(textResult).catch(toolError);
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

function executeScreenshot(params: Record<string, unknown>, timeoutMs?: number) {
  return runCommand("page.capture", params, timeoutMs).then(screenshotResult).catch(toolError);
}

function createServer() {
  const server = new McpServer(
    { name: "opera-agent", version: "1.6.0" },
    {
      instructions: "Use Opera Agent whenever the user asks to open, navigate, inspect, click, type, scroll, visually inspect, or otherwise operate their local Opera browser. Check browser_status first. Keep normal automation in background: open_url defaults to an inactive tab, retain its returned tabId, and pass that exact tabId to every later page or navigation tool. Never substitute the user's active tab during a multi-step task. Prefer run_browser_burst for two or more dependent actions on one target tab and prefer element references from read_page/find_elements. Use capture_page adaptively only for initial visual observation, canvas/dynamic interfaces, low-confidence targeting, meaningful state changes, or failed verification; pass previousHash to avoid retransmitting unchanged images. Treat coordinates as stale when documentId, viewport, zoomFactor, visualScale, or screenshot hash changes. For lazy result lists, call wheel_at inside the intended list, inspect scroll.after, moved, contentChanged, and reachedBoundary, collect stableKey/href values, and repeat only with an explicit bound until the boundary is reached and no new stable keys appear. Coordinate actions default to invisible background CDP input; use them only when no reliable element ref exists and verify the resulting page state. A visible pointer is a foreground diagnostic: call activate_tab only when the user explicitly asks to watch or permits foreground interaction, then pass executionMode foreground. Never use activate_tab as an implicit recovery step. If a tool returns FOREGROUND_REQUIRED, explain the limitation and request foreground permission instead of activating anything. Never enter passwords, OTPs, payment data, upload files, publish, purchase, send, or delete without the user's explicit instruction. Surfaces rendered as canvas, editors, games, or remote screens expose little or no DOM: when read_page returns little or no useful text while the task needs visual content, use capture_page and reason from the screenshot. If find_elements returns nothing while read_page shows the text, target an ancestor clickable element or capture the page instead of retrying the same query. Maps search results are viewport-scoped: after panning or zooming, re-read or re-search rather than trusting the earlier list, and re-find targets after any large page redraw before clicking them. When a tool reports a timeout or an unknown outcome, verify the page state before repeating the action. Supabase is internal transport and should not be mentioned to the user unless troubleshooting.",
      capabilities: { logging: {} }
    }
  );

  server.registerTool("browser_status", {
    title: "Check Opera Agent",
    description: "Check whether the user's local Opera Agent extension is online and list its capabilities. Call this first for browser-control requests.",
    inputSchema: { timeoutMs: timeoutSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ timeoutMs }: { timeoutMs?: number }) => execute("browser.ping", {}, timeoutMs));

  server.registerTool("run_browser_burst", {
    title: "Run fast Opera action burst",
    description: "Run 1-8 dependent page actions sequentially on one explicit Opera target tab. Defaults to background execution, including invisible coordinate steps. Foreground mode displays pointer steps and requires a tab the user already allowed to be activated. It stops at the first failure, has a 12-second total limit, and cannot open, navigate, close, loop, branch, or execute JavaScript.",
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
    return execute("browser.burst", params, timeoutMs);
  });

  server.registerTool("list_tabs", {
    title: "List Opera tabs",
    description: "List open Opera tabs, including tab IDs, titles, URLs, and active state.",
    inputSchema: { currentWindow: z.boolean().optional().describe("Only return tabs in the current Opera window.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ currentWindow }: { currentWindow?: boolean }) => execute("tabs.list", { currentWindow: currentWindow ?? false }));

  server.registerTool("open_url", {
    title: "Open URL in Opera",
    description: "Open an HTTP or HTTPS URL in a new background Opera tab and return its tab ID. Set active true only when the user explicitly asks to see the new tab or permits foreground interaction.",
    inputSchema: {
      url: z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed."),
      active: z.boolean().optional().describe("Make the new tab active. Defaults to false; use true only with explicit user permission."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ url, active, timeoutMs }: { url: string; active?: boolean; timeoutMs?: number }) => execute("tabs.open", { url, active: active ?? false, wait: true }, timeoutMs));

  server.registerTool("activate_tab", {
    title: "Activate Opera tab",
    description: "Explicitly activate an Opera tab and focus its window. Use only when the user asks to see that tab or permits foreground interaction; never use as automatic recovery.",
    inputSchema: { tabId: z.number().int().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.activate", { tabId, focusWindow: true }));

  server.registerTool("navigate_tab", {
    title: "Navigate Opera tab",
    description: "Navigate an explicit Opera target tab to an HTTP/HTTPS URL without activating it, then wait for it to load.",
    inputSchema: {
      tabId: tabIdSchema,
      url: z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, url, timeoutMs }: TargetTab & { url: string; timeoutMs?: number }) => execute("tabs.navigate", { tabId, url, wait: true }, timeoutMs));

  server.registerTool("close_tab", {
    title: "Close Opera tab",
    description: "Close one Opera tab by ID. Use only when the user asks to close it.",
    inputSchema: { tabId: z.number().int().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.close", { tabId }));

  server.registerTool("read_page", {
    title: "Read Opera page",
    description: "Read a compact task-facing page observation with reusable refs, stable keys, relevant change evidence, screen rectangles, true viewport presence, document identity, viewport geometry, and zoom. Use pagination for long pages.",
    inputSchema: {
      tabId: tabIdSchema,
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(300).max(12000).optional(),
      includeElements: z.boolean().optional(),
      maxElements: z.number().int().min(1).max(300).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, (args: TargetTab & { offset?: number; limit?: number; includeElements?: boolean; maxElements?: number }) =>
    execute("page.read", { ...args, view: "compact" }));

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
  }) => executeScreenshot({ tabId, ...(crop ? { crop } : {}), ...(quality != null ? { quality } : {}), ...(maxWidth != null ? { maxWidth } : {}), ...(maxHeight != null ? { maxHeight } : {}), ...(previousHash ? { previousHash } : {}) }, timeoutMs));

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
  }, (args: TargetTab & { text?: string; role?: string; tag?: string; exact?: boolean; limit?: number }) => execute("page.find", args));

  server.registerTool("click_element", {
    title: "Click page element",
    description: "Click an element ref on an explicit target tab using trusted browser input. Background execution is the default and does not activate the tab.",
    inputSchema: { tabId: tabIdSchema, ref: z.string().min(1).max(300), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, ref, executionMode }: TargetTab & { ref: string; executionMode?: ExecutionMode }) => execute("page.click", { tabId, ref, trusted: true, executionMode: executionMode ?? "background" }));

  server.registerTool("fill_element", {
    title: "Fill page field",
    description: "Fill a non-sensitive editable element by ref. The extension blocks passwords, OTPs, payment fields, and file uploads.",
    inputSchema: { tabId: tabIdSchema, ref: z.string().min(1).max(300), value: z.string().max(20000), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, ref, value, executionMode }: TargetTab & { ref: string; value: string; executionMode?: ExecutionMode }) => execute("page.fill", { tabId, ref, value, trusted: true, executionMode: executionMode ?? "background" }));

  server.registerTool("press_key", {
    title: "Press navigation key",
    description: "Press an allowlisted navigation key on the active element using trusted browser input.",
    inputSchema: {
      tabId: tabIdSchema,
      key: navigationKeySchema,
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, key, executionMode }: TargetTab & { key: string; executionMode?: ExecutionMode }) => execute("page.key", { tabId, key, trusted: true, executionMode: executionMode ?? "background" }));

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
  }, ({ tabId, x, y, absolute, smooth, executionMode }: TargetTab & { x?: number; y: number; absolute?: boolean; smooth?: boolean; executionMode?: ExecutionMode }) => execute("page.scroll", { tabId, x: x ?? 0, y, absolute: absolute ?? false, behavior: smooth ? "smooth" : "instant", executionMode: executionMode ?? "background" }));

  server.registerTool("move_pointer", {
    title: "Move pointer",
    description: "Move CDP pointer coordinates on an explicit target. Background mode is invisible and does not activate the tab. Foreground mode shows the pointer and requires an already active/focused target explicitly permitted by the user.",
    inputSchema: { tabId: tabIdSchema, x: z.number().nonnegative(), y: z.number().nonnegative(), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, x, y, executionMode }: TargetTab & { x: number; y: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "move", x, y, showCursor: true, executionMode: executionMode ?? "background" }));

  server.registerTool("click_at", {
    title: "Click at coordinates",
    description: "Click CDP viewport coordinates. Background mode is invisible and does not activate the tab. Foreground mode shows the pointer and requires an already active/focused target explicitly permitted by the user. Prefer click_element and verify page state.",
    inputSchema: { tabId: tabIdSchema, x: z.number().nonnegative(), y: z.number().nonnegative(), executionMode: executionModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, executionMode }: TargetTab & { x: number; y: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "click", x, y, showCursor: true, executionMode: executionMode ?? "background" }));

  server.registerTool("drag_pointer", {
    title: "Drag at coordinates",
    description: "Drag between CDP viewport coordinates. Background mode is invisible and does not activate the tab. Foreground mode shows the pointer and requires an already active/focused target explicitly permitted by the user.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().nonnegative(), y: z.number().nonnegative(),
      endX: z.number().nonnegative(), endY: z.number().nonnegative(),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, endX, endY, executionMode }: TargetTab & { x: number; y: number; endX: number; endY: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "drag", x, y, endX, endY, showCursor: true, executionMode: executionMode ?? "background" }));

  server.registerTool("wheel_at", {
    title: "Wheel at coordinates",
    description: "Wheel at viewport coordinates and report the actual scroll container, before/after metrics, movement, lazy DOM changes, settling, and reachedBoundary. Background mode is invisible and does not activate the tab; it uses a deterministic DOM fallback only when the debugger event cannot move an available scroll container. Foreground mode requires an already active/focused target explicitly permitted by the user.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().nonnegative(), y: z.number().nonnegative(),
      deltaX: z.number().min(-1200).max(1200).optional(),
      deltaY: z.number().min(-1200).max(1200),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, deltaX, deltaY, executionMode }: TargetTab & { x: number; y: number; deltaX?: number; deltaY: number; executionMode?: ExecutionMode }) => execute("page.pointer", { tabId, action: "wheel", x, y, deltaX: deltaX ?? 0, deltaY, showCursor: true, executionMode: executionMode ?? "background" }));

  return server;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(req.url);

  if (url.pathname.endsWith("/health")) {
    return json({ ok: true, service: "opera-agent-mcp", transport: "streamable-http", authConfigured: !!STATIC_TOKEN || ALLOWED_USER_IDS.size > 0 || ALLOWED_USER_EMAILS.size > 0 });
  }

  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return json({
      resource: publicBaseUrl(),
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email"]
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed", error_description: "Use POST for stateless Streamable HTTP MCP." }, 405);
  if (!STATIC_TOKEN && ALLOWED_USER_IDS.size === 0 && ALLOWED_USER_EMAILS.size === 0) {
    return json({ error: "server_misconfigured", error_description: "MCP authentication is not configured." }, 503);
  }
  if (!await authenticate(req)) return unauthorized(req);

  try {
    const server = createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.error("opera-agent-mcp", errorMessage(error));
    return json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null }, 500);
  }
});
