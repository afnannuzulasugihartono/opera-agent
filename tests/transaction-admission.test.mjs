// Last edited: 2026-10-04 17:52. Title: transaction-admission.test — Test. Now: drop the milestone suffix from transaction test files and titles.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { cancelLedger, createLedger, digestCanonical } from '../lib/goal-ledger.js';
import { prepareTransaction } from '../lib/transaction-prepare.js';
import { createTransactionAdmission } from '../lib/transaction-admission-8d.js';

const NOW = '2026-09-12T00:01:00.000Z';
const example = JSON.parse(fs.readFileSync(new URL('./fixtures/transaction-examples-v1.json', import.meta.url))).validTransactions[0];
const ledgerExample = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url))).ledger;

async function fixture() {
  const raw = structuredClone(ledgerExample);
  Object.assign(raw, { tenantId: 'tenant_alpha', goalId: 'goal_alpha', createdAt: example.preparedAt, expiresAt: example.expiresAt });
  raw.scope = { kind: 'TAB', resourceId: '42' };
  raw.authorizations = [{ authorizationId: 'auth_8d', operationClass: 'SINGLE_BROWSER_MUTATION', scopeId: '42', expiresAt: example.expiresAt }];
  const ledger = await createLedger(raw, { authoritySource: 'USER', now: NOW });
  const candidate = structuredClone(example);
  delete candidate.prepareDigest;
  candidate.goalRevision = ledger.revision;
  candidate.enforcementMode = 'DARK';
  candidate.action.argumentsDigest = await digestCanonical({ ref: 'oa_test' });
  candidate.action.actionDigest = await digestCanonical({ descriptorId: candidate.action.descriptorId, method: candidate.action.method, argumentsDigest: candidate.action.argumentsDigest });
  candidate.provenance[0].sourceDigest = ledger.ledgerDigest;
  candidate.provenance[0].valueDigest = await digestCanonical(ledger.authorizations[0]);
  for (const record of candidate.provenance) record.goalRevision = ledger.revision;
  candidate.provenance[1].transformChain = ['IDENTITY'];
  candidate.provenance[1].valueDigest = await digestCanonical('oa_test');
  const prepared = await prepareTransaction(candidate);
  const identity = { userId: 'user_alpha', tenantId: 'tenant_alpha', acceptanceIdentity: 'synthetic_8d' };
  const grant = { authorizationId: 'auth_8d', operationClass: 'SINGLE_BROWSER_MUTATION', scopeId: '42', actionDigest: prepared.action.actionDigest, targetDigest: prepared.target.targetDigest };
  const state = { ledger, identity, grant, target: prepared.target, mode: 'DARK', resolved: structuredClone(prepared.provenance[1]) };
  const calls = [];
  const admission = createTransactionAdmission({
    authenticate: async () => { calls.push('authenticate'); return state.identity; },
    loadPolicy: async () => state.mode,
    loadCurrentLedger: async () => state.ledger,
    loadCurrentTarget: async () => state.target,
    authorizeExactAction: async () => state.grant,
    resolveOperand: async () => state.resolved,
  });
  const request = { prepared, arguments: { ref: 'oa_test' }, operandBindings: { ref: 'prov_operand' } };
  return { admission, request, state, calls };
}

test('admission is default-OFF, local-only, digest-only and deeply immutable', async () => {
  const f = await fixture();
  const result = await f.admission(f.request, 'opaque credential', NOW);
  assert.equal(result.transactionId, f.request.prepared.transactionId);
  assert.match(result.commitKey, /^tx1:[0-9a-f]{64}$/);
  assert.equal(result.browserDispatchAllowed, false);
  assert.equal(JSON.stringify(result).includes('oa_test'), false);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(result, await f.admission(f.request, 'opaque credential', NOW));
  f.state.mode = undefined;
  await assert.rejects(f.admission(f.request, '', NOW), { code: 'TRANSACTION_DISABLED' });
});

test('OFF/ENFORCED and ordinary identities cannot enter dark admission', async () => {
  for (const mode of ['OFF', 'ENFORCED', 'invalid']) {
    const f = await fixture(); f.state.mode = mode;
    await assert.rejects(f.admission(f.request, '', NOW), { code: 'TRANSACTION_DISABLED' });
  }
  for (const identity of [null, { userId: 'user_alpha', tenantId: 'tenant_alpha' }, { userId: 'other', tenantId: 'other', acceptanceIdentity: 'synthetic_8d' }]) {
    const f = await fixture(); f.state.identity = identity;
    await assert.rejects(f.admission(f.request, '', NOW));
  }
});

test('request-supplied identity, mode, grant and executor authority are rejected', async () => {
  for (const field of ['identity', 'authenticatedContext', 'mode', 'grant', 'internalExecutorAuthority']) {
    const f = await fixture(); f.request[field] = f.state.identity;
    await assert.rejects(f.admission(f.request, '', NOW), { code: 'INVALID_ADMISSION' });
    assert.equal(f.calls.length, 0);
  }
});

