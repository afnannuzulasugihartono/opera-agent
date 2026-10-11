// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: ref-reacquire.test — reacquire.test — Bounded ref re-acquisition contracts.
// @state: drop the milestone prefix from the interaction test family.
// @dependencies: node:test, strict, promises.

// Bounded ref re-acquisition contracts.
//
// The design decision this file locks is a NEGATIVE one, and it is the point of
// the checkpoint: the mint-time geometry guard is NOT relaxed. It exists because
// a same-place successor can be a DIFFERENT control (the recorded Street-View
// mis-click), so widening it would reintroduce that failure mode.
//
// What was actually broken was the cost of recovery: after a legitimate
// re-render moved a control, the model had to run a whole new page.find just to
// obtain a usable ref. The fix hands back fresh refs for candidates that have
// already passed uniqueness, intrinsic identity, actionability, and the
// non-sensitive check — which is exactly what a find would have granted — while
// still refusing the stale ref.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

function resolveBlock() {
  const start = source.indexOf('function resolveActionRef(ref) {');
  assert.ok(start > 0, 'resolveActionRef must be locatable');
  return source.slice(start, source.indexOf('\n  function ', start + 10));
}

test('the geometry tolerance is unchanged and still unbroadened', () => {
  const tolerance = source.match(/const GEOMETRY_DRIFT_TOLERANCE_PX = (\d+)/)?.[1];
  assert.equal(tolerance, '24', 'the guard value must not be widened');

  const geometry = source.slice(
    source.indexOf('function geometryMatchesMint'),
    source.indexOf('\n  // U-I (I4')
  );
  assert.match(geometry, /Math\.abs\(rect\.x - mint\.x\) <= GEOMETRY_DRIFT_TOLERANCE_PX/);
  assert.match(geometry, /Math\.abs\(rect\.y - mint\.y\) <= GEOMETRY_DRIFT_TOLERANCE_PX/);
  assert.match(geometry, /Math\.abs\(rect\.width - mint\.width\) <= GEOMETRY_DRIFT_TOLERANCE_PX/);
  assert.match(geometry, /Math\.abs\(rect\.height - mint\.height\) <= GEOMETRY_DRIFT_TOLERANCE_PX/);
});

test('a moved successor is still refused, and the stale ref is never revived', () => {
  const block = resolveBlock();

  assert.match(block, /if \(!geometryMatchesMint\(replacement, descriptor\)\) \{[\s\S]*?throw new Error\(/);

  assert.ok(
    block.indexOf('if (!geometryMatchesMint') < block.lastIndexOf('reverseRefs.set(key, replacement)'),
    'the rebind assignment must come after the geometry guard'
  );

  assert.doesNotMatch(block, /geometryMatchesMint\([^)]*\) \|\|/);
  assert.doesNotMatch(block, /skipGeometry|ignoreGeometry|forceRebind/i);
});

test('recovery is bounded and only offers refs that are already safe to act on', () => {
  const block = resolveBlock();

  assert.match(block, /const candidates = revalidationCandidates\(descriptor\);\s*if \(candidates\.length !== 1\) return null;/);
  assert.match(block, /candidates\.slice\(0, 3\)\.map/);

  assert.match(block, /freshRef: getRef\(el\)/);
  assert.match(block, /actionable: s\.actionable/);

  assert.match(block, /if \(candidates\.length !== 1\) return null;/);
});

test('the refusal message is diagnostic and tells the model how to recover', () => {
  const block = resolveBlock();
  assert.match(block, /refusing automatic rebind of the stale ref/);
  assert.match(block, /may be acted on directly without re-running find/);

  assert.match(block, /drift \$\{Math\.round\(driftPx\)\}px, tolerance \$\{GEOMETRY_DRIFT_TOLERANCE_PX\}px/);

  const messageBlock = block.slice(block.indexOf('const currentCandidates'));
  assert.doesNotMatch(messageBlock, /value:|includeValue/);
});

test('sensitive targets are never offered a fresh ref', () => {
  const block = resolveBlock();

  assert.match(block, /if \(descriptor\.sensitive\) return null;/);
  const pool = block.slice(block.indexOf('const candidates = revalidationCandidates'));
  assert.match(pool, /freshRef: getRef\(el\)/);

  const revalidation = source.slice(
    source.indexOf('function revalidationCandidates'),
    source.indexOf('function resolveActionRef')
  );
  assert.match(revalidation, /state\.actionable && !state\.sensitive/);
});

test('the model is told the fresh refs are directly actionable', async () => {
  const mcp = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(mcp, /that stale ref is refused on purpose/);

  assert.match(mcp, /the error carries candidates, each entry holding a freshRef/);
  assert.match(mcp, /act on one of those freshRef values directly/);
  assert.doesNotMatch(mcp, /carries freshRefs/);

  assert.doesNotMatch(mcp, /increase the geometry tolerance|widen the tolerance/);
});
