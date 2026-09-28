import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { digestCanonical } from '../lib/goal-ledger.js';
import { createMultiSignalRelevancePipeline } from '../lib/multi-signal-relevance-p3.js';
import {
  P4_OUTCOMES,
  P4_YIELD_REASONS,
  createEventDrivenLocalExecutionP4,
} from '../lib/event-driven-local-execution-p4.js';

const ACCEPTED_DIGEST = `sha256:${'a'.repeat(64)}`;
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

const identity = (overrides = {}) => ({
  tenantId: 'tenant-a',
  deviceId: 'device-a',
  tabId: 7,
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
    ...overrides,
  };
}

function view(revision = 1) {
  return {
    regionId: 'rg_feed',
    kind: 'repeated',
    role: 'feed',
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
    completion: { status: 'PARTIAL', scope: 'feed', evidence: [], limits: [], unresolved: [] },
  };
}

function observation({ sourceRevision = 0, resultingRevision = 1, classification = 'RESET', changes = [], entities, changedRegionIds } = {}) {
  const list = entities ?? [entity('a'), entity('b')];
  return {
    text: `RAW_PAGE_${'x'.repeat(2000)}`,
    semanticState: {
      schemaVersion: 1,
      documentGeneration: 1,
      observationRevision: resultingRevision,
      entityCount: list.length,
      observedEntityCount: list.length,
      ambiguityCount: 0,
      collisionCount: 0,
      excludedSensitiveCount: 0,
      cacheBytes: 512,
      resetReason: classification === 'RESET' ? 'INITIAL_OBSERVATION' : null,
    },
    semanticDelta: {
      schemaVersion: 1,
      sourceRevision,
      resultingRevision,
      classification,
      changes,
      completeSnapshotRequired: classification === 'RESET',
      ...(classification === 'RESET' ? { resetReason: 'INITIAL_OBSERVATION' } : {}),
    },
    elements: list,
    semanticViews: {
      schemaVersion: 1,
      revision: resultingRevision,
      provenance: {
        category: 'DIRECT_OBSERVATION', sensor: 'DOM_ACCESSIBILITY', confidence: 0.99,
        sourceRevision: resultingRevision, observedAt: 1000,
      },
      regions: [view(resultingRevision)],
      changedRegionIds: changedRegionIds ?? (classification === 'RESET' ? ['rg_feed'] : []),
      removedRegionIds: [],
      viewDelta: { sourceClassification: classification, invalidatedViews: [], removedRegionIds: [] },
    },
  };
}

function updateObservation(previous, logicalId = 'b') {
  const sourceRevision = previous.semanticDelta.resultingRevision;
  const resultingRevision = sourceRevision + 1;
  const entities = previous.elements.map((item) => item.logicalId === logicalId
    ? { ...item, semanticRevision: resultingRevision, inViewport: !item.inViewport }
    : structuredClone(item));
  return observation({
    sourceRevision,
    resultingRevision,
    classification: 'UPDATE',
    changes: [{ type: 'UPDATE', logicalId, revision: resultingRevision }],
    entities,
    changedRegionIds: ['rg_feed'],
  });
}

function taskContext({ reasonEntityIds = [], continueEntityIds = ['b'] } = {}) {
  return {
    source: 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES',
    goalId: 'goal-a',
    ledgerRevision: 7,
    ledgerDigest: ACCEPTED_DIGEST,
    reasonDependencies: { entityIds: reasonEntityIds, viewIds: [], waitConditionIds: [], signalTypes: [] },
    continueDependencies: { entityIds: continueEntityIds, viewIds: [], waitConditionIds: [], signalTypes: [] },
  };
}

async function program(root, id = 'p4-program', budgetOverrides = {}) {
  const value = {
    schemaVersion: 'OA_REACTIVE_VM_V1',
    programId: id,
    tenantId: 'tenant-a',
    goalId: 'goal-a',
    goalRevision: 7,
    target: { deviceId: 'device-a', tabId: 7 },
    budgets: { ...budgets, ...budgetOverrides },
    root,
    programDigest: '',
  };
  const { programDigest: _ignored, ...body } = value;
  value.programDigest = await digestCanonical(body);
  return value;
}

function vmOptions(runId = 'run-p4', overrides = {}) {
  return {
    runId,
    tenantId: 'tenant-a',
    goalRevision: 7,
    logicalNowMs: 1000,
    deadlineAtMs: 301000,
    initialBindings: {},
    initialObservationMeta: {},
    ...overrides,
  };
}

