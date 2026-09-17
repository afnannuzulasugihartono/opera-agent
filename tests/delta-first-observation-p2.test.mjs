import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createDeltaFirstObservationPipeline,
  reasoningPayloadBytes,
} from '../lib/delta-first-observation-p2.js';

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
    identityConfidence: 0.98,
    sensitive: false,
    text: `RAW_PRIVATE_TEXT_${logicalId}_${'x'.repeat(220)}`,
    label: `RAW_PRIVATE_LABEL_${logicalId}`,
    href: `https://example.test/private?item=${logicalId}&token=RAW_PRIVATE_HREF_${logicalId}`,
    value: `RAW_PRIVATE_VALUE_${logicalId}`,
    ...overrides,
  };
}

function view(revision = 1, overrides = {}) {
  return {
    regionId: 'rg_feed',
    kind: 'repeated',
    role: 'feed',
    label: 'RAW_PRIVATE_VIEW_LABEL',
    viewRevision: revision,
    actionableCount: 8,
    repeatedEntityCount: 8,
    loadedEntityCount: 8,
    visibleEntityCount: 5,
    uniqueCanonicalLinkCount: 0,
    duplicateKeyCount: 0,
    ambiguityCount: 0,
    dependencies: {
      entitySet: { fingerprint: `entities-${revision}`, count: 8 },
      scrollState: { fingerprint: `scroll-${revision}` },
    },
    exhaustion: { reachedBoundary: false, stableObservations: 0, status: 'PARTIAL' },
    completion: { status: 'PARTIAL', scope: 'RAW_PRIVATE_COMPLETION_SCOPE', evidence: [], limits: [], unresolved: [] },
    ...overrides,
  };
}

function observation({
  sourceRevision = 0,
  resultingRevision = 1,
  classification = 'RESET',
  changes = [],
  entities = [entity('a'), entity('b'), entity('c'), entity('d'), entity('e'), entity('f'), entity('g'), entity('h')],
  regions = [view(resultingRevision)],
  changedRegionIds = ['rg_feed'],
  removedRegionIds = [],
  documentGeneration = 1,
  ambiguityCount = 0,
  completeSnapshotRequired = classification === 'RESET',
  resetReason = classification === 'RESET' ? 'INITIAL_OBSERVATION' : undefined,
  bodyText = `RAW_PAGE_BODY_${'z'.repeat(16_000)}`,
  confidence = ambiguityCount ? 0.4 : 0.96,
} = {}) {
  return {
    text: bodyText,
    title: 'RAW_PAGE_TITLE',
    url: 'https://example.test/private?session=RAW_URL_SECRET',
    semanticState: {
      schemaVersion: 1,
      documentGeneration,
      observationRevision: resultingRevision,
      entityCount: entities.length,
      observedEntityCount: entities.length,
      ambiguityCount,
      collisionCount: 0,
      excludedSensitiveCount: entities.filter((item) => item.sensitive).length,
      cacheBytes: 2048,
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
        observedAt: 123456,
        sourceRevision: resultingRevision,
        sensor: 'DOM_ACCESSIBILITY',
        confidence,
        rawNote: 'RAW_PROVENANCE_PRIVATE_NOTE',
      },
      regions,
      changedRegionIds,
      removedRegionIds,
      viewDelta: {
        sourceClassification: classification,
        invalidatedViews: changedRegionIds.map((regionId) => ({
          regionId,
          causes: ['ENTITY_DEPENDENCY_CHANGED'],
          rawReason: 'RAW_INVALIDATION_PRIVATE_NOTE',
        })),
        removedRegionIds,
      },
    },
  };
}

