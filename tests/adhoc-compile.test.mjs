// @last-edited: 2026-10-08 UTC+7.
// @title: adhoc-compile.test — Test.
// @state: locks the ad-hoc graph compiler: allowlists, label plus confirm rules, budgets.
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
});

test('budgets bound nodes and size', () => {
  const many = { nodes: Array.from({ length: MAX_COMMAND_NODES + 1 }, (_, i) => ({ id: `n${i}`, type: 'command', method: 'page.read', params: {} })) };
  assert.equal(compileAdhocGraph(many).ok, false);
  const big = { nodes: [{ id: 'n0', type: 'command', method: 'page.read', params: { pad: 'x'.repeat(40000) } }] };
  assert.equal(compileAdhocGraph(big).code, 'GRAPH_TOO_LARGE');
});
