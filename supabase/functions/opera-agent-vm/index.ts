import "jsr:@supabase/functions-js@2.116.0/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

import { canonicalJson, digestCanonical } from "../../../lib/goal-ledger.js";
import {
  advanceReactiveVm7D,
  createReactiveVm7D,
  validateReactiveProgram7D,
} from "../../../lib/reactive-vm-7d.js";
import {
  REACTIVE_VM_HOST_7E_LIMITS,
  classifyVmPersistence7E,
  deriveVmEffectIdempotencyKey7E,
  reconcileVmEffectObservation7E,
} from "../../../lib/reactive-vm-host-7e.js";
import {
  decodeVmHostKey,
  openVmHostToken,
  sealVmHostToken,
} from "../_shared/vm-token.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED_USER_IDS = new Set(
  (Deno.env.get("OPERA_AGENT_MCP_USER_IDS") || "").split(",").map((value) => value.trim()).filter(Boolean),
);
const ALLOWED_USER_EMAILS = new Set(
  (Deno.env.get("OPERA_AGENT_MCP_USER_EMAILS") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEVICE_NAME = "opera";
const TERMINAL = new Set(["SUSPENDED", "RETURNED", "LIMIT_REACHED", "FAILED", "CANCELLED", "EXPIRED"]);
const DOCUMENT_SCOPED = new Set([
  "browser.burst", "page.read", "page.query", "page.find", "page.collect_links", "page.capture", "page.wait_for", "media.state",
]);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

class HostError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "HostError";
    this.code = code;
    this.status = status;
  }
}

interface VmProgramTarget {
  deviceId?: unknown;
  tabId?: unknown;
  documentGeneration?: unknown;
  [key: string]: unknown;
}

interface VmProgram {
  target: VmProgramTarget;
  goalId?: unknown;
  goalRevision?: unknown;
  taskDependencies?: unknown;
  [key: string]: unknown;
}

interface VmPendingEffect {
  target?: { deviceId?: unknown; tabId?: unknown; [key: string]: unknown } | null;
  arguments?: unknown;
  method?: unknown;
  requestDigest?: unknown;
  [key: string]: unknown;
}

interface VmState {
  pendingEffect?: VmPendingEffect | null;
  lastLogicalNowMs?: unknown;
  status?: unknown;
  result?: unknown;
  suspension?: { reason?: unknown; [key: string]: unknown } | null;
  runId?: unknown;
  tenantId?: unknown;
  [key: string]: unknown;
}

interface VmClaim {
  runId?: unknown;
  programDigest?: unknown;
  leaseEpoch?: unknown;
  logicalTransition?: unknown;
  goalRevision?: unknown;
  targetDigest?: unknown;
  programToken?: unknown;
  checkpointToken?: unknown;
  checkpointDigest?: unknown;
  checkpointBytes?: unknown;
  goalId?: unknown;
  [key: string]: unknown;
}

interface VmDevice {
  id?: unknown;
  [key: string]: unknown;
}

interface VmTransition {
  kind?: unknown;
  nextPollAtMs?: unknown;
  notBeforeMs?: unknown;
  [key: string]: unknown;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function bearer(req: Request) {
  return req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

async function authenticatedUser(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || (ALLOWED_USER_IDS.size === 0 && ALLOWED_USER_EMAILS.size === 0)) return null;
  const email = data.user.email?.toLowerCase() || "";
  return ALLOWED_USER_IDS.has(data.user.id) || ALLOWED_USER_EMAILS.has(email) ? data.user : null;
}

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new HostError("STORAGE_ERROR", `${name} failed.`, 503);
  return data as Record<string, unknown> | null;
}

async function readBody(req: Request) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > REACTIVE_VM_HOST_7E_LIMITS.requestBytes) throw new HostError("OVER_LIMIT", "Request payload is too large.", 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > REACTIVE_VM_HOST_7E_LIMITS.requestBytes) throw new HostError("OVER_LIMIT", "Request payload is too large.", 413);
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HostError("INVALID_REQUEST", "Request body must be a JSON object.", 400);
  }
}

