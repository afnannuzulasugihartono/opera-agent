// Last edited: 2026-10-04 17:52. Title: semantic-engine.test — Semantic engine surface, consolidated 2026-10-03. Now: consolidate the semantic engine cluster into one file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { sha256CanonicalLf } from './helpers/canonical-source-hash.mjs';

// Semantic engine surface, consolidated 2026-10-03.
//
// Six files drove the two engines behind every page.read: the identity engine
// that mints logicalIds across DOM churn, and the view engine that projects
// regions and completion status. Four of them loaded the engines through the
// content-script side-effect import and read the same `globalThis` bindings.
//
//   tests/semantic-baseline.test.mjs       3 tests   the frozen corpus
//   tests/semantic-identity.test.mjs      11 tests   identity engine
//   tests/semantic-views.test.mjs          7 tests   view engine
//   tests/semantic-delta.test.mjs          8 tests   delta classification
//   tests/stale-semantic-pruning.test.mjs  7 tests   stale pruning
//   tests/semantic-release-gate.test.mjs   4 tests   MCP digest + fuzz
//   -> tests/semantic-engine.test.mjs     40 tests
//
// Sections follow the engine: A the frozen corpus, B identity, C views, D
// delta, E stale pruning, F the release gate.
//
// Test count and assertion count are the invariants: 40 tests and 165
// assertions before, 40 and 165 after, none dropped, weakened or added. Proved
// by the masked source scan used for the previous clusters: 0 missing, 0 added.
//
// `createIdentityEngine` and `createViewEngine` were declared in four and two
// of the sources respectively and are declared once here. Six module-scope
// factories collided and each was renamed after the section that owns it:
//   deltaItem, viewItem, staleItem   (three different `item` factories)
//   identityElement, gateElement     (two different `element` factories)
// No factory body changed. Renaming is a merge necessity, not a cleanup, and
// the body of each is byte-identical to its source.
//
// The P1 working-state store is NOT here: it is a separate module with its own
// two files, in tests/semantic-working-state.test.mjs.

await import('../extension/semantic-identity.js');
await import('../extension/semantic-views.js');

const { createIdentityEngine } = globalThis.OperaAgentSemanticIdentity;
const { COMPLETION_STATUSES, classifyCompletion, createViewEngine } = globalThis.OperaAgentSemanticViews;

// --- A. the frozen corpus ---------------------------------------------------
//
// Why source-text and fixture pins, stated per AGENTS.md: this is the corpus
// the identity and view work is measured against, so its value is that it is
// fixed. These assertions check the required synthetic shapes are present, that
// the corpus and runner persist metadata only (no page text, no screenshots, no
// credentials in the evidence), and that the thresholds are bounded before
// identity work begins. They intentionally pin a baseline rather than behavior:
// the point is that a later change to these numbers must be a deliberate,
// visible act.

const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/semantic-replay-v1.json', import.meta.url), 'utf8'));
const thresholds = JSON.parse(fs.readFileSync(new URL('./fixtures/semantic-baseline-thresholds-v1.json', import.meta.url), 'utf8'));
const benchmark = fs.readFileSync(new URL('../scripts/semantic-baseline.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function keysDeep(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, output);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      output.push(key.toLowerCase());
      keysDeep(item, output);
    }
  }
  return output;
}

test('semantic replay v1 covers the required synthetic baseline shapes', () => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.baselineVersion, '1.5.2');
  assert.equal(corpus.privacy.syntheticOnly, true);

  const ids = corpus.scenarios.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const required of [
    'static-form-landmarks',
    'nested-lazy-list',
    'virtualized-detach-reinsert',
    'spa-route-change',
    'relevant-item-update',
    'irrelevant-mutation-storm',
    'canvas-with-semantic-controls',
    'stale-ref-and-ambiguity',
    'reconnect-and-restart',
  ]) assert.ok(ids.includes(required), required);

  for (const scenario of corpus.scenarios) {
    assert.ok(scenario.initial.entityCount >= 0);
    assert.ok(scenario.events.length > 0);
    assert.equal(scenario.expected.focusChanges, 0);
  }
});

