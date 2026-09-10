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

const tabIdSchema = z.number().int().nonnegative().optional()
  .describe("Opera tab ID. Omit to use the active tab in the focused window.");
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
type OptionalTab = { tabId?: number };

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
  return {
    content: [{ type: "text" as const, text: errorMessage(error) }],
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
  const completed = await rpc("opera_await", {
    p_command_id: queued.commandId,
    p_timeout_ms: Math.min(32000, boundedTimeout + 2000)
  });
  if (!completed?.ok) {
    const detail = completed?.error;
    const message = detail && typeof detail === "object" && "message" in detail
      ? String((detail as { message?: unknown }).message)
      : String(detail || `${method} failed.`);
    throw new Error(message);
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

function createServer() {
  const server = new McpServer(
    { name: "opera-agent", version: "1.2.0" },
    {
      instructions: "Use Opera Agent whenever the user asks to open, navigate, inspect, click, type, scroll, or otherwise operate their local Opera browser. Check browser_status first. Prefer run_browser_burst for two or more dependent actions on one tab, and prefer element references from read_page/find_elements; use coordinate pointer tools only when needed. Never enter passwords, OTPs, payment data, upload files, publish, purchase, send, or delete without the user's explicit instruction. Supabase is internal transport and should not be mentioned to the user unless troubleshooting.",
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
    description: "Run 1-8 dependent page actions sequentially on one Opera tab through one relay command. Use this instead of separate tool calls when the next actions are already known. It stops at the first failure, has a 12-second total limit, reuses trusted debugger input within the burst, and cannot open, navigate, close, loop, branch, or execute JavaScript.",
    inputSchema: {
      tabId: tabIdSchema,
      steps: z.array(burstStepSchema).min(1).max(8),
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
  }, ({ tabId, steps, timeoutMs }: { tabId?: number; steps: Array<Record<string, unknown>>; timeoutMs?: number }) => execute("browser.burst", { tabId, steps }, timeoutMs));

  server.registerTool("list_tabs", {
    title: "List Opera tabs",
    description: "List open Opera tabs, including tab IDs, titles, URLs, and active state.",
    inputSchema: { currentWindow: z.boolean().optional().describe("Only return tabs in the current Opera window.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ currentWindow }: { currentWindow?: boolean }) => execute("tabs.list", { currentWindow: currentWindow ?? false }));

  server.registerTool("open_url", {
    title: "Open URL in Opera",
    description: "Open an HTTP or HTTPS URL in a new Opera tab and wait for it to load.",
    inputSchema: {
      url: z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed."),
      active: z.boolean().optional().describe("Make the new tab active. Defaults to true."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ url, active, timeoutMs }: { url: string; active?: boolean; timeoutMs?: number }) => execute("tabs.open", { url, active: active ?? true, wait: true }, timeoutMs));

  server.registerTool("activate_tab", {
    title: "Activate Opera tab",
    description: "Activate an existing Opera tab and focus its window. Pointer tools require an active, focused tab.",
    inputSchema: { tabId: z.number().int().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.activate", { tabId, focusWindow: true }));

  server.registerTool("navigate_tab", {
    title: "Navigate Opera tab",
    description: "Navigate an existing or active Opera tab to an HTTP/HTTPS URL and wait for it to load.",
    inputSchema: {
      tabId: tabIdSchema,
      url: z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, url, timeoutMs }: OptionalTab & { url: string; timeoutMs?: number }) => execute("tabs.navigate", { tabId, url, wait: true }, timeoutMs));

  server.registerTool("close_tab", {
    title: "Close Opera tab",
    description: "Close one Opera tab by ID. Use only when the user asks to close it.",
    inputSchema: { tabId: z.number().int().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.close", { tabId }));

  server.registerTool("read_page", {
    title: "Read Opera page",
    description: "Read visible page text and interactive elements with reusable refs and screen rectangles. Use pagination for long pages.",
    inputSchema: {
      tabId: tabIdSchema,
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(300).max(12000).optional(),
      includeElements: z.boolean().optional(),
      maxElements: z.number().int().min(1).max(300).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, (args: OptionalTab & { offset?: number; limit?: number; includeElements?: boolean; maxElements?: number }) => execute("page.read", args));

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
  }, (args: OptionalTab & { text?: string; role?: string; tag?: string; exact?: boolean; limit?: number }) => execute("page.find", args));

  server.registerTool("click_element", {
    title: "Click page element",
    description: "Click an element ref returned by read_page/find_elements using trusted browser input.",
    inputSchema: { tabId: tabIdSchema, ref: z.string().min(1).max(300) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, ref }: OptionalTab & { ref: string }) => execute("page.click", { tabId, ref, trusted: true }));

  server.registerTool("fill_element", {
    title: "Fill page field",
    description: "Fill a non-sensitive editable element by ref. The extension blocks passwords, OTPs, payment fields, and file uploads.",
    inputSchema: { tabId: tabIdSchema, ref: z.string().min(1).max(300), value: z.string().max(20000) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, ref, value }: OptionalTab & { ref: string; value: string }) => execute("page.fill", { tabId, ref, value }));

  server.registerTool("press_key", {
    title: "Press navigation key",
    description: "Press an allowlisted navigation key on the active element using trusted browser input.",
    inputSchema: {
      tabId: tabIdSchema,
      key: navigationKeySchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, key }: OptionalTab & { key: string }) => execute("page.key", { tabId, key, trusted: true }));

  server.registerTool("scroll_page", {
    title: "Scroll page",
    description: "Scroll the active page by a relative horizontal/vertical amount, or to an absolute document position.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().min(-1000000).max(1000000).optional(),
      y: z.number().min(-1000000).max(1000000),
      absolute: z.boolean().optional(),
      smooth: z.boolean().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, absolute, smooth }: OptionalTab & { x?: number; y: number; absolute?: boolean; smooth?: boolean }) => execute("page.scroll", { tabId, x: x ?? 0, y, absolute: absolute ?? false, behavior: smooth ? "smooth" : "instant" }));

  server.registerTool("move_pointer", {
    title: "Move visible pointer",
    description: "Move Opera Agent's visible pointer to viewport coordinates without clicking. Coordinates are CSS pixels from the page's top-left visible corner.",
    inputSchema: { tabId: tabIdSchema, x: z.number().nonnegative(), y: z.number().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, x, y }: OptionalTab & { x: number; y: number }) => execute("page.pointer", { tabId, action: "move", x, y, showCursor: true }));

  server.registerTool("click_at", {
    title: "Click visible pointer",
    description: "Click viewport coordinates with trusted input and display the Opera Agent pointer. Prefer click_element when an element ref exists.",
    inputSchema: { tabId: tabIdSchema, x: z.number().nonnegative(), y: z.number().nonnegative() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y }: OptionalTab & { x: number; y: number }) => execute("page.pointer", { tabId, action: "click", x, y, showCursor: true }));

  server.registerTool("drag_pointer", {
    title: "Drag visible pointer",
    description: "Drag from one viewport coordinate to another using trusted input and a visible pointer.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().nonnegative(), y: z.number().nonnegative(),
      endX: z.number().nonnegative(), endY: z.number().nonnegative()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, endX, endY }: OptionalTab & { x: number; y: number; endX: number; endY: number }) => execute("page.pointer", { tabId, action: "drag", x, y, endX, endY, showCursor: true }));

  server.registerTool("wheel_at", {
    title: "Wheel at pointer",
    description: "Send a trusted mouse-wheel event at viewport coordinates while displaying the Opera Agent pointer.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().nonnegative(), y: z.number().nonnegative(),
      deltaX: z.number().min(-1200).max(1200).optional(),
      deltaY: z.number().min(-1200).max(1200)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, deltaX, deltaY }: OptionalTab & { x: number; y: number; deltaX?: number; deltaY: number }) => execute("page.pointer", { tabId, action: "wheel", x, y, deltaX: deltaX ?? 0, deltaY, showCursor: true }));

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
