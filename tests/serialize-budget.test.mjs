// @last-edited: 2026-11-08 UTC+7.
// @title: serialize-budget.test — a result too large for the wire keeps its head and says it was cut.
// @state: the fitting list, the trimmed list, and the empty list.
// @dependencies: node:test, strict, ../extension/lib/serialize.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWithinBudget } from '../extension/lib/serialize.js';

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
