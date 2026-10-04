// @last-edited: 2026-10-04 11:10 UTC.
// @title: index — Repository file.
// @context: Deno edge function.
// @state: edge-runtime imports via deno.json import maps, restore SBOM gate.
// @updated: every file carries Last edited, Title, Purpose and Now
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

const SAFE_RETRY_DELAY_MS = 75;
const MAX_PARALLEL_ITEMS = 4;

const RETRY_SAFE_METHODS = new Set([
  "browser.ping",
  "tabs.list", "tabs.get", "tabs.find",
  "page.read", "page.query", "page.find", "page.collect_links", "page.wait_for",
  "media.state"
]);

class WorkflowError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

interface WorkflowMetrics {
  version: number;
  workflowQueueMs: number | null;
  workflowExecutionMs: number | null;
  commandCount: number;
  commandQueueMs: number;
  commandExecutionMs: number;
  commandTotalMs: number;
  returnedBytes: number;
  returnedBytesTruncated: boolean;
  retries: number;
  fixedWaitCount: number;
  intentionalWaitMs: number;
  commands: Array<Record<string, unknown>>;
  commandsTruncated: boolean;
}

interface WorkflowCtx {
  input?: unknown;
  vars: Record<string, unknown>;
  steps: Record<string, unknown>;
  metrics: WorkflowMetrics;
  [key: string]: unknown;
}

interface WorkflowStep {
  type?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  timeoutMs?: unknown;
  requestId?: unknown;
  continueOnError?: unknown;
  name?: unknown;
  value?: unknown;
  ms?: unknown;
  code?: unknown;
  message?: unknown;
  condition?: unknown;
  then?: unknown;
  else?: unknown;
  maxIterations?: unknown;
  until?: unknown;
  failOnLimit?: unknown;
  items?: unknown;
  maxItems?: unknown;
  itemVar?: unknown;
  collectVar?: unknown;
  collect?: unknown;
  parallel?: unknown;
  maxConcurrency?: unknown;
  continueOnItemError?: unknown;
  steps?: unknown;
}