function canonicalBytes(value: unknown) {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

function nowMsAtLeast(value: unknown) {
  const previous = Number(value);
  return Math.max(Date.now(), Number.isSafeInteger(previous) ? previous : 0);
}

function boundedErrorCode(value: unknown, fallback = "HOST_ERROR") {
  const text = String(value || fallback).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 128);
  return text || fallback;
}

function safePublicRun(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return value as Record<string, unknown>;
  const record = value as Record<string, unknown>;
  return {
    ok: !!record.ok,
    ...(record.code ? { code: record.code } : {}),
    ...(record.runId ? { runId: record.runId } : {}),
    ...(record.requestId ? { requestId: record.requestId } : {}),
    ...(record.programDigest ? { programDigest: record.programDigest } : {}),
    ...(record.goalId ? { goalId: record.goalId } : {}),
    ...(record.goalRevision !== undefined ? { goalRevision: record.goalRevision } : {}),
    ...(record.targetDigest ? { targetDigest: record.targetDigest } : {}),
    ...(record.status ? { status: record.status } : {}),
    ...(record.checkpointDigest ? { checkpointDigest: record.checkpointDigest } : {}),
    ...(record.resultDigest ? { resultDigest: record.resultDigest } : {}),
    ...(record.logicalTransition !== undefined ? { logicalTransition: record.logicalTransition } : {}),
    ...(record.leaseEpoch !== undefined ? { leaseEpoch: record.leaseEpoch } : {}),
    ...(record.cancelRequested !== undefined ? { cancelRequested: record.cancelRequested } : {}),
    ...(record.availableAt !== undefined ? { availableAt: record.availableAt } : {}),
    ...(record.errorCode !== undefined ? { errorCode: record.errorCode } : {}),
    ...(record.createdAt ? { createdAt: record.createdAt } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
  };
}

async function cryptoKey() {
  const result = await rpc("opera_vm_crypto_key");
  if (!result?.enabled || typeof result.key !== "string") throw new HostError("FEATURE_DISABLED", "Checkpoint 7E VM host is disabled.", 503);
  return decodeVmHostKey(result.key);
}

async function assertGoalCurrent(tenantId: string, goalId: string, goalRevision: number) {
  const head = await rpc("opera_goal_head_get", { p_tenant_id: tenantId, p_goal_id: goalId });
  if (!head?.ok) throw new HostError(String(head?.code || "GOAL_NOT_FOUND"), "Goal ledger head is unavailable.", 409);
  if (Number(head.headRevision) !== goalRevision || !["OPEN", "PARTIAL"].includes(String(head.status))) {
    throw new HostError("GOAL_REVISED", "Goal revision or state no longer authorizes this run.", 409);
  }
  return head;
}

async function resolveDevice(expectedDeviceId: string) {
  const { data, error } = await supabase.from("opera_devices")
    .select("id,device_name,status")
    .eq("device_name", DEVICE_NAME)
    .neq("status", "disabled")
    .maybeSingle();
  if (error || !data) throw new HostError("STALE_TARGET", "Paired Opera device is unavailable.", 409);
  if (String(data.id) !== String(expectedDeviceId)) throw new HostError("STALE_TARGET", "Program target device no longer matches the paired device.", 409);
  return data;
}

function extractDocumentGeneration(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "documentGeneration")) return record.documentGeneration;
  const semantic = record.semantic && typeof record.semantic === "object" ? record.semantic as Record<string, unknown> : null;
  if (semantic && Object.prototype.hasOwnProperty.call(semantic, "documentGeneration")) {
    return semantic.documentGeneration;
  }
  const document = record.document && typeof record.document === "object" ? record.document as Record<string, unknown> : null;
  if (document && Object.prototype.hasOwnProperty.call(document, "generation")) {
    return document.generation;
  }
  return undefined;
}

