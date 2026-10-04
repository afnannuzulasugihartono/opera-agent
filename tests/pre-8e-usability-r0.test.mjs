// Last edited: 2026-10-04 17:52. Title: pre-8e-usability-r0.test — Why source-text pins, stated per AGENTS.md: R0 is an evidence record, not a Now: state why the source-text pins are the deliverable in seven files.

// Why source-text pins, stated per AGENTS.md: R0 is an evidence record, not a
// behavior change. Its job is to fix the measured baseline so a later phase
// cannot quietly claim an improvement, and to demonstrate on this tree that the
// two defects R1 targets are still present -- the legacy Skip ordering and the
// stale ref after a benign same-document rerender. Each is a single controlled
// run against a frozen fixture, so the numbers are single-run and
// non-distributional. Nothing here authorizes a public-surface change, and the
// measurements are model-facing payload sizes from a deterministic fixture, not
// timings from a live model loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const baselineUrl = new URL('./fixtures/pre-8e-usability-baseline-r0-v1.json', import.meta.url);
const fixtureUrl = new URL('./fixtures/pre-8e-usability-r0.html', import.meta.url);
const baseline = JSON.parse(await readFile(baselineUrl, 'utf8'));
const fixtureHtml = await readFile(fixtureUrl, 'utf8');

function makeLegacyReadPayload({ textChars, observedEntities, page }) {
  const template = baseline.controlledPayload.entityTemplate;
  return {
    page: {
      text: `${page.toUpperCase()}_${'x'.repeat(Math.max(0, textChars - page.length - 1))}`,
      textChars,
      totalTextChars: textChars,
      mutationVersion: 120000,
      semanticState: {
        schemaVersion: 1,
        documentGeneration: 1,
        observationRevision: 27,
        entityCount: observedEntities,
        observedEntityCount: observedEntities,
        ambiguityCount: 0,
        excludedSensitiveCount: 0
      },
      semanticDelta: {
        schemaVersion: 1,
        sourceRevision: 26,
        resultingRevision: 27,
        classification: 'NO_RELEVANT_CHANGE',
        changes: [],
        completeSnapshotRequired: false
      },
      elements: Array.from({ length: observedEntities }, (_, index) => ({
        logicalId: `se_${page}_${String(index).padStart(3, '0')}`,
        stableKey: `oa_${page}_${String(index).padStart(3, '0')}`,
        ...template,
        label: `Irrelevant ${page} control ${String(index).padStart(3, '0')}`,
        text: `bounded-${String(index).padStart(3, '0')}`,
        rect: { left: 0, top: 1000 + index, right: 120, bottom: 1032 + index, width: 120, height: 32 }
      })),
      semanticViews: {
        schemaVersion: 1,
        revision: 27,
        changedRegionIds: [],
        removedRegionIds: [],
        regions: []
      }
    }
  };
}

function payloadBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

test('R0 locks the live measurements as single-run, non-distributional evidence', () => {
  assert.equal(baseline.schemaVersion, 1);
  assert.equal(baseline.checkpoint, 'R0');
  assert.equal(baseline.distributional, false);
  assert.match(baseline.distributionNote, /not percentiles|not.*distribution/i);
  assert.equal(baseline.timingsMs['tabs.navigate.youtubeHome'].total, 5224);
  assert.equal(baseline.timingsMs['youtube.get_transcript.v4'].total, 20514);
  assert.equal(baseline.timingsMs['youtube.get_transcript.v4'].workflowStartQueue, 4123);
  assert.deepEqual(baseline.modelFacingReads.home, {
    textChars: 686,
    observedEntities: 119,
    legacyResultWasLargeOrTruncated: true
  });
  assert.deepEqual(baseline.modelFacingReads.watch, {
    textChars: 3331,
    observedEntities: 139,
    legacyResultWasLargeOrTruncated: true
  });
});

