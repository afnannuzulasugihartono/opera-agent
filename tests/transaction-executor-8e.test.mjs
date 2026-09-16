import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransactionExecutor, enforceTransactionGate, createCompensationDescriptor } from '../lib/transaction-executor-8e.js';
import { transactionFixture } from './helpers/transaction-dark-fixture.mjs';
import { sealLedgerToken } from '../lib/ledger-token.js';
import { createApprovalChallenge, verifyModernApprovalResponse } from '../lib/transaction-authority.js';
import { createTransactionPreview } from '../lib/transaction-prepare.js';
import { canonicalJson, digestCanonical } from '../lib/goal-ledger.js';

// Trusted clock for deterministic tests.
const clock = () => new Date('2026-09-12T00:02:00.000Z');

// Build a full fixture: prepared transaction + admission result + authority.
async function executorFixture(options = {}) {
  const f = await transactionFixture(undefined, options);
  const key = new Uint8Array(32).fill(7);
  const now = '2026-09-12T00:01:00.000Z';
  const ledgerToken = await sealLedgerToken(f.state.ledger, key, { requestId: 'ledger_fixture', issuedAt: now });

  // Build a synthetic admission result (matching 8D admission shape).
  const commitDigest = await digestCanonical({
    tenantId: f.request.prepared.tenantId,
    transactionId: f.request.prepared.transactionId,
    prepareDigest: f.request.prepared.prepareDigest,
    targetDigest: f.request.prepared.target.targetDigest,
  });
  const admission = {
    schemaVersion: 'OA_LOCAL_ADMISSION_8D_V1',
    tenantId: f.request.prepared.tenantId,
    transactionId: f.request.prepared.transactionId,
    prepareDigest: f.request.prepared.prepareDigest,
    ledgerDigest: f.state.ledger.ledgerDigest,
    actionDigest: f.request.prepared.action.actionDigest,
    targetDigest: f.request.prepared.target.targetDigest,
    commitKey: `tx1:${commitDigest.slice(7)}`,
    browserDispatchAllowed: false,
  };

  const authority = {
    serverDerived: true,
    transactionBound: true,
    clientSupplied: false,
    validated: true,
    commitKey: admission.commitKey,
  };

  return { f, admission, authority, prepared: f.request.prepared, key, ledgerToken };
}

// Build a synthetic approval acceptance for IRREVERSIBLE_OR_UNKNOWN transactions.
async function approvalFixture(prepared, identity = { userId: 'user_alpha', oauthClientId: 'client_a' }) {
  const preview = await createTransactionPreview(prepared);
  const challenge = await createApprovalChallenge({
    prepared,
    preview,
    authenticatedContext: { userId: identity.userId, oauthClientId: identity.oauthClientId, authenticationKind: 'OAUTH_USER' },
    approvalChallengeId: 'challenge_8e_1',
    nonceDigest: 'sha256:' + 'a'.repeat(64),
    issuedAt: '2026-09-12T00:01:30.000Z',
    expiresAt: '2026-09-12T00:03:30.000Z',
    protocolEra: 'MCP_2026_07_28',
  });
  const acceptance = await verifyModernApprovalResponse({
    prepared,
    preview,
    trustedChallenge: challenge,
    requestState: `oas1.${challenge.approvalChallengeId}.${challenge.approvalDigest.slice(7)}.${challenge.nonceDigest.slice(7)}`,
    inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }],
    authenticatedContext: { userId: identity.userId, oauthClientId: identity.oauthClientId, authenticationKind: 'OAUTH_USER' },
    clientCapabilities: { elicitation: { form: true } },
    mrtrRound: 1,
    evaluatedAt: '2026-09-12T00:01:45.000Z',
    consumedNonceDigests: [],
  });
  return acceptance;
}

// --- Tests ---

test('8E executor rejects commit without valid prepared envelope', async () => {
  const { admission, authority } = await executorFixture();
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  await assert.rejects(executor({ operation: 'commit', prepared: null, admission, internalExecutorAuthority: authority }), { code: 'INVALID_SCHEMA' });
});

test('8E executor rejects commit without valid admission result', async () => {
  const { prepared, authority } = await executorFixture();
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  await assert.rejects(executor({ operation: 'commit', prepared, admission: null, internalExecutorAuthority: authority }), { code: 'INVALID_ADMISSION' });
});

test('8E executor rejects commit without server-derived executor authority', async () => {
  const { prepared, admission } = await executorFixture();
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  await assert.rejects(executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: { serverDerived: false, transactionBound: true, clientSupplied: false, validated: true, commitKey: admission.commitKey } }), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
  await assert.rejects(executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: { serverDerived: true, transactionBound: true, clientSupplied: false, validated: true, commitKey: 'tx1:wrong' } }), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
  await assert.rejects(executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: { serverDerived: true, transactionBound: true, clientSupplied: true, validated: true, commitKey: admission.commitKey } }), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
});