function nextObservation(previous, {
  type = 'UPDATE',
  logicalId = 'a',
  classification = type,
  entityOverrides = {},
  changedRegionIds = ['rg_feed'],
  removedRegionIds = [],
  regions,
  changes,
} = {}) {
  const sourceRevision = previous.semanticDelta.resultingRevision;
  const resultingRevision = sourceRevision + 1;
  const priorEntities = previous.elements.filter((item) => !item.sensitive).map((item) => structuredClone(item));
  let entities = priorEntities;
  let effectiveChanges = changes;
  if (!effectiveChanges) {
    if (type === 'INSERT') {
      entities.push(entity(logicalId, resultingRevision, entityOverrides));
      effectiveChanges = [{ type, logicalId, revision: resultingRevision }];
    } else if (type === 'REMOVE') {
      entities = entities.filter((item) => item.logicalId !== logicalId);
      effectiveChanges = [{ type, logicalId, revision: resultingRevision }];
    } else {
      entities = entities.map((item) => item.logicalId === logicalId
        ? { ...item, semanticRevision: resultingRevision, ...entityOverrides }
        : item);
      effectiveChanges = [{ type, logicalId, revision: resultingRevision }];
    }
  }
  return observation({
    sourceRevision,
    resultingRevision,
    classification,
    changes: effectiveChanges,
    entities,
    regions: regions ?? [view(resultingRevision)],
    changedRegionIds,
    removedRegionIds,
    completeSnapshotRequired: false,
    resetReason: undefined,
  });
}

function bootstrap(pipeline, id = identity(), obs = observation()) {
  const result = pipeline.observe(id, obs);
  assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
  return result;
}

function patch(result) {
  assert.equal(result.reasoningObservation.kind, 'COMPACT_PATCH');
  assert.equal(result.reasoningObservation.fullSnapshotIncluded, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.reasoningObservation, 'fullSnapshot'), false);
  return result.reasoningObservation;
}

function sha1Blob(bytes) {
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test('P2 bootstrap sends the full rich snapshot and reconstructs canonical state', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const rich = observation();
  const result = bootstrap(pipeline, identity(), rich);
  assert.equal(result.reasoningObservation.classification, 'RESET');
  assert.equal(result.reasoningObservation.resetRequired, false);
  assert.equal(result.reasoningObservation.fullSnapshotIncluded, true);
  assert.deepEqual(result.reasoningObservation.fullSnapshot, rich);
  assert.equal(result.canonicalState.semanticRevision, 1);
  assert.equal(result.canonicalState.entityCount, 8);
});

test('P2 valid contiguous UPDATE emits changed entity/view patch instead of full snapshot', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = nextObservation(first, { type: 'UPDATE', logicalId: 'a', entityOverrides: { inViewport: false } });
  const result = pipeline.observe(identity(), second);
  const out = patch(result);
  assert.equal(out.sourceRevision, 1);
  assert.equal(out.resultingRevision, 2);
  assert.equal(out.classification, 'UPDATE');
  assert.deepEqual(out.patch.updatedEntities.map((item) => item.logicalId), ['a']);
  assert.equal(out.patch.updatedEntities[0].inViewport, false);
  assert.equal(out.patch.changedViews[0].regionId, 'rg_feed');
  assert.equal(out.continuity.status, 'CONTIGUOUS');
});

test('P2 INSERT, MOVE, and REMOVE are represented without direct action handles', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  let current = observation();
  bootstrap(pipeline, identity(), current);

  const inserted = nextObservation(current, { type: 'INSERT', logicalId: 'new' });
  let out = patch(pipeline.observe(identity(), inserted));
  assert.deepEqual(out.patch.insertedEntities.map((item) => item.logicalId), ['new']);
  assert.equal('ref' in out.patch.insertedEntities[0], false);
  current = inserted;

  const moved = nextObservation(current, { type: 'MOVE', logicalId: 'new', entityOverrides: { regionKey: 'rg_feed' } });
  out = patch(pipeline.observe(identity(), moved));
  assert.deepEqual(out.patch.movedEntities.map((item) => item.logicalId), ['new']);
  current = moved;

  const removed = nextObservation(current, { type: 'REMOVE', logicalId: 'new' });
  out = patch(pipeline.observe(identity(), removed));
  assert.deepEqual(out.patch.removedLogicalIds, ['new']);
  assert.deepEqual(out.patch.insertedEntities, []);
  assert.equal(pipeline.inspect(identity()).entities.some((item) => item.logicalId === 'new'), false);
});

