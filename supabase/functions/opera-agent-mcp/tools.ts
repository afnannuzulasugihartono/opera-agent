// @last-edited: 2026-10-21 UTC+7.
// @title: tools — the 35 tools this MCP server offers, and the schemas they take.
// @state: every tool the surface advertises, with the input shape each one answers.
// @dependencies: @modelcontextprotocol/sdk, zod/v4, ../_shared/seal-vm-program.js.

// WHY THIS FILE EXISTS

// A tool list is the surface.
// Everything else in this function - the device, the command stream, the workflow runner, the VM host - is machinery behind it, and machinery changes for reasons the surface never hears about.
// When the two live in one file, a change to how a command is sent rewrites the file that also says what the caller may ask for, and the two get reviewed as if they were one thing.

// Splitting them is also what makes the surface countable: the tools are one file with one job, and the machinery is another, and a reviewer can read the contract without reading the transport.

// WHY THE TOOLS TAKE THEIR DEPENDENCIES AS ARGUMENTS.
// The tool bodies call the command runner, the workflow runner and the VM host by name.
// Those functions live with the transport that owns them, so the tools receive them instead of importing them, and the direction of the dependency stays one way: the surface knows the machinery, never the other way round.
// The types come from the same place, so a tool cannot call a function with a shape the machinery does not have.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { CommandFailure } from "../_shared/seal-vm-program.js";

import type { ToolDeps } from "./index.ts";

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

// WHY the bytes are typed into a data: URL here and not on the device: the caller already holds the file, and the device cannot ask the page for one without a native picker nobody can answer.
// The MIME comes from the caller when it says so and from the extension otherwise, because Drive files a docx by the type it is handed.

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf", csv: "text/csv", txt: "text/plain", json: "application/json",
  html: "text/html", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", zip: "application/zip"
};

function fileDataUrl(filename: string, data: string, mime?: string) {
  if (/^data:/i.test(data)) return data;
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return `data:${mime || MIME_BY_EXTENSION[extension] || "application/octet-stream"};base64,${data.replace(/\s+/g, "")}`;
}
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


type TargetTab = { tabId: number };
type ExecutionMode = "background" | "foreground";

