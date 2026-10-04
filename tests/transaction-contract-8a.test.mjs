// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-contract-8a.test — Test..
// @state: Test..
// @dependencies: strict, node:crypto, node:fs, node:test.

// Why source-text and fixture pins, stated per AGENTS.md: milestone 8A is
// contract-only, with runtimeChanges and productionChanges recorded as empty
// in the fixture itself. The deliverable is the closed V1 contract, so these
// tests parse the fixture and replay it -- canonical prepare/approval/commit
// vectors, the hostile corpus, the provenance and approval role boundaries,
// fail-closed behavior on invalid and spoofed input -- rather than merely
// diffing the JSON. Runtime behavior for these paths is exercised by the live
// suites under tests/cloud and tests/postgres, which this file cannot replace.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const contract = readJson('transaction-contract-v1.json');
const transactionSchema = readJson('transaction-schema-v1.json');
const provenanceSchema = readJson('action-provenance-schema-v1.json');
const approvalSchema = readJson('approval-schema-v1.json');
const examples = readJson('transaction-examples-v1.json');
const vectors = readJson('transaction-digest-vectors-v1.json');
const replay = readJson('transaction-replay-v1.json');
const thresholds = readJson('transaction-thresholds-v1.json');
const mcp = readJson('mcp-contract-v1.json');
const vm = readJson('reactive-vm-contract-v1.json');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') { assert.equal(Number.isSafeInteger(value), true); return String(value); }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  assert.equal(typeof value, 'object');
  const keys = Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii')));
  keys.forEach((key) => assert.match(key, /^[\x20-\x7e]+$/));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

const digest = (value) => `sha256:${crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`;
const HASH = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SECRET_FIELD = /(?:password|passcode|pin|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|cvc|security.?code|payment.?data|pairing.?code|signing.?key)/i;

function clone(value) { return structuredClone(value); }
function without(value, key) { return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)); }
function applyPatch(base, patch) {
  const value = clone(base);
  for (const operation of patch) {
    let target = value;
    const path = operation.path.split('.');
    const leaf = path.pop();
    for (const segment of path) target = target[segment];
    if (operation.op === 'delete') delete target[leaf];
    else target[leaf] = operation.value === 'OVERSIZE_PLACEHOLDER'
      ? 'x'.repeat(contract.limits.preparedTransactionBytes + 1)
      : operation.value;
  }
  return value;
}
function hasSensitive(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key) || hasSensitive(child, seen)) return true;
  }
  seen.delete(value);
  return false;
}
function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function validateProvenance(value, tx) {
  const required = ['schemaVersion','provenanceId','sourceKind','sourceDigest','authorityRole','tenantId','goalRevision','freshnessClass','transformChain','valueDigest'];
  const optional = ['deviceId','tabId','documentGeneration','observedAt','sourceRevision'];
  if (!exactKeys(value, required, optional) || value.schemaVersion !== 'OA_ACTION_PROVENANCE_V1') return 'INVALID_PROVENANCE';
  if (!contract.provenance.sourceKinds.includes(value.sourceKind) || !contract.provenance.authorityRoles.includes(value.authorityRole) || !contract.provenance.freshnessClasses.includes(value.freshnessClass)) return 'INVALID_PROVENANCE';
  if (!ID.test(value.provenanceId) || !HASH.test(value.sourceDigest) || !HASH.test(value.valueDigest)) return 'INVALID_PROVENANCE';
  if (value.tenantId !== tx.tenantId || value.goalRevision !== tx.goalRevision) return 'CROSS_AUTHORITY_BOUNDARY';
  if (['BROWSER_OBSERVED','TOOL_OBSERVED','MODEL_DERIVED','SERVER_DERIVED'].includes(value.sourceKind) && value.authorityRole === 'AUTHORITY') return 'UNTRUSTED_AUTHORITY';
  if (!Array.isArray(value.transformChain) || value.transformChain.length > contract.limits.transformChainDepth || value.transformChain.some((step) => !contract.provenance.transforms.includes(step))) return 'INVALID_TRANSFORM';
  return null;
}

