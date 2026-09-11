import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cancelLedger, createLedger, digestCanonical, reviseLedger } from '../lib/goal-ledger.js';
import { createEvidence, evaluateProof } from '../lib/proof-engine.js';
import { openMinimalHeadStore } from '../lib/minimal-head-store.js';
import {
  ReuseError,
  compareLedgerRevision,
  createDependencyFingerprint,
  reuseEvidenceAcrossRevision,
  validateCarryForwardReceipt,
} from '../lib/revision-reuse.js';

const replay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const NOW = '2026-09-11T00:04:00Z';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function initialLedger(overrides = {}) {
  const input = clone(replay.ledger);
  Object.assign(input, overrides);
  return createLedger(input, { authoritySource: 'USER', now: input.createdAt });
}

async function revise(ledger, changes, now = '2026-09-11T00:05:00Z') {
  return reviseLedger(ledger, {
    expectedRevision: ledger.revision,
    expectedDigest: ledger.ledgerDigest,
    changes,
  }, { authoritySource: 'USER', now });
}

async function evidenceFor(ledger, overrides = {}) {
  return createEvidence({
    schemaVersion: 1,
    evidenceId: 'evidence_candidates',
    category: 'DIRECT_OBSERVATION',
    tenantId: ledger.tenantId,
    goalId: ledger.goalId,
    goalRevision: ledger.revision,
    ledgerDigest: ledger.ledgerDigest,
    claimId: 'claim_candidates_match',
    scopeId: ledger.scope.resourceId,
    observedAt: '2026-09-11T00:03:00Z',
    trust: 'BROWSER_SENSOR',
    predicate: 'OBSERVED_CANDIDATES_SATISFY_CONSTRAINTS',
    supports: true,
    exhaustive: false,
    dependencies: [],
    ...overrides,
  });
}

async function fingerprintFor(evidence, overrides = {}) {
  return createDependencyFingerprint({
    schemaVersion: 1,
    claimId: evidence.claimId,
    scopeId: evidence.scopeId,
    semanticViewRefs: [{ viewId: 'view-results', revision: 7 }],
    entityRefs: [{ logicalId: 'logical-place-a', semanticRevision: 2, state: 'PRESENT' }],
    ...overrides,
  });
}

test('6D dependency fingerprints are deterministic, bounded, and metadata-only', async () => {
  const ledger = await initialLedger();
  const evidence = await evidenceFor(ledger);
  const input = {
    schemaVersion: 1,
    claimId: evidence.claimId,
    scopeId: evidence.scopeId,
    semanticViewRefs: [{ viewId: 'view-results', revision: 7 }],
    entityRefs: [{ logicalId: 'logical-place-a', semanticRevision: 2, state: 'PRESENT' }],
  };
  const first = await createDependencyFingerprint(input);
  const second = await createDependencyFingerprint(clone(input));
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.match(first.fingerprintDigest, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(first), /objective|pageText|screenshot|https?:/i);
  await assert.rejects(
    createDependencyFingerprint({ ...input, semanticViewRefs: [], entityRefs: [] }),
    (error) => error.code === 'MISSING_REFERENCE',
  );
  await assert.rejects(
    createDependencyFingerprint({ ...input, claimId: ['sk', 'a'.repeat(30)].join('-') }),
    (error) => error.code === 'SECRET_LIKE_VALUE',
  );
});

