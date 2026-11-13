// @last-edited: 2026-11-09 UTC+7.
// @title: bridge-plan-gate.test — refuse who cannot pay, name the plan when refusing, and let the firm through.
// @state: paused plans cannot connect, the quota refuses at the last command, the firm-only page keeps the firm, and everything else passes.
// @dependencies: node:test, strict, ../hosted/functions/opera-agent-bridge/plan-gate.ts, ../hosted/functions/_shared/plans.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PLANS } from '../hosted/functions/_shared/plans.js';
import {
  capabilityAllowed,
  gateVerdict,
  handshakeVerdict,
  planIsActive,
  quotaAllowance
} from '../hosted/functions/opera-agent-bridge/plan-gate.ts';

const pilot = { plan: 'plan.pilot', status: 'active', dailyQuota: 200, usedToday: 0 };
const firm = { plan: 'plan.firm', status: 'active', dailyQuota: 5000, usedToday: 0 };

test('an account with no active plan cannot connect, and the refusal names the plan', () => {
  assert.equal(planIsActive('paused'), false);
  const paused = { ...pilot, status: 'paused' };
  const verdict = handshakeVerdict(paused);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'PLAN_LIMIT_REACHED');
  assert.match(verdict.message, /plan.pilot/);
  assert.equal(handshakeVerdict(pilot).ok, true);
});

test('the daily quota refuses at the command that breaks it, and names the plan', () => {
  const atLimit = { ...pilot, usedToday: PLANS['plan.pilot'].dailyQuota };
  const verdict = gateVerdict(atLimit, { method: 'page.read', params: {} });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'PLAN_LIMIT_REACHED');
  assert.match(verdict.message, /200/);
  const oneBefore = quotaAllowance('plan.pilot', PLANS['plan.pilot'].dailyQuota - 1);
  assert.equal(oneBefore.ok, true);
});

test('the whole-page map is the firm only, and says so', () => {
  const refusal = capabilityAllowed('plan.pilot', 'page.read', { view: 'map', all: true });
  assert.equal(refusal.ok, false);
  assert.equal(refusal.feature, 'all');
  assert.equal(capabilityAllowed('plan.firm', 'page.read', { view: 'map', all: true }).ok, true);
  assert.equal(capabilityAllowed('plan.pilot', 'page.read', { view: 'map' }).ok, true, 'and the default page read stays free');
});

test('statement delivery is the firm only', () => {
  assert.equal(capabilityAllowed('plan.pilot', 'statement.download', {}).ok, false);
  assert.equal(capabilityAllowed('plan.firm', 'statement.download', {}).ok, true);
  assert.equal(capabilityAllowed('plan.pilot', 'statement.manifest', {}).ok, false);
  assert.equal(capabilityAllowed('plan.pilot', 'page.read', {}).ok, true, 'and a plain command passes on both plans');
});

test('the gate verdict on a bad day is a refusal, on a good day a pass', () => {
  const bad = gateVerdict({ ...firm, usedToday: 5000, status: 'active' }, { method: 'page.read', params: { view: 'map', all: true } });
  assert.equal(bad.ok, false);
  const good = gateVerdict(firm, { method: 'page.read', params: { view: 'map', all: true } });
  assert.equal(good.ok, true);
  assert.equal(good.quota, 5000);
});