function effect(request, value, overrides = {}) {
  return {
    requestDigest: request.requestDigest,
    method: request.method,
    ok: true,
    provenance: {
      tenantId: 'tenant-a',
      deviceId: 'device-a',
      tabId: 7,
      documentGeneration: 1,
    },
    value,
    ...overrides,
  };
}

function applyDecision(overrides = {}) {
  return Object.freeze({
    decision: 'APPLY_AND_CONTINUE',
    reasoningWakeRequired: false,
    reasoningObservation: null,
    canonicalState: { semanticRevision: 2 },
    epoch: { signalCount: 1, signalTypes: ['SEMANTIC_MUTATION'], overflowed: false, expired: false },
    relevance: {
      contextStatus: 'ACCEPTED',
      matchedReasonDependencyKeys: [],
      matchedContinueDependencyKeys: ['entity:b'],
      safetyReasons: [],
    },
    ...overrides,
  });
}

function reasonDecision(overrides = {}) {
  return Object.freeze({
    decision: 'REASON_REQUIRED',
    reasoningWakeRequired: true,
    reasoningObservation: { kind: 'COMPACT_PATCH', resetRequired: false },
    canonicalState: { semanticRevision: 2 },
    epoch: { signalCount: 1, signalTypes: ['SEMANTIC_MUTATION'], overflowed: false, expired: false },
    relevance: {
      contextStatus: 'ACCEPTED',
      matchedReasonDependencyKeys: ['entity:a'],
      matchedContinueDependencyKeys: [],
      safetyReasons: [],
    },
    ...overrides,
  });
}

function ignoreDecision() {
  return Object.freeze({
    decision: 'IGNORE_FOR_TASK',
    reasoningWakeRequired: false,
    reasoningObservation: null,
    canonicalState: { semanticRevision: 2 },
    epoch: { signalCount: 1, signalTypes: ['DOM_MUTATION'], overflowed: false, expired: false },
    relevance: {
      contextStatus: 'ACCEPTED',
      matchedReasonDependencyKeys: [],
      matchedContinueDependencyKeys: [],
      safetyReasons: [],
    },
  });
}

function sha1Blob(bytes) {
  // Lock constants are git blob hashes of the committed LF bytes; strip
  // checkout-added CR so autocrlf checkouts hash identically to CI.
  const content = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
}

test('P4 exports a closed local-execution outcome and yield vocabulary', () => {
  assert.deepEqual([...P4_OUTCOMES].sort(), ['IDLE', 'LOCAL_EFFECT_REQUIRED', 'LOCAL_TERMINAL', 'REASON_REQUIRED']);
  assert.deepEqual([...P4_YIELD_REASONS].sort(), [
    'AMBIGUITY', 'BUDGET_EXHAUSTED', 'CANCELLED', 'DECISION_REQUIRED', 'EXPIRED',
    'FAILURE', 'RESET_REQUIRED', 'STABLE_BOUNDARY', 'SUCCESS',
  ]);
});

test('P4 registers only an accepted Reactive VM program and remains idle until P3 permits continuation', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } });
  const registered = await local.register(identity(), value, vmOptions());
  assert.equal(registered.status, 'READY');
  const idle = await local.applyRelevance(identity(), ignoreDecision());
  assert.equal(idle.outcome, 'IDLE');
  assert.equal(idle.reasoningWakeRequired, false);
  assert.equal(local.inspect(identity()).status, 'READY');
});

test('P4 never executes locally when P3 requires reasoning', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } });
  await local.register(identity(), value, vmOptions());
  const before = local.inspect(identity());
  const result = await local.applyRelevance(identity(), reasonDecision());
  assert.equal(result.outcome, 'REASON_REQUIRED');
  assert.equal(result.reasoningWakeRequired, true);
  assert.equal(result.yieldReason, 'DECISION_REQUIRED');
  assert.deepEqual(local.inspect(identity()), before);
});

test('P4 rejects malformed or self-asserted APPLY_AND_CONTINUE authority conservatively', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } });
  await local.register(identity(), value, vmOptions());
  for (const bad of [
    { decision: 'APPLY_AND_CONTINUE' },
    applyDecision({ reasoningWakeRequired: true }),
    applyDecision({ canonicalState: null }),
    applyDecision({ relevance: { contextStatus: 'PAGE_TEXT', matchedReasonDependencyKeys: [], matchedContinueDependencyKeys: ['entity:b'], safetyReasons: [] } }),
    applyDecision({ relevance: { contextStatus: 'ACCEPTED', matchedReasonDependencyKeys: [], matchedContinueDependencyKeys: [], safetyReasons: [] } }),
    applyDecision({ relevance: { contextStatus: 'ACCEPTED', matchedReasonDependencyKeys: [], matchedContinueDependencyKeys: ['entity:b'], safetyReasons: ['SIGNAL_OVERFLOW'] } }),
  ]) {
    const result = await local.applyRelevance(identity(), bad);
    assert.equal(result.outcome, 'REASON_REQUIRED');
    assert.equal(result.reasoningWakeRequired, true);
  }
});

