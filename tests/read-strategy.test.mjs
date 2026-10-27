// @last-edited: 2026-10-27 UTC+7.
// @title: read-strategy — the read ladder, decided from evidence rather than from a site name.
// @state: one table of profiles against the ladder each produces, including the cases where a strategy must not appear.
// @dependencies: node:test, node:assert/strict, ../local/read-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HARM_CARET_MOVE,
  HARM_CONTENT_CHANGE,
  HARM_NONE,
  STRATEGY_AX,
  STRATEGY_DOM,
  STRATEGY_SELECT_ALL,
  STRATEGY_VISION,
  readLadder
} from '../local/read-strategy.js';

const names = (profile) => readLadder(profile).map((step) => step.strategy);

test('an ordinary DOM page keeps its order', () => {
  const ladder = readLadder({ textInDom: true, canvas: false, editable: false, axRich: false, focused: false });
  assert.deepEqual(names({ textInDom: true, canvas: false, editable: false, axRich: false, focused: false }), [STRATEGY_DOM, STRATEGY_AX, STRATEGY_VISION]);
  assert.equal(ladder.every((step) => step.harm === HARM_NONE), true);
});

test('a canvas editable surface leads with the accessibility tree', () => {
  const profile = { textInDom: false, canvas: true, editable: true, axRich: true, focused: true };
  assert.deepEqual(names(profile), [STRATEGY_AX, STRATEGY_DOM, STRATEGY_SELECT_ALL, STRATEGY_VISION]);
});

test('a canvas editable surface tags select-all as caret-moving', () => {
  const ladder = readLadder({ textInDom: false, canvas: true, editable: true, axRich: true, focused: true });
  const step = ladder.find((entry) => entry.strategy === STRATEGY_SELECT_ALL);
  assert.equal(step.harm, HARM_CARET_MOVE);
  assert.ok(step.why.length > 0, 'every step names why it is in the ladder');
});

test('a canvas without an editable region offers no caret-moving strategy', () => {
  const profile = { textInDom: false, canvas: true, editable: false, axRich: true, focused: true };
  assert.deepEqual(names(profile), [STRATEGY_AX, STRATEGY_DOM, STRATEGY_VISION]);
});

test('an ax tree with no document text falls through to the DOM', () => {
  const profile = { textInDom: true, canvas: true, editable: true, axRich: false, focused: true };
  assert.deepEqual(names(profile), [STRATEGY_DOM, STRATEGY_AX, STRATEGY_SELECT_ALL, STRATEGY_VISION]);
});

test('contradictory signals still produce one ladder', () => {
  const ladder = readLadder({ textInDom: true, canvas: true, editable: false, axRich: true, focused: false });
  assert.ok(Array.isArray(ladder) && ladder.length >= 3);
  assert.equal(ladder.filter((step) => step.harm === HARM_CARET_MOVE).length, 0);
});

test('every step carries a strategy, a harm class and a reason', () => {
  for (const profile of [
    { textInDom: true, canvas: false, editable: false, axRich: false, focused: false },
    { textInDom: false, canvas: true, editable: true, axRich: true, focused: true },
    { textInDom: false, canvas: false, editable: false, axRich: false, focused: false }
  ]) {
    for (const step of readLadder(profile)) {
      assert.equal(typeof step.strategy, 'string');
      assert.ok([HARM_NONE, HARM_CARET_MOVE, HARM_CONTENT_CHANGE].includes(step.harm));
      assert.equal(typeof step.why, 'string');
      assert.ok(step.why.length > 0);
    }
  }
});
