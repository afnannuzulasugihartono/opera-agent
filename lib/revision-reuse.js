import {
  LEDGER_LIMITS,
  LedgerError,
  canonicalJson,
  digestCanonical,
  validateLedger,
} from './goal-ledger.js';
import { createEvidence, validateEvidence } from './proof-engine.js';

const SCHEMA_VERSION = 1;
const REUSE_VERSION = 'OA_REUSE_V1';
const SHA256_HEX = /^sha256:[0-9a-f]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;
const FINGERPRINT_FIELDS = new Set(['schemaVersion', 'claimId', 'scopeId', 'semanticViewRefs', 'entityRefs', 'fingerprintDigest']);
const VIEW_REF_FIELDS = new Set(['viewId', 'revision']);
const ENTITY_REF_FIELDS = new Set(['logicalId', 'semanticRevision', 'state']);
const DELTA_FIELDS = new Set(['viewChanges', 'entityChanges']);
const VIEW_CHANGE_FIELDS = new Set(['viewId', 'fromRevision', 'toRevision', 'type']);
const ENTITY_CHANGE_FIELDS = new Set(['logicalId', 'fromRevision', 'toRevision', 'type']);
const RECEIPT_FIELDS = new Set([
  'schemaVersion', 'tenantId', 'sourceGoalId', 'targetGoalId', 'sourceRevision', 'sourceDigest', 'targetRevision',
  'targetDigest', 'relation', 'reused', 'invalidated', 'evaluatedAt', 'reuseVersion', 'receiptDigest',
]);
const REUSED_FIELDS = new Set(['evidenceId', 'sourceEvidenceDigest', 'carriedEvidenceDigest', 'fingerprintDigest']);
const INVALIDATED_FIELDS = new Set(['evidenceId', 'reason']);
const TERMINAL_STATUSES = new Set(['CANCELLED', 'EXPIRED']);
const SAFE_DELTA_TYPES = new Set(['MOVE', 'NO_RELEVANT_CHANGE']);
const ENTITY_STATES = new Set(['PRESENT', 'REMOVED', 'AMBIGUOUS']);
const REVISION_RELATIONS = new Set(['EQUIVALENT', 'NARROW', 'EXPAND', 'INCOMPATIBLE']);

export class ReuseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReuseError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReuseError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allowedFields(value, fields, path) {
  if (!isPlainObject(value)) fail('INVALID_TYPE', `${path} must be a plain object.`);
  for (const key of Object.keys(value)) if (!fields.has(key)) fail('UNKNOWN_FIELD', `${path}.${key} is not allowed.`);
}

function stringValue(value, path, { maximum = 128, pattern = ID_PATTERN } = {}) {
  if (typeof value !== 'string') fail('INVALID_TYPE', `${path} must be a string.`);
  const normalized = value.normalize('NFC');
  if (!normalized || new TextEncoder().encode(normalized).length > maximum) fail('OVER_LIMIT', `${path} exceeds its bounds.`);
  if (SECRET_VALUE.test(normalized)) fail('SECRET_LIKE_VALUE', `${path} contains a forbidden value.`);
  if (!pattern.test(normalized)) fail('INVALID_VALUE', `${path} has an invalid format.`);
  return normalized;
}

function integerValue(value, path) {
  if (!Number.isSafeInteger(value) || value < 1 || value > LEDGER_LIMITS.maximumRevision) fail('INVALID_VALUE', `${path} must be a positive safe integer.`);
  return value;
}

function digestValue(value, path) {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) fail('INVALID_DIGEST', `${path} is invalid.`);
  return value;
}

function timestampValue(value, path) {
  const normalized = stringValue(value, path, { maximum: 32, pattern: UTC_TIMESTAMP });
  if (!Number.isFinite(Date.parse(normalized))) fail('INVALID_VALUE', `${path} is invalid.`);
  return normalized;
}