test('8E executor rejects commit when admission bindings do not match prepared', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  const mismatched = { ...admission, transactionId: 'different_tx' };
  await assert.rejects(executor({ operation: 'commit', prepared, admission: mismatched, internalExecutorAuthority: { ...authority, commitKey: mismatched.commitKey } }), { code: 'ADMISSION_BINDING_MISMATCH' });
});

test('8E executor rejects commit when prepared enforcement mode is OFF', async () => {
  // A prepared transaction with enforcementMode OFF cannot pass validation
  // because the prepare digest was computed with a specific enforcement mode.
  // The executor must reject any attempt to commit a transaction whose
  // enforcement mode is OFF. Since validatePreparedTransaction will catch
  // digest mismatch first, we test the executor's own gate separately.
  const { admission, authority } = await executorFixture();
  const offPrepared = { ...admission, enforcementMode: 'OFF' };
  // The executor's commit path checks enforcementMode after validation.
  // Since the prepared transaction is already validated (it has a valid
  // prepareDigest), changing enforcementMode post-validation will cause
  // PREPARE_DIGEST_MISMATCH — which is also a correct rejection.
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  // Build a prepared with OFF mode that passes validation:
  const f = await transactionFixture(undefined, {});
  const offCandidate = JSON.parse(JSON.stringify(f.request.prepared));
  delete offCandidate.prepareDigest;
  offCandidate.enforcementMode = 'OFF';
  const { prepareTransaction } = await import('../lib/transaction-prepare.js');
  const offPreparedValid = await prepareTransaction(offCandidate);
  // Recompute admission for OFF mode.
  const offCommitDigest = await digestCanonical({
    tenantId: offPreparedValid.tenantId,
    transactionId: offPreparedValid.transactionId,
    prepareDigest: offPreparedValid.prepareDigest,
    targetDigest: offPreparedValid.target.targetDigest,
  });
  const offAdmission = { ...admission, transactionId: offPreparedValid.transactionId, prepareDigest: offPreparedValid.prepareDigest, commitKey: `tx1:${offCommitDigest.slice(7)}` };
  const offAuthority = { ...authority, commitKey: offAdmission.commitKey };
  await assert.rejects(executor({ operation: 'commit', prepared: offPreparedValid, admission: offAdmission, internalExecutorAuthority: offAuthority }), { code: 'TRANSACTION_UNAVAILABLE' });
});

test('8E executor rejects commit for IRREVERSIBLE_OR_UNKNOWN without approval', async () => {
  const { prepared, admission, authority } = await executorFixture();
  // The default fixture is IRREVERSIBLE_OR_UNKNOWN (classifyTransactionEffect returns this).
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  await assert.rejects(executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority }), { code: 'APPROVAL_REQUIRED' });
});

test('8E executor dispatches commit with valid approval and returns COMMITTED_UNVERIFIED', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const dispatchCalls = [];
  const executor = createTransactionExecutor({
    dispatch: async (action, commitKey, target, auth) => {
      dispatchCalls.push({ action, commitKey, target, auth });
      return { status: 'COMPLETED', receipt: { dispatchedAt: '2026-09-12T00:02:01.000Z' } };
    },
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  assert.equal(result.status, 'COMMITTED_UNVERIFIED');
  assert.equal(result.browserDispatchAllowed, false);
  assert.equal(result.replay, false);
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0].commitKey, admission.commitKey);
  assert.equal(dispatchCalls[0].auth, authority);
  // Executor authority is never returned to the model/client.
  assert.equal(JSON.stringify(result).includes('serverDerived'), false);
  assert.equal(JSON.stringify(result).includes('transactionBound'), false);
});

test('8E executor returns COMMITTING when dispatch status is DISPATCHED', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'DISPATCHED', receipt: null }),
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  assert.equal(result.status, 'COMMITTING');
  assert.equal(result.browserDispatchAllowed, false);
});

test('8E executor returns COMMITTED_UNVERIFIED on dispatch TIMEOUT', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'TIMEOUT', receipt: null }),
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  assert.equal(result.status, 'COMMITTED_UNVERIFIED');
  assert.equal(result.browserDispatchAllowed, false);
});

test('8E executor returns AMBIGUOUS when dispatch throws', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => { throw Object.assign(new Error('crash'), { code: 'DISPATCH_ERROR' }); },
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.browserDispatchAllowed, false);
  assert.equal(result.error, 'DISPATCH_ERROR');
});

