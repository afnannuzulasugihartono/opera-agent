// @last-edited: 2026-11-08 UTC+7.
// @title: serialize-budget.test — a result too large for the wire keeps its head and says it was cut.
// @state: the fitting list, the trimmed list, and the empty list.
// @dependencies: node:test, strict, ../extension/lib/serialize.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_BUDGET_BYTES, boundedResult, oversized, fitWithinBudget } from '../extension/lib/serialize.js';
import { FRAME_MAX_BYTES } from '../extension/lib/socket-protocol.js';

test('a list that fits is returned whole and untrimmed', () => {
  const list = [{ ref: 'a' }, { ref: 'b' }];
  assert.deepEqual(fitWithinBudget(list, 1024), { elements: list, truncated: false });
});

test('a list that does not fit keeps its head and says it was cut', () => {
  const list = Array.from({ length: 40 }, (_, index) => ({ ref: 'oa_' + index, text: 'x'.repeat(80) }));
  const fitted = fitWithinBudget(list, 1024);
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.elements.length > 0 && fitted.elements.length < list.length);
  assert.deepEqual(fitted.elements, list.slice(0, fitted.elements.length));
  assert.ok(JSON.stringify(fitted.elements).length <= 1024);
});

test('an empty list is not a truncation', () => {
  assert.deepEqual(fitWithinBudget([], 1024), { elements: [], truncated: false });
});

test('the result budget is the frame budget, less one envelope', () => {
  assert.equal(RESULT_BUDGET_BYTES, FRAME_MAX_BYTES - 256 * 1024);
  assert.equal(RESULT_BUDGET_BYTES, 3.75 * 1024 * 1024);
});

test('a three-megabyte result rides, and one over the budget is refused with the new number', () => {
  const big = { text: 'x'.repeat(3 * 1024 * 1024) };
  assert.equal(oversized(big), false);
  assert.doesNotThrow(() => boundedResult(big));
  const over = { text: 'x'.repeat(RESULT_BUDGET_BYTES + 1024) };
  assert.equal(oversized(over), true);
  assert.throws(() => boundedResult(over), new RegExp(`${RESULT_BUDGET_BYTES} bytes`));
});
