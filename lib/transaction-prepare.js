// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-prepare — prepare — Shared pure module.
// @context: Shared pure module, server and extension.
// @state: feat(ut): event-triggered workflows + universal one-hop gateway (1.6.6).
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: goal-ledger.

import { canonicalJson, digestCanonical } from './goal-ledger.js';

const TRANSACTION_VERSION = 'OA_TRANSACTION_V1';
const PROVENANCE_VERSION = 'OA_ACTION_PROVENANCE_V1';
const DELTA_VERSION = 'OA_SEMANTIC_DEPENDENCY_DELTA_V1';
const HASH = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SECRET_FIELD = /(?:password|passcode|pin|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|cvc|security.?code|payment.?data|pairing.?code|signing.?key)/i;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;

const EFFECT_CLASSES = new Set(['LOCAL_REVERSIBLE', 'STAGED_EXTERNAL', 'COMPENSABLE_EXTERNAL', 'IRREVERSIBLE_OR_UNKNOWN']);
const METHODS = Object.freeze([
  'tabs.open', 'tabs.activate', 'tabs.close', 'tabs.navigate', 'tabs.reload',
  'page.click', 'page.pointer', 'page.fill', 'page.focus', 'page.scroll', 'page.key',
  'media.play', 'media.pause', 'media.seek',
]);
const METHOD_SET = new Set(METHODS);
const PREDICATE_KINDS = new Set([
  'AUTHORITY', 'USER_IDENTITY', 'OAUTH_CLIENT_IDENTITY', 'GOAL_REVISION', 'TARGET',
  'DOCUMENT_GENERATION', 'ACTION', 'OPERAND', 'EFFECT_CLASS', 'ENFORCEMENT_MODE',
  'APPROVAL', 'SENSITIVE_POLICY', 'POSTCONDITION',
]);
const ALWAYS_REVALIDATE = new Set([
  'AUTHORITY', 'USER_IDENTITY', 'OAUTH_CLIENT_IDENTITY', 'GOAL_REVISION', 'TARGET',
  'DOCUMENT_GENERATION', 'ACTION', 'EFFECT_CLASS', 'ENFORCEMENT_MODE', 'APPROVAL',
  'SENSITIVE_POLICY',
]);
const SOURCE_KINDS = new Set([
  'USER_EXPLICIT', 'LEDGER_AUTHORITY', 'TRUSTED_POLICY', 'SERVER_DERIVED',
  'BROWSER_OBSERVED', 'TOOL_OBSERVED', 'MODEL_DERIVED',
]);
const AUTHORITY_ROLES = new Set(['AUTHORITY', 'OPERAND', 'EVIDENCE', 'DISPLAY_ONLY']);
const FRESHNESS_CLASSES = new Set(['CURRENT', 'BOUNDED_RECENT', 'STATIC_TRUSTED', 'STALE', 'UNKNOWN']);
const TRANSFORMS = new Set([
  'IDENTITY', 'NORMALIZE_NFC', 'TRIM', 'LOWERCASE_ASCII', 'INTEGER_PARSE',
  'DECIMAL_TO_MINOR_UNITS', 'SELECT_FIELD', 'CONCAT_BOUNDED',
]);
const ENFORCEMENT_MODES = new Set(['OFF', 'DARK', 'ENFORCED']);
const INCOMPLETE_COVERAGE = new Set(['INCOMPLETE', 'AMBIGUOUS', 'RESET', 'UNAVAILABLE', 'STALE']);
const OBSERVATION_TOOLS = new Set(['browser_status', 'list_tabs', 'read_page', 'capture_page', 'find_elements', 'run_workflow', 'start_watch', 'wait_events', 'stop_watch']); // U-T: watch tools are observation-class (arming/waiting/stopping triggers mutates nothing on the page)
const MUTATION_TOOLS = new Set([
  'open_url', 'activate_tab', 'navigate_tab', 'close_tab', 'click_element',
  'fill_element', 'press_key', 'scroll_page', 'move_pointer', 'click_at',
  'drag_pointer', 'wheel_at',
]);
const ALL_TOOLS = new Set([...OBSERVATION_TOOLS, ...MUTATION_TOOLS, 'run_browser_burst']);
const OBSERVATION_BURST_ACTIONS = new Set(['read', 'find', 'wait']);