function mapEffectError(awaited: unknown) {
  const source = (awaited ?? {}) as { error?: unknown; status?: unknown };
  const failure = (source.error ?? {}) as { code?: unknown };
  const code = String(failure.code || source.status || "EFFECT_FAILED").toUpperCase();
  if (["AWAIT_TIMEOUT", "EXPIRED", "TIMEOUT"].includes(code)) return "TIMEOUT";
  if (["NETWORK_ERROR", "NETWORK_DISCONNECTED", "CONNECTION_RESET", "TEMPORARY_UNAVAILABLE", "SERVICE_UNAVAILABLE", "TRANSIENT", "RETRYABLE"].includes(code)) return code;
  if (["UNAUTHORIZED", "FORBIDDEN", "MISSING_AUTHORITY", "AUTHORIZATION_FAILED"].includes(code)) return code;
  if (["STALE_TARGET", "STALE_DOCUMENT", "INVALID_INPUT", "INVALID_ARGUMENT", "INVALID_SCHEMA", "CONTRADICTION"].includes(code)) return code;
  return boundedErrorCode(code, "EFFECT_FAILED");
}

async function authoritativeProgram(programInput: unknown, tenantId: string) {
  if (!programInput || typeof programInput !== "object" || Array.isArray(programInput)) throw new HostError("INVALID_PROGRAM", "program must be an object.");
  const candidate = programInput as Record<string, unknown>;
  if (candidate.tenantId !== tenantId) throw new HostError("CROSS_TENANT", "Program tenant differs from authenticated tenant.", 403);
  let program;
  try {
    program = await validateReactiveProgram7D(candidate);
  } catch (error) {
    const failure = error && typeof error === "object" ? error as { code?: unknown } : {};
    throw new HostError(boundedErrorCode(failure.code, "INVALID_PROGRAM"), "Reactive VM program validation failed.");
  }
  if (canonicalBytes(program) > REACTIVE_VM_HOST_7E_LIMITS.programBytes) throw new HostError("OVER_LIMIT", "Program exceeds the frozen byte budget.", 413);
  await assertGoalCurrent(tenantId, program.goalId, program.goalRevision);
  await resolveDevice(String(program.target.deviceId));
  const targetDigest = await digestCanonical(program.target);
  return { program, targetDigest };
}

async function enqueueRun(body: Record<string, unknown>, tenantId: string) {
  if (typeof body.requestId !== "string") throw new HostError("INVALID_REQUEST", "requestId is required.");
  const { program, targetDigest } = await authoritativeProgram(body.program, tenantId);
  const key = await cryptoKey();
  const runId = crypto.randomUUID();
  const logicalNowMs = Date.now();
  let state;
  try {
    state = await createReactiveVm7D(program, {
      runId,
      tenantId,
      goalRevision: program.goalRevision,
      logicalNowMs,
      deadlineAtMs: logicalNowMs + Math.min(program.budgets.runDeadlineMs, REACTIVE_VM_HOST_7E_LIMITS.runDeadlineMs),
    });
  } catch (error) {
    const failure = error && typeof error === "object" ? error as { code?: unknown } : {};
    throw new HostError(boundedErrorCode(failure.code, "INVALID_PROGRAM"), "Unable to initialize Reactive VM state.");
  }
  const programBytes = canonicalBytes(program);
  const checkpointBytes = canonicalBytes(state);
  const checkpointDigest = await digestCanonical(state);
  const programToken = await sealVmHostToken(program, key, { kind: "PROGRAM" });
  const checkpointToken = await sealVmHostToken(state, key, { kind: "CHECKPOINT" });
  const expiresAt = new Date(logicalNowMs + Math.min(program.budgets.runDeadlineMs, REACTIVE_VM_HOST_7E_LIMITS.runDeadlineMs)).toISOString();
  const stored = await rpc("opera_vm_enqueue", {
    p_tenant_id: tenantId,
    p_run_id: runId,
    p_request_id: body.requestId,
    p_program_digest: program.programDigest,
    p_goal_id: program.goalId,
    p_goal_revision: program.goalRevision,
    p_target_digest: targetDigest,
    p_program_token: programToken,
    p_program_bytes: programBytes,
    p_checkpoint_token: checkpointToken,
    p_checkpoint_digest: checkpointDigest,
    p_checkpoint_bytes: checkpointBytes,
    p_expires_at: expiresAt,
  });
  if (!stored?.ok) throw new HostError(String(stored?.code || "ENQUEUE_FAILED"), "Unable to enqueue VM run.", stored?.code === "RATE_LIMITED" ? 429 : 409);
  return safePublicRun(stored);
}

