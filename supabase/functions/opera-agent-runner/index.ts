import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

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

const COMMAND_POLL_MIN_MS = 25;
const COMMAND_POLL_MAX_MS = 100;
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

function getRef(ctx: any, path: string) {
  if (!path) return null;
  let cur: any = ctx;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object" || !(part in cur)) return null;
    cur = cur[part];
  }
  return cur;
}

function resolveValue(value: any, ctx: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "$ref")) return getRef(ctx, String(value.$ref || ""));
    if (Object.prototype.hasOwnProperty.call(value, "$concat")) {
      const parts = Array.isArray(value.$concat) ? value.$concat : [];
      return parts.map((part: any) => {
        const resolved = resolveValue(part, ctx);
        if (resolved == null) return "";
        return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
      }).join("");
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, ctx);
    return out;
  }
  return value;
}

function truthy(value: any) {
  if (value == null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
}

function evaluateCondition(condition: any, ctx: any) {
  const op = String(condition?.op || "truthy");
  const left = resolveValue(condition?.left, ctx);
  const right = resolveValue(condition?.right, ctx);
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

function commandTiming(row: any) {
  const created = timestampMs(row?.created_at);
  const claimed = timestampMs(row?.claimed_at);
  const completed = timestampMs(row?.completed_at);
  return {
    queueMs: created != null && claimed != null ? Math.max(0, claimed - created) : null,
    executionMs: claimed != null && completed != null ? Math.max(0, completed - claimed) : null,
    totalMs: created != null && completed != null ? Math.max(0, completed - created) : null
  };
}

function transientFailure(result: any) {
  if (result?.status !== "failed") return false;
  const message = String(result?.error?.message || result?.error || "").toLowerCase();
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
  return data as any;
}

async function runCommandOnce(
  run: any,
  method: string,
  params: any,
  timeoutMs: number | null,
  workflowDeadline: number,
  requestId?: string | null
) {
  if (Date.now() >= workflowDeadline) throw new WorkflowError("WORKFLOW_TIMEOUT", "Workflow deadline exceeded.");

  const enqueued = await rpc("opera_enqueue", {
    p_method: method,
    p_params: params ?? {},
    p_timeout_ms: timeoutMs,
    p_device_name: run.device_name,
    p_request_id: requestId || null
  });
  if (!enqueued?.ok || !enqueued?.commandId) {
    throw new WorkflowError("COMMAND_ENQUEUE_FAILED", enqueued?.error || "Unable to enqueue command.", enqueued);
  }

  const commandId = String(enqueued.commandId);
  let commandDeadline = workflowDeadline;
  let pollMs = COMMAND_POLL_MIN_MS;

  while (Date.now() < commandDeadline) {
    const { data, error } = await supabase
      .from("opera_commands")
      .select("status,result,error,created_at,claimed_at,completed_at,expires_at")
      .eq("id", commandId)
      .maybeSingle();
    if (error) throw new WorkflowError("COMMAND_STATUS_ERROR", error.message);
    if (!data) throw new WorkflowError("COMMAND_NOT_FOUND", `Command ${commandId} disappeared.`);

    const expiresAt = Date.parse(String(data.expires_at || ""));
    if (Number.isFinite(expiresAt)) commandDeadline = Math.min(workflowDeadline, expiresAt + 2000);

    if (data.status === "completed") {
      return { ok: true, commandId, status: data.status, result: data.result, timing: commandTiming(data) };
    }
    if (["failed", "expired", "cancelled"].includes(data.status)) {
      return {
        ok: false,
        commandId,
        status: data.status,
        error: data.error || { code: "COMMAND_FAILED", message: "Command failed." },
        timing: commandTiming(data)
      };
    }
    await sleep(pollMs);
    pollMs = Math.min(COMMAND_POLL_MAX_MS, Math.max(COMMAND_POLL_MIN_MS, Math.round(pollMs * 1.6)));
  }

  return {
    ok: false,
    commandId,
    status: "timeout",
    error: { code: "COMMAND_TIMEOUT", message: `Command ${method} did not complete before its deadline.` }
  };
}

async function runCommand(
  run: any,
  method: string,
  params: any,
  timeoutMs: number | null,
  workflowDeadline: number,
  requestId?: string | null
) {
  const first = await runCommandOnce(run, method, params, timeoutMs, workflowDeadline, requestId);
  if (first.ok) return first;

  const retryable = ["expired", "timeout"].includes(first.status) || transientFailure(first);
  if (RETRY_SAFE_METHODS.has(method) && retryable && Date.now() + 400 < workflowDeadline) {
    await sleep(SAFE_RETRY_DELAY_MS);
    const second = await runCommandOnce(run, method, params, timeoutMs, workflowDeadline, null);
    return second.ok ? { ...second, retried: true, previous: first } : { ...second, retried: true, previous: first };
  }
  return first;
}

async function executeSteps(steps: any[], ctx: any, run: any, deadline: number): Promise<any> {
  for (const step of Array.isArray(steps) ? steps : []) {
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
      if (!result.ok && !step?.continueOnError) {
        const error = result.error || { code: "COMMAND_FAILED", message: "Workflow command failed." };
        throw new WorkflowError(String(error.code || "COMMAND_FAILED"), String(error.message || "Workflow command failed."), error);
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
      if (ms) await sleep(ms);
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
        const collected: any[] = new Array(count).fill(null);
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

      const collected: any[] = [];
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

  try {
    await executeSteps(activeRun.definition?.steps || [], ctx, activeRun, deadline);
    const result = Object.prototype.hasOwnProperty.call(activeRun.definition || {}, "output")
      ? resolveValue(activeRun.definition.output, ctx)
      : ctx;
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - runStartedAt);
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
      details: { runId, version: activeRun.workflow_version, durationMs }
    });
    return { ok: true, runId, status: "completed", durationMs };
  } catch (error) {
    const normalized = normalizeWorkflowError(error);
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - runStartedAt);
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
      details: { runId, version: activeRun.workflow_version, error: normalized, durationMs }
    });
    return { ok: false, runId, status, error: normalized, durationMs };
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
    console.error("opera-agent-runner", code, message.slice(0, 500));
    return json({ ok: false, error: { code, message } }, code === "UNAUTHORIZED" ? 401 : 500);
  }
});
