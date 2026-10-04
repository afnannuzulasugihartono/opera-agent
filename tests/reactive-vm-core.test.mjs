// Last edited: 2026-10-04 17:52. Title: reactive-vm-core.test — Test. Now: fix 7B focused test syntax.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { canonicalJson, digestCanonical } from '../lib/goal-ledger.js';
import {
  ReactiveVmError,
  advanceReactiveVm,
  createReactiveVm,
  evaluateReactiveExpression,
  validateReactiveProgram,
} from '../lib/reactive-vm.js';

const TERMINAL = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);

const budgets = Object.freeze({
  serializedProgramBytes: 131072,
  astNodes: 256,
  astDepth: 12,
  controlFlowDepth: 4,
  executedNodesPerRun: 1000,
  browserCommandLeavesPerRun: 200,
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
  runDeadlineMs: 300000,
});

async function makeProgram(root, programId = 'vm-7b-program', overrides = {}) {
  const program = {
    schemaVersion: 'OA_REACTIVE_VM_V1',
    programId,
    tenantId: 'tenant-test',
    goalId: 'goal-test',
    goalRevision: 1,
    target: { deviceId: 'device-test', tabId: 7, documentGeneration: 'doc-gen-1' },
    budgets: { ...budgets },
    root,
    programDigest: '',
    ...overrides,
  };
  const { programDigest: _ignored, ...digestBody } = program;
  program.programDigest = await digestCanonical(digestBody);
  return program;
}

function options(runId = 'run-test', initialBindings = {}) {
  return {
    runId,
    tenantId: 'tenant-test',
    goalRevision: 1,
    logicalNowMs: 1000,
    deadlineAtMs: 301000,
    initialBindings,
  };
}

async function runNoIo(program, vmOptions = options()) {
  let state = await createReactiveVm(program, vmOptions);
  const transitions = [];
  for (let index = 0; index < 64 && !TERMINAL.has(state.status); index += 1) {
    const advanced = await advanceReactiveVm(program, state, { logicalNowMs: 1001 + index });
    state = advanced.state;
    transitions.push(advanced.transition);
  }
  return { state, transitions };
}

async function stateWaitingForEffect(program, runId = 'effect-run') {
  let state = await createReactiveVm(program, options(runId));
  let advanced = await advanceReactiveVm(program, state, { logicalNowMs: 1001 });
  state = advanced.state;
  if (advanced.transition.kind !== 'EFFECT_REQUEST') {
    advanced = await advanceReactiveVm(program, state, { logicalNowMs: 1002 });
    state = advanced.state;
  }
  assert.equal(advanced.transition.kind, 'EFFECT_REQUEST');
  return { state, request: advanced.transition.request };
}

function assertVmError(code, fn) {
  return assert.rejects(fn, (error) => error instanceof ReactiveVmError && error.code === code);
}

test('7B deterministic SEQUENCE/IF/ASSERT/RETURN replay is byte-identical', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      {
        type: 'IF',
        predicate: { op: 'EQ', args: [{ op: 'PATH', path: ['enabled'] }, { op: 'CONST', value: true }] },
        then: { type: 'ASSERT', predicate: { op: 'GTE', args: [{ op: 'PATH', path: ['count'] }, { op: 'CONST', value: 2 }] }, onFailure: 'FAIL' },
        else: { type: 'SUSPEND', reason: 'UNEXPECTED_STATE', contextSpec: { code: 'disabled' } },
      },
      { type: 'RETURN', valueSpec: { op: 'COUNT', arg: { op: 'PATH', path: ['items'] } } },
    ],
  });

  const first = await runNoIo(program, options('deterministic-run', { enabled: true, count: 2, items: ['a', 'b', 'c'] }));
  const second = await runNoIo(program, options('deterministic-run', { enabled: true, count: 2, items: ['a', 'b', 'c'] }));

  assert.equal(first.state.status, 'RETURNED');
  assert.equal(first.state.result, 3);
  assert.equal(first.state.resultDigest, second.state.resultDigest);
  assert.equal(canonicalJson(first.transitions), canonicalJson(second.transitions));
  assert.equal(canonicalJson(first.state), canonicalJson(second.state));
});

