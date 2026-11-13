// @last-edited: 2026-11-13 UTC+7.
// @title: tools - the 42 tools this MCP server offers, and the schemas they take.
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

// The same two-minute window device.ts uses to call a browser live.

const LIVE_WINDOW_MS = 120_000;

const tabIdSchema = z.number().int().nonnegative()
  .describe("Explicit Opera automation target tab ID returned by open_url or list_tabs.");
const executionModeSchema = z.enum(["background", "foreground"]).optional()
  .describe("Execution mode. Defaults to background. Foreground never activates a tab automatically.");
const timeoutSchema = z.number().int().min(500).max(30000).optional()
  .describe("Maximum wait in milliseconds.");
const burstTimeoutSchema = z.number().int().min(500).max(12000).optional()
  .describe("Maximum total burst duration in milliseconds; defaults to and cannot exceed 12000.");
const commandOutputSchema = z.object({ ok: z.boolean() }).catchall(z.unknown());
const httpUrlSchema = z.url().refine((value) => /^https?:/i.test(value), "Only HTTP/HTTPS URLs are allowed.");
const workflowNameSchema = z.string().min(1).max(200).regex(/^[a-z0-9_.-]+$/)
  .describe("Registered workflow name, e.g. youtube.skip_ads.");
const lowercaseLetters = "abcdefghijklmnopqrstuvwxyz".split("");
const uppercaseLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const digits = "0123456789".split("");
const navigationKeySchema = z.enum(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space", "Backspace", "Delete", "Comma", "Period", "Slash", ...lowercaseLetters, ...uppercaseLetters, ...digits])
  .describe("Key to press, e.g. Enter, Tab, ArrowLeft, or one printable character.");
const modifierSchema = z.enum(["alt", "control", "ctrl", "shift", "meta", "cmd", "command", "option", "super", "win"]);
const burstStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    tabId: tabIdSchema.optional(),
    offset: z.number().int().nonnegative().optional()
      .describe("Where in the text to start reading, in characters."),
    limit: z.number().int().min(300).max(12000).optional()
      .describe("How much text to read, in characters; defaults to 6000."),
    includeElements: z.boolean().optional()
      .describe("Return the interactive elements with their refs; defaults to true."),
    maxElements: z.number().int().min(1).max(300).optional()
      .describe("Maximum elements to return; defaults to 120.")
  }).strict(),
  z.object({
    action: z.literal("find"),
    tabId: tabIdSchema.optional(),
    text: z.string().max(300).optional()
      .describe("Text to match against the element's visible or accessible name."),
    role: z.string().max(80).optional()
      .describe("ARIA role to match, e.g. button, link, textbox."),
    tag: z.string().max(80).optional()
      .describe("HTML tag to match, e.g. button, a, input."),
    exact: z.boolean().optional()
      .describe("Match the whole name instead of a part of it; defaults to false."),
    limit: z.number().int().min(1).max(100).optional()
      .describe("Maximum elements to return; defaults to 30.")
  }).strict(),
  z.object({
    action: z.literal("click"),
    tabId: tabIdSchema.optional(),
    ref: z.string().min(1).max(300).optional()
      .describe("Element ref to click, from this burst or from find_elements."),
    refFromStep: z.number().int().nonnegative().optional()
      .describe("Take the ref from the items of an earlier burst step in the same burst (0-based step index). Keeps find+click atomic for dynamic UIs."),
    refIndex: z.number().int().nonnegative().optional()
      .describe("Which item of that earlier step to take; defaults to the first.")
  }).strict().refine((step) => !!step.ref || step.refFromStep !== undefined, "Burst click requires ref or refFromStep."),
  z.object({
    action: z.literal("fill"),
    tabId: tabIdSchema.optional(),
    ref: z.string().min(1).max(300).optional()
      .describe("Element ref of the field to fill, from this burst or from find_elements."),
    refFromStep: z.number().int().nonnegative().optional()
      .describe("Take the ref from the items of an earlier burst step in the same burst (0-based step index)."),
    refIndex: z.number().int().nonnegative().optional()
      .describe("Which item of that earlier step to take; defaults to the first."),
    value: z.string().max(20000)
      .describe("Text to put in the field; it replaces the field's current value.")
  }).strict().refine((step) => !!step.ref || step.refFromStep !== undefined, "Burst fill requires ref or refFromStep."),
  z.object({
    action: z.literal("key"),
    tabId: tabIdSchema.optional(),
    key: navigationKeySchema.optional()
      .describe("Key to press in this step, e.g. Enter or ArrowLeft."),
    modifiers: z.array(modifierSchema).max(4).optional()
      .describe("Modifiers held for the key, e.g. [\"control\"]."),
    text: z.string().min(1).max(20000).optional()
      .describe("Text to type into the focused surface. Cannot be combined with key or modifiers.")
  }).strict(),
  z.object({
    action: z.literal("scroll"),
    tabId: tabIdSchema.optional(),
    x: z.number().min(-1000000).max(1000000).optional()
      .describe("Horizontal scroll in pixels; negative scrolls left, defaults to 0."),
    y: z.number().min(-1000000).max(1000000)
      .describe("Vertical scroll in pixels; negative scrolls up."),
    absolute: z.boolean().optional()
      .describe("Treat x and y as a document position instead of a relative amount; defaults to false."),
    smooth: z.boolean().optional()
      .describe("Scroll smoothly instead of jumping; defaults to false.")
  }).strict(),
  z.object({
    action: z.literal("hover"),
    tabId: tabIdSchema.optional(),
    ref: z.string().max(200).optional()
      .describe("Element ref to hover, from this burst or from find_elements."),
    refFromStep: z.number().int().nonnegative().max(7).optional()
      .describe("Take the ref from the items of an earlier burst step in the same burst (0-based step index)."),
    refIndex: z.number().int().nonnegative().max(30).optional()
      .describe("Which item of that earlier step to take; defaults to the first."),
    text: z.string().max(300).optional()
      .describe("Optional submenu name to wait for after the hover, e.g. \"Page numbers\"."),
    timeoutMs: z.number().int().min(50).max(8000).optional()
      .describe("How long to wait for the submenu; defaults to 1500.")
  }).strict(),
  z.object({
    action: z.literal("wait"),
    tabId: tabIdSchema.optional(),
    ref: z.string().min(1).max(300).optional()
      .describe("Element ref to wait for."),
    selector: z.string().min(1).max(500).optional()
      .describe("CSS selector to wait for."),
    text: z.string().min(1).max(300).optional()
      .describe("Text to wait for on the page."),
    visibleOnly: z.boolean().optional()
      .describe("Wait only for a visible element; defaults to true."),
    timeoutMs: z.number().int().min(50).max(8000).optional()
      .describe("How long to wait; defaults to 5000."),
    intervalMs: z.number().int().min(25).max(1000).optional()
      .describe("How often to look; defaults to 75.")
  }).strict().refine((step) => !!(step.ref || step.selector || step.text), "Wait requires ref, selector, or text."),
  z.object({
    action: z.literal("pointer"),
    tabId: tabIdSchema.optional(),
    pointerAction: z.enum(["move", "click", "drag", "wheel"])
      .describe("Which pointer job: a coordinate move, click, drag or wheel."),
    x: z.number().nonnegative()
      .describe("Viewport x of the pointer."),
    y: z.number().nonnegative()
      .describe("Viewport y of the pointer."),
    endX: z.number().nonnegative().optional()
      .describe("Viewport x to drag to; a drag requires it."),
    endY: z.number().nonnegative().optional()
      .describe("Viewport y to drag to; a drag requires it."),
    deltaX: z.number().min(-1200).max(1200).optional()
      .describe("Wheel delta on the x axis; defaults to 0."),
    deltaY: z.number().min(-1200).max(1200).optional()
      .describe("Wheel delta on the y axis; a wheel requires it.")
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
    url: httpUrlSchema.describe("HTTP/HTTPS URL to navigate to. A navigation replaces the document: refs minted before it cannot be used after it.")
  }).strict()
]);