test('semantic baseline corpus and runner persist metadata only', () => {
  const forbidden = new Set(corpus.privacy.forbiddenFields.map((field) => field.toLowerCase()));
  for (const key of keysDeep(corpus)) assert.equal(forbidden.has(key), false, `forbidden corpus field: ${key}`);
  const serialized = JSON.stringify(corpus);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /data:image\//i);
  assert.doesNotMatch(benchmark, /writeFile|appendFile|rawText|formValue|privateUrl/);
  assert.match(benchmark, /backgroundFocusPreserved/);
  assert.match(benchmark, /semanticPayloadBytes/);
  assert.match(benchmark, /semanticIdentityRerenderStable/);
  assert.match(benchmark, /semanticDeltaSingleUpdate/);
  assert.match(benchmark, /semanticDeltaToSnapshotRatio/);
  assert.match(benchmark, /semanticViewLazyGrowth/);
  assert.match(benchmark, /semanticViewBoundedComplete/);
  assert.match(benchmark, /semanticViewUnrelatedStable/);
  assert.match(benchmark, /semanticCausalProof/);
  assert.match(benchmark, /baselineSemanticIdentityStatus/);
  assert.equal(pkg.scripts['benchmark:semantic'], 'node scripts/semantic-baseline.mjs --runs=3');
});

test('semantic baseline thresholds are bounded before identity work begins', () => {
  assert.equal(thresholds.schemaVersion, 1);
  assert.equal(thresholds.baselineVersion, '1.5.2');
  assert.equal(thresholds.minimumRuns, 3);
  assert.equal(thresholds.invariants.maximumFocusChanges, 0);
  assert.equal(thresholds.invariants.maximumSensitiveValuesPersisted, 0);
  assert.equal(thresholds.invariants.maximumMedianRichReadRegressionPercent, 15);
  assert.ok(thresholds.invariants.maximumSingleItemDeltaToFullSnapshotRatio <= 0.5);
  assert.equal(thresholds.invariants.minimumDeterministicReplayAgreement, 1);
  assert.equal(thresholds.measurementStatus, 'RECORDED');
  assert.equal(thresholds.measured.runs >= thresholds.minimumRuns, true);
  assert.equal(thresholds.measured.focusChanges, 0);
  assert.equal(thresholds.measured.sensitiveValuesPersisted, 0);
  assert.equal(thresholds.measured.deterministicCorpusReplayAgreement, 1);
  assert.equal(thresholds.measured.semanticIdentityAgreement, null);
  assert.equal(thresholds.measured.singleItemDeltaToFullSnapshotRatio, null);
  assert.match(thresholds.measured.unavailableReason, /do not exist in baseline 1\.5\.2/);
  assert.equal(thresholds.measured.corpusSha256, '277d87d655859bd2a291cf286e9584e0bdc20ff9272d8059758641dd49f8e091');
});

// --- B. identity engine -----------------------------------------------------

function identityElement(overrides = {}) {
  return {
    ref: 'oa_doc_1',
    stableKey: 'oa_item_a',
    stableKeySource: 'id',
    tag: 'button',
    role: 'button',
    label: 'Open item',
    text: 'Open item',
    href: '',
    sensitive: false,
    ...overrides,
  };
}

test('stable intrinsic identity survives a compatible DOM-node replacement', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([identityElement()]);
  const second = engine.observe([identityElement({ ref: 'oa_doc_2' })]);

  assert.equal(second.items[0].logicalId, first.items[0].logicalId);
  assert.equal(second.items[0].semanticRevision, 1);
  assert.equal(second.items[0].identityAmbiguous ?? false, false);
});

test('a genuinely different intrinsic item cannot inherit an identity', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([identityElement()]);
  const second = engine.observe([identityElement({ ref: 'oa_doc_2', stableKey: 'oa_item_b', label: 'Other item', text: 'Other item' })]);

  assert.notEqual(second.items[0].logicalId, first.items[0].logicalId);
});

