// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-admission-8d — admission-8d — Isolated LOCAL admission candidate, not an HTTP/MCP endpoint or executor.
// @context: Shared pure module, server and extension.
// @state: remove five dead exports and generalize the dead-export guard.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: goal-ledger, transaction-prepare, transaction-authority.

// Isolated LOCAL admission candidate, not an HTTP/MCP endpoint or executor.
// Adapters are installed by trusted server code, never taken from request data.
// They must authenticate credentials and resolve authoritative current state.
// No production adapter is installed by this module. No browser dispatch exists.

import { canonicalJson, digestCanonical, validateLedger } from './goal-ledger.js';
import { validatePreparedTransaction } from './transaction-prepare.js';
import { validateTransactionProvenance } from './transaction-authority.js';

const SENSITIVE = /(?:password|passcode|pin|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|cvc|security.?code|payment.?data|pairing.?code|signing.?key)/i;
const SECRET = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;
const ADAPTERS = ['authenticate', 'loadPolicy', 'loadCurrentLedger', 'loadCurrentTarget', 'authorizeExactAction', 'resolveOperand'];

// Not exported: thrown from this module and rethrown nowhere else, so an
// export would be unreachable surface. tests/r9-hygiene.test.mjs fails if it
// comes back without a caller.

class TransactionAdmissionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TransactionAdmissionError';
    this.code = code;
    this.transactionStateAdvanced = false;
  }
}
const fail = (code) => { throw new TransactionAdmissionError(code); };
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const copy = (value) => JSON.parse(canonicalJson(value));
const plain = (value) => value && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));

function safeArguments(value, depth = 0) {
  if (depth > 8) fail('INVALID_ADMISSION');
  if (typeof value === 'string' && SECRET.test(value)) fail('SENSITIVE_VALUE');
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE.test(key)) fail('SENSITIVE_VALUE');
      safeArguments(child, depth + 1);
    }
  }
}

function assertBudgetCounts(tx) {
  if (tx.decisionPredicates.length > tx.budgets.decisionPredicates
      || tx.provenance.length > tx.budgets.provenanceRecords
      || tx.expectedPostconditions.length > tx.budgets.expectedPostconditions
      || tx.provenance.some((p) => p.transformChain.length > tx.budgets.transformChainDepth)
      || new TextEncoder().encode(canonicalJson(tx)).length > tx.budgets.preparedTransactionBytes) fail('LIMIT_REACHED');
}

/**
 * Trusted adapter obligations (not established by a caller-supplied label):
 * authenticate: resolve a credential to a server-owned synthetic principal.
 * loadCurrentLedger: authenticate/decrypt ledger + resolve durable current head.
 * loadCurrentTarget: verify principal device ownership/current tab/document.
 * authorizeExactAction: evaluate ALL current constraints/non-goals, narrowing
 *   a live ledger authorization to the exact action and target digests, or null.
 * resolveOperand: retrieve an authenticated exact provenance record and verify
 *   its transform/value/source chain from a trusted source store, or null.
 * Missing adapters/state fail closed. This is NOT proof that those integrations
 * exist, nor human approval, durable nonce consumption, or commit authority.
 */

