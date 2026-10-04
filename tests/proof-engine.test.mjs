// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: proof-engine.test — engine.test — Test.
// @context: Test.
// @state: complete milestone 6E secure ledger integration.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:fs, node:test, goal-ledger, proof-engine.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createLedger } from '../lib/goal-ledger.js';
import { ProofError, createEvidence, evaluateProof, validateProof } from '../lib/proof-engine.js';

const ledgerReplay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const proofReplay = JSON.parse(fs.readFileSync(new URL('./fixtures/proof-replay-v1.json', import.meta.url), 'utf8'));
const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-contract-v1.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../supabase/functions/_shared/proof-engine.js', import.meta.url), 'utf8');
const NOW = '2026-09-11T00:04:00Z';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fixtureLedger(changes = {}) {
  const input = clone(ledgerReplay.ledger);
  Object.assign(input, changes);
  return createLedger(input, { authoritySource: 'USER', now: input.createdAt });
}

function evidenceInput(ledger, overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceId: 'evidence_fixture_001',
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
  };
}

async function makeEvidence(ledger, overrides = {}) {
  return createEvidence(evidenceInput(ledger, overrides));
}

test('6C creates and validates immutable canonical evidence', async () => {
  const ledger = await fixtureLedger();
  const input = evidenceInput(ledger);
  const before = JSON.stringify(input);
  const evidence = await createEvidence(input);
  assert.equal(JSON.stringify(input), before);
  assert.match(evidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.dependencies), true);
  assert.deepEqual(await createEvidence(input), evidence);

  const parsed = clone(evidence);
  const parsedProof = await evaluateProof(ledger, 'claim_candidates_match', [parsed], { now: NOW });
  assert.deepEqual(parsedProof.evidenceRefs, [evidence.evidenceId]);
  parsed.supports = false;
  const tamperedProof = await evaluateProof(ledger, 'claim_candidates_match', [parsed], { now: NOW });
  assert.equal(tamperedProof.status, 'UNKNOWN');
  assert.deepEqual(tamperedProof.rejectedEvidenceRefs, [{ evidenceId: evidence.evidenceId, reason: 'INVALID_DIGEST' }]);
});

test('6C rejects malformed evidence and trust-category mismatches', async () => {
  const ledger = await fixtureLedger();
  await assert.rejects(createEvidence(evidenceInput(ledger, { unexpected: true })), (error) => error instanceof ProofError && error.code === 'UNKNOWN_FIELD');
  await assert.rejects(createEvidence(evidenceInput(ledger, { trust: 'AUTHENTICATED_USER' })), (error) => error.code === 'UNTRUSTED_EVIDENCE');
  const syntheticSecretMarker = ['sk', 'a'.repeat(30)].join('-');
  await assert.rejects(createEvidence(evidenceInput(ledger, { predicate: syntheticSecretMarker })), (error) => error.code === 'SECRET_LIKE_VALUE');
});

test('6C process and authorization evidence never prove an outcome', async () => {
  const ledger = await fixtureLedger();
  const action = await makeEvidence(ledger, { category: 'ACTION_RECEIPT', trust: 'BROWSER_SENSOR', exhaustive: true });
  const authorization = await makeEvidence(ledger, { evidenceId: 'evidence_auth', category: 'USER_AUTHORIZATION', trust: 'AUTHENTICATED_USER', exhaustive: true });
  const proof = await evaluateProof(ledger, 'claim_candidates_match', [action, authorization], { now: NOW });
  assert.equal(proof.status, 'UNKNOWN');
  assert.deepEqual(proof.evidenceRefs, []);
  assert.deepEqual(proof.rejectedEvidenceRefs.map((item) => item.reason).sort(), [
    'ACTION_IS_NOT_OUTCOME_EVIDENCE',
    'AUTHORIZATION_IS_NOT_OUTCOME_EVIDENCE',
  ]);

  const derivedLedgerInput = clone(ledgerReplay.ledger);
  derivedLedgerInput.evidenceRequirements[1].categories = ['DERIVED_OBSERVATION'];
  const derivedLedger = await createLedger(derivedLedgerInput, { authoritySource: 'USER', now: derivedLedgerInput.createdAt });
  const actionDependency = await makeEvidence(derivedLedger, {
    evidenceId: 'action_dependency', category: 'ACTION_RECEIPT', trust: 'BROWSER_SENSOR',
  });
  const laundered = await makeEvidence(derivedLedger, {
    evidenceId: 'derived_from_action', category: 'DERIVED_OBSERVATION', trust: 'DETERMINISTIC_DERIVATION',
    dependencies: [{ evidenceId: actionDependency.evidenceId, evidenceDigest: actionDependency.evidenceDigest }],
  });
  const launderingProof = await evaluateProof(derivedLedger, 'claim_candidates_match', [laundered], {
    now: NOW,
    dependencyEvidence: [actionDependency],
  });
  assert.equal(launderingProof.status, 'UNKNOWN');
  assert.deepEqual(launderingProof.rejectedEvidenceRefs, [{
    evidenceId: laundered.evidenceId,
    reason: 'DEPENDENCY_INVALIDATED',
  }]);
});