test('7B expression grammar is closed, typed, and prototype-safe', () => {
  const bindings = {
    n: 3,
    label: 'ready',
    values: ['a', 'b', 'c'],
    obj: { x: 1, y: 2 },
  };
  assert.equal(evaluateReactiveExpression({ op: 'EQ', args: [{ op: 'PATH', path: ['n'] }, { op: 'CONST', value: 3 }] }, bindings), true);
  assert.equal(evaluateReactiveExpression({ op: 'NE', args: [{ op: 'CONST', value: 1 }, { op: 'CONST', value: 2 }, { op: 'CONST', value: 3 }] }, bindings), true);
  assert.equal(evaluateReactiveExpression({ op: 'LT', args: [{ op: 'CONST', value: 1 }, { op: 'CONST', value: 2 }, { op: 'CONST', value: 3 }] }, bindings), true);
  assert.equal(evaluateReactiveExpression({ op: 'IN', args: [{ op: 'CONST', value: 'b' }, { op: 'PATH', path: ['values'] }] }, bindings), true);
  assert.equal(evaluateReactiveExpression({ op: 'COUNT', arg: { op: 'PATH', path: ['obj'] } }, bindings), 2);
  assert.equal(evaluateReactiveExpression({ op: 'AND', args: [{ op: 'CONST', value: true }, { op: 'NOT', arg: { op: 'CONST', value: false } }] }, bindings), true);
  assert.throws(
    () => evaluateReactiveExpression({ op: 'PATH', path: ['__proto__', 'polluted'] }, bindings),
    (error) => error instanceof ReactiveVmError && error.code === 'UNKNOWN_EXPRESSION',
  );
});

test('7B command leaves only yield read-only effects and bind verified results', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' },
      { type: 'ASSERT', predicate: { op: 'EQ', args: [{ op: 'PATH', path: ['read1', 'tabId'] }, { op: 'CONST', value: 7 }] }, onFailure: 'SUSPEND' },
      { type: 'RETURN', valueSpec: { op: 'PATH', path: ['read1', 'tabId'] } },
    ],
  }, 'effect-program');

  const { state: waiting, request } = await stateWaitingForEffect(program);
  assert.equal(waiting.pendingEffect.requestDigest, request.requestDigest);
  assert.equal(request.method, 'page.read');
  assert.equal(request.target.tabId, 7);

  const accepted = await advanceReactiveVm(program, waiting, {
    logicalNowMs: 1003,
    effectResult: {
      requestDigest: request.requestDigest,
      method: request.method,
      ok: true,
      provenance: {
        tenantId: 'tenant-test',
        deviceId: 'device-test',
        tabId: 7,
        documentGeneration: 'doc-gen-1',
      },
      value: { tabId: 7, semanticRevision: 2 },
    },
  });
  assert.equal(accepted.transition.kind, 'EFFECT_ACCEPTED');
  assert.equal(accepted.state.bindings.read1.tabId, 7);

  let state = accepted.state;
  while (!TERMINAL.has(state.status)) state = (await advanceReactiveVm(program, state, { logicalNowMs: 1004 })).state;
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, 7);
});

