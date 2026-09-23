import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  P3_DECISIONS,
  P3_SIGNAL_TYPES,
  createMultiSignalRelevancePipeline,
} from '../lib/multi-signal-relevance-p3.js';

const ACCEPTED_DIGEST = `sha256:${'a'.repeat(64)}`;

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
    identityConfidence: 0.99,
    sensitive: false,
    text: `RAW_PRIVATE_TEXT_${logicalId}_${'x'.repeat(80)}`,
    label: `RAW_PRIVATE_LABEL_${logicalId}`,
    href: `https://example.test/private?item=${logicalId}&secret=RAW_PRIVATE_HREF_${logicalId}`,
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
    actionableCount: 4,
    repeatedEntityCount: 4,
    loadedEntityCount: 4,
    visibleEntityCount: 4,
    uniqueCanonicalLinkCount: 0,
    duplicateKeyCount: 0,
    ambiguityCount: 0,
    dependencies: {
      entitySet: { fingerprint: `entities-${revision}`, count: 4 },
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
  entities = [entity('a'), entity('b'), entity('c'), entity('d')],
  regions = [view(resultingRevision)],
  changedRegionIds = ['rg_feed'],
  removedRegionIds = [],
  documentGeneration = 1,
  completeSnapshotRequired = classification === 'RESET',
  resetReason = classification === 'RESET' ? 'INITIAL_OBSERVATION' : undefined,
  bodyText = `RAW_PAGE_BODY_${'z'.repeat(8_000)}`,
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
      ambiguityCount: 0,
      collisionCount: 0,
      excludedSensitiveCount: entities.filter((item) => item.sensitive).length,
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
        observedAt: 123456,
        sourceRevision: resultingRevision,
        sensor: 'DOM_ACCESSIBILITY',
        confidence: 0.97,
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

function updateObservation(previous, logicalId = 'b', overrides = {}) {
  const sourceRevision = previous.semanticDelta.resultingRevision;
  const resultingRevision = sourceRevision + 1;
  const entities = previous.elements.map((item) => item.logicalId === logicalId
    ? { ...item, semanticRevision: resultingRevision, inViewport: !item.inViewport, ...overrides }
    : structuredClone(item));
  return observation({
    sourceRevision,
    resultingRevision,
    classification: 'UPDATE',
    changes: [{ type: 'UPDATE', logicalId, revision: resultingRevision }],
    entities,
    regions: [view(resultingRevision)],
    changedRegionIds: ['rg_feed'],
    completeSnapshotRequired: false,
    resetReason: undefined,
  });
}

function noRelevantObservation(previous) {
  const sourceRevision = previous.semanticDelta.resultingRevision;
  const resultingRevision = sourceRevision + 1;
  return observation({
    sourceRevision,
    resultingRevision,
    classification: 'NO_RELEVANT_CHANGE',
    changes: [],
    entities: previous.elements.map((item) => structuredClone(item)),
    regions: previous.semanticViews.regions.map((item) => structuredClone(item)),
    changedRegionIds: [],
    completeSnapshotRequired: false,
    resetReason: undefined,
  });
}

function signal(type = 'DOM_MUTATION', overrides = {}) {
  return {
    type,
    source: 'BROWSER_RUNTIME',
    logicalIds: [],
    regionIds: [],
    waitConditionIds: [],
    dependencyKeys: [],
    observedAt: 1000,
    ...overrides,
  };
}

function taskContext({
  reasonEntityIds = ['a'],
  reasonViewIds = [],
  reasonWaitConditionIds = [],
  reasonSignalTypes = [],
  continueEntityIds = [],
  continueViewIds = [],
  continueWaitConditionIds = [],
  continueSignalTypes = [],
  ...overrides
} = {}) {
  return {
    source: 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES',
    goalId: 'goal-a',
    ledgerRevision: 7,
    ledgerDigest: ACCEPTED_DIGEST,
    reasonDependencies: {
      entityIds: reasonEntityIds,
      viewIds: reasonViewIds,
      waitConditionIds: reasonWaitConditionIds,
      signalTypes: reasonSignalTypes,
    },
    continueDependencies: {
      entityIds: continueEntityIds,
      viewIds: continueViewIds,
      waitConditionIds: continueWaitConditionIds,
      signalTypes: continueSignalTypes,
    },
    ...overrides,
  };
}

function bootstrap(pipeline, id = identity(), context = taskContext()) {
  const first = observation();
  const result = pipeline.reconcile(id, first, context);
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.reasoningWakeRequired, true);
  assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
  return { first, result };
}