test('6D unrelated semantic mutation carries evidence and preserves proof status', async () => {
  const previous = await initialLedger();
  const next = await revise(previous, { objective: 'Collect the same declared candidate subset with updated wording.' });
  const evidence = await evidenceFor(previous);
  const fingerprint = await fingerprintFor(evidence);
  const before = await evaluateProof(previous, evidence.claimId, [evidence], { now: NOW });
  const result = await reuseEvidenceAcrossRevision(previous, next, [{ evidence, fingerprint }], {
    viewChanges: [{ viewId: 'view-unrelated', fromRevision: 1, toRevision: 2, type: 'UPDATE' }],
    entityChanges: [],
  }, { now: '2026-09-11T00:06:00Z' });
  assert.equal(result.relation, 'EQUIVALENT');
  assert.equal(result.carriedEvidence.length, 1);
  assert.equal(result.receipt.reused.length, 1);
  assert.deepEqual(result.receipt.invalidated, []);
  const after = await evaluateProof(next, evidence.claimId, result.carriedEvidence, { now: '2026-09-11T00:06:00Z' });
  assert.equal(after.status, before.status);
  assert.deepEqual(await validateCarryForwardReceipt(result.receipt), result.receipt);
  const tampered = clone(result.receipt);
  tampered.relation = 'EXPAND';
  await assert.rejects(validateCarryForwardReceipt(tampered), (error) => error.code === 'INVALID_DIGEST');
});

test('6D relevant mutation invalidates only the dependent claim', async () => {
  const previous = await initialLedger();
  const next = await revise(previous, { objective: 'Equivalent revision.' });
  const candidates = await evidenceFor(previous);
  const boundary = await evidenceFor(previous, {
    evidenceId: 'evidence_boundary',
    category: 'BOUNDARY_OBSERVATION',
    claimId: 'claim_feed_scanned',
    predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY',
  });
  const result = await reuseEvidenceAcrossRevision(previous, next, [
    { evidence: candidates, fingerprint: await fingerprintFor(candidates) },
    { evidence: boundary, fingerprint: await fingerprintFor(boundary, { semanticViewRefs: [{ viewId: 'view-boundary', revision: 3 }], entityRefs: [] }) },
  ], {
    viewChanges: [{ viewId: 'view-results', fromRevision: 7, toRevision: 8, type: 'UPDATE' }],
    entityChanges: [],
  }, { now: '2026-09-11T00:06:00Z' });
  assert.deepEqual(result.carriedEvidence.map((item) => item.evidenceId), ['evidence_boundary']);
  assert.deepEqual(result.receipt.invalidated, [{ evidenceId: 'evidence_candidates', reason: 'DEPENDENCY_INVALIDATED' }]);
  await assert.rejects(
    reuseEvidenceAcrossRevision(previous, next, [{ evidence: candidates, fingerprint: await fingerprintFor(candidates) }], {
      viewChanges: [
        { viewId: 'view-results', fromRevision: 7, toRevision: 7, type: 'NO_RELEVANT_CHANGE' },
        { viewId: 'view-results', fromRevision: 7, toRevision: 8, type: 'UPDATE' },
      ],
      entityChanges: [],
    }, { now: '2026-09-11T00:06:00Z' }),
    (error) => error.code === 'DUPLICATE_ID',
  );
});

test('6D narrowing reuses exactly retained identical claims', async () => {
  const previous = await initialLedger();
  const retainedClaim = clone(previous.claims.find((item) => item.claimId === 'claim_candidates_match'));
  const next = await revise(previous, { claims: [retainedClaim] });
  assert.equal(compareLedgerRevision(previous, next), 'NARROW');
  const retained = await evidenceFor(previous);
  const removed = await evidenceFor(previous, {
    evidenceId: 'evidence_removed_claim',
    category: 'BOUNDARY_OBSERVATION',
    claimId: 'claim_feed_scanned',
    predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY',
  });
  const result = await reuseEvidenceAcrossRevision(previous, next, [
    { evidence: retained, fingerprint: await fingerprintFor(retained) },
    { evidence: removed, fingerprint: await fingerprintFor(removed, { semanticViewRefs: [{ viewId: 'view-boundary', revision: 3 }], entityRefs: [] }) },
  ], { viewChanges: [], entityChanges: [] }, { now: '2026-09-11T00:06:00Z' });
  assert.deepEqual(result.carriedEvidence.map((item) => item.evidenceId), ['evidence_candidates']);
  assert.deepEqual(result.receipt.invalidated, [{ evidenceId: 'evidence_removed_claim', reason: 'CLAIM_NOT_RETAINED' }]);
});