test('R0 controlled fixture contains the six frozen finding surfaces without site-specific selectors', () => {
  for (const marker of [
    'id="skip-navigation"',
    'top: -1000px',
    'id="ad-skip"',
    'id="rerender-skip"',
    'id="noise-counter"',
    '<video id="fixture-video"',
    'id="transcript-shape"'
  ]) assert.ok(fixtureHtml.includes(marker), marker);
  assert.ok(fixtureHtml.indexOf('id="skip-navigation"') < fixtureHtml.indexOf('id="ad-skip"'));
  assert.doesNotMatch(fixtureHtml, /youtube\\.com|ytp-|ytd-/i);
});

test('R0 proves the legacy Skip ordering fails the R1 actionability acceptance', () => {
  const [legacyFirst, realSkip] = baseline.targetAmbiguity.targets;
  assert.equal(baseline.targetAmbiguity.legacyOrder[0], legacyFirst.id);
  assert.equal(legacyFirst.label, 'Skip navigation');
  assert.equal(legacyFirst.visible, true);
  assert.equal(legacyFirst.inViewport, false);
  assert.equal(realSkip.label, 'Skip');
  assert.equal(realSkip.inViewport, true);
  assert.equal(realSkip.disabled, undefined);
  assert.equal(baseline.targetAmbiguity.r1AcceptanceSatisfiedByLegacyOrder, false);
  const legacyFirstIsPreferredAction = legacyFirst.visible && legacyFirst.inViewport && legacyFirst.enabled && !legacyFirst.sensitive;
  assert.equal(legacyFirstIsPreferredAction, false);
});

test('R0 proves a benign same-document rerender currently leaves the old action ref stale', () => {
  const dynamic = baseline.dynamicRef;
  assert.notEqual(dynamic.oldRef, dynamic.freshRef);
  assert.equal(dynamic.legacyOldRefClick.ok, false);
  assert.match(dynamic.legacyOldRefClick.errorContains, /stale/i);
  assert.equal(dynamic.r2AcceptanceSatisfiedByLegacyBehavior, false);
});

test('R0 measures deterministic legacy model-facing page.read-equivalent payload amplification', () => {
  const home = makeLegacyReadPayload({ ...baseline.modelFacingReads.home, page: 'home' });
  const watch = makeLegacyReadPayload({ ...baseline.modelFacingReads.watch, page: 'watch' });
  const homeBytes = payloadBytes(home);
  const watchBytes = payloadBytes(watch);
  const homeUsefulBytes = baseline.modelFacingReads.home.textChars;
  const watchUsefulBytes = baseline.modelFacingReads.watch.textChars;

  assert.equal(home.page.elements.length, 119);
  assert.equal(watch.page.elements.length, 139);
  assert.equal(homeBytes, baseline.controlledPayload.expectedLegacyBytes.home);
  assert.equal(watchBytes, baseline.controlledPayload.expectedLegacyBytes.watch);
  assert.ok(homeBytes > homeUsefulBytes * 10, { homeBytes, homeUsefulBytes });
  assert.ok(watchBytes > watchUsefulBytes * 3, { watchBytes, watchUsefulBytes });

  console.log('R0_PAYLOAD_BASELINE', JSON.stringify({
    home: { legacyBytes: homeBytes, usefulTextChars: homeUsefulBytes, entityCount: 119 },
    watch: { legacyBytes: watchBytes, usefulTextChars: watchUsefulBytes, entityCount: 139 }
  }));
});

test('R0 locks media and transcript workflow baselines without authorizing public-surface changes', () => {
  assert.equal(baseline.media.baselinePrimitive, 'media.state');
  assert.equal(baseline.media.publicMcpExpansionAuthorized, false);
  assert.equal(baseline.timingsMs['media.state'].total, 514);
  assert.equal(baseline.workflow.version, 4);
  assert.equal(baseline.workflow.baselineTotalMs, 20514);
  assert.equal(baseline.workflow.legacyOutputIncludesUnrelatedMaterial, true);
});