test('P4 surfaces accepted read-only VM effects locally without model/tool mediation', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000, maxLocalStepsPerSlice: 32 });
  const value = await program({ type: 'SEQUENCE', children: [
    { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' },
    { type: 'RETURN', valueSpec: { op: 'CONST', value: 'done' } },
  ] });
  await local.register(identity(), value, vmOptions());
  const request = await local.applyRelevance(identity(), applyDecision());
  assert.equal(request.outcome, 'LOCAL_EFFECT_REQUIRED');
  assert.equal(request.reasoningWakeRequired, false);
  assert.equal(request.effectRequest.method, 'page.read');
  assert.doesNotMatch(JSON.stringify(request), /foreground|activate_tab|page\.click|page\.fill|pointer/i);

  const completed = await local.resumeEffect(identity(), effect(request.effectRequest, { items: [] }));
  assert.equal(completed.outcome, 'LOCAL_TERMINAL');
  assert.equal(completed.yieldReason, 'SUCCESS');
  assert.equal(completed.reasoningWakeRequired, false);
  assert.equal(completed.terminalStatus, 'RETURNED');
  assert.equal(completed.result, 'done');
});

test('P4 uses the real accepted P3 APPLY_AND_CONTINUE decision to start local execution', async () => {
  const p3 = createMultiSignalRelevancePipeline({ now: () => 1000 });
  const first = observation();
  p3.reconcile(identity(), first, taskContext());
  p3.recordSignal(identity(), {
    type: 'SEMANTIC_MUTATION', source: 'BROWSER_RUNTIME', logicalIds: ['b'], regionIds: [], waitConditionIds: [], observedAt: 1000,
  });
  const gate = p3.reconcile(identity(), updateObservation(first, 'b'), taskContext());
  assert.equal(gate.decision, 'APPLY_AND_CONTINUE');

  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'RETURN', valueSpec: { op: 'CONST', value: 2 } }, 'p3-integration');
  await local.register(identity(), value, vmOptions('run-p3-integration'));
  const result = await local.applyRelevance(identity(), gate);
  assert.equal(result.outcome, 'LOCAL_TERMINAL');
  assert.equal(result.yieldReason, 'SUCCESS');
  assert.equal(result.result, 2);
  assert.equal(result.reasoningWakeRequired, false);
});

test('P4 maps reset-required P3 state to a reasoning yield and drops the stale local run', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } }, 'reset');
  await local.register(identity(), value, vmOptions('run-reset'));
  const resetGate = reasonDecision({
    reasoningObservation: { kind: 'FULL_SNAPSHOT', resetRequired: true, resetReason: 'REVISION_GAP' },
    canonicalState: null,
    relevance: { contextStatus: 'ACCEPTED', matchedReasonDependencyKeys: [], matchedContinueDependencyKeys: [], safetyReasons: ['P2_RESET_REQUIRED'] },
  });
  const result = await local.applyRelevance(identity(), resetGate);
  assert.equal(result.outcome, 'REASON_REQUIRED');
  assert.equal(result.yieldReason, 'RESET_REQUIRED');
  assert.equal(local.inspect(identity()), null);
});

test('P4 maps VM ambiguity suspension to reasoning without synthesizing completion', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'SUSPEND', reason: 'AMBIGUOUS_TARGET', contextSpec: { source: 'local-vm' } }, 'ambiguous');
  await local.register(identity(), value, vmOptions('run-ambiguous'));
  const result = await local.applyRelevance(identity(), applyDecision());
  assert.equal(result.outcome, 'REASON_REQUIRED');
  assert.equal(result.yieldReason, 'AMBIGUITY');
  assert.equal(result.terminalStatus, 'SUSPENDED');
  assert.equal(result.reasoningWakeRequired, true);
  assert.doesNotMatch(JSON.stringify(result), /\bPROVED\b/);
});