function sha1Blob(bytes) {
  // Lock constants are git blob hashes of the committed LF bytes; strip
  // checkout-added CR so autocrlf checkouts hash identically to CI.
  const content = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
}

test('P3 exports the frozen three-outcome relevance vocabulary and bounded signal types', () => {
  assert.deepEqual([...P3_DECISIONS].sort(), ['APPLY_AND_CONTINUE', 'IGNORE_FOR_TASK', 'REASON_REQUIRED']);
  assert.deepEqual([...P3_SIGNAL_TYPES].sort(), [
    'ACTION_RESULT',
    'DOM_MUTATION',
    'GEOMETRY_RESIZE',
    'NAVIGATION_HISTORY',
    'RECONNECT_RESET',
    'SCROLL_VIEWPORT',
    'SEMANTIC_MUTATION',
    'WAIT_CONDITION',
  ]);
});

test('P3 initial trusted RESET always reaches reasoning as a full snapshot', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { result } = bootstrap(pipeline);
  assert.equal(result.canonicalState.semanticRevision, 1);
  assert.equal(result.epoch.signalCount, 0);
  assert.equal(result.relevance.contextStatus, 'ACCEPTED');
});

test('P3 coalesces a large irrelevant mutation storm into one epoch with zero reasoning wakeup', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000, maxSignalsPerEpoch: 256 });
  const { first } = bootstrap(pipeline);
  for (let index = 0; index < 200; index += 1) {
    pipeline.recordSignal(identity(), signal('DOM_MUTATION', {
      logicalIds: ['noise'],
      regionIds: ['rg_noise'],
      observedAt: 1000 + index,
    }));
  }
  const second = updateObservation(first, 'b');
  const result = pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: ['a'] }));
  assert.equal(result.decision, 'IGNORE_FOR_TASK');
  assert.equal(result.reasoningWakeRequired, false);
  assert.equal(result.reasoningObservation, null);
  assert.equal(result.canonicalState.semanticRevision, 2);
  assert.equal(result.epoch.signalCount, 200);
  assert.equal(result.epoch.signalTypes.length, 1);
  assert.deepEqual(result.epoch.signalTypes, ['DOM_MUTATION']);
  assert.equal(result.epoch.overflowed, false);
});

test('P3 detects a later relevant entity change exactly after an irrelevant storm', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000, maxSignalsPerEpoch: 256 });
  let { first: current } = bootstrap(pipeline);
  for (let index = 0; index < 150; index += 1) {
    pipeline.recordSignal(identity(), signal('DOM_MUTATION', { logicalIds: ['noise'] }));
  }
  pipeline.recordSignal(identity(), signal('SEMANTIC_MUTATION', { logicalIds: ['a'] }));
  current = updateObservation(current, 'a');
  const result = pipeline.reconcile(identity(), current, taskContext({ reasonEntityIds: ['a'] }));
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.reasoningWakeRequired, true);
  assert.equal(result.reasoningObservation.kind, 'COMPACT_PATCH');
  assert.deepEqual(result.reasoningObservation.patch.updatedEntities.map((item) => item.logicalId), ['a']);
  assert.ok(result.relevance.matchedReasonDependencyKeys.includes('entity:a'));
  assert.equal(result.epoch.signalCount, 151);
});