function validateTransaction(value) {
  const required = ['schemaVersion','transactionId','tenantId','goalId','goalRevision','target','effectClass','decisionPredicates','action','provenance','expectedPostconditions','budgets','enforcementMode','preparedAt','expiresAt','prepareDigest'];
  const optional = ['programDigest','vmRunId','compensationDescriptorDigest','compensatesTransactionId'];
  if ('actions' in value) return 'MULTI_ACTION_FORBIDDEN';
  if (hasSensitive(value)) return 'SENSITIVE_VALUE';
  if (!exactKeys(value, required, optional) || value.schemaVersion !== 'OA_TRANSACTION_V1') return 'INVALID_SCHEMA';
  if (Buffer.byteLength(JSON.stringify(value)) > contract.limits.preparedTransactionBytes) return 'TRANSACTION_TOO_LARGE';
  if (![value.transactionId,value.tenantId,value.goalId].every((id) => typeof id === 'string' && ID.test(id)) || !Number.isSafeInteger(value.goalRevision) || value.goalRevision < 1) return 'INVALID_SCHEMA';
  if (!contract.effectClasses.includes(value.effectClass) || !contract.enforcement.modes.includes(value.enforcementMode)) return 'INVALID_CLASSIFICATION';
  if (!exactKeys(value.target, ['deviceId','tabId','targetDigest'], ['documentGeneration']) || !ID.test(value.target.deviceId) || !Number.isSafeInteger(value.target.tabId) || value.target.tabId < 0 || !HASH.test(value.target.targetDigest)) return 'INVALID_TARGET';
  if (!exactKeys(value.action, ['descriptorId','method','argumentsDigest','actionDigest']) || !ID.test(value.action.descriptorId) || !contract.transactionPrimitiveMethods.includes(value.action.method) || !HASH.test(value.action.argumentsDigest) || !HASH.test(value.action.actionDigest)) return 'INVALID_ACTION';
  if (!Array.isArray(value.decisionPredicates) || value.decisionPredicates.length > contract.limits.decisionPredicates || value.decisionPredicates.some((item) => !exactKeys(item, ['predicateId','kind','dependencyDigests']) || !contract.decisionPredicateKinds.includes(item.kind) || !Array.isArray(item.dependencyDigests) || item.dependencyDigests.some((x) => !HASH.test(x)))) return 'INVALID_PREDICATE';
  if (!Array.isArray(value.provenance) || value.provenance.length < 1 || value.provenance.length > contract.limits.provenanceRecords) return 'INVALID_PROVENANCE';
  for (const item of value.provenance) { const error = validateProvenance(item, value); if (error) return error; }
  if (!Array.isArray(value.expectedPostconditions) || value.expectedPostconditions.length > contract.limits.expectedPostconditions || value.expectedPostconditions.some((x) => !HASH.test(x))) return 'INVALID_POSTCONDITION';
  if (!exactKeys(value.budgets, Object.keys(contract.limits)) || Object.entries(contract.limits).some(([key, maximum]) => !Number.isSafeInteger(value.budgets[key]) || value.budgets[key] < 1 || value.budgets[key] > maximum)) return 'OVER_LIMIT';
  if (!HASH.test(value.prepareDigest) || value.prepareDigest !== digest(without(value, 'prepareDigest'))) return 'PREPARE_DIGEST_MISMATCH';
  return null;
}

function validateApproval(value, tx, now = '2026-09-12T00:01:00.000Z', authenticated = examples.authenticatedContext) {
  const required = ['schemaVersion','approvalChallengeId','authenticatedUserId','authenticatedOAuthClientId','tenantId','transactionId','goalRevision','prepareDigest','previewDigest','targetDigest','effectClass','nonceDigest','issuedAt','expiresAt','protocolEra','approvalDigest'];
  if (['mcpSessionId','jsonRpcRequestId','clientInfo','approved'].some((key) => key in value)) return 'UNTRUSTED_APPROVAL_FIELD';
  if (!exactKeys(value, required) || value.schemaVersion !== 'OA_APPROVAL_V1') return 'INVALID_APPROVAL';
  if (!contract.approval.protocolEras.includes(value.protocolEra) || !HASH.test(value.nonceDigest) || !HASH.test(value.previewDigest)) return 'INVALID_APPROVAL';
  if (value.authenticatedUserId !== authenticated.userId || value.authenticatedOAuthClientId !== authenticated.oauthClientId || value.tenantId !== tx.tenantId || value.transactionId !== tx.transactionId || value.goalRevision !== tx.goalRevision || value.prepareDigest !== tx.prepareDigest || value.targetDigest !== tx.target.targetDigest || value.effectClass !== tx.effectClass) return 'APPROVAL_BINDING_MISMATCH';
  if (Date.parse(value.expiresAt) <= Date.parse(now)) return 'APPROVAL_EXPIRED';
  if (!HASH.test(value.approvalDigest) || value.approvalDigest !== digest(without(value, 'approvalDigest'))) return 'APPROVAL_DIGEST_MISMATCH';
  return null;
}