interface CommandResult {
  ok: boolean;
  commandId: string;
  status: string;
  outcome?: string;
  result?: unknown;
  error?: unknown;
  timing?: unknown;
  retried?: boolean;
  previous?: unknown;
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getRef(ctx: Record<string, unknown>, path: string): unknown {
  if (!path) return null;
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object" || !(part in cur)) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolveValue(value: unknown, ctx: Record<string, unknown>): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "$ref")) return getRef(ctx, String(record.$ref || ""));
    if (Object.prototype.hasOwnProperty.call(record, "$concat")) {
      const parts = Array.isArray(record.$concat) ? record.$concat : [];
      return parts.map((part: unknown) => {
        const resolved = resolveValue(part, ctx);
        if (resolved == null) return "";
        return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
      }).join("");
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = resolveValue(item, ctx);
    return out;
  }
  return value;
}

function truthy(value: unknown) {
  if (value == null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
}

function evaluateCondition(condition: unknown, ctx: Record<string, unknown>) {
  const source = (condition ?? {}) as { op?: unknown; left?: unknown; right?: unknown };
  const op = String(source.op || "truthy");
  const left = resolveValue(source.left, ctx);
  const right = resolveValue(source.right, ctx);
  if (op === "exists") return left !== null && left !== undefined;
  if (op === "not_exists") return left === null || left === undefined;
  if (op === "eq") return JSON.stringify(left) === JSON.stringify(right);
  if (op === "ne") return JSON.stringify(left) !== JSON.stringify(right);
  if (op === "contains") return String(left ?? "").includes(String(right ?? ""));
  if (op === "falsey") return !truthy(left);
  return truthy(left);
}

function timestampMs(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAwaitTiming(timing: unknown) {
  const source = (timing ?? {}) as { queuedMs?: unknown; totalMs?: unknown };
  const queuedMs = Number(source.queuedMs);
  const totalMs = Number(source.totalMs);
  const queueMs = Number.isFinite(queuedMs) ? Math.max(0, queuedMs) : null;
  const normalizedTotal = Number.isFinite(totalMs) ? Math.max(0, totalMs) : null;
  return {
    queueMs,
    executionMs: queueMs != null && normalizedTotal != null ? Math.max(0, normalizedTotal - queueMs) : null,
    totalMs: normalizedTotal
  };
}

const METRIC_SAMPLE_CHARS = 16384;
const METRIC_SAMPLE_DEPTH = 6;
const METRIC_SAMPLE_ITEMS = 50;
const METRIC_SAMPLE_NODES = 200;

function metricSample(value: unknown, budget: { remainingChars: number; remainingNodes: number; truncated: boolean }, depth = 0): unknown {
  if (budget.remainingNodes <= 0) {
    budget.truncated = true;
    return null;
  }
  budget.remainingNodes -= 1;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const take = Math.min(value.length, budget.remainingChars);
    budget.remainingChars -= take;
    if (take < value.length) budget.truncated = true;
    return value.slice(0, take);
  }
  if (depth >= METRIC_SAMPLE_DEPTH || budget.remainingChars <= 0) {
    budget.truncated = true;
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > METRIC_SAMPLE_ITEMS) budget.truncated = true;
    return value.slice(0, METRIC_SAMPLE_ITEMS).map((item) => metricSample(item, budget, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sampled: Record<string, unknown> = {};
    let itemCount = 0;
    for (const rawKey in record) {
      if (!Object.prototype.hasOwnProperty.call(record, rawKey)) continue;
      if (itemCount >= METRIC_SAMPLE_ITEMS) {
        budget.truncated = true;
        break;
      }
      const key = rawKey.slice(0, 128);
      if (key.length < rawKey.length) budget.truncated = true;
      sampled[key] = metricSample(record[rawKey], budget, depth + 1);
      itemCount += 1;
      if (budget.remainingChars <= 0 || budget.remainingNodes <= 0) break;
    }
    return sampled;
  }
  budget.truncated = true;
  return null;
}

function sampledJsonBytes(value: unknown) {
  const budget = { remainingChars: METRIC_SAMPLE_CHARS, remainingNodes: METRIC_SAMPLE_NODES, truncated: false };
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(metricSample(value, budget))).byteLength;
    return { bytes, truncated: budget.truncated };
  } catch {
    return { bytes: 0, truncated: true };
  }
}

function createWorkflowMetrics(workflowQueueMs: number | null): WorkflowMetrics {
  return {
    version: 1,
    workflowQueueMs,
    workflowExecutionMs: null as number | null,
    commandCount: 0,
    commandQueueMs: 0,
    commandExecutionMs: 0,
    commandTotalMs: 0,
    returnedBytes: 0,
    returnedBytesTruncated: false,
    retries: 0,
    fixedWaitCount: 0,
    intentionalWaitMs: 0,
    commands: [] as Array<Record<string, unknown>>,
    commandsTruncated: false
  };
}

function recordCommandMetrics(metrics: WorkflowMetrics | null | undefined, method: string, result: unknown) {
  if (!metrics) return;
  const source = (result ?? {}) as { timing?: unknown; ok?: unknown; result?: unknown; error?: unknown; retried?: unknown; status?: unknown };
  const timing = (source.timing ?? {}) as { queueMs?: unknown; executionMs?: unknown; totalMs?: unknown };
  const queueMs = Number(timing.queueMs);
  const executionMs = Number(timing.executionMs);
  const totalMs = Number(timing.totalMs);
  const returned = sampledJsonBytes(source.ok ? source.result : source.error);
  const returnedBytes = returned.bytes;
  metrics.commandCount += 1;
  if (Number.isFinite(queueMs)) metrics.commandQueueMs += Math.max(0, queueMs);
  if (Number.isFinite(executionMs)) metrics.commandExecutionMs += Math.max(0, executionMs);
  if (Number.isFinite(totalMs)) metrics.commandTotalMs += Math.max(0, totalMs);
  metrics.returnedBytes += returnedBytes;
  if (returned.truncated) metrics.returnedBytesTruncated = true;
  if (source.retried) metrics.retries += 1;
  if (metrics.commands.length < 200) {
    metrics.commands.push({
      method,
      status: String(source.status || (source.ok ? "completed" : "failed")),
      queueMs: Number.isFinite(queueMs) ? Math.max(0, queueMs) : null,
      executionMs: Number.isFinite(executionMs) ? Math.max(0, executionMs) : null,
      totalMs: Number.isFinite(totalMs) ? Math.max(0, totalMs) : null,
      returnedBytes,
      returnedBytesTruncated: returned.truncated,
      retried: !!source.retried
    });
  } else {
    metrics.commandsTruncated = true;
  }
}

function transientFailure(result: unknown) {
  const source = (result ?? {}) as { status?: unknown; error?: unknown };
  if (source.status !== "failed") return false;
  const failure = (source.error ?? {}) as { message?: unknown };
  const message = String(failure.message || source.error || "").toLowerCase();
  return [
    "no response from page bridge",
    "receiving end does not exist",
    "could not establish connection",
    "extension context invalidated",
    "message port closed",
    "the message port closed"
  ].some((needle) => message.includes(needle));
}

function normalizeWorkflowError(error: unknown) {
  if (error instanceof WorkflowError) {
    return { code: error.code, message: error.message, details: error.details ?? null };
  }
  return { code: "WORKFLOW_ERROR", message: error instanceof Error ? error.message : String(error) };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new WorkflowError("RPC_ERROR", `${name}: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function runCommandOnce(
  run: { device_name: string },
  method: string,
  params: unknown,
  timeoutMs: number | null,
  workflowDeadline: number,
  requestId?: string | null
): Promise<CommandResult> {
  if (Date.now() >= workflowDeadline) throw new WorkflowError("WORKFLOW_TIMEOUT", "Workflow deadline exceeded.");

  const enqueued = await rpc("opera_enqueue", {
    p_method: method,
    p_params: params ?? {},
    p_timeout_ms: timeoutMs,
    p_device_name: run.device_name,
    p_request_id: requestId || null
  });
  if (!enqueued?.ok || !enqueued?.commandId) {
    throw new WorkflowError("COMMAND_ENQUEUE_FAILED", String(enqueued?.error || "Unable to enqueue command."), enqueued);
  }

  const commandId = String(enqueued.commandId);
  const remainingMs = Math.max(100, Math.min(55000, workflowDeadline - Date.now()));
  let awaited: Record<string, unknown> | null;
  try {
    awaited = await rpc("opera_await", {
      p_command_id: commandId,
      p_timeout_ms: remainingMs
    });
  } catch (error) {
    // A server-side statement timeout cancels the WAIT, not the command: the
    // browser may still complete it. Report the outcome as unknown instead of
    // failed so callers verify state instead of blindly retrying.
    const message = error instanceof Error ? error.message : String(error);
    if (/statement timeout/i.test(message)) {
      return {
        ok: false,
        commandId,
        status: "timeout",
        outcome: "unknown",
        error: {
          code: "AWAIT_OUTCOME_UNKNOWN",
          message: "The server stopped waiting before the browser reported back; the action may still have succeeded. Verify the page state before repeating the action."
        }
      };
    }
    throw error;
  }

  if (awaited?.ok) {
    return {
      ok: true,
      commandId,
      status: String(awaited.status || "completed"),
      result: awaited.result,
      timing: normalizeAwaitTiming(awaited.timing)
    };
  }

  const error = awaited?.error || { code: "COMMAND_FAILED", message: `Command ${method} failed.` };
  const failure = error && typeof error === "object" ? error as { code?: unknown } : {};
  const awaitTimedOut = String(failure.code || "").toUpperCase() === "AWAIT_TIMEOUT";
  return {
    ok: false,
    commandId,
    status: awaitTimedOut ? "timeout" : String(awaited?.status || "failed"),
    error,
    timing: normalizeAwaitTiming(awaited?.timing)
  };
}

async function runCommand(
  run: { device_name: string },
  method: string,
  params: unknown,
  timeoutMs: number | null,
  workflowDeadline: number,
  requestId?: string | null
): Promise<CommandResult> {
  const first = await runCommandOnce(run, method, params, timeoutMs, workflowDeadline, requestId);
  if (first.ok) return first;

  const retryable = ["expired", "timeout"].includes(first.status) || transientFailure(first);
  if (RETRY_SAFE_METHODS.has(method) && retryable && Date.now() + 400 < workflowDeadline) {
    await sleep(SAFE_RETRY_DELAY_MS);
    const second = await runCommandOnce(run, method, params, timeoutMs, workflowDeadline, null);
    return { ...second, retried: true, previous: first };
  }
  return first;
}

async function executeSteps(steps: unknown, ctx: WorkflowCtx, run: { device_name: string }, deadline: number): Promise<WorkflowCtx> {
  for (const item of Array.isArray(steps) ? steps : []) {
    const step = (item ?? {}) as WorkflowStep;
    if (Date.now() >= deadline) throw new WorkflowError("WORKFLOW_TIMEOUT", "Workflow deadline exceeded.");

    const type = String(step?.type || "command");
    const id = String(step?.id || "step");

    if (type === "command") {
      const method = String(step?.method || "");
      const params = resolveValue(step?.params || {}, ctx);
      const hasTimeout = Object.prototype.hasOwnProperty.call(step || {}, "timeoutMs");
      const parsedTimeout = Number(step?.timeoutMs);
      const timeoutMs = hasTimeout && Number.isFinite(parsedTimeout)
        ? Math.max(500, Math.min(55000, parsedTimeout))
        : null;
      const result = await runCommand(run, method, params, timeoutMs, deadline, step?.requestId ? String(step.requestId) : null);
      ctx.steps[id] = result;
      recordCommandMetrics(ctx.metrics, method, result);
      if (!result.ok && !step?.continueOnError) {
        const error = result.error || { code: "COMMAND_FAILED", message: "Workflow command failed." };
        const failure = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
        throw new WorkflowError(String(failure.code || "COMMAND_FAILED"), String(failure.message || "Workflow command failed."), error);
      }
      continue;
    }

    if (type === "set") {
      const name = String(step?.name || "");
      if (!name) throw new WorkflowError("INVALID_WORKFLOW", "set step requires name.");
      ctx.vars[name] = resolveValue(step?.value, ctx);
      continue;
    }

    if (type === "wait") {
      const ms = Math.max(0, Math.min(5000, Number(step?.ms || 100)));
      if (ms) {
        if (ctx.metrics) {
          ctx.metrics.fixedWaitCount += 1;
          ctx.metrics.intentionalWaitMs += ms;
        }
        await sleep(ms);
      }
      continue;
    }

    if (type === "fail") {
      throw new WorkflowError(String(step?.code || "WORKFLOW_FAILED"), String(step?.message || "Workflow failed."));
    }

    if (type === "if") {
      await executeSteps(evaluateCondition(step?.condition || {}, ctx) ? (step?.then || []) : (step?.else || []), ctx, run, deadline);
      continue;
    }

    if (type === "repeat") {
      const max = Math.max(1, Math.min(30, Number(step?.maxIterations || 5)));
      let satisfied = false;
      for (let index = 0; index < max; index += 1) {
        ctx.vars.repeatIndex = index;
        await executeSteps(step?.steps || [], ctx, run, deadline);
        if (evaluateCondition(step?.until || {}, ctx)) {
          satisfied = true;
          break;
        }
      }
      if (!satisfied && step?.failOnLimit !== false) {
        throw new WorkflowError("REPEAT_LIMIT", "Repeat condition was not satisfied.");
      }
      continue;
    }

    if (type === "foreach") {
      const items = resolveValue(step?.items || [], ctx);
      if (!Array.isArray(items)) throw new WorkflowError("INVALID_WORKFLOW", "foreach items must resolve to an array.");
      const max = Math.max(1, Math.min(30, Number(step?.maxItems || 20)));
      const count = Math.min(max, items.length);
      const itemVar = String(step?.itemVar || "item");
      const collectVar = step?.collectVar ? String(step.collectVar) : null;
      const hasCollect = collectVar && Object.prototype.hasOwnProperty.call(step, "collect");

      if (step?.parallel === true && count > 1) {
        const concurrency = Math.max(1, Math.min(MAX_PARALLEL_ITEMS, count, Number(step?.maxConcurrency || MAX_PARALLEL_ITEMS)));
        const collected: unknown[] = new Array(count).fill(null);
        let cursor = 0;
        let firstError: unknown = null;
        const continueOnItemError = step?.continueOnItemError === true;

        const worker = async () => {
          while (true) {
            if (firstError && !continueOnItemError) return;
            const index = cursor;
            cursor += 1;
            if (index >= count) return;

            const branchCtx = structuredClone(ctx);
            branchCtx.vars = branchCtx.vars || {};
            branchCtx.steps = branchCtx.steps || {};
            branchCtx.metrics = ctx.metrics;
            branchCtx.vars[itemVar] = items[index];
            branchCtx.vars.index = index;

            try {
              await executeSteps(step?.steps || [], branchCtx, run, deadline);
              if (hasCollect) collected[index] = resolveValue(step.collect, branchCtx);
            } catch (error) {
              if (continueOnItemError) {
                branchCtx.vars.itemError = normalizeWorkflowError(error);
                if (hasCollect) collected[index] = resolveValue(step.collect, branchCtx);
              } else if (!firstError) {
                firstError = error;
              }
            }
          }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        if (firstError) throw firstError;
        if (collectVar) ctx.vars[collectVar] = collected;
        continue;
      }

      const collected: unknown[] = [];
      for (let index = 0; index < count; index += 1) {
        ctx.vars[itemVar] = items[index];
        ctx.vars.index = index;
        await executeSteps(step?.steps || [], ctx, run, deadline);
        if (hasCollect) collected.push(resolveValue(step.collect, ctx));
      }
      if (collectVar) ctx.vars[collectVar] = collected;
      continue;
    }

    throw new WorkflowError("INVALID_WORKFLOW", `Unsupported workflow step type: ${type}`);
  }
  return ctx;
}

async function processRun(runId: string, token: string) {
  const { data: run, error } = await supabase.from("opera_workflow_runs").select("*").eq("id", runId).maybeSingle();
  if (error || !run) throw new WorkflowError("RUN_NOT_FOUND", "Workflow run not found.");
  if (await sha256(token) !== run.trigger_hash) throw new WorkflowError("UNAUTHORIZED", "Invalid runner token.");

  if (["completed", "failed", "expired", "cancelled"].includes(run.status)) {
    return { ok: true, runId, status: run.status, idempotent: true };
  }
  if (run.status === "running") return { ok: true, runId, status: "running", idempotent: true };

  const now = new Date().toISOString();
  const claimed = await supabase.from("opera_workflow_runs")
    .update({ status: "running", started_at: now, updated_at: now })
    .eq("id", runId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (claimed.error || !claimed.data) return { ok: true, runId, status: "running", idempotent: true };

  const activeRun = claimed.data;
  const ctx = activeRun.context || { input: activeRun.input || {}, vars: {}, steps: {} };
  ctx.input = ctx.input || activeRun.input || {};
  ctx.vars = ctx.vars || {};
  ctx.steps = ctx.steps || {};
  const deadline = Date.now() + Number(activeRun.timeout_ms || 60000);
  const runStartedAt = timestampMs(activeRun.started_at) ?? Date.now();
  const runCreatedAt = timestampMs(activeRun.created_at);
  ctx.metrics = createWorkflowMetrics(runCreatedAt == null ? null : Math.max(0, runStartedAt - runCreatedAt));

  try {
    await executeSteps(activeRun.definition?.steps || [], ctx, activeRun, deadline);
    const result = Object.prototype.hasOwnProperty.call(activeRun.definition || {}, "output")
      ? resolveValue(activeRun.definition.output, ctx)
      : ctx;
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - runStartedAt);
    ctx.metrics.workflowExecutionMs = durationMs;
    await supabase.from("opera_workflow_runs").update({
      status: "completed",
      context: ctx,
      result,
      error: null,
      completed_at: completedAt,
      updated_at: completedAt
    }).eq("id", runId);
    await supabase.from("opera_audit").insert({
      event_type: "workflow.completed",
      workflow_name: activeRun.workflow_name,
      details: { runId, version: activeRun.workflow_version, durationMs, metrics: ctx.metrics }
    });
    return { ok: true, runId, status: "completed", durationMs, metrics: ctx.metrics };
  } catch (error) {
    const normalized = normalizeWorkflowError(error);
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - runStartedAt);
    ctx.metrics.workflowExecutionMs = durationMs;
    const status = normalized.code === "WORKFLOW_TIMEOUT" ? "expired" : "failed";
    await supabase.from("opera_workflow_runs").update({
      status,
      context: ctx,
      result: null,
      error: normalized,
      completed_at: completedAt,
      updated_at: completedAt
    }).eq("id", runId);
    await supabase.from("opera_audit").insert({
      event_type: "workflow.failed",
      workflow_name: activeRun.workflow_name,
      details: { runId, version: activeRun.workflow_version, error: normalized, durationMs, metrics: ctx.metrics }
    });
    return { ok: false, runId, status, error: normalized, durationMs, metrics: ctx.metrics };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required." }, 405);

  try {
    const body = await req.json();
    const runId = String(body?.runId || "");
    const token = String(body?.token || "");
    if (!/^[0-9a-f-]{36}$/i.test(runId) || !/^[a-f0-9]{48}$/i.test(token)) {
      return json({ ok: false, error: "Invalid runner request." }, 400);
    }
    const result = await processRun(runId, token.toLowerCase());
    return json(result, result.ok ? 200 : 500);
  } catch (error) {
    const code = error instanceof WorkflowError ? error.code : "RUNNER_ERROR";
    const message = error instanceof Error ? error.message : String(error);
    createEdgeLog({}).error(code, message);
    return json({ ok: false, error: { code, message } }, code === "UNAUTHORIZED" ? 401 : 500);
  }
});
