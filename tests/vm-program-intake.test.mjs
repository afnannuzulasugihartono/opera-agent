// @last-edited: 2026-10-21 UTC+7.
// @title: vm-program-intake.test — a sealed program passes the validator unchanged.
// @state: the seal, the validation, and the claim that the round trip changes nothing.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGoalPlan } from '../extension/lib/goal-plan.js';
import {
  advanceCollectVm,
  createCollectVm,
  validateCollectProgram
} from '../lib/reactive-vm-collect.js';
import { digestCanonical } from '../supabase/functions/_shared/goal-ledger.js';

const reply = JSON.stringify({
  root: {
    type: 'SEQUENCE',
    children: [
      {
        type: 'COMMAND',
        method: 'page.find',
        arguments: { text: 'Skip' },
        resultBinding: 'hit'
      },
      {
        type: 'COMMAND',
        method: 'page.read',
        arguments: {},
        resultBinding: 'text'
      }
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
  const target = {
    deviceId: 'opera',
    tabId: 1
  };
  const compiled = compileGoalPlan(reply, {
    target,
    budgets: fullBudgets()
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled).slice(0, 300));
  const program = {
    ...compiled.program,
    tenantId: 'caller',
    budgets: fullBudgets()
  };
  program.programDigest = await digestCanonical(program);
  const accepted = await validateCollectProgram(program);
  assert.ok(accepted, 'VM validator must accept sealed VM-true programs as-is');
});

test('a non-allowlisted method never reaches the VM validator', () => {
  const bad = JSON.stringify({ root: {
    type: 'COMMAND',
    method: 'page.evil',
    arguments: {}
  } });
  const refused = compileGoalPlan(bad, {
    target: {
      deviceId: 'opera',
      tabId: 1
    },
    budgets: {}
  });
  assert.equal(refused.ok, false);
  assert.match(refused.code, /METHOD_NOT_ALLOWED/);
});

function smallBudgets() {
  return {
    ...fullBudgets(),
    collectionItemsPerBinding: 10,
    bindings: 2
  };
}

function metaEntry(fingerprint) {
  return {
    method: 'page.read',
    logicalNowMs: 1,
    provenance: {
      tenantId: 'caller',
      deviceId: 'opera',
      tabId: 1
    },
    observationKind: 'DIRECT_OBSERVATION',
    scopeKind: 'LOADED_DOM',
    boundaryStable: true,
    dependencyFingerprint: fingerprint,
    dependencyKinds: ['ENTITY_SET']
  };
}

async function commandProgram() {
  const replyCommand = JSON.stringify({
    root: {
      type: 'SEQUENCE',
      children: [
        {
          type: 'COMMAND',
          method: 'page.read',
          arguments: {},
          resultBinding: 'text'
        }
      ]
    }
  });
  const compiled = compileGoalPlan(replyCommand, {
    target: {
      deviceId: 'opera',
      tabId: 1
    },
    budgets: smallBudgets()
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled).slice(0, 300));
  const program = {
    ...compiled.program,
    tenantId: 'caller',
    budgets: smallBudgets()
  };
  program.programDigest = await digestCanonical(program);
  return program;
}

async function acceptAtFullTerminal() {
  const program = await commandProgram();
  const created = await createCollectVm(program, {
    runId: 'run-terminal-1',
    tenantId: 'caller',
    goalRevision: 1,
    logicalNowMs: 1,
    initialBindings: {
      a: 1,
      b: 2
    }
  });
  const first = await advanceCollectVm(program, created, { logicalNowMs: 2 });
  assert.equal(first.state.status, 'RUNNING');
  const awaiting = await advanceCollectVm(program, first.state, { logicalNowMs: 3 });
  assert.equal(awaiting.transition.kind, 'EFFECT_REQUEST');
  const pending = awaiting.state.pendingEffect;
  assert.ok(pending && pending.resultBinding === 'text');
  const accepted = await advanceCollectVm(program, awaiting.state, {
    logicalNowMs: 4,
    effectResult: {
      requestDigest: pending.requestDigest,
      method: 'page.read',
      ok: true,
      provenance: {
        tenantId: 'caller',
        deviceId: 'opera',
        tabId: 1
      },
      value: { text: 'hello' }
    }
  });
  return {
    program,
    terminal: accepted.state
  };
}

test('a single N+1 terminal artifact from effect-accept-at-full is accepted', async () => {
  const {
    program,
    terminal
  } = await acceptAtFullTerminal();
  assert.equal(terminal.status, 'LIMIT_REACHED');
  const union = new Set([
    ...Object.keys(terminal.bindings),
    ...Object.keys(terminal.observationMeta)
  ]);
  assert.equal(union.size, program.budgets.bindings + 1);
});

test('advancing a terminal checkpoint is refused: no second terminal', async () => {
  const {
    program,
    terminal
  } = await acceptAtFullTerminal();
  try {
    await advanceCollectVm(program, terminal, { logicalNowMs: 5 });
  } catch (error) {
    assert.equal(error.code, 'INVALID_SEMANTICS');
    assert.match(error.message, /cannot advance/);
    return;
  }
  assert.fail('advancing a terminal checkpoint must be refused so a run holds at most one terminal');
});
async function collectProgram() {
  const replyCollect = JSON.stringify({
    root: {
      type: 'SEQUENCE',
      children: [
        {
          type: 'COLLECT',
          source: {
            op: 'PATH',
            path: ['pre']
          },
          projection: ['a'],
          destination: 'col',
          maxItems: 5
        }
      ]
    }
  });
  const compiled = compileGoalPlan(replyCollect, {
    target: {
      deviceId: 'opera',
      tabId: 1
    },
    budgets: smallBudgets()
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled).slice(0, 300));
  const program = {
    ...compiled.program,
    tenantId: 'caller',
    budgets: smallBudgets()
  };
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
      initialBindings: {
        k1: 1,
        k2: 2
      },
      initialObservationMeta: {
        m1: metaEntry(fingerprint),
        m2: metaEntry(fingerprint)
      }
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