test('8E executor reclaim returns COMMITTED_UNVERIFIED when existing command completed', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => { throw new Error('should not be called'); },
    reclaim: async (commitKey) => ({ status: 'COMPLETED', receipt: { dispatchedAt: '2026-09-12T00:01:55.000Z' } }),
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  assert.equal(result.status, 'COMMITTED_UNVERIFIED');
  assert.equal(result.replay, true);
  assert.equal(result.browserDispatchAllowed, false);
});

test('8E executor reclaim returns COMMITTING when existing command is pending', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => { throw new Error('should not be called'); },
    reclaim: async () => ({ status: 'PENDING', receipt: null }),
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  assert.equal(result.status, 'COMMITTING');
  assert.equal(result.replay, false);
});

test('8E executor reclaim returns AMBIGUOUS for IRREVERSIBLE when status is UNKNOWN', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => { throw new Error('should not be called'); },
    reclaim: async () => ({ status: 'UNKNOWN', receipt: null }),
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.browserDispatchAllowed, false);
});

test('8E executor cancellation before dispatch produces zero mutation', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const dispatchCalls = [];
  const executor = createTransactionExecutor({
    dispatch: async () => { dispatchCalls.push('dispatch'); return { status: 'COMPLETED' }; },
  }, { clock });
  const result = await executor({ operation: 'cancel', prepared, admission, internalExecutorAuthority: authority });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.cancellationBeforeDispatch, true);
  assert.equal(result.browserDispatchAllowed, false);
  assert.equal(dispatchCalls.length, 0);
});

test('8E executor status operation returns PREPARED without dispatch', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const dispatchCalls = [];
  const executor = createTransactionExecutor({
    dispatch: async () => { dispatchCalls.push('dispatch'); return { status: 'COMPLETED' }; },
  }, { clock });
  const result = await executor({ operation: 'status', prepared, admission, internalExecutorAuthority: authority });
  assert.equal(result.status, 'PREPARED');
  assert.equal(result.browserDispatchAllowed, false);
  assert.equal(dispatchCalls.length, 0);
});

test('8E executor rejects unknown operation', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  await assert.rejects(executor({ operation: 'finalize', prepared, admission, internalExecutorAuthority: authority }), { code: 'INVALID_REQUEST' });
});

test('8E executor rejects request-sourced executor authority', async () => {
  const { prepared, admission } = await executorFixture();
  const executor = createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, { clock });
  // Client-supplied authority must be rejected.
  await assert.rejects(executor({
    operation: 'commit', prepared, admission,
    internalExecutorAuthority: { serverDerived: true, transactionBound: true, clientSupplied: true, validated: true, commitKey: admission.commitKey },
  }), { code: 'EXECUTOR_AUTHORITY_REQUIRED' });
});

test('8E executor rejects dispatch adapter returning invalid status', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'WAS_SUCCESSFUL' }),
  }, { clock });
  await assert.rejects(executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval }), { code: 'DISPATCH_INVALID' });
});

test('8E enforcement gate returns TRANSACTION_REQUIRED for mutation tools in ENFORCED mode', () => {
  for (const tool of ['click_element', 'fill_element', 'press_key', 'open_url', 'navigate_tab', 'close_tab', 'scroll_page', 'move_pointer', 'click_at', 'drag_pointer', 'wheel_at', 'activate_tab']) {
    const result = enforceTransactionGate({ tool, mode: 'ENFORCED' });
    assert.equal(result, 'TRANSACTION_REQUIRED', `${tool} should be gated`);
  }
});

test('8E enforcement gate returns ALLOW for observation tools in ENFORCED mode', () => {
  for (const tool of ['browser_status', 'list_tabs', 'read_page', 'capture_page', 'find_elements']) {
    const result = enforceTransactionGate({ tool, mode: 'ENFORCED' });
    assert.equal(result, 'ALLOW', `${tool} should be allowed`);
  }
});

test('8E enforcement gate returns ALLOW for mutation tools in OFF mode', () => {
  assert.equal(enforceTransactionGate({ tool: 'click_element', mode: 'OFF' }), 'ALLOW');
  assert.equal(enforceTransactionGate({ tool: 'fill_element', mode: 'DARK' }), 'ALLOW');
});

test('8E enforcement gate rejects mixed mutation burst in ENFORCED mode', () => {
  const result = enforceTransactionGate({ tool: 'run_browser_burst', mode: 'ENFORCED', burstActions: ['read', 'find', 'click'] });
  assert.equal(result, 'TRANSACTION_REQUIRED');
});

test('8E enforcement gate allows read-only burst in ENFORCED mode', () => {
  const result = enforceTransactionGate({ tool: 'run_browser_burst', mode: 'ENFORCED', burstActions: ['read', 'find', 'wait'] });
  assert.equal(result, 'ALLOW');
});

