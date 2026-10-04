// @last-edited: 2026-10-04 11:10 UTC.
// @title: delta-performance-p0.test — performance-p0.test — Test.
// @context: Test.
// @state: remove milestone labels from prose, and rename the ax-observation doc.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/delta-performance-baseline-p0-v1.json', import.meta.url), 'utf8'));
const plan = fs.readFileSync(new URL('../docs/delta-first-performance-plan.md', import.meta.url), 'utf8');

test('baseline is pinned to the accepted head and keeps runtime boundaries frozen', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.track, 'DELTA_FIRST_PERFORMANCE');
  assert.equal(fixture.checkpoint, 'P0');
  assert.equal(fixture.baselineHead, '696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab');
  assert.equal(fixture.runtimeMutationAllowed, false);
  assert.equal(fixture.extensionMutationAllowed, false);
  assert.equal(fixture.publicMcpMutationAllowed, false);
  assert.equal(fixture.productionMutationAllowed, false);
  assert.equal(fixture.transactionAuthorityMutationAllowed, false);
});

test('the freeze keeps the complete synthetic and real-site workload matrix', () => {
  const ids = fixture.workloads.map((item) => item.id);
  assert.deepEqual(ids, [
    'static-content',
    'dynamic-spa',
    'infinite-lazy-list',
    'virtualized-list',
    'irrelevant-mutation-storm',
    'relevant-single-update',
    'navigation-reset',
    'long-repetitive-collection',
    'real-google-maps',
    'real-github',
    'real-youtube',
  ]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(fixture.workloads.filter((item) => item.kind === 'REAL_SITE').length, 3);
});

test('the freeze keeps end-to-end measurements rather than DOM-only microbenchmarks', () => {
  const required = [
    'wallClockMs',
    'reasoningRoundTrips',
    'browserCommandCount',
    'pageReadCount',
    'fullSnapshotCount',
    'deltaCount',
    'browserToServerBytes',
    'reasoningPayloadBytes',
    'semanticEntitiesProcessed',
    'resetCount',
    'retryOrFallbackCount',
    'foregroundTakeoverCount',
    'taskCorrect',
    'falseCompletionCount',
    'staleStateActionCount',
  ];
  assert.deepEqual(fixture.metrics, required);
});

test('the freeze records inherited accepted 1.6.0 measurements without fabricating exact-head live results', () => {
  assert.equal(fixture.inheritedAcceptedMeasurements.source, 'docs/benchmarks.md');
  assert.equal(fixture.inheritedAcceptedMeasurements.richReadMedianMs, 19.83);
  assert.equal(fixture.inheritedAcceptedMeasurements.richSnapshotMedianBytes, 50953);
  assert.equal(fixture.inheritedAcceptedMeasurements.singleUpdateDeltaBytes, 6087);
  assert.equal(fixture.inheritedAcceptedMeasurements.singleUpdateDeltaToSnapshotRatio, 0.12);
  assert.equal(fixture.exactHeadLiveMeasurements.status, 'NOT_RUN_IN_P0');
  assert.match(fixture.exactHeadLiveMeasurements.reason, /P0 is contract\/baseline freeze only/);
});

test('the freeze keeps conservative target gates without claiming they are already achieved', () => {
  assert.equal(fixture.targetGates.maximumFalseCompletionCount, 0);
  assert.equal(fixture.targetGates.maximumForegroundTakeoverCount, 0);
  assert.equal(fixture.targetGates.maximumStaleStateActionCount, 0);
  assert.equal(fixture.targetGates.maximumRelevantSignalLossCount, 0);
  assert.equal(fixture.targetGates.minimumSmallChangeReasoningPayloadReduction, 0.75);
  assert.equal(fixture.targetGates.minimumRepetitiveReasoningRoundTripReduction, 0.60);
  assert.equal(fixture.targetGates.minimumSteadyStateFullSnapshotReduction, 0.80);
  assert.equal(fixture.targetGates.minimumLongTaskMedianSpeedup, 2.0);
  assert.equal(fixture.targetGates.maximumSimpleOperationMedianRegression, 0.15);
  assert.equal(fixture.targetGates.status, 'TARGET_NOT_ACHIEVEMENT');
});

test('plan makes full snapshots recovery primitives rather than deleting them', () => {
  for (const marker of [
    'Plan freeze and baseline',
    'Persistent semantic working state',
    'Delta-first observation pipeline',
    'Multi-signal coalescer and relevance gate',
    'Event-driven local reactive execution',
    'Real-Opera performance acceptance',
    'follow-up track remains paused',
    'Full snapshot is a recovery primitive',
    'RESET',
    'revision gap',
    'foreground takeover',
  ]) {
    assert.match(plan, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.doesNotMatch(plan, /arbitrary JavaScript is allowed/i);
  assert.doesNotMatch(plan, /raw CDP is allowed/i);
});