function enforcementDecision(mode, tool, { internalExecutor = false, burstActions = [] } = {}) {
  const entry = contract.enforcement.toolDecisions.find((item) => item.tool === tool);
  if (!entry || !contract.enforcement.modes.includes(mode)) return 'INVALID_POLICY';
  const mutating = entry.classification === 'MUTATION' || (entry.classification === 'CONDITIONAL' && burstActions.some((action) => !['read','find','wait'].includes(action)));
  if (mode === 'ENFORCED' && mutating && !internalExecutor) return 'TRANSACTION_REQUIRED';
  return 'ALLOW';
}

test('8A freezes three closed V1 schemas without runtime implementation', () => {
  assert.equal(contract.runtimeStatus, 'CONTRACT_ONLY_NO_RUNTIME');
  assert.equal(transactionSchema.additionalProperties, false);
  assert.equal(provenanceSchema.additionalProperties, false);
  assert.equal(approvalSchema.additionalProperties, false);
  assert.equal(transactionSchema.properties.schemaVersion.const, 'OA_TRANSACTION_V1');
  assert.equal(provenanceSchema.properties.schemaVersion.const, 'OA_ACTION_PROVENANCE_V1');
  assert.equal(approvalSchema.properties.schemaVersion.const, 'OA_APPROVAL_V1');
});

test('8A valid and invalid transaction fixtures fail closed before execution', () => {
  examples.validTransactions.forEach((value) => assert.equal(validateTransaction(value), null, value.transactionId));
  examples.invalidTransactions.forEach((item) => assert.equal(validateTransaction(applyPatch(examples.validTransactions[0], item.patch)), item.expectedError, item.id));
});

test('8A provenance roles prevent page, tool, model, or server data becoming authority', () => {
  const tx = examples.validTransactions[0];
  for (const sourceKind of ['BROWSER_OBSERVED','TOOL_OBSERVED','MODEL_DERIVED','SERVER_DERIVED']) {
    const value = clone(tx.provenance[0]); value.sourceKind = sourceKind; value.authorityRole = 'AUTHORITY';
    assert.equal(validateProvenance(value, tx), 'UNTRUSTED_AUTHORITY', sourceKind);
  }
  for (const sourceKind of ['USER_EXPLICIT','LEDGER_AUTHORITY','TRUSTED_POLICY']) {
    const value = clone(tx.provenance[0]); value.sourceKind = sourceKind; value.authorityRole = 'AUTHORITY';
    assert.equal(validateProvenance(value, tx), null, sourceKind);
  }
});

test('8A approval is exact-bound, expiring, one-shot-contract data and session independent', () => {
  const tx = examples.validTransactions[0];
  assert.equal(validateApproval(examples.validApprovals[0], tx), null);
  examples.invalidApprovals.forEach((item) => assert.equal(validateApproval(applyPatch(examples.validApprovals[0], item.patch), tx, item.now || undefined), item.expectedError, item.id));
  assert.equal(contract.approval.securityBindings.includes('mcpSessionId'), false);
  assert.equal(contract.approval.securityBindings.includes('jsonRpcRequestId'), false);
  assert.equal(contract.approval.securityBindings.includes('clientInfo'), false);
});

test('8A enforced mode gates every legacy mutator and preserves observation tools', () => {
  assert.equal(contract.enforcement.toolDecisions.length, 22); // U-T rebaseline
  assert.deepEqual(contract.enforcement.toolDecisions.map((item) => item.tool), mcp.tools);
  for (const entry of contract.enforcement.toolDecisions) {
    if (entry.classification === 'OBSERVATION') assert.equal(enforcementDecision('ENFORCED', entry.tool), 'ALLOW', entry.tool);
    if (entry.classification === 'MUTATION') {
      assert.equal(enforcementDecision('ENFORCED', entry.tool), 'TRANSACTION_REQUIRED', entry.tool);
      assert.equal(enforcementDecision('ENFORCED', entry.tool, { internalExecutor: true }), 'ALLOW', entry.tool);
    }
  }
  assert.equal(enforcementDecision('ENFORCED', 'run_browser_burst', { burstActions: ['read','click'] }), 'TRANSACTION_REQUIRED');
  assert.equal(enforcementDecision('ENFORCED', 'run_browser_burst', { burstActions: ['read','find','wait'] }), 'ALLOW');
  assert.equal(enforcementDecision('OFF', 'click_element'), 'ALLOW');
  assert.equal(contract.enforcement.transactionCommitAvailable.OFF, false);
  assert.equal(contract.enforcement.transactionCommitAvailable.DARK, false);
});

