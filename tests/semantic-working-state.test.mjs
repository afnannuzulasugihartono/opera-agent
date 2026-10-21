// @last-edited: 2026-10-21 UTC+7.
// @title: semantic-working-state.test — the working state holds the change, and the change is bounded.
// @state: the entities, the views, the classifications, and the limits that keep them finite.
// @dependencies: node:test, strict, semantic-working-state.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SemanticWorkingStateError,
  createSemanticWorkingStateStore,
} from '../lib/semantic-working-state.js';

const identity = (overrides = {}) => ({
  tenantId: 'tenant-a',
  deviceId: 'device-a',
  tabId: 'tab-a',
  documentGeneration: 1,
  runtimeEpoch: 'epoch-a',
  ...overrides,
});

function entity(logicalId, revision = 1, overrides = {}) {
  return {
    logicalId,
    semanticRevision: revision,
    stableKey: `oa_${logicalId}`,
    stableKeySource: 'semantic',
    tag: 'button',
    role: 'button',
    regionKey: 'rg_feed',
    inViewport: true,
    sensitive: false,
    text: `raw-private-${logicalId}`,
    label: `label-private-${logicalId}`,
    href: `https://example.test/private?item=${logicalId}`,
    value: `value-private-${logicalId}`,
    ...overrides,
  };
}

function view(revision = 1, overrides = {}) {
  return {
    regionId: 'rg_feed',
    kind: 'repeated',
    role: 'feed',
    label: 'private feed label',
    viewRevision: revision,
    actionableCount: 2,
    repeatedEntityCount: 2,
    loadedEntityCount: 2,
    visibleEntityCount: 2,
    uniqueCanonicalLinkCount: 0,
    duplicateKeyCount: 0,
    ambiguityCount: 0,
    dependencies: {
      entitySet: { fingerprint: `entities-${revision}`, count: 2 },
      scrollState: { fingerprint: `scroll-${revision}` },
    },
    exhaustion: { reachedBoundary: false, stableObservations: 0, status: 'PARTIAL' },
    completion: { status: 'PARTIAL', scope: 'private scope text', evidence: [], limits: [], unresolved: [] },
    ...overrides,
  };
}

function observation({
  sourceRevision = 0,
  resultingRevision = 1,
  classification = 'RESET',
  changes = [],
  entities = [entity('a'), entity('b')],
  viewRevision = 1,
  changedRegionIds = ['rg_feed'],
  removedRegionIds = [],
  documentGeneration = 1,
  ambiguityCount = 0,
  completeSnapshotRequired = classification === 'RESET',
  resetReason = classification === 'RESET' ? 'INITIAL_OBSERVATION' : undefined,
} = {}) {
  return {
    semanticState: {
      schemaVersion: 1,
      documentGeneration,
      observationRevision: resultingRevision,
      entityCount: entities.length,
      observedEntityCount: entities.length,
      ambiguityCount,
      collisionCount: 0,
      excludedSensitiveCount: 0,
      cacheBytes: 1024,
      resetReason: resetReason ?? null,
    },
    semanticDelta: {
      schemaVersion: 1,
      sourceRevision,
      resultingRevision,
      classification,
      changes,
      completeSnapshotRequired,
      ...(resetReason ? { resetReason } : {}),
    },
    elements: entities,
    semanticViews: {
      schemaVersion: 1,
      revision: resultingRevision,
      provenance: {
        category: 'DIRECT_OBSERVATION',
        observedAt: 1,
        sourceRevision: resultingRevision,
        sensor: 'DOM_ACCESSIBILITY',
        confidence: ambiguityCount ? 0.5 : 0.9,
      },
      regions: [view(viewRevision)],
      changedRegionIds,
      removedRegionIds,
      viewDelta: {
        sourceClassification: classification,
        invalidatedViews: changedRegionIds.map((regionId) => ({ regionId, causes: ['ENTITY_DEPENDENCY_CHANGED'] })),
        removedRegionIds,
      },
    },
  };
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof SemanticWorkingStateError);
    assert.equal(error.code, code);
    return true;
  });
}

test('P1 bootstraps bounded ephemeral state from a trusted RESET/full observation', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000 });
  const state = store.bootstrap(identity(), observation());
  assert.equal(state.semanticRevision, 1);
  assert.equal(state.documentGeneration, 1);
  assert.equal(state.entityCount, 2);
  assert.equal(state.viewCount, 1);
  assert.equal(state.continuity, 'CONTIGUOUS');
  assert.equal(state.lastSourceRevision, 0);
  assert.equal(state.lastResultRevision, 1);
  assert.ok(state.stateId);
  assert.equal(store.size, 1);
});

