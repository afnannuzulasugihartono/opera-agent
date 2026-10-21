// @last-edited: 2026-10-21 UTC+7.
// @title: adhoc-compile.test — the ad-hoc graph compiler holds its allowlists, its labels and its budgets.
// @state: which methods pass, which label a write must carry, and the bounds the compiler refuses to cross.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAdhocGraph, MAX_COMMAND_NODES } from '../lib/adhoc-compile.js';

const click = (label, extra = {}) => ({ id: 'n1', type: 'command', method: 'page.click', params: { ref: 'r1' }, declaredLabel: label, ...extra });

test('reads pass, ordinary writes pass with labels', () => {
  const out = compileAdhocGraph({ nodes: [
    { id: 'n0', type: 'command', method: 'page.find', params: { text: 'Skip' } },
    click('Skip ad'),
  ] });
  assert.equal(out.ok, true);
  assert.equal(out.definition.steps.length, 2);
});

test('non-allowlisted method dies', () => {
  const out = compileAdhocGraph({ nodes: [{ id: 'n0', type: 'command', method: 'tabs.navigate', params: {} }] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'METHOD_NOT_ALLOWED');
});

test('write node without a label dies', () => {
  const out = compileAdhocGraph({ nodes: [{ id: 'n0', type: 'command', method: 'page.fill', params: { ref: 'r1', value: 'x' } }] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'LABEL_REQUIRED');
});

test('consequential label without confirm dies, with confirm passes and records it', () => {
  const bad = compileAdhocGraph({ nodes: [click('Pay now')] });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'CONFIRM_REQUIRED');
  const good = compileAdhocGraph({ nodes: [click('Pay now', { confirm: true })] });
  assert.equal(good.ok, true);
  assert.equal(good.definition.steps[0].confirmed, true);
  assert.equal(good.definition.steps[0].confirmPattern, 'Pay');
});

test('budgets bound nodes and size', () => {
  const many = { nodes: Array.from({ length: MAX_COMMAND_NODES + 1 }, (_, i) => ({ id: `n${i}`, type: 'command', method: 'page.read', params: {} })) };
  assert.equal(compileAdhocGraph(many).ok, false);
  const big = { nodes: [{ id: 'n0', type: 'command', method: 'page.read', params: { pad: 'x'.repeat(40000) } }] };
  assert.equal(compileAdhocGraph(big).code, 'GRAPH_TOO_LARGE');
});

test('repeat without maxIterations dies', () => {
  const out = compileAdhocGraph({ nodes: [{ id: 'n0', type: 'repeat', steps: [] }] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'BUDGET_EXCEEDED');
});

test('foreach maxItems 9999 dies', () => {
  const out = compileAdhocGraph({ nodes: [{ id: 'n0', type: 'foreach', maxItems: 9999, steps: [] }] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'BUDGET_EXCEEDED');
});

test('nested bodies count toward the command budget', () => {
  const reads = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: `${tag}-n${i}`, type: 'command', method: 'page.read', params: {} }));
  const repeatOf = (tag) => ({ id: tag, type: 'repeat', maxIterations: 2, steps: reads(tag, 5) });
  const small = compileAdhocGraph({ nodes: [repeatOf('r0')] });
  assert.equal(small.ok, true);
  const nested = compileAdhocGraph({ nodes: [repeatOf('r0'), repeatOf('r1'), repeatOf('r2')] });
  assert.equal(nested.ok, false);
  assert.equal(nested.code, 'BUDGET_EXCEEDED');
});

test('wait 1e12 dies', () => {
  const out = compileAdhocGraph({ nodes: [{ id: 'n0', type: 'wait', ms: 1e12 }] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'BUDGET_EXCEEDED');
});