function arrayValue(value, path, maximum, mapper) {
  if (!Array.isArray(value)) fail('INVALID_TYPE', `${path} must be an array.`);
  if (value.length > maximum) fail('OVER_LIMIT', `${path} exceeds its item limit.`);
  return value.map((item, index) => mapper(item, `${path}[${index}]`));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function unique(items, field, path) {
  if (new Set(items.map((item) => item[field])).size !== items.length) fail('DUPLICATE_ID', `${path} contains duplicate ${field}.`);
}

function normalizeFingerprint(input) {
  allowedFields(input, FINGERPRINT_FIELDS, 'fingerprint');
  if (input.schemaVersion !== SCHEMA_VERSION) fail('INVALID_VALUE', 'fingerprint.schemaVersion is unsupported.');
  const semanticViewRefs = arrayValue(input.semanticViewRefs, 'fingerprint.semanticViewRefs', LEDGER_LIMITS.dependencyRefsTotal, (item, path) => {
    allowedFields(item, VIEW_REF_FIELDS, path);
    return { viewId: stringValue(item.viewId, `${path}.viewId`), revision: integerValue(item.revision, `${path}.revision`) };
  }).sort((left, right) => left.viewId.localeCompare(right.viewId, 'en'));
  const entityRefs = arrayValue(input.entityRefs, 'fingerprint.entityRefs', LEDGER_LIMITS.dependencyRefsTotal, (item, path) => {
    allowedFields(item, ENTITY_REF_FIELDS, path);
    const state = stringValue(item.state, `${path}.state`, { maximum: 16, pattern: SYMBOL_PATTERN });
    if (!ENTITY_STATES.has(state)) fail('INVALID_VALUE', `${path}.state is unsupported.`);
    return {
      logicalId: stringValue(item.logicalId, `${path}.logicalId`),
      semanticRevision: integerValue(item.semanticRevision, `${path}.semanticRevision`),
      state,
    };
  }).sort((left, right) => left.logicalId.localeCompare(right.logicalId, 'en'));
  if (semanticViewRefs.length + entityRefs.length > LEDGER_LIMITS.dependencyRefsTotal) fail('OVER_LIMIT', 'Fingerprint dependency refs exceed the total cap.');
  if (semanticViewRefs.length + entityRefs.length === 0) fail('MISSING_REFERENCE', 'Fingerprint requires at least one semantic dependency.');
  unique(semanticViewRefs, 'viewId', 'fingerprint.semanticViewRefs');
  unique(entityRefs, 'logicalId', 'fingerprint.entityRefs');
  return {
    schemaVersion: SCHEMA_VERSION,
    claimId: stringValue(input.claimId, 'fingerprint.claimId'),
    scopeId: stringValue(input.scopeId, 'fingerprint.scopeId'),
    semanticViewRefs,
    entityRefs,
  };
}

export async function createDependencyFingerprint(input) {
  const normalized = normalizeFingerprint(input);
  return deepFreeze({ ...normalized, fingerprintDigest: await digestCanonical(normalized) });
}

async function validateFingerprint(input) {
  if (!isPlainObject(input) || !SHA256_HEX.test(input.fingerprintDigest || '')) fail('INVALID_DIGEST', 'fingerprint.fingerprintDigest is invalid.');
  const normalized = normalizeFingerprint(input);
  const expected = await digestCanonical(normalized);
  if (expected !== input.fingerprintDigest) fail('INVALID_DIGEST', 'Fingerprint digest does not match canonical content.');
  return deepFreeze({ ...normalized, fingerprintDigest: expected });
}

function referencedRequirements(ledger, claim) {
  const ids = new Set(claim.evidenceRequirementIds);
  return ledger.evidenceRequirements.filter((item) => ids.has(item.requirementId));
}

function claimSignature(ledger, claim) {
  return canonicalJson({
    claim,
    constraints: ledger.constraints,
    evidenceRequirements: referencedRequirements(ledger, claim),
  });
}

export function compareLedgerRevision(previous, next) {
  if (!isPlainObject(previous) || !isPlainObject(next)) fail('INVALID_TYPE', 'Ledgers must be objects.');
  if (previous.goalId !== next.goalId || previous.tenantId !== next.tenantId) return 'INCOMPATIBLE';
  if (canonicalJson(previous.scope) !== canonicalJson(next.scope)) return 'INCOMPATIBLE';
  if (canonicalJson(previous.constraints) !== canonicalJson(next.constraints)) return 'INCOMPATIBLE';
  const previousClaims = new Map(previous.claims.map((claim) => [claim.claimId, claimSignature(previous, claim)]));
  const nextClaims = new Map(next.claims.map((claim) => [claim.claimId, claimSignature(next, claim)]));
  for (const [claimId, signature] of previousClaims) {
    if (nextClaims.has(claimId) && nextClaims.get(claimId) !== signature) return 'INCOMPATIBLE';
  }
  const targetIsSubset = [...nextClaims].every(([claimId, signature]) => previousClaims.get(claimId) === signature);
  const sourceIsSubset = [...previousClaims].every(([claimId, signature]) => nextClaims.get(claimId) === signature);
  if (targetIsSubset && nextClaims.size < previousClaims.size) return 'NARROW';
  if (sourceIsSubset && previousClaims.size < nextClaims.size) return 'EXPAND';
  if (targetIsSubset && sourceIsSubset) return 'EQUIVALENT';
  return 'INCOMPATIBLE';
}

function normalizeDelta(input) {
  allowedFields(input, DELTA_FIELDS, 'delta');
  const viewChanges = arrayValue(input.viewChanges, 'delta.viewChanges', LEDGER_LIMITS.dependencyRefsTotal, (item, path) => {
    allowedFields(item, VIEW_CHANGE_FIELDS, path);
    return {
      viewId: stringValue(item.viewId, `${path}.viewId`),
      fromRevision: integerValue(item.fromRevision, `${path}.fromRevision`),
      toRevision: integerValue(item.toRevision, `${path}.toRevision`),
      type: stringValue(item.type, `${path}.type`, { maximum: 32, pattern: SYMBOL_PATTERN }),
    };
  });
  const entityChanges = arrayValue(input.entityChanges, 'delta.entityChanges', LEDGER_LIMITS.dependencyRefsTotal, (item, path) => {
    allowedFields(item, ENTITY_CHANGE_FIELDS, path);
    return {
      logicalId: stringValue(item.logicalId, `${path}.logicalId`),
      fromRevision: integerValue(item.fromRevision, `${path}.fromRevision`),
      toRevision: integerValue(item.toRevision, `${path}.toRevision`),
      type: stringValue(item.type, `${path}.type`, { maximum: 32, pattern: SYMBOL_PATTERN }),
    };
  });
  if (viewChanges.length + entityChanges.length > LEDGER_LIMITS.dependencyRefsTotal) fail('OVER_LIMIT', 'Delta dependency refs exceed the total cap.');
  unique(viewChanges, 'viewId', 'delta.viewChanges');
  unique(entityChanges, 'logicalId', 'delta.entityChanges');
  return { viewChanges, entityChanges };
}

function invalidationReason(fingerprint, delta) {
  for (const reference of fingerprint.semanticViewRefs) {
    const change = delta.viewChanges.find((item) => item.viewId === reference.viewId);
    if (!change) continue;
    if (change.fromRevision !== reference.revision || !SAFE_DELTA_TYPES.has(change.type)) return 'DEPENDENCY_INVALIDATED';
  }
  for (const reference of fingerprint.entityRefs) {
    if (reference.state === 'AMBIGUOUS') return 'ENTITY_AMBIGUOUS';
    if (reference.state !== 'PRESENT') return 'DEPENDENCY_INVALIDATED';
    const change = delta.entityChanges.find((item) => item.logicalId === reference.logicalId);
    if (!change) continue;
    if (change.type === 'AMBIGUOUS') return 'ENTITY_AMBIGUOUS';
    if (change.fromRevision !== reference.semanticRevision || !SAFE_DELTA_TYPES.has(change.type) || change.toRevision !== reference.semanticRevision) {
      return 'DEPENDENCY_INVALIDATED';
    }
  }
  return null;
}

function evidenceExpired(evidence, ledger, claim, now) {
  const requirements = referencedRequirements(ledger, claim).filter((item) => item.categories.includes(evidence.category));
  if (!requirements.length) return true;
  const maximumAge = Math.max(...requirements.map((item) => item.maximumAgeSeconds));
  const age = (Date.parse(now) - Date.parse(evidence.observedAt)) / 1000;
  return age < 0 || age > maximumAge;
}

function normalizeLedgerError(error) {
  if (error instanceof ReuseError) throw error;
  if (error instanceof LedgerError) throw new ReuseError(error.code, error.message);
  throw error;
}

export async function reuseEvidenceAcrossRevision(previousInput, nextInput, bindings, deltaInput, options = {}) {
  let previous;
  let next;
  try {
    previous = await validateLedger(previousInput);
    next = await validateLedger(nextInput);
  } catch (error) {
    normalizeLedgerError(error);
  }
  const evaluatedAt = timestampValue(options.now, 'options.now');
  if (next.revision <= previous.revision) fail('STALE_REVISION', 'Target revision is not newer than the source.');
  if (next.revision !== previous.revision + 1 || next.parentDigest !== previous.ledgerDigest) fail('FORKED_REVISION', 'Target is not the direct child of the source head.');
  if (next.tenantId !== previous.tenantId) fail('CROSS_TENANT', 'Target belongs to another tenant.');
  if (next.goalId !== previous.goalId) fail('CROSS_GOAL_LINEAGE', 'Target belongs to another goal lineage.');
  if (TERMINAL_STATUSES.has(next.status)) fail('TERMINAL_LEDGER', 'Evidence cannot carry into a terminal ledger.');
  if (!Array.isArray(bindings) || bindings.length > 500) fail('OVER_LIMIT', 'Bindings exceed their item limit.');
  const delta = normalizeDelta(deltaInput);
  const relation = compareLedgerRevision(previous, next);
  const carriedEvidence = [];
  const reused = [];
  const invalidated = [];
  const seen = new Set();

  for (const [bindingIndex, binding] of bindings.entries()) {
    allowedFields(binding, new Set(['evidence', 'fingerprint']), 'binding');
    let evidence;
    let fingerprint;
    try {
      evidence = await validateEvidence(binding.evidence);
      fingerprint = await validateFingerprint(binding.fingerprint);
    } catch (error) {
      const submittedId = binding?.evidence?.evidenceId;
      const evidenceId = typeof submittedId === 'string'
        && ID_PATTERN.test(submittedId)
        && !SECRET_VALUE.test(submittedId)
        ? submittedId
        : `invalid_evidence_${bindingIndex}`;
      invalidated.push({ evidenceId, reason: error.code ?? 'INVALID_DIGEST' });
      continue;
    }
    if (seen.has(evidence.evidenceId)) {
      invalidated.push({ evidenceId: evidence.evidenceId, reason: 'DUPLICATE_ID' });
      continue;
    }
    seen.add(evidence.evidenceId);
    let reason = null;
    if (evidence.tenantId !== previous.tenantId || evidence.goalId !== previous.goalId || evidence.goalRevision !== previous.revision || evidence.ledgerDigest !== previous.ledgerDigest) {
      reason = 'CROSS_GOAL_LINEAGE';
    } else if (fingerprint.claimId !== evidence.claimId || fingerprint.scopeId !== evidence.scopeId) reason = 'DEPENDENCY_INVALIDATED';
    else if (relation === 'EXPAND') reason = 'EXPANDED_GOAL_NO_COMPLETENESS_REUSE';
    else if (relation === 'INCOMPATIBLE') reason = 'REVISION_INCOMPATIBLE';
    const targetClaim = next.claims.find((claim) => claim.claimId === evidence.claimId);
    if (!reason && !targetClaim) reason = 'CLAIM_NOT_RETAINED';
    if (!reason && targetClaim.scopeId !== evidence.scopeId) reason = 'SCOPE_MISMATCH';
    if (!reason) reason = invalidationReason(fingerprint, delta);
    if (!reason && evidenceExpired(evidence, next, targetClaim, evaluatedAt)) reason = 'EXPIRED';
    if (reason) {
      invalidated.push({ evidenceId: evidence.evidenceId, reason });
      continue;
    }
    const { evidenceDigest: _ignored, ...source } = evidence;
    const carried = await createEvidence({
      ...source,
      goalRevision: next.revision,
      ledgerDigest: next.ledgerDigest,
    });
    carriedEvidence.push(carried);
    reused.push({
      evidenceId: evidence.evidenceId,
      sourceEvidenceDigest: evidence.evidenceDigest,
      carriedEvidenceDigest: carried.evidenceDigest,
      fingerprintDigest: fingerprint.fingerprintDigest,
    });
  }

  carriedEvidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId, 'en'));
  reused.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId, 'en'));
  invalidated.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId, 'en'));
  const receiptBody = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: previous.tenantId,
    sourceGoalId: previous.goalId,
    targetGoalId: next.goalId,
    sourceRevision: previous.revision,
    sourceDigest: previous.ledgerDigest,
    targetRevision: next.revision,
    targetDigest: next.ledgerDigest,
    relation,
    reused,
    invalidated,
    evaluatedAt,
    reuseVersion: REUSE_VERSION,
  };
  const receipt = deepFreeze({ ...receiptBody, receiptDigest: await digestCanonical(receiptBody) });
  if (new TextEncoder().encode(canonicalJson(receipt)).length > LEDGER_LIMITS.proofResponseBytes) fail('OVER_LIMIT', 'Carry-forward receipt exceeds its size cap.');
  return deepFreeze({ relation, carriedEvidence, receipt });
}