test('P1 contiguous delta application reconstructs the same canonical entity/view state as the current trusted observation', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000 });
  const initial = store.bootstrap(identity(), observation());
  const second = observation({
    sourceRevision: 1,
    resultingRevision: 2,
    classification: 'UPDATE',
    completeSnapshotRequired: false,
    resetReason: undefined,
    changes: [{ type: 'UPDATE', logicalId: 'a', revision: 2, reason: 'SEMANTIC_FIELDS_CHANGED', confidence: 0.9 }],
    entities: [entity('a', 2, { inViewport: false }), entity('b', 1)],
    viewRevision: 2,
  });
  const applied = store.apply(initial.stateId, identity(), second);
  assert.equal(applied.replayed, false);
  assert.equal(applied.semanticRevision, 2);
  const inspected = store.inspect(initial.stateId, identity());
  assert.deepEqual(inspected.entities.map((item) => [item.logicalId, item.semanticRevision, item.inViewport]), [
    ['a', 2, false],
    ['b', 1, true],
  ]);
  assert.equal(inspected.views[0].regionId, 'rg_feed');
  assert.equal(inspected.views[0].viewRevision, 2);
  assert.equal(inspected.dependencies[0].regionId, 'rg_feed');
});

test('P1 exact duplicate replay is idempotent while incompatible duplicate fails closed', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000 });
  const initial = store.bootstrap(identity(), observation());
  const second = observation({
    sourceRevision: 1,
    resultingRevision: 2,
    classification: 'UPDATE',
    completeSnapshotRequired: false,
    resetReason: undefined,
    changes: [{ type: 'UPDATE', logicalId: 'a', revision: 2, reason: 'SEMANTIC_FIELDS_CHANGED', confidence: 0.9 }],
    entities: [entity('a', 2), entity('b', 1)],
    viewRevision: 2,
  });
  store.apply(initial.stateId, identity(), second);
  const replay = store.apply(initial.stateId, identity(), structuredClone(second));
  assert.equal(replay.replayed, true);
  assert.equal(replay.semanticRevision, 2);

  const incompatible = structuredClone(second);
  incompatible.elements[0].inViewport = false;
  assertCode(() => store.apply(initial.stateId, identity(), incompatible), 'INCOMPATIBLE_DUPLICATE');
});

test('P1 rejects revision gaps and out-of-order observations without mutating accepted state', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000 });
  const initial = store.bootstrap(identity(), observation());
  const gap = observation({
    sourceRevision: 3,
    resultingRevision: 4,
    classification: 'NO_RELEVANT_CHANGE',
    completeSnapshotRequired: false,
    resetReason: undefined,
    changes: [],
  });
  assertCode(() => store.apply(initial.stateId, identity(), gap), 'REVISION_GAP');
  assert.equal(store.inspect(initial.stateId, identity()).semanticRevision, 1);

  const old = observation({
    sourceRevision: 0,
    resultingRevision: 0,
    classification: 'NO_RELEVANT_CHANGE',
    completeSnapshotRequired: false,
    resetReason: undefined,
    changes: [],
  });
  assertCode(() => store.apply(initial.stateId, identity(), old), 'OUT_OF_ORDER');
  assert.equal(store.inspect(initial.stateId, identity()).semanticRevision, 1);
});

test('P1 rejects cross-tenant/device/tab/document and runtime restart scope mismatches', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000 });
  const initial = store.bootstrap(identity(), observation());
  const next = observation({
    sourceRevision: 1,
    resultingRevision: 2,
    classification: 'NO_RELEVANT_CHANGE',
    completeSnapshotRequired: false,
    resetReason: undefined,
    changes: [],
  });
  assertCode(() => store.apply(initial.stateId, identity({ tenantId: 'tenant-b' }), next), 'CROSS_TENANT');
  assertCode(() => store.apply(initial.stateId, identity({ deviceId: 'device-b' }), next), 'CROSS_DEVICE');
  assertCode(() => store.apply(initial.stateId, identity({ tabId: 'tab-b' }), next), 'CROSS_TAB');
  assertCode(() => store.apply(initial.stateId, identity({ documentGeneration: 2 }), next), 'CROSS_DOCUMENT');
  assertCode(() => store.apply(initial.stateId, identity({ runtimeEpoch: 'epoch-b' }), next), 'RUNTIME_EPOCH_MISMATCH');
});

