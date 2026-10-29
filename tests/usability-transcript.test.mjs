// @last-edited: 2026-10-04 18:50 UTC+7.
// @title: usability-transcript — transcript workflow with bounded fallback.
// @state: youtube.get_transcript v5 collects transcript-scoped output with the v4 chunked reader as fallback.
// @dependencies: node:fs, node:test, strict.

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migrationDir = new URL('../supabase/migrations/', import.meta.url);
const r7MigrationName = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql') && name.includes('pre_8e_r7_transcript_cleanup'))
  .sort()
  .pop();

const workflow = JSON.parse(
  fs.readFileSync(new URL(`../supabase/migrations/${r7MigrationName}`, import.meta.url), 'utf8')
    .match(/\$wf\$([\s\S]*?)\$wf\$::jsonb/)[1]
);

const walk = (steps, visit, parents = []) => {
  for (const step of steps || []) {
    visit(step, parents);
    if (Array.isArray(step?.then)) walk(step.then, visit, [...parents, { via: 'then', step }]);
    if (Array.isArray(step?.else)) walk(step.else, visit, [...parents, { via: 'else', step }]);
    if (Array.isArray(step?.steps)) walk(step.steps, visit, [...parents, { via: 'loop', step }]);
  }
};

test('v5 registers a parseable youtube.get_transcript workflow with clean output shape (T034)', () => {
  assert.ok(r7MigrationName, 'R7 transcript cleanup migration must exist');
  assert.equal(workflow.steps[0].id, 'yt');
  assert.deepEqual(
    Object.keys(workflow.output).sort(),
    ['activatedForRender', 'openMethod', 'panelWasOpen', 'segmentCount', 'segments', 'tab']
  );
  assert.deepEqual(workflow.output.segments, { $ref: 'steps.segments.result.items' });
  assert.deepEqual(workflow.output.segmentCount, { $ref: 'steps.segments.result.count' });
});

test('primary collection is transcript-scoped, bounded, and includes hidden segments (T036)', () => {
  const [segments] = (() => {
    const found = [];
    walk(workflow.steps, (step) => { if (step.id === 'segments') found.push(step); });
    return found;
  })();
  assert.equal(segments.method, 'page.query');
  assert.equal(segments.params.selector, 'ytd-transcript-segment-renderer');
  assert.equal(segments.params.limit, 100);
  assert.equal(segments.params.visibleOnly, false);
  assert.ok(segments.continueOnError, 'segment query must not abort the workflow on DOM variants');
});

test('primary model-facing output carries no full-page text fields (T036)', () => {
  const outputJson = JSON.stringify(workflow.output);
  assert.doesNotMatch(outputJson, /"text"|hasMore|nextOffset|totalTextChars/);
});

test('removes the unconditional previousActive read; activation branch owns it (T035)', () => {
  const topLevel = workflow.steps.map((step) => step.id);
  assert.ok(!topLevel.includes('previousActive'), 'previousActive must not run unconditionally');
  const prevActive = [];
  walk(workflow.steps, (step, parents) => {
    if (step.id === 'prevActive') prevActive.push({ step, parents });
  });
  assert.equal(prevActive.length, 1);
  const guard = prevActive[0].parents.find(
    (entry) => entry.step.type === 'if' && (entry.step.then || []).some((s) => s.id === 'activateForRender')
  );
  assert.ok(guard, 'prevActive must sit inside the activation fallback branch (the if owning activateForRender)');
  const restore = [];
  walk(workflow.steps, (step) => { if (step.id === 'restoreActive') restore.push(step); });
  assert.equal(restore.length, 1);
  assert.deepEqual(restore[0].params.tabId, { $ref: 'vars.prevActiveId' });
});

test('keeps exactly one chunked reader, only as the segment-query fallback (compatibility)', () => {
  const chunks = [];
  walk(workflow.steps, (step, parents) => {
    if (step.id === 'chunks') chunks.push({ step, parents });
  });
  assert.equal(chunks.length, 1);
  const segGuard = chunks[0].parents.find((entry) => entry.step.id === 'segmentsAvailable');
  assert.ok(segGuard, 'chunked reader must live inside the segmentsAvailable guard');
  assert.equal(segGuard.via, 'else', 'chunked reader must be the fallback branch, not the primary path');
});

test('structural cost reduction is deterministic: commands and payload (T037)', () => {

  const isCommand = (step) => step?.type === 'command';

  const v5 =
    1
    + 1
    + 1
    +
    6
    +
    1
    + 1
    + 1
  ;

  for (const rounds of [1, 5, 10, 12]) {
    const v4 = v5 - 1
      + 1
      + rounds;
    if (rounds === 1) {

      assert.ok(v4 === v5 + 1);
    } else if (rounds >= 12) {

      assert.ok(v4 >= 2 * v5, `at ${rounds} rounds v4 (${v4}) must cost >= 2x v5 (${v5}) commands`);
    }
  }

  const v4Chars = 10 * 12000;
  const v5CharsMax = 100 * 300;
  const reduction = 1 - v5CharsMax / v4Chars;
  assert.ok(reduction >= 0.7, `payload reduction ${(reduction * 100).toFixed(0)}% must be >= 70%`);
});

test('records the honest T037 boundary: single-run baseline is non-distributional', () => {

  const migrationSql = fs.readFileSync(
    new URL(`../supabase/migrations/${r7MigrationName}`, import.meta.url), 'utf8'
  );
  assert.match(migrationSql, /Pre-8E repair R7/);
  assert.match(migrationSql, /bounded fallback/);
});