test('7B forged or stale effect results fail closed before binding', async () => {
  const program = await makeProgram({ type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' }, 'forged-effect');

  for (const [code, mutate] of [
    ['INVALID_SEMANTICS', (result) => { result.requestDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CROSS_TENANT', (result) => { result.provenance.tenantId = 'other-tenant'; }],
    ['CROSS_DEVICE', (result) => { result.provenance.deviceId = 'other-device'; }],
    ['CROSS_TAB', (result) => { result.provenance.tabId = 8; }],
    ['STALE_DOCUMENT', (result) => { result.provenance.documentGeneration = 'other-doc'; }],
  ]) {
    const { state, request } = await stateWaitingForEffect(program, `forged-${code}`);
    const effectResult = {
      requestDigest: request.requestDigest,
      method: request.method,
      ok: true,
      provenance: {
        tenantId: 'tenant-test',
        deviceId: 'device-test',
        tabId: 7,
        documentGeneration: 'doc-gen-1',
      },
      value: { tabId: 7 },
    };
    mutate(effectResult);
    await assertVmError(code, () => advanceReactiveVm(program, state, { logicalNowMs: 1003, effectResult }));
    assert.equal(Object.hasOwn(state.bindings, 'read1'), false);
  }
});

test('7B cancellation and deadline gates run at every instruction boundary including yielded effects', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
      { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' },
      { type: 'RETURN', valueSpec: { op: 'CONST', value: 'done' } },
    ],
  }, 'cancel-program');

  let state = await createReactiveVm(program, options('cancel-source'));
  const boundaryStates = [state];
  state = (await advanceReactiveVm(program, state, { logicalNowMs: 1001 })).state;
  boundaryStates.push(state);
  state = (await advanceReactiveVm(program, state, { logicalNowMs: 1002 })).state;
  boundaryStates.push(state);
  state = (await advanceReactiveVm(program, state, { logicalNowMs: 1003 })).state;
  boundaryStates.push(state);

  for (const [index, boundary] of boundaryStates.entries()) {
    const cancelled = await advanceReactiveVm(program, boundary, { logicalNowMs: 1004 + index, cancelled: true });
    assert.equal(cancelled.state.status, 'CANCELLED', `boundary ${index}`);
  }

  const expiring = await createReactiveVm(program, {
    ...options('deadline-run'),
    deadlineAtMs: 1002,
  });
  const first = await advanceReactiveVm(program, expiring, { logicalNowMs: 1001 });
  const expired = await advanceReactiveVm(program, first.state, { logicalNowMs: 1002 });
  assert.equal(expired.state.status, 'EXPIRED');
});

test('7B malformed state, sensitive values, disallowed commands, and 7C opcodes are rejected', async () => {
  const base = await makeProgram({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } }, 'malformed-state');
  const state = await createReactiveVm(base, options('state-run'));

  const badCursor = structuredClone(state);
  badCursor.cursorPath = ['root', 'children', 999];
  await assertVmError('INVALID_SEMANTICS', () => advanceReactiveVm(base, badCursor, { logicalNowMs: 1001 }));

  const staleGoal = structuredClone(state);
  staleGoal.goalRevision = 2;
  await assertVmError('STALE_GOAL_REVISION', () => advanceReactiveVm(base, staleGoal, { logicalNowMs: 1001 }));

  const sensitive = await makeProgram({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } }, 'sensitive');
  sensitive.root = { type: 'COMMAND', method: 'page.read', arguments: { accessToken: 'not-allowed' }, resultBinding: 'x' };
  const { programDigest: _ignored, ...body } = sensitive;
  sensitive.programDigest = await digestCanonical(body);
  await assertVmError('SENSITIVE_VALUE', () => validateReactiveProgram(sensitive));

  const disallowed = await makeProgram({ type: 'COMMAND', method: 'tabs.navigate', arguments: { tabId: 7 }, resultBinding: 'x' }, 'navigate');
  await assertVmError('DISALLOWED_COMMAND', () => validateReactiveProgram(disallowed));

  const loop = await makeProgram({ type: 'LOOP', maxIterations: 2, body: { type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } } }, 'later-loop');
  await validateReactiveProgram(loop);
  await assertVmError('INVALID_SEMANTICS', () => createReactiveVm(loop, options('later-loop-run')));
});