test('P1 ambiguity, overflow, and expiry fail closed and never silently restore continuity', () => {
  let now = 1000;
  const store = createSemanticWorkingStateStore({
    now: () => now,
    maxAgeMs: 50,
    maxEntitiesPerState: 2,
    maxViewsPerState: 2,
    maxStateBytes: 16 * 1024,
  });
  const initial = store.bootstrap(identity(), observation());
  const ambiguous = observation({
    sourceRevision: 1,
    resultingRevision: 2,
    classification: 'UPDATE',
    completeSnapshotRequired: false,
    resetReason: undefined,
    ambiguityCount: 1,
    changes: [{ type: 'UPDATE', logicalId: 'a', revision: 2, reason: 'SEMANTIC_FIELDS_CHANGED', confidence: 0.25 }],
    entities: [entity('a', 2, { identityAmbiguous: true }), entity('b', 1)],
  });
  assertCode(() => store.apply(initial.stateId, identity(), ambiguous), 'AMBIGUOUS_IDENTITY');
  assert.equal(store.inspect(initial.stateId, identity()).semanticRevision, 1);

  const tooMany = observation({ entities: [entity('a'), entity('b'), entity('c')] });
  assertCode(() => store.bootstrap(identity({ tabId: 'tab-overflow' }), tooMany), 'OVERFLOW');

  now = 1100;
  assertCode(() => store.inspect(initial.stateId, identity()), 'EXPIRED');
  assert.equal(store.size, 0);
});

test('P1 bounded store eviction makes old state unavailable instead of pretending continuity', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000, maxStates: 2 });
  const first = store.bootstrap(identity({ tabId: 'tab-1' }), observation());
  store.bootstrap(identity({ tabId: 'tab-2' }), observation());
  store.bootstrap(identity({ tabId: 'tab-3' }), observation());
  assert.equal(store.size, 2);
  assertCode(() => store.inspect(first.stateId, identity({ tabId: 'tab-1' })), 'RESET_REQUIRED');
});

test('P1 working state stores semantic metadata only and excludes raw text, href, values, and sensitive entities', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000 });
  const safe = entity('safe', 1, {
    text: 'TOP-SECRET-PAGE-TEXT',
    label: 'TOP-SECRET-LABEL',
    href: 'https://example.test/?private=TOP-SECRET-HREF',
    value: 'TOP-SECRET-VALUE',
  });
  const sensitive = entity('sensitive', 1, {
    sensitive: true,
    text: 'TOP-SECRET-SENSITIVE',
  });
  const obs = observation({ entities: [safe, sensitive] });
  obs.semanticState.excludedSensitiveCount = 1;
  const state = store.bootstrap(identity(), obs);
  const inspected = store.inspect(state.stateId, identity());
  assert.deepEqual(inspected.entities.map((item) => item.logicalId), ['safe']);
  const encoded = JSON.stringify(inspected);
  for (const forbidden of ['TOP-SECRET-PAGE-TEXT', 'TOP-SECRET-LABEL', 'TOP-SECRET-HREF', 'TOP-SECRET-VALUE', 'TOP-SECRET-SENSITIVE', 'private feed label', 'private scope text']) {
    assert.doesNotMatch(encoded, new RegExp(forbidden));
  }
  for (const key of ['text', 'label', 'href', 'value']) {
    assert.equal(Object.prototype.hasOwnProperty.call(inspected.entities[0], key), false);
  }
});

test('P1 RESET observations require a fresh bootstrap rather than being merged into an existing continuity chain', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1000 });
  const initial = store.bootstrap(identity(), observation());
  const reset = observation({
    sourceRevision: 1,
    resultingRevision: 2,
    classification: 'RESET',
    completeSnapshotRequired: true,
    resetReason: 'OUTPUT_CAP',
  });
  assertCode(() => store.apply(initial.stateId, identity(), reset), 'RESET_REQUIRED');
  assert.equal(store.inspect(initial.stateId, identity()).semanticRevision, 1);

  const rebuilt = store.bootstrap(identity({ documentGeneration: 2 }), observation({ documentGeneration: 2 }));
  assert.equal(rebuilt.semanticRevision, 1);
  assert.equal(rebuilt.documentGeneration, 2);
});

const id = { tenantId: 't', deviceId: 'd', tabId: 'tab', documentGeneration: 1, runtimeEpoch: 'e' };

function item(logicalId, semanticRevision = 1, overrides = {}) {
  return {
    logicalId,
    semanticRevision,
    stableKey: `oa_${logicalId}`,
    stableKeySource: 'semantic',
    tag: 'a',
    role: 'link',
    regionKey: 'feed',
    inViewport: true,
    sensitive: false,
    ...overrides,
  };
}