test('6D expanded goal never inherits evidence or completion', async () => {
  const oneClaimInput = clone(replay.ledger);
  oneClaimInput.claims = [clone(oneClaimInput.claims[1])];
  const previous = await createLedger(oneClaimInput, { authoritySource: 'USER', now: oneClaimInput.createdAt });
  const next = await revise(previous, { claims: clone(replay.ledger.claims) });
  assert.equal(compareLedgerRevision(previous, next), 'EXPAND');
  const evidence = await evidenceFor(previous);
  const result = await reuseEvidenceAcrossRevision(previous, next, [{ evidence, fingerprint: await fingerprintFor(evidence) }], {
    viewChanges: [], entityChanges: [],
  }, { now: '2026-09-11T00:06:00Z' });
  assert.deepEqual(result.carriedEvidence, []);
  assert.deepEqual(result.receipt.invalidated, [{ evidenceId: evidence.evidenceId, reason: 'EXPANDED_GOAL_NO_COMPLETENESS_REUSE' }]);
});

test('6D reorder is safe while removal, ambiguity, and expiry invalidate deterministically', async () => {
  const previous = await initialLedger();
  const next = await revise(previous, { objective: 'Equivalent revision.' });
  const evidence = await evidenceFor(previous);
  const fingerprint = await fingerprintFor(evidence);
  for (const type of ['MOVE', 'NO_RELEVANT_CHANGE']) {
    const safe = await reuseEvidenceAcrossRevision(previous, next, [{ evidence, fingerprint }], {
      viewChanges: [], entityChanges: [{ logicalId: 'logical-place-a', fromRevision: 2, toRevision: 2, type }],
    }, { now: '2026-09-11T00:06:00Z' });
    assert.equal(safe.carriedEvidence.length, 1, type);
  }
  for (const type of ['REMOVE', 'AMBIGUOUS']) {
    const invalid = await reuseEvidenceAcrossRevision(previous, next, [{ evidence, fingerprint }], {
      viewChanges: [], entityChanges: [{ logicalId: 'logical-place-a', fromRevision: 2, toRevision: 3, type }],
    }, { now: '2026-09-11T00:06:00Z' });
    assert.equal(invalid.carriedEvidence.length, 0, type);
    assert.equal(invalid.receipt.invalidated[0].reason, type === 'AMBIGUOUS' ? 'ENTITY_AMBIGUOUS' : 'DEPENDENCY_INVALIDATED');
  }
  const expired = await reuseEvidenceAcrossRevision(previous, next, [{ evidence, fingerprint }], {
    viewChanges: [], entityChanges: [],
  }, { now: '2026-09-11T00:20:00Z' });
  assert.equal(expired.carriedEvidence.length, 0);
  assert.equal(expired.receipt.invalidated[0].reason, 'EXPIRED');
});

test('6D rejects stale, skipped, and forked ledger transitions', async () => {
  const previous = await initialLedger();
  const next = await revise(previous, { objective: 'Equivalent revision.' });
  const evidence = await evidenceFor(previous);
  const binding = [{ evidence, fingerprint: await fingerprintFor(evidence) }];
  await assert.rejects(
    reuseEvidenceAcrossRevision(next, previous, binding, { viewChanges: [], entityChanges: [] }, { now: '2026-09-11T00:06:00Z' }),
    (error) => error instanceof ReuseError && error.code === 'STALE_REVISION',
  );
  const forkInput = clone(next);
  forkInput.parentDigest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(
    reuseEvidenceAcrossRevision(previous, forkInput, binding, { viewChanges: [], entityChanges: [] }, { now: '2026-09-11T00:06:00Z' }),
    (error) => error.code === 'INVALID_DIGEST' || error.code === 'FORKED_REVISION',
  );
});