test('P2 MIXED delta carries inserted/updated/moved/removed entities and affected views', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const entities = first.elements
    .filter((item) => item.logicalId !== 'd')
    .map((item) => item.logicalId === 'a' ? { ...item, semanticRevision: 2, inViewport: false }
      : item.logicalId === 'b' ? { ...item, semanticRevision: 2, regionKey: 'rg_feed' }
      : item);
  entities.push(entity('new', 2));
  const mixed = observation({
    sourceRevision: 1,
    resultingRevision: 2,
    classification: 'MIXED',
    completeSnapshotRequired: false,
    resetReason: undefined,
    entities,
    changes: [
      { type: 'UPDATE', logicalId: 'a', revision: 2 },
      { type: 'MOVE', logicalId: 'b', revision: 2 },
      { type: 'REMOVE', logicalId: 'd', revision: 2 },
      { type: 'INSERT', logicalId: 'new', revision: 2 },
    ],
  });
  const out = patch(pipeline.observe(identity(), mixed));
  assert.deepEqual(out.patch.updatedEntities.map((item) => item.logicalId), ['a']);
  assert.deepEqual(out.patch.movedEntities.map((item) => item.logicalId), ['b']);
  assert.deepEqual(out.patch.removedLogicalIds, ['d']);
  assert.deepEqual(out.patch.insertedEntities.map((item) => item.logicalId), ['new']);
  assert.deepEqual(out.patch.invalidatedViews.map((item) => item.regionId), ['rg_feed']);
});

test('P2 NO_RELEVANT_CHANGE emits an empty bounded compact patch without task relevance suppression', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = observation({
    sourceRevision: 1,
    resultingRevision: 2,
    classification: 'NO_RELEVANT_CHANGE',
    changes: [],
    entities: first.elements,
    regions: [view(1)],
    changedRegionIds: [],
    completeSnapshotRequired: false,
    resetReason: undefined,
  });
  const out = patch(pipeline.observe(identity(), second));
  assert.equal(out.classification, 'NO_RELEVANT_CHANGE');
  assert.deepEqual(out.patch.insertedEntities, []);
  assert.deepEqual(out.patch.updatedEntities, []);
  assert.deepEqual(out.patch.movedEntities, []);
  assert.deepEqual(out.patch.removedLogicalIds, []);
  assert.deepEqual(out.patch.changedViews, []);
});

test('P2 exact replay is idempotent and does not resend changed facts', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = nextObservation(first);
  pipeline.observe(identity(), second);
  const replay = patch(pipeline.observe(identity(), structuredClone(second)));
  assert.equal(replay.continuity.status, 'REPLAY');
  assert.equal(replay.continuity.replayed, true);
  assert.deepEqual(replay.patch.updatedEntities, []);
  assert.deepEqual(replay.patch.changedViews, []);
});

test('P2 incompatible duplicate, revision gap, and out-of-order input fail closed to full snapshot/reset-required', () => {
  for (const makeBad of [
    (second) => { const bad = structuredClone(second); bad.elements[0].inViewport = !bad.elements[0].inViewport; return bad; },
    (second) => observation({ sourceRevision: 4, resultingRevision: 5, classification: 'NO_RELEVANT_CHANGE', changes: [], entities: second.elements, regions: second.semanticViews.regions, changedRegionIds: [], completeSnapshotRequired: false, resetReason: undefined }),
    (second) => observation({ sourceRevision: 0, resultingRevision: 0, classification: 'NO_RELEVANT_CHANGE', changes: [], entities: second.elements, regions: second.semanticViews.regions, changedRegionIds: [], completeSnapshotRequired: false, resetReason: undefined }),
  ]) {
    const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
    const first = observation();
    bootstrap(pipeline, identity(), first);
    const second = nextObservation(first);
    pipeline.observe(identity(), second);
    const result = pipeline.observe(identity(), makeBad(second));
    assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
    assert.equal(result.reasoningObservation.resetRequired, true);
    assert.equal(result.reasoningObservation.fullSnapshotIncluded, true);
    assert.equal(result.canonicalState, null);
    assert.equal(pipeline.hasContinuity(identity()), false);
  }
});

test('P2 cross-tab/document/runtime epoch input never inherits another continuity chain', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = nextObservation(first);
  for (const changedIdentity of [
    identity({ tabId: 'tab-b' }),
    identity({ documentGeneration: 2 }),
    identity({ runtimeEpoch: 'epoch-b' }),
  ]) {
    const result = pipeline.observe(changedIdentity, second);
    assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
    assert.equal(result.reasoningObservation.resetRequired, true);
    assert.equal(result.reasoningObservation.fullSnapshotIncluded, true);
    assert.equal(result.canonicalState, null);
  }
});

