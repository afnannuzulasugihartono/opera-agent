// @last-edited: 2026-10-08 UTC+7.
// @title: vm-program-intake.test — Test.
// @state: locks that a sealed VM-true program passes the VM validator unchanged.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGoalPlan } from '../extension/lib/goal-plan.js';
import { advanceCollectVm, createCollectVm, validateCollectProgram } from '../lib/reactive-vm-collect.js';
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

function smallBudgets() {
  return { ...fullBudgets(), collectionItemsPerBinding: 10, bindings: 2 };
}

function metaEntry(fingerprint) {
  return {
    method: 'page.read',
    logicalNowMs: 1,
    provenance: { tenantId: 'caller', deviceId: 'opera', tabId: 1 },
    observationKind: 'DIRECT_OBSERVATION',
    scopeKind: 'LOADED_DOM',
    boundaryStable: true,
    dependencyFingerprint: fingerprint,
    dependencyKinds: ['ENTITY_SET']
  };
}

async function collectProgram() {
  const replyCollect = JSON.stringify({
    root: {
      type: 'SEQUENCE',
      children: [
        { type: 'COLLECT', source: { op: 'PATH', path: ['pre'] }, projection: ['a'], destination: 'col', maxItems: 5 }
      ]
    }
  });
  const compiled = compileGoalPlan(replyCollect, { target: { deviceId: 'opera', tabId: 1 }, budgets: smallBudgets() });
  assert.equal(compiled.ok, true, JSON.stringify(compiled).slice(0, 300));
  const program = { ...compiled.program, tenantId: 'caller', budgets: smallBudgets() };
  program.programDigest = await digestCanonical(program);
  return program;
}

test('bindings and observation metadata share one budget: disjoint seeds are refused', async () => {
  const program = await collectProgram();
  const fingerprint = `sha256:${'1'.repeat(64)}`;
  try {
    await createCollectVm(program, {
      runId: 'run-1',
      tenantId: 'caller',
      goalRevision: 1,
      logicalNowMs: 1,
      initialBindings: { k1: 1, k2: 2 },
      initialObservationMeta: { m1: metaEntry(fingerprint), m2: metaEntry(fingerprint) }
    });
  } catch (error) {
    assert.equal(error.code, 'BINDING_BUDGET_EXCEEDED');
    return;
  }
  assert.fail('disjoint seeds holding 2N entries against a budget of N must be refused');
});

test('bindings and observation metadata share one budget: overlapping seeds pass', async () => {
  const program = await collectProgram();
  const fingerprint = `sha256:${'1'.repeat(64)}`;
  const state = await createCollectVm(program, {
    runId: 'run-1',
    tenantId: 'caller',
    goalRevision: 1,
    logicalNowMs: 1,
    initialBindings: { pre: [{ a: 1 }] },
    initialObservationMeta: { pre: metaEntry(fingerprint) }
  });
  assert.deepEqual(Object.keys(state.observationMeta), ['pre']);
});

test('a resumed checkpoint with disjoint bindings and metadata is refused', async () => {
  const program = await collectProgram();
  const fingerprint = `sha256:${'1'.repeat(64)}`;
  const state = await createCollectVm(program, {
    runId: 'run-1',
    tenantId: 'caller',
    goalRevision: 1,
    logicalNowMs: 1,
    initialBindings: { pre: [{ a: 1 }] },
    initialObservationMeta: { pre: metaEntry(fingerprint) }
  });
  const tampered = JSON.parse(JSON.stringify(state));
  tampered.bindings.k2 = 2;
  tampered.observationMeta.extra = metaEntry(fingerprint);
  try {
    await advanceCollectVm(program, tampered, { logicalNowMs: 2 });
  } catch (error) {
    assert.equal(error.code, 'BINDING_BUDGET_EXCEEDED');
    return;
  }
  assert.fail('a resumed checkpoint holding 2N entries against a budget of N must be refused');
});
