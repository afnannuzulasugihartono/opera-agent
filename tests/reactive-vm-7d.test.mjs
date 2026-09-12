import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createLedger, digestCanonical } from '../lib/goal-ledger.js';
import { createEvidence, evaluateProof } from '../lib/proof-engine.js';
import { createReactiveVm7C, validateReactiveProgram7C } from '../lib/reactive-vm-7c.js';
import {
  ReactiveVmError,
  advanceReactiveVm7D,
  bindCollectionEvidence7D,
  collectSemanticRecords7D,
  createReactiveVm7D,
  dedupSemanticRecords7D,
  invalidateCollectionForObservationChange7D,
  validateReactiveProgram7D,
} from '../lib/reactive-vm-7d.js';

const ledgerReplay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const TERMINAL = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);

const budgets = Object.freeze({
  serializedProgramBytes: 131072,
  astNodes: 256,
  astDepth: 12,
  controlFlowDepth: 4,
  executedNodesPerRun: 1000,
  browserCommandLeavesPerRun: 200,
  iterationsPerLoop: 50,
  totalIterationsPerRun: 250,
  waitEventTimeoutMs: 15000,
  cumulativeWaitMs: 60000,
  retryAttemptsPerNode: 3,
  collectionItemsPerBinding: 1000,
  bindings: 64,
  persistedCheckpointBytes: 131072,
  returnedResultBytes: 131072,
  executionSliceMs: 20000,
  runDeadlineMs: 300000,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function makeProgram(root, programId = 'vm-7d-program', overrides = {}) {
  const program = {
    schemaVersion: 'OA_REACTIVE_VM_V1',
    programId,
    tenantId: 'tenant-test',
    goalId: 'goal-test',
    goalRevision: 1,
    target: { deviceId: 'device-test', tabId: 7, documentGeneration: 'doc-gen-1' },
    budgets: { ...budgets },
    root,
    programDigest: '',
    ...overrides,
  };
  const { programDigest: _ignored, ...body } = program;
  program.programDigest = await digestCanonical(body);
  return program;
}

function options(runId = 'run-7d', initialBindings = {}, initialObservationMeta = {}) {
  return {
    runId,
    tenantId: 'tenant-test',
    goalRevision: 1,
    logicalNowMs: 1000,
    deadlineAtMs: 301000,
    initialBindings,
    initialObservationMeta,
  };
}

function effectResult(request, { ok = true, value = null, errorCode } = {}) {
  return {
    requestDigest: request.requestDigest,
    method: request.method,
    ok,
    provenance: {
      tenantId: 'tenant-test',
      deviceId: 'device-test',
      tabId: 7,
      documentGeneration: 'doc-gen-1',
    },
    value,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function semanticItem(id, overrides = {}) {
  return {
    logicalId: id,
    semanticRevision: 1,
    stableKey: id.replace('se_', 'item_'),
    stableKeySource: 'id',
    identityAmbiguous: false,
    name: `Item ${id}`,
    inViewport: true,
    ...overrides,
  };
}

function observationMeta(overrides = {}) {
  return {
    method: 'page.read',
    logicalNowMs: 1000,
    provenance: {
      tenantId: 'tenant-test',
      deviceId: 'device-test',
      tabId: 7,
      documentGeneration: 'doc-gen-1',
    },
    observationKind: 'DIRECT_OBSERVATION',
    scopeKind: 'LOADED_DOM',
    boundaryStable: false,
    dependencyFingerprint: `sha256:${'1'.repeat(64)}`,
    dependencyKinds: ['ENTITY_SET'],
    ...overrides,
  };
}

async function runToTerminal(program, state, start = 1001) {
  let current = state;
  for (let index = 0; index < 64 && !TERMINAL.has(current.status); index += 1) {
    current = (await advanceReactiveVm7D(program, current, { logicalNowMs: start + index })).state;
  }
  return current;
}

async function assertVmError(code, fn) {
  await assert.rejects(fn, (error) => error instanceof ReactiveVmError && error.code === code);
}

test('7D executes frozen COLLECT/DEDUP opcodes while 7C remains unchanged', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'COLLECT', source: { op: 'PATH', path: ['source'] }, projection: ['logicalId', 'name'], destination: 'collected', maxItems: 10 },
      { type: 'DEDUP', source: { op: 'PATH', path: ['collected'] }, keySpec: ['logicalId'], destination: 'unique' },
      { type: 'RETURN', valueSpec: { op: 'PATH', path: ['unique', 'itemCount'] } },
    ],
  }, 'collect-dedup-program');

  await assertVmError('INVALID_SEMANTICS', () => validateReactiveProgram7C(program));
  assert.equal((await validateReactiveProgram7D(program)).programDigest, program.programDigest);

  let state = await createReactiveVm7D(program, options('collect-dedup-run', {
    source: [semanticItem('se_a'), semanticItem('se_a', { inViewport: false }), semanticItem('se_b')],
  }, { source: observationMeta() }));
  state = await runToTerminal(program, state);
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, 2);
  assert.equal(state.bindings.collected.schemaVersion, 'OA_VM_COLLECTION_V1');
  assert.equal(state.bindings.unique.itemCount, 2);
});

