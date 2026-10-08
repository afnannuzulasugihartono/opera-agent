// @last-edited: 2026-10-08 UTC+7.
// @title: vm-program-intake.test — Test.
// @state: locks that a sealed VM-true program passes the VM validator unchanged.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGoalPlan } from '../extension/lib/goal-plan.js';
import { validateCollectProgram } from '../lib/reactive-vm-collect.js';
import { digestCanonical } from '../lib/goal-ledger.js';

const reply = JSON.stringify({
  root: {
    type: 'SEQUENCE',
    children: [
      { type: 'COMMAND', method: 'page.find', arguments: { text: 'Skip' }, resultBinding: 'hit' },
      { type: 'COMMAND', method: 'page.read', arguments: {}, resultBinding: 'text' }
    ]
  }
});

function fullBudgets() {
  return {
    serializedProgramBytes: 4096,
    astNodes: 256,
    astDepth: 12,
    controlFlowDepth: 4,
    executedNodesPerRun: 1000,
    browserCommandLeavesPerRun: 12,
    iterationsPerLoop: 50,
    totalIterationsPerRun: 250,
    waitEventTimeoutMs: 15000,
    cumulativeWaitMs: 60000,
    retryAttemptsPerNode: 3,
    collectionItemsPerBinding: 1000,
    bindings: 64,
    persistedCheckpointBytes: 131072,
    returnedResultBytes: 131072,
    executionSliceMs: 20000,
    runDeadlineMs: 60000
  };
}

test('a sealed VM-true program passes the VM validator unchanged', async () => {
  const target = { deviceId: 'opera', tabId: 1 };
  const compiled = compileGoalPlan(reply, { target, budgets: fullBudgets() });
  assert.equal(compiled.ok, true, JSON.stringify(compiled).slice(0, 300));
  const program = { ...compiled.program, tenantId: 'caller', budgets: fullBudgets() };
  program.programDigest = await digestCanonical(program);
  const accepted = await validateCollectProgram(program);
  assert.ok(accepted, 'VM validator must accept sealed VM-true programs as-is');
});

test('a non-allowlisted method never reaches the VM validator', () => {
  const bad = JSON.stringify({ root: { type: 'COMMAND', method: 'page.evil', arguments: {} } });
  const refused = compileGoalPlan(bad, { target: { deviceId: 'opera', tabId: 1 }, budgets: {} });
  assert.equal(refused.ok, false);
  assert.match(refused.code, /METHOD_NOT_ALLOWED/);
});