test('7B runtime counters stop at declared node, command, binding, and result budgets', async () => {
  const nodeProgram = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
      { type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } },
    ],
  }, 'runtime-node-budget');
  const nodeState = structuredClone(await createReactiveVm(nodeProgram, options('node-budget-run')));
  nodeState.counters.executedNodes = nodeProgram.budgets.executedNodesPerRun;
  const nodeLimited = await advanceReactiveVm(nodeProgram, nodeState, { logicalNowMs: 1001 });
  assert.equal(nodeLimited.state.status, 'LIMIT_REACHED');
  assert.equal(nodeLimited.state.suspension.reason, 'LIMIT_REACHED');

  const commandProgram = await makeProgram({ type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'r' }, 'runtime-command-budget');
  const commandState = structuredClone(await createReactiveVm(commandProgram, options('command-budget-run')));
  commandState.counters.commandLeaves = commandProgram.budgets.browserCommandLeavesPerRun;
  const commandLimited = await advanceReactiveVm(commandProgram, commandState, { logicalNowMs: 1001 });
  assert.equal(commandLimited.state.status, 'LIMIT_REACHED');

  const bindingProgram = await makeProgram({ type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'newBinding' }, 'runtime-binding-budget');
  const fullBindings = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`b${index}`, index]));
  const { state: waiting, request } = await stateWaitingForEffect(bindingProgram, 'binding-budget-run');
  const waitingWithBindings = structuredClone(waiting);
  waitingWithBindings.bindings = fullBindings;
  const bindingLimited = await advanceReactiveVm(bindingProgram, waitingWithBindings, {
    logicalNowMs: 1003,
    effectResult: {
      requestDigest: request.requestDigest,
      method: request.method,
      ok: true,
      provenance: {
        tenantId: 'tenant-test',
        deviceId: 'device-test',
        tabId: 7,
        documentGeneration: 'doc-gen-1',
      },
      value: { tabId: 7 },
    },
  });
  assert.equal(bindingLimited.state.status, 'LIMIT_REACHED');

  const outputProgram = await makeProgram({ type: 'RETURN', valueSpec: { op: 'PATH', path: ['large'] } }, 'output-budget', {
    budgets: { ...budgets, returnedResultBytes: 64 },
  });
  const { programDigest: _unused, ...outputBody } = outputProgram;
  outputProgram.programDigest = await digestCanonical(outputBody);
  const outputState = await createReactiveVm(outputProgram, options('output-run', { large: 'x'.repeat(100) }));
  await assertVmError('OUTPUT_TOO_LARGE', () => advanceReactiveVm(outputProgram, outputState, { logicalNowMs: 1001 }));
});

test('7B validates 10,000 generated bounded programs without budget escape', async () => {
  let seed = 0x7b1f00d;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };

  for (let index = 0; index < 10000; index += 1) {
    const width = (next() % 4) + 1;
    const children = [];
    for (let child = 0; child < width; child += 1) {
      const value = next() % 1000;
      children.push({
        type: 'IF',
        predicate: { op: 'GTE', args: [{ op: 'CONST', value }, { op: 'CONST', value: 0 }] },
        then: { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
        else: { type: 'SUSPEND', reason: 'UNEXPECTED_STATE', contextSpec: { code: 'unreachable' } },
      });
    }
    children.push({ type: 'RETURN', valueSpec: { op: 'CONST', value: index } });
    const program = await makeProgram({ type: 'SEQUENCE', children }, `generated-${index}`);
    const validated = await validateReactiveProgram(program);
    assert.ok(validated.root.children.length <= 5);
    assert.ok(validated.budgets.executedNodesPerRun <= 1000);
    assert.ok(validated.budgets.browserCommandLeavesPerRun <= 200);
  }
});

test('7B 1,000 non-I/O transitions stay below the 10 ms p95 target', async (t) => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
      { type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } },
    ],
  }, 'latency-program');

  const samples = [];
  for (let index = 0; index < 1000; index += 1) {
    const state = await createReactiveVm(program, options(`latency-${index}`));
    const started = performance.now();
    const transition = await advanceReactiveVm(program, state, { logicalNowMs: 1001 });
    samples.push(performance.now() - started);
    assert.equal(transition.transition.kind, 'CONTINUE');
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  t.diagnostic(`Checkpoint 7B non-I/O transition p95=${p95.toFixed(4)} ms over 1000 transitions`);
  assert.ok(p95 < 10, `p95 ${p95.toFixed(4)} ms must remain below 10 ms`);
});

test('7B core is environment-neutral and performs no browser/network/database work', () => {
  const source = fs.readFileSync(new URL('../lib/reactive-vm.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:globalThis\.(?:fetch|WebSocket|chrome|browser)|Deno\.serve|process\.env|createClient\s*\()/);
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  assert.match(source, /EFFECT_REQUEST/);
});