async function executeEffect(program: VmProgram, state: VmState, claim: VmClaim, workerId: string, tenantId: string, device: VmDevice, sliceDeadline: number) {
  const pending = state.pendingEffect;
  if (!pending) throw new HostError("INVALID_HOST_STATE", "No pending effect exists.");
  if (String(pending.target?.deviceId) !== String(device.id) || pending.target?.tabId !== program.target.tabId) {
    throw new HostError("STALE_TARGET", "Pending effect target no longer matches the locked run target.", 409);
  }
  const pendingArgs = pending.arguments && typeof pending.arguments === "object" && !Array.isArray(pending.arguments)
    ? pending.arguments as Record<string, unknown>
    : null;
  if (pendingArgs && Object.prototype.hasOwnProperty.call(pendingArgs, "tabId")
      && pendingArgs.tabId !== program.target.tabId) {
    throw new HostError("CROSS_TAB", "Effect arguments target another tab.", 409);
  }

  const idempotencyKey = await deriveVmEffectIdempotencyKey7E({
    tenantId,
    runId: claim.runId,
    programDigest: claim.programDigest,
    requestDigest: pending.requestDigest,
    attemptClass: "OBSERVATION",
  });
  const reserved = await rpc("opera_vm_effect_reserve", {
    p_tenant_id: tenantId,
    p_run_id: claim.runId,
    p_worker_id: workerId,
    p_lease_epoch: claim.leaseEpoch,
    p_expected_transition: claim.logicalTransition,
    p_program_digest: claim.programDigest,
    p_goal_revision: claim.goalRevision,
    p_target_digest: claim.targetDigest,
    p_idempotency_key: idempotencyKey,
    p_request_digest: pending.requestDigest,
    p_method: pending.method,
  });
  if (!reserved?.ok) throw new HostError(String(reserved?.code || "EFFECT_RESERVE_FAILED"), "Unable to reserve VM effect.", 409);

  let commandId = reserved.commandId ? String(reserved.commandId) : "";
  if (!commandId) {
    const enqueued = await rpc("opera_enqueue", {
      p_method: pending.method,
      p_params: pending.arguments ?? {},
      p_timeout_ms: null,
      p_device_name: DEVICE_NAME,
      p_request_id: idempotencyKey,
    });
    if (!enqueued?.ok || !enqueued.commandId) throw new HostError("EFFECT_ENQUEUE_FAILED", "Unable to enqueue browser observation.", 503);
    commandId = String(enqueued.commandId);
    const attached = await rpc("opera_vm_effect_attach", {
      p_tenant_id: tenantId,
      p_run_id: claim.runId,
      p_worker_id: workerId,
      p_lease_epoch: claim.leaseEpoch,
      p_idempotency_key: idempotencyKey,
      p_request_digest: pending.requestDigest,
      p_command_id: commandId,
    });
    if (!attached?.ok) throw new HostError(String(attached?.code || "EFFECT_ATTACH_FAILED"), "Unable to attach browser command to VM effect.", 409);
  }

  const remaining = Math.max(100, Math.floor(sliceDeadline - performance.now()));
  const awaitMs = Math.max(100, Math.min(8000, remaining - 1500));
  const awaited = await rpc("opera_await", { p_command_id: commandId, p_timeout_ms: awaitMs });
  const ok = awaited?.ok === true;

  await rpc("opera_vm_effect_finish", {
    p_tenant_id: tenantId,
    p_run_id: claim.runId,
    p_worker_id: workerId,
    p_lease_epoch: claim.leaseEpoch,
    p_idempotency_key: idempotencyKey,
    p_command_id: commandId,
    p_ok: ok,
  });

  const provenance: Record<string, unknown> = {
    tenantId,
    deviceId: String(device.id),
    tabId: program.target.tabId,
  };
  if (program.target.documentGeneration !== undefined) provenance.documentGeneration = program.target.documentGeneration;

  let effectValue = ok ? awaited.result : null;

  if (ok && awaited?.result && typeof awaited.result === "object") {
    const observationIdentity = {
      tenantId,
      deviceId: String(device.id),
      tabId: program.target.tabId,
      documentGeneration: program.target.documentGeneration ?? 1,
      runtimeEpoch: claim.runId,
    };
    const programContext = {
      goalId: program.goalId,
      goalRevision: program.goalRevision,
      taskDependencies: program.taskDependencies ?? null,
    };
    const reconciled = reconcileVmEffectObservation7E(observationIdentity, awaited.result, programContext);
    effectValue = {
      ...awaited.result,
      performanceCutover: {
        decision: reconciled.relevance.decision,
        reasoningWakeRequired: reconciled.relevance.reasoningWakeRequired,
        reasoningObservation: reconciled.relevance.reasoningObservation,
        contextStatus: reconciled.relevance.relevance?.contextStatus,
        canonicalRevision: reconciled.canonicalState?.semanticRevision ?? null,
      },
    };
  }

  if (ok && DOCUMENT_SCOPED.has(String(pending.method)) && program.target.documentGeneration !== undefined) {
    const observedGeneration = extractDocumentGeneration(awaited.result);
    if (observedGeneration !== program.target.documentGeneration) {
      return {
        requestDigest: pending.requestDigest,
        method: pending.method,
        ok: false,
        provenance,
        value: null,
        errorCode: "STALE_DOCUMENT",
      };
    }
  }

  return {
    requestDigest: pending.requestDigest,
    method: pending.method,
    ok,
    provenance,
    value: effectValue,
    ...(ok ? {} : { errorCode: mapEffectError(awaited) }),
  };
}

