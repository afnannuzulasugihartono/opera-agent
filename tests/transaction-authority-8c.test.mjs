// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-authority-8c.test — authority-8c.test — Test.
// @state: add transaction authority verifier.
// @dependencies: strict, node:fs, node:test, transaction-authority, transaction-prepare.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  TransactionAuthorityError,
  createApprovalChallenge,
  createModernApprovalRequest,
  validateTransactionProvenance,
  verifyModernApprovalResponse,
} from '../lib/transaction-authority.js';
import { createTransactionPreview, prepareTransaction } from '../lib/transaction-prepare.js';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const examples = readJson('transaction-examples-v1.json');
const clone = structuredClone;
const HASH = (character) => `sha256:${character.repeat(64)}`;

async function preparedAndPreview() {
  const candidate = clone(examples.validTransactions[0]);
  delete candidate.prepareDigest;
  const prepared = await prepareTransaction(candidate);
  const preview = await createTransactionPreview(prepared);
  return { prepared, preview };
}

async function challenge(overrides = {}) {
  const { prepared, preview } = await preparedAndPreview();
  const approval = await createApprovalChallenge({
    prepared,
    preview,
    authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' },
    approvalChallengeId: 'approval_test_8c',
    nonceDigest: HASH('5'),
    issuedAt: '2026-09-12T00:00:30.000Z',
    expiresAt: '2026-09-12T00:02:30.000Z',
    protocolEra: 'MCP_2026_07_28',
    ...overrides,
  });
  return { prepared, preview, approval };
}

test('8C validates a bounded exact-target provenance chain and freezes its report', async () => {
  const { prepared } = await preparedAndPreview();
  const result = await validateTransactionProvenance(prepared, { evaluatedAt: '2026-09-12T00:01:00.000Z' });
  assert.deepEqual(result, {
    schemaVersion: 'OA_PROVENANCE_VALIDATION_8C_V1',
    transactionId: 'tx_test_001',
    prepareDigest: prepared.prepareDigest,
    authorityProvenanceIds: ['prov_authority'],
    operandProvenanceIds: ['prov_operand'],
    provenanceDigest: result.provenanceDigest,
  });
  assert.match(result.provenanceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result), true);
});

test('8C rejects untrusted authority, cross-boundary observations, stale facts, and transform abuse', async () => {
  const attempts = [
    ['UNTRUSTED_AUTHORITY', (tx) => { tx.provenance[0].sourceKind = 'MODEL_DERIVED'; }],
    ['CROSS_AUTHORITY_BOUNDARY', (tx) => { tx.provenance[1].tenantId = 'tenant_other'; }],
    ['CROSS_AUTHORITY_BOUNDARY', (tx) => { tx.provenance[1].deviceId = 'device_other'; }],
    ['CROSS_AUTHORITY_BOUNDARY', (tx) => { tx.provenance[1].tabId = 99; }],
    ['CROSS_AUTHORITY_BOUNDARY', (tx) => { tx.provenance[1].documentGeneration = 'doc_other'; }],
    ['STALE_PROVENANCE', (tx) => { tx.provenance[1].freshnessClass = 'STALE'; }],
    ['INVALID_TRANSFORM', (tx) => { tx.provenance[1].transformChain = Array(9).fill('TRIM'); }],
  ];
  for (const [code, mutate] of attempts) {
    const tx = clone(examples.validTransactions[0]);
    mutate(tx);
    await assert.rejects(validateTransactionProvenance(tx, { evaluatedAt: '2026-09-12T00:01:00.000Z' }), (error) => error.code === code);
  }
  for (const sourceKind of ['SERVER_DERIVED', 'BROWSER_OBSERVED', 'TOOL_OBSERVED', 'MODEL_DERIVED']) {
    const tx = clone(examples.validTransactions[0]);
    tx.provenance[0].sourceKind = sourceKind;
    await assert.rejects(validateTransactionProvenance(tx, { evaluatedAt: '2026-09-12T00:01:00.000Z' }), (error) => error.code === 'UNTRUSTED_AUTHORITY');
  }
});

test('8C creates an exact-bound immutable approval challenge with no ambient clock', async () => {
  const { prepared, preview, approval } = await challenge();
  assert.equal(approval.prepareDigest, prepared.prepareDigest);
  assert.equal(approval.previewDigest, preview.previewDigest);
  assert.equal(approval.targetDigest, prepared.target.targetDigest);
  assert.equal(approval.authenticatedUserId, 'user_alpha');
  assert.equal(approval.authenticatedOAuthClientId, 'oauth_client_chatgpt');
  assert.match(approval.approvalDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(approval), true);
  assert.deepEqual(approval, (await challenge()).approval);
});

