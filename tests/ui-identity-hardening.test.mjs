import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// U-I identity hardening (2026-09-21): geometry-aware action-ref rebind
// rejection, ambiguity-ranked find with disambiguation hints, and a
// visible-text actionable fallback. Source-contract style: the runtime
// behavior is exercised by the controlled browser regression; these
// assertions lock the contract in source.

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const content = read('../extension/content.js');

test('I1: action-ref descriptors carry mint-time geometry and mutation version', () => {
  assert.match(content, /function actionRefDescriptor\(el, options = \{\}\)/);
  assert.match(content, /rectAtMint:/);
  assert.match(content, /mutationVersionAtMint:/);
  assert.match(content, /actionRefDescriptor\(el, \{ rectAtMint: documentRectOf\(el\), mutationVersionAtMint: mutationVersion \}\)/);
});

test('I1: rebind requires geometry continuity and rejects drift with current candidates', () => {
  assert.match(content, /function geometryMatchesMint/);
  assert.match(content, /GEOMETRY_DRIFT_TOLERANCE_PX = 24/);
  assert.match(content, /moved beyond the geometry tolerance/);
  assert.match(content, /currentCandidates/);
});

test('I2: ranked find results expose candidateRank plus a disambiguation hint', () => {
  assert.match(content, /function findDisambiguationHint/);
  assert.match(content, /candidateRank: position \+ 1/);
  assert.match(content, /chose:\$\{position \+ 1\}/);
});

test('I2: a zero exact match projects one bounded fuzzy candidate with an explicit hint', () => {
  assert.match(content, /fuzzy: true/);
  assert.match(content, /exact-match fallback from fuzzy text match/);
});

test('I3: visible text without an interactive element surfaces a nearby actionable candidate', () => {
  assert.match(content, /function findVisibleTextCandidate/);
  assert.match(content, /closest actionable element near the visible text/);
});