test('indistinguishable duplicate candidates are explicit ambiguities', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const result = engine.observe([
    identityElement({ ref: 'oa_doc_1', stableKeySource: 'semantic' }),
    identityElement({ ref: 'oa_doc_2', stableKeySource: 'semantic' }),
  ]);

  assert.equal(result.state.ambiguityCount, 2);
  assert.equal(result.items[0].identityAmbiguous, true);
  assert.equal(result.items[1].identityAmbiguous, true);
  assert.notEqual(result.items[0].logicalId, result.items[1].logicalId);
});

test('semantic changes retain intrinsic identity and increment its revision', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([identityElement()]);
  const second = engine.observe([identityElement({ ref: 'oa_doc_2', label: 'Close item', text: 'Close item' })]);

  assert.equal(second.items[0].logicalId, first.items[0].logicalId);
  assert.equal(second.items[0].semanticRevision, 2);
});

test('geometry changes have an independent revision and do not change identity', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([identityElement({ rect: { x: 10, y: 20, width: 100, height: 30 }, inViewport: true })]);
  const second = engine.observe([identityElement({ ref: 'oa_doc_2', rect: { x: 10, y: 70, width: 100, height: 30 }, inViewport: true })]);
  const cached = engine.inspect().entities[0];

  assert.equal(second.items[0].logicalId, first.items[0].logicalId);
  assert.equal(second.items[0].semanticRevision, 1);
  assert.equal(cached.geometryRevision, 2);
});

test('fresh engines deterministically replay the same logical identities', () => {
  const items = [identityElement(), identityElement({ ref: 'oa_doc_2', stableKey: 'oa_item_b' })];
  const left = createIdentityEngine({ documentId: 'document-a' }).observe(items.map((item) => ({ ...item })));
  const right = createIdentityEngine({ documentId: 'document-a' }).observe(items.map((item) => ({ ...item })));

  assert.deepEqual(left.items.map((item) => item.logicalId), right.items.map((item) => item.logicalId));
});

test('bounded corpus-sized observations produce no logical ID collision', () => {
  const engine = createIdentityEngine({ documentId: 'document-a', maxEntities: 500 });
  const result = engine.observe(Array.from({ length: 500 }, (_, index) => identityElement({
    ref: `oa_doc_${index}`,
    stableKey: `oa_record_${String(index).padStart(3, '0')}`,
  })));
  const logicalIds = result.items.map((item) => item.logicalId);

  assert.equal(new Set(logicalIds).size, 500);
  assert.equal(result.state.collisionCount, 0);
});

test('logical IDs remain observational and are absent from every action schema', () => {
  const protocol = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  assert.doesNotMatch(protocol, /logicalId/);
});

test('sensitive elements are never retained in the semantic identity cache', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const result = engine.observe([identityElement({ sensitive: true, label: 'Password', text: '' })]);

  assert.equal(result.items[0].logicalId, undefined);
  assert.equal(result.state.entityCount, 0);
  assert.equal(result.state.excludedSensitiveCount, 1);
  assert.doesNotMatch(JSON.stringify(engine.inspect()), /Password/);
});

test('cache limits and explicit reset bound retained identity state', () => {
  let now = 1_000;
  const engine = createIdentityEngine({
    documentId: 'document-a',
    maxEntities: 2,
    maxCacheBytes: 2_000,
    maxAgeMs: 50,
    now: () => now,
  });
  engine.observe([identityElement({ stableKey: 'oa_a' }), identityElement({ ref: 'oa_2', stableKey: 'oa_b' })]);
  engine.observe([identityElement({ ref: 'oa_3', stableKey: 'oa_c' })]);
  assert.ok(engine.inspect().entityCount <= 2);

  now += 60;
  engine.observe([]);
  assert.equal(engine.inspect().entityCount, 0);

  engine.observe([identityElement()]);
  const reset = engine.reset('SPA_ROUTE');
  assert.equal(reset.resetReason, 'SPA_ROUTE');
  assert.equal(reset.documentGeneration, 2);
  assert.equal(engine.inspect().entityCount, 0);
});

