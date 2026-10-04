// @last-edited: 2026-10-04 11:10 UTC.
// @title: goal-ledger.test — ledger.test — Test.
// @context: Test.
// @state: complete milestone 6E secure ledger integration.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:fs, node:test, goal-ledger.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  LedgerError,
  cancelLedger,
  canonicalJson,
  createLedger,
  expireLedger,
  inspectLedger,
  reviseLedger,
  validateLedger,
} from '../lib/goal-ledger.js';

const replay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-contract-v1.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../supabase/functions/_shared/goal-ledger.js', import.meta.url), 'utf8');
const CREATED_AT = '2026-09-11T00:00:00Z';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function assertLedgerError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof LedgerError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test('6B creates the frozen fixture deterministically without mutating input', async () => {
  const input = clone(replay.ledger);
  const before = JSON.stringify(input);
  const ledger = await createLedger(input, { authoritySource: 'USER', now: CREATED_AT });

  assert.equal(JSON.stringify(input), before);
  assert.equal(ledger.ledgerDigest, replay.expectedLedgerDigest);
  assert.equal(ledger.revision, 1);
  assert.equal(ledger.parentDigest, null);
  assert.equal(ledger.status, 'OPEN');
  assert.equal(Object.isFrozen(ledger), true);
  assert.equal(Object.isFrozen(ledger.constraints), true);
  assert.deepEqual(await validateLedger(ledger, { authoritySource: 'USER', now: CREATED_AT }), ledger);
});

test('6B canonicalization normalizes strings and rejects unsupported values', () => {
  assert.equal(canonicalJson({ z: 'e\u0301', a: true }), '{"a":true,"z":"é"}');
  assert.throws(() => canonicalJson({ unsafe: 1.5 }), (error) => error.code === 'UNSUPPORTED_CANONICAL_VALUE');
  assert.throws(() => canonicalJson({ unsafe: undefined }), (error) => error.code === 'UNSUPPORTED_CANONICAL_VALUE');
  assert.throws(() => canonicalJson({ 'é': true }), (error) => error.code === 'INVALID_CANONICAL_KEY');
});

test('6B enforces strict schemas, bounds, and credential-like rejection', async () => {
  const unknown = clone(replay.ledger);
  unknown.unexpected = true;
  await assertLedgerError(createLedger(unknown, { authoritySource: 'USER', now: CREATED_AT }), 'UNKNOWN_FIELD');

  const longObjective = clone(replay.ledger);
  longObjective.objective = 'x'.repeat(contract.limits.objectiveUtf8Bytes + 1);
  await assertLedgerError(createLedger(longObjective, { authoritySource: 'USER', now: CREATED_AT }), 'OVER_LIMIT');

  const tooManyConstraints = clone(replay.ledger);
  tooManyConstraints.constraints = Array.from({ length: contract.limits.constraints + 1 }, (_, index) => ({
    constraintId: `constraint_${index}`,
    kind: 'INVARIANT',
    claimField: 'focusChanges',
    operator: 'EQ',
    integerValue: 0,
  }));
  await assertLedgerError(createLedger(tooManyConstraints, { authoritySource: 'USER', now: CREATED_AT }), 'OVER_LIMIT');

  const secretField = clone(replay.ledger);
  secretField.authorizations[0].password = 'FIXTURE_ONLY';
  await assertLedgerError(createLedger(secretField, { authoritySource: 'USER', now: CREATED_AT }), 'SECRET_LIKE_VALUE');

  await assertLedgerError(
    createLedger(replay.ledger, { authoritySource: 'PAGE_CONTENT', now: CREATED_AT }),
    'UNTRUSTED_INTENT_SOURCE',
  );
});

test('6B revisions preserve identity, form a digest lineage, and reject stale or forked heads', async () => {
  const first = await createLedger(replay.ledger, { authoritySource: 'USER', now: CREATED_AT });
  const second = await reviseLedger(first, {
    expectedRevision: 1,
    expectedDigest: first.ledgerDigest,
    changes: { objective: 'Collect only the declared candidate subset.' },
  }, { authoritySource: 'USER', now: '2026-09-11T00:01:00Z' });

  assert.equal(second.goalId, first.goalId);
  assert.equal(second.tenantId, first.tenantId);
  assert.equal(second.revision, 2);
  assert.equal(second.parentDigest, first.ledgerDigest);
  assert.notEqual(second.ledgerDigest, first.ledgerDigest);
  assert.equal(second.status, 'OPEN');

  await assertLedgerError(reviseLedger(second, {
    expectedRevision: 1,
    expectedDigest: second.ledgerDigest,
    changes: { objective: 'stale' },
  }, { authoritySource: 'USER', now: '2026-09-11T00:02:00Z' }), 'STALE_REVISION');

  await assertLedgerError(reviseLedger(second, {
    expectedRevision: 2,
    expectedDigest: first.ledgerDigest,
    changes: { objective: 'forked' },
  }, { authoritySource: 'USER', now: '2026-09-11T00:02:00Z' }), 'FORKED_REVISION');

  await assertLedgerError(reviseLedger(second, {
    expectedRevision: 3,
    expectedDigest: second.ledgerDigest,
    changes: { objective: 'future fork' },
  }, { authoritySource: 'USER', now: '2026-09-11T00:02:00Z' }), 'FORKED_REVISION');
});