test('8C rejects static bearer identity and OAuth consent as transaction approval', async () => {
  for (const authenticationKind of ['STATIC_BEARER', 'SERVICE_ROLE', 'ANONYMOUS']) {
    await assert.rejects(challenge({ authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind } }), (error) => error.code === 'APPROVAL_AUTHORITY_UNAVAILABLE');
  }
  await assert.rejects(challenge({ oauthConsent: true }), (error) => error.code === 'UNTRUSTED_APPROVAL_FIELD');
});

test('8C modern requestState accepts one explicit round while ignoring JSON-RPC and session routing identity', async () => {
  const { prepared, preview, approval } = await challenge();
  const request = createModernApprovalRequest(approval);
  assert.equal(request.resultType, 'input_required');
  assert.equal(request.inputRequests.length, 1);
  assert.equal(typeof request.requestState, 'string');
  const accepted = await verifyModernApprovalResponse({
    prepared,
    preview,
    trustedChallenge: approval,
    requestState: request.requestState,
    inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }],
    authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' },
    clientCapabilities: { elicitation: { form: true } },
    mrtrRound: 1,
    evaluatedAt: '2026-09-12T00:01:00.000Z',
    consumedNonceDigests: [],
    jsonRpcRequestId: 'different-on-retry',
    mcpSessionId: 'routing-only',
  });
  assert.equal(accepted.status, 'APPROVAL_ACCEPTED');
  assert.equal(accepted.nonceDigest, approval.nonceDigest);
  assert.equal(accepted.jsonRpcRequestId, undefined);
  assert.equal(accepted.mcpSessionId, undefined);
  assert.match(accepted.consumptionDigest, /^sha256:[0-9a-f]{64}$/);
});

test('8C rejects missing modern capability without advancing transaction state', async () => {
  const { prepared, preview, approval } = await challenge();
  const request = createModernApprovalRequest(approval);
  await assert.rejects(verifyModernApprovalResponse({
    prepared, preview, trustedChallenge: approval, requestState: request.requestState,
    inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }],
    authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' },
    clientCapabilities: {}, mrtrRound: 1, evaluatedAt: '2026-09-12T00:01:00.000Z', consumedNonceDigests: [],
  }), (error) => error.code === 'MISSING_REQUIRED_CAPABILITY' && error.rpcCode === -32021 && error.transactionStateAdvanced === false);
});

test('8C rejects requestState/input response tamper, decline, extra rounds, expiry, and nonce replay', async () => {
  const { prepared, preview, approval } = await challenge();
  const request = createModernApprovalRequest(approval);
  const base = {
    prepared, preview, trustedChallenge: approval, requestState: request.requestState,
    inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }],
    authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' },
    clientCapabilities: { elicitation: { form: true } }, mrtrRound: 1,
    evaluatedAt: '2026-09-12T00:01:00.000Z', consumedNonceDigests: [],
  };
  const attempts = [
    ['REQUEST_STATE_MISMATCH', { requestState: `${request.requestState}x` }],
    ['APPROVAL_REJECTED', { inputResponses: [{ requestId: 'transaction_approval', value: 'DECLINE' }] }],
    ['INVALID_APPROVAL_RESPONSE', { inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }, { requestId: 'extra', value: 'APPROVE' }] }],
    ['APPROVAL_ROUND_EXCEEDED', { mrtrRound: 2 }],
    ['APPROVAL_EXPIRED', { evaluatedAt: '2026-09-12T00:02:30.000Z' }],
    ['APPROVAL_NONCE_CONSUMED', { consumedNonceDigests: [approval.nonceDigest] }],
  ];
  for (const [code, override] of attempts) {
    await assert.rejects(verifyModernApprovalResponse({ ...base, ...override }), (error) => error instanceof TransactionAuthorityError && error.code === code && error.transactionStateAdvanced === false);
  }
});

