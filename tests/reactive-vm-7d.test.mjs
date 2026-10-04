// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: reactive-vm-7d.test — vm-7d.test — Test.
// @context: Test.
// @state: align 7D proof fixture provenance.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: strict, node:fs, node:test, goal-ledger, proof-engine, reactive-vm-7c, reactive-vm-7d.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createLedger, digestCanonical } from '../lib/goal-ledger.js';
import { createEvidence, evaluateProof } from '../lib/proof-engine.js';
import { validateReactiveProgram7C } from '../lib/reactive-vm-7c.js';
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

const replay = JSON.parse(fs.readFileSync(new URL('./fixtures/goal-ledger-replay-v1.json', import.meta.url), 'utf8'));
const TERMINAL = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const budgets = Object.freeze({
  serializedProgramBytes: 131072, astNodes: 256, astDepth: 12, controlFlowDepth: 4,
  executedNodesPerRun: 1000, browserCommandLeavesPerRun: 200, iterationsPerLoop: 50,
  totalIterationsPerRun: 250, waitEventTimeoutMs: 15000, cumulativeWaitMs: 60000,
  retryAttemptsPerNode: 3, collectionItemsPerBinding: 1000, bindings: 64,
  persistedCheckpointBytes: 131072, returnedResultBytes: 131072,
  executionSliceMs: 20000, runDeadlineMs: 300000,
});
const clone = (value) => JSON.parse(JSON.stringify(value));

async function program(root, id = 'vm-7d') {
  const value = {
    schemaVersion: 'OA_REACTIVE_VM_V1', programId: id, tenantId: 'tenant-test', goalId: 'goal-test', goalRevision: 1,
    target: { deviceId: 'device-test', tabId: 7, documentGeneration: 'doc-gen-1' }, budgets: { ...budgets }, root, programDigest: '',
  };
  const { programDigest: _ignored, ...body } = value;
  value.programDigest = await digestCanonical(body);
  return value;
}

function item(id, extra = {}) {
  return {
    logicalId: id, semanticRevision: 1, stableKey: id.replace('se_', 'item_'), stableKeySource: 'id',
    identityAmbiguous: false, name: `Item ${id}`, inViewport: true, ...extra,
  };
}

function meta(extra = {}) {
  return {
    method: 'page.read', logicalNowMs: 1000,
    provenance: { tenantId: 'tenant-test', deviceId: 'device-test', tabId: 7, documentGeneration: 'doc-gen-1' },
    observationKind: 'DIRECT_OBSERVATION', scopeKind: 'LOADED_DOM', boundaryStable: false,
    dependencyFingerprint: `sha256:${'1'.repeat(64)}`, dependencyKinds: ['ENTITY_SET'], ...extra,
  };
}

function opts(initialBindings = {}, initialObservationMeta = {}, runId = 'run-7d') {
  return { runId, tenantId: 'tenant-test', goalRevision: 1, logicalNowMs: 1000, deadlineAtMs: 301000, initialBindings, initialObservationMeta };
}

function effect(request, value) {
  return {
    requestDigest: request.requestDigest, method: request.method, ok: true,
    provenance: { tenantId: 'tenant-test', deviceId: 'device-test', tabId: 7, documentGeneration: 'doc-gen-1' }, value,
  };
}

async function run(programValue, state, start = 1001) {
  let current = state;
  for (let i = 0; i < 64 && !TERMINAL.has(current.status); i += 1) {
    current = (await advanceReactiveVm7D(programValue, current, { logicalNowMs: start + i })).state;
  }
  return current;
}

async function vmError(code, fn) {
  await assert.rejects(fn, (error) => error instanceof ReactiveVmError && error.code === code);
}

test('7D executes frozen COLLECT/DEDUP while 7C remains unchanged', async () => {
  const value = await program({ type: 'SEQUENCE', children: [
    { type: 'COLLECT', source: { op: 'PATH', path: ['source'] }, projection: ['logicalId', 'name'], destination: 'collected', maxItems: 10 },
    { type: 'DEDUP', source: { op: 'PATH', path: ['collected'] }, keySpec: ['logicalId'], destination: 'unique' },
    { type: 'RETURN', valueSpec: { op: 'PATH', path: ['unique', 'itemCount'] } },
  ] }, 'collect-dedup');
  await vmError('INVALID_SEMANTICS', () => validateReactiveProgram7C(value));
  assert.equal((await validateReactiveProgram7D(value)).programDigest, value.programDigest);
  let state = await createReactiveVm7D(value, opts({ source: [item('se_a'), item('se_a', { inViewport: false }), item('se_b')] }, { source: meta() }));
  state = await run(value, state);
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, 2);
  assert.equal(state.bindings.unique.itemCount, 2);
});