export const TRANSACTION_8B_LIMITS = Object.freeze({
  serializedProposalBytes: 65536,
  preparedTransactionBytes: 131072,
  receiptBytes: 65536,
  stateChangingActionsPerTransaction: 1,
  consequentialActionsPerTransaction: 1,
  irreversibleOrUnknownActionsPerTransaction: 1,
  decisionPredicates: 64,
  provenanceRecords: 128,
  transformChainDepth: 8,
  expectedPostconditions: 64,
  approvalPreviewBytes: 16384,
  approvalMrtrRounds: 1,
  prepareLifetimeMs: 600000,
  approvalLifetimeMs: 120000,
  approvalToDispatchMs: 15000,
  finalValidationToDispatchMs: 5000,
  commitCommandTimeoutMs: 30000,
  postCommitObservationAttempts: 3,
  postCommitObserveVerifyMs: 30000,
  concurrentCommitPerTargetTab: 1,
  concurrentCommittingPerTenant: 2,
  pendingPerTenant: 8,
  prepareRatePerTenantPerMinute: 20,
  commitRatePerTenantPerMinute: 10,
  totalTransactionLifetimeMs: 600000,
  activeCompensationsPerOriginal: 1,
  nonterminalRetentionHours: 24,
  terminalRetentionDays: 7,
});

