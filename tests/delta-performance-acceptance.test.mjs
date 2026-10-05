// @last-edited: 2026-10-04 18:58 UTC+7.
// @title: delta-performance-acceptance - acceptance evidence against frozen gates.
// @state: Real-site evidence meets every frozen threshold.
// @dependencies: node:test, strict, node:crypto, promises, boundary-locks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PUBLIC_SURFACE_LOCKS, OBSERVATION_STACK_LOCKS, RELEVANCE_STACK_LOCKS } from './helpers/boundary-locks.mjs';

function sha1Blob(bytes) {
  // Lock constants are git blob hashes of the committed LF bytes; strip
  // checkout-added CR so autocrlf checkouts hash identically to CI.
  const content = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

test('P5 evidence retains the frozen P0 gates and meets every acceptance threshold', async () => {
  const baseline = await readJson('./fixtures/delta-performance-baseline-v1.json');
  const evidence = await readJson('./fixtures/delta-performance-acceptance-v1.json');
  const targets = baseline.targetGates;
  const observed = evidence.observedGates;
  assert.equal(evidence.acceptedP4Head, 'e550bc90f49df2541dfd91789d99b2b33e4bf2aa');
  assert.deepEqual(evidence.frozenTargets, {
    maximumFalseCompletionCount: targets.maximumFalseCompletionCount,
    maximumForegroundTakeoverCount: targets.maximumForegroundTakeoverCount,
    maximumStaleStateActionCount: targets.maximumStaleStateActionCount,
    maximumRelevantSignalLossCount: targets.maximumRelevantSignalLossCount,
    minimumSmallChangeReasoningPayloadReduction: targets.minimumSmallChangeReasoningPayloadReduction,
    minimumRepetitiveReasoningRoundTripReduction: targets.minimumRepetitiveReasoningRoundTripReduction,
    minimumSteadyStateFullSnapshotReduction: targets.minimumSteadyStateFullSnapshotReduction,
    minimumLongTaskMedianSpeedup: targets.minimumLongTaskMedianSpeedup,
    maximumSimpleOperationMedianRegression: targets.maximumSimpleOperationMedianRegression,
  });
  assert.equal(observed.falseCompletionCount, 0);
  assert.equal(observed.foregroundTakeoverCount, 0);
  assert.equal(observed.staleStateActionCount, 0);
  assert.equal(observed.relevantSignalLossCount, 0);
  assert.ok(observed.smallChangeReasoningPayloadReductionMedian >= targets.minimumSmallChangeReasoningPayloadReduction);
  assert.ok(observed.repetitiveReasoningRoundTripReductionMedian >= targets.minimumRepetitiveReasoningRoundTripReduction);
  assert.ok(observed.steadyStateFullSnapshotReduction >= targets.minimumSteadyStateFullSnapshotReduction);
  assert.ok(observed.longRepetitiveTaskMedianSpeedup >= targets.minimumLongTaskMedianSpeedup);
  assert.ok(observed.simpleOperationMedianRegression <= targets.maximumSimpleOperationMedianRegression);
});

test('P5 real Opera Maps evidence proves lazy growth, dedup, and stable-boundary completion', async () => {
  const maps = (await readJson('./fixtures/delta-performance-acceptance-v1.json')).realOpera.googleMaps;
  assert.equal(maps.initialLoadedEntities, 16);
  assert.equal(maps.finalLoadedEntities, 25);
  assert.equal(maps.duplicateKeyCount, 0);
  assert.equal(maps.firstBottomCompletion, 'PARTIAL');
  assert.equal(maps.stableBoundaryObservations, 2);
  assert.equal(maps.finalClassification, 'NO_RELEVANT_CHANGE');
  assert.equal(maps.finalCompletion, 'BOUNDED_COMPLETE');
  assert.deepEqual(maps.readClassifications, ['RESET', 'MOVE', 'MIXED', 'MOVE', 'NO_RELEVANT_CHANGE']);
  assert.equal(maps.reads, 5);
  assert.equal(maps.fullSnapshotBootstraps, 1);
  assert.equal(maps.steadyStateDeltaReads, 4);
  assert.equal(maps.fullSnapshotReduction, 0.8);
});

test('P5 real Opera GitHub evidence fails closed across SPA route generation changes', async () => {
  const github = (await readJson('./fixtures/delta-performance-acceptance-v1.json')).realOpera.github;
  assert.ok(github.structuredRegionCount >= 1);
  assert.ok(github.repeatedListLoadedEntities >= 1);
  assert.equal(github.repeatedListDuplicateKeyCount, 0);
  assert.equal(github.documentGenerationBeforeNavigation, 1);
  assert.equal(github.documentGenerationAfterNavigation, 2);
  assert.equal(github.navigationResetReason, 'SPA_ROUTE');
  assert.equal(github.navigationClassification, 'RESET');
  assert.equal(github.targetTabActiveAfterNavigation, false);
});

test('P5 real Opera YouTube evidence distinguishes DOM churn from semantic task changes', async () => {
  const youtube = (await readJson('./fixtures/delta-performance-acceptance-v1.json')).realOpera.youtube;
  assert.ok(youtube.liveMutationVersionAfter > youtube.liveMutationVersionBefore);
  assert.equal(youtube.classificationAfterChurn, 'NO_RELEVANT_CHANGE');
  assert.equal(youtube.semanticChangeCountAfterChurn, 0);
  assert.equal(youtube.changedRegionCountAfterChurn, 0);
});

test('P5 paired live mediation-elision workload exceeds 2x median without hiding effects', async () => {
  const evidence = await readJson('./fixtures/delta-performance-acceptance-v1.json');
  const runs = evidence.longTaskRuns;
  assert.equal(runs.length, 3);
  for (const run of runs) {
    assert.equal(run.browserEffectsPerArm, 8);
    assert.ok(run.baselineMs > run.mediationElidedMs);
    assert.ok(run.speedup > 1);
  }
  const measuredMedian = median(runs.map((run) => run.speedup));
  assert.equal(measuredMedian, evidence.observedGates.longRepetitiveTaskMedianSpeedup);
  assert.ok(measuredMedian >= evidence.frozenTargets.minimumLongTaskMedianSpeedup);
  assert.equal(evidence.methodology.liveSpeedPath, 'MEDIATION_ELISION_TRANSPORT_PROXY');
  assert.match(evidence.methodology.liveSpeedNotes, /not a claim/i);
});

test('P5 paired live simple-operation sample stays within 15% regression ceiling', async () => {
  const evidence = await readJson('./fixtures/delta-performance-acceptance-v1.json');
  const sample = evidence.simpleOperation;
  assert.equal(sample.baselineSamples, 24);
  assert.equal(sample.mediationElidedSamples, 24);
  assert.ok(sample.medianRegression <= evidence.frozenTargets.maximumSimpleOperationMedianRegression);
  assert.equal(sample.medianRegression, evidence.observedGates.simpleOperationMedianRegression);
});

test('P5 safety and cleanup records zero foreground authority and no leftover test tabs', async () => {
  const evidence = await readJson('./fixtures/delta-performance-acceptance-v1.json');
  const safety = evidence.safetyAndCleanup;
  assert.equal(safety.tabsActivateCommands, 0);
  assert.equal(safety.pointerCommands, 0);
  assert.equal(safety.fillOrKeyCommands, 0);
  assert.equal(safety.remainingTestTabs, 0);
  assert.equal(safety.excludedStaleTabPreflightFailures, 1);
  assert.equal(evidence.observedGates.foregroundTakeoverCount, 0);
});

test('P5 frozen boundary remains locked except the P6-authorized Reactive VM cutover', async () => {
  // Lock set: same frozen stack re-checked through the performance lens (see helper for the authorization history).
  const files = new Map([...RELEVANCE_STACK_LOCKS, ...PUBLIC_SURFACE_LOCKS, ...OBSERVATION_STACK_LOCKS]);
  for (const [relativePath, expected] of files) {
    const bytes = await readFile(new URL(relativePath, import.meta.url));
    assert.equal(sha1Blob(bytes), expected, `${relativePath} must match the P5 performance boundary lock`);
  }
});