async function checkpointOriginal(claim: VmClaim, workerId: string, tenantId: string, status: string, errorCode: string | null) {
  return await rpc("opera_vm_checkpoint", {
    p_tenant_id: tenantId,
    p_run_id: claim.runId,
    p_worker_id: workerId,
    p_lease_epoch: claim.leaseEpoch,
    p_expected_transition: claim.logicalTransition,
    p_program_digest: claim.programDigest,
    p_goal_revision: claim.goalRevision,
    p_target_digest: claim.targetDigest,
    p_checkpoint_token: claim.checkpointToken,
    p_checkpoint_digest: claim.checkpointDigest,
    p_checkpoint_bytes: claim.checkpointBytes,
    p_new_status: status,
    p_available_at: null,
    p_result_token: null,
    p_result_digest: null,
    p_result_bytes: null,
    p_error_code: errorCode,
  });
}

async function persistSlice(_program: VmProgram, state: VmState, transition: VmTransition, claim: VmClaim, workerId: string, tenantId: string, key: Uint8Array) {
  const logicalNowMs = nowMsAtLeast(state.lastLogicalNowMs);
  const classification = classifyVmPersistence7E(state, transition, logicalNowMs);
  const checkpointBytes = canonicalBytes(state);
  if (checkpointBytes > REACTIVE_VM_HOST_7E_LIMITS.checkpointBytes) throw new HostError("OVER_LIMIT", "Checkpoint exceeds the frozen byte budget.");
  const checkpointDigest = await digestCanonical(state);
  const checkpointToken = await sealVmHostToken(state, key, { kind: "CHECKPOINT" });

  let resultToken: string | null = null;
  let resultDigest: string | null = null;
  let resultBytes: number | null = null;
  if (classification.terminal && state.result !== null && state.result !== undefined) {
    resultBytes = canonicalBytes(state.result);
    if (resultBytes > REACTIVE_VM_HOST_7E_LIMITS.resultBytes) throw new HostError("OVER_LIMIT", "VM result exceeds the frozen byte budget.");
    resultDigest = await digestCanonical(state.result);
    resultToken = await sealVmHostToken(state.result, key, { kind: "RESULT" });
  }
  const errorCode = classification.terminal && state.status !== "RETURNED"
    ? boundedErrorCode(state.suspension?.reason || state.status, String(state.status))
    : null;

  let stored = await rpc("opera_vm_checkpoint", {
    p_tenant_id: tenantId,
    p_run_id: claim.runId,
    p_worker_id: workerId,
    p_lease_epoch: claim.leaseEpoch,
    p_expected_transition: claim.logicalTransition,
    p_program_digest: claim.programDigest,
    p_goal_revision: claim.goalRevision,
    p_target_digest: claim.targetDigest,
    p_checkpoint_token: checkpointToken,
    p_checkpoint_digest: checkpointDigest,
    p_checkpoint_bytes: checkpointBytes,
    p_new_status: classification.status,
    p_available_at: classification.availableAtMs === null ? null : new Date(classification.availableAtMs).toISOString(),
    p_result_token: resultToken,
    p_result_digest: resultDigest,
    p_result_bytes: resultBytes,
    p_error_code: errorCode,
  });

  if (!stored?.ok && stored?.code === "CANCEL_REQUESTED") {
    stored = await checkpointOriginal(claim, workerId, tenantId, "CANCELLED", "CANCELLED");
  }
  if (!stored?.ok) throw new HostError(String(stored?.code || "CHECKPOINT_FAILED"), "Unable to persist VM checkpoint.", 409);
  return { stored, classification, result: classification.terminal && state.status === "RETURNED" ? state.result : undefined };
}