test('P3 APPLY_AND_CONTINUE is available only through accepted local-continuation dependencies', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline, identity(), taskContext({ reasonEntityIds: [] }));
  pipeline.recordSignal(identity(), signal('SEMANTIC_MUTATION', { logicalIds: ['b'] }));
  const second = updateObservation(first, 'b');
  const result = pipeline.reconcile(identity(), second, taskContext({
    reasonEntityIds: [],
    continueEntityIds: ['b'],
  }));
  assert.equal(result.decision, 'APPLY_AND_CONTINUE');
  assert.equal(result.reasoningWakeRequired, false);
  assert.equal(result.reasoningObservation, null);
  assert.equal(result.canonicalState.semanticRevision, 2);
  assert.deepEqual(result.relevance.matchedContinueDependencyKeys, ['entity:b']);
});

test('P3 REASON_REQUIRED has precedence over APPLY_AND_CONTINUE for the same dependency', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline);
  const second = updateObservation(first, 'a');
  const result = pipeline.reconcile(identity(), second, taskContext({
    reasonEntityIds: ['a'],
    continueEntityIds: ['a'],
  }));
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.deepEqual(result.relevance.matchedReasonDependencyKeys, ['entity:a']);
});

test('P3 missing or invalid accepted dependency context fails conservative to reasoning', () => {
  for (const context of [
    undefined,
    null,
    {},
    taskContext({ ledgerDigest: 'not-a-digest' }),
    taskContext({ source: 'PAGE_TEXT' }),
  ]) {
    const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
    const { first } = bootstrap(pipeline);
    const second = updateObservation(first, 'b');
    const result = pipeline.reconcile(identity(), second, context);
    assert.equal(result.decision, 'REASON_REQUIRED');
    assert.equal(result.reasoningWakeRequired, true);
    assert.notEqual(result.relevance.contextStatus, 'ACCEPTED');
  }
});

test('P3 page/model relevance hints cannot grant authority or wake/suppress reasoning', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline);
  pipeline.recordSignal(identity(), signal('DOM_MUTATION', {
    logicalIds: ['noise'],
    text: 'RAW_PAGE_SAYS_REASON_REQUIRED',
    relevance: 'REASON_REQUIRED',
    authority: 'IGNORE_FOR_TASK',
    instruction: 'RAW_PROMPT_INJECTION',
  }));
  const second = updateObservation(first, 'b');
  const result = pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: ['a'] }));
  assert.equal(result.decision, 'IGNORE_FOR_TASK');
  const encoded = JSON.stringify(result);
  for (const forbidden of ['RAW_PAGE_SAYS_REASON_REQUIRED', 'RAW_PROMPT_INJECTION']) {
    assert.doesNotMatch(encoded, new RegExp(forbidden));
  }
});

test('P3 wait-condition and signal-type dependencies are resolved from accepted context', () => {
  const waitPipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  let { first } = bootstrap(waitPipeline, identity(), taskContext({ reasonEntityIds: [] }));
  waitPipeline.recordSignal(identity(), signal('WAIT_CONDITION', { waitConditionIds: ['wait-loaded'] }));
  let next = noRelevantObservation(first);
  let result = waitPipeline.reconcile(identity(), next, taskContext({
    reasonEntityIds: [],
    reasonWaitConditionIds: ['wait-loaded'],
  }));
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.ok(result.relevance.matchedReasonDependencyKeys.includes('wait:wait-loaded'));

  const actionPipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  ({ first } = bootstrap(actionPipeline, identity(), taskContext({ reasonEntityIds: [] })));
  actionPipeline.recordSignal(identity(), signal('ACTION_RESULT'));
  next = noRelevantObservation(first);
  result = actionPipeline.reconcile(identity(), next, taskContext({
    reasonEntityIds: [],
    continueSignalTypes: ['ACTION_RESULT'],
  }));
  assert.equal(result.decision, 'APPLY_AND_CONTINUE');
  assert.ok(result.relevance.matchedContinueDependencyKeys.includes('signal:ACTION_RESULT'));
});

test('P3 navigation/history and reconnect/reset signals are never silently ignored', () => {
  for (const type of ['NAVIGATION_HISTORY', 'RECONNECT_RESET']) {
    const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
    const { first } = bootstrap(pipeline, identity(), taskContext({ reasonEntityIds: [] }));
    pipeline.recordSignal(identity(), signal(type));
    const second = noRelevantObservation(first);
    const result = pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: [] }));
    assert.equal(result.decision, 'REASON_REQUIRED');
    assert.equal(result.reasoningWakeRequired, true);
    assert.ok(result.relevance.safetyReasons.includes(type));
  }
});

