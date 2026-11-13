// @last-edited: 2026-10-21 UTC+7.
// @title: reactive-vm-host — the host side of the reactive VM: what it may persist and what it must refuse.
// @state: the persistence classification, the idempotency key, and the limits every host request holds.
// @dependencies: digest, multi-signal-relevance.

import { digestCanonical } from './digest.js';
import { SECRET_VALUE } from './secret-pattern.js';
import { createMultiSignalRelevancePipeline } from './multi-signal-relevance.js';
import { SECRET_FIELD } from './reactive-vm-core.js';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

const TERMINAL = new Set(['SUSPENDED', 'RETURNED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);

export interface HostIdentity {
  tenantId: string;
  deviceId: string;
  tabId: number;
  documentGeneration: number;
  runtimeEpoch: string;
}

export interface VmReconciliation {
  identity: HostIdentity;
  observation: unknown;
  relevance: unknown;
  canonicalState: unknown;
}

export interface VmPersistenceDecision {
  status: string;
  availableAtMs: number | null;
  terminal: boolean;
}

export const REACTIVE_VM_HOST_LIMITS = Object.freeze({
  requestBytes: 196608,
  programBytes: 131072,
  checkpointBytes: 131072,
  resultBytes: 131072,
  opaqueTokenBytes: 196608,
  executionSliceMs: 20000,
  sliceSafetyMarginMs: 2000,
  runDeadlineMs: 300000,
  leaseMsMin: 5000,
  leaseMsDefault: 25000,
  leaseMsMax: 30000,
  tenantRunningRuns: 4,
  tenantOutstandingRuns: 32,
  enqueuePerMinute: 20,
  retentionSecondsMin: 3600,
  retentionSecondsDefault: 86400,
  retentionSecondsMax: 604800,
  retryDelayMsBase: 250,
  retryDelayMsMax: 5000,
});

const hostRelevancePipeline = createMultiSignalRelevancePipeline();

export function reconcileVmEffectObservation(identityInput: unknown, observationInput: unknown, programContext: Record<string, unknown> = {}): VmReconciliation {
  void programContext; // accepted for forward compatibility; the relevance pipeline reasons about the observation alone.
  const envelope = (isPlainObject(identityInput) ? identityInput : {}) as Record<string, unknown>;
  const identity: HostIdentity = {
    tenantId: String(envelope.tenantId || ''),
    deviceId: String(envelope.deviceId || ''),
    tabId: Number(envelope.tabId ?? 0),
    documentGeneration: Number(envelope.documentGeneration ?? 1),
    runtimeEpoch: String(envelope.runtimeEpoch || envelope.runId || ''),
  };

  const relevanceResult = hostRelevancePipeline.reconcile(identity, observationInput, null) as { canonicalState?: unknown };

  return Object.freeze({
    identity,
    observation: observationInput,
    relevance: relevanceResult,
    canonicalState: relevanceResult.canonicalState,
  });
}

class ReactiveVmHostError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ReactiveVmHostError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code: string, message: string, details?: unknown): never {
  throw new ReactiveVmHostError(code, message, details);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertNoSensitive(value: unknown, path = '$', seen = new WeakSet<object>()): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains a secret-like value.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('INVALID_HOST_STATE', `${path} contains a cycle.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(String(key))) fail('PROHIBITED_PERSISTENCE', `${path}.${String(key)} is a prohibited persistence field.`);
    assertNoSensitive(child, `${path}.${String(key)}`, seen);
  }
  seen.delete(value);
}

function assertDigest(value: unknown, field: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) fail('INVALID_HOST_STATE', `${field} must be a sha256 digest.`);
}

function assertInteger(value: unknown, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail('INVALID_HOST_STATE', `${field} is outside its bounds.`);
}

export async function deriveVmEffectIdempotencyKey(input: unknown): Promise<string> {
  if (!isPlainObject(input)) fail('INVALID_HOST_STATE', 'Idempotency input must be an object.');
  const expected = ['tenantId', 'runId', 'programDigest', 'requestDigest', 'attemptClass'];
  const keys = Object.keys(input);
  if (keys.some((key) => !expected.includes(key)) || expected.some((key) => !(key in input))) {
    fail('INVALID_HOST_STATE', 'Idempotency input shape is invalid.');
  }
  const tenantId = String(input.tenantId);
  const runId = String(input.runId);
  if (tenantId.length < 1 || tenantId.length > 128) fail('INVALID_HOST_STATE', 'tenantId is invalid.');
  if (runId.length < 1 || runId.length > 128) fail('INVALID_HOST_STATE', 'runId is invalid.');
  assertDigest(input.programDigest, 'programDigest');
  assertDigest(input.requestDigest, 'requestDigest');
  if (typeof input.attemptClass !== 'string' || !/^[A-Z][A-Z0-9_]{0,31}$/.test(input.attemptClass)) fail('INVALID_HOST_STATE', 'attemptClass is invalid.');
  assertNoSensitive(input, 'idempotency');
  const digest = await digestCanonical({
    schemaVersion: 'OA_VM_EFFECT_IDEMPOTENCY_V1',
    tenantId,
    runId,
    programDigest: input.programDigest,
    requestDigest: input.requestDigest,
    attemptClass: input.attemptClass,
  });
  return `vm1:${digest.slice('sha256:'.length)}`;
}

export function classifyVmPersistence(state: unknown, transition: unknown, logicalNowMs: unknown): VmPersistenceDecision {
  if (!isPlainObject(state) || !isPlainObject(transition)) fail('INVALID_HOST_STATE', 'VM state and transition must be objects.');
  assertInteger(logicalNowMs, 'logicalNowMs', 0, Number.MAX_SAFE_INTEGER);
  const now = logicalNowMs as number;
  const status = String(state.status ?? '');
  if (TERMINAL.has(status)) {
    return Object.freeze({ status, availableAtMs: null, terminal: true });
  }
  let availableAtMs: number | null = now;
  const kind = String(transition.kind ?? '');
  if (kind === 'WAITING_EVENT' && Number.isSafeInteger(transition.nextPollAtMs)) availableAtMs = Math.max(now, transition.nextPollAtMs as number);
  if ((kind === 'WAITING_RETRY' || kind === 'RETRY_SCHEDULED') && Number.isSafeInteger(transition.notBeforeMs)) {
    availableAtMs = Math.max(now, transition.notBeforeMs as number);
  }
  return Object.freeze({ status: 'QUEUED', availableAtMs, terminal: false });
}