test('7D lazy-list append plus DEDUP collects each stable loaded identity once', () => {
  const observation = meta({ boundaryStable: true, scopeKind: 'DECLARED_BOUNDED_FEED', dependencyFingerprint: `sha256:${'2'.repeat(64)}` });
  const first = collectSemanticRecords7D([item('se_a'), item('se_b')], ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource', 'name', 'inViewport'], {
    destination: 'items', maxItems: 10, collectionBudget: 10, sourceBinding: 'batch', observationMeta: observation,
  });
  const second = collectSemanticRecords7D([item('se_b', { inViewport: false }), item('se_c')], ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource', 'name', 'inViewport'], {
    existing: first, destination: 'items', maxItems: 10, collectionBudget: 10, sourceBinding: 'batch', observationMeta: observation,
  });
  const unique = dedupSemanticRecords7D(second, ['logicalId'], { destination: 'unique', collectionBudget: 10 });
  assert.deepEqual(unique.items.map((entry) => entry.logicalId), ['se_a', 'se_b', 'se_c']);
  assert.equal(unique.dedup.duplicatesRemoved, 1);
  assert.equal(unique.completion.status, 'BOUNDED_COMPLETE');
});

test('7D detach/reinsert does not duplicate stable identity and weak geometry/name never merge', () => {
  const stable = dedupSemanticRecords7D([
    item('se_same', { name: 'Old', ref: 'old', rect: { x: 0, y: 0 }, inViewport: false }),
    item('se_same', { name: 'New', ref: 'new', rect: { x: 900, y: 700 }, semanticRevision: 2 }),
  ], ['logicalId'], { destination: 'stable', collectionBudget: 10 });
  assert.equal(stable.itemCount, 1);
  assert.equal(stable.items[0].semanticRevision, 2);
  const weak = dedupSemanticRecords7D([{ name: 'Same', x: 10, y: 20 }, { name: 'Same', x: 10, y: 20 }], ['name'], { destination: 'weak', collectionBudget: 10 });
  assert.equal(weak.itemCount, 2);
  assert.ok(weak.ambiguities.every((entry) => entry.kind === 'MISSING_STRONG_IDENTITY'));
});

test('7D collisions and missing keys retain records and report ambiguity', () => {
  const value = dedupSemanticRecords7D([
    item('se_collision', { stableKey: 'item_a' }), item('se_collision', { stableKey: 'item_b' }),
    { semanticFingerprint: 'fp_only', name: 'fingerprint' }, { name: 'missing' },
  ], ['logicalId', 'semanticFingerprint'], { destination: 'ambiguous', collectionBudget: 10 });
  assert.equal(value.itemCount, 4);
  assert.ok(value.ambiguities.some((entry) => entry.kind === 'IDENTITY_COLLISION'));
  assert.ok(value.ambiguities.some((entry) => entry.kind === 'MISSING_STRONG_IDENTITY'));
  assert.equal(value.completion.status, 'PARTIAL');
});

test('7D fingerprint fallback merges only explicit unambiguous fingerprints and preserves stronger conflicts', () => {
  const value = dedupSemanticRecords7D([
    { semanticFingerprint: 'fp_1', identityAmbiguous: false, name: 'A' },
    { semanticFingerprint: 'fp_1', identityAmbiguous: false, name: 'A moved' },
    { logicalId: 'se_1', semanticFingerprint: 'fp_2', identityAmbiguous: false },
    { logicalId: 'se_2', semanticFingerprint: 'fp_2', identityAmbiguous: false },
  ], ['logicalId', 'semanticFingerprint'], { destination: 'fingerprints', collectionBudget: 10 });
  assert.equal(value.itemCount, 3);
  assert.equal(value.dedup.duplicatesRemoved, 1);
  assert.ok(value.ambiguities.some((entry) => entry.kind === 'IDENTITY_COLLISION'));
});

test('7D caps may truncate only while explicitly PARTIAL', () => {
  const value = collectSemanticRecords7D(Array.from({ length: 5 }, (_, i) => item(`se_${i}`)), ['logicalId'], {
    destination: 'capped', maxItems: 3, collectionBudget: 1000, sourceBinding: 'source',
    observationMeta: meta({ boundaryStable: true, scopeKind: 'DECLARED_BOUNDED_FEED' }),
  });
  assert.equal(value.itemCount, 3);
  assert.equal(value.truncated, true);
  assert.equal(value.remainingCount, 2);
  assert.equal(value.completion.status, 'PARTIAL');
  assert.equal(value.completion.completeWithinScope, false);
  assert.ok(value.completion.unresolved.includes('COLLECTION_CAP_REACHED'));
});