test('7D lazy-list collection appends every in-scope loaded identity and DEDUP keeps each stable identity once', async () => {
  const meta = observationMeta({
    boundaryStable: true,
    scopeKind: 'DECLARED_BOUNDED_FEED',
    dependencyFingerprint: `sha256:${'2'.repeat(64)}`,
  });
  const first = collectSemanticRecords7D(
    [semanticItem('se_a'), semanticItem('se_b')],
    ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource', 'name', 'inViewport'],
    { destination: 'items', maxItems: 10, collectionBudget: 10, sourceBinding: 'batch', observationMeta: meta },
  );
  const appended = collectSemanticRecords7D(
    [semanticItem('se_b', { inViewport: false }), semanticItem('se_c')],
    ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource', 'name', 'inViewport'],
    { existing: first, destination: 'items', maxItems: 10, collectionBudget: 10, sourceBinding: 'batch', observationMeta: meta },
  );
  const unique = dedupSemanticRecords7D(appended, ['logicalId'], { destination: 'unique', collectionBudget: 10 });

  assert.equal(appended.itemCount, 4);
  assert.deepEqual(unique.items.map((item) => item.logicalId), ['se_a', 'se_b', 'se_c']);
  assert.equal(unique.itemCount, 3);
  assert.equal(unique.dedup.duplicatesRemoved, 1);
  assert.equal(unique.completion.status, 'BOUNDED_COMPLETE');
});

test('7D virtual detach/reinsert does not duplicate a stable entity, while geometry or name alone never merges', () => {
  const stable = dedupSemanticRecords7D([
    semanticItem('se_same', { name: 'Old label', ref: 'oa_old', rect: { x: 0, y: 0, width: 10, height: 10 }, inViewport: false }),
    semanticItem('se_same', { name: 'New label', ref: 'oa_new', rect: { x: 500, y: 700, width: 10, height: 10 }, inViewport: true, semanticRevision: 2 }),
  ], ['logicalId'], { destination: 'stable', collectionBudget: 10 });
  assert.equal(stable.itemCount, 1);
  assert.equal(stable.items[0].semanticRevision, 2);

  const weak = dedupSemanticRecords7D([
    { name: 'Same name', x: 10, y: 20 },
    { name: 'Same name', x: 10, y: 20 },
  ], ['name'], { destination: 'weak', collectionBudget: 10 });
  assert.equal(weak.itemCount, 2);
  assert.equal(weak.ambiguities.length, 2);
  assert.ok(weak.ambiguities.every((item) => item.kind === 'MISSING_STRONG_IDENTITY'));
});