test('6D minimal head survives restart and stores metadata only', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-head-test-'));
  const databasePath = path.join(directory, 'heads.sqlite');
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = await initialLedger();
  let store = openMinimalHeadStore(databasePath);
  await store.commitHead(ledger, { now: ledger.createdAt });
  store.close();

  store = openMinimalHeadStore(databasePath);
  assert.deepEqual(store.verifyHeadToken({
    tenantId: ledger.tenantId,
    goalId: ledger.goalId,
    revision: ledger.revision,
    digest: ledger.ledgerDigest,
  }, { now: NOW }), { valid: true, status: 'OPEN' });
  assert.deepEqual(store.columns(), [
    'tenant_id', 'goal_id', 'head_revision', 'head_digest', 'status', 'created_at', 'updated_at', 'expires_at',
  ]);
  store.close();
  assert.doesNotMatch(fs.readFileSync(databasePath).toString('utf8'), /Collect candidates|OBSERVED_CANDIDATES|constraint_min_score/);
});

test('6D minimal head rejects stale/forked tokens and survives cancel or expiry', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-head-state-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = openMinimalHeadStore(path.join(directory, 'heads.sqlite'));
  const first = await initialLedger();
  await store.commitHead(first, { now: first.createdAt });
  const second = await revise(first, { objective: 'Equivalent revision.' });
  await store.commitHead(second, { expectedRevision: first.revision, expectedDigest: first.ledgerDigest, now: '2026-09-11T00:05:00Z' });
  assert.equal(store.verifyHeadToken({ tenantId: first.tenantId, goalId: first.goalId, revision: 1, digest: first.ledgerDigest }, { now: NOW }).reason, 'STALE_REVISION');
  assert.equal(store.verifyHeadToken({ tenantId: first.tenantId, goalId: first.goalId, revision: 2, digest: first.ledgerDigest }, { now: NOW }).reason, 'FORKED_REVISION');

  const cancelled = await cancelLedger(second, { expectedRevision: 2, expectedDigest: second.ledgerDigest }, { now: '2026-09-11T00:06:00Z' });
  await store.commitHead(cancelled, { expectedRevision: 2, expectedDigest: second.ledgerDigest, now: '2026-09-11T00:06:00Z' });
  assert.equal(store.verifyHeadToken({ tenantId: cancelled.tenantId, goalId: cancelled.goalId, revision: 3, digest: cancelled.ledgerDigest }, { now: NOW }).reason, 'TERMINAL_LEDGER');
  const revivedBody = clone(cancelled);
  delete revivedBody.ledgerDigest;
  revivedBody.revision = 4;
  revivedBody.parentDigest = cancelled.ledgerDigest;
  revivedBody.status = 'OPEN';
  const revived = { ...revivedBody, ledgerDigest: await digestCanonical(revivedBody) };
  await assert.rejects(
    store.commitHead(revived, { expectedRevision: 3, expectedDigest: cancelled.ledgerDigest, now: '2026-09-11T00:07:00Z' }),
    (error) => error.code === 'TERMINAL_LEDGER',
  );
  store.close();

  const expiringInput = clone(replay.ledger);
  expiringInput.goalId = 'goal_fixture_expiring';
  expiringInput.expiresAt = '2026-09-11T00:10:00Z';
  expiringInput.authorizations[0].expiresAt = expiringInput.expiresAt;
  const expiring = await createLedger(expiringInput, { authoritySource: 'USER', now: expiringInput.createdAt });
  const expiryStore = openMinimalHeadStore(path.join(directory, 'expiry.sqlite'));
  await expiryStore.commitHead(expiring, { now: expiring.createdAt });
  assert.equal(expiryStore.verifyHeadToken({ tenantId: expiring.tenantId, goalId: expiring.goalId, revision: 1, digest: expiring.ledgerDigest }, { now: '2026-09-11T00:10:00Z' }).reason, 'EXPIRED');
  expiryStore.close();
});