test('8C invalidates approval across every security binding and mutated prepared/preview payload', async () => {
  const { prepared, preview, approval } = await challenge();
  const request = createModernApprovalRequest(approval);
  const base = {
    prepared, preview, trustedChallenge: approval, requestState: request.requestState,
    inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }],
    authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' },
    clientCapabilities: { elicitation: { form: true } }, mrtrRound: 1,
    evaluatedAt: '2026-09-12T00:01:00.000Z', consumedNonceDigests: [],
  };
  const attempts = [
    { authenticatedContext: { userId: 'user_other', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' } },
    { authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_other', authenticationKind: 'OAUTH_USER' } },
    { prepared: { ...prepared, tenantId: 'tenant_other' } },
    { prepared: { ...prepared, goalRevision: 4 } },
    { prepared: { ...prepared, transactionId: 'tx_other' } },
    { prepared: { ...prepared, target: { ...prepared.target, targetDigest: HASH('7') } } },
    { prepared: { ...prepared, target: { ...prepared.target, documentGeneration: 'doc_other' } } },
    { prepared: { ...prepared, action: { ...prepared.action, actionDigest: HASH('8') } } },
    { preview: { ...preview, previewDigest: HASH('9') } },
  ];
  for (const override of attempts) {
    await assert.rejects(verifyModernApprovalResponse({ ...base, ...override }), (error) => ['APPROVAL_BINDING_MISMATCH', 'PREPARE_DIGEST_MISMATCH'].includes(error.code));
  }
});

test('8C rejects unknown/prototype-bearing/sensitive approval material', async () => {
  const { prepared, preview, approval } = await challenge();
  const request = createModernApprovalRequest(approval);
  const base = {
    prepared, preview, trustedChallenge: approval, requestState: request.requestState,
    inputResponses: [{ requestId: 'transaction_approval', value: 'APPROVE' }],
    authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' },
    clientCapabilities: { elicitation: { form: true } }, mrtrRound: 1,
    evaluatedAt: '2026-09-12T00:01:00.000Z', consumedNonceDigests: [],
  };
  await assert.rejects(verifyModernApprovalResponse({ ...base, modelProse: 'approved' }), (error) => error.code === 'UNTRUSTED_APPROVAL_FIELD');
  await assert.rejects(verifyModernApprovalResponse({ ...base, password: 'never' }), (error) => error.code === 'SENSITIVE_VALUE');
  const polluted = Object.create({ approved: true }); Object.assign(polluted, base);
  await assert.rejects(verifyModernApprovalResponse(polluted), (error) => error.code === 'INVALID_APPROVAL');
});

test('8C 10,000 fuzzed bounded provenance/challenge chains never widen authority or shape', async () => {
  const { prepared } = await preparedAndPreview();
  for (let index = 0; index < 10000; index += 1) {
    const tx = clone(prepared);
    tx.provenance[1].provenanceId = `prov_operand_${index}`;
    tx.provenance[1].valueDigest = `sha256:${index.toString(16).padStart(64, '0')}`;
    delete tx.prepareDigest;
    const rebuilt = await prepareTransaction(tx);
    const report = await validateTransactionProvenance(rebuilt, { evaluatedAt: '2026-09-12T00:01:00.000Z' });
    assert.deepEqual(report.authorityProvenanceIds, ['prov_authority']);
    assert.deepEqual(Object.keys(report), ['schemaVersion', 'transactionId', 'prepareDigest', 'authorityProvenanceIds', 'operandProvenanceIds', 'provenanceDigest']);
    const preview = await createTransactionPreview(rebuilt);
    const approval = await createApprovalChallenge({
      prepared: rebuilt, preview,
      authenticatedContext: { userId: 'user_alpha', oauthClientId: 'oauth_client_chatgpt', authenticationKind: 'OAUTH_USER' },
      approvalChallengeId: `approval_fuzz_${index}`,
      nonceDigest: `sha256:${(index + 10000).toString(16).padStart(64, '0')}`,
      issuedAt: '2026-09-12T00:00:30.000Z', expiresAt: '2026-09-12T00:02:30.000Z', protocolEra: 'MCP_2026_07_28',
    });
    assert.equal(approval.authenticatedUserId, 'user_alpha');
    assert.ok(new TextEncoder().encode(JSON.stringify(approval)).length < 16384);
  }
});

test('8C implementation remains pure and has no transport, persistence, or ambient clock', () => {
  const source = fs.readFileSync(new URL('../lib/transaction-authority.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:globalThis\.(?:fetch|WebSocket|chrome|browser)|Deno\.serve|process\.env|Date\.now|new Date\s*\(|createClient\s*\()/);
  assert.doesNotMatch(source, /supabase|@modelcontextprotocol|openid-client|oauth4webapi|Mcp-Session-Id/i);
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
});
