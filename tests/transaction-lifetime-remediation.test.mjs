// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-lifetime-remediation.test — lifetime-remediation.test — Test.
// @state: enforce transaction approval lifetime budgets.
// @dependencies: strict, node:fs, node:test, goal-ledger, transaction-prepare, transaction-authority.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { digestCanonical } from '../lib/goal-ledger.js';
import { prepareTransaction, createTransactionPreview } from '../lib/transaction-prepare.js';
import { createApprovalChallenge, verifyModernApprovalResponse } from '../lib/transaction-authority.js';

const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/transaction-examples-v1.json', import.meta.url), 'utf8')).validTransactions[0];
const authentication = { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' };
function candidate() { const value = structuredClone(baseline); delete value.prepareDigest; return value; }
async function material(budgetPatch = {}) {
  const value = candidate(); Object.assign(value.budgets, budgetPatch);
  const prepared = await prepareTransaction(value);
  const preview = await createTransactionPreview(prepared);
  return { prepared, preview };
}
function challengeInput(state, patch = {}) {
  return { ...state, authenticatedContext: authentication, approvalChallengeId: 'lifetime_test',
    nonceDigest: `sha256:${'5'.repeat(64)}`, issuedAt: '2026-09-12T00:00:30.000Z',
    expiresAt: '2026-09-12T00:02:30.000Z', protocolEra: 'MCP_2026_07_28', ...patch };
}
async function importedResponse(state, approval, patch = {}) {
  const core = { ...approval, ...patch }; delete core.approvalDigest;
  const trustedChallenge = { ...core, approvalDigest: await digestCanonical(core) };
  return { ...state, trustedChallenge,
    requestState: `oas1.${trustedChallenge.approvalChallengeId}.${trustedChallenge.approvalDigest.slice(7)}.${trustedChallenge.nonceDigest.slice(7)}`,
    inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }],
    authenticatedContext: authentication, clientCapabilities: { elicitation: { form: true } },
    mrtrRound: 1, evaluatedAt: '2026-09-12T00:01:00.000Z', consumedNonceDigests: [] };
}

test('lifetime remediation rejects prepare/global and narrower declared temporal limits independently', async () => {
  for (const key of ['prepareLifetimeMs', 'totalTransactionLifetimeMs']) {
    const value = candidate(); value.budgets[key] = 1;
    await assert.rejects(prepareTransaction(value), (error) => error.code === 'OVER_LIMIT', key);
  }
  const overGlobal = candidate(); overGlobal.expiresAt = '2026-09-12T00:10:00.001Z';
  await assert.rejects(prepareTransaction(overGlobal), (error) => error.code === 'OVER_LIMIT');
});

test('lifetime remediation permits exact declared prepare bounds but rejects one millisecond beyond', async () => {
  for (const key of ['prepareLifetimeMs', 'totalTransactionLifetimeMs']) {
    const value = candidate(); value.budgets[key] = 1000; value.expiresAt = '2026-09-12T00:00:01.000Z';
    assert.equal((await prepareTransaction(value)).expiresAt, value.expiresAt);
    value.expiresAt = '2026-09-12T00:00:01.001Z';
    await assert.rejects(prepareTransaction(value), (error) => error.code === 'OVER_LIMIT');
  }
});

test('lifetime remediation creation honors narrower approval budget and exact inclusive TTL boundary', async () => {
  const state = await material({ approvalLifetimeMs: 1000 });
  await assert.rejects(createApprovalChallenge(challengeInput(state)), (error) => error.code === 'APPROVAL_EXPIRED');
  const allowed = await createApprovalChallenge(challengeInput(state, { expiresAt: '2026-09-12T00:00:31.000Z' }));
  assert.equal(allowed.expiresAt, '2026-09-12T00:00:31.000Z');
  await assert.rejects(createApprovalChallenge(challengeInput(state, { expiresAt: '2026-09-12T00:00:31.001Z' })), (error) => error.code === 'APPROVAL_EXPIRED');
});

test('lifetime remediation import rejects digest-valid overlong/reversed/zero/out-of-prepare intervals', async () => {
  const state = await material(); const approval = await createApprovalChallenge(challengeInput(state));
  const patches = [
    { expiresAt: '2026-09-12T00:08:30.000Z' },
    { issuedAt: '2026-09-11T23:59:30.000Z', expiresAt: '2026-09-12T00:01:30.000Z' },
    { issuedAt: '2026-09-12T00:09:30.000Z', expiresAt: '2026-09-12T00:10:30.000Z' },
    { issuedAt: '2026-09-12T00:01:30.000Z', expiresAt: '2026-09-12T00:01:00.000Z' },
    { issuedAt: '2026-09-12T00:01:00.000Z', expiresAt: '2026-09-12T00:01:00.000Z' },
  ];
  for (const patch of patches) {
    const response = await importedResponse(state, approval, patch);
    const snapshot = structuredClone(response);
    await assert.rejects(verifyModernApprovalResponse(response), (error) => error.code === 'APPROVAL_EXPIRED' && error.transactionStateAdvanced === false);
    assert.deepEqual(response, snapshot);
  }
});

test('lifetime remediation import independently enforces declared approval TTL', async () => {
  const state = await material({ approvalLifetimeMs: 1000 });
  const approval = await createApprovalChallenge(challengeInput(state, { expiresAt: '2026-09-12T00:00:31.000Z' }));
  const validResponse = await importedResponse(state, approval);
  assert.equal((await verifyModernApprovalResponse({ ...validResponse, evaluatedAt: '2026-09-12T00:00:30.999Z' })).status, 'APPROVAL_ACCEPTED');
  await assert.rejects(verifyModernApprovalResponse({ ...validResponse, evaluatedAt: '2026-09-12T00:00:31.000Z' }), (error) => error.code === 'APPROVAL_EXPIRED');
  const response = await importedResponse(state, approval, { expiresAt: '2026-09-12T00:02:30.000Z' });
  await assert.rejects(verifyModernApprovalResponse(response), (error) => error.code === 'APPROVAL_EXPIRED');
});

test('lifetime remediation retains valid global boundary and expiry/pre-issuance fail-closed semantics', async () => {
  const state = await material(); const approval = await createApprovalChallenge(challengeInput(state));
  const response = await importedResponse(state, approval);
  assert.equal((await verifyModernApprovalResponse(response)).status, 'APPROVAL_ACCEPTED');
  for (const evaluatedAt of ['2026-09-12T00:00:29.999Z', '2026-09-12T00:02:30.000Z', '2026-09-12T00:02:30.001Z']) {
    await assert.rejects(verifyModernApprovalResponse({ ...response, evaluatedAt }), (error) => error.code === 'APPROVAL_EXPIRED');
  }
});
