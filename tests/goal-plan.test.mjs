// @last-edited: 2026-10-05 00:05 UTC+7.
// @title: goal-plan — the boundary between model text and an executable program.
// @state: A model may only supply the shape of a task; identity, budgets and method limits stay with the caller.
// @dependencies: test, assert, goal-plan, reactive-vm-contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGoalPlan } from '../extension/lib/goal-plan.js';

const TARGET = { deviceId: 'device-test', tabId: 7, documentGeneration: 'doc-gen-1' };
const BUDGETS = { astNodes: 256, astDepth: 12, browserCommandLeavesPerRun: 4 };

test('a well-formed plan keeps the caller identity and gains nothing', () => {
  const result = compileGoalPlan(JSON.stringify({ root: { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 } } }), { target: TARGET, budgets: BUDGETS });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.program.tenantId, 'caller');
  assert.equal(result.program.target.tabId, 7);
  assert.deepEqual(result.program.budgets, BUDGETS);
  assert.equal(result.program.root.method, 'page.read');
});

test('a reply that is not JSON is refused, not guessed at', () => {
  const result = compileGoalPlan('Sure! Here is the plan: click the button.', { target: TARGET, budgets: BUDGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_NOT_JSON');
});

test('a plan without a root node is refused', () => {
  const result = compileGoalPlan('{"note":"nothing to do"}', { target: TARGET, budgets: BUDGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_MISSING_ROOT');
});

test('a model cannot choose who it runs as, or where it runs', () => {
  for (const owned of ['tenantId', 'goalId', 'target', 'budgets']) {
    const reply = JSON.stringify({
      [owned]: owned === 'tenantId' || owned === 'goalId' ? 'someone-else' : TARGET,
      root: { type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } }
    });
    const result = compileGoalPlan(reply, { target: TARGET, budgets: BUDGETS });
    assert.equal(result.ok, false, `${owned} was accepted`);
    assert.equal(result.code, 'PLAN_SETS_OWNED_FIELD');
  }
});

test('a method outside the primitive allowlist never reaches the device', () => {
  const result = compileGoalPlan(JSON.stringify({
    root: { type: 'COMMAND', method: 'Runtime.evaluate', arguments: {} }
  }), { target: TARGET, budgets: BUDGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_METHOD_NOT_ALLOWED');
});

test('a plan with more browser commands than the budget allows is refused', () => {
  const root = {
    type: 'SEQUENCE',
    children: Array.from({ length: 5 }, () => ({ type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 } }))
  };
  const result = compileGoalPlan(JSON.stringify({ root }), { target: TARGET, budgets: BUDGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_TOO_MANY_COMMANDS');
});

test('a plan nested past the depth budget is refused instead of walked', () => {
  let root = { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 } };
  for (let i = 0; i < 12; i += 1) root = { type: 'SEQUENCE', children: [root] };
  const result = compileGoalPlan(JSON.stringify({ root }), { target: TARGET, budgets: BUDGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_TOO_DEEP');
});

test('a plan inside a plan cannot smuggle a second root', () => {
  const result = compileGoalPlan(JSON.stringify({
    root: {
      type: 'SEQUENCE',
      children: [{ type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, root: { type: 'RETURN', valueSpec: { op: 'CONST', value: 0 } } }]
    }
  }), { target: TARGET, budgets: BUDGETS });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_SETS_OWNED_FIELD');
});