test('P2 ambiguity and working-state overflow fail closed without stale continuation', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000, maxEntitiesPerState: 8 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const ambiguous = nextObservation(first);
  ambiguous.semanticState.ambiguityCount = 1;
  ambiguous.elements[0].identityAmbiguous = true;
  const ambiguity = pipeline.observe(identity(), ambiguous);
  assert.equal(ambiguity.reasoningObservation.resetRequired, true);
  assert.equal(pipeline.hasContinuity(identity()), false);

  const overflowPipeline = createDeltaFirstObservationPipeline({ now: () => 1000, maxEntitiesPerState: 2 });
  const overflow = overflowPipeline.observe(identity(), observation());
  assert.equal(overflow.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(overflow.reasoningObservation.resetRequired, true);
  assert.equal(overflow.reasoningObservation.resetReason, 'OVERFLOW');
  assert.equal(overflow.canonicalState, null);
});

test('P2 expired and evicted P1 state requires reset/full snapshot before continuity can resume', () => {
  let now = 1000;
  const expiring = createDeltaFirstObservationPipeline({ now: () => now, maxAgeMs: 10 });
  const first = observation();
  bootstrap(expiring, identity(), first);
  now = 1100;
  let result = expiring.observe(identity(), nextObservation(first));
  assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(result.reasoningObservation.resetRequired, true);
  assert.equal(expiring.hasContinuity(identity()), false);

  const evicting = createDeltaFirstObservationPipeline({ now: () => 1000, maxStates: 1 });
  bootstrap(evicting, identity({ tabId: 'tab-1' }), first);
  bootstrap(evicting, identity({ tabId: 'tab-2' }), first);
  result = evicting.observe(identity({ tabId: 'tab-1' }), nextObservation(first));
  assert.equal(result.reasoningObservation.resetRequired, true);
  assert.equal(result.canonicalState, null);
});

test('P2 RESET always delivers full snapshot and rebuilds a fresh canonical chain', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  const boot = bootstrap(pipeline, identity(), first);
  const second = nextObservation(first);
  pipeline.observe(identity(), second);
  const reset = observation({
    sourceRevision: 0,
    resultingRevision: 1,
    classification: 'RESET',
    documentGeneration: 2,
    resetReason: 'DOCUMENT_GENERATION_CHANGED',
  });
  const rebuilt = pipeline.observe(identity({ documentGeneration: 2 }), reset);
  assert.equal(rebuilt.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(rebuilt.reasoningObservation.resetRequired, false);
  assert.notEqual(rebuilt.canonicalState.stateId, boot.canonicalState.stateId);
  assert.equal(rebuilt.canonicalState.documentGeneration, 2);
});

test('P2 delta and view mismatch never silently advances canonical state', () => {
  for (const mutate of [
    (obs) => { obs.elements[0].semanticRevision = 2; obs.elements[0].inViewport = false; },
    (obs) => { obs.semanticViews.regions[0].viewRevision = 2; },
  ]) {
    const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
    const first = observation();
    bootstrap(pipeline, identity(), first);
    const bad = observation({
      sourceRevision: 1,
      resultingRevision: 2,
      classification: 'NO_RELEVANT_CHANGE',
      changes: [],
      entities: structuredClone(first.elements),
      regions: [view(1)],
      changedRegionIds: [],
      completeSnapshotRequired: false,
      resetReason: undefined,
    });
    mutate(bad);
    const result = pipeline.observe(identity(), bad);
    assert.equal(result.reasoningObservation.resetRequired, true);
    assert.equal(result.canonicalState, null);
    assert.equal(pipeline.hasContinuity(identity()), false);
  }
});