test('6B never broadens authorization without a fresh user authorization', async () => {
  const first = await createLedger(replay.ledger, { authoritySource: 'USER', now: CREATED_AT });
  const broadened = clone(first.authorizations);
  broadened.push({
    authorizationId: 'authorization_external_write',
    operationClass: 'CONSEQUENTIAL_EXTERNAL_ACTION',
    scopeId: 'resource_fixture_map_001',
    expiresAt: '2026-09-12T00:00:00Z',
  });

  await assertLedgerError(reviseLedger(first, {
    expectedRevision: first.revision,
    expectedDigest: first.ledgerDigest,
    changes: { authorizations: broadened },
  }, { authoritySource: 'USER', now: '2026-09-11T00:01:00Z' }), 'IMPLICIT_AUTHORITY_BROADENING');

  await assertLedgerError(reviseLedger(first, {
    expectedRevision: first.revision,
    expectedDigest: first.ledgerDigest,
    freshUserAuthorization: true,
    changes: { authorizations: broadened },
  }, { authoritySource: 'PAGE_CONTENT', now: '2026-09-11T00:01:00Z' }), 'UNTRUSTED_INTENT_SOURCE');

  const accepted = await reviseLedger(first, {
    expectedRevision: first.revision,
    expectedDigest: first.ledgerDigest,
    freshUserAuthorization: true,
    changes: { authorizations: broadened },
  }, { authoritySource: 'USER', now: '2026-09-11T00:01:00Z' });
  assert.equal(accepted.authorizations.length, 2);
});

test('6B cancel and expire are explicit terminal revisions', async () => {
  const first = await createLedger(replay.ledger, { authoritySource: 'USER', now: CREATED_AT });
  const cancelled = await cancelLedger(first, {
    expectedRevision: 1,
    expectedDigest: first.ledgerDigest,
  }, { now: '2026-09-11T00:01:00Z' });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.revision, 2);
  assert.equal(cancelled.parentDigest, first.ledgerDigest);
  await assertLedgerError(reviseLedger(cancelled, {
    expectedRevision: 2,
    expectedDigest: cancelled.ledgerDigest,
    changes: { objective: 'cannot revive' },
  }, { authoritySource: 'USER', now: '2026-09-11T00:02:00Z' }), 'TERMINAL_LEDGER');

  await assertLedgerError(expireLedger(first, {
    expectedRevision: 1,
    expectedDigest: first.ledgerDigest,
  }, { now: '2026-09-11T23:59:59Z' }), 'NOT_EXPIRED');

  const expired = await expireLedger(first, {
    expectedRevision: 1,
    expectedDigest: first.ledgerDigest,
  }, { now: '2026-09-12T00:00:00Z' });
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.revision, 2);
});

test('6B safe inspection exposes bounded metadata rather than goal contents', async () => {
  const ledger = await createLedger(replay.ledger, { authoritySource: 'USER', now: CREATED_AT });
  const inspected = inspectLedger(ledger);
  assert.deepEqual(Object.keys(inspected).sort(), [
    'authorizationCount', 'claimCount', 'constraintCount', 'createdAt', 'evidenceRequirementCount',
    'expiresAt', 'goalId', 'ledgerDigest', 'nonGoalCount', 'revision', 'scopeKind', 'status', 'tenantId',
  ].sort());
  assert.equal(JSON.stringify(inspected).includes(ledger.objective), false);
  assert.equal(JSON.stringify(inspected).includes(ledger.nonGoals[0]), false);
  assert.equal(inspected.constraintCount, ledger.constraints.length);
});

test('6B 10,000-step deterministic revision sequence remains bounded and linear', { timeout: 30000 }, async () => {
  let ledger = await createLedger(replay.ledger, { authoritySource: 'USER', now: CREATED_AT });
  const firstGoalId = ledger.goalId;
  for (let index = 0; index < 10_000; index += 1) {
    const previous = ledger;
    ledger = await reviseLedger(previous, {
      expectedRevision: previous.revision,
      expectedDigest: previous.ledgerDigest,
      changes: { objective: `Bounded fixture revision ${index + 2}` },
    }, { authoritySource: 'USER', now: '2026-09-11T00:01:00Z' });
    assert.equal(ledger.parentDigest, previous.ledgerDigest);
    assert.equal(ledger.goalId, firstGoalId);
    assert.ok(Buffer.byteLength(canonicalJson(ledger), 'utf8') <= contract.limits.ledgerTokenBytes);
  }
  assert.equal(ledger.revision, 10_001);
});

test('6B ledger core stays environment-neutral and side-effect free', () => {
  assert.doesNotMatch(source, /chrome\.|browser\.|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|supabase|process\.env|Deno\.|node:/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|writeFile|appendFile/);
});

test('6B rejects duplicate IDs, missing requirements, and immutable-field smuggling', async () => {
  const duplicate = clone(replay.ledger);
  duplicate.claims.push(clone(duplicate.claims[0]));
  await assertLedgerError(createLedger(duplicate, { authoritySource: 'USER', now: CREATED_AT }), 'DUPLICATE_ID');

  const missing = clone(replay.ledger);
  missing.claims[0].evidenceRequirementIds = ['requirement_missing'];
  await assertLedgerError(createLedger(missing, { authoritySource: 'USER', now: CREATED_AT }), 'MISSING_REFERENCE');

  const first = await createLedger(replay.ledger, { authoritySource: 'USER', now: CREATED_AT });
  await assertLedgerError(reviseLedger(first, {
    expectedRevision: 1,
    expectedDigest: first.ledgerDigest,
    changes: { goalId: 'goal_smuggled' },
  }, { authoritySource: 'USER', now: '2026-09-11T00:01:00Z' }), 'UNKNOWN_FIELD');
});