test('7D viewport/zoom invalidates only dependent visible collection state', () => {
  const visible = collectSemanticRecords7D([item('se_a')], ['logicalId'], {
    destination: 'visible', maxItems: 10, collectionBudget: 10, sourceBinding: 'source',
    observationMeta: meta({ scopeKind: 'VISIBLE_VIEWPORT', dependencyKinds: ['VIEWPORT', 'ZOOM'] }),
  });
  const loaded = collectSemanticRecords7D([item('se_a')], ['logicalId'], {
    destination: 'loaded', maxItems: 10, collectionBudget: 10, sourceBinding: 'source', observationMeta: meta(),
  });
  const change = { dependencyFingerprint: `sha256:${'3'.repeat(64)}`, dependencyKinds: ['VIEWPORT', 'ZOOM'], documentGeneration: 'doc-gen-1' };
  assert.equal(invalidateCollectionForObservationChange7D(visible, change).invalidated, true);
  assert.equal(invalidateCollectionForObservationChange7D(loaded, change).invalidated, false);
});

test('7D binds bounded observation evidence without granting universal proof authority', async () => {
  const ledgerInput = clone(replay.ledger);
  ledgerInput.tenantId = 'tenant-test';
  const bounded = await createLedger(ledgerInput, { authoritySource: 'USER', now: ledgerInput.createdAt });
  const collection = collectSemanticRecords7D([item('se_a')], ['logicalId'], {
    destination: 'feed', maxItems: 10, collectionBudget: 10, sourceBinding: 'source',
    observationMeta: meta({ boundaryStable: true, scopeKind: 'DECLARED_BOUNDED_FEED' }),
  });
  const make = (evidenceId, observedAt) => bindCollectionEvidence7D(collection, {
    evidenceId, tenantId: bounded.tenantId, goalId: bounded.goalId, goalRevision: bounded.revision,
    ledgerDigest: bounded.ledgerDigest, claimId: 'claim_feed_scanned', scopeId: bounded.scope.resourceId,
    predicate: 'DECLARED_FEED_REACHED_STABLE_BOUNDARY', observedAt, supports: true,
  });
  const first = await make('vm_boundary_1', '2026-09-11T00:02:00Z');
  const second = await make('vm_boundary_2', '2026-09-11T00:03:00Z');
  assert.equal(first.category, 'BOUNDARY_OBSERVATION');
  assert.equal(first.exhaustive, false);
  const proof = await evaluateProof(bounded, 'claim_feed_scanned', [first, second], { now: '2026-09-11T00:04:00Z' });
  assert.equal(proof.status, 'BOUNDED_COMPLETE');
  assert.notEqual(proof.status, 'PROVED');

  const closedInput = clone(replay.ledger);
  closedInput.tenantId = 'tenant-test';
  closedInput.scope = { kind: 'CLOSED_WORLD', resourceId: 'resource_fixture_map_001' };
  const closed = await createLedger(closedInput, { authoritySource: 'USER', now: closedInput.createdAt });
  const direct = await bindCollectionEvidence7D(collection, {
    evidenceId: 'vm_closed_direct', tenantId: closed.tenantId, goalId: closed.goalId, goalRevision: closed.revision,
    ledgerDigest: closed.ledgerDigest, claimId: 'claim_candidates_match', scopeId: closed.scope.resourceId,
    predicate: 'OBSERVED_CANDIDATES_SATISFY_CONSTRAINTS', observedAt: '2026-09-11T00:03:00Z', supports: true, forceDirect: true,
  });
  const closedProof = await evaluateProof(closed, 'claim_candidates_match', [direct], { now: '2026-09-11T00:04:00Z' });
  assert.notEqual(closedProof.status, 'PROVED');
  assert.ok(closedProof.unresolved.includes('EXHAUSTIVE_EVIDENCE_REQUIRED'));
});

