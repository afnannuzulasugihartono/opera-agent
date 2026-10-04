// @last-edited: 2026-10-04 11:10 UTC.
// @title: goal-ledger — ledger — Repository file.
// @context: Deno edge function.
// @state: clear deno require-await and no-unused-vars in edge functions.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

const SCHEMA_VERSION = 1;
const DIGEST_PREFIX = 'sha256:';
const SHA256_HEX = /^sha256:[0-9a-f]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const LEDGER_LIMITS = Object.freeze({
  objectiveUtf8Bytes: 1000,
  constraints: 32,
  authorizations: 16,
  claims: 64,
  evidenceRequirementsPerClaim: 16,
  nonGoals: 32,
  dependencyRefsTotal: 256,
  ledgerTokenBytes: 65536,
  proofResponseBytes: 131072,
  defaultLifetimeSeconds: 86400,
  maximumLifetimeSeconds: 604800,
  maximumRevision: 2147483647,
});

const LEDGER_STATUSES = new Set(['OPEN', 'PARTIAL', 'SATISFIED', 'BLOCKED', 'CANCELLED', 'EXPIRED']);
const TERMINAL_STATUSES = new Set(['CANCELLED', 'EXPIRED']);
const CONSTRAINT_KINDS = new Set(['VALUE_PREDICATE', 'SCOPE_BOUND', 'INVARIANT', 'SAFETY_BOUND']);
const CLAIM_OPERATORS = new Set(['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'CONTAINS', 'EXISTS', 'FOR_ALL']);
const EVIDENCE_CATEGORIES = new Set([
  'USER_ASSERTION',
  'USER_AUTHORIZATION',
  'DIRECT_OBSERVATION',
  'DERIVED_OBSERVATION',
  'ACTION_RECEIPT',
  'BOUNDARY_OBSERVATION',
  'EXTERNAL_ATTESTATION',
]);

const ROOT_FIELDS = new Set([
  'schemaVersion', 'goalId', 'tenantId', 'revision', 'parentDigest', 'objective', 'scope',
  'constraints', 'authorizations', 'claims', 'evidenceRequirements', 'nonGoals', 'status',
  'createdAt', 'expiresAt', 'ledgerDigest',
]);
const SCOPE_FIELDS = new Set(['kind', 'resourceId']);
const CONSTRAINT_FIELDS = new Set([
  'constraintId', 'kind', 'claimField', 'operator', 'integerValue', 'stringValue',
  'booleanValue', 'stringValues',
]);
const AUTHORIZATION_FIELDS = new Set(['authorizationId', 'operationClass', 'scopeId', 'expiresAt']);
const CLAIM_FIELDS = new Set(['claimId', 'scopeId', 'predicate', 'evidenceRequirementIds']);
const REQUIREMENT_FIELDS = new Set(['requirementId', 'categories', 'minimumCount', 'maximumAgeSeconds']);
const REVISION_FIELDS = new Set(['expectedRevision', 'expectedDigest', 'freshUserAuthorization', 'changes']);
const CHANGE_FIELDS = new Set([
  'objective', 'scope', 'constraints', 'authorizations', 'claims', 'evidenceRequirements', 'nonGoals', 'expiresAt',
]);
const TERMINAL_REQUEST_FIELDS = new Set(['expectedRevision', 'expectedDigest']);
const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv)/i;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;

export class LedgerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new LedgerError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail('INVALID_TYPE', `${path} must be a plain object.`);
}