test('cache inspection stores only hashed bindings, never raw hrefs', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  engine.observe([identityElement({
    stableKey: '',
    stableKeySource: '',
    tag: 'a',
    href: 'https://example.test/account?private_token=secret-value#fragment',
  })]);

  const cache = JSON.stringify(engine.inspect());
  assert.doesNotMatch(cache, /private_token|secret-value|example\.test/);
});

// --- C. view engine ---------------------------------------------------------

const region = (overrides = {}) => ({ regionId: 'region-feed', kind: 'repeated', role: 'feed', label: 'Results', ...overrides });
const viewItem = (id, overrides = {}) => ({ logicalId: `logical-${id}`, semanticRevision: 1, regionKey: 'region-feed', stableKey: `key-${id}`, stableKeySource: 'id', inViewport: true, ...overrides });

test('a repeated region grows incrementally and only its view revision changes', () => {
  const engine = createViewEngine();
  const first = engine.observe({ regions: [region(), region({ regionId: 'region-main', kind: 'landmark', role: 'main' })], items: [viewItem('a')] });
  const second = engine.observe({ regions: [region(), region({ regionId: 'region-main', kind: 'landmark', role: 'main' })], items: [viewItem('a'), viewItem('b')] });
  assert.equal(second.regions[0].loadedEntityCount, 2);
  assert.equal(second.regions[0].viewRevision, first.regions[0].viewRevision + 1);
  assert.equal(second.regions[1].viewRevision, first.regions[1].viewRevision);
  assert.deepEqual(second.changedRegionIds, ['region-feed']);
});

test('boundary requires two stable observations before bounded completion', () => {
  const engine = createViewEngine();
  const scroll = { scrollTop: 500, scrollHeight: 600, clientHeight: 100, reachedBottom: true };
  const first = engine.observe({ regions: [region({ scroll })], items: [viewItem('a')] });
  const second = engine.observe({ regions: [region({ scroll })], items: [viewItem('a')] });
  assert.equal(first.regions[0].exhaustion.status, 'PARTIAL');
  assert.equal(second.regions[0].exhaustion.status, 'BOUNDED_COMPLETE');
});

test('scroll evidence changes only the affected region revision', () => {
  const engine = createViewEngine();
  const main = region({ regionId: 'region-main', kind: 'landmark', role: 'main' });
  const first = engine.observe({
    regions: [region({ scroll: { scrollTop: 0, scrollHeight: 600, clientHeight: 100, reachedBottom: false } }), main],
    items: [viewItem('a')],
  });
  const second = engine.observe({
    regions: [region({ scroll: { scrollTop: 500, scrollHeight: 600, clientHeight: 100, reachedBottom: true } }), main],
    items: [viewItem('a')],
  });
  assert.equal(second.regions[0].viewRevision, first.regions[0].viewRevision + 1);
  assert.equal(second.regions[1].viewRevision, first.regions[1].viewRevision);
  assert.deepEqual(second.changedRegionIds, ['region-feed']);
});

test('views distinguish loaded, visible, links, duplicates, and ambiguity', () => {
  const engine = createViewEngine();
  const result = engine.observe({ regions: [region()], items: [
    viewItem('a', { stableKey: 'href-a', stableKeySource: 'href' }),
    viewItem('b', { inViewport: false, stableKey: 'duplicate', identityAmbiguous: true }),
    viewItem('c', { stableKey: 'duplicate', identityAmbiguous: true }),
  ] }).regions[0];
  assert.equal(result.loadedEntityCount, 3);
  assert.equal(result.visibleEntityCount, 2);
  assert.equal(result.uniqueCanonicalLinkCount, 1);
  assert.equal(result.duplicateKeyCount, 1);
  assert.equal(result.ambiguityCount, 2);
});

test('region and entity bounds are enforced', () => {
  const engine = createViewEngine({ maxRegions: 2, maxEntities: 2 });
  const result = engine.observe({
    regions: [region(), region({ regionId: 'two' }), region({ regionId: 'three' })],
    items: [viewItem('a'), viewItem('b'), viewItem('c')],
  });
  assert.equal(result.regions.length, 2);
  assert.equal(result.regions[0].loadedEntityCount, 2);
});

