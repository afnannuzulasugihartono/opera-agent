import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

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