function assertAllowedFields(value, allowed, path) {
  assertPlainObject(value, path);
  for (const key of Object.keys(value)) {
    if (SECRET_FIELD.test(key)) fail('SECRET_LIKE_VALUE', `${path}.${key} is a forbidden secret-like field.`);
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${path}.${key} is not allowed.`);
  }
}

function assertNoSecretLikeValues(value, path = 'ledger', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('SECRET_LIKE_VALUE', `${path} contains a secret-like value.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} contains a cycle.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoSecretLikeValues(item, `${path}[${index}]`, seen));
  else for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) fail('SECRET_LIKE_VALUE', `${path}.${key} is a forbidden secret-like field.`);
    assertNoSecretLikeValues(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function normalizeString(value, path, { min = 1, maxBytes = 1000, pattern } = {}) {
  if (typeof value !== 'string') fail('INVALID_TYPE', `${path} must be a string.`);
  const normalized = value.normalize('NFC');
  const bytes = new TextEncoder().encode(normalized).length;
  if (bytes < min || bytes > maxBytes) fail('OVER_LIMIT', `${path} exceeds its byte bounds.`);
  if (pattern && !pattern.test(normalized)) fail('INVALID_VALUE', `${path} has an invalid format.`);
  return normalized;
}

function normalizeId(value, path) {
  return normalizeString(value, path, { maxBytes: 128, pattern: ID_PATTERN });
}

function normalizeTimestamp(value, path) {
  const normalized = normalizeString(value, path, { maxBytes: 32 });
  const milliseconds = Date.parse(normalized);
  if (!UTC_TIMESTAMP.test(normalized) || !Number.isFinite(milliseconds)) fail('INVALID_VALUE', `${path} must be an RFC3339 UTC timestamp.`);
  return normalized;
}

function normalizePositiveInteger(value, path, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('INVALID_VALUE', `${path} must be a bounded positive integer.`);
  return value;
}

function normalizeArray(value, path, maximum, mapper) {
  if (!Array.isArray(value)) fail('INVALID_TYPE', `${path} must be an array.`);
  if (value.length > maximum) fail('OVER_LIMIT', `${path} exceeds its item limit.`);
  return value.map((item, index) => mapper(item, `${path}[${index}]`));
}

function uniqueBy(items, key, path) {
  const values = new Set();
  for (const item of items) {
    if (values.has(item[key])) fail('DUPLICATE_ID', `${path} contains duplicate ${key} ${item[key]}.`);
    values.add(item[key]);
  }
  return values;
}

function normalizeScope(value, path) {
  assertAllowedFields(value, SCOPE_FIELDS, path);
  return {
    kind: normalizeString(value.kind, `${path}.kind`, { maxBytes: 64, pattern: /^[A-Z][A-Z0-9_]{0,63}$/ }),
    resourceId: normalizeId(value.resourceId, `${path}.resourceId`),
  };
}

function normalizeConstraint(value, path) {
  assertAllowedFields(value, CONSTRAINT_FIELDS, path);
  const output = {
    constraintId: normalizeId(value.constraintId, `${path}.constraintId`),
    kind: normalizeString(value.kind, `${path}.kind`, { maxBytes: 32 }),
    claimField: normalizeString(value.claimField, `${path}.claimField`, { maxBytes: 128 }),
    operator: normalizeString(value.operator, `${path}.operator`, { maxBytes: 16 }),
  };
  if (!CONSTRAINT_KINDS.has(output.kind)) fail('INVALID_VALUE', `${path}.kind is not supported.`);
  if (!CLAIM_OPERATORS.has(output.operator)) fail('INVALID_VALUE', `${path}.operator is not supported.`);

  const valueFields = ['integerValue', 'stringValue', 'booleanValue', 'stringValues'].filter((field) => value[field] !== undefined);
  if (valueFields.length !== 1) fail('INVALID_VALUE', `${path} must contain exactly one typed value.`);
  const valueField = valueFields[0];
  if (valueField === 'integerValue') {
    if (!Number.isSafeInteger(value.integerValue)) fail('INVALID_VALUE', `${path}.integerValue must be a safe integer.`);
    output.integerValue = value.integerValue;
  } else if (valueField === 'stringValue') output.stringValue = normalizeString(value.stringValue, `${path}.stringValue`);
  else if (valueField === 'booleanValue') {
    if (typeof value.booleanValue !== 'boolean') fail('INVALID_TYPE', `${path}.booleanValue must be boolean.`);
    output.booleanValue = value.booleanValue;
  } else output.stringValues = normalizeArray(value.stringValues, `${path}.stringValues`, 64, (item, itemPath) => normalizeString(item, itemPath));
  return output;
}

function normalizeAuthorization(value, path) {
  assertAllowedFields(value, AUTHORIZATION_FIELDS, path);
  return {
    authorizationId: normalizeId(value.authorizationId, `${path}.authorizationId`),
    operationClass: normalizeString(value.operationClass, `${path}.operationClass`, { maxBytes: 128, pattern: /^[A-Z][A-Z0-9_]{0,127}$/ }),
    scopeId: normalizeId(value.scopeId, `${path}.scopeId`),
    expiresAt: normalizeTimestamp(value.expiresAt, `${path}.expiresAt`),
  };
}

function normalizeClaim(value, path) {
  assertAllowedFields(value, CLAIM_FIELDS, path);
  return {
    claimId: normalizeId(value.claimId, `${path}.claimId`),
    scopeId: normalizeId(value.scopeId, `${path}.scopeId`),
    predicate: normalizeString(value.predicate, `${path}.predicate`, { maxBytes: 256, pattern: /^[A-Z][A-Z0-9_]{0,255}$/ }),
    evidenceRequirementIds: normalizeArray(
      value.evidenceRequirementIds,
      `${path}.evidenceRequirementIds`,
      LEDGER_LIMITS.evidenceRequirementsPerClaim,
      (item, itemPath) => normalizeId(item, itemPath),
    ),
  };
}

function normalizeRequirement(value, path) {
  assertAllowedFields(value, REQUIREMENT_FIELDS, path);
  const categories = normalizeArray(value.categories, `${path}.categories`, 7, (item, itemPath) => {
    const category = normalizeString(item, itemPath, { maxBytes: 64 });
    if (!EVIDENCE_CATEGORIES.has(category)) fail('INVALID_VALUE', `${itemPath} is not a supported evidence category.`);
    return category;
  });
  if (!categories.length || new Set(categories).size !== categories.length) fail('INVALID_VALUE', `${path}.categories must be non-empty and unique.`);
  return {
    requirementId: normalizeId(value.requirementId, `${path}.requirementId`),
    categories,
    minimumCount: normalizePositiveInteger(value.minimumCount, `${path}.minimumCount`, 500),
    maximumAgeSeconds: normalizePositiveInteger(value.maximumAgeSeconds, `${path}.maximumAgeSeconds`, LEDGER_LIMITS.maximumLifetimeSeconds),
  };
}

function withoutDigest(value) {
  const { ledgerDigest: _ignored, ...rest } = value;
  return rest;
}

function normalizeLedgerShape(input, { creation = false } = {}) {
  assertNoSecretLikeValues(input);
  assertAllowedFields(input, ROOT_FIELDS, 'ledger');
  if (input.schemaVersion !== SCHEMA_VERSION) fail('INVALID_VALUE', 'ledger.schemaVersion is unsupported.');
  const revision = normalizePositiveInteger(input.revision, 'ledger.revision', LEDGER_LIMITS.maximumRevision);
  if (creation && revision !== 1) fail('INVALID_VALUE', 'A new ledger must begin at revision 1.');
  if (creation && input.parentDigest !== null) fail('INVALID_VALUE', 'A new ledger must have a null parentDigest.');
  if (!creation && revision > 1 && !SHA256_HEX.test(input.parentDigest || '')) fail('INVALID_DIGEST', 'A revised ledger requires a valid parentDigest.');

  const constraints = normalizeArray(input.constraints, 'ledger.constraints', LEDGER_LIMITS.constraints, normalizeConstraint);
  const authorizations = normalizeArray(input.authorizations, 'ledger.authorizations', LEDGER_LIMITS.authorizations, normalizeAuthorization);
  const claims = normalizeArray(input.claims, 'ledger.claims', LEDGER_LIMITS.claims, normalizeClaim);
  const evidenceRequirements = normalizeArray(
    input.evidenceRequirements,
    'ledger.evidenceRequirements',
    LEDGER_LIMITS.claims * LEDGER_LIMITS.evidenceRequirementsPerClaim,
    normalizeRequirement,
  );
  const nonGoals = normalizeArray(input.nonGoals, 'ledger.nonGoals', LEDGER_LIMITS.nonGoals, (item, path) => normalizeString(item, path));
  uniqueBy(constraints, 'constraintId', 'ledger.constraints');
  uniqueBy(authorizations, 'authorizationId', 'ledger.authorizations');
  uniqueBy(claims, 'claimId', 'ledger.claims');
  const requirementIds = uniqueBy(evidenceRequirements, 'requirementId', 'ledger.evidenceRequirements');

  let dependencyRefs = 0;
  for (const claim of claims) {
    dependencyRefs += claim.evidenceRequirementIds.length;
    if (new Set(claim.evidenceRequirementIds).size !== claim.evidenceRequirementIds.length) fail('DUPLICATE_ID', `${claim.claimId} repeats an evidence requirement.`);
    for (const requirementId of claim.evidenceRequirementIds) {
      if (!requirementIds.has(requirementId)) fail('MISSING_REFERENCE', `${claim.claimId} references missing requirement ${requirementId}.`);
    }
  }
  if (dependencyRefs > LEDGER_LIMITS.dependencyRefsTotal) fail('OVER_LIMIT', 'Ledger dependency refs exceed the total cap.');

  const createdAt = normalizeTimestamp(input.createdAt, 'ledger.createdAt');
  const expiresAt = normalizeTimestamp(input.expiresAt, 'ledger.expiresAt');
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(expiresAt);
  const lifetimeSeconds = (expiresMs - createdMs) / 1000;
  if (lifetimeSeconds <= 0 || lifetimeSeconds > LEDGER_LIMITS.maximumLifetimeSeconds) fail('OVER_LIMIT', 'Ledger lifetime is outside its bounds.');
  for (const authorization of authorizations) {
    if (Date.parse(authorization.expiresAt) > expiresMs) fail('OVER_LIMIT', `${authorization.authorizationId} outlives the ledger.`);
  }

  const status = normalizeString(input.status, 'ledger.status', { maxBytes: 16 });
  if (!LEDGER_STATUSES.has(status)) fail('INVALID_VALUE', 'ledger.status is unsupported.');
  if (creation && status !== 'OPEN') fail('INVALID_VALUE', 'A new ledger must be OPEN.');

  const output = {
    schemaVersion: SCHEMA_VERSION,
    goalId: normalizeId(input.goalId, 'ledger.goalId'),
    tenantId: normalizeId(input.tenantId, 'ledger.tenantId'),
    revision,
    parentDigest: input.parentDigest,
    objective: normalizeString(input.objective, 'ledger.objective', { maxBytes: LEDGER_LIMITS.objectiveUtf8Bytes }),
    scope: normalizeScope(input.scope, 'ledger.scope'),
    constraints,
    authorizations,
    claims,
    evidenceRequirements,
    nonGoals,
    status,
    createdAt,
    expiresAt,
  };
  const bytes = new TextEncoder().encode(canonicalJson(output)).length;
  if (bytes > LEDGER_LIMITS.ledgerTokenBytes) fail('OVER_LIMIT', 'Canonical ledger exceeds the token-size cap.');
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export function canonicalJson(value) {
  const active = new WeakSet();
  function encode(item, path) {
    if (item === null) return 'null';
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} must be a safe integer.`);
      return String(item);
    }
    if (typeof item === 'string') return JSON.stringify(item.normalize('NFC'));
    if (!item || typeof item !== 'object') fail('UNSUPPORTED_CANONICAL_VALUE', `${path} has an unsupported canonical value.`);
    if (active.has(item)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} contains a cycle.`);
    active.add(item);
    let encoded;
    if (Array.isArray(item)) encoded = `[${item.map((child, index) => encode(child, `${path}[${index}]`)).join(',')}]`;
    else {
      if (!isPlainObject(item)) fail('UNSUPPORTED_CANONICAL_VALUE', `${path} must be a plain object.`);
      const keys = Object.keys(item);
      for (const key of keys) if (!/^[\x20-\x7e]+$/.test(key)) fail('INVALID_CANONICAL_KEY', `${path} contains a non-ASCII key.`);
      keys.sort((a, b) => {
        const left = new TextEncoder().encode(a);
        const right = new TextEncoder().encode(b);
        const length = Math.min(left.length, right.length);
        for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
        return left.length - right.length;
      });
      encoded = `{${keys.map((key) => `${JSON.stringify(key)}:${encode(item[key], `${path}.${key}`)}`).join(',')}}`;
    }
    active.delete(item);
    return encoded;
  }
  return encode(value, '$');
}