test('P2 compact patch is bounded and excludes raw/sensitive page data', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000, maxPatchBytes: 8192 });
  const safe = observation();
  bootstrap(pipeline, identity(), safe);
  const sensitive = entity('sensitive', 2, {
    sensitive: true,
    text: 'TOP_SECRET_SENSITIVE_TEXT',
    label: 'TOP_SECRET_SENSITIVE_LABEL',
    href: 'https://example.test/?secret=TOP_SECRET_HREF',
    value: 'TOP_SECRET_VALUE',
  });
  const second = nextObservation(safe, { type: 'UPDATE', logicalId: 'a', entityOverrides: { inViewport: false } });
  second.elements.push(sensitive);
  second.semanticState.excludedSensitiveCount = 1;
  const out = patch(pipeline.observe(identity(), second));
  const encoded = JSON.stringify(out);
  assert.ok(reasoningPayloadBytes(out) <= out.accounting.maxPatchBytes);
  assert.equal(out.accounting.compactPatchBytes, reasoningPayloadBytes(out));
  for (const forbidden of ['RAW_PAGE_BODY_', 'RAW_PRIVATE_TEXT_', 'RAW_PRIVATE_LABEL_', 'RAW_PRIVATE_HREF_', 'RAW_PRIVATE_VALUE_', 'RAW_PRIVATE_VIEW_LABEL', 'RAW_PRIVATE_COMPLETION_SCOPE', 'RAW_PROVENANCE_PRIVATE_NOTE', 'RAW_INVALIDATION_PRIVATE_NOTE', 'TOP_SECRET']) {
    assert.doesNotMatch(encoded, new RegExp(forbidden));
  }
  assert.equal(encoded.includes('"ref"'), false);
});

test('P2 patch overflow falls back to full snapshot and discards unsafe continuity', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000, maxPatchBytes: 300 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = nextObservation(first, { type: 'UPDATE', logicalId: 'a' });
  const result = pipeline.observe(identity(), second);
  assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(result.reasoningObservation.resetRequired, true);
  assert.equal(result.reasoningObservation.resetReason, 'PATCH_OVERFLOW');
  assert.equal(result.canonicalState, null);
  assert.equal(pipeline.hasContinuity(identity()), false);
});

test('P2 canonical reconstructed state remains equal to the trusted rich observation after mixed incremental changes', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  let current = observation();
  bootstrap(pipeline, identity(), current);
  current = nextObservation(current, { type: 'UPDATE', logicalId: 'a', entityOverrides: { inViewport: false } });
  pipeline.observe(identity(), current);
  current = nextObservation(current, { type: 'INSERT', logicalId: 'new' });
  pipeline.observe(identity(), current);
  current = nextObservation(current, { type: 'MOVE', logicalId: 'new', entityOverrides: { inViewport: false } });
  pipeline.observe(identity(), current);
  current = nextObservation(current, { type: 'REMOVE', logicalId: 'new' });
  const result = pipeline.observe(identity(), current);
  assert.deepEqual(result.canonicalState, pipeline.inspect(identity()));
  const ids = result.canonicalState.entities.map((item) => item.logicalId);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.equal(result.canonicalState.entities.find((item) => item.logicalId === 'a').inViewport, false);
});

test('P2 fallback never silently continues stale state and requires a trusted reset to resume compact delivery', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = nextObservation(first);
  pipeline.observe(identity(), second);
  const gap = observation({ sourceRevision: 4, resultingRevision: 5, classification: 'NO_RELEVANT_CHANGE', changes: [], entities: second.elements, regions: second.semanticViews.regions, changedRegionIds: [], completeSnapshotRequired: false, resetReason: undefined });
  let result = pipeline.observe(identity(), gap);
  assert.equal(result.reasoningObservation.resetRequired, true);
  assert.equal(pipeline.hasContinuity(identity()), false);

  const stillNotReset = observation({ sourceRevision: 5, resultingRevision: 6, classification: 'NO_RELEVANT_CHANGE', changes: [], entities: second.elements, regions: second.semanticViews.regions, changedRegionIds: [], completeSnapshotRequired: false, resetReason: undefined });
  result = pipeline.observe(identity(), stillNotReset);
  assert.equal(result.reasoningObservation.resetRequired, true);
  assert.equal(result.reasoningObservation.resetReason, 'MISSING_CONTINUITY');
  assert.equal(pipeline.hasContinuity(identity()), false);

  const reset = observation({ sourceRevision: 0, resultingRevision: 1, classification: 'RESET', resetReason: 'EXPLICIT_RECOVERY' });
  result = pipeline.observe(identity(), reset);
  assert.equal(result.reasoningObservation.resetRequired, false);
  assert.equal(pipeline.hasContinuity(identity()), true);
  const afterReset = nextObservation(reset);
  assert.equal(pipeline.observe(identity(), afterReset).reasoningObservation.kind, 'COMPACT_PATCH');
});