test('P3 propagates P2 continuity failure as REASON_REQUIRED full snapshot and never suppresses reset-required state', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline);
  const second = updateObservation(first, 'b');
  pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: [] }));
  const gap = observation({
    sourceRevision: 9,
    resultingRevision: 10,
    classification: 'NO_RELEVANT_CHANGE',
    changes: [],
    entities: second.elements,
    regions: second.semanticViews.regions,
    changedRegionIds: [],
    completeSnapshotRequired: false,
    resetReason: undefined,
  });
  const result = pipeline.reconcile(identity(), gap, taskContext({ reasonEntityIds: [] }));
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.reasoningWakeRequired, true);
  assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(result.reasoningObservation.resetRequired, true);
  assert.equal(result.canonicalState, null);
});

test('P3 exact replay with no new relevant signal does not wake reasoning again', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline, identity(), taskContext({ reasonEntityIds: [] }));
  const second = updateObservation(first, 'b');
  pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: [] }));
  const replay = pipeline.reconcile(identity(), structuredClone(second), taskContext({ reasonEntityIds: [] }));
  assert.equal(replay.decision, 'IGNORE_FOR_TASK');
  assert.equal(replay.reasoningWakeRequired, false);
  assert.equal(replay.reasoningObservation, null);
  assert.equal(replay.canonicalState.replayed, true);
});

test('P3 signal-count overflow fails conservative to reasoning and is visible in bounded epoch accounting', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000, maxSignalsPerEpoch: 4 });
  const { first } = bootstrap(pipeline, identity(), taskContext({ reasonEntityIds: [] }));
  for (let index = 0; index < 5; index += 1) {
    pipeline.recordSignal(identity(), signal('DOM_MUTATION', { logicalIds: [`noise-${index}`] }));
  }
  const second = noRelevantObservation(first);
  const result = pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: [] }));
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.epoch.overflowed, true);
  assert.ok(result.relevance.safetyReasons.includes('SIGNAL_OVERFLOW'));
});

test('P3 affected-key overflow cannot become an IGNORE_FOR_TASK decision', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000, maxAffectedKeysPerEpoch: 4 });
  const { first } = bootstrap(pipeline, identity(), taskContext({ reasonEntityIds: [] }));
  pipeline.recordSignal(identity(), signal('SEMANTIC_MUTATION', {
    logicalIds: ['a', 'b', 'c', 'd', 'e', 'f'],
  }));
  const second = noRelevantObservation(first);
  const result = pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: [] }));
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.epoch.overflowed, true);
  assert.ok(result.relevance.safetyReasons.includes('AFFECTED_KEY_OVERFLOW'));
});

test('P3 expired open epoch fails conservative rather than silently dropping possible relevance', () => {
  let now = 1000;
  const pipeline = createMultiSignalRelevancePipeline({ now: () => now, maxEpochAgeMs: 10 });
  const { first } = bootstrap(pipeline, identity(), taskContext({ reasonEntityIds: [] }));
  pipeline.recordSignal(identity(), signal('DOM_MUTATION', { logicalIds: ['noise'] }));
  now = 1100;
  const second = noRelevantObservation(first);
  const result = pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: [] }));
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.epoch.expired, true);
  assert.ok(result.relevance.safetyReasons.includes('EPOCH_EXPIRED'));
});

