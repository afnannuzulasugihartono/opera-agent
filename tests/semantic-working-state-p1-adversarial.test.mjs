import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SemanticWorkingStateError,
  createSemanticWorkingStateStore,
} from '../lib/semantic-working-state-p1.js';

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