export function registerTools(server: McpServer, deps: ToolDeps) {
  const {
    execute, executeScreenshot, runWorkflow, runAdhoc, rpc, textResult, toolError,
    callVmHost, vmRunResult, rpcErrorParts, db, deviceName, provider, caller
  } = deps;

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

  server.registerTool("run_adhoc", {
    title: "Run one-off Opera write task",
    description: "Run a one-off write task (find, fill, ordinary clicks, verify) as a temporary workflow on the paired Opera device: the definition is compiled, registered under adhoc.*, executed, then deleted. Consequential actions need confirm:true in the graph.",
    inputSchema: {
      graph: z.object({}).passthrough()
        .describe("Ad-hoc task graph: an object with a nodes array of command/if/repeat/foreach/set/wait/fail nodes using only allowlisted read methods plus page.click/page.fill/page.key/page.focus. Every page.click/page.fill needs a declaredLabel, and consequential labels need confirm:true. A compile refusal returns the compiler code and registers nothing."),
      requestId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]{1,100}$/)
        .describe("Idempotency key; a malformed key is rejected so replay protection is never silent here."),
      input: z.record(z.string(), z.unknown()).optional()
        .describe("Workflow input object, shaped by the compiled definition."),
      timeoutMs: z.number().int().min(1000).max(120000).optional()
        .describe("Workflow timeout in milliseconds; defaults to 60000.")
    },
  }, async ({ graph, requestId, input, timeoutMs }: { graph: Record<string, unknown>; requestId: string; input?: Record<string, unknown>; timeoutMs?: number }) =>
    runAdhoc(graph, requestId, input, timeoutMs, deviceName, provider).then(textResult).catch(toolError));

  server.registerTool("skill_save", {
    title: "Save skill lesson",
    description: "Save a task lesson to the shared skill memory, which is generic experience shared across accounts rather than per-device state.",
    inputSchema: {
      task: z.string().min(1).max(500)
        .describe("What the task was, e.g. \"open transcript panel\"."),
      site: z.string().max(120).optional()
        .describe("Site or surface the lesson applies to, e.g. \"youtube\"."),
      lesson: z.string().min(1).max(4000)
        .describe("What worked, what failed, and what recovered it."),
      pitfalls: z.string().max(2000).optional()
        .describe("What to avoid next time.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, ({ task, site, lesson, pitfalls }: { task: string; site?: string; lesson: string; pitfalls?: string }) => {

    return rpc("opera_skill_save", { p_task: task, p_site: site ?? "", p_lesson: lesson, p_pitfalls: pitfalls ?? "" }).then((saved) => {
      if (!saved?.ok) {
        const parts = rpcErrorParts(saved?.error, "SKILL_SAVE_FAILED");
        throw new CommandFailure(parts.code, parts.message);
      }
      return textResult({ id: saved.id });
    }).catch(toolError);
  });

  server.registerTool("skill_recall", {
    title: "Recall skill lessons",
    description: "Recall matching lessons from the shared skill memory, which is generic experience shared across accounts rather than per-device state.",
    inputSchema: {
      query: z.string().min(1)
        .describe("Free-text query matched literally against saved tasks and lessons."),
      site: z.string().max(120).optional()
        .describe("Restrict matches to this site; empty means all sites."),
      limit: z.number().int().min(1).max(20).optional()
        .describe("Maximum lessons to return; defaults to 5.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ query, site, limit }: { query: string; site?: string; limit?: number }) => {

    return rpc("opera_skill_recall", { p_query: query, p_site: site ?? "", p_limit: limit ?? 5 }).then((recalled) => {
      if (!recalled?.ok) {
        const parts = rpcErrorParts(recalled?.error, "SKILL_RECALL_FAILED");
        throw new CommandFailure(parts.code, parts.message);
      }
      return textResult({ skills: recalled.skills ?? [] });
    }).catch(toolError);
  });

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
  }, ({ watcherId, cursor, waitMs, timeoutMs }: { watcherId?: string; cursor?: number; waitMs?: number; timeoutMs?: number }) => {
    return rpc("opera_watch_events_wait", {
      p_watcher: watcherId ?? null,
      p_after_seq: cursor ?? 0,
      p_timeout_ms: Math.max(500, Math.min(30000, timeoutMs ?? waitMs ?? 25000))
    }).then((waited) => {

      const rows = waited && typeof waited === "object" && Array.isArray((waited as { events?: unknown }).events)
        ? (waited as { events: Array<{ device_name?: unknown }> }).events.filter((event) => event && event.device_name === deviceName)
        : [];

      const failed = waited && typeof waited === "object" && (waited as { ok?: unknown }).ok === false;
      return textResult({ ...waited as object, ...(failed ? {} : { ok: true }), events: rows, count: rows.length });
    }).catch(toolError);
  });

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
      fullPage: z.boolean().optional().describe("Span the whole scrollable document past the viewport instead of the visible area. Exclusive with crop."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, crop, quality, maxWidth, maxHeight, previousHash, fullPage, timeoutMs }: TargetTab & {
    crop?: { x: number; y: number; width: number; height: number };
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    previousHash?: string;
    fullPage?: boolean;
    timeoutMs?: number;
  }) => executeScreenshot({ tabId, ...(crop ? { crop } : {}), ...(quality != null ? { quality } : {}), ...(maxWidth != null ? { maxWidth } : {}), ...(maxHeight != null ? { maxHeight } : {}), ...(previousHash ? { previousHash } : {}), ...(fullPage === true ? { fullPage: true } : {}) }, timeoutMs, deviceName, provider));

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

  server.registerTool("upload_file", {
    title: "Upload a file into the page",
    description: "Hand the page a file the caller already holds: base64 in, a real File on the page. With x and y the file is dropped at that viewport point, which is how a Drive folder takes an upload without a native picker; without them it is set on the first file input, or on the one matching selector. Nothing is read from the device's disk. A drop zone with no listener accepts the events silently, so verify the drop by reading the page afterwards.",
    inputSchema: {
      tabId: tabIdSchema,
      filename: z.string().min(1).max(300),
      data: z.string().min(1).max(2000000)
        .describe("Base64 bytes, or a full data: URL when the exact type matters."),
      mime: z.string().min(1).max(200).optional()
        .describe("Content type for base64 input; guessed from the filename otherwise."),
      x: z.number().nonnegative().optional(),
      y: z.number().nonnegative().optional(),
      selector: z.string().min(1).max(500).optional()
        .describe("File input to fill when no point is given; defaults to the first one on the page."),
      executionMode: executionModeSchema,
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, filename, data, mime, x, y, selector, executionMode, timeoutMs }: TargetTab & { filename: string; data: string; mime?: string; x?: number; y?: number; selector?: string; executionMode?: ExecutionMode; timeoutMs?: number }) => {
    if ((x == null) !== (y == null)) throw new Error("upload_file needs both x and y to drop at a point, or neither to set a file input.");
    return execute("page.files", {
      tabId,
      filename,
      data: fileDataUrl(filename, data, mime),
      ...(x != null ? { x, y } : {}),
      ...(selector != null ? { selector } : {}),
      executionMode: executionMode ?? "background"
    }, timeoutMs, deviceName, provider);
  });

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

  server.registerTool("stream_keys", {
    title: "Stream a key sequence in one command",
    description: "Send up to 100 key chords and text fragments as one command instead of one call each: menu walks, grid sizing, and multi-chord shortcuts that would cost a round trip per key otherwise. Events run back-to-back on the device in order, with an optional pause after any event for menus that need a beat to open. Each event carries exactly one of key or text, like press_key. Keyboard input is refused on password, OTP, and payment fields.",
    inputSchema: {
      tabId: tabIdSchema,
      events: z.array(z.object({
        key: navigationKeySchema.optional(),
        modifiers: z.array(modifierSchema).max(4).optional(),
        text: z.string().min(1).max(20000).optional(),
        gapMs: z.number().int().min(0).max(2000).optional()
          .describe("Pause after this event, for menus and popups that need a beat to open.")
      }).strict()).min(1).max(100),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, events, executionMode }: TargetTab & { events: Array<{ key?: string; modifiers?: string[]; text?: string; gapMs?: number }>; executionMode?: ExecutionMode }) => execute("page.stream", { tabId, events, trusted: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

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

  server.registerTool("pointer", {
    title: "Pointer input",
    description: "One pointer for every pointer job: move, click, drag, and wheel by viewport coordinates, or hover by element ref. A visible cursor marker is drawn in both modes so an owner can follow the run; background mode does not activate the tab. A hover settles on the ref and reports what it revealed, which is how a menu entry that owns a submenu is opened. Coordinate actions need x and y (a drag also needs endX and endY, a wheel needs deltaY); a hover needs a ref from find_elements instead. Prefer click_element for plain clicks and verify page state.",
    inputSchema: {
      tabId: tabIdSchema,
      pointerAction: z.enum(["move", "click", "drag", "wheel", "hover"])
        .describe("Which pointer job: a coordinate move, click, drag, or wheel, or a ref hover that settles."),
      x: z.number().nonnegative().optional(),
      y: z.number().nonnegative().optional(),
      endX: z.number().nonnegative().optional(),
      endY: z.number().nonnegative().optional(),
      deltaX: z.number().min(-1200).max(1200).optional(),
      deltaY: z.number().min(-1200).max(1200).optional(),
      ref: z.string().min(1).max(300).optional()
        .describe("Element ref from find_elements. Required for a hover, ignored by coordinate actions."),
      text: z.string().min(1).max(300).optional()
        .describe("Submenu entry a hover is expected to reveal. Only a hover reads it."),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, pointerAction, x, y, endX, endY, deltaX, deltaY, ref, text, executionMode }: TargetTab & { pointerAction: "move" | "click" | "drag" | "wheel" | "hover"; x?: number; y?: number; endX?: number; endY?: number; deltaX?: number; deltaY?: number; ref?: string; text?: string; executionMode?: ExecutionMode }) => {
    const mode = executionMode ?? "background";
    if (pointerAction === "hover") {
      if (!ref) throw new Error("pointer hover requires a ref target.");
      return execute("page.pointer", { tabId, action: "hover", ref, ...(text != null ? { text } : {}), executionMode: mode }, undefined, deviceName, provider);
    }
    if (x == null || y == null) throw new Error(`pointer ${pointerAction} requires x and y coordinates.`);
    if (pointerAction === "drag") {
      if (endX == null || endY == null) throw new Error("pointer drag requires endX and endY coordinates.");
      return execute("page.pointer", { tabId, action: "drag", x, y, endX, endY, showCursor: true, executionMode: mode }, undefined, deviceName, provider);
    }
    if (pointerAction === "wheel") {
      if (deltaY == null) throw new Error("pointer wheel requires deltaY.");
      return execute("page.pointer", { tabId, action: "wheel", x, y, deltaX: deltaX ?? 0, deltaY, showCursor: true, executionMode: mode }, undefined, deviceName, provider);
    }
    return execute("page.pointer", { tabId, action: pointerAction, x, y, showCursor: true, executionMode: mode }, undefined, deviceName, provider);
  });

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
      const supabase = await db();
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

  // WHY THE DELIVERY IS ONE TOOL AND NOT FOUR CALLS.
  // A client-month is the unit that is delivered and the unit that is billed, so the agent that sells it should spend one call per client-month: name the file, let the device fetch and name it, and read back the proof.
  // The proof is what makes the sale defensible, so it travels with the answer instead of being assembled from three other calls.
  server.registerTool("statement_deliver", {
    title: "Deliver a client statement",
    description: "Download one client's statement for one month to the user's own disk, under a name you choose, and return the proof: bytes, the kind of file read from its own bytes, the page count, and the closing balance with the page named as its source. The file lands in the user's download folder; nothing is uploaded. A second delivery of the same client-month is refused, because a second line would bill the same month twice.",
    inputSchema: {
      client: z.string().min(1).max(200).describe("The client, as the person says it."),
      portal: z.string().min(1).max(200).describe("The bank or vendor the statement comes from."),
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("The month being delivered, YYYY-MM."),
      filename: z.string().min(1).max(200).describe("The file name to save it as, without a folder."),
      url: z.string().url().describe("The http(s) url of the file on the portal."),
      tabId: tabIdSchema,
      balance: z.string().max(200).optional().describe("The closing balance, as the page printed it."),
      replace: z.boolean().optional().describe("Replace an existing record for this client-month."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ client, portal, period, filename, url, tabId, balance, replace, timeoutMs }: {
    client: string; portal: string; period: string; filename: string; url: string;
    tabId?: number; balance?: string; replace?: boolean; timeoutMs?: number;
  }) => execute("statement.download", { client, portal, period, filename, url, tabId, balance, replace }, timeoutMs, deviceName, provider));

  server.registerTool("statement_manifest", {
    title: "Read the statement manifest",
    description: "Read the manifest the device keeps: one line per delivered client-month, with the file, its bytes, its kind, its page count and the closing balance with its source. The manifest lives on the user's own machine, beside the files it describes.",
    inputSchema: {
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ timeoutMs }: { timeoutMs?: number }) => execute("statement.manifest", {}, timeoutMs, deviceName, provider));

  server.registerTool("invoice_create", {
    title: "Bill a customer for delivered client-months",
    description: "Turn delivered client-months into an invoice for one customer and one billing month. Pass the manifest rows this invoice charges for, or the client and period of each delivery; the amount is computed from the price list, never from a number in the call, and a month that was not delivered cannot be on the invoice. Pass plan to bill a plan month instead of per delivery: one plan line and a line only for each client-month above the cap. Returns the invoice and the link the customer opens to pay it. Read statement_manifest first: its rows are the proof the invoice is checked against.",
    inputSchema: {
      customer: z.string().min(1).max(200).describe("The customer being billed, as the operator names them."),
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("The billing month, YYYY-MM."),
      deliveries: z.array(z.object({
        client: z.string().min(1).max(200).describe("The client whose statement was delivered."),
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("The statement month that was delivered, YYYY-MM."),
        portal: z.string().max(200).optional().describe("The bank or vendor the statement came from."),
        pages: z.number().int().nonnegative().optional().describe("The page count the proof recorded.")
      }).passthrough()).min(1).max(500).describe("The deliveries this invoice charges for, one entry per delivered client-month."),
      plan: z.enum(['plan.pilot', 'plan.firm']).optional().describe("Bill a plan instead of per delivery: one plan line for the month, and one line only for each client-month above the plan's cap. The value is the price-list kind, so a plan nobody priced is refused rather than billed as zero.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ customer, period, deliveries, plan }: {
    customer: string;
    period: string;
    deliveries: Array<{ client: string; period: string; portal?: string; pages?: number } & Record<string, unknown>>;
    plan?: string;
  }) => {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/opera-agent-billing`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${Deno.env.get("OPERA_BILLING_TOKEN") || ""}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ action: "invoice", customer_id: customer, period, deliveries, ...(plan ? { plan } : {}) })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const refused = Array.isArray(body.refused) ? ` (${(body.refused as string[]).join("; ")})` : "";
      throw new Error(`${String(body.error || `the billing function answered HTTP ${response.status}`)}${refused}`);
    }
    return deps.textResult({ ok: true, invoice: body.invoice, link: body.url });
  });

}
