// @last-edited: 2026-10-21 UTC+7.
// @title: vm-program-seal.test — the sealing pre-filter holds against a later edit of the program.
// @state: the method allowlists, the budgets, and the digest the seal carries.
// @dependencies: node:test, strict, seal-vm-program, goal-ledger, reactive-vm-collect.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandFailure,
  VM_BUDGET_DEFAULTS,
  VM_BUDGET_MAXIMA,
  VM_BURST_STEP_ACTIONS,
  VM_OBSERVATION_METHODS,
  VM_PROGRAM_VERSION,
  VM_READ_ONLY_METHODS,
  sealVmProgram
} from '../supabase/functions/_shared/seal-vm-program.js';
import { digestCanonical } from '../lib/goal-ledger.js';
import { validateCollectProgram } from '../lib/reactive-vm-collect.js';

const caller = { userId: 'caller-tenant' };

function validProgram(overrides = {}) {
  return {
    schemaVersion: VM_PROGRAM_VERSION,
    programId: 'program-1',
    goalId: 'goal-1',
    goalRevision: 1,
    target: { deviceId: 'opera', tabId: 1 },
    root: {
      type: 'SEQUENCE',
      children: [
        { type: 'COMMAND', method: 'page.find', arguments: { text: 'Skip' }, resultBinding: 'hit' },
        { type: 'COMMAND', method: 'page.read', arguments: {}, resultBinding: 'text' }
      ]
    },
    budgets: {},
    tenantId: 'attacker-tenant',
    programDigest: `sha256:${'0'.repeat(64)}`,
    ...overrides
  };
}

