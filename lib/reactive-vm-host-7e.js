// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: reactive-vm-host-7e — vm-host-7e — Shared pure module.
// @state: remove five dead exports and generalize the dead-export guard.
// @dependencies: goal-ledger, multi-signal-relevance-p3.

import { canonicalJson, digestCanonical } from './goal-ledger.js';
import { createMultiSignalRelevancePipeline } from './multi-signal-relevance-p3.js';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|payment.?data|pairing.?code|signing.?key)/i;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;
const TERMINAL = new Set(['SUSPENDED', 'RETURNED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const HOST_STATUSES = new Set(['QUEUED', 'RUNNING', ...TERMINAL]);
const METADATA_KEYS = Object.freeze([
  'tenantId', 'runId', 'requestId', 'programDigest', 'goalId', 'goalRevision', 'targetDigest',
  'status', 'checkpointDigest', 'checkpointBytes', 'resultDigest', 'resultBytes',
  'logicalTransition', 'leaseEpoch', 'expiresAt', 'availableAt', 'errorCode',
]);

export const REACTIVE_VM_HOST_7E_LIMITS = Object.freeze({
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

export function reconcileVmEffectObservation7E(identityInput, observationInput, programContext = {}) {
  const identity = {
    tenantId: String(identityInput?.tenantId || ''),
    deviceId: String(identityInput?.deviceId || ''),
    tabId: Number(identityInput?.tabId ?? 0),
    documentGeneration: Number(identityInput?.documentGeneration ?? 1),
    runtimeEpoch: String(identityInput?.runtimeEpoch || identityInput?.runId || ''),
  };

  // Caller-supplied taskDependencies on program/context cannot be trusted as server-authoritative
  // context for P3 APPLY_AND_CONTINUE. Reject caller-asserted task dependencies so P3 context status
  // defaults conservatively to MISSING and decision forces REASON_REQUIRED.
  const taskContext = null;
  const relevanceResult = hostRelevancePipeline.reconcile(identity, observationInput, taskContext);

  return Object.freeze({
    identity,
    observation: observationInput,
    relevance: relevanceResult,
    canonicalState: relevanceResult.canonicalState,
  });
}

export class ReactiveVmHostError extends Error {
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

function clone(value) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail('INVALID_HOST_STATE', 'Host value must be acyclic canonical JSON.');
  }
}

function assertExactKeys(value, expected) {
  if (!isPlainObject(value)) fail('INVALID_HOST_STATE', 'Persisted metadata must be a plain object.');
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('PROHIBITED_PERSISTENCE', `Persisted field ${key} is not allowed.`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_HOST_STATE', `Persisted field ${key} is required.`);
  }
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

function assertIso(value, field, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('INVALID_HOST_STATE', `${field} must be an ISO timestamp.`);
}

export async function deriveVmEffectIdempotencyKey7E(input) {
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

export function validateVmPersistedMetadata7E(metadataInput) {
  assertExactKeys(metadataInput, METADATA_KEYS);
  assertNoSensitive(metadataInput, 'metadata');
  const value = clone(metadataInput);
  if (!UUID_RE.test(value.tenantId)) fail('INVALID_HOST_STATE', 'tenantId must be a UUID.');
  if (!UUID_RE.test(value.runId)) fail('INVALID_HOST_STATE', 'runId must be a UUID.');
  if (typeof value.requestId !== 'string' || !REQUEST_ID_RE.test(value.requestId)) fail('INVALID_HOST_STATE', 'requestId is invalid.');
  assertDigest(value.programDigest, 'programDigest');
  if (typeof value.goalId !== 'string' || !SAFE_ID_RE.test(value.goalId)) fail('INVALID_HOST_STATE', 'goalId is invalid.');
  assertInteger(value.goalRevision, 'goalRevision', 1, 2147483647);
  assertDigest(value.targetDigest, 'targetDigest');
  if (!HOST_STATUSES.has(value.status)) fail('INVALID_HOST_STATE', 'status is invalid.');
  assertDigest(value.checkpointDigest, 'checkpointDigest');
  assertInteger(value.checkpointBytes, 'checkpointBytes', 1, REACTIVE_VM_HOST_7E_LIMITS.checkpointBytes);
  assertDigest(value.resultDigest, 'resultDigest', true);
  if (value.resultBytes !== null) assertInteger(value.resultBytes, 'resultBytes', 0, REACTIVE_VM_HOST_7E_LIMITS.resultBytes);
  if ((value.resultDigest === null) !== (value.resultBytes === null)) fail('INVALID_HOST_STATE', 'Result digest and byte count must both be null or both be present.');
  assertInteger(value.logicalTransition, 'logicalTransition', 0, Number.MAX_SAFE_INTEGER);
  assertInteger(value.leaseEpoch, 'leaseEpoch', 0, Number.MAX_SAFE_INTEGER);
  assertIso(value.expiresAt, 'expiresAt');
  assertIso(value.availableAt, 'availableAt', true);
  if (value.errorCode !== null && (typeof value.errorCode !== 'string' || value.errorCode.length < 1 || value.errorCode.length > 128)) {
    fail('INVALID_HOST_STATE', 'errorCode is invalid.');
  }
  return Object.freeze(value);
}

export function classifyVmPersistence7E(state, transition, logicalNowMs) {
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

export function retryDelayMs7E(attempt) {
  assertInteger(attempt, 'attempt', 0, 1000);
  const value = REACTIVE_VM_HOST_7E_LIMITS.retryDelayMsBase * (2 ** Math.min(attempt, 20));
  return Math.min(REACTIVE_VM_HOST_7E_LIMITS.retryDelayMsMax, value);
}