test('dependency delta invalidates only causally changed views', () => {
  const engine = createViewEngine({ now: () => 1234 });
  engine.observe({ regions: [region(), region({ regionId: 'region-main', role: 'main' })], items: [viewItem('a')] });
  const result = engine.observe({
    regions: [region(), region({ regionId: 'region-main', role: 'main' })],
    items: [viewItem('a'), viewItem('b')],
    semanticState: { revision: 7 },
    delta: { classification: 'INSERT' },
  });
  assert.deepEqual(result.viewDelta.invalidatedViews.map((entry) => entry.regionId), ['region-feed']);
  assert.equal(result.viewDelta.sourceClassification, 'INSERT');
  assert.deepEqual(result.regions[0].dependencies.entitySet.count, 2);
  assert.deepEqual(result.provenance, {
    category: 'DIRECT_OBSERVATION', observedAt: 1234, sourceRevision: 7, sensor: 'DOM_ACCESSIBILITY', confidence: 0.9,
  });
});

test('action success alone can never manufacture a PROVED completion', () => {
  assert.deepEqual(COMPLETION_STATUSES, ['PROVED', 'BOUNDED_COMPLETE', 'PARTIAL', 'BLOCKED', 'UNKNOWN']);
  assert.equal(classifyCompletion({ actionSuccess: true }).status, 'UNKNOWN');
  assert.equal(classifyCompletion({ observed: true, actionSuccess: true }).status, 'PARTIAL');
  assert.equal(classifyCompletion({ observed: true, boundaryStable: true }).status, 'PARTIAL');
  assert.equal(classifyCompletion({ observed: true, boundaryStable: true, evidence: ['stable boundary'] }).status, 'BOUNDED_COMPLETE');
  assert.equal(classifyCompletion({ blockedReason: 'permission denied' }).status, 'BLOCKED');
  assert.equal(classifyCompletion({ scopeKind: 'closed-world', exhaustiveEvidence: true }).status, 'UNKNOWN');
  assert.equal(classifyCompletion({ scopeKind: 'closed-world', exhaustiveEvidence: true, evidence: ['enumerated finite set'] }).status, 'PROVED');
});

// --- D. delta classification ------------------------------------------------

const deltaItem = (key, overrides = {}) => {
  return {
    ref: `ref-${key}`,
    stableKey: `key-${key}`,
    stableKeySource: 'id',
    tag: 'button',
    role: 'button',
    label: `Item ${key}`,
    text: `Item ${key}`,
    rect: { x: 0, y: 0, width: 100, height: 30 },
    inViewport: true,
    sensitive: false,
    ...overrides,
  };
};

test('first observation and explicit reset require a complete snapshot', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const first = engine.observe([deltaItem('a')]);
  assert.equal(first.delta.classification, 'RESET');
  assert.equal(first.delta.resetReason, 'INITIAL_OBSERVATION');
  assert.equal(first.delta.completeSnapshotRequired, true);

  engine.reset('EXTENSION_RESTART');
  const restarted = engine.observe([deltaItem('a')]);
  assert.equal(restarted.delta.classification, 'RESET');
  assert.equal(restarted.delta.resetReason, 'EXTENSION_RESTART');
});

test('one semantic mutation produces exactly one UPDATE', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const first = engine.observe([deltaItem('a')]);
  const second = engine.observe([deltaItem('a', { label: 'Updated', text: 'Updated' })]);

  assert.equal(second.delta.classification, 'UPDATE');
  assert.equal(second.delta.changes.length, 1);
  assert.deepEqual(second.delta.changes[0], {
    type: 'UPDATE',
    logicalId: first.items[0].logicalId,
    revision: 2,
    reason: 'SEMANTIC_FIELDS_CHANGED',
    confidence: 0.98,
  });
});

test('irrelevant observation churn produces NO_RELEVANT_CHANGE', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  engine.observe([deltaItem('a')]);
  const unchanged = engine.observe([deltaItem('a')]);
  assert.equal(unchanged.delta.classification, 'NO_RELEVANT_CHANGE');
  assert.deepEqual(unchanged.delta.changes, []);
});