export async function digestCanonical(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `${DIGEST_PREFIX}${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function attachDigest(normalized) {
  const ledgerDigest = await digestCanonical(normalized);
  return deepFreeze({ ...normalized, ledgerDigest });
}

function assertNowWithinLedger(ledger, now, { allowAtExpiry = false } = {}) {
  const nowValue = normalizeTimestamp(now, 'options.now');
  const nowMs = Date.parse(nowValue);
  const expiresMs = Date.parse(ledger.expiresAt);
  if (nowMs > expiresMs || (!allowAtExpiry && nowMs === expiresMs)) fail('LEDGER_EXPIRED', 'The ledger has expired.');
  return nowValue;
}

export async function createLedger(input, options = {}) {
  const normalized = normalizeLedgerShape(input, { creation: true });
  assertNowWithinLedger(normalized, options.now);
  if (normalized.authorizations.length && options.authoritySource !== 'USER') {
    fail('UNTRUSTED_INTENT_SOURCE', 'Only a trusted user source can create authorization.');
  }
  return await attachDigest(normalized);
}

export async function validateLedger(input, options = {}) {
  assertPlainObject(input, 'ledger');
  if (!SHA256_HEX.test(input.ledgerDigest || '')) fail('INVALID_DIGEST', 'ledger.ledgerDigest is invalid.');
  const normalized = normalizeLedgerShape(input, { creation: input.revision === 1 });
  if (options.now !== undefined && !TERMINAL_STATUSES.has(normalized.status)) assertNowWithinLedger(normalized, options.now);
  const expected = await digestCanonical(normalized);
  if (expected !== input.ledgerDigest) fail('INVALID_DIGEST', 'ledger.ledgerDigest does not match canonical content.');
  return deepFreeze({ ...normalized, ledgerDigest: expected });
}

function validateHeadRequest(current, request, allowedFields) {
  assertAllowedFields(request, allowedFields, 'request');
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) fail('INVALID_VALUE', 'request.expectedRevision is invalid.');
  if (!SHA256_HEX.test(request.expectedDigest || '')) fail('INVALID_DIGEST', 'request.expectedDigest is invalid.');
  if (request.expectedRevision < current.revision) fail('STALE_REVISION', 'The submitted revision is stale.');
  if (request.expectedRevision > current.revision) fail('FORKED_REVISION', 'The submitted revision is ahead of the current head.');
  if (request.expectedDigest !== current.ledgerDigest) fail('FORKED_REVISION', 'The submitted digest does not match the current head.');
  if (TERMINAL_STATUSES.has(current.status)) fail('TERMINAL_LEDGER', 'A terminal ledger cannot be revised.');
}

function authorizationBroadens(previous, next) {
  const prior = new Map(previous.map((item) => [item.authorizationId, item]));
  for (const authorization of next) {
    const existing = prior.get(authorization.authorizationId);
    if (!existing) return true;
    if (authorization.operationClass !== existing.operationClass || authorization.scopeId !== existing.scopeId) return true;
    if (Date.parse(authorization.expiresAt) > Date.parse(existing.expiresAt)) return true;
  }
  return false;
}

export async function reviseLedger(input, request, options = {}) {
  const current = await validateLedger(input);
  validateHeadRequest(current, request, REVISION_FIELDS);
  assertAllowedFields(request.changes, CHANGE_FIELDS, 'request.changes');
  if (!Object.keys(request.changes).length) fail('INVALID_VALUE', 'request.changes must not be empty.');
  if (request.freshUserAuthorization !== undefined && typeof request.freshUserAuthorization !== 'boolean') {
    fail('INVALID_TYPE', 'request.freshUserAuthorization must be boolean.');
  }

  const base = withoutDigest(current);
  const candidate = {
    ...base,
    ...request.changes,
    revision: current.revision + 1,
    parentDigest: current.ledgerDigest,
    status: 'OPEN',
  };
  if (candidate.revision > LEDGER_LIMITS.maximumRevision) fail('OVER_LIMIT', 'Ledger revision exceeds its cap.');
  const normalized = normalizeLedgerShape(candidate);
  assertNowWithinLedger(normalized, options.now);

  if (authorizationBroadens(current.authorizations, normalized.authorizations)) {
    if (request.freshUserAuthorization !== true) fail('IMPLICIT_AUTHORITY_BROADENING', 'Authorization cannot broaden implicitly.');
    if (options.authoritySource !== 'USER') fail('UNTRUSTED_INTENT_SOURCE', 'Fresh authorization must come from the user.');
  }
  return attachDigest(normalized);
}

async function terminalTransition(input, request, options, status) {
  const current = await validateLedger(input);
  validateHeadRequest(current, request, TERMINAL_REQUEST_FIELDS);
  const normalizedNow = normalizeTimestamp(options.now, 'options.now');
  if (status === 'EXPIRED' && Date.parse(normalizedNow) < Date.parse(current.expiresAt)) fail('NOT_EXPIRED', 'The ledger has not reached its expiry.');
  const candidate = {
    ...withoutDigest(current),
    revision: current.revision + 1,
    parentDigest: current.ledgerDigest,
    status,
  };
  if (candidate.revision > LEDGER_LIMITS.maximumRevision) fail('OVER_LIMIT', 'Ledger revision exceeds its cap.');
  return attachDigest(normalizeLedgerShape(candidate));
}

export function cancelLedger(input, request, options = {}) {
  return terminalTransition(input, request, options, 'CANCELLED');
}

export function expireLedger(input, request, options = {}) {
  return terminalTransition(input, request, options, 'EXPIRED');
}

export function inspectLedger(ledger) {
  assertPlainObject(ledger, 'ledger');
  if (!SHA256_HEX.test(ledger.ledgerDigest || '')) fail('INVALID_DIGEST', 'ledger.ledgerDigest is invalid.');
  return deepFreeze({
    goalId: ledger.goalId,
    tenantId: ledger.tenantId,
    revision: ledger.revision,
    status: ledger.status,
    scopeKind: ledger.scope?.kind,
    constraintCount: Array.isArray(ledger.constraints) ? ledger.constraints.length : 0,
    authorizationCount: Array.isArray(ledger.authorizations) ? ledger.authorizations.length : 0,
    claimCount: Array.isArray(ledger.claims) ? ledger.claims.length : 0,
    evidenceRequirementCount: Array.isArray(ledger.evidenceRequirements) ? ledger.evidenceRequirements.length : 0,
    nonGoalCount: Array.isArray(ledger.nonGoals) ? ledger.nonGoals.length : 0,
    createdAt: ledger.createdAt,
    expiresAt: ledger.expiresAt,
    ledgerDigest: ledger.ledgerDigest,
  });
}