export function createTransactionAdmission(adapters) {
  if (!plain(adapters) || ADAPTERS.some((key) => typeof adapters[key] !== 'function')
      || Object.keys(adapters).some((key) => !ADAPTERS.includes(key))) fail('INVALID_ADAPTERS');
  const trusted = Object.freeze(Object.fromEntries(ADAPTERS.map((key) => [key, adapters[key]])));
  return async function admit(input, credential, evaluatedAt) {
    // Freeze the entire request before the first async boundary (TOCTOU).
    if (!plain(input) || Object.keys(input).sort().join(',') !== 'arguments,operandBindings,prepared'
        || !plain(input.arguments) || !plain(input.operandBindings)) fail('INVALID_ADMISSION');
    const serialized = canonicalJson(input);
    if (new TextEncoder().encode(serialized).length > 262144) fail('LIMIT_REACHED');
    const request = freeze(JSON.parse(serialized));
    safeArguments(request.arguments);
    if (new TextEncoder().encode(canonicalJson(request.arguments)).length > 65536) fail('LIMIT_REACHED');
    if (typeof evaluatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(evaluatedAt)
        || !Number.isFinite(Date.parse(evaluatedAt))) fail('INVALID_ADMISSION');
    const tx = await validatePreparedTransaction(request.prepared);
    const now = Date.parse(evaluatedAt);
    if (now < Date.parse(tx.preparedAt) || now >= Date.parse(tx.expiresAt)) fail('TRANSACTION_EXPIRED');
    assertBudgetCounts(tx);
    const argumentsDigest = await digestCanonical(request.arguments);
    const actionDigest = await digestCanonical({ descriptorId: tx.action.descriptorId, method: tx.action.method, argumentsDigest });
    if (argumentsDigest !== tx.action.argumentsDigest || actionDigest !== tx.action.actionDigest) fail('ACTION_MISMATCH');

    const rawIdentity = await trusted.authenticate(credential);
    if (!rawIdentity) fail('AUTHENTICATION_REQUIRED');
    const identity = freeze(copy(rawIdentity));
    if (typeof identity.userId !== 'string' || !identity.userId
        || identity.tenantId !== tx.tenantId || typeof identity.acceptanceIdentity !== 'string'
        || !identity.acceptanceIdentity) fail('DARK_IDENTITY_REQUIRED');
    const mode = await trusted.loadPolicy(identity);
    if (mode !== 'DARK' || tx.enforcementMode !== 'DARK') fail('TRANSACTION_DISABLED');
    const rawLedger = await trusted.loadCurrentLedger(identity, tx.goalId);
    if (!rawLedger) fail('AUTHORITY_NOT_RESOLVED');
    const ledger = await validateLedger(copy(rawLedger), { now: evaluatedAt });
    if (ledger.tenantId !== identity.tenantId || ledger.goalId !== tx.goalId
        || ledger.revision !== tx.goalRevision || !['OPEN', 'PARTIAL'].includes(ledger.status)
        || now < Date.parse(ledger.createdAt)) fail('AUTHORITY_NOT_RESOLVED');
    const rawTarget = await trusted.loadCurrentTarget(identity, tx.target);
    if (!rawTarget || canonicalJson(copy(rawTarget)) !== canonicalJson(tx.target)) fail('TARGET_MISMATCH');
    const rawGrant = await trusted.authorizeExactAction(identity, freeze(copy(ledger)), tx, request.arguments, evaluatedAt);
    if (!rawGrant) fail('AUTHORITY_NOT_RESOLVED');
    const grant = freeze(copy(rawGrant));
    const authorization = ledger.authorizations.find((a) => a.authorizationId === grant.authorizationId);
    if (!authorization || grant.operationClass !== authorization.operationClass
        || grant.scopeId !== authorization.scopeId || now >= Date.parse(authorization.expiresAt)
        || grant.actionDigest !== tx.action.actionDigest || grant.targetDigest !== tx.target.targetDigest) fail('AUTHORITY_NOT_RESOLVED');
    await validateTransactionProvenance(tx, { evaluatedAt });
    const authority = tx.provenance.filter((p) => p.authorityRole === 'AUTHORITY');
    const authorizationDigest = await digestCanonical(authorization);
    // First local candidate accepts only directly resolved ledger authority.
    // Other authority source kinds remain unavailable, not implicitly trusted.
    if (authority.length !== 1 || authority[0].sourceKind !== 'LEDGER_AUTHORITY'
        || authority[0].sourceDigest !== ledger.ledgerDigest
        || authority[0].valueDigest !== authorizationDigest
        || canonicalJson(authority[0].transformChain) !== '["IDENTITY"]') fail('AUTHORITY_NOT_RESOLVED');

    const keys = Object.keys(request.arguments).sort();
    if (canonicalJson(keys) !== canonicalJson(Object.keys(request.operandBindings).sort())) fail('OPERAND_NOT_RESOLVED');
    for (const key of keys) {
      const record = tx.provenance.find((p) => p.provenanceId === request.operandBindings[key]);
      if (!record || record.authorityRole !== 'OPERAND' || record.valueDigest !== await digestCanonical(request.arguments[key])) fail('OPERAND_NOT_RESOLVED');
      const attested = await trusted.resolveOperand(identity, tx, record, evaluatedAt);
      if (!attested || canonicalJson(copy(attested)) !== canonicalJson(record)) fail('OPERAND_NOT_RESOLVED');
    }
    const commitDigest = await digestCanonical({ tenantId: tx.tenantId, transactionId: tx.transactionId, prepareDigest: tx.prepareDigest, targetDigest: tx.target.targetDigest });
    return freeze({
      schemaVersion: 'OA_LOCAL_ADMISSION_8D_V1',
      tenantId: tx.tenantId, transactionId: tx.transactionId,
      prepareDigest: tx.prepareDigest, ledgerDigest: ledger.ledgerDigest,
      actionDigest, targetDigest: tx.target.targetDigest,
      commitKey: `tx1:${commitDigest.slice(7)}`,
      browserDispatchAllowed: false,
    });
  };
}