test('geometry and ordering changes produce MOVE without changing semantic revision', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const first = engine.observe([deltaItem('a'), deltaItem('b')]);
  const moved = engine.observe([
    deltaItem('b', { ref: 'ref-b-2', rect: { x: 0, y: 40, width: 100, height: 30 } }),
    deltaItem('a', { ref: 'ref-a-2', rect: { x: 0, y: 80, width: 100, height: 30 } }),
  ]);

  assert.equal(moved.delta.classification, 'MOVE');
  assert.equal(moved.delta.changes.length, 2);
  assert.ok(moved.delta.changes.every((change) => change.type === 'MOVE'));
  assert.deepEqual(moved.items.map((entry) => entry.semanticRevision), [1, 1]);
  assert.deepEqual(new Set(moved.items.map((entry) => entry.logicalId)), new Set(first.items.map((entry) => entry.logicalId)));
});

test('virtualized one-observation detach/reinsert preserves identity without REMOVE/INSERT', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document', removalGraceObservations: 1 });
  const first = engine.observe([deltaItem('a')]);
  const detached = engine.observe([]);
  assert.equal(detached.delta.classification, 'NO_RELEVANT_CHANGE');

  const reinserted = engine.observe([deltaItem('a', { ref: 'ref-a-new' })]);
  assert.equal(reinserted.items[0].logicalId, first.items[0].logicalId);
  assert.notEqual(reinserted.delta.classification, 'INSERT');
  assert.equal(reinserted.delta.changes.some((change) => change.type === 'REMOVE'), false);
});

test('a removal is emitted after the bounded grace window', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document', removalGraceObservations: 1 });
  const first = engine.observe([deltaItem('a')]);
  engine.observe([]);
  const removed = engine.observe([]);
  assert.equal(removed.delta.classification, 'REMOVE');
  assert.equal(removed.delta.changes[0].logicalId, first.items[0].logicalId);
});

test('insertions are bounded and overflow degrades to a safe RESET', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document', maxDeltaChanges: 2, maxDeltaBytes: 2_000 });
  engine.observe([]);
  const overflow = engine.observe([deltaItem('a'), deltaItem('b'), deltaItem('c')]);
  assert.equal(overflow.delta.classification, 'RESET');
  assert.equal(overflow.delta.resetReason, 'OUTPUT_CAP');
  assert.equal(overflow.delta.completeSnapshotRequired, true);
  assert.deepEqual(overflow.delta.changes, []);
});

test('a one-item delta is materially smaller than a 100-item snapshot', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const hundred = Array.from({ length: 100 }, (_, index) => deltaItem(String(index).padStart(3, '0')));
  const first = engine.observe(hundred);
  const changed = hundred.map((entry, index) => index === 50 ? { ...entry, label: 'Changed', text: 'Changed' } : { ...entry });
  const second = engine.observe(changed);
  const ratio = JSON.stringify(second.delta).length / JSON.stringify(first.items).length;

  assert.equal(second.delta.classification, 'UPDATE');
  assert.ok(ratio <= 0.5, ratio);
});

// --- E. stale pruning -------------------------------------------------------
//
// U-P3 (research P3, 2026-09-20 method matrix): stale semantic pruning.
// (A) entities observed present-but-invisible for N consecutive observations
// are marked stale in the model-facing view while canonical state keeps them;
// (B) compact observations drop stale items so dismissed panels (Miro
// remnants, FAQ/cookie controls) stop reaching the model; (C) entities that
// return after a grace removal emit RETURNED_AFTER_ABSENCE instead of
// NEW_ENTITY so virtualized feeds (X scroll) stop reporting recurring state
// as new. Canonical identity is preserved in every path.

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const content = read('../extension/content.js');

const staleItem = (key, overrides = {}) => {
  return {
    ref: `ref-${key}`,
    stableKey: `key-${key}`,
    stableKeySource: 'id',
    tag: 'button',
    role: 'button',
    label: `Item ${key}`,
    text: `Item ${key}`,
    rect: { x: 0, y: 0, width: 100, height: 30 },
    inViewport: true,
    visible: true,
    sensitive: false,
    ...overrides,
  };
};