test('6C rejects stale, cross-tenant, cross-lineage, scope, expiry, and dependency evidence explicitly', async () => {
  const ledger = await fixtureLedger();
  const dependency = await makeEvidence(ledger, { evidenceId: 'dependency_001' });
  const cases = [
    ['cross_tenant', { tenantId: 'tenant_fixture_other' }, 'CROSS_TENANT'],
    ['cross_goal', { goalId: 'goal_fixture_other' }, 'CROSS_GOAL_LINEAGE'],
    ['scope', { scopeId: 'resource_fixture_other' }, 'SCOPE_MISMATCH'],
    ['stale', { goalRevision: 2 }, 'STALE_REVISION'],
    ['expired', { observedAt: '2026-09-10T00:00:00Z' }, 'EXPIRED'],
    ['dependency', {
      category: 'DERIVED_OBSERVATION',
      trust: 'DETERMINISTIC_DERIVATION',
      dependencies: [{ evidenceId: dependency.evidenceId, evidenceDigest: `sha256:${'0'.repeat(64)}` }],
    }, 'DEPENDENCY_INVALIDATED'],
  ];
  const evidence = [];
  for (const [id, changes] of cases) evidence.push(await makeEvidence(ledger, { evidenceId: `evidence_${id}`, ...changes }));
  const proof = await evaluateProof(ledger, 'claim_candidates_match', evidence, { now: NOW, dependencyEvidence: [dependency] });
  assert.equal(proof.status, 'UNKNOWN');
  assert.deepEqual(proof.rejectedEvidenceRefs.map((item) => item.reason), cases.map((item) => item[2]));
});

test('6C contradictions remain visible and block positive completion', async () => {
  const ledger = await fixtureLedger();
  const yes = await makeEvidence(ledger, { evidenceId: 'evidence_yes' });
  const no = await makeEvidence(ledger, { evidenceId: 'evidence_no', supports: false });
  const proof = await evaluateProof(ledger, 'claim_candidates_match', [yes, no], { now: NOW });
  assert.equal(proof.status, 'BLOCKED');
  assert.equal(proof.contradictions.length, 1);
  assert.deepEqual(proof.contradictions[0].evidenceRefs, ['evidence_no', 'evidence_yes']);
  assert.ok(proof.rejectedEvidenceRefs.some((item) => item.reason === 'CONTRADICTION_UNRESOLVED'));
});

test('6C bounded evidence can be BOUNDED_COMPLETE but never universal PROVED', async () => {
  const ledger = await fixtureLedger();
  const first = await makeEvidence(ledger, {
    evidenceId: 'boundary_001', category: 'BOUNDARY_OBSERVATION', claimId: 'claim_feed_scanned',
    predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY', observedAt: '2026-09-11T00:02:00Z',
  });
  const second = await makeEvidence(ledger, {
    evidenceId: 'boundary_002', category: 'BOUNDARY_OBSERVATION', claimId: 'claim_feed_scanned',
    predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY', observedAt: '2026-09-11T00:03:00Z', exhaustive: true,
  });
  const proof = await evaluateProof(ledger, 'claim_feed_scanned', [first, second], { now: NOW });
  assert.equal(proof.status, 'BOUNDED_COMPLETE');
  assert.notEqual(proof.status, 'PROVED');
  assert.ok(proof.limits.includes('DECLARED_BOUNDED_SCOPE_ONLY'));

  const duplicated = await evaluateProof(ledger, 'claim_feed_scanned', [first, first], { now: NOW });
  assert.equal(duplicated.status, 'PARTIAL');
  assert.ok(duplicated.rejectedEvidenceRefs.some((item) => item.reason === 'DUPLICATE_ID'));
});

test('6C closed-world proof requires sufficient exhaustive outcome evidence', async () => {
  const ledger = await fixtureLedger({ scope: { kind: 'CLOSED_WORLD', resourceId: 'resource_fixture_map_001' } });
  const ordinary = await makeEvidence(ledger);
  const partial = await evaluateProof(ledger, 'claim_candidates_match', [ordinary], { now: NOW });
  assert.equal(partial.status, 'PARTIAL');
  assert.ok(partial.unresolved.includes('EXHAUSTIVE_EVIDENCE_REQUIRED'));

  const exhaustive = await makeEvidence(ledger, { evidenceId: 'evidence_exhaustive', exhaustive: true });
  const proved = await evaluateProof(ledger, 'claim_candidates_match', [exhaustive], { now: NOW });
  assert.equal(proved.status, 'PROVED');
});