test('P3 keeps coalescing state isolated across tab/document/runtime identity', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const idA = identity({ tabId: 'tab-a' });
  const idB = identity({ tabId: 'tab-b' });
  const firstA = observation();
  const firstB = observation();
  pipeline.reconcile(idA, firstA, taskContext({ reasonEntityIds: [] }));
  pipeline.reconcile(idB, firstB, taskContext({ reasonEntityIds: [] }));
  pipeline.recordSignal(idB, signal('SEMANTIC_MUTATION', { logicalIds: ['a'] }));
  const resultA = pipeline.reconcile(idA, noRelevantObservation(firstA), taskContext({ reasonEntityIds: [] }));
  assert.equal(resultA.epoch.signalCount, 0);
  assert.equal(resultA.decision, 'IGNORE_FOR_TASK');
  assert.equal(pipeline.inspectEpoch(idB).signalCount, 1);
});

test('P3 invalid or oversized dependency context cannot suppress reasoning', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000, maxDependencyKeys: 8 });
  const { first } = bootstrap(pipeline);
  const second = updateObservation(first, 'b');
  const oversized = taskContext({
    reasonEntityIds: Array.from({ length: 20 }, (_, index) => `entity-${index}`),
  });
  const result = pipeline.reconcile(identity(), second, oversized);
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.relevance.contextStatus, 'INVALID');
});

test('P3 outputs are bounded metadata only and do not retain raw signal/page secrets when reasoning is suppressed', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline);
  pipeline.recordSignal(identity(), signal('DOM_MUTATION', {
    logicalIds: ['noise'],
    text: 'TOP_SECRET_SIGNAL_TEXT',
    href: 'https://example.test/?token=TOP_SECRET_SIGNAL_HREF',
    value: 'TOP_SECRET_SIGNAL_VALUE',
    rawPayload: { secret: 'TOP_SECRET_NESTED' },
  }));
  const second = updateObservation(first, 'b');
  const result = pipeline.reconcile(identity(), second, taskContext({ reasonEntityIds: ['a'] }));
  assert.equal(result.decision, 'IGNORE_FOR_TASK');
  const encoded = JSON.stringify(result);
  for (const forbidden of [
    'TOP_SECRET', 'RAW_PAGE_BODY_', 'RAW_PRIVATE_TEXT_', 'RAW_PRIVATE_LABEL_',
    'RAW_PRIVATE_HREF_', 'RAW_PRIVATE_VALUE_', 'RAW_PROVENANCE_PRIVATE_NOTE',
  ]) {
    assert.doesNotMatch(encoded, new RegExp(forbidden));
  }
});

test('P3 does not synthesize completion, action authority, foreground control, or VM execution', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline);
  const result = pipeline.reconcile(identity(), updateObservation(first, 'a'), taskContext({ reasonEntityIds: ['a'] }));
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /\bPROVED\b/);
  assert.doesNotMatch(encoded, /activate_tab|foreground|executionMode|page\.click|page\.fill|pointer/i);
  assert.doesNotMatch(encoded, /vm\.run|reactive-vm|executeVm|resumeVm/i);
});

test('P3 frozen boundary remains locked except the P6-authorized Reactive VM cutover', async () => {
  // R8 authorizes only generic omitted-limit find dominance in content.js.
  const files = new Map([
    ['../lib/delta-first-observation-p2.js', '5335e1d09a8b8357a2fb20ecb30f1908c3c7d7e3'],
    ['../extension/content.js', 'ec28d73498717f252cc1bb8bb94747e99eb27bf2'],
    ['../extension/background.js', '383d08964d50546388080ed1820fb61eb311e6e3'],
    ['../extension/manifest.json', '93efe53987750491fd86976a9b6224bcf05879db'],
    ['../supabase/functions/opera-agent-mcp/index.ts', '014a2361d7479f4b1c80d82cec58599eedf129e2'],
    ['../lib/reactive-vm.js', 'e035d282b642c7fb0dfe687e034ec200072da991'],
    ['../lib/reactive-vm-7c.js', '2e5f63f2c5d7c0ee2341c5a88a407783ae4523f4'],
    ['../lib/reactive-vm-7d.js', 'f08445f142d001aeb45b40a4d1a77fd6d2c7b6c8'],
  ]);
  for (const [relativePath, expected] of files) {
    const bytes = await readFile(new URL(relativePath, import.meta.url));
    assert.equal(sha1Blob(bytes), expected, `${relativePath} must match the current authorized boundary lock after P6 supersession`);
  }
  const mcp = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(mcp, /server\.registerTool\("read_page"/);
  assert.match(mcp, /execute\("page\.read", \{ \.\.\.args, view: "compact" \}\)\);/);
  assert.doesNotMatch(mcp, /view:\s*z\./);
  assert.doesNotMatch(mcp, /multi-signal-relevance-p3/);
  const p3Source = await readFile(new URL('../lib/multi-signal-relevance-p3.js', import.meta.url), 'utf8');
  assert.doesNotMatch(p3Source, /reactive-vm|vm\.run|executeVm|resumeVm/);
  assert.doesNotMatch(p3Source, /extension\/|opera-agent-mcp/);
});