test('8E enforcement gate returns FAIL_CLOSED for unknown tool', () => {
  assert.equal(enforceTransactionGate({ tool: 'unknown_tool', mode: 'ENFORCED' }), 'FAIL_CLOSED');
});

test('8E enforcement gate returns TRANSACTION_REQUIRED for run_browser_burst without burstActions', () => {
  assert.equal(enforceTransactionGate({ tool: 'run_browser_burst', mode: 'ENFORCED' }), 'TRANSACTION_REQUIRED');
});

test('8E enforcement gate allows trusted executor to cross mutation gate', () => {
  const trustedContext = {
    internalExecutorAuthority: {
      serverDerived: true,
      transactionBound: true,
      clientSupplied: false,
      validated: true,
    },
  };
  assert.equal(enforceTransactionGate({ tool: 'click_element', mode: 'ENFORCED' }, trustedContext), 'ALLOW');
});

test('8E compensation descriptor does not inherit approval', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'COMPLETED', receipt: { dispatchedAt: '2026-09-12T00:02:01.000Z' } }),
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  const descriptor = createCompensationDescriptor(result, { method: 'page.fill', descriptorId: 'inverse_fill', argumentsDigest: 'sha256:' + 'b'.repeat(64), actionDigest: 'sha256:' + 'c'.repeat(64) });
  assert.equal(descriptor.inheritsApproval, false);
  assert.equal(descriptor.requiresOriginalVerification, true);
  assert.equal(descriptor.compensatesTransactionId, prepared.transactionId);
});

test('8E compensation descriptor rejects invalid original receipt', () => {
  assert.throws(() => createCompensationDescriptor(null, { method: 'page.fill' }), { code: 'INVALID_COMPENSATION' });
  assert.throws(() => createCompensationDescriptor({ transactionId: 'tx_a' }, null), { code: 'INVALID_COMPENSATION' });
});

test('8E executor rejects approval with wrong transaction binding', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const wrongApproval = { ...approval, transactionId: 'different_tx' };
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'COMPLETED' }),
  }, { clock });
  await assert.rejects(executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval: wrongApproval }), { code: 'APPROVAL_INVALID' });
});

test('8E executor never returns browserDispatchAllowed=true', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  for (const operation of ['commit', 'cancel', 'status']) {
    const executor = createTransactionExecutor({
      dispatch: async () => ({ status: 'COMPLETED', receipt: {} }),
    }, { clock });
    const result = await executor({ operation, prepared, admission, internalExecutorAuthority: authority, approval });
    assert.equal(result.browserDispatchAllowed, false, `${operation} must have browserDispatchAllowed=false`);
  }
});

test('8E executor authority is never in the response body', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const approval = await approvalFixture(prepared);
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'COMPLETED', receipt: {} }),
  }, { clock });
  const result = await executor({ operation: 'commit', prepared, admission, internalExecutorAuthority: authority, approval });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('serverDerived'), false);
  assert.equal(serialized.includes('clientSupplied'), false);
  assert.equal(serialized.includes('transactionBound'), false);
});

test('8E executor observe operation requires observe adapter', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'COMPLETED' }),
  }, { clock });
  await assert.rejects(executor({ operation: 'observe', prepared, admission, internalExecutorAuthority: authority }), { code: 'OBSERVE_UNAVAILABLE' });
});

test('8E executor verify operation requires verify adapter', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'COMPLETED' }),
  }, { clock });
  await assert.rejects(executor({ operation: 'verify', prepared, admission, internalExecutorAuthority: authority }), { code: 'VERIFY_UNAVAILABLE' });
});

test('8E executor verify returns classification from verify adapter', async () => {
  const { prepared, admission, authority } = await executorFixture();
  const executor = createTransactionExecutor({
    dispatch: async () => ({ status: 'COMPLETED' }),
    verify: async () => 'VERIFIED',
  }, { clock });
  const result = await executor({ operation: 'verify', prepared, admission, internalExecutorAuthority: authority });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.verificationSummary.classification, 'VERIFIED');
});

test('8E executor rejects configuration without clock', () => {
  assert.throws(() => createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }) }, {}), { code: 'INVALID_EXECUTOR_CONFIGURATION' });
});

test('8E executor rejects configuration without required dispatch adapter', () => {
  assert.throws(() => createTransactionExecutor({}, { clock }), { code: 'INVALID_EXECUTOR_CONFIGURATION' });
});

test('8E executor rejects unknown adapter', () => {
  assert.throws(() => createTransactionExecutor({ dispatch: async () => ({ status: 'COMPLETED' }), extra: () => {} }, { clock }), { code: 'INVALID_EXECUTOR_CONFIGURATION' });
});