function region(viewRevision = 1, count = 1, overrides = {}) {
  return {
    regionId: 'feed',
    kind: 'repeated',
    role: 'feed',
    viewRevision,
    actionableCount: count,
    repeatedEntityCount: count,
    loadedEntityCount: count,
    visibleEntityCount: count,
    uniqueCanonicalLinkCount: count,
    duplicateKeyCount: 0,
    ambiguityCount: 0,
    dependencies: {
      entitySet: { fingerprint: `entities-${viewRevision}-${count}`, count },
      scrollState: { fingerprint: `scroll-${viewRevision}` },
    },
    exhaustion: { reachedBoundary: false, stableObservations: 0, status: 'PARTIAL' },
    completion: { status: 'PARTIAL' },
    ...overrides,
  };
}

function obs({ source = 0, result = 1, classification = 'RESET', changes = [], elements = [item('a')], viewRevision = result, changed = ['feed'], removed = [], full = classification === 'RESET' } = {}) {
  return {
    semanticState: {
      schemaVersion: 1,
      documentGeneration: 1,
      observationRevision: result,
      entityCount: elements.length,
      observedEntityCount: elements.length,
      ambiguityCount: 0,
      collisionCount: 0,
      excludedSensitiveCount: 0,
      cacheBytes: 128,
      resetReason: classification === 'RESET' ? 'INITIAL_OBSERVATION' : null,
    },
    semanticDelta: {
      schemaVersion: 1,
      sourceRevision: source,
      resultingRevision: result,
      classification,
      changes,
      completeSnapshotRequired: full,
      ...(classification === 'RESET' ? { resetReason: 'INITIAL_OBSERVATION' } : {}),
    },
    elements,
    semanticViews: {
      schemaVersion: 1,
      revision: result,
      provenance: { category: 'DIRECT_OBSERVATION', observedAt: result, sourceRevision: result, sensor: 'DOM_ACCESSIBILITY', confidence: 0.9 },
      regions: [region(viewRevision, elements.length)],
      changedRegionIds: changed,
      removedRegionIds: removed,
      viewDelta: { sourceClassification: classification, invalidatedViews: [], removedRegionIds: removed },
    },
  };
}

function code(fn, expected) {
  assert.throws(fn, (error) => error instanceof SemanticWorkingStateError && error.code === expected);
}

test('P1 reconstructs INSERT, MOVE, and REMOVE without replacing the canonical state wholesale', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1 });
  const start = store.bootstrap(id, obs());

  store.apply(start.stateId, id, obs({
    source: 1,
    result: 2,
    classification: 'INSERT',
    full: false,
    elements: [item('a'), item('b')],
    changes: [{ type: 'INSERT', logicalId: 'b', revision: 1 }],
    viewRevision: 2,
  }));
  assert.deepEqual(store.inspect(start.stateId, id).entities.map((value) => value.logicalId), ['a', 'b']);

  store.apply(start.stateId, id, obs({
    source: 2,
    result: 3,
    classification: 'MOVE',
    full: false,
    elements: [item('a'), item('b', 1, { inViewport: false })],
    changes: [{ type: 'MOVE', logicalId: 'b', revision: 1 }],
    viewRevision: 3,
  }));
  assert.equal(store.inspect(start.stateId, id).entities.find((value) => value.logicalId === 'b').inViewport, false);

  store.apply(start.stateId, id, obs({
    source: 3,
    result: 4,
    classification: 'REMOVE',
    full: false,
    elements: [item('a')],
    changes: [{ type: 'REMOVE', logicalId: 'b', revision: 1 }],
    viewRevision: 4,
  }));
  assert.deepEqual(store.inspect(start.stateId, id).entities.map((value) => value.logicalId), ['a']);
});

test('P1 rejects a rich observation that changed semantically without a matching delta', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1 });
  const start = store.bootstrap(id, obs());
  const lying = obs({
    source: 1,
    result: 2,
    classification: 'NO_RELEVANT_CHANGE',
    full: false,
    changes: [],
    elements: [item('a', 2)],
    viewRevision: 1,
    changed: [],
  });
  code(() => store.apply(start.stateId, id, lying), 'DELTA_MISMATCH');
  assert.equal(store.inspect(start.stateId, id).semanticRevision, 1);
});

test('P1 rejects changed view material when changedRegionIds does not authorize the view update', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1 });
  const start = store.bootstrap(id, obs());
  const lying = obs({
    source: 1,
    result: 2,
    classification: 'NO_RELEVANT_CHANGE',
    full: false,
    changes: [],
    elements: [item('a')],
    viewRevision: 2,
    changed: [],
  });
  code(() => store.apply(start.stateId, id, lying), 'VIEW_DELTA_MISMATCH');
  assert.equal(store.inspect(start.stateId, id).semanticRevision, 1);
});

test('P1 byte cap fails closed before state becomes available', () => {
  const store = createSemanticWorkingStateStore({ now: () => 1, maxStateBytes: 128 });
  code(() => store.bootstrap(id, obs()), 'OVERFLOW');
  assert.equal(store.size, 0);
});