test('P3 irrelevant-mutation-storm acceptance: zero unnecessary wakes, later relevant update detected exactly', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000, maxSignalsPerEpoch: 256 });
  const context = taskContext({ reasonEntityIds: ['a'] });
  let { first: current } = bootstrap(pipeline, identity(), context);
  let rawSignals = 0;
  let irrelevantReasoningWakeups = 0;
  let totalReasoningWakeups = 0;
  let relevantDetected = 0;
  let relevantSignalLoss = 0;
  let falseCompletion = 0;
  let foregroundTakeover = 0;

  for (let epoch = 0; epoch < 10; epoch += 1) {
    for (let index = 0; index < 128; index += 1) {
      rawSignals += 1;
      pipeline.recordSignal(identity(), signal(index % 2 === 0 ? 'DOM_MUTATION' : 'GEOMETRY_RESIZE', {
        logicalIds: ['noise'],
        regionIds: ['rg_noise'],
      }));
    }
    current = updateObservation(current, 'b');
    const result = pipeline.reconcile(identity(), current, context);
    if (result.reasoningWakeRequired) {
      irrelevantReasoningWakeups += 1;
      totalReasoningWakeups += 1;
    }
    if (!result.canonicalState || result.canonicalState.semanticRevision !== current.semanticDelta.resultingRevision) {
      relevantSignalLoss += 1;
    }
    if (/\bPROVED\b/.test(JSON.stringify(result))) falseCompletion += 1;
    if (/activate_tab|foreground|executionMode/i.test(JSON.stringify(result))) foregroundTakeover += 1;
    assert.equal(result.epoch.signalCount, 128);
  }

  rawSignals += 1;
  pipeline.recordSignal(identity(), signal('SEMANTIC_MUTATION', { logicalIds: ['a'] }));
  current = updateObservation(current, 'a');
  const relevant = pipeline.reconcile(identity(), current, context);
  if (relevant.reasoningWakeRequired) totalReasoningWakeups += 1;
  if (relevant.decision === 'REASON_REQUIRED'
      && relevant.reasoningObservation?.patch?.updatedEntities?.some((item) => item.logicalId === 'a')) {
    relevantDetected += 1;
  } else {
    relevantSignalLoss += 1;
  }

  assert.equal(rawSignals, 1281);
  assert.equal(irrelevantReasoningWakeups, 0);
  assert.equal(totalReasoningWakeups, 1);
  assert.equal(relevantDetected, 1);
  assert.equal(relevantSignalLoss, 0);
  assert.equal(falseCompletion, 0);
  assert.equal(foregroundTakeover, 0);
});

test('P3 clear removes buffered epochs and P2 continuity so recovery must be explicit', () => {
  const pipeline = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const { first } = bootstrap(pipeline);
  pipeline.recordSignal(identity(), signal('DOM_MUTATION', { logicalIds: ['noise'] }));
  assert.equal(pipeline.inspectEpoch(identity()).signalCount, 1);
  pipeline.clear();
  assert.equal(pipeline.inspectEpoch(identity()), null);
  const second = updateObservation(first, 'b');
  const result = pipeline.reconcile(identity(), second, taskContext());
  assert.equal(result.decision, 'REASON_REQUIRED');
  assert.equal(result.reasoningObservation.kind, 'FULL_SNAPSHOT');
  assert.equal(result.reasoningObservation.resetRequired, true);
});