test('7D collision and missing-key fixtures retain records and report ambiguity', () => {
  const collision = dedupSemanticRecords7D([
    semanticItem('se_collision', { stableKey: 'item_a', stableKeySource: 'id' }),
    semanticItem('se_collision', { stableKey: 'item_b', stableKeySource: 'id' }),
    { semanticFingerprint: 'fp_missing_logical', name: 'fingerprint-only' },
    { name: 'no identity' },
  ], ['logicalId', 'semanticFingerprint'], { destination: 'ambiguous', collectionBudget: 10 });

  assert.equal(collision.itemCount, 4);
  assert.ok(collision.ambiguities.some((item) => item.kind === 'IDENTITY_COLLISION'));
  assert.ok(collision.ambiguities.some((item) => item.kind === 'MISSING_STRONG_IDENTITY'));
  assert.equal(collision.completion.status, 'PARTIAL');
});

test('7D fingerprint fallback merges only accepted unambiguous fingerprints and never overrides stronger conflicting IDs', () => {
  const result = dedupSemanticRecords7D([
    { semanticFingerprint: 'fp_1', identityAmbiguous: false, name: 'A' },
    { semanticFingerprint: 'fp_1', identityAmbiguous: false, name: 'A moved' },
    { logicalId: 'se_1', semanticFingerprint: 'fp_2', identityAmbiguous: false },
    { logicalId: 'se_2', semanticFingerprint: 'fp_2', identityAmbiguous: false },
  ], ['logicalId', 'semanticFingerprint'], { destination: 'fingerprints', collectionBudget: 10 });

  assert.equal(result.itemCount, 3);
  assert.equal(result.dedup.duplicatesRemoved, 1);
  assert.ok(result.ambiguities.some((item) => item.kind === 'IDENTITY_COLLISION'));
});

test('7D collection caps mark truncation PARTIAL and can never claim completeness', () => {
  const source = Array.from({ length: 5 }, (_, index) => semanticItem(`se_${index}`));
  const collection = collectSemanticRecords7D(source, ['logicalId', 'stableKey', 'stableKeySource'], {
    destination: 'capped',
    maxItems: 3,
    collectionBudget: 1000,
    sourceBinding: 'source',
    observationMeta: observationMeta({ boundaryStable: true, scopeKind: 'DECLARED_BOUNDED_FEED' }),
  });

  assert.equal(collection.itemCount, 3);
  assert.equal(collection.truncated, true);
  assert.equal(collection.remainingCount, 2);
  assert.equal(collection.completion.status, 'PARTIAL');
  assert.equal(collection.completion.completeWithinScope, false);
  assert.ok(collection.completion.unresolved.includes('COLLECTION_CAP_REACHED'));
});

test('7D viewport/zoom invalidation resets only dependent visible collections', () => {
  const visible = collectSemanticRecords7D([semanticItem('se_a')], ['logicalId'], {
    destination: 'visible', maxItems: 10, collectionBudget: 10, sourceBinding: 'source',
    observationMeta: observationMeta({ scopeKind: 'VISIBLE_VIEWPORT', dependencyKinds: ['VIEWPORT', 'ZOOM'] }),
  });
  const loaded = collectSemanticRecords7D([semanticItem('se_a')], ['logicalId'], {
    destination: 'loaded', maxItems: 10, collectionBudget: 10, sourceBinding: 'source',
    observationMeta: observationMeta({ scopeKind: 'LOADED_DOM', dependencyKinds: ['ENTITY_SET'] }),
  });
  const change = {
    dependencyFingerprint: `sha256:${'3'.repeat(64)}`,
    dependencyKinds: ['VIEWPORT', 'ZOOM'],
    documentGeneration: 'doc-gen-1',
  };

  const visibleResult = invalidateCollectionForObservationChange7D(visible, change);
  const loadedResult = invalidateCollectionForObservationChange7D(loaded, change);
  assert.equal(visibleResult.invalidated, true);
  assert.equal(visibleResult.collection.itemCount, 0);
  assert.equal(loadedResult.invalidated, false);
  assert.equal(loadedResult.collection.itemCount, 1);
});

