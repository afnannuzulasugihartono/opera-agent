// @last-edited: 2026-10-04 11:10 UTC.
// @title: transaction-authority — authority — Shared pure module.
// @context: Shared pure module, server and extension.
// @state: enforce transaction approval lifetime budgets.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: goal-ledger, transaction-prepare.

import { canonicalJson, digestCanonical } from './goal-ledger.js';
import {
  TRANSACTION_8B_LIMITS,
  createTransactionPreview,
  validatePreparedTransaction,
} from './transaction-prepare.js';

const HASH = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SECRET_FIELD = /(?:password|passcode|pin|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|cvc|security.?code|payment.?data|pairing.?code|signing.?key)/i;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;
const SOURCE_KINDS = new Set(['USER_EXPLICIT', 'LEDGER_AUTHORITY', 'TRUSTED_POLICY', 'SERVER_DERIVED', 'BROWSER_OBSERVED', 'TOOL_OBSERVED', 'MODEL_DERIVED']);
const AUTHORITY_SOURCES = new Set(['USER_EXPLICIT', 'LEDGER_AUTHORITY', 'TRUSTED_POLICY']);
const OBSERVED_SOURCES = new Set(['BROWSER_OBSERVED', 'TOOL_OBSERVED']);
const ROLES = new Set(['AUTHORITY', 'OPERAND', 'EVIDENCE', 'DISPLAY_ONLY']);
const FRESHNESS = new Set(['CURRENT', 'BOUNDED_RECENT', 'STATIC_TRUSTED', 'STALE', 'UNKNOWN']);
const TRANSFORMS = new Set(['IDENTITY', 'NORMALIZE_NFC', 'TRIM', 'LOWERCASE_ASCII', 'INTEGER_PARSE', 'DECIMAL_TO_MINOR_UNITS', 'SELECT_FIELD', 'CONCAT_BOUNDED']);
const ERAS = new Set(['MCP_2026_07_28', 'MCP_2025_LEGACY']);
const EFFECT_CLASSES = new Set(['LOCAL_REVERSIBLE', 'STAGED_EXTERNAL', 'COMPENSABLE_EXTERNAL', 'IRREVERSIBLE_OR_UNKNOWN']);
const APPROVAL_REQUIRED = ['schemaVersion', 'approvalChallengeId', 'authenticatedUserId', 'authenticatedOAuthClientId', 'tenantId', 'transactionId', 'goalRevision', 'prepareDigest', 'previewDigest', 'targetDigest', 'effectClass', 'nonceDigest', 'issuedAt', 'expiresAt', 'protocolEra', 'approvalDigest'];

export class TransactionAuthorityError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TransactionAuthorityError';
    this.code = code;
    this.transactionStateAdvanced = false;
    if (details !== undefined) Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new TransactionAuthorityError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional, path, code = 'INVALID_APPROVAL') {
  if (!isPlainObject(value)) fail(code, `${path} must be a plain object.`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, `${path}.${key} is not allowed.`);
  for (const key of required) if (!(key in value)) fail(code, `${path}.${key} is required.`);
}

