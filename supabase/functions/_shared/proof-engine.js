// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: proof-engine — engine — Repository file.
// @state: remove unwired modules, dead exports; WHY-only comments (owner-ordered).
// @dependencies: goal-ledger, canonical-order.

import {
  LEDGER_LIMITS,
  LedgerError,
  canonicalJson,
  digestCanonical,
  validateLedger,
} from './goal-ledger.js';
import { codeUnitCompare } from '../../../lib/canonical-order.js';
import { SECRET_VALUE } from '../../../lib/secret-pattern.js';

const SCHEMA_VERSION = 1;
const EVALUATOR_VERSION = 'OA_PROOF_V1';
const MAX_EVIDENCE_ITEMS = 500;
const SHA256_HEX = /^sha256:[0-9a-f]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9_]{0,255}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv)/i;

const EVIDENCE_FIELDS = new Set([
  'schemaVersion', 'evidenceId', 'category', 'tenantId', 'goalId', 'goalRevision',
  'ledgerDigest', 'claimId', 'scopeId', 'observedAt', 'trust', 'predicate',
  'supports', 'exhaustive', 'dependencies', 'evidenceDigest',
]);
const DEPENDENCY_FIELDS = new Set(['evidenceId', 'evidenceDigest']);
const EVIDENCE_CATEGORIES = new Set([
  'USER_ASSERTION', 'USER_AUTHORIZATION', 'DIRECT_OBSERVATION',
  'DERIVED_OBSERVATION', 'ACTION_RECEIPT', 'BOUNDARY_OBSERVATION',
  'EXTERNAL_ATTESTATION',
]);
const EXPECTED_TRUST = Object.freeze({
  USER_ASSERTION: 'AUTHENTICATED_USER',
  USER_AUTHORIZATION: 'AUTHENTICATED_USER',
  DIRECT_OBSERVATION: 'BROWSER_SENSOR',
  DERIVED_OBSERVATION: 'DETERMINISTIC_DERIVATION',
  ACTION_RECEIPT: 'BROWSER_SENSOR',
  BOUNDARY_OBSERVATION: 'BROWSER_SENSOR',
  EXTERNAL_ATTESTATION: 'AUTHENTICATED_EXTERNAL',
});
const VALIDATED_EVIDENCE = Symbol('validatedEvidenceDigest');

class ProofError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProofError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProofError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allowedFields(value, fields, path) {
  if (!isPlainObject(value)) fail('INVALID_TYPE', `${path} must be a plain object.`);
  for (const key of Object.keys(value)) {
    if (SECRET_FIELD.test(key)) fail('SECRET_LIKE_VALUE', `${path}.${key} is forbidden.`);
    if (!fields.has(key)) fail('UNKNOWN_FIELD', `${path}.${key} is not allowed.`);
  }
}

function stringValue(value, path, { maxBytes = 256, pattern } = {}) {
  if (typeof value !== 'string') fail('INVALID_TYPE', `${path} must be a string.`);
  const normalized = value.normalize('NFC');
  if (!normalized || new TextEncoder().encode(normalized).length > maxBytes) fail('OVER_LIMIT', `${path} exceeds its bounds.`);
  if (SECRET_VALUE.test(normalized)) fail('SECRET_LIKE_VALUE', `${path} contains a forbidden value.`);
  if (pattern && !pattern.test(normalized)) fail('INVALID_VALUE', `${path} has an invalid format.`);
  return normalized;
}

function idValue(value, path) {
  return stringValue(value, path, { maxBytes: 128, pattern: ID_PATTERN });
}

function timestampValue(value, path) {
  const normalized = stringValue(value, path, { maxBytes: 32, pattern: UTC_TIMESTAMP });
  if (!Number.isFinite(Date.parse(normalized))) fail('INVALID_VALUE', `${path} is not a valid UTC timestamp.`);
  return normalized;
}

function digestValue(value, path) {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) fail('INVALID_DIGEST', `${path} is invalid.`);
  return value;
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