test('entity invisible for N consecutive observations is marked stale', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  const first = engine.observe([staleItem('a')]);
  assert.notEqual(first.items[0].stale, true);
  const second = engine.observe([staleItem('a', { visible: false })]);
  assert.notEqual(second.items[0].stale, true);
  const third = engine.observe([staleItem('a', { visible: false })]);
  assert.equal(third.items[0].stale, true);
});

test('stale clears when the entity is observed visible again', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  engine.observe([staleItem('a')]);
  engine.observe([staleItem('a', { visible: false })]);
  const third = engine.observe([staleItem('a', { visible: false })]);
  assert.equal(third.items[0].stale, true);
  const fourth = engine.observe([staleItem('a')]);
  assert.notEqual(fourth.items[0].stale, true);
});

test('canonical state keeps stale entities with identity intact', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  engine.observe([staleItem('a')]);
  engine.observe([staleItem('a', { visible: false })]);
  const third = engine.observe([staleItem('a', { visible: false })]);
  assert.equal(third.items[0].stale, true);
  assert.ok(third.items[0].logicalId);
  assert.ok(third.items[0].semanticRevision >= 1);
  const state = engine.inspect();
  assert.equal(state.entityCount, 1);
  assert.equal(state.entities[0].stale, true);
});

test('entity absent one observation stays within grace without REMOVE', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  engine.observe([staleItem('a')]);
  const gone = engine.observe([]);
  assert.equal(gone.delta.classification, 'NO_RELEVANT_CHANGE');
  const back = engine.observe([staleItem('a')]);
  assert.notEqual(back.delta.classification, 'INSERT');
  assert.equal(back.delta.changes.some((change) => change.type === 'REMOVE'), false);
});

test('entity returning after grace removal emits RETURNED_AFTER_ABSENCE, not NEW_ENTITY', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  const first = engine.observe([staleItem('a')]);
  engine.observe([]);
  const gone = engine.observe([]);
  assert.equal(gone.delta.classification, 'REMOVE');
  const back = engine.observe([staleItem('a', { ref: 'ref-a-new' })]);
  assert.equal(back.items[0].logicalId, first.items[0].logicalId);
  assert.equal(back.delta.classification, 'UPDATE');
  assert.equal(back.delta.changes.length, 1);
  assert.equal(back.delta.changes[0].type, 'UPDATE');
  assert.equal(back.delta.changes[0].reason, 'RETURNED_AFTER_ABSENCE');
  const stable = engine.observe([staleItem('a', { ref: 'ref-a-new' })]);
  assert.equal(stable.delta.classification, 'NO_RELEVANT_CHANGE');
});

test('content.js drops stale items from compact observations (pruning)', () => {
  assert.match(content, /const add = \(item\) => \{\s*\n\s*if \(!item \|\| item\.sensitive \|\| item\.stale\) return;/);
});

test('stale tracking is bounded and resets cleanly', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  for (let index = 0; index < 10; index += 1) {
    engine.observe([staleItem('a', { visible: false })]);
  }
  engine.reset('EXPLICIT_RESET');
  const fresh = engine.observe([staleItem('a', { visible: false })]);
  assert.notEqual(fresh.items[0].stale, true);
  assert.equal(fresh.state.entityCount, 1);
});

// --- F. release gate and mutation fuzz --------------------------------------