test('P4 maps VM failure and local step-budget exhaustion to conservative reasoning yields', async () => {
  const failedLocal = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const failedProgram = await program({
    type: 'ASSERT', predicate: { op: 'CONST', value: false }, onFailure: 'FAIL',
  }, 'failure');
  await failedLocal.register(identity(), failedProgram, vmOptions('run-failure'));
  const failed = await failedLocal.applyRelevance(identity(), applyDecision());
  assert.equal(failed.outcome, 'REASON_REQUIRED');
  assert.equal(failed.yieldReason, 'FAILURE');
  assert.equal(failed.terminalStatus, 'FAILED');

  const budgetLocal = createEventDrivenLocalExecutionP4({ now: () => 1000, maxLocalStepsPerSlice: 1 });
  const budgetProgram = await program({ type: 'SEQUENCE', children: [
    { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
    { type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } },
  ] }, 'slice-budget');
  await budgetLocal.register(identity(), budgetProgram, vmOptions('run-slice-budget'));
  const budgeted = await budgetLocal.applyRelevance(identity(), applyDecision());
  assert.equal(budgeted.outcome, 'REASON_REQUIRED');
  assert.equal(budgeted.yieldReason, 'BUDGET_EXHAUSTED');
  assert.equal(budgeted.reasoningWakeRequired, true);
});

test('P4 cancellation and expiry are bounded local terminal yields', async () => {
  let now = 1000;
  const cancelLocal = createEventDrivenLocalExecutionP4({ now: () => now });
  const value = await program({ type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' }, 'cancel');
  await cancelLocal.register(identity(), value, vmOptions('run-cancel'));
  const cancelled = await cancelLocal.cancel(identity());
  assert.equal(cancelled.outcome, 'LOCAL_TERMINAL');
  assert.equal(cancelled.yieldReason, 'CANCELLED');
  assert.equal(cancelled.terminalStatus, 'CANCELLED');
  assert.equal(cancelled.reasoningWakeRequired, false);

  now = 5000;
  const expiryLocal = createEventDrivenLocalExecutionP4({ now: () => now });
  await expiryLocal.register(identity(), value, vmOptions('run-expire', { logicalNowMs: 1000, deadlineAtMs: 4000 }));
  const expired = await expiryLocal.applyRelevance(identity(), applyDecision());
  assert.equal(expired.outcome, 'LOCAL_TERMINAL');
  assert.equal(expired.yieldReason, 'EXPIRED');
  assert.equal(expired.terminalStatus, 'EXPIRED');
  assert.equal(expired.reasoningWakeRequired, false);
});

test('P4 effect result verification failure yields to reasoning and cannot continue on untrusted data', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' }, 'bad-effect');
  await local.register(identity(), value, vmOptions('run-bad-effect'));
  const request = await local.applyRelevance(identity(), applyDecision());
  const bad = effect(request.effectRequest, { items: [] }, {
    provenance: { tenantId: 'tenant-b', deviceId: 'device-a', tabId: 7, documentGeneration: 1 },
  });
  const result = await local.resumeEffect(identity(), bad);
  assert.equal(result.outcome, 'REASON_REQUIRED');
  assert.equal(result.yieldReason, 'FAILURE');
  assert.equal(result.reasoningWakeRequired, true);
});

test('P4 local execution is isolated by trusted tenant/device/tab/document/runtime identity', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } }, 'isolation');
  await local.register(identity(), value, vmOptions('run-isolation'));
  for (const foreign of [
    identity({ tenantId: 'tenant-b' }),
    identity({ deviceId: 'device-b' }),
    identity({ tabId: 8 }),
    identity({ documentGeneration: 2 }),
    identity({ runtimeEpoch: 'epoch-b' }),
  ]) {
    const result = await local.applyRelevance(foreign, applyDecision());
    assert.equal(result.outcome, 'REASON_REQUIRED');
    assert.equal(result.reasoningWakeRequired, true);
  }
  assert.equal(local.inspect(identity()).status, 'READY');
});