function freezeEvidence(value) {
  Object.defineProperty(value, VALIDATED_EVIDENCE, {
    value: value.evidenceDigest,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value);
}

function normalizeDependency(value, path) {
  allowedFields(value, DEPENDENCY_FIELDS, path);
  return {
    evidenceId: idValue(value.evidenceId, `${path}.evidenceId`),
    evidenceDigest: digestValue(value.evidenceDigest, `${path}.evidenceDigest`),
  };
}

function normalizeEvidence(input) {
  allowedFields(input, EVIDENCE_FIELDS, 'evidence');
  if (input.schemaVersion !== SCHEMA_VERSION) fail('INVALID_VALUE', 'evidence.schemaVersion is unsupported.');
  const category = stringValue(input.category, 'evidence.category', { maxBytes: 64, pattern: SYMBOL_PATTERN });
  if (!EVIDENCE_CATEGORIES.has(category)) fail('INVALID_VALUE', 'evidence.category is unsupported.');
  const trust = stringValue(input.trust, 'evidence.trust', { maxBytes: 64, pattern: SYMBOL_PATTERN });
  if (trust !== EXPECTED_TRUST[category]) fail('UNTRUSTED_EVIDENCE', 'Evidence trust does not match its category.');
  if (!Number.isSafeInteger(input.goalRevision) || input.goalRevision < 1 || input.goalRevision > LEDGER_LIMITS.maximumRevision) {
    fail('INVALID_VALUE', 'evidence.goalRevision is invalid.');
  }
  if (typeof input.supports !== 'boolean' || typeof input.exhaustive !== 'boolean') {
    fail('INVALID_TYPE', 'evidence.supports and evidence.exhaustive must be boolean.');
  }
  const dependencies = arrayValue(input.dependencies, 'evidence.dependencies', LEDGER_LIMITS.dependencyRefsTotal, normalizeDependency);
  if (new Set(dependencies.map((item) => item.evidenceId)).size !== dependencies.length) fail('DUPLICATE_ID', 'Evidence dependencies must be unique.');
  if (dependencies.some((item) => item.evidenceId === input.evidenceId)) fail('DEPENDENCY_INVALIDATED', 'Evidence cannot depend on itself.');
  if (category === 'DERIVED_OBSERVATION' && dependencies.length === 0) fail('MISSING_REFERENCE', 'Derived evidence requires a named dependency.');
  if (category !== 'DERIVED_OBSERVATION' && dependencies.length > 0) fail('INVALID_VALUE', 'Only derived evidence may contain dependencies.');
  return {
    schemaVersion: SCHEMA_VERSION,
    evidenceId: idValue(input.evidenceId, 'evidence.evidenceId'),
    category,
    tenantId: idValue(input.tenantId, 'evidence.tenantId'),
    goalId: idValue(input.goalId, 'evidence.goalId'),
    goalRevision: input.goalRevision,
    ledgerDigest: digestValue(input.ledgerDigest, 'evidence.ledgerDigest'),
    claimId: idValue(input.claimId, 'evidence.claimId'),
    scopeId: idValue(input.scopeId, 'evidence.scopeId'),
    observedAt: timestampValue(input.observedAt, 'evidence.observedAt'),
    trust,
    predicate: stringValue(input.predicate, 'evidence.predicate', { maxBytes: 256, pattern: SYMBOL_PATTERN }),
    supports: input.supports,
    exhaustive: input.exhaustive,
    dependencies,
  };
}

export async function createEvidence(input) {
  const normalized = normalizeEvidence(input);
  const evidenceDigest = await digestCanonical(normalized);
  return freezeEvidence({ ...normalized, evidenceDigest });
}

async function validateEvidence(input) {
  if (!isPlainObject(input) || !SHA256_HEX.test(input.evidenceDigest || '')) fail('INVALID_DIGEST', 'evidence.evidenceDigest is invalid.');
  if (input[VALIDATED_EVIDENCE] === input.evidenceDigest && Object.isFrozen(input)) return input;
  const normalized = normalizeEvidence(input);
  const expected = await digestCanonical(normalized);
  if (expected !== input.evidenceDigest) fail('INVALID_DIGEST', 'Evidence digest does not match canonical content.');
  return freezeEvidence({ ...normalized, evidenceDigest: expected });
}

function rejectionCode(error) {
  if (error instanceof ProofError || error instanceof LedgerError) return error.code;
  return 'INVALID_DIGEST';
}

function evidenceIdFor(input, index) {
  return typeof input?.evidenceId === 'string' && ID_PATTERN.test(input.evidenceId)
    ? input.evidenceId
    : `invalid_evidence_${index}`;
}

function requirementAge(claim, requirements, category) {
  const ids = new Set(claim.evidenceRequirementIds);
  const matching = requirements.filter((item) => ids.has(item.requirementId) && item.categories.includes(category));
  return matching.length ? Math.max(...matching.map((item) => item.maximumAgeSeconds)) : 0;
}

function compareEvidence(left, right) {
  return left.evidenceId.localeCompare(right.evidenceId, 'en');
}

function compareRejection(left, right) {
  return left.index - right.index;
}

function proofBytes(value) {
  return new TextEncoder().encode(canonicalJson(value)).length;
}

export async function evaluateProof(ledgerInput, claimIdInput, evidenceInput, options = {}) {
  const ledger = await validateLedger(ledgerInput, { now: options.now });
  const claimId = idValue(claimIdInput, 'claimId');
  const claim = ledger.claims.find((item) => item.claimId === claimId);
  if (!claim) fail('MISSING_REFERENCE', `Unknown claim ${claimId}.`);
  const evaluatedAt = timestampValue(options.now, 'options.now');
  if (!Array.isArray(evidenceInput)) fail('INVALID_TYPE', 'evidence must be an array.');
  if (evidenceInput.length > MAX_EVIDENCE_ITEMS) fail('OVER_LIMIT', 'Evidence exceeds the evaluation limit.');
  const dependencyInput = options.dependencyEvidence ?? [];
  if (!Array.isArray(dependencyInput) || dependencyInput.length > MAX_EVIDENCE_ITEMS) fail('OVER_LIMIT', 'Dependency evidence exceeds the evaluation limit.');

  const validated = await Promise.all(evidenceInput.map(async (item, index) => {
    try {
      return { index, evidence: await validateEvidence(item) };
    } catch (error) {
      return { index, rejection: { evidenceId: evidenceIdFor(item, index), reason: rejectionCode(error) } };
    }
  }));
  const dependencyValidated = await Promise.all(dependencyInput.map(async (item) => {
    try { return await validateEvidence(item); } catch { return null; }
  }));
  const dependencyHeads = new Map(dependencyValidated.filter(Boolean).map((item) => [item.evidenceId, item]));
  for (const item of validated) if (item.evidence) dependencyHeads.set(item.evidence.evidenceId, item.evidence);

  const accepted = [];
  const rejected = validated.filter((item) => item.rejection);
  const nowMs = Date.parse(evaluatedAt);
  const seenEvidenceIds = new Set();
  for (const item of validated) {
    const evidence = item.evidence;
    if (!evidence) continue;
    let reason = null;
    if (seenEvidenceIds.has(evidence.evidenceId)) reason = 'DUPLICATE_ID';
    else seenEvidenceIds.add(evidence.evidenceId);
    if (!reason) {
      if (evidence.tenantId !== ledger.tenantId) reason = 'CROSS_TENANT';
      else if (evidence.goalId !== ledger.goalId || evidence.ledgerDigest !== ledger.ledgerDigest) reason = 'CROSS_GOAL_LINEAGE';
      else if (evidence.goalRevision !== ledger.revision) reason = 'STALE_REVISION';
      else if (evidence.claimId !== claim.claimId || evidence.scopeId !== claim.scopeId || evidence.predicate !== claim.predicate) reason = 'SCOPE_MISMATCH';
      else if (evidence.category === 'ACTION_RECEIPT') reason = 'ACTION_IS_NOT_OUTCOME_EVIDENCE';
      else if (evidence.category === 'USER_AUTHORIZATION') reason = 'AUTHORIZATION_IS_NOT_OUTCOME_EVIDENCE';
    }
    if (!reason) {
      if (evidence.dependencies.some((dependency) => {
        const head = dependencyHeads.get(dependency.evidenceId);
        const dependencyMaximumAge = head
          ? Math.max(0, ...ledger.evidenceRequirements
            .filter((requirement) => requirement.categories.includes(head.category))
            .map((requirement) => requirement.maximumAgeSeconds))
          : 0;
        const dependencyAgeSeconds = head ? (nowMs - Date.parse(head.observedAt)) / 1000 : Number.POSITIVE_INFINITY;
        return !head
          || head.evidenceDigest !== dependency.evidenceDigest
          || head.tenantId !== ledger.tenantId
          || head.goalId !== ledger.goalId
          || head.goalRevision !== ledger.revision
          || head.ledgerDigest !== ledger.ledgerDigest
          || head.scopeId !== claim.scopeId
          || head.category === 'ACTION_RECEIPT'
          || head.category === 'USER_AUTHORIZATION'
          || dependencyMaximumAge === 0
          || dependencyAgeSeconds < 0
          || dependencyAgeSeconds > dependencyMaximumAge;
      })) {
        reason = 'DEPENDENCY_INVALIDATED';
      } else {
        const maximumAge = requirementAge(claim, ledger.evidenceRequirements, evidence.category);
        const ageSeconds = (nowMs - Date.parse(evidence.observedAt)) / 1000;
        if (ageSeconds < 0 || maximumAge === 0 || ageSeconds > maximumAge) reason = 'EXPIRED';
      }
    }
    if (reason) rejected.push({ index: item.index, rejection: { evidenceId: evidence.evidenceId, reason } });
    else accepted.push(evidence);
  }

  accepted.sort(compareEvidence);
  rejected.sort(compareRejection);
  const contradictionGroups = new Map();
  for (const evidence of accepted) {
    const group = contradictionGroups.get(evidence.predicate) ?? { yes: [], no: [] };
    group[evidence.supports ? 'yes' : 'no'].push(evidence.evidenceId);
    contradictionGroups.set(evidence.predicate, group);
  }
  const contradictions = [];
  for (const [predicate, group] of contradictionGroups) {
    if (group.yes.length && group.no.length) {
      const evidenceRefs = [...group.yes, ...group.no].sort(codeUnitCompare);
      contradictions.push({ predicate, evidenceRefs });
      for (const evidenceId of evidenceRefs) rejected.push({ index: Number.MAX_SAFE_INTEGER, rejection: { evidenceId, reason: 'CONTRADICTION_UNRESOLVED' } });
    }
  }
  contradictions.sort((left, right) => left.predicate.localeCompare(right.predicate, 'en'));

  const requirementById = new Map(ledger.evidenceRequirements.map((item) => [item.requirementId, item]));
  const unresolved = [];
  for (const requirementId of claim.evidenceRequirementIds) {
    const requirement = requirementById.get(requirementId);
    const matches = accepted.filter((item) => item.supports && requirement.categories.includes(item.category));
    const count = requirement.categories.includes('BOUNDARY_OBSERVATION')
      ? new Set(matches.filter((item) => item.category === 'BOUNDARY_OBSERVATION').map((item) => item.observedAt)).size
      : matches.length;
    if (count < requirement.minimumCount) unresolved.push(requirementId);
  }
  const supporting = accepted.filter((item) => item.supports);
  const exhaustive = supporting.some((item) => item.exhaustive);
  let status;
  if (contradictions.length) status = 'BLOCKED';
  else if (!supporting.length) status = 'UNKNOWN';
  else if (unresolved.length) status = 'PARTIAL';
  else if (ledger.scope.kind === 'CLOSED_WORLD' && exhaustive) status = 'PROVED';
  else if (ledger.scope.kind === 'CLOSED_WORLD') {
    status = 'PARTIAL';
    unresolved.push('EXHAUSTIVE_EVIDENCE_REQUIRED');
  } else if (ledger.scope.kind === 'BOUNDED_FEED') status = 'BOUNDED_COMPLETE';
  else status = 'PARTIAL';

  const limits = [];
  if (ledger.scope.kind === 'BOUNDED_FEED') limits.push('DECLARED_BOUNDED_SCOPE_ONLY');
  if (status !== 'PROVED' && ledger.scope.kind !== 'CLOSED_WORLD') limits.push('NOT_UNIVERSAL_PROOF');
  const rejectedEvidenceRefs = rejected
    .sort(compareRejection)
    .map((item) => item.rejection);
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    goalId: ledger.goalId,
    goalRevision: ledger.revision,
    claimId: claim.claimId,
    status,
    scope: { ...ledger.scope },
    evidenceRefs: accepted.map((item) => item.evidenceId),
    rejectedEvidenceRefs,
    contradictions,
    limits,
    unresolved,
    evaluatedAt,
    evaluatorVersion: EVALUATOR_VERSION,
  };
  if (proofBytes(receipt) > LEDGER_LIMITS.proofResponseBytes) fail('OVER_LIMIT', 'Proof response exceeds its size cap.');
  const proofDigest = await digestCanonical(receipt);
  return deepFreeze({ ...receipt, proofDigest });
}