function assertNoSensitive(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains secret-like material.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('INVALID_APPROVAL', `${path} contains a cycle.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (!Array.isArray(value) && SECRET_FIELD.test(key)) fail('SENSITIVE_VALUE', `${path}.${key} is forbidden.`);
    assertNoSensitive(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function assertId(value, path, code = 'INVALID_APPROVAL') {
  if (typeof value !== 'string' || !ID.test(value)) fail(code, `${path} is invalid.`);
}

function assertDigest(value, path, code = 'INVALID_APPROVAL') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code, `${path} is invalid.`);
}

function timestamp(value, path, code = 'INVALID_APPROVAL') {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) fail(code, `${path} must be an RFC3339 UTC timestamp.`);
  return Date.parse(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function canonicalClone(value) {
  try { return JSON.parse(canonicalJson(value)); }
  catch { fail('INVALID_APPROVAL', 'Value must be bounded canonical JSON.'); }
}

function validateProvenanceRecord(record, transaction, evaluatedAtMs, index) {
  const path = `transaction.provenance[${index}]`;
  exactKeys(record,
    ['schemaVersion', 'provenanceId', 'sourceKind', 'sourceDigest', 'authorityRole', 'tenantId', 'goalRevision', 'freshnessClass', 'transformChain', 'valueDigest'],
    ['deviceId', 'tabId', 'documentGeneration', 'observedAt', 'sourceRevision'], path, 'INVALID_PROVENANCE');
  if (record.schemaVersion !== 'OA_ACTION_PROVENANCE_V1' || !SOURCE_KINDS.has(record.sourceKind) || !ROLES.has(record.authorityRole) || !FRESHNESS.has(record.freshnessClass)) fail('INVALID_PROVENANCE', `${path} vocabulary is invalid.`);
  assertId(record.provenanceId, `${path}.provenanceId`, 'INVALID_PROVENANCE');
  assertDigest(record.sourceDigest, `${path}.sourceDigest`, 'INVALID_PROVENANCE');
  assertDigest(record.valueDigest, `${path}.valueDigest`, 'INVALID_PROVENANCE');
  if (record.tenantId !== transaction.tenantId || record.goalRevision !== transaction.goalRevision) fail('CROSS_AUTHORITY_BOUNDARY', `${path} crosses tenant or goal authority.`);
  if (record.authorityRole === 'AUTHORITY' && !AUTHORITY_SOURCES.has(record.sourceKind)) fail('UNTRUSTED_AUTHORITY', `${path} cannot grant authority.`);
  if (!Array.isArray(record.transformChain) || record.transformChain.length > TRANSACTION_8B_LIMITS.transformChainDepth || record.transformChain.some((step) => !TRANSFORMS.has(step))) fail('INVALID_TRANSFORM', `${path} transform chain is invalid.`);
  if (record.freshnessClass === 'STALE' || record.freshnessClass === 'UNKNOWN') fail('STALE_PROVENANCE', `${path} is not fresh enough for a transaction.`);
  if (record.freshnessClass === 'STATIC_TRUSTED' && !AUTHORITY_SOURCES.has(record.sourceKind) && record.sourceKind !== 'SERVER_DERIVED') fail('STALE_PROVENANCE', `${path} cannot claim static trust.`);
  if (record.sourceRevision !== undefined && (typeof record.sourceRevision !== 'string' || record.sourceRevision.length > 128)) fail('INVALID_PROVENANCE', `${path}.sourceRevision is invalid.`);
  if (record.deviceId !== undefined && record.deviceId !== transaction.target.deviceId) fail('CROSS_AUTHORITY_BOUNDARY', `${path}.deviceId crosses the exact browser target.`);
  if (record.tabId !== undefined && record.tabId !== transaction.target.tabId) fail('CROSS_AUTHORITY_BOUNDARY', `${path}.tabId crosses the exact browser target.`);
  if (record.documentGeneration !== undefined && record.documentGeneration !== transaction.target.documentGeneration) fail('CROSS_AUTHORITY_BOUNDARY', `${path}.documentGeneration crosses the exact browser target.`);
  if (record.observedAt !== undefined) {
    const observedAtMs = timestamp(record.observedAt, `${path}.observedAt`, 'INVALID_PROVENANCE');
    if (observedAtMs > evaluatedAtMs || evaluatedAtMs - observedAtMs > TRANSACTION_8B_LIMITS.prepareLifetimeMs) fail('STALE_PROVENANCE', `${path} observation is outside the freshness window.`);
  }
  if (OBSERVED_SOURCES.has(record.sourceKind)) {
    if (record.deviceId !== transaction.target.deviceId || record.tabId !== transaction.target.tabId || record.documentGeneration !== transaction.target.documentGeneration) fail('CROSS_AUTHORITY_BOUNDARY', `${path} crosses the exact browser target.`);
    if (record.observedAt === undefined) fail('INVALID_PROVENANCE', `${path}.observedAt is required for observed sources.`);
  }
}

export async function validateTransactionProvenance(transaction, context) {
  assertNoSensitive(transaction, 'transaction');
  exactKeys(context, ['evaluatedAt'], [], 'context', 'INVALID_PROVENANCE');
  const evaluatedAtMs = timestamp(context.evaluatedAt, 'context.evaluatedAt', 'INVALID_PROVENANCE');
  if (!isPlainObject(transaction) || !Array.isArray(transaction.provenance) || transaction.provenance.length < 1 || transaction.provenance.length > TRANSACTION_8B_LIMITS.provenanceRecords) fail('INVALID_PROVENANCE', 'Transaction provenance is absent or over limit.');
  const ids = new Set();
  for (const [index, record] of transaction.provenance.entries()) {
    validateProvenanceRecord(record, transaction, evaluatedAtMs, index);
    if (ids.has(record.provenanceId)) fail('DUPLICATE_ID', 'Provenance identity is duplicated.');
    ids.add(record.provenanceId);
  }
  const authorityProvenanceIds = transaction.provenance.filter((item) => item.authorityRole === 'AUTHORITY').map((item) => item.provenanceId).sort();
  if (authorityProvenanceIds.length < 1) fail('MISSING_AUTHORITY', 'At least one trusted authority record is required.');
  const operandProvenanceIds = transaction.provenance.filter((item) => item.authorityRole === 'OPERAND').map((item) => item.provenanceId).sort();
  const validated = await validatePreparedTransaction(transaction);
  const core = {
    schemaVersion: 'OA_PROVENANCE_VALIDATION_8C_V1', transactionId: validated.transactionId,
    prepareDigest: validated.prepareDigest, authorityProvenanceIds, operandProvenanceIds,
  };
  return freeze({ ...core, provenanceDigest: await digestCanonical({ transactionId: validated.transactionId, prepareDigest: validated.prepareDigest, provenance: validated.provenance }) });
}

function validateAuthenticatedContext(context) {
  exactKeys(context, ['userId', 'oauthClientId', 'authenticationKind'], [], 'authenticatedContext');
  assertId(context.userId, 'authenticatedContext.userId');
  assertId(context.oauthClientId, 'authenticatedContext.oauthClientId');
  if (context.authenticationKind !== 'OAUTH_USER') fail('APPROVAL_AUTHORITY_UNAVAILABLE', 'Only authenticated user OAuth context may request transaction approval.');
}

function validateApprovalShape(approval) {
  assertNoSensitive(approval, 'approval');
  exactKeys(approval, APPROVAL_REQUIRED, [], 'approval');
  if (approval.schemaVersion !== 'OA_APPROVAL_V1' || !ERAS.has(approval.protocolEra)) fail('INVALID_APPROVAL', 'Approval version or protocol era is invalid.');
  for (const key of ['approvalChallengeId', 'authenticatedUserId', 'authenticatedOAuthClientId', 'tenantId', 'transactionId']) assertId(approval[key], `approval.${key}`);
  for (const key of ['prepareDigest', 'previewDigest', 'targetDigest', 'nonceDigest', 'approvalDigest']) assertDigest(approval[key], `approval.${key}`);
  if (!Number.isSafeInteger(approval.goalRevision) || approval.goalRevision < 1 || !EFFECT_CLASSES.has(approval.effectClass)) fail('INVALID_APPROVAL', 'Approval goal revision or effect class is invalid.');
  timestamp(approval.issuedAt, 'approval.issuedAt');
  timestamp(approval.expiresAt, 'approval.expiresAt');
}

function validateApprovalInterval(approval, prepared, evaluatedAt = undefined) {
  const issuedAtMs = timestamp(approval.issuedAt, 'approval.issuedAt');
  const expiresAtMs = timestamp(approval.expiresAt, 'approval.expiresAt');
  const ttlLimit = Math.min(TRANSACTION_8B_LIMITS.approvalLifetimeMs, prepared.budgets.approvalLifetimeMs);
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > ttlLimit
      || issuedAtMs < Date.parse(prepared.preparedAt) || expiresAtMs > Date.parse(prepared.expiresAt)) {
    fail('APPROVAL_EXPIRED', 'Approval interval exceeds its temporal budget or prepared validity window.');
  }
  if (evaluatedAt !== undefined) {
    const nowMs = timestamp(evaluatedAt, 'input.evaluatedAt');
    if (nowMs < issuedAtMs || nowMs >= expiresAtMs) fail('APPROVAL_EXPIRED', 'Approval is outside its validity interval.');
  }
}

export async function createApprovalChallenge(input) {
  assertNoSensitive(input);
  if (!isPlainObject(input)) fail('INVALID_APPROVAL', 'Approval input must be a plain object.');
  for (const key of ['oauthConsent', 'approved', 'modelProse', 'pageText', 'clientInfo', 'mcpSessionId', 'jsonRpcRequestId']) if (key in input) fail('UNTRUSTED_APPROVAL_FIELD', `${key} is not transaction approval authority.`);
  exactKeys(input,
    ['prepared', 'preview', 'authenticatedContext', 'approvalChallengeId', 'nonceDigest', 'issuedAt', 'expiresAt', 'protocolEra'], [], 'input');
  validateAuthenticatedContext(input.authenticatedContext);
  const prepared = await validatePreparedTransaction(input.prepared);
  validateApprovalInterval(input, prepared);
  await validateTransactionProvenance(prepared, { evaluatedAt: input.issuedAt });
  const expectedPreview = await createTransactionPreview(prepared);
  if (canonicalJson(input.preview) !== canonicalJson(expectedPreview)) fail('APPROVAL_BINDING_MISMATCH', 'Preview is not the exact prepared preview.');
  assertId(input.approvalChallengeId, 'input.approvalChallengeId');
  assertDigest(input.nonceDigest, 'input.nonceDigest');
  if (!ERAS.has(input.protocolEra)) fail('INVALID_APPROVAL', 'Protocol era is invalid.');
  const core = {
    schemaVersion: 'OA_APPROVAL_V1', approvalChallengeId: input.approvalChallengeId,
    authenticatedUserId: input.authenticatedContext.userId,
    authenticatedOAuthClientId: input.authenticatedContext.oauthClientId,
    tenantId: prepared.tenantId, transactionId: prepared.transactionId,
    goalRevision: prepared.goalRevision, prepareDigest: prepared.prepareDigest,
    previewDigest: expectedPreview.previewDigest, targetDigest: prepared.target.targetDigest,
    effectClass: prepared.effectClass, nonceDigest: input.nonceDigest,
    issuedAt: input.issuedAt, expiresAt: input.expiresAt, protocolEra: input.protocolEra,
  };
  return freeze({ ...core, approvalDigest: await digestCanonical(core) });
}

function requestStateFor(approval) {
  return `oas1.${approval.approvalChallengeId}.${approval.approvalDigest.slice(7)}.${approval.nonceDigest.slice(7)}`;
}

export function createModernApprovalRequest(approval) {
  validateApprovalShape(approval);
  if (approval.protocolEra !== 'MCP_2026_07_28') fail('INVALID_APPROVAL', 'Modern request requires the modern protocol era.');
  return freeze({
    resultType: 'input_required',
    requestState: requestStateFor(approval),
    inputRequests: [{ requestId: 'transaction_approval', type: 'choice', options: ['APPROVE', 'DECLINE'], required: true }],
  });
}

export async function verifyModernApprovalResponse(input) {
  assertNoSensitive(input);
  if (!isPlainObject(input)) fail('INVALID_APPROVAL', 'Approval response must be a plain object.');
  for (const key of ['approved', 'oauthConsent', 'modelProse', 'pageText', 'clientInfo']) if (key in input) fail('UNTRUSTED_APPROVAL_FIELD', `${key} is not approval authority.`);
  exactKeys(input,
    ['prepared', 'preview', 'trustedChallenge', 'requestState', 'inputResponses', 'authenticatedContext', 'clientCapabilities', 'mrtrRound', 'evaluatedAt', 'consumedNonceDigests'],
    ['jsonRpcRequestId', 'mcpSessionId'], 'input');
  validateAuthenticatedContext(input.authenticatedContext);
  if (!isPlainObject(input.clientCapabilities) || !isPlainObject(input.clientCapabilities.elicitation) || input.clientCapabilities.elicitation.form !== true) fail('MISSING_REQUIRED_CAPABILITY', 'Form elicitation is required.', { rpcCode: -32021 });
  if (input.mrtrRound !== 1) fail('APPROVAL_ROUND_EXCEEDED', 'V1 permits exactly one approval round.');
  const prepared = await validatePreparedTransaction(input.prepared);
  await validateTransactionProvenance(prepared, { evaluatedAt: input.evaluatedAt });
  const expectedPreview = await createTransactionPreview(prepared);
  validateApprovalShape(input.trustedChallenge);
  const approval = input.trustedChallenge;
  if (approval.approvalDigest !== await digestCanonical(Object.fromEntries(Object.entries(approval).filter(([key]) => key !== 'approvalDigest')))) fail('APPROVAL_DIGEST_MISMATCH', 'Approval challenge digest does not match.');
  const bindingsMatch = approval.authenticatedUserId === input.authenticatedContext.userId
    && approval.authenticatedOAuthClientId === input.authenticatedContext.oauthClientId
    && approval.tenantId === prepared.tenantId && approval.transactionId === prepared.transactionId
    && approval.goalRevision === prepared.goalRevision && approval.prepareDigest === prepared.prepareDigest
    && approval.previewDigest === expectedPreview.previewDigest && canonicalJson(input.preview) === canonicalJson(expectedPreview)
    && approval.targetDigest === prepared.target.targetDigest && approval.effectClass === prepared.effectClass
    && approval.protocolEra === 'MCP_2026_07_28';
  if (!bindingsMatch) fail('APPROVAL_BINDING_MISMATCH', 'Approval security bindings changed.');
  validateApprovalInterval(approval, prepared, input.evaluatedAt);
  if (input.requestState !== requestStateFor(approval)) fail('REQUEST_STATE_MISMATCH', 'Opaque request state was changed.');
  if (!Array.isArray(input.consumedNonceDigests) || input.consumedNonceDigests.length > 1024 || input.consumedNonceDigests.some((value) => !HASH.test(value))) fail('INVALID_APPROVAL', 'Consumed nonce set is invalid.');
  if (new Set(input.consumedNonceDigests).size !== input.consumedNonceDigests.length) fail('INVALID_APPROVAL', 'Consumed nonce set contains duplicates.');
  if (input.consumedNonceDigests.includes(approval.nonceDigest)) fail('APPROVAL_NONCE_CONSUMED', 'Approval nonce was already consumed.');
  if (!Array.isArray(input.inputResponses) || input.inputResponses.length !== 1) fail('INVALID_APPROVAL_RESPONSE', 'Exactly one approval response is required.');
  const response = input.inputResponses[0];
  exactKeys(response, ['requestId', 'value'], [], 'inputResponses[0]', 'INVALID_APPROVAL_RESPONSE');
  if (response.requestId !== 'transaction_approval' || !['APPROVE', 'DECLINE'].includes(response.value)) fail('INVALID_APPROVAL_RESPONSE', 'Approval response is invalid.');
  if (response.value !== 'APPROVE') fail('APPROVAL_REJECTED', 'User declined the transaction.');
  const consumptionCore = { approvalDigest: approval.approvalDigest, nonceDigest: approval.nonceDigest, transactionId: prepared.transactionId, prepareDigest: prepared.prepareDigest };
  return freeze({
    schemaVersion: 'OA_APPROVAL_ACCEPTANCE_8C_V1', status: 'APPROVAL_ACCEPTED',
    approvalChallengeId: approval.approvalChallengeId, approvalDigest: approval.approvalDigest,
    transactionId: prepared.transactionId, prepareDigest: prepared.prepareDigest,
    nonceDigest: approval.nonceDigest, acceptedAt: input.evaluatedAt,
    consumptionDigest: await digestCanonical(consumptionCore), transactionStateAdvanced: true,
  });
}