const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/mcp-contract-v1.json', import.meta.url), 'utf8'));
const mcpSource = fs.readFileSync(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');

const gateElement = (key, overrides = {}) => {
  return {
    ref: `ref-${key}`, stableKey: `key-${key}`, stableKeySource: 'id', tag: 'button', role: 'button',
    label: `Item ${key}`, text: `Item ${key}`, rect: { x: 0, y: 0, width: 80, height: 24 },
    inViewport: true, sensitive: false, regionKey: 'feed', ...overrides,
  };
};

const random = (seed = 0x5f1600) => {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
};

test('MCP v1 tool names and input schemas remain byte-for-byte locked', () => {
  const digest = sha256CanonicalLf(mcpSource);
  const tools = [...mcpSource.matchAll(/server\.registerTool\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(contract.protocolVersion, 1);
  assert.equal(digest, contract.sourceSha256);
  assert.equal(tools.length, contract.toolCount);
  assert.deepEqual(tools, contract.tools);
});

test('legacy and enriched page.read results both survive the unchanged MCP envelope', () => {
  const envelope = (result) => JSON.parse(JSON.stringify({ ok: true, commandId: 'command', status: 'completed', result }));
  const legacy = envelope({ page: { title: 'Legacy', elements: [{ ref: 'oa_old' }] } });
  const enriched = envelope({ page: {
    title: 'Candidate', elements: [{ ref: 'oa_new', logicalId: 'se_new' }],
    semanticState: { observationRevision: 2 }, semanticDelta: { classification: 'UPDATE' },
    semanticViews: { schemaVersion: 1, regions: [] },
  } });
  assert.equal(legacy.result.page.semanticState, undefined);
  assert.equal(enriched.result.page.elements[0].logicalId, 'se_new');
  assert.equal(enriched.result.page.semanticDelta.classification, 'UPDATE');
  assert.match(mcpSource, /result: completed\.result/);
  assert.match(mcpSource, /structuredContent = value && typeof value === "object" \? value/);
});

test('deterministic mutation fuzz preserves bounds, uniqueness, resets, and proof safety', () => {
  const rng = random();
  let clock = 1000;
  const identity = createIdentityEngine({
    documentId: 'fuzz-document', maxEntities: 40, maxCacheBytes: 40_000, maxAgeMs: 100,
    maxDeltaChanges: 12, maxDeltaBytes: 8_000, now: () => clock,
  });
  const views = createViewEngine({ maxRegions: 4, maxEntities: 40, now: () => clock });
  let keys = [];
  for (let step = 0; step < 250; step += 1) {
    clock += 2;
    const choice = Math.floor(rng() * 6);
    if (choice <= 1 && keys.length < 55) keys.push(`k${step}`);
    else if (choice === 2 && keys.length) keys.splice(Math.floor(rng() * keys.length), 1);
    else if (choice === 3) keys.reverse();
    else if (choice === 4 && step % 31 === 0) identity.reset('FUZZ_RESET');
    const observed = keys.slice(0, 45).map((key, index) => gateElement(key, {
      label: `Item ${key} revision ${step % 17 === 0 && index === 0 ? step : 0}`,
      text: `Item ${key}`, inViewport: index < 8,
    }));
    const result = identity.observe(observed);
    const logicalIds = result.items.map((item) => item.logicalId).filter(Boolean);
    assert.equal(new Set(logicalIds).size, logicalIds.length);
    assert.ok(result.state.entityCount <= 40);
    assert.ok(result.state.cacheBytes <= 40_000);
    assert.ok(result.delta.changes.length <= 12 || result.delta.classification === 'RESET');
    const view = views.observe({
      regions: [{ regionId: 'feed', kind: 'repeated', role: 'feed', label: 'Results', scroll: {
        scrollTop: step, scrollHeight: 1000, clientHeight: 100, reachedBottom: false,
      } }], items: result.items, semanticState: result.state, delta: result.delta,
    });
    assert.ok(view.regions.length <= 4);
    assert.ok(view.regions[0].loadedEntityCount <= 40);
    assert.notEqual(view.regions[0].completion.status, 'PROVED');
  }
  clock += 200;
  identity.observe([]);
  assert.equal(identity.inspect().entityCount, 0);
});

test('document engines isolate identical entities and never retain sensitive values', () => {
  const first = createIdentityEngine({ documentId: 'tab-a' });
  const second = createIdentityEngine({ documentId: 'tab-b' });
  const a = first.observe([gateElement('same'), gateElement('secret', { sensitive: true, value: 'never-retain-me' })]);
  const b = second.observe([gateElement('same')]);
  assert.notEqual(a.items[0].logicalId, b.items[0].logicalId);
  assert.equal(a.items[1].logicalId, undefined);
  assert.doesNotMatch(JSON.stringify(first.inspect()), /never-retain-me|secret/);
});
