// @last-edited: 2026-10-27 UTC+7.
// @title: action-strategy — grounding an action on a surface, decided from the same evidence the read used.
// @state: one table of profiles against the grounding ladder each produces.
// @dependencies: node:test, node:assert/strict, ../local/action-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_COORDINATE, ACTION_DOM, actionLadder } from '../local/action-strategy.js';

const names = (profile) => actionLadder(profile).map((step) => step.strategy);

test('an ordinary page grounds on its elements', () => {
  assert.deepEqual(names({ textInDom: true, canvas: false, editable: false, axRich: false, focused: false }), [ACTION_DOM, ACTION_COORDINATE]);
});

test('a canvas surface falls back to coordinates and keys', () => {
  assert.deepEqual(names({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true }), [ACTION_COORDINATE, ACTION_DOM]);
});

test('a canvas surface with a rich accessibility tree still leads with coordinates', () => {
  assert.deepEqual(names({ textInDom: false, canvas: true, editable: false, axRich: true, focused: false }), [ACTION_COORDINATE, ACTION_DOM]);
});

test('every step names why it is in the ladder', () => {
  for (const step of actionLadder({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true })) {
    assert.ok(step.why.length > 0);
  }
});