async function processSlice(runId: string, tenantId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new HostError("INVALID_REQUEST", "runId is invalid.");
  const key = await cryptoKey();
  const workerId = crypto.randomUUID();
  const claim = await rpc("opera_vm_claim", {
    p_tenant_id: tenantId,
    p_run_id: runId,
    p_worker_id: workerId,
    p_lease_ms: REACTIVE_VM_HOST_7E_LIMITS.leaseMsDefault,
  });
  if (!claim?.ok) {
    if (claim?.code === "NO_WORK") return safePublicRun(await rpc("opera_vm_get", { p_tenant_id: tenantId, p_run_id: runId }));
    throw new HostError(String(claim?.code || "CLAIM_FAILED"), "Unable to claim VM run.", 409);
  }

  try {
    const program = await openVmHostToken(String(claim.programToken), key, { kind: "PROGRAM" });
    let state = await openVmHostToken(String(claim.checkpointToken), key, { kind: "CHECKPOINT" });
    const validatedProgram = await validateReactiveProgram7D(program);
    if (validatedProgram.programDigest !== claim.programDigest || await digestCanonical(validatedProgram.target) !== claim.targetDigest) {
      throw new HostError("STALE_RUN", "Encrypted program no longer matches durable metadata.", 409);
    }
    if (await digestCanonical(state) !== claim.checkpointDigest || state.runId !== runId || state.tenantId !== tenantId) {
      throw new HostError("STALE_RUN", "Encrypted checkpoint no longer matches durable metadata.", 409);
    }
    await assertGoalCurrent(tenantId, String(claim.goalId), Number(claim.goalRevision));
    const device = await resolveDevice(String(validatedProgram.target.deviceId));

    const sliceDeadline = performance.now() + REACTIVE_VM_HOST_7E_LIMITS.executionSliceMs - REACTIVE_VM_HOST_7E_LIMITS.sliceSafetyMarginMs;
    let transition: VmTransition = { kind: "CONTINUE" };
    let steps = 0;
    while (!TERMINAL.has(String(state.status)) && performance.now() < sliceDeadline && steps < 1000) {
      const lease = await rpc("opera_vm_lease_status", {
        p_tenant_id: tenantId,
        p_run_id: runId,
        p_worker_id: workerId,
        p_lease_epoch: claim.leaseEpoch,
      });
      if (!lease?.ok || lease.leaseValid !== true) throw new HostError("STALE_LEASE", "VM lease expired before the slice completed.", 409);
      const logicalNowMs = nowMsAtLeast(state.lastLogicalNowMs);
      if (lease.cancelRequested === true) {
        const advanced = await advanceReactiveVm7D(validatedProgram, state, { logicalNowMs, cancelled: true });
        state = advanced.state;
        transition = advanced.transition;
        break;
      }

      let advanced;
      if (state.pendingEffect) {
        const effectResult = await executeEffect(validatedProgram, state, claim, workerId, tenantId, device, sliceDeadline);
        advanced = await advanceReactiveVm7D(validatedProgram, state, { logicalNowMs, effectResult });
      } else {
        advanced = await advanceReactiveVm7D(validatedProgram, state, { logicalNowMs });
      }
      state = advanced.state;
      transition = advanced.transition;
      steps += 1;

      if (TERMINAL.has(String(state.status))) break;
      if (transition.kind === "WAITING_EVENT" && Number(transition.nextPollAtMs) > Date.now()) break;
      if ((transition.kind === "WAITING_RETRY" || transition.kind === "RETRY_SCHEDULED") && Number(transition.notBeforeMs) > Date.now()) break;
    }

    const persisted = await persistSlice(validatedProgram, state, transition, claim, workerId, tenantId, key);
    return {
      ok: true,
      runId,
      status: persisted.stored.status,
      logicalTransition: persisted.stored.logicalTransition,
      ...(persisted.result === undefined ? {} : { result: persisted.result }),
    };
  } catch (error) {
    const failure = error && typeof error === "object" ? error as { code?: unknown } : {};
    const code = boundedErrorCode(failure.code, "HOST_ERROR");
    if (code === "STALE_LEASE") throw error;
    const status = ["GOAL_REVISED", "STALE_TARGET", "STALE_DOCUMENT", "MISSING_AUTHORITY", "CROSS_TAB"].includes(code) ? "SUSPENDED" : "FAILED";
    const stored = await checkpointOriginal(claim, workerId, tenantId, status, code);
    if (!stored?.ok && stored?.code === "CANCEL_REQUESTED") {
      await checkpointOriginal(claim, workerId, tenantId, "CANCELLED", "CANCELLED");
      return { ok: true, runId, status: "CANCELLED" };
    }
    if (!stored?.ok) throw error;
    return { ok: false, runId, status, error: { code } };
  }
}