test('current ledger head rejects cancellation, foreign tenant, stale revision and forged source', async () => {
  for (const change of ['cancel', 'foreign', 'revision', 'source']) {
    const f = await fixture();
    if (change === 'cancel') f.state.ledger = await cancelLedger(f.state.ledger, {
      expectedRevision: f.state.ledger.revision, expectedDigest: f.state.ledger.ledgerDigest,
    }, { authoritySource: 'USER', now: NOW });
    if (change === 'foreign') f.state.ledger = { ...f.state.ledger, tenantId: 'other' };
    if (change === 'revision') f.state.ledger = { ...f.state.ledger, revision: 2 };
    if (change === 'source') {
      const tx = structuredClone(f.request.prepared); delete tx.prepareDigest;
      tx.provenance[0].sourceDigest = `sha256:${'a'.repeat(64)}`;
      f.request.prepared = await prepareTransaction(tx);
    }
    await assert.rejects(f.admission(f.request, '', NOW));
  }
});

test('exact trusted grant must narrow live ledger permission and bind action/target', async () => {
  for (const field of ['authorizationId', 'operationClass', 'scopeId', 'actionDigest', 'targetDigest']) {
    const f = await fixture(); f.state.grant = { ...f.state.grant, [field]: 'wrong' };
    await assert.rejects(f.admission(f.request, '', NOW), { code: 'AUTHORITY_NOT_RESOLVED' });
  }
  const f = await fixture(); f.state.grant = null;
  await assert.rejects(f.admission(f.request, '', NOW), { code: 'AUTHORITY_NOT_RESOLVED' });
});

test('actual arguments and recomputed action digest cannot diverge from prepare', async () => {
  const f = await fixture(); f.request.arguments.ref = 'changed';
  await assert.rejects(f.admission(f.request, '', NOW), { code: 'ACTION_MISMATCH' });
  const g = await fixture();
  const tx = structuredClone(g.request.prepared); delete tx.prepareDigest;
  tx.action.actionDigest = `sha256:${'a'.repeat(64)}`;
  g.request.prepared = await prepareTransaction(tx);
  await assert.rejects(g.admission(g.request, '', NOW), { code: 'ACTION_MISMATCH' });
});

test('every actual argument must have exact attested operand coverage', async () => {
  for (const mutation of ['missing', 'extra', 'authority', 'value', 'source', 'attestation']) {
    const f = await fixture();
    if (mutation === 'missing') f.request.operandBindings = {};
    if (mutation === 'extra') f.request.operandBindings.extra = 'prov_operand';
    if (mutation === 'authority') f.request.operandBindings.ref = 'prov_authority';
    if (mutation === 'value') f.state.resolved.valueDigest = `sha256:${'a'.repeat(64)}`;
    if (mutation === 'source') f.state.resolved.sourceDigest = `sha256:${'a'.repeat(64)}`;
    if (mutation === 'attestation') f.state.resolved = null;
    await assert.rejects(f.admission(f.request, '', NOW), { code: 'OPERAND_NOT_RESOLVED' });
  }
});

test('document/target changes and expired prepared windows fail closed', async () => {
  for (const field of ['deviceId', 'tabId', 'documentGeneration', 'targetDigest']) {
    const f = await fixture(); f.state.target = { ...f.state.target, [field]: 'wrong' };
    await assert.rejects(f.admission(f.request, '', NOW), { code: 'TARGET_MISMATCH' });
  }
  const f = await fixture();
  await assert.rejects(f.admission(f.request, '', f.request.prepared.expiresAt), { code: 'TRANSACTION_EXPIRED' });
});

test('sensitive/nested unsafe arguments are rejected before authenticated adapters run', async () => {
  for (const args of [{ password: 'no' }, { ref: { otp: 'no' } }, { ref: 'x'.repeat(65537) }]) {
    const f = await fixture(); f.request.arguments = args;
    await assert.rejects(f.admission(f.request, '', NOW));
    assert.equal(f.calls.length, 0);
  }
});

test('admission snapshots mutable request data before asynchronous trust checks', async () => {
  const f = await fixture();
  const pending = f.admission(f.request, '', NOW);
  f.request.arguments.ref = 'changed_after_start';
  assert.equal((await pending).prepareDigest, f.request.prepared.prepareDigest);
});

test('narrower declared count/size budgets are enforced during admission', async () => {
  const f = await fixture();
  const tx = structuredClone(f.request.prepared); delete tx.prepareDigest;
  tx.budgets.provenanceRecords = 1;
  f.request.prepared = await prepareTransaction(tx);
  await assert.rejects(f.admission(f.request, '', NOW), { code: 'LIMIT_REACHED' });
  tx.budgets.preparedTransactionBytes = 1;
  await assert.rejects(prepareTransaction(tx), { code: 'OVER_LIMIT' });
});

test('missing trusted adapters and transformed source mismatch fail closed', async () => {
  assert.throws(() => createTransactionAdmission({}), { code: 'INVALID_ADAPTERS' });
  const f = await fixture();
  f.state.resolved = { ...f.state.resolved, transformChain: ['TRIM'] };
  await assert.rejects(f.admission(f.request, '', NOW), { code: 'OPERAND_NOT_RESOLVED' });
});