export class TransactionPrepareError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TransactionPrepareError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new TransactionPrepareError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional, path, code = 'INVALID_SCHEMA') {
  if (!isPlainObject(value)) fail(code, `${path} must be a plain object.`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, `${path}.${key} is not allowed.`);
  for (const key of required) if (!(key in value)) fail(code, `${path}.${key} is required.`);
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertNoSensitive(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains a secret-like value.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('INVALID_SCHEMA', `${path} contains a cycle.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (!Array.isArray(value) && SECRET_FIELD.test(key)) fail('SENSITIVE_VALUE', `${path}.${key} is forbidden.`);
    assertNoSensitive(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function assertId(value, path) {
  if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_SCHEMA', `${path} is invalid.`);
}

function assertDigest(value, path, code = 'INVALID_SCHEMA') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code, `${path} is not a SHA-256 digest.`);
}

function assertInteger(value, path, minimum, maximum, code = 'INVALID_SCHEMA') {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code, `${path} is outside its bound.`);
}

function normalizeTimestamp(value, path) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_SCHEMA', `${path} must be an RFC3339 UTC timestamp.`);
  }
  return value;
}

function cloneCanonical(value) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (error) {
    if (error instanceof TransactionPrepareError) throw error;
    fail('INVALID_SCHEMA', 'Candidate must be acyclic canonical JSON data.');
  }
}

function normalizeTarget(value) {
  exactKeys(value, ['deviceId', 'tabId', 'targetDigest'], ['documentGeneration'], 'candidate.target');
  assertId(value.deviceId, 'candidate.target.deviceId');
  assertInteger(value.tabId, 'candidate.target.tabId', 0, Number.MAX_SAFE_INTEGER);
  assertDigest(value.targetDigest, 'candidate.target.targetDigest');
  if (value.documentGeneration !== undefined) assertId(value.documentGeneration, 'candidate.target.documentGeneration');
  return cloneCanonical(value);
}

function normalizeAction(value) {
  exactKeys(value, ['descriptorId', 'method', 'argumentsDigest', 'actionDigest'], [], 'candidate.action', 'INVALID_ACTION');
  assertId(value.descriptorId, 'candidate.action.descriptorId');
  if (!METHOD_SET.has(value.method)) fail('INVALID_ACTION', 'candidate.action.method is not transaction allowlisted.');
  assertDigest(value.argumentsDigest, 'candidate.action.argumentsDigest', 'INVALID_ACTION');
  assertDigest(value.actionDigest, 'candidate.action.actionDigest', 'INVALID_ACTION');
  return cloneCanonical(value);
}

function normalizePredicates(values) {
  if (!Array.isArray(values)) fail('INVALID_SCHEMA', 'candidate.decisionPredicates must be an array.');
  if (values.length > TRANSACTION_8B_LIMITS.decisionPredicates) fail('OVER_LIMIT', 'Too many decision predicates.');
  const ids = new Set();
  return values.map((value, index) => {
    const path = `candidate.decisionPredicates[${index}]`;
    exactKeys(value, ['predicateId', 'kind', 'dependencyDigests'], [], path, 'INVALID_PREDICATE');
    assertId(value.predicateId, `${path}.predicateId`);
    if (ids.has(value.predicateId)) fail('DUPLICATE_ID', `Duplicate predicate ${value.predicateId}.`);
    ids.add(value.predicateId);
    if (!PREDICATE_KINDS.has(value.kind)) fail('INVALID_PREDICATE', `${path}.kind is unknown.`);
    if (!Array.isArray(value.dependencyDigests) || value.dependencyDigests.length > 16) fail('INVALID_PREDICATE', `${path}.dependencyDigests is invalid.`);
    const dependencies = new Set();
    for (const digest of value.dependencyDigests) {
      assertDigest(digest, `${path}.dependencyDigests`, 'INVALID_PREDICATE');
      if (dependencies.has(digest)) fail('DUPLICATE_ID', `${path} contains duplicate dependency digest.`);
      dependencies.add(digest);
    }
    return { predicateId: value.predicateId, kind: value.kind, dependencyDigests: [...value.dependencyDigests] };
  });
}

function normalizeProvenance(values) {
  if (!Array.isArray(values) || values.length < 1) fail('INVALID_PROVENANCE', 'candidate.provenance must not be empty.');
  if (values.length > TRANSACTION_8B_LIMITS.provenanceRecords) fail('OVER_LIMIT', 'Too many provenance records.');
  const ids = new Set();
  const required = ['schemaVersion', 'provenanceId', 'sourceKind', 'sourceDigest', 'authorityRole', 'tenantId', 'goalRevision', 'freshnessClass', 'transformChain', 'valueDigest'];
  const optional = ['deviceId', 'tabId', 'documentGeneration', 'observedAt', 'sourceRevision'];
  return values.map((value, index) => {
    const path = `candidate.provenance[${index}]`;
    exactKeys(value, required, optional, path, 'INVALID_PROVENANCE');
    if (value.schemaVersion !== PROVENANCE_VERSION) fail('INVALID_PROVENANCE', `${path}.schemaVersion is invalid.`);
    assertId(value.provenanceId, `${path}.provenanceId`);
    if (ids.has(value.provenanceId)) fail('DUPLICATE_ID', `Duplicate provenance ${value.provenanceId}.`);
    ids.add(value.provenanceId);
    if (!SOURCE_KINDS.has(value.sourceKind) || !AUTHORITY_ROLES.has(value.authorityRole) || !FRESHNESS_CLASSES.has(value.freshnessClass)) fail('INVALID_PROVENANCE', `${path} contains an unknown vocabulary value.`);
    assertDigest(value.sourceDigest, `${path}.sourceDigest`, 'INVALID_PROVENANCE');
    assertDigest(value.valueDigest, `${path}.valueDigest`, 'INVALID_PROVENANCE');
    assertId(value.tenantId, `${path}.tenantId`);
    assertInteger(value.goalRevision, `${path}.goalRevision`, 1, Number.MAX_SAFE_INTEGER, 'INVALID_PROVENANCE');
    if (!Array.isArray(value.transformChain) || value.transformChain.length > TRANSACTION_8B_LIMITS.transformChainDepth || value.transformChain.some((step) => !TRANSFORMS.has(step))) fail('INVALID_TRANSFORM', `${path}.transformChain is invalid.`);
    if (value.deviceId !== undefined) assertId(value.deviceId, `${path}.deviceId`);
    if (value.tabId !== undefined) assertInteger(value.tabId, `${path}.tabId`, 0, Number.MAX_SAFE_INTEGER, 'INVALID_PROVENANCE');
    if (value.documentGeneration !== undefined) assertId(value.documentGeneration, `${path}.documentGeneration`);
    if (value.observedAt !== undefined) normalizeTimestamp(value.observedAt, `${path}.observedAt`);
    if (value.sourceRevision !== undefined && (typeof value.sourceRevision !== 'string' || byteLength(value.sourceRevision) > 128)) fail('INVALID_PROVENANCE', `${path}.sourceRevision is invalid.`);
    return cloneCanonical(value);
  });
}

function normalizeBudgets(value) {
  const keys = Object.keys(TRANSACTION_8B_LIMITS);
  exactKeys(value, keys, [], 'candidate.budgets');
  for (const [key, maximum] of Object.entries(TRANSACTION_8B_LIMITS)) {
    assertInteger(value[key], `candidate.budgets.${key}`, 1, maximum, 'OVER_LIMIT');
  }
  for (const key of [
    'stateChangingActionsPerTransaction', 'consequentialActionsPerTransaction',
    'irreversibleOrUnknownActionsPerTransaction', 'approvalMrtrRounds',
    'concurrentCommitPerTargetTab', 'activeCompensationsPerOriginal',
  ]) if (value[key] !== 1) fail('OVER_LIMIT', `candidate.budgets.${key} must equal one.`);
  return cloneCanonical(value);
}

function normalizeCandidate(input) {
  if (isPlainObject(input) && 'actions' in input) fail('MULTI_ACTION_FORBIDDEN', 'V1 accepts one singular action only.');
  assertNoSensitive(input);
  const required = ['schemaVersion', 'transactionId', 'tenantId', 'goalId', 'goalRevision', 'target', 'effectClass', 'decisionPredicates', 'action', 'provenance', 'expectedPostconditions', 'budgets', 'enforcementMode', 'preparedAt', 'expiresAt'];
  const optional = ['programDigest', 'vmRunId', 'compensationDescriptorDigest', 'compensatesTransactionId'];
  exactKeys(input, required, optional, 'candidate');
  if (input.schemaVersion !== TRANSACTION_VERSION) fail('INVALID_SCHEMA', 'candidate.schemaVersion is invalid.');
  const proposalCanonical = canonicalJson(input);
  if (byteLength(proposalCanonical) > TRANSACTION_8B_LIMITS.serializedProposalBytes) fail('OVER_LIMIT', 'Candidate exceeds the proposal-size cap.');
  for (const key of ['transactionId', 'tenantId', 'goalId']) assertId(input[key], `candidate.${key}`);
  assertInteger(input.goalRevision, 'candidate.goalRevision', 1, Number.MAX_SAFE_INTEGER);
  for (const key of ['programDigest', 'compensationDescriptorDigest']) if (input[key] !== undefined) assertDigest(input[key], `candidate.${key}`);
  for (const key of ['vmRunId', 'compensatesTransactionId']) if (input[key] !== undefined) assertId(input[key], `candidate.${key}`);
  const action = normalizeAction(input.action);
  const classified = classifyTransactionEffect(action);
  if (!EFFECT_CLASSES.has(input.effectClass)) fail('INVALID_CLASSIFICATION', 'candidate.effectClass is invalid.');
  if (input.effectClass !== classified) fail('EFFECT_CLASS_MISMATCH', 'Client effect class cannot downgrade trusted classification.');
  if (!ENFORCEMENT_MODES.has(input.enforcementMode)) fail('INVALID_CLASSIFICATION', 'candidate.enforcementMode is invalid.');
  const preparedAt = normalizeTimestamp(input.preparedAt, 'candidate.preparedAt');
  const expiresAt = normalizeTimestamp(input.expiresAt, 'candidate.expiresAt');
  const lifetime = Date.parse(expiresAt) - Date.parse(preparedAt);
  if (lifetime <= 0 || lifetime > TRANSACTION_8B_LIMITS.prepareLifetimeMs) fail('OVER_LIMIT', 'Prepare lifetime is invalid.');
  const expectedPostconditions = input.expectedPostconditions;
  if (!Array.isArray(expectedPostconditions)) fail('INVALID_POSTCONDITION', 'candidate.expectedPostconditions must be an array.');
  if (expectedPostconditions.length > TRANSACTION_8B_LIMITS.expectedPostconditions) fail('OVER_LIMIT', 'Too many expected postconditions.');
  expectedPostconditions.forEach((value, index) => assertDigest(value, `candidate.expectedPostconditions[${index}]`, 'INVALID_POSTCONDITION'));
  const budgets = normalizeBudgets(input.budgets);
  const declaredLifetime = Math.min(budgets.prepareLifetimeMs, budgets.totalTransactionLifetimeMs);
  if (lifetime > declaredLifetime) fail('OVER_LIMIT', 'Prepare lifetime exceeds its declared temporal budget.');
  if (byteLength(proposalCanonical) > budgets.serializedProposalBytes) fail('OVER_LIMIT', 'Candidate exceeds its declared proposal budget.');
  const normalized = {
    schemaVersion: TRANSACTION_VERSION,
    transactionId: input.transactionId,
    tenantId: input.tenantId,
    goalId: input.goalId,
    goalRevision: input.goalRevision,
  };
  for (const key of ['programDigest', 'vmRunId']) if (input[key] !== undefined) normalized[key] = input[key];
  normalized.target = normalizeTarget(input.target);
  normalized.effectClass = input.effectClass;
  normalized.decisionPredicates = normalizePredicates(input.decisionPredicates);
  normalized.action = action;
  normalized.provenance = normalizeProvenance(input.provenance);
  normalized.expectedPostconditions = [...expectedPostconditions];
  for (const key of ['compensationDescriptorDigest', 'compensatesTransactionId']) if (input[key] !== undefined) normalized[key] = input[key];
  normalized.budgets = budgets;
  normalized.enforcementMode = input.enforcementMode;
  normalized.preparedAt = preparedAt;
  normalized.expiresAt = expiresAt;
  return normalized;
}

export function classifyTransactionEffect(action) {
  if (!isPlainObject(action) || typeof action.method !== 'string' || !METHOD_SET.has(action.method)) {
    fail('INVALID_ACTION', 'Unknown transaction action method.');
  }
  return 'IRREVERSIBLE_OR_UNKNOWN';
}

export async function prepareTransaction(input) {
  const normalized = normalizeCandidate(input);
  const prepareDigest = await digestCanonical(normalized);
  const prepared = { ...normalized, prepareDigest };
  const preparedBytes = byteLength(canonicalJson(prepared));
  if (preparedBytes > TRANSACTION_8B_LIMITS.preparedTransactionBytes || preparedBytes > prepared.budgets.preparedTransactionBytes) fail('OVER_LIMIT', 'Prepared transaction exceeds its byte cap.');
  return deepFreeze(prepared);
}

export async function validatePreparedTransaction(input) {
  if (!isPlainObject(input)) fail('INVALID_SCHEMA', 'Prepared transaction must be an object.');
  exactKeys(input,
    ['schemaVersion', 'transactionId', 'tenantId', 'goalId', 'goalRevision', 'target', 'effectClass', 'decisionPredicates', 'action', 'provenance', 'expectedPostconditions', 'budgets', 'enforcementMode', 'preparedAt', 'expiresAt', 'prepareDigest'],
    ['programDigest', 'vmRunId', 'compensationDescriptorDigest', 'compensatesTransactionId'],
    'transaction');
  assertDigest(input.prepareDigest, 'transaction.prepareDigest', 'PREPARE_DIGEST_MISMATCH');
  const candidate = cloneCanonical(input);
  delete candidate.prepareDigest;
  const prepared = await prepareTransaction(candidate);
  if (prepared.prepareDigest !== input.prepareDigest) fail('PREPARE_DIGEST_MISMATCH', 'Prepared transaction digest does not match.');
  return prepared;
}

export async function compileDecisionPredicates(values) {
  const normalized = normalizePredicates(values);
  const compiled = [];
  for (const predicate of normalized) {
    const dependencyDigests = [...predicate.dependencyDigests].sort();
    compiled.push({
      predicateId: predicate.predicateId,
      kind: predicate.kind,
      dependencyDigests,
      dependencyFingerprint: await digestCanonical({ kind: predicate.kind, dependencyDigests }),
    });
  }
  compiled.sort((left, right) => (left.predicateId < right.predicateId ? -1 : left.predicateId > right.predicateId ? 1 : 0));
  return deepFreeze(compiled);
}

export function planPredicateRevalidation(compiledPredicates, delta) {
  if (!Array.isArray(compiledPredicates) || compiledPredicates.length > TRANSACTION_8B_LIMITS.decisionPredicates) fail('INVALID_PREDICATE', 'Compiled predicates are invalid.');
  exactKeys(delta, ['schemaVersion', 'coverage', 'changedDependencyDigests'], [], 'delta', 'INVALID_DELTA');
  if (delta.schemaVersion !== DELTA_VERSION || (delta.coverage !== 'COMPLETE' && !INCOMPLETE_COVERAGE.has(delta.coverage))) fail('INVALID_DELTA', 'Delta coverage is invalid.');
  if (!Array.isArray(delta.changedDependencyDigests) || delta.changedDependencyDigests.length > TRANSACTION_8B_LIMITS.decisionPredicates * 16) fail('INVALID_DELTA', 'Delta dependencies are invalid.');
  const changed = new Set();
  for (const value of delta.changedDependencyDigests) {
    assertDigest(value, 'delta.changedDependencyDigests', 'INVALID_DELTA');
    if (changed.has(value)) fail('DUPLICATE_ID', 'Delta contains a duplicate dependency digest.');
    changed.add(value);
  }
  const full = delta.coverage !== 'COMPLETE';
  const predicateIds = [];
  for (const predicate of compiledPredicates) {
    exactKeys(predicate, ['predicateId', 'kind', 'dependencyDigests', 'dependencyFingerprint'], [], 'compiledPredicate', 'INVALID_PREDICATE');
    assertId(predicate.predicateId, 'compiledPredicate.predicateId');
    if (!PREDICATE_KINDS.has(predicate.kind) || !Array.isArray(predicate.dependencyDigests)) fail('INVALID_PREDICATE', 'Compiled predicate is invalid.');
    const revalidate = full || ALWAYS_REVALIDATE.has(predicate.kind) || predicate.dependencyDigests.length === 0 || predicate.dependencyDigests.some((value) => changed.has(value));
    if (revalidate) predicateIds.push(predicate.predicateId);
  }
  return deepFreeze({
    schemaVersion: 'OA_REVALIDATION_PLAN_8B_V1',
    coverage: delta.coverage,
    failClosed: full,
    reason: full ? 'DEPENDENCY_COVERAGE_NOT_COMPLETE' : 'SELECTIVE_WITH_AUTHORITY_FENCES',
    predicateIds,
  });
}

function trustedExecutor(context) {
  const authority = context?.internalExecutorAuthority;
  return isPlainObject(authority)
    && authority.serverDerived === true
    && authority.transactionBound === true
    && authority.clientSupplied === false
    && authority.validated === true;
}

export function decideTransactionEnforcement(request, trustedContext = undefined) {
  if (!isPlainObject(request) || !ALL_TOOLS.has(request.tool)) return 'FAIL_CLOSED';
  if (!ENFORCEMENT_MODES.has(request.mode)) return 'FAIL_CLOSED';
  let mutating = MUTATION_TOOLS.has(request.tool);
  if (request.tool === 'run_browser_burst') {
    if (request.burstActions === undefined) mutating = true;
    else if (!Array.isArray(request.burstActions) || request.burstActions.length < 1 || request.burstActions.length > 8 || request.burstActions.some((item) => typeof item !== 'string')) return 'FAIL_CLOSED';
    else mutating = request.burstActions.some((item) => !OBSERVATION_BURST_ACTIONS.has(item));
  }
  if (request.mode === 'ENFORCED' && mutating && !trustedExecutor(trustedContext)) return 'TRANSACTION_REQUIRED';
  return 'ALLOW';
}

export function decideTransactionCommitAvailability(mode) {
  if (!ENFORCEMENT_MODES.has(mode)) return 'FAIL_CLOSED';
  return mode === 'ENFORCED' ? 'ALLOW' : 'TRANSACTION_UNAVAILABLE';
}

export async function createTransactionPreview(preparedInput) {
  const prepared = await validatePreparedTransaction(preparedInput);
  const preview = {
    schemaVersion: 'OA_TRANSACTION_PREVIEW_8B_V1',
    transactionId: prepared.transactionId,
    goalId: prepared.goalId,
    goalRevision: prepared.goalRevision,
    target: prepared.target,
    effectClass: prepared.effectClass,
    action: prepared.action,
    expectedPostconditionDigests: prepared.expectedPostconditions,
    provenanceValueDigests: prepared.provenance.map((item) => item.valueDigest),
    prepareDigest: prepared.prepareDigest,
    expiresAt: prepared.expiresAt,
  };
  const previewDigest = await digestCanonical(preview);
  const result = { ...preview, previewDigest };
  if (byteLength(canonicalJson(result)) > prepared.budgets.approvalPreviewBytes || byteLength(canonicalJson(result)) > TRANSACTION_8B_LIMITS.approvalPreviewBytes) fail('OVER_LIMIT', 'Approval preview exceeds its byte cap.');
  return deepFreeze(result);
}