async function getResult(runId: string, tenantId: string) {
  const metadata = await rpc("opera_vm_get", { p_tenant_id: tenantId, p_run_id: runId });
  if (!metadata?.ok) throw new HostError(String(metadata?.code || "RUN_NOT_FOUND"), "VM run was not found.", 404);
  if (metadata.status !== "RETURNED") return { ...safePublicRun(metadata), result: null };
  if (typeof metadata.resultToken !== "string") throw new HostError("RESULT_UNAVAILABLE", "Returned result token is unavailable.", 409);
  const key = await cryptoKey();
  const result = await openVmHostToken(metadata.resultToken, key, { kind: "RESULT" });
  if (await digestCanonical(result) !== metadata.resultDigest) throw new HostError("STALE_RUN", "Returned result digest mismatch.", 409);
  return { ...safePublicRun(metadata), result };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return response({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  const user = await authenticatedUser(req);
  if (!user) return response({ ok: false, error: { code: "UNAUTHORIZED" } }, 401);

  try {
    const body = await readBody(req);
    const operation = String(body.operation || "");
    if (operation === "enqueue") return response(await enqueueRun(body, user.id));
    if (operation === "resume") return response(await processSlice(String(body.runId || ""), user.id));
    if (operation === "status") {
      const metadata = await rpc("opera_vm_get", { p_tenant_id: user.id, p_run_id: String(body.runId || "") });
      return response(safePublicRun(metadata), metadata?.ok ? 200 : 404);
    }
    if (operation === "result") return response(await getResult(String(body.runId || ""), user.id));
    if (operation === "cancel") {
      const cancelled = await rpc("opera_vm_cancel", { p_tenant_id: user.id, p_run_id: String(body.runId || "") });
      return response(safePublicRun(cancelled), cancelled?.ok ? 200 : 404);
    }
    throw new HostError("INVALID_OPERATION", "Unsupported VM host operation.", 400);
  } catch (error) {
    const failure = error && typeof error === "object" ? error as { code?: unknown } : {};
    const code = boundedErrorCode(failure.code, "VM_HOST_ERROR");
    const status = error instanceof HostError ? error.status : code === "CROSS_TENANT" ? 403 : code === "OVER_LIMIT" ? 413 : 400;
    console.error("opera-agent-vm", code);
    return response({ ok: false, error: { code } }, status);
  }
});