test('P2 explicit verification/fresh-observation requirement keeps full snapshot without losing valid canonical state', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = nextObservation(first);
  const result = pipeline.observe(identity(), second, { freshObservationRequired: true, verificationReason: 'PROOF_RECHECK' });
  assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(result.reasoningObservation.fullSnapshotIncluded, true);
  assert.equal(result.reasoningObservation.resetRequired, false);
  assert.equal(result.reasoningObservation.verification.freshObservationRequired, true);
  assert.equal(result.reasoningObservation.verification.reason, 'PROOF_RECHECK');
  assert.equal(result.canonicalState.semanticRevision, 2);
  assert.equal(pipeline.hasContinuity(identity()), true);
});

test('P2 does not synthesize completion or foreground/browser authority', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000 });
  const first = observation();
  bootstrap(pipeline, identity(), first);
  const second = nextObservation(first);
  const out = patch(pipeline.observe(identity(), second));
  const encoded = JSON.stringify(out);
  assert.equal(out.patch.changedViews[0].completionStatus, 'PARTIAL');
  assert.doesNotMatch(encoded, /\bPROVED\b/);
  assert.doesNotMatch(encoded, /activate_tab|executionMode|foreground|page\.click|page\.fill|pointer/i);
});

test('P2 leaves extension bytes and existing read_page/public MCP source unchanged', async () => {
  const files = new Map([
    ['../extension/content.js', 'e4363c6f016eba499eca6e6b1c2e8a1f8eac5669'],
    ['../extension/background.js', 'c9702946f205274dc54096246d12f7596b2eb544'],
    ['../extension/manifest.json', 'ef0890b1dfbc6e24a3741bee04c5099179c936c1'],
    ['../supabase/functions/opera-agent-mcp/index.ts', 'a2f91e096d9c48ba7d40d82c9ce725dfb7bd3668'],
  ]);
  for (const [relativePath, expected] of files) {
    const bytes = await readFile(new URL(relativePath, import.meta.url));
    assert.equal(sha1Blob(bytes), expected, `${relativePath} must remain byte-for-byte unchanged in P2`);
  }
  const mcp = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(mcp, /server\.registerTool\("read_page"/);
  assert.match(mcp, /=> execute\("page\.read", args\)\);/);
  assert.doesNotMatch(mcp, /delta-first-observation-p2/);
});

test('P2 paired controlled small-change benchmark reduces median reasoning payload >= 75% with exact state agreement and zero safety regressions', () => {
  const pipeline = createDeltaFirstObservationPipeline({ now: () => 1000, maxPatchBytes: 8192 });
  let current = observation();
  bootstrap(pipeline, identity(), current);
  const reductions = [];
  let fallbackCount = 0;
  let resetCount = 0;
  let staleStateContinuation = 0;
  let falseCompletion = 0;
  let foregroundTakeover = 0;
  let relevantSemanticInformationLoss = 0;

  for (let index = 0; index < 9; index += 1) {
    const logicalId = String.fromCharCode(97 + (index % 8));
    current = nextObservation(current, { type: 'UPDATE', logicalId, entityOverrides: { inViewport: index % 2 === 0 } });
    const result = pipeline.observe(identity(), current);
    const out = result.reasoningObservation;
    if (out.kind !== 'COMPACT_PATCH') fallbackCount += 1;
    if (out.resetRequired) resetCount += 1;
    const richBytes = reasoningPayloadBytes(current);
    const compactBytes = reasoningPayloadBytes(out);
    reductions.push(1 - (compactBytes / richBytes));
    const changed = out.patch.updatedEntities.find((item) => item.logicalId === logicalId);
    if (!changed || changed.semanticRevision !== current.semanticDelta.resultingRevision) relevantSemanticInformationLoss += 1;
    if (!result.canonicalState || result.canonicalState.semanticRevision !== current.semanticDelta.resultingRevision) staleStateContinuation += 1;
    if (out.patch.changedViews.some((item) => item.completionStatus !== 'PARTIAL')) falseCompletion += 1;
    if (/activate_tab|foreground|executionMode/i.test(JSON.stringify(out))) foregroundTakeover += 1;
  }

  assert.ok(median(reductions) >= 0.75, `median reduction ${median(reductions)}`);
  assert.equal(fallbackCount, 0);
  assert.equal(resetCount, 0);
  assert.equal(staleStateContinuation, 0);
  assert.equal(falseCompletion, 0);
  assert.equal(foregroundTakeover, 0);
  assert.equal(relevantSemanticInformationLoss, 0);
});