test('7D evidence binding preserves proof separation: bounded observations may complete bounded scope but never manufacture universal PROVED', async () => {
  const ledgerInput = clone(ledgerReplay.ledger);
  const boundedLedger = await createLedger(ledgerInput, { authoritySource: 'USER', now: ledgerInput.createdAt });
  const collection = collectSemanticRecords7D([semanticItem('se_a')], ['logicalId'], {
    destination: 'feed', maxItems: 10, collectionBudget: 10, sourceBinding: 'source',
    observationMeta: observationMeta({ boundaryStable: true, scopeKind: 'DECLARED_BOUNDED_FEED' }),
  });
  const first = await bindCollectionEvidence7D(collection, {
    evidenceId: 'vm_boundary_1', tenantId: boundedLedger.tenantId, goalId: boundedLedger.goalId,
    goalRevision: boundedLedger.revision, ledgerDigest: boundedLedger.ledgerDigest,
    claimId: 'claim_feed_scanned', scopeId: boundedLedger.scope.resourceId,
    predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY', observedAt: '2026-09-11T00:02:00Z', supports: true,
  });
  const second = await bindCollectionEvidence7D(collection, {
    evidenceId: 'vm_boundary_2', tenantId: boundedLedger.tenantId, goalId: boundedLedger.goalId,
    goalRevision: boundedLedger.revision, ledgerDigest: boundedLedger.ledgerDigest,
    claimId: 'claim_feed_scanned', scopeId: boundedLedger.scope.resourceId,
    predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY', observedAt: '2026-09-11T00:03:00Z', supports: true,
  });
  assert.equal(first.category, 'BOUNDARY_OBSERVATION');
  assert.equal(first.exhaustive, false);
  const boundedProof = await evaluateProof(boundedLedger, 'claim_feed_scanned', [first, second], { now: '2026-09-11T00:04:00Z' });
  assert.equal(boundedProof.status, 'BOUNDED_COMPLETE');
  assert.notEqual(boundedProof.status, 'PROVED');

  const closedInput = clone(ledgerReplay.ledger);
  closedInput.scope = { kind: 'CLOSED_WORLD', resourceId: 'resource_fixture_map_001' };
  const closedLedger = await createLedger(closedInput, { authoritySource: 'USER', now: closedInput.createdAt });
  const direct = await bindCollectionEvidence7D(collection, {
    evidenceId: 'vm_closed_direct', tenantId: closedLedger.tenantId, goalId: closedLedger.goalId,
    goalRevision: closedLedger.revision, ledgerDigest: closedLedger.ledgerDigest,
    claimId: 'claim_candidates_match', scopeId: closedLedger.scope.resourceId,
    predicate: 'OBSERVED_CANDIDATES_SATISFY_CONSTRAINTS', observedAt: '2026-09-11T00:03:00Z', supports: true,
    forceDirect: true,
  });
  const closedProof = await evaluateProof(closedLedger, 'claim_candidates_match', [direct], { now: '2026-09-11T00:04:00Z' });
  assert.notEqual(closedProof.status, 'PROVED');
  assert.ok(closedProof.unresolved.includes('EXHAUSTIVE_EVIDENCE_REQUIRED'));
});

test('7D action receipts and stable screenshots still produce zero false PROVED results', async () => {
  const input = clone(ledgerReplay.ledger);
  input.scope = { kind: 'CLOSED_WORLD', resourceId: 'resource_fixture_map_001' };
  const ledger = await createLedger(input, { authoritySource: 'USER', now: input.createdAt });
  const common = {
    schemaVersion: 1, tenantId: ledger.tenantId, goalId: ledger.goalId, goalRevision: ledger.revision,
    ledgerDigest: ledger.ledgerDigest, claimId: 'claim_candidates_match', scopeId: ledger.scope.resourceId,
    observedAt: '2026-09-11T00:03:00Z', predicate: 'OBSERVED_CANDIDATES_SATISFY_CONSTRAINTS', supports: true, dependencies: [],
  };
  const action = await createEvidence({ ...common, evidenceId: 'vm_action_receipt', category: 'ACTION_RECEIPT', trust: 'BROWSER_SENSOR', exhaustive: true });
  const screenshot = await createEvidence({ ...common, evidenceId: 'vm_stable_screenshot', category: 'DIRECT_OBSERVATION', trust: 'BROWSER_SENSOR', exhaustive: false });
  const proof = await evaluateProof(ledger, 'claim_candidates_match', [action, screenshot], { now: '2026-09-11T00:04:00Z' });
  assert.notEqual(proof.status, 'PROVED');
  assert.ok(proof.rejectedEvidenceRefs.some((item) => item.reason === 'ACTION_IS_NOT_OUTCOME_EVIDENCE'));
});