test('P4 repetitive read workload cuts model-mediated reasoning/tool round trips >=60% without hiding browser effects', async () => {
  const commandCount = 8;
  const children = Array.from({ length: commandCount }, (_, index) => ({
    type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: `read${index}`,
  }));
  children.push({ type: 'RETURN', valueSpec: { op: 'CONST', value: commandCount } });
  const value = await program({ type: 'SEQUENCE', children }, 'roundtrip-benchmark');
  let logicalNowMs = 1000;
  const local = createEventDrivenLocalExecutionP4({ now: () => logicalNowMs, maxLocalStepsPerSlice: 64 });
  await local.register(identity(), value, vmOptions('run-roundtrip'));

  let result = await local.applyRelevance(identity(), applyDecision());
  let browserEffects = 0;
  let localReasoningWakeups = 0;
  while (result.outcome === 'LOCAL_EFFECT_REQUIRED') {
    browserEffects += 1;
    if (result.reasoningWakeRequired) localReasoningWakeups += 1;
    logicalNowMs += 1;
    result = await local.resumeEffect(identity(), effect(result.effectRequest, { items: [] }));
  }
  if (result.reasoningWakeRequired) localReasoningWakeups += 1;

  const baselineModelMediatedRoundTrips = commandCount + 1;
  const p4ModelMediatedRoundTrips = 1 + localReasoningWakeups;
  const reduction = 1 - (p4ModelMediatedRoundTrips / baselineModelMediatedRoundTrips);
  assert.equal(browserEffects, commandCount);
  assert.equal(result.outcome, 'LOCAL_TERMINAL');
  assert.equal(result.yieldReason, 'SUCCESS');
  assert.equal(result.result, commandCount);
  assert.equal(localReasoningWakeups, 0);
  assert.ok(reduction >= 0.60, `expected >=60% model-mediated round-trip reduction, got ${(reduction * 100).toFixed(2)}%`);
  assert.equal(/\bPROVED\b/.test(JSON.stringify(result)), false);
  assert.equal(/activate_tab|foreground|executionMode/i.test(JSON.stringify(result)), false);
});

test('P4 frozen boundary remains locked except the P6-authorized Reactive VM cutover', async () => {
  // U-P1 (2026-09-24) authorizes the accessibility observation layer: shadow-piercing collection + computed accessible names in content.js, the poverty-triggered CDP axSummary in background.js, MCP guidance text, and the 1.6.13 version sweep. Protocol 1, 26 primitives, 22 tools, and the read_page input schema remain frozen. U-R (2026-09-28) then authorizes timeout/retry/popup parity: an unknown-outcome command timeout in background.js, expect-polling and fill retry parity in content.js, the popup/openedTabs log, MCP OAuth/openedTabs guidance, and the 1.6.13 version sweep. Protocol 1, 26 primitives, 22 tools, and the read_page input schema remain frozen.
  const files = new Map([
    ['../lib/multi-signal-relevance-p3.js', '1c42d1d034767979ce87ff4ffb8eb85efcc3dc10'],
    ['../lib/delta-first-observation-p2.js', '5335e1d09a8b8357a2fb20ecb30f1908c3c7d7e3'],
    ['../lib/reactive-vm.js', 'e035d282b642c7fb0dfe687e034ec200072da991'],
    ['../lib/reactive-vm-7c.js', '2e5f63f2c5d7c0ee2341c5a88a407783ae4523f4'],
    ['../lib/reactive-vm-7d.js', 'f08445f142d001aeb45b40a4d1a77fd6d2c7b6c8'],
    ['../extension/content.js', '4398bce76ca6c848a57dde8fb8767041ff310adf'],
    ['../extension/background.js', '4eabbd940898538cd211885b8890e05c9ee4fc25'],
    ['../extension/manifest.json', 'e69324b7c2abb194d15459d55eddd3a838c04e53'],
    ['../supabase/functions/opera-agent-mcp/index.ts', '825651427a13ab3d6d2c404b07f62001fa672c71'],
  ]);
  for (const [relativePath, expected] of files) {
    const bytes = await readFile(new URL(relativePath, import.meta.url));
    assert.equal(sha1Blob(bytes), expected, `${relativePath} must match the current authorized boundary lock after P6 supersession`);
  }
  const source = await readFile(new URL('../lib/event-driven-local-execution-p4.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /extension\/|opera-agent-mcp|supabase\/functions/);
  assert.doesNotMatch(source, /page\.click|page\.fill|pointer|activate_tab|executionMode\s*:\s*['\"]foreground/i);
  assert.doesNotMatch(source, /OA_TRANSACTION|approval|transaction|8E/i);
});

test('P4 clear removes all local runs; continuation after clear must return to reasoning', async () => {
  const local = createEventDrivenLocalExecutionP4({ now: () => 1000 });
  const value = await program({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } }, 'clear');
  await local.register(identity(), value, vmOptions('run-clear'));
  assert.equal(local.inspect(identity()).status, 'READY');
  local.clear();
  assert.equal(local.inspect(identity()), null);
  const result = await local.applyRelevance(identity(), applyDecision());
  assert.equal(result.outcome, 'REASON_REQUIRED');
  assert.equal(result.reasoningWakeRequired, true);
});
