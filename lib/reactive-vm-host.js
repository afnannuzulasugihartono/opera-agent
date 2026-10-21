// @last-edited: 2026-10-06 10:20 UTC+7.
// @title: reactive-vm-host — vm-host-7e — Shared pure module.
// @state: remove five dead exports and generalize the dead-export guard.
// @dependencies: goal-ledger, multi-signal-relevance.

import { canonicalJson, digestCanonical } from './goal-ledger.js';
import { SECRET_VALUE } from './secret-pattern.js';
import { createMultiSignalRelevancePipeline } from './multi-signal-relevance.js';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|payment.?data|pairing.?code|signing.?key)/i;

const TERMINAL = new Set(['SUSPENDED', 'RETURNED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);

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

export function reconcileVmEffectObservation(identityInput, observationInput, programContext = {}) {
  const identity = {
    tenantId: String(identityInput?.tenantId || ''),
    deviceId: String(identityInput?.deviceId || ''),
    tabId: Number(identityInput?.tabId ?? 0),
    documentGeneration: Number(identityInput?.documentGeneration ?? 1),
    runtimeEpoch: String(identityInput?.runtimeEpoch || identityInput?.runId || ''),
  };

  const taskContext = null;
  const relevanceResult = hostRelevancePipeline.reconcile(identity, observationInput, taskContext);

  return Object.freeze({
    identity,
    observation: observationInput,
    relevance: relevanceResult,
    canonicalState: relevanceResult.canonicalState,
  });
}

class ReactiveVmHostError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReactiveVmHostError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ReactiveVmHostError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertNoSensitive(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains a secret-like value.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('INVALID_HOST_STATE', `${path} contains a cycle.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) fail('PROHIBITED_PERSISTENCE', `${path}.${key} is a prohibited persistence field.`);
    assertNoSensitive(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function assertDigest(value, field, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) fail('INVALID_HOST_STATE', `${field} must be a sha256 digest.`);
}

function assertInteger(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_HOST_STATE', `${field} is outside its bounds.`);
}

export async function deriveVmEffectIdempotencyKey(input) {
  if (!isPlainObject(input)) fail('INVALID_HOST_STATE', 'Idempotency input must be an object.');
  const expected = ['tenantId', 'runId', 'programDigest', 'requestDigest', 'attemptClass'];
  if (Object.keys(input).some((key) => !expected.includes(key)) || expected.some((key) => !(key in input))) {
    fail('INVALID_HOST_STATE', 'Idempotency input shape is invalid.');
  }
  if (typeof input.tenantId !== 'string' || input.tenantId.length < 1 || input.tenantId.length > 128) fail('INVALID_HOST_STATE', 'tenantId is invalid.');
  if (typeof input.runId !== 'string' || input.runId.length < 1 || input.runId.length > 128) fail('INVALID_HOST_STATE', 'runId is invalid.');
  assertDigest(input.programDigest, 'programDigest');
  assertDigest(input.requestDigest, 'requestDigest');
  if (typeof input.attemptClass !== 'string' || !/^[A-Z][A-Z0-9_]{0,31}$/.test(input.attemptClass)) fail('INVALID_HOST_STATE', 'attemptClass is invalid.');
  assertNoSensitive(input, 'idempotency');
  const digest = await digestCanonical({
    schemaVersion: 'OA_VM_EFFECT_IDEMPOTENCY_V1',
    tenantId: input.tenantId,
    runId: input.runId,
    programDigest: input.programDigest,
    requestDigest: input.requestDigest,
    attemptClass: input.attemptClass,
  });
  return `vm1:${digest.slice('sha256:'.length)}`;
}

export function classifyVmPersistence(state, transition, logicalNowMs) {
  if (!isPlainObject(state) || !isPlainObject(transition)) fail('INVALID_HOST_STATE', 'VM state and transition must be objects.');
  assertInteger(logicalNowMs, 'logicalNowMs', 0, Number.MAX_SAFE_INTEGER);
  if (TERMINAL.has(state.status)) {
    return Object.freeze({ status: state.status, availableAtMs: null, terminal: true });
  }
  let availableAtMs = logicalNowMs;
  if (transition.kind === 'WAITING_EVENT' && Number.isSafeInteger(transition.nextPollAtMs)) availableAtMs = Math.max(logicalNowMs, transition.nextPollAtMs);
  if ((transition.kind === 'WAITING_RETRY' || transition.kind === 'RETRY_SCHEDULED') && Number.isSafeInteger(transition.notBeforeMs)) {
    availableAtMs = Math.max(logicalNowMs, transition.notBeforeMs);
  }
  return Object.freeze({ status: 'QUEUED', availableAtMs, terminal: false });
}