async function refusal(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CommandFailure, `must throw CommandFailure, got ${error}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`must refuse with ${code}`);
}

test('a smuggled tenantId is overwritten with the caller', async () => {
  const sealed = await sealVmProgram(validProgram(), caller);
  assert.equal(sealed.tenantId, caller.userId);
});

test('an attacker digest is stripped and the seal matches independent recomputation', async () => {
  const sealed = await sealVmProgram(validProgram(), caller);
  assert.notEqual(sealed.programDigest, `sha256:${'0'.repeat(64)}`);
  const { programDigest, ...body } = sealed;
  assert.equal(programDigest, await digestCanonical(body));
});

test('sealed output is accepted by the real host validator', async () => {
  const sealed = await sealVmProgram(validProgram(), caller);
  assert.ok(await validateCollectProgram(sealed));
});

test('absent budgets fill from the frozen defaults, all seventeen keys', async () => {
  const sealed = await sealVmProgram(validProgram(), caller);
  assert.deepEqual(sealed.budgets, VM_BUDGET_DEFAULTS);
  assert.equal(Object.keys(sealed.budgets).length, 17);
});

test('provided budget keys are kept while the rest default', async () => {
  const sealed = await sealVmProgram(validProgram({ budgets: { runDeadlineMs: 60000 } }), caller);
  assert.equal(sealed.budgets.runDeadlineMs, 60000);
  assert.equal(sealed.budgets.astNodes, VM_BUDGET_DEFAULTS.astNodes);
});

test('a budget at its frozen maximum seals, one over is refused', async () => {
  const atMax = await sealVmProgram(
    validProgram({ budgets: { runDeadlineMs: VM_BUDGET_MAXIMA.runDeadlineMs } }),
    caller
  );
  assert.equal(atMax.budgets.runDeadlineMs, VM_BUDGET_MAXIMA.runDeadlineMs);
  await refusal(
    sealVmProgram(validProgram({ budgets: { runDeadlineMs: VM_BUDGET_MAXIMA.runDeadlineMs + 1 } }), caller),
    'OVER_LIMIT'
  );
});

test('a prototype-named budget key is refused, never silently dropped', async () => {
  await refusal(sealVmProgram(validProgram({ budgets: { toString: 1 } }), caller), 'INVALID_SCHEMA');
  await refusal(sealVmProgram(validProgram({ budgets: { noSuchBudget: 1 } }), caller), 'INVALID_SCHEMA');
});

test('a non-integer budget is refused', async () => {
  await refusal(sealVmProgram(validProgram({ budgets: { astNodes: 1.5 } }), caller), 'INVALID_SCHEMA');
  await refusal(sealVmProgram(validProgram({ budgets: { astNodes: 0 } }), caller), 'INVALID_SCHEMA');
});

test('a wrong schemaVersion is refused', async () => {
  await refusal(sealVmProgram(validProgram({ schemaVersion: 'OA_REACTIVE_VM_V0' }), caller), 'INVALID_PROGRAM');
});

test('a root carrying steps is refused; a command root without children is refused', async () => {
  await refusal(
    sealVmProgram(validProgram({ root: { type: 'COMMAND', method: 'page.read', arguments: {} } }), caller),
    'INVALID_PROGRAM'
  );
  await refusal(
    sealVmProgram(
      validProgram({ root: { type: 'SEQUENCE', children: [], steps: [] } }),
      caller
    ),
    'INVALID_PROGRAM'
  );
});

test('a write method is refused; the allowlist stays read-only', async () => {
  assert.equal(VM_READ_ONLY_METHODS.size, 12);
  assert.ok(VM_READ_ONLY_METHODS.has('page.read'));
  assert.ok(!VM_READ_ONLY_METHODS.has('page.click'));
  await refusal(
    sealVmProgram(
      validProgram({ root: { type: 'SEQUENCE', children: [{ type: 'COMMAND', method: 'page.click', arguments: {} }] } }),
      caller
    ),
    'DISALLOWED_COMMAND'
  );
});

test('a burst step outside read/find/wait is refused; the three actions seal', async () => {
  const steps = [...VM_BURST_STEP_ACTIONS].map((action) => ({ action }));
  const sealed = await sealVmProgram(
    validProgram({
      root: {
        type: 'SEQUENCE',
        children: [{ type: 'COMMAND', method: 'browser.burst', arguments: { steps } }]
      }
    }),
    caller
  );
  assert.equal(sealed.tenantId, caller.userId);
  assert.equal(Object.keys(sealed.budgets).length, 17);
  await refusal(
    sealVmProgram(
      validProgram({
        root: {
          type: 'SEQUENCE',
          children: [{ type: 'COMMAND', method: 'browser.burst', arguments: { steps: [{ action: 'click' }] } }]
        }
      }),
      caller
    ),
    'DISALLOWED_COMMAND'
  );
});

test('a wait observation outside the read-only set is refused', async () => {
  assert.ok(VM_OBSERVATION_METHODS.has('page.read'));
  assert.ok(!VM_OBSERVATION_METHODS.has('page.click'));
  await refusal(
    sealVmProgram(
      validProgram({
        root: {
          type: 'SEQUENCE',
          children: [{ type: 'WAIT_EVENT', observation: { method: 'page.click' } }]
        }
      }),
      caller
    ),
    'DISALLOWED_COMMAND'
  );
  const sealed = await sealVmProgram(
    validProgram({
      root: {
        type: 'SEQUENCE',
        children: [{ type: 'WAIT_EVENT', observation: { method: 'page.read' } }]
      }
    }),
    caller
  );
  assert.equal(sealed.tenantId, caller.userId);
});

test('a missing goalId and a non-object program are refused', async () => {
  const { goalId: _dropped, ...noGoal } = validProgram();
  await refusal(sealVmProgram(noGoal, caller), 'INVALID_PROGRAM');
  await refusal(sealVmProgram(null, caller), 'INVALID_PROGRAM');
  await refusal(sealVmProgram([validProgram()], caller), 'INVALID_PROGRAM');
});

test('a null caller is refused before any sealing work', async () => {
  await refusal(sealVmProgram(validProgram(), null), 'UNAUTHORIZED');
});