type TargetTab = { tabId: number };
type ExecutionMode = "background" | "foreground";

export function registerTools(server: McpServer, deps: ToolDeps) {
  const {
    execute, executeScreenshot, executeRecordStart, executeRecordStop, executeScan, executeMap, executeSearchBing, executeStatus, executeUpdateStatus, runWorkflow, runAdhoc, rpc, textResult, toolError,
    callVmHost, vmRunResult, rpcErrorParts, db, deviceName, provider, caller, deviceResolution
  } = deps;

  server.registerTool("browser_status", {
    title: "Check Opera Agent",
    description: "Check whether the user's local Opera Agent extension is online and list its capabilities. Call this first for browser-control requests. Returns: ok, paired, product, version, deviceName, capabilities, protocolVersion and time, plus bridge.lastError when the bridge has failed, the worker's own faults as errors with errorCount (errorsTruncated and omittedErrors when the list did not fit), extensionPresent with deviceStatus (online, offline or never), deviceLastSeenAt, deviceExtensionVersion, latestExtensionVersion and extensionUpdatePending, so an extension that was never installed is told from one whose device is asleep, and one Chrome has not updated yet is named; and device (name, source pin|freshest, pinned, ageMs) naming the browser it will drive and how it chose it, plus device.alternatives naming the other browsers of this account that are awake.",
    inputSchema: { timeoutMs: timeoutSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ timeoutMs }: { timeoutMs?: number }) => executeStatus("browser.ping", {}, timeoutMs, deviceName, provider, caller?.userId ?? null, deviceResolution ?? null));

  server.registerTool("check_update", {
    title: "Check for an extension update",
    description: "Say whether the browser runs the newest build the server serves. Read-only: it asks the update service what it serves and compares it with the version the extension reports. Returns: ok, the installed version, the served version, and whether an update is waiting.",
    inputSchema: { timeoutMs: timeoutSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ timeoutMs }: { timeoutMs?: number }) => executeUpdateStatus(timeoutMs, deviceName, provider));

  server.registerTool("apply_update", {
    title: "Update the extension",
    description: "Write the newest build the server serves over the extension's own folder and restart the extension. The folder is the one the reader allowed; without it the update cannot be written, and the answer says so. Returns: ok, whether a new build was written, and the version now running.",
    inputSchema: { timeoutMs: timeoutSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ timeoutMs }: { timeoutMs?: number }) => execute("extension.update", {}, timeoutMs, deviceName, provider));

  server.registerTool("run_browser_burst", {
    title: "Run fast Opera action burst",
    description: "Run 1-8 dependent page actions sequentially. Each step may name its own tab and defaults to the burst tab. Defaults to background execution, and coordinate steps draw a visible cursor marker. Foreground mode displays pointer steps and requires a tab the user already allowed to be activated. A step that consumes another step's ref must run on the tab that minted it, and no ref survives a navigate step on that tab. It stops at the first failure, has a 12-second total limit, and cannot open, close, loop, branch, or execute JavaScript. Returns: ok, tabId, executionMode, completedSteps and the results, one entry per step with its action, its outcome and the evidence it produced.",
    inputSchema: {
      tabId: tabIdSchema,
      steps: z.array(burstStepSchema).min(1).max(8)
        .describe("The steps to run, in order. Each step is one action and may name its own tab; the first step runs on the burst tab."),
      executionMode: executionModeSchema,
      timeoutMs: burstTimeoutSchema
    },
    outputSchema: commandOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, steps, executionMode, timeoutMs }: TargetTab & { steps: Array<Record<string, unknown>>; executionMode?: ExecutionMode; timeoutMs?: number }) => {
    const params = executionMode === "foreground" ? { tabId, steps, executionMode } : { tabId, steps };
    return execute("browser.burst", params, timeoutMs, deviceName, provider);
  });

  server.registerTool("run_workflow", {
    title: "Run Opera Agent workflow",
    description: "Run a versioned site workflow (for example youtube.skip_ads) end to end on the paired Opera device: ad detection, retrying skip clicks against freshly re-queried controls, and ad-state verification all happen inside one run. Use this for known repeated intents instead of hand-driving each click and risking stale element references. Returns: ok, workflow, status and the workflow result, with error carrying the failure when the run did not complete.",
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
    description: "Run a gate-approved OA_REACTIVE_VM_V1 read-only program end to end on the paired Opera device without the model in the loop: the VM host enqueues it, the device executes read/verify commands, and verification evidence comes back with the run. Use this for ad-hoc multi-step read intents instead of hand-driving each find. Write actions are refused here; they run as registered workflows via run_workflow. Returns: ok, the run status, and the program result with its verification evidence.",
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
    description: "Run a one-off write task (find, fill, ordinary clicks, verify) as a temporary workflow on the paired Opera device: the definition is compiled, registered under adhoc.*, executed, then deleted. Consequential actions need confirm:true in the graph. Returns: ok, workflow, status and result, error when it failed, and deleted telling whether the temporary workflow was removed.",
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
    description: "Save a task lesson to the shared skill memory, which is generic experience shared across accounts rather than per-device state. Returns: ok and the id of the saved lesson.",
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
    description: "Recall matching lessons from the shared skill memory, which is generic experience shared across accounts rather than per-device state. Returns: ok and the matching lessons, each with its task, site, lesson and pitfalls.",
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
    description: "Arm a device-local trigger on an Opera tab: when the trigger condition becomes true (already-true-at-arm fires immediately), the device executes the action locally and an event appears in wait_events — no model round trip in between. Prefer this over polling with repeated find/read calls on fast-changing pages (ad overlays, countdowns, dynamic lists). Trigger kinds: selectorPresence, selectorGone, textMatch, urlChange, navigation, adState, mediaTime. Action types: report (default), click, burst, workflow, confirm. Returns: ok, watcherId, tabId, armed, and warning when the trigger could not be armed.",
    inputSchema: {
      tabId: tabIdSchema,
      rule: z.object({
        ruleId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional()
          .describe("Your own name for the watcher. It comes back as watcherId and is what stop_watch takes."),
        trigger: z.object({
          kind: z.enum(['selectorPresence', 'selectorGone', 'textMatch', 'urlChange', 'navigation', 'adState', 'mediaTime'])
            .describe("What to watch for: an element that appears or goes, text that appears, a url change, a navigation, an ad state, or a media position."),
          selector: z.string().min(1).max(500).optional()
            .describe("CSS selector the trigger watches. Required by selectorPresence and selectorGone."),
          adSelectors: z.array(z.string().min(1).max(500)).max(8).optional()
            .describe("Ad selectors watched together; the adState trigger fires when one of them is on the page."),
          text: z.string().min(1).max(500).optional()
            .describe("Text the trigger watches. Required by textMatch."),
          mode: z.enum(['contains', 'exact']).optional()
            .describe("How textMatch compares the text: contains or exact. Defaults to contains."),
          state: z.enum(['on', 'off', 'any']).optional()
            .describe("Which ad state the adState trigger waits for: on, off or any. Defaults to any."),
          atSeconds: z.number().min(0).max(86400).optional()
            .describe("Media position in seconds the mediaTime trigger fires at."),
          withinSeconds: z.number().min(0).max(60).optional()
            .describe("How long after the page loads the trigger may still fire.")
        }),
        action: z.object({
          type: z.enum(['report', 'click', 'burst', 'workflow', 'confirm']).default('report')
            .describe("What happens when the trigger fires: report it, click, run a burst, run a workflow, or ask the user to confirm."),
          selector: z.string().max(500).optional()
            .describe("CSS selector of the element to act on."),
          trusted: z.boolean().optional()
            .describe("Send the action as real browser input instead of a script call."),
          steps: z.array(z.record(z.string(), z.unknown())).max(8).optional()
            .describe("Burst steps to run when the trigger fires."),
          workflowName: z.string().max(100).optional()
            .describe("Workflow to run when the trigger fires."),
          params: z.record(z.string(), z.unknown()).optional()
            .describe("Input for the workflow."),
          message: z.string().max(500).optional()
            .describe("Text to report when the trigger fires.")
        }),
        mode: z.enum(['once', 'repeat']).optional()
          .describe("Fire once or repeat. Defaults to once."),
        maxEvents: z.number().int().min(1).max(100).optional()
          .describe("Stop the watcher after this many firings."),
        deadlineMs: z.number().int().min(1000).max(600000).optional()
          .describe("Stop the watcher after this many milliseconds. Defaults to 60000."),
        debounceMs: z.number().int().min(0).max(60000).optional()
          .describe("Wait this long after a firing before the watcher may fire again.")
      }),
      timeoutMs: timeoutSchema
    },
    outputSchema: commandOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, rule, timeoutMs }: TargetTab & { rule: Record<string, unknown>; timeoutMs?: number }) => execute("watch.start", { tabId, rule }, timeoutMs, deviceName, provider));

  server.registerTool("wait_events", {
    title: "Wait for watch events",
    description: "Long-poll for device-local watch events (from start_watch). Returns immediately when one or more events arrive; returns an empty list after the wait window. Pass the returned cursor on the next call to receive only newer events. Events carry the fired rule, the page URL/adState/mediaTime, and the local action result (click/burst/workflow outcome). Returns: ok, the events that fired, the cursor to pass on the next call, and the count.",
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
    description: "Disarm one watcher by id (stop_watch) or every active watcher (stopAll). Watchers also self-retire at their deadline/maxEvents, when their tab closes, or via the popup kill switch. Returns: ok and how many watchers were removed.",
    inputSchema: {
      watcherId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional()
        .describe("Watcher to stop, as start_watch returned it."),
      stopAll: z.boolean().optional()
        .describe("Stop every watcher on the device instead of one."),
      timeoutMs: timeoutSchema
    },
    outputSchema: commandOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, ({ watcherId, stopAll, timeoutMs }: { watcherId?: string; stopAll?: boolean; timeoutMs?: number }) =>
    stopAll
      ? execute("watch.stop_all", {}, timeoutMs, deviceName, provider)
      : execute("watch.stop", { watcherId }, timeoutMs, deviceName, provider));

  server.registerTool("list_tabs", {
    title: "List open Opera tabs",
    description: "List the open Opera tabs. Returns: ok and the tabs, each with id, title, url, active and its load status.",
    inputSchema: { currentWindow: z.boolean().optional().describe("Only return tabs in the current Opera window.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ currentWindow }: { currentWindow?: boolean }) => execute("tabs.list", { currentWindow: currentWindow ?? false }, undefined, deviceName, provider));

  server.registerTool("open_url", {
    title: "Open URL in Opera",
    description: "Open an HTTP or HTTPS URL in a new background Opera tab. Set active true only when the user explicitly asks to see the new tab or permits foreground interaction. Returns: ok and the new tab, with its id, title, url and active flag.",
    inputSchema: {
      url: httpUrlSchema.describe("HTTP/HTTPS URL to open in a new tab."),
      active: z.boolean().optional().describe("Make the new tab active. Defaults to false; use true only with explicit user permission."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ url, active, timeoutMs }: { url: string; active?: boolean; timeoutMs?: number }) => execute("tabs.open", { url, active: active ?? false, wait: true }, timeoutMs, deviceName, provider));

  server.registerTool("activate_tab", {
    title: "Activate Opera tab",
    description: "Explicitly activate an Opera tab and focus its window. Use only when the user asks to see that tab or permits foreground interaction; never use as automatic recovery. Returns: ok and the activated tab, with reused telling whether it was already active and windowUpdate telling what the window did.",
    inputSchema: { tabId: tabIdSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.activate", { tabId, focusWindow: true }, undefined, deviceName, provider));

  server.registerTool("navigate_tab", {
    title: "Navigate Opera tab",
    description: "Navigate an explicit Opera target tab to an HTTP/HTTPS URL without activating it, then wait for it to load. Returns: ok and the tab after loading, with reused telling whether the page was already there.",
    inputSchema: {
      tabId: tabIdSchema,
      url: httpUrlSchema.describe("HTTP/HTTPS URL to navigate to. A navigation replaces the document: refs minted before it cannot be used after it."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, url, timeoutMs }: TargetTab & { url: string; timeoutMs?: number }) => execute("tabs.navigate", { tabId, url, wait: true }, timeoutMs, deviceName, provider));

  server.registerTool("close_tab", {
    title: "Close Opera tab",
    description: "Close one Opera tab by ID. Use only when the user asks to close it. Returns: ok and the tab id that was closed.",
    inputSchema: { tabId: tabIdSchema },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, ({ tabId }: { tabId: number }) => execute("tabs.close", { tabId }, undefined, deviceName, provider));

  server.registerTool("read_page", {
    title: "Read Opera page",
    description: "One reader, two answers. The default answers the current task: the active viewport with relevant text and reusable refs, relevant change evidence, screen rectangles, true viewport presence, document identity, viewport geometry, and zoom; text-poor canvas-class pages also carry a read-only axSummary accessibility snapshot. view: map answers the whole document instead: every meaningful element grouped into seventeen classes with document coordinates that survive scrolling, or the skeleton (counts per class, regions, headings, tables, images), or one class paginated, or every class in one call with all:true. Both are the same engine; pick by the question, not by habit. Returns: ok, tabId, and the answer named by view - the page observation (url, title, text, the elements with their refs, the viewport facts) for brief, or the page facts (classes/regions/outline/tables/images for the skeleton, or elements with offset, limit, total, hasMore and nextOffset) for map.",
    inputSchema: {
      tabId: tabIdSchema,
      view: z.enum(["brief", "map"]).optional()
        .describe("'brief' (default) is the task-facing read: viewport text with reusable refs and the delta since the last read. 'map' is the document-wide map: every element grouped into seventeen classes with document coordinates."),
      offset: z.number().int().nonnegative().optional()
        .describe("brief: where in the text to start reading, in characters; defaults to 0. map: how many elements of the class to skip; defaults to 0."),
      limit: z.number().int().positive().optional()
        .describe("brief: how much text to read, in characters; defaults to 6000, up to 12000. map: how many elements to return; defaults to 200 and never more than 1000."),
      includeElements: z.boolean().optional()
        .describe("brief only: return the interactive elements with their refs; defaults to true."),
      maxElements: z.number().int().min(1).max(300).optional()
        .describe("brief only: maximum elements to return; defaults to 120."),
      class: z.enum(["button", "choice", "input", "select", "heading", "link", "media", "iframe", "picture", "icon", "table", "list", "form", "region", "separator", "status", "text"]).optional()
        .describe("map only: one of the seventeen classes to pull; omit it to get the skeleton."),
      all: z.boolean().optional()
        .describe("map only: one call that answers every class at once: the whole document's elements with the class each one belongs to, so nothing has to be pulled class by class. The answer is trimmed to the device's ceiling and says so."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, (args: TargetTab & { view?: "brief" | "map"; offset?: number; limit?: number; includeElements?: boolean; maxElements?: number; class?: string; all?: boolean; timeoutMs?: number }) => {
    if ((args.view ?? "brief") === "map") {
      return executeMap({ tabId: args.tabId, ...(args.class ? { class: args.class } : {}), ...(args.all === true ? { all: true } : {}), ...(args.offset != null ? { offset: args.offset } : {}), ...(args.limit != null ? { limit: args.limit } : {}) }, args.timeoutMs ?? 30000, deviceName, provider);
    }
    const { view: _view, class: _class, all: _all, timeoutMs: _timeoutMs, ...briefArgs } = args;
    const textLimit = briefArgs.limit != null ? Math.min(12000, Math.max(300, briefArgs.limit)) : undefined;
    return execute("page.read", { ...briefArgs, ...(textLimit ? { limit: textLimit } : {}), view: "compact" }, undefined, deviceName, provider);
  });

  server.registerTool("capture_page", {
    title: "Capture Opera page",
    description: "Capture a bounded JPEG of an explicit Opera tab without activating it. Use adaptively for visual pages, canvas, low-confidence targets, state changes, or failed verification—not after every action. Pass the previous SHA-256 hash to suppress unchanged image data. With fullPage the whole scrollable document is captured, and a page too tall to read in one image comes back as tiles walked by tileOffset. The extension blocks incognito, user-private, password, OTP, payment, and other sensitive surfaces locally. Returns: ok, tabId and the image; the text carries the capture metadata and the hash to pass as previousHash next time, or tiles with documentHeight, tileCount, coveredHeight, hasMore and nextTileOffset when the page is delivered in slices.",
    inputSchema: {
      tabId: tabIdSchema,
      crop: z.object({
        x: z.number().nonnegative()
          .describe("Viewport x of the crop's left edge."),
        y: z.number().nonnegative()
          .describe("Viewport y of the crop's top edge."),
        width: z.number().positive()
          .describe("Crop width in pixels."),
        height: z.number().positive()
          .describe("Crop height in pixels.")
      }).strict().optional().describe("Optional viewport-relative crop rectangle; it must remain fully inside the visible viewport."),
      quality: z.number().int().min(40).max(80).optional().describe("JPEG quality. Defaults to 60 and may be reduced locally to satisfy the byte limit."),
      maxWidth: z.number().int().min(320).max(1600).optional().describe("Maximum returned image width. Defaults to 1280."),
      maxHeight: z.number().int().min(240).max(1200).optional().describe("Maximum returned image height. Defaults to 900."),
      previousHash: z.string().regex(/^[a-f0-9]{64}$/i).optional().describe("SHA-256 from the prior capture; matching images return metadata without duplicate image bytes."),
      fullPage: z.boolean().optional().describe("Span the whole scrollable document past the viewport instead of the visible area. Exclusive with crop."),
      tileOffset: z.number().int().nonnegative().optional().describe("Which slice of a full-page tile set to return; 0 is the first slice, and nextTileOffset names the next one."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, crop, quality, maxWidth, maxHeight, previousHash, fullPage, tileOffset, timeoutMs }: TargetTab & {
    crop?: { x: number; y: number; width: number; height: number };
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    previousHash?: string;
    fullPage?: boolean;
    tileOffset?: number;
    timeoutMs?: number;
  }) => executeScreenshot({ tabId, ...(crop ? { crop } : {}), ...(quality != null ? { quality } : {}), ...(maxWidth != null ? { maxWidth } : {}), ...(maxHeight != null ? { maxHeight } : {}), ...(previousHash ? { previousHash } : {}), ...(fullPage === true ? { fullPage: true } : {}), ...(tileOffset != null ? { tileOffset } : {}) }, timeoutMs ?? (fullPage === true ? 30000 : undefined), deviceName, provider));

  server.registerTool("record_start", {
    title: "Record an Opera tab from here on",
    description: "Arm a recording on the tab to a webm in the user's download folder. After this call, drive whatever the task needs - click_element, fill_element, press_key, scroll_page, pointer or run_browser_burst - or pass scroll:true to also sweep the page top to bottom - and pass record_stop when it is finished. The recorder captures the visual result of everything that happens; the same sensitive-surface refusal as capture_page applies at arm time. Returns: ok, tabId, the armed manifest (filename, fps, maxWidth, quality, scrolled, startedAt) and the page being recorded.",
    inputSchema: {
      tabId: tabIdSchema,
      filename: z.string().max(120).optional()
        .describe("Optional file name for the webm in Downloads; a safe default is used otherwise."),
      fps: z.number().int().min(5).max(30).optional()
        .describe("Target frames per second for the encoder. Defaults to 15."),
      maxWidth: z.number().int().min(320).max(1600).optional()
        .describe("Maximum width of the encoded frame. Defaults to 1280."),
      quality: z.number().int().min(40).max(80).optional()
        .describe("JPEG quality of the screencast frames. Defaults to 60."),
      scroll: z.boolean().optional()
        .describe("Also sweep the page from top to bottom with a smooth scroll. Defaults to false - drive whatever else the task needs."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, filename, fps, maxWidth, quality, scroll, timeoutMs }: TargetTab & {
    filename?: string;
    fps?: number;
    maxWidth?: number;
    quality?: number;
    scroll?: boolean;
    timeoutMs?: number;
  }) => executeRecordStart({ tabId, ...(filename ? { filename } : {}), ...(fps != null ? { fps } : {}), ...(maxWidth != null ? { maxWidth } : {}), ...(quality != null ? { quality } : {}), ...(scroll === true ? { scroll: true } : {}) }, timeoutMs ?? 10000, deviceName, provider));

  server.registerTool("record_stop", {
    title: "Finish the Opera tab recording",
    description: "Finish an armed recording and write the webm to the user's download folder. Returns: ok, tabId, the recording manifest (filename, path, bytes, durationMs, screencastFrames, encoderFrames, scrolledTo), the page it recorded, and up to four sampled JPEG stills as images.",
    inputSchema: {
      tabId: tabIdSchema,
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, timeoutMs }: TargetTab & { timeoutMs?: number }) => executeRecordStop({ tabId }, timeoutMs ?? 30000, deviceName, provider));

  server.registerTool("dump_page", {
    title: "Dump the page as structured content",
    description: "Read the whole page, not one viewport: the title, the URL, the visible text (paginated by offset and limit), the headings, the links with their text, the scripts, and the stylesheets, in one structured object. Use it when a question needs the entire written content of a page rather than a corner of it - the answer for 'what does this page say', 'what links does it have', 'is there a script for X'. For one visible viewport use read_page; for a self-contained offline file of the same content use save_page. Returns: ok, tabId, dump { url, title, offset, limit, totalText, truncated, nextOffset, text, headings, links, scripts, styles }, and the page it came from.",
    inputSchema: {
      tabId: tabIdSchema,
      offset: z.number().int().min(0).optional().describe("Where in the text to start, in characters. Defaults to 0."),
      limit: z.number().int().min(0).max(200000).optional().describe("How much text to return, in characters. Defaults to 12000; pass 0 for structure only, with no text."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ tabId, offset, limit, timeoutMs }: TargetTab & { offset?: number; limit?: number; timeoutMs?: number }) => execute("page.dump", { tabId, ...(offset != null ? { offset } : {}), ...(limit != null ? { limit } : {}) }, timeoutMs ?? 20000, deviceName, provider));

  server.registerTool("save_page", {
    title: "Save the page into one file",
    description: "Save a page into one self-contained html file in the user's download folder: the rendered light DOM with its stylesheets, scripts (integrity preserved), images, icons, srcset and the @font-face fonts referenced by those stylesheets inlined as data URLs - the internal structure of a site, kept for offline reading or reconstruction. The file is written into Downloads directly; no Save dialog is shown, because the device owns the write. Uses the same sensitive-surface refusal as capture_page: password, OTP, payment and other sensitive pages are never saved. KeptAbsolute lists assets that could not be fetched or inlined, and shadow roots are not serialized by outerHTML. Returns: ok, tabId, the scan manifest (filename, path, bytes, documentBytes, inlined counts, fontsInlined, keptAbsolute, failures, shadowRoots note) and the page it came from.",
    inputSchema: {
      tabId: tabIdSchema,
      filename: z.string().max(120).optional()
        .describe("Optional file name for the scan in Downloads; a safe default is used otherwise."),
      maxBytes: z.number().int().min(524288).max(26214400).optional()
        .describe("Size budget for the finished scan. Defaults to 10 MiB; the scan is refused with SCAN_TOO_LARGE above it."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, filename, maxBytes, timeoutMs }: TargetTab & {
    filename?: string;
    maxBytes?: number;
    timeoutMs?: number;
  }) => executeScan({ tabId, ...(filename ? { filename } : {}), ...(maxBytes != null ? { maxBytes } : {}) }, timeoutMs ?? 55000, deviceName, provider));

  server.registerTool("search_bing", {
    title: "Search Bing",
    description: "Search Bing in one call and get the results as structured data, not a page to read: for each result its rank, the title Bing shows, the URL, the site (host without www.) and the snippet Bing renders next to it, in Bing's own order, deduplicated across the pages fetched. pages: 1 (default) fetches only the first results page; pass 2 or 3 to follow Bing's own pagination links (ten results per page at the time of writing). truncated is true exactly when Bing still has a page beyond the ones fetched, so an agent can ask for more deliberately instead of mistaking the first ten for everything there is. One background tab is opened, read and closed; nothing is left on the browser. Returns: ok, kind \"search\", the page read, and search { query, engine, pages, count, truncated, results[] }.",
    inputSchema: {
      query: z.string().min(1).max(400)
        .describe("What to search for; handed to Bing verbatim as the query."),
      pages: z.number().int().min(1).max(3).optional()
        .describe("How many result pages to fetch, following Bing's own pagination links. Defaults to 1; at most 3."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ query, pages, timeoutMs }: { query: string; pages?: number; timeoutMs?: number }) => executeSearchBing({ query, ...(pages != null ? { pages } : {}) }, timeoutMs, deviceName, provider));

  server.registerTool("find_elements", {
    title: "Find page elements",
    description: "Find visible interactive elements by human-readable text, ARIA role, or HTML tag. Returns: ok, tabId, and the matching elements as items, each with a ref for click_element/fill_element, its role and name, and its rectangle for the pointer tools.",
    inputSchema: {
      tabId: tabIdSchema,
      text: z.string().max(300).optional()
        .describe("Text to match against the element's visible or accessible name."),
      role: z.string().max(80).optional()
        .describe("ARIA role to match, e.g. button, link, textbox."),
      tag: z.string().max(80).optional()
        .describe("HTML tag to match, e.g. button, a, input."),
      exact: z.boolean().optional()
        .describe("Match the whole name instead of a part of it; defaults to false."),
      limit: z.number().int().min(1).max(100).optional()
        .describe("Maximum elements to return; defaults to 30.")
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, (args: TargetTab & { text?: string; role?: string; tag?: string; exact?: boolean; limit?: number }) => execute("page.find", args, undefined, deviceName, provider));

  server.registerTool("click_element", {
    title: "Click page element",
    description: "Click an element ref on an explicit target tab using trusted browser input. Background execution is the default and does not activate the tab. Returns: ok, tabId, and what the click settled: the page state, plus openedTabs when the click opened a tab.",
    inputSchema: {
      tabId: tabIdSchema,
      ref: z.string().min(1).max(300)
        .describe("Element ref to click, from find_elements or read_page."),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, ref, executionMode }: TargetTab & { ref: string; executionMode?: ExecutionMode }) => execute("page.click", { tabId, ref, trusted: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("fill_element", {
    title: "Fill page field",
    description: "Fill a non-sensitive editable element by ref. The extension blocks passwords, OTPs, payment fields, and file uploads. Returns: ok, tabId, and what the fill settled: the value now in the field and the page state.",
    inputSchema: {
      tabId: tabIdSchema,
      ref: z.string().min(1).max(300)
        .describe("Element ref of the field to fill, from find_elements or read_page."),
      value: z.string().max(20000)
        .describe("Text to put in the field; it replaces the field's current value."),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ tabId, ref, value, executionMode }: TargetTab & { ref: string; value: string; executionMode?: ExecutionMode }) => execute("page.fill", { tabId, ref, value, trusted: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("press_key", {
    title: "Press a key chord or type text",
    description: "Send trusted keyboard input to the focused element. Either an allowlisted key with optional modifiers (Ctrl+A selects all, Ctrl+V pastes, Shift+Enter inserts a line break in an editor, Ctrl+Shift+Z redoes), or a text string of up to 20000 characters to type into the currently focused surface, which is how you fill a rich or canvas editor. Pass exactly one of key or text. Keyboard input is refused on password, OTP, and payment fields. Returns: ok, tabId, and what the keypress settled: the focused surface and the page state.",
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
    description: "Send up to 100 key chords and text fragments as one command instead of one call each: menu walks, grid sizing, and multi-chord shortcuts that would cost a round trip per key otherwise. Events run back-to-back on the device in order, with an optional pause after any event for menus that need a beat to open. Each event carries exactly one of key or text, like press_key. Keyboard input is refused on password, OTP, and payment fields. Returns: ok, tabId, and the page state after the last event.",
    inputSchema: {
      tabId: tabIdSchema,
      events: z.array(z.object({
        key: navigationKeySchema.optional()
          .describe("Key to press in this event, e.g. Enter or ArrowLeft."),
        modifiers: z.array(modifierSchema).max(4).optional()
          .describe("Modifiers held for the key, e.g. [\"control\"]."),
        text: z.string().min(1).max(20000).optional()
          .describe("Text to type in this event. Cannot be combined with key or modifiers."),
        gapMs: z.number().int().min(0).max(2000).optional()
          .describe("Pause after this event, for menus and popups that need a beat to open.")
      }).strict()).min(1).max(100),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, events, executionMode }: TargetTab & { events: Array<{ key?: string; modifiers?: string[]; text?: string; gapMs?: number }>; executionMode?: ExecutionMode }) => execute("page.stream", { tabId, events, trusted: true, executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("scroll_page", {
    title: "Scroll page",
    description: "Scroll an explicit target page by a relative horizontal/vertical amount, or to an absolute document position, without activating its tab. Returns: ok, tabId, and the scroll outcome: the before and after document metrics, what moved, the DOM change, whether the page settled, and whether the edge was reached.",
    inputSchema: {
      tabId: tabIdSchema,
      x: z.number().min(-1000000).max(1000000).optional()
        .describe("Horizontal scroll in pixels; negative scrolls left, defaults to 0."),
      y: z.number().min(-1000000).max(1000000)
        .describe("Vertical scroll in pixels; negative scrolls up."),
      absolute: z.boolean().optional()
        .describe("Treat x and y as a document position instead of a relative amount; defaults to false."),
      smooth: z.boolean().optional()
        .describe("Scroll smoothly instead of jumping; defaults to false."),
      executionMode: executionModeSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, x, y, absolute, smooth, executionMode }: TargetTab & { x?: number; y: number; absolute?: boolean; smooth?: boolean; executionMode?: ExecutionMode }) => execute("page.scroll", { tabId, x: x ?? 0, y, absolute: absolute ?? false, behavior: smooth ? "smooth" : "instant", executionMode: executionMode ?? "background" }, undefined, deviceName, provider));

  server.registerTool("pointer", {
    title: "Pointer input",
    description: "One pointer for every pointer job: move, click, drag, and wheel by viewport coordinates, or hover by element ref. A visible cursor marker is drawn in both modes so an owner can follow the run; background mode does not activate the tab. A hover settles on the ref and reports what it revealed, which is how a menu entry that owns a submenu is opened. Coordinate actions need x and y (a drag also needs endX and endY, a wheel needs deltaY); a hover needs a ref from find_elements instead. Prefer click_element for plain clicks and verify page state. Returns: ok, tabId, and what the pointer settled: the page state, and for a hover the submenu it revealed.",
    inputSchema: {
      tabId: tabIdSchema,
      pointerAction: z.enum(["move", "click", "drag", "wheel", "hover"])
        .describe("Which pointer job: a coordinate move, click, drag, or wheel, or a ref hover that settles."),
      x: z.number().nonnegative().optional()
        .describe("Viewport x of the pointer. Required for move, click, drag and wheel."),
      y: z.number().nonnegative().optional()
        .describe("Viewport y of the pointer. Required for move, click, drag and wheel."),
      endX: z.number().nonnegative().optional()
        .describe("Viewport x to drag to. Required for a drag."),
      endY: z.number().nonnegative().optional()
        .describe("Viewport y to drag to. Required for a drag."),
      deltaX: z.number().min(-1200).max(1200).optional()
        .describe("Wheel delta on the x axis. Defaults to 0."),
      deltaY: z.number().min(-1200).max(1200).optional()
        .describe("Wheel delta on the y axis. Required for a wheel."),
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
    description: "Report the page audio/video elements. Read-only: verify playback from this state, never from the wall clock. Returns: ok, tabId, and the media state: presence and count, paused or ended, currentTime, duration, mute and volume.",
    inputSchema: {
      tabId: tabIdSchema,
      index: z.number().int().min(0).optional().describe("Which media element on the page, defaulting to the first."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ tabId, index, timeoutMs }: TargetTab & { index?: number; timeoutMs?: number }) => execute("media.state", { tabId, index }, timeoutMs, deviceName, provider));

  server.registerTool("media_play", {
    title: "Start media playback",
    description: "Start playing the page media element, then report its state. If the browser blocks playback for lack of a user gesture, click the player's Play control with page.click instead. Returns: ok, tabId, and the media state after the change.",
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
    description: "Pause the page media element, then report its state. Returns: ok, tabId, and the media state after the change.",
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
    description: "Jump the page media element to a position in seconds, then report its state. Out-of-range positions clamp to the media duration. Returns: ok, tabId, and the media state after the seek.",
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
    description: "Start a listening session on a tab: the page media element is tapped and its audio transcribed in windows. Refused on incognito and private tabs. Read the transcript with media_listen_read and end with media_stream_stop. Returns: ok and the listening session id.",
    inputSchema: {
      tabId: tabIdSchema,
      index: z.number().int().min(0).optional().describe("Which media element on the page, defaulting to the first."),
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, ({ tabId, index, timeoutMs }: TargetTab & { index?: number; timeoutMs?: number }) => execute("media.stream_start", { tabId, index }, timeoutMs, deviceName, provider));

  server.registerTool("media_stream_stop", {
    title: "Stop the listening session",
    description: "End the live listening session: the recorder stops, the tail window is transcribed, and no further audio is captured. Returns: ok and whether the session was stopped.",
    inputSchema: {
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, ({ timeoutMs }: { timeoutMs?: number }) => execute("media.stream_stop", {}, timeoutMs, deviceName, provider));

  server.registerTool("media_listen_read", {
    title: "Read listening transcript",
    description: "Read transcript segments from a listening session, newest windows first after the given cursor. Without a sessionId, reads the device's most recent session. Transcript text travels only in this tool result, never on the dashboard. Returns: ok, sessionId, and the transcript segments after the cursor.",
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
    description: "Download one client's statement for one month to the user's own disk, under a name you choose. The file lands in the user's download folder; nothing is uploaded. A second delivery of the same client-month is refused, because a second line would bill the same month twice. Returns: ok, tabId, and the delivery proof: bytes, the kind of file read from its own bytes, the page count, and the closing balance with the page named as its source.",
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
    description: "Read the manifest the device keeps: one line per delivered client-month, with the file, its bytes, its kind, its page count and the closing balance with its source. The manifest lives on the user's own machine, beside the files it describes. Returns: ok, the rows, one per delivered client-month, and the clients and periods they cover.",
    inputSchema: {
      timeoutMs: timeoutSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, ({ timeoutMs }: { timeoutMs?: number }) => execute("statement.manifest", {}, timeoutMs, deviceName, provider));

  server.registerTool("invoice_create", {
    title: "Bill a customer for delivered client-months",
    description: "Turn delivered client-months into an invoice for one customer and one billing month. Pass the manifest rows this invoice charges for, or the client and period of each delivery; the amount is computed from the price list, never from a number in the call, and a month that was not delivered cannot be on the invoice. Pass plan to bill a plan month instead of per delivery: one plan line and a line only for each client-month above the cap. Read statement_manifest first: its rows are the proof the invoice is checked against. Returns: ok, the invoice, and the link the customer opens to pay it.",
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

  server.registerTool("switch_device", {
    title: "Switch the browser this provider drives",
    description: "Pin THIS provider - the X-Opera-Provider this call arrived with, e.g. opencode - to one browser for every later call from it, or ask which browser it drives now. Pass device to set the pin: the name must belong to this account's browsers, and a sleeping browser is fine (calls afterwards are refused by name until it is awake again). Pass any to clear the pin and let the relay answer with the freshest awake browser. Omit device to read the current pin and the browsers awake right now. A call that writes the X-Opera-Device header always wins over the stored pin for that call. The pin is stored per provider, so switching here never moves another provider to another browser. Returns: ok, provider, pin (the pinned device name or null), awake (the device names that heartbeat within two minutes), message.",
    inputSchema: {
      device: z.string().min(1).max(64).optional().describe('The browser device name to pin this provider to, e.g. opera-9; "any" to clear the pin; omit to read the current pin.')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ device }: { device?: string }) => {
    const providerName = String(provider || "unknown").trim().toLowerCase();
    if (!caller) {
      return deps.textResult({ ok: false, error: "static_pin", message: "A static token is pinned to one device by the deployment and cannot be re-pointed." });
    }
    if (!providerName || providerName === "unknown") {
      return deps.textResult({ ok: false, error: "unknown_provider", message: "The caller did not identify its provider (X-Opera-Provider), and a pin is stored per provider. Set the header and try again." });
    }
    const userId = caller.userId;
    const supabase = await deps.db();
    const { data: rows } = await supabase
      .from("opera_devices")
      .select("device_name, last_seen_at, status")
      .eq("user_id", userId)
      .neq("status", "disabled")
      .neq("status", "revoked")
      .limit(25);
    const known = (rows ?? []).map((row: { device_name?: unknown }) => String(row?.device_name ?? "").trim()).filter(Boolean);
    const now = Date.now();
    const freshNow = (rows ?? []).filter((row: { last_seen_at?: unknown }) => {
      const seen = row?.last_seen_at ? Date.parse(String(row.last_seen_at)) : NaN;
      return Number.isFinite(seen) && now - seen <= LIVE_WINDOW_MS;
    }).map((row: { device_name?: unknown }) => String(row?.device_name ?? "").trim()).filter(Boolean);
    const readPin = async () => {
      const { data } = await supabase
        .from("opera_provider_pins")
        .select("device_name")
        .eq("user_id", userId)
        .eq("provider", providerName)
        .maybeSingle();
      return String((data as { device_name?: unknown } | null)?.device_name ?? "").trim() || null;
    };

    if (!device) {
      const pin = await readPin();
      return deps.textResult({ ok: true, provider: providerName, pin, awake: freshNow, message: pin ? `Provider "${providerName}" is pinned to "${pin}".` : `Provider "${providerName}" has no pin; the freshest awake browser answers.` });
    }
    const target = device.trim();
    if (target.toLowerCase() === "any") {
      const { error } = await supabase.from("opera_provider_pins").delete().eq("user_id", userId).eq("provider", providerName);
      if (error) return deps.textResult({ ok: false, error: "pin_clear_failed", message: error.message });
      return deps.textResult({ ok: true, provider: providerName, pin: null, awake: freshNow, message: `Provider "${providerName}" pin cleared; the freshest awake browser answers.` });
    }
    const canonical = known.find((name) => name.toLowerCase() === target.toLowerCase());
    if (!canonical) {
      return deps.textResult({ ok: false, error: "unknown_device", known, message: `No device named "${target}" is registered for this account. Devices on the account: ${known.join(", ") || "none"}.` });
    }
    const { error } = await supabase.from("opera_provider_pins").upsert({ user_id: userId, provider: providerName, device_name: canonical, updated_at: new Date().toISOString() });
    if (error) return deps.textResult({ ok: false, error: "pin_failed", message: error.message });
    const asleep = freshNow.some((name) => name.toLowerCase() === canonical.toLowerCase()) ? "" : " That browser is not awake right now; calls are refused by name until it is.";
    return deps.textResult({ ok: true, provider: providerName, pin: canonical, awake: freshNow, message: `Provider "${providerName}" is pinned to "${canonical}".${asleep}` });
  });

}
