// @last-edited: 2026-10-05 00:20 UTC+7.
// @title: goal-plan-request — the prompt that asks a model for a device-executed plan.
// @state: The prompt names the allowlist, the refusal path and the page facts, and bounds its own size.
// @dependencies: test, assert, goal-plan, reactive-vm-contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanRequest } from '../lib/goal-plan.js';
import { ALLOWED_METHODS } from '../extension/lib/protocol.js';

const PAGE = {
  url: 'https://www.youtube.com/results?search_query=kucing',
  elements: [
    { ref: 'oa_a_1', role: 'button', label: 'Search', actionable: true },
    { ref: 'oa_a_2', role: 'link', label: 'Subscribe', actionable: true }
  ]
};

test('the prompt lists every primitive the model may use', () => {
  const request = buildPlanRequest('subscribe to the first channel', { page: PAGE });
  for (const method of ALLOWED_METHODS) {
    assert.ok(request.system.includes(method), `${method} is missing from the prompt`);
  }
});

test('the prompt names children as the only SEQUENCE child key', () => {
  const request = buildPlanRequest('click Search', { page: PAGE });
  assert.ok(request.system.includes('A SEQUENCE node carries its steps in "children" (never "steps"): {"type":"SEQUENCE","children":[<node>, ...]}.'), 'SEQUENCE child key is not pinned to children');
});

test('the prompt tells the model the fields it may never set', () => {
  const request = buildPlanRequest('click Search', { page: PAGE });
  for (const owned of ['tenantId', 'goalId', 'target', 'budgets']) {
    assert.match(request.system, new RegExp(owned), `${owned} is not named as caller-owned`);
  }
});

test('the prompt offers a way to refuse rather than guess', () => {
  const request = buildPlanRequest('book a flight to Tokyo', { page: PAGE });
  assert.match(request.system, /refuse/i);
  assert.match(request.system, /"root":\s*null/);
});

test('the prompt carries the observed page, not the whole page', () => {
  const request = buildPlanRequest('click Search', { page: { ...PAGE, elements: Array.from({ length: 500 }, () => ({ ref: 'r', role: 'link', label: 'x' })) } });
  assert.ok(request.user.length < 8000, `prompt grew to ${request.user.length} characters`);
  assert.match(request.user, /click Search/);
});

test('a goal longer than the bound is refused before any prompt is built', () => {
  const result = buildPlanRequest('x'.repeat(5000), { page: PAGE });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'GOAL_TOO_LONG');
});

test('an empty goal is refused rather than turned into a guess', () => {
  const result = buildPlanRequest('   ', { page: PAGE });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'GOAL_EMPTY');
});

test('the model may return a reason, and the refusal carries it', async () => {
  const { compileGoalPlan } = await import('../lib/goal-plan.js');
  const result = compileGoalPlan('{"root": null, "reason": "no primitive can book a flight"}', {
    target: { deviceId: 'd', tabId: 1, documentGeneration: 'g' },
    budgets: { astDepth: 12, browserCommandLeavesPerRun: 4 }
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /no primitive can book a flight/);
});