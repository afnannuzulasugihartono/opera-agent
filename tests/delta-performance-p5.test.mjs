import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
  const baseline = await readJson('./fixtures/delta-performance-baseline-p0-v1.json');
  const evidence = await readJson('./fixtures/delta-performance-p5-v1.json');
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
  const maps = (await readJson('./fixtures/delta-performance-p5-v1.json')).realOpera.googleMaps;
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
  const github = (await readJson('./fixtures/delta-performance-p5-v1.json')).realOpera.github;
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
  const youtube = (await readJson('./fixtures/delta-performance-p5-v1.json')).realOpera.youtube;
  assert.ok(youtube.liveMutationVersionAfter > youtube.liveMutationVersionBefore);
  assert.equal(youtube.classificationAfterChurn, 'NO_RELEVANT_CHANGE');
  assert.equal(youtube.semanticChangeCountAfterChurn, 0);
  assert.equal(youtube.changedRegionCountAfterChurn, 0);
});

test('P5 paired live mediation-elision workload exceeds 2x median without hiding effects', async () => {
  const evidence = await readJson('./fixtures/delta-performance-p5-v1.json');
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
  const evidence = await readJson('./fixtures/delta-performance-p5-v1.json');
  const sample = evidence.simpleOperation;
  assert.equal(sample.baselineSamples, 24);
  assert.equal(sample.mediationElidedSamples, 24);
  assert.ok(sample.medianRegression <= evidence.frozenTargets.maximumSimpleOperationMedianRegression);
  assert.equal(sample.medianRegression, evidence.observedGates.simpleOperationMedianRegression);
});

test('P5 safety and cleanup records zero foreground authority and no leftover test tabs', async () => {
  const evidence = await readJson('./fixtures/delta-performance-p5-v1.json');
  const safety = evidence.safetyAndCleanup;
  assert.equal(safety.tabsActivateCommands, 0);
  assert.equal(safety.pointerCommands, 0);
  assert.equal(safety.fillOrKeyCommands, 0);
  assert.equal(safety.remainingTestTabs, 0);
  assert.equal(safety.excludedStaleTabPreflightFailures, 1);
  assert.equal(evidence.observedGates.foregroundTakeoverCount, 0);
});

test('P5 frozen boundary remains locked except the P6-authorized Reactive VM cutover', async () => {
  // U-P1 (2026-09-24) authorizes the accessibility observation layer: shadow-piercing collection + computed accessible names in content.js, the poverty-triggered CDP axSummary in background.js, MCP guidance text, and the 1.6.13 version sweep. Protocol 1, 26 primitives, 22 tools, and the read_page input schema remain frozen. U-R (2026-09-28) then authorizes timeout/retry/popup parity: an unknown-outcome command timeout in background.js, expect-polling and fill retry parity in content.js, the popup/openedTabs log, MCP OAuth/openedTabs guidance, and the 1.6.13 version sweep. U-Sonar (2026-09-29) authorizes the new-code reliability sweep: explicit code-unit sort comparators (order byte-identical, frozen digests unchanged) in content.js and multi-signal-relevance-p3.js, ZWJ split out of the PUA strip class in content.js (same code-point set), while the byte-pinned 8D transaction bundle libs and the boundary-locked reactive-vm-7d then-field stay byte-identical (canonical ASCII-key sorts / serialized AST field = false-positive, resolved in Sonar). Protocol 1, 26 primitives, 22 tools, and the read_page input schema remain frozen. Protocol 1, 26 primitives, 22 tools, and the read_page input schema remain frozen.
  const files = new Map([
    ['../lib/event-driven-local-execution-p4.js', '1c1ce3ada60dbddf5caedf591490edf4ff70697b'],
    ['../lib/multi-signal-relevance-p3.js', '04fb6fc9afd9e826038a8bb73003cfddb304e7a9'],
    ['../lib/delta-first-observation-p2.js', '5335e1d09a8b8357a2fb20ecb30f1908c3c7d7e3'],
    ['../lib/reactive-vm.js', 'e035d282b642c7fb0dfe687e034ec200072da991'],
    ['../lib/reactive-vm-7c.js', '2e5f63f2c5d7c0ee2341c5a88a407783ae4523f4'],
    ['../lib/reactive-vm-7d.js', 'f08445f142d001aeb45b40a4d1a77fd6d2c7b6c8'],
    ['../extension/content.js', 'f4d15ef55bd68131cff98598328b2ba8d648cc3e'],
    ['../extension/background.js', '4eabbd940898538cd211885b8890e05c9ee4fc25'],
    ['../extension/manifest.json', 'e69324b7c2abb194d15459d55eddd3a838c04e53'],
    ['../supabase/functions/opera-agent-mcp/index.ts', '825651427a13ab3d6d2c404b07f62001fa672c71'],
  ]);
  for (const [relativePath, expected] of files) {
    const bytes = await readFile(new URL(relativePath, import.meta.url));
    assert.equal(sha1Blob(bytes), expected, `${relativePath} must match the current authorized boundary lock after P6 supersession`);
  }
});
