import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudFixtureData8D } from './helpers/transaction-cloud-fixture-8d.mjs';
import { transactionFixture } from './helpers/transaction-dark-fixture.mjs';
import { validateLedger, digestCanonical } from '../lib/goal-ledger.js';
import { validatePreparedTransaction } from '../lib/transaction-prepare.js';
import { validateTransactionProvenance } from '../lib/transaction-authority.js';
import { sealLedgerToken, openLedgerToken } from '../lib/ledger-token.js';

const options = { namespace: '12345678-1234-4234-8234-123456789abc', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', preparedAt: '2026-09-14T00:00:00.000Z' };
test('8D cloud fixture binds UUID tenant and complete production goal-head metadata', async () => {
  const f = await createCloudFixtureData8D(options);
  const ledger = await validateLedger(f.ledger, { now: '2026-09-14T00:01:00.000Z' });
  await validatePreparedTransaction(f.request.prepared);
  assert.equal(f.principal.tenant_id, options.namespace);
  assert.equal(f.principal.user_id, options.userId);
  assert.deepEqual(f.goalHead, { tenant_id: options.namespace, goal_id: ledger.goalId, head_revision: ledger.revision, head_digest: ledger.ledgerDigest, status: ledger.status, created_at: ledger.createdAt, updated_at: ledger.createdAt, expires_at: ledger.expiresAt });
  assert.equal(f.binding.goal_id, ledger.goalId);
  assert.equal(f.binding.metadata.ledgerDigest, ledger.ledgerDigest);
  assert.equal(f.binding.metadata.preparedDigest, f.request.prepared.prepareDigest);
  assert.equal(f.binding.metadata.mode, 'DARK');
});
test('8D cloud fixture uses inert synthetic target with matching provenance and grant', async () => {
  const f = await createCloudFixtureData8D(options), tx = f.request.prepared;
  assert.match(tx.target.deviceId, /^m8d_fixture_/);
  assert.equal(tx.target.tabId, 0);
  assert.equal(tx.target.targetDigest, await digestCanonical({ deviceId: tx.target.deviceId, tabId: 0, documentGeneration: tx.target.documentGeneration }));
  assert.equal(tx.provenance[1].deviceId, tx.target.deviceId);
  assert.equal(tx.provenance[1].tabId, 0);
  assert.equal(tx.provenance[1].documentGeneration, tx.target.documentGeneration);
  assert.equal(f.binding.metadata.grant.scopeId, '0');
  assert.equal(f.binding.metadata.grant.targetDigest, tx.target.targetDigest);
  assert.equal(f.browserDispatchAllowed, false);
  assert.equal(tx.provenance[1].observedAt, options.preparedAt);
  await validateTransactionProvenance(tx, { evaluatedAt: options.preparedAt });
});
test('8D cloud fixture is deterministic, immutable and cleanup ownership is exact', async () => {
  const a = await createCloudFixtureData8D(options), b = await createCloudFixtureData8D(options);
  assert.deepEqual(a, b);
  assert.throws(() => { a.request.prepared.target.tabId = 42; }, TypeError);
  const other = await createCloudFixtureData8D({ ...options, namespace: '22345678-1234-4234-8234-123456789abc' });
  assert.notEqual(a.request.prepared.prepareDigest, other.request.prepared.prepareDigest);
  assert.notEqual(a.goalHead.goal_id, other.goalHead.goal_id);
  assert.notEqual(a.request.prepared.target.deviceId, other.request.prepared.target.deviceId);
  assert.deepEqual(a.cleanup, { tenantId: options.namespace, actorId: a.principal.actor_id, goalId: a.goalHead.goal_id, transactionId: a.request.prepared.transactionId });
});
test('8D cloud fixture rejects missing/unknown credentials and invalid scope inputs', async () => {
  for (const input of [null, {}, { ...options, namespace: 'tenant_alpha' }, { ...options, userId: 'user_alpha' }, { ...options, preparedAt: 'tomorrow' }, { ...options, accessToken: 'do-not-accept' }, { ...options, target: { deviceId: 'opera', tabId: 42 } }]) {
    await assert.rejects(createCloudFixtureData8D(input), { message: 'INVALID_CLOUD_FIXTURE_CONFIGURATION' });
  }
});
test('8D cloud fixture ledger seals locally and leaves existing native fixture unchanged', async () => {
  const before = await transactionFixture(), f = await createCloudFixtureData8D(options), key = new Uint8Array(32).fill(11);
  const token = await sealLedgerToken(f.ledger, key, { requestId: 'synthetic_cloud_fixture', issuedAt: '2026-09-14T00:01:00.000Z' });
  assert.deepEqual((await openLedgerToken(token, key, { now: '2026-09-14T00:01:00.000Z' })).ledger, f.ledger);
  assert.deepEqual((await transactionFixture()).request, before.request);
});