test('7D preserves effect provenance while collection evidence refuses unverified provenance', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' },
      { type: 'COLLECT', source: { op: 'PATH', path: ['read1', 'items'] }, projection: ['logicalId', 'stableKey', 'stableKeySource'], destination: 'items', maxItems: 10 },
      { type: 'RETURN', valueSpec: { op: 'PATH', path: ['items', 'itemCount'] } },
    ],
  }, 'provenance-runtime');
  let state = await createReactiveVm7D(program, options('provenance-runtime-run'));
  let request;
  for (let i = 0; i < 8 && !request; i += 1) {
    const advanced = await advanceReactiveVm7D(program, state, { logicalNowMs: 1001 + i });
    state = advanced.state;
    if (advanced.transition.kind === 'EFFECT_REQUEST') request = advanced.transition.request;
  }
  assert.ok(request);
  const accepted = await advanceReactiveVm7D(program, state, {
    logicalNowMs: 1010,
    effectResult: effectResult(request, { value: { items: [semanticItem('se_a')] } }),
  });
  state = accepted.state;
  state = await runToTerminal(program, state, 1011);
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, 1);
  assert.equal(state.observationMeta.read1.provenance.tenantId, 'tenant-test');
  assert.equal(state.bindings.items.provenance.tenantId, 'tenant-test');

  const unverified = collectSemanticRecords7D([semanticItem('se_x')], ['logicalId'], {
    destination: 'unverified', maxItems: 10, collectionBudget: 10, sourceBinding: 'x', observationMeta: null,
  });
  await assertVmError('MISSING_PROVENANCE', () => bindCollectionEvidence7D(unverified, {
    evidenceId: 'bad', tenantId: 'tenant-test', goalId: 'goal-test', goalRevision: 1,
    ledgerDigest: `sha256:${'0'.repeat(64)}`, claimId: 'claim', scopeId: 'scope', predicate: 'PREDICATE',
    observedAt: '2026-09-11T00:03:00Z', supports: true,
  }));
});

test('7D remains bounded, deterministic, and environment-neutral for 1,000-item collection/dedup', () => {
  const source = Array.from({ length: 1000 }, (_, index) => semanticItem(`se_${String(index).padStart(4, '0')}`));
  const first = collectSemanticRecords7D(source, ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource'], {
    destination: 'large', maxItems: 1000, collectionBudget: 1000, sourceBinding: 'source', observationMeta: observationMeta(),
  });
  const second = collectSemanticRecords7D(source, ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource'], {
    destination: 'large', maxItems: 1000, collectionBudget: 1000, sourceBinding: 'source', observationMeta: observationMeta(),
  });
  assert.deepEqual(first, second);
  const unique = dedupSemanticRecords7D(first, ['logicalId'], { destination: 'unique', collectionBudget: 1000 });
  assert.equal(unique.itemCount, 1000);
  assert.equal(unique.truncated, false);

  const runtimeSource = fs.readFileSync(new URL('../lib/reactive-vm-7d.js', import.meta.url), 'utf8');
  assert.doesNotMatch(runtimeSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|chrome\.|browser\.|supabase|Date\.now|Math\.random|eval\s*\(|new Function/);
});

test('7D cancellation still wins before a collection instruction executes', async () => {
  const program = await makeProgram({
    type: 'COLLECT', source: { op: 'PATH', path: ['source'] }, projection: ['logicalId'], destination: 'items', maxItems: 10,
  }, 'cancel-collection');
  const state = await createReactiveVm7D(program, options('cancel-collection-run', { source: [semanticItem('se_a')] }, { source: observationMeta() }));
  const cancelled = await advanceReactiveVm7D(program, state, { logicalNowMs: 1001, cancelled: true });
  assert.equal(cancelled.state.status, 'CANCELLED');
  assert.equal(Object.hasOwn(cancelled.state.bindings, 'items'), false);
});