test('6C receipts are canonical, bounded, immutable, and tamper evident', async () => {
  const ledger = await fixtureLedger();
  const evidence = await makeEvidence(ledger);
  const proof = await evaluateProof(ledger, 'claim_candidates_match', [evidence], { now: NOW });
  assert.match(proof.proofDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(proof), true);
  assert.ok(Buffer.byteLength(JSON.stringify(proof), 'utf8') <= contract.limits.proofResponseBytes);
  assert.deepEqual(await validateProof(proof), proof);
  const tampered = clone(proof);
  tampered.status = 'PROVED';
  await assert.rejects(validateProof(tampered), (error) => error.code === 'INVALID_DIGEST');
});

test('6C has zero false PROVED results across the adversarial corpus', async () => {
  const base = await fixtureLedger();
  for (const scenario of proofReplay.scenarios) {
    const ledger = scenario.scopeKind ? await fixtureLedger({ scope: { ...base.scope, kind: scenario.scopeKind } }) : base;
    let evidence;
    let dependencyEvidence;
    if (scenario.id === 'bounded-enumeration') {
      evidence = [
        await makeEvidence(ledger, { evidenceId: `${scenario.id}_1`, category: 'BOUNDARY_OBSERVATION', claimId: 'claim_feed_scanned', predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY', observedAt: '2026-09-11T00:02:00Z' }),
        await makeEvidence(ledger, { evidenceId: `${scenario.id}_2`, category: 'BOUNDARY_OBSERVATION', claimId: 'claim_feed_scanned', predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY' }),
      ];
    } else if (scenario.mutation === 'contradiction') {
      evidence = [await makeEvidence(ledger, { evidenceId: `${scenario.id}_yes` }), await makeEvidence(ledger, { evidenceId: `${scenario.id}_no`, supports: false })];
    } else if (scenario.mutation === 'dependency') {
      const dependency = await makeEvidence(ledger, { evidenceId: `${scenario.id}_source` });
      evidence = [await makeEvidence(ledger, {
        evidenceId: `evidence_${scenario.id}`,
        category: 'DERIVED_OBSERVATION',
        trust: 'DETERMINISTIC_DERIVATION',
        dependencies: [{ evidenceId: dependency.evidenceId, evidenceDigest: `sha256:${'0'.repeat(64)}` }],
      })];
      dependencyEvidence = [dependency];
    } else {
      const changes = { evidenceId: `evidence_${scenario.id}`, category: scenario.category, exhaustive: scenario.exhaustive === true };
      if (scenario.category === 'USER_AUTHORIZATION') changes.trust = 'AUTHENTICATED_USER';
      if (scenario.category === 'ACTION_RECEIPT') changes.trust = 'BROWSER_SENSOR';
      if (scenario.mutation === 'tenant') changes.tenantId = 'tenant_fixture_other';
      if (scenario.mutation === 'goal') changes.goalId = 'goal_fixture_other';
      if (scenario.mutation === 'scope') changes.scopeId = 'resource_fixture_other';
      if (scenario.mutation === 'revision') changes.goalRevision = 2;
      if (scenario.mutation === 'expired') changes.observedAt = '2026-09-10T00:00:00Z';
      evidence = [await makeEvidence(ledger, changes)];
    }
    const claimId = scenario.id === 'bounded-enumeration' ? 'claim_feed_scanned' : 'claim_candidates_match';
    const proof = await evaluateProof(ledger, claimId, evidence, { now: NOW, dependencyEvidence });
    if (scenario.mustNotBe) assert.notEqual(proof.status, scenario.mustNotBe, scenario.id);
    assert.equal(proof.status, scenario.expectedStatus, scenario.id);
    if (scenario.expectedRejection) {
      assert.ok(proof.rejectedEvidenceRefs.some((item) => item.reason === scenario.expectedRejection), scenario.id);
    }
  }
});

test('6C evaluates 500 bounded items without environment side effects', { timeout: 30000 }, async () => {
  const ledger = await fixtureLedger();
  const evidence = await Promise.all(Array.from({ length: 500 }, (_, index) => makeEvidence(ledger, { evidenceId: `evidence_${String(index).padStart(3, '0')}` })));
  const started = performance.now();
  const proof = await evaluateProof(ledger, 'claim_candidates_match', evidence, { now: NOW });
  assert.ok(performance.now() - started < 1000);
  assert.equal(proof.evidenceRefs.length, 500);
  await assert.rejects(
    evaluateProof(ledger, 'claim_candidates_match', [...evidence, evidence[0]], { now: NOW }),
    (error) => error.code === 'OVER_LIMIT',
  );
  const oversizedReceiptEvidence = await Promise.all(Array.from({ length: 500 }, (_, index) => makeEvidence(ledger, {
    evidenceId: `overflow_${String(index).padStart(3, '0')}_${'x'.repeat(110)}`,
    supports: index % 2 === 0,
  })));
  await assert.rejects(
    evaluateProof(ledger, 'claim_candidates_match', oversizedReceiptEvidence, { now: NOW }),
    (error) => error.code === 'OVER_LIMIT',
  );
  assert.doesNotMatch(source, /chrome\.|browser\.|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|supabase|process\.env|Deno\.|node:/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|writeFile|appendFile/);
});