function normalizeReceipt(input) {
  allowedFields(input, RECEIPT_FIELDS, 'receipt');
  if (input.schemaVersion !== SCHEMA_VERSION || input.reuseVersion !== REUSE_VERSION) fail('INVALID_VALUE', 'Receipt version is unsupported.');
  const relation = stringValue(input.relation, 'receipt.relation', { maximum: 32, pattern: SYMBOL_PATTERN });
  if (!REVISION_RELATIONS.has(relation)) fail('INVALID_VALUE', 'Receipt relation is unsupported.');
  const reused = arrayValue(input.reused, 'receipt.reused', 500, (item, path) => {
    allowedFields(item, REUSED_FIELDS, path);
    return {
      evidenceId: stringValue(item.evidenceId, `${path}.evidenceId`),
      sourceEvidenceDigest: digestValue(item.sourceEvidenceDigest, `${path}.sourceEvidenceDigest`),
      carriedEvidenceDigest: digestValue(item.carriedEvidenceDigest, `${path}.carriedEvidenceDigest`),
      fingerprintDigest: digestValue(item.fingerprintDigest, `${path}.fingerprintDigest`),
    };
  });
  const invalidated = arrayValue(input.invalidated, 'receipt.invalidated', 500, (item, path) => {
    allowedFields(item, INVALIDATED_FIELDS, path);
    return {
      evidenceId: stringValue(item.evidenceId, `${path}.evidenceId`),
      reason: stringValue(item.reason, `${path}.reason`, { maximum: 64, pattern: SYMBOL_PATTERN }),
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    tenantId: stringValue(input.tenantId, 'receipt.tenantId'),
    sourceGoalId: stringValue(input.sourceGoalId, 'receipt.sourceGoalId'),
    targetGoalId: stringValue(input.targetGoalId, 'receipt.targetGoalId'),
    sourceRevision: integerValue(input.sourceRevision, 'receipt.sourceRevision'),
    sourceDigest: digestValue(input.sourceDigest, 'receipt.sourceDigest'),
    targetRevision: integerValue(input.targetRevision, 'receipt.targetRevision'),
    targetDigest: digestValue(input.targetDigest, 'receipt.targetDigest'),
    relation,
    reused,
    invalidated,
    evaluatedAt: timestampValue(input.evaluatedAt, 'receipt.evaluatedAt'),
    reuseVersion: REUSE_VERSION,
  };
}

export async function validateCarryForwardReceipt(input) {
  if (!isPlainObject(input) || !SHA256_HEX.test(input.receiptDigest || '')) fail('INVALID_DIGEST', 'receipt.receiptDigest is invalid.');
  const normalized = normalizeReceipt(input);
  const expected = await digestCanonical(normalized);
  if (expected !== input.receiptDigest) fail('INVALID_DIGEST', 'Receipt digest does not match canonical content.');
  const receipt = deepFreeze({ ...normalized, receiptDigest: expected });
  if (new TextEncoder().encode(canonicalJson(receipt)).length > LEDGER_LIMITS.proofResponseBytes) fail('OVER_LIMIT', 'Carry-forward receipt exceeds its size cap.');
  return receipt;
}