test('8A contract forbids multi-action V1 and freezes one commit identity', () => {
  assert.equal(contract.limits.stateChangingActionsPerTransaction, 1);
  assert.equal(contract.limits.consequentialActionsPerTransaction, 1);
  assert.equal(contract.transactionShape.actionField, 'action');
  assert.equal(contract.transactionShape.forbiddenFields.includes('actions'), true);
  assert.equal(contract.compensation.separateTransactionRequired, true);
  assert.equal(contract.compensation.inheritsApproval, false);
});

test('8A effect classification defaults generic and unknown operations to irreversible or unknown', () => {
  assert.equal(contract.effectClassification.unknownDefault, 'IRREVERSIBLE_OR_UNKNOWN');
  assert.equal(contract.effectClassification.clientSuppliedClassTrusted, false);
  assert.deepEqual(
    contract.effectClassification.genericMethods.map((item) => item.method),
    contract.transactionPrimitiveMethods,
  );
  contract.effectClassification.genericMethods.forEach((item) => {
    assert.equal(item.effectClass, 'IRREVERSIBLE_OR_UNKNOWN', item.method);
  });
});

test('8A modern and legacy MCP approval vectors fail closed', () => {
  assert.ok(contract.approval.transportVectors.length >= 10);
  for (const vector of contract.approval.transportVectors) {
    assert.equal(vector.transactionStateAdvanced, vector.expected === 'APPROVAL_ACCEPTED', vector.id);
    if (vector.id === 'modern-missing-capability') assert.equal(vector.errorCode, -32021);
  }
  assert.equal(contract.approval.mrtrRounds, 1);
  assert.equal(contract.approval.requestStateUntrustedUntilVerified, true);
});

test('8A canonical prepare, approval, commit, and idempotency vectors replay identically 100 times', () => {
  assert.deepEqual(vectors.vectors.map((item) => item.kind), ['PREPARE','APPROVAL','COMMIT','IDEMPOTENCY']);
  for (const vector of vectors.vectors) {
    assert.equal(canonical(vector.input), vector.canonical, vector.kind);
    const outputs = Array.from({ length: 100 }, () => digest(vector.input));
    assert.equal(new Set(outputs).size, 1, vector.kind);
    assert.equal(outputs[0], vector.digest, vector.kind);
  }
});

test('8A hostile corpus contains at least 64 unique zero-unsafe-acceptance cases', () => {
  assert.ok(replay.cases.length >= 64);
  assert.equal(new Set(replay.cases.map((item) => item.id)).size, replay.cases.length);
  replay.cases.forEach((item) => {
    const outcome = { ...replay.safeDefaults, ...item };
    assert.equal(outcome.browserDispatches, 0, item.id);
    assert.equal(outcome.approvalAccepted, false, item.id);
    assert.equal(outcome.authorityBroadened, false, item.id);
    assert.equal(outcome.crossBoundaryAccepted, false, item.id);
    assert.equal(outcome.sensitivePersisted, false, item.id);
    assert.equal(outcome.falseProved, false, item.id);
    assert.equal(outcome.focusChanges, 0, item.id);
  });
});

test('8A locks accepted inventory, limits, and documentation-only compatibility boundary', () => {
  assert.equal(pkg.version, '1.6.15');
  assert.equal(manifest.version, '1.6.15');
  assert.equal(mcp.toolCount, 22); // U-T rebaseline
  assert.equal(vm.inventory.digest, thresholds.milestone7InventoryDigest);
  assert.equal(contract.inventory.mcpSourceSha256, mcp.sourceSha256);
  assert.equal(contract.inventory.publicMcpTools, 22); // U-T rebaseline
  assert.equal(contract.inventory.browserCapabilities, 26);
  assert.equal(thresholds.minimumHostileCases, 64);
  assert.equal(thresholds.canonicalReplayRuns, 100);
  assert.deepEqual(contract.checkpointBoundary.runtimeChanges, []);
  assert.deepEqual(contract.checkpointBoundary.productionChanges, []);
});