test('7D action receipts and stable screenshots still create zero false PROVED', async () => {
  const input = clone(replay.ledger);
  input.scope = { kind: 'CLOSED_WORLD', resourceId: 'resource_fixture_map_001' };
  const ledger = await createLedger(input, { authoritySource: 'USER', now: input.createdAt });
  const common = {
    schemaVersion: 1, tenantId: ledger.tenantId, goalId: ledger.goalId, goalRevision: ledger.revision,
    ledgerDigest: ledger.ledgerDigest, claimId: 'claim_candidates_match', scopeId: ledger.scope.resourceId,
    observedAt: '2026-09-11T00:03:00Z', predicate: 'OBSERVED_CANDIDATES_SATISFY_CONSTRAINTS', supports: true, dependencies: [],
  };
  const action = await createEvidence({ ...common, evidenceId: 'action', category: 'ACTION_RECEIPT', trust: 'BROWSER_SENSOR', exhaustive: true });
  const screenshot = await createEvidence({ ...common, evidenceId: 'screenshot', category: 'DIRECT_OBSERVATION', trust: 'BROWSER_SENSOR', exhaustive: false });
  const proof = await evaluateProof(ledger, 'claim_candidates_match', [action, screenshot], { now: '2026-09-11T00:04:00Z' });
  assert.notEqual(proof.status, 'PROVED');
  assert.ok(proof.rejectedEvidenceRefs.some((entry) => entry.reason === 'ACTION_IS_NOT_OUTCOME_EVIDENCE'));
});

test('7D runtime carries verified effect provenance into collection bindings', async () => {
  const value = await program({ type: 'SEQUENCE', children: [
    { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' },
    { type: 'COLLECT', source: { op: 'PATH', path: ['read1', 'items'] }, projection: ['logicalId'], destination: 'items', maxItems: 10 },
    { type: 'RETURN', valueSpec: { op: 'PATH', path: ['items', 'itemCount'] } },
  ] }, 'provenance');
  let state = await createReactiveVm7D(value, opts());
  let request;
  for (let i = 0; i < 8 && !request; i += 1) {
    const advanced = await advanceReactiveVm7D(value, state, { logicalNowMs: 1001 + i });
    state = advanced.state;
    if (advanced.transition.kind === 'EFFECT_REQUEST') request = advanced.transition.request;
  }
  assert.ok(request);
  state = (await advanceReactiveVm7D(value, state, { logicalNowMs: 1010, effectResult: effect(request, { items: [item('se_a')] }) })).state;
  state = await run(value, state, 1011);
  assert.equal(state.result, 1);
  assert.equal(state.observationMeta.read1.provenance.tenantId, 'tenant-test');
  assert.equal(state.bindings.items.provenance.tenantId, 'tenant-test');
  const unverified = collectSemanticRecords7D([item('se_x')], ['logicalId'], {
    destination: 'unverified', maxItems: 10, collectionBudget: 10, sourceBinding: 'x', observationMeta: null,
  });
  await vmError('MISSING_PROVENANCE', () => bindCollectionEvidence7D(unverified, {
    evidenceId: 'bad', tenantId: 'tenant-test', goalId: 'goal-test', goalRevision: 1, ledgerDigest: `sha256:${'0'.repeat(64)}`,
    claimId: 'claim', scopeId: 'scope', predicate: 'PREDICATE', observedAt: '2026-09-11T00:03:00Z', supports: true,
  }));
});

test('7D remains bounded/deterministic for 1,000 items and environment-neutral', () => {
  const source = Array.from({ length: 1000 }, (_, i) => item(`se_${String(i).padStart(4, '0')}`));
  const make = () => collectSemanticRecords7D(source, ['logicalId', 'semanticRevision', 'stableKey', 'stableKeySource'], {
    destination: 'large', maxItems: 1000, collectionBudget: 1000, sourceBinding: 'source', observationMeta: meta(),
  });
  const first = make();
  assert.deepEqual(first, make());
  assert.equal(dedupSemanticRecords7D(first, ['logicalId'], { destination: 'unique', collectionBudget: 1000 }).itemCount, 1000);
  const sourceText = fs.readFileSync(new URL('../lib/reactive-vm-7d.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sourceText, /\bfetch\s*\(|XMLHttpRequest|WebSocket|chrome\.|browser\.|supabase|Date\.now|Math\.random|eval\s*\(|new Function/);
});

test('7D cancellation wins before collection executes', async () => {
  const value = await program({ type: 'COLLECT', source: { op: 'PATH', path: ['source'] }, projection: ['logicalId'], destination: 'items', maxItems: 10 }, 'cancel');
  const state = await createReactiveVm7D(value, opts({ source: [item('se_a')] }, { source: meta() }));
  const cancelled = await advanceReactiveVm7D(value, state, { logicalNowMs: 1001, cancelled: true });
  assert.equal(cancelled.state.status, 'CANCELLED');
  assert.equal(Object.hasOwn(cancelled.state.bindings, 'items'), false);
});
