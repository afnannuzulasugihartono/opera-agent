import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { digestCanonical } from '../lib/goal-ledger.js';
import {
  ReactiveVmError,
  advanceReactiveVm as advance7B,
  createReactiveVm as create7B,
  validateReactiveProgram,
} from '../lib/reactive-vm.js';
import {
  advanceReactiveVm7C,
  createReactiveVm7C,
  validateReactiveProgram7C,
} from '../lib/reactive-vm-7c.js';

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

async function makeProgram(root, programId = 'vm-7c-program', overrides = {}) {
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
  const { programDigest: _ignored, ...body } = program;
  program.programDigest = await digestCanonical(body);
  return program;
}

function options(runId = 'run-7c', initialBindings = {}) {
  return {
    runId,
    tenantId: 'tenant-test',
    goalRevision: 1,
    logicalNowMs: 1000,
    deadlineAtMs: 301000,
    initialBindings,
  };
}

function effectResult(request, { ok = true, value = null, errorCode } = {}) {
  return {
    requestDigest: request.requestDigest,
    method: request.method,
    ok,
    provenance: {
      tenantId: 'tenant-test',
      deviceId: 'device-test',
      tabId: 7,
      documentGeneration: 'doc-gen-1',
    },
    value,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

async function assertVmError(code, fn) {
  await assert.rejects(fn, (error) => error instanceof ReactiveVmError && error.code === code);
}

async function advanceUntilEffect(program, state, logicalNowMs) {
  let current = state;
  let now = logicalNowMs;
  for (let index = 0; index < 16; index += 1) {
    const advanced = await advanceReactiveVm7C(program, current, { logicalNowMs: now });
    current = advanced.state;
    if (advanced.transition.kind === 'EFFECT_REQUEST') return { ...advanced, logicalNowMs: now };
    if (TERMINAL.has(current.status)) throw new Error(`terminal before effect: ${current.status}`);
    now += 1;
  }
  throw new Error('effect was not reached within bounded steps');
}

test('7C LOOP executes exactly its declared bound and 7B programs remain valid', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'LOOP', maxIterations: 3, body: { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' } },
      { type: 'RETURN', valueSpec: { op: 'CONST', value: 'done' } },
    ],
  }, 'loop-three');

  let state = await createReactiveVm7C(program, options('loop-three-run'));
  for (let index = 0; index < 32 && !TERMINAL.has(state.status); index += 1) {
    state = (await advanceReactiveVm7C(program, state, { logicalNowMs: 1001 + index })).state;
  }
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, 'done');
  assert.equal(state.counters.totalIterations, 3);

  const legacy = await makeProgram({ type: 'RETURN', valueSpec: { op: 'CONST', value: 7 } }, 'legacy-7b');
  assert.equal((await create7B(legacy, options('legacy-7b-run'))).status, 'READY');
  assert.equal((await createReactiveVm7C(legacy, options('legacy-7c-run'))).status, 'READY');
});

test('7C UNTIL re-evaluates typed observation bindings and reports exact exhaustion', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      {
        type: 'UNTIL',
        predicate: { op: 'EQ', args: [{ op: 'PATH', path: ['obs', 'done'] }, { op: 'CONST', value: true }] },
        maxIterations: 3,
        body: { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'obs' },
      },
      { type: 'RETURN', valueSpec: { op: 'PATH', path: ['obs', 'done'] } },
    ],
  }, 'until-observation');

  let state = await createReactiveVm7C(program, options('until-success'));
  let first = await advanceUntilEffect(program, state, 1001);
  state = (await advanceReactiveVm7C(program, first.state, {
    logicalNowMs: first.logicalNowMs + 1,
    effectResult: effectResult(first.transition.request, { value: { done: false } }),
  })).state;
  let second = await advanceUntilEffect(program, state, first.logicalNowMs + 2);
  state = (await advanceReactiveVm7C(program, second.state, {
    logicalNowMs: second.logicalNowMs + 1,
    effectResult: effectResult(second.transition.request, { value: { done: true } }),
  })).state;
  while (!TERMINAL.has(state.status)) state = (await advanceReactiveVm7C(program, state, { logicalNowMs: state.lastLogicalNowMs + 1 })).state;
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, true);
  assert.equal(state.counters.totalIterations, 2);

  const exhausted = await makeProgram({
    type: 'UNTIL',
    predicate: { op: 'CONST', value: false },
    maxIterations: 2,
    body: { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
  }, 'until-exhausted');
  let limited = await createReactiveVm7C(exhausted, options('until-exhausted-run'));
  for (let index = 0; index < 16 && !TERMINAL.has(limited.status); index += 1) {
    limited = (await advanceReactiveVm7C(exhausted, limited, { logicalNowMs: 1001 + index })).state;
  }
  assert.equal(limited.status, 'LIMIT_REACHED');
  assert.equal(limited.suspension.reason, 'LIMIT_REACHED');
  assert.equal(limited.suspension.context.limit, 'UNTIL_MAX_ITERATIONS');
  assert.equal(limited.suspension.context.maxIterations, 2);
  assert.equal(limited.suspension.context.conditionMet, false);
});

test('7C WAIT_EVENT uses bounded polling, ephemeral observation scope, and forced-clock timeout', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      {
        type: 'WAIT_EVENT',
        observation: { method: 'page.read', arguments: { tabId: 7 } },
        predicate: { op: 'EQ', args: [{ op: 'PATH', path: ['observation', 'ready'] }, { op: 'CONST', value: true }] },
        intervalMs: 100,
        timeoutMs: 300,
      },
      { type: 'RETURN', valueSpec: { op: 'CONST', value: 'ready' } },
    ],
  }, 'wait-ready');

  let state = await createReactiveVm7C(program, options('wait-ready-run'));
  const first = await advanceUntilEffect(program, state, 1001);
  assert.equal(first.transition.request.purpose, 'WAIT_EVENT');
  state = (await advanceReactiveVm7C(program, first.state, {
    logicalNowMs: 1002,
    effectResult: effectResult(first.transition.request, { value: { ready: false, text: 'untrusted data only' } }),
  })).state;
  assert.equal(Object.hasOwn(state.bindings, 'observation'), false);

  const early = await advanceReactiveVm7C(program, state, { logicalNowMs: 1050 });
  assert.equal(early.transition.kind, 'WAITING_EVENT');
  const second = await advanceReactiveVm7C(program, early.state, { logicalNowMs: 1102 });
  assert.equal(second.transition.kind, 'EFFECT_REQUEST');
  state = (await advanceReactiveVm7C(program, second.state, {
    logicalNowMs: 1103,
    effectResult: effectResult(second.transition.request, { value: { ready: true } }),
  })).state;
  while (!TERMINAL.has(state.status)) state = (await advanceReactiveVm7C(program, state, { logicalNowMs: state.lastLogicalNowMs + 1 })).state;
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, 'ready');
  assert.ok(state.counters.cumulativeWaitMs <= 300);

  let timeoutState = await createReactiveVm7C(program, options('wait-timeout-run'));
  const timeoutRequest = await advanceUntilEffect(program, timeoutState, 1001);
  timeoutState = (await advanceReactiveVm7C(program, timeoutRequest.state, {
    logicalNowMs: 1002,
    effectResult: effectResult(timeoutRequest.transition.request, { value: { ready: false } }),
  })).state;
  const timedOut = await advanceReactiveVm7C(program, timeoutState, { logicalNowMs: 1400 });
  assert.equal(timedOut.state.status, 'LIMIT_REACHED');
  assert.equal(timedOut.state.suspension.context.limit, 'WAIT_EVENT_TIMEOUT');
  assert.equal(timedOut.state.suspension.context.timeoutMs, 300);
  assert.equal(timedOut.state.suspension.context.conditionMet, false);
});

test('7C RETRY retries only structured transient observation failures', async () => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      {
        type: 'RETRY',
        policy: { attempts: 3, delayMs: 50 },
        body: { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'read1' },
      },
      { type: 'RETURN', valueSpec: { op: 'PATH', path: ['read1', 'ok'] } },
    ],
  }, 'retry-transient');

  let state = await createReactiveVm7C(program, options('retry-transient-run'));
  const first = await advanceUntilEffect(program, state, 1001);
  const scheduled = await advanceReactiveVm7C(program, first.state, {
    logicalNowMs: first.logicalNowMs + 1,
    effectResult: effectResult(first.transition.request, { ok: false, errorCode: 'TIMEOUT' }),
  });
  assert.equal(scheduled.transition.kind, 'RETRY_SCHEDULED');
  assert.equal(scheduled.transition.attempt, 2);
  const early = await advanceReactiveVm7C(program, scheduled.state, { logicalNowMs: scheduled.transition.notBeforeMs - 1 });
  assert.equal(early.transition.kind, 'WAITING_RETRY');
  const second = await advanceReactiveVm7C(program, early.state, { logicalNowMs: scheduled.transition.notBeforeMs });
  assert.equal(second.transition.kind, 'EFFECT_REQUEST');
  state = (await advanceReactiveVm7C(program, second.state, {
    logicalNowMs: scheduled.transition.notBeforeMs + 1,
    effectResult: effectResult(second.transition.request, { value: { ok: true } }),
  })).state;
  while (!TERMINAL.has(state.status)) state = (await advanceReactiveVm7C(program, state, { logicalNowMs: state.lastLogicalNowMs + 1 })).state;
  assert.equal(state.status, 'RETURNED');
  assert.equal(state.result, true);
  assert.equal(state.counters.commandLeaves, 2);
  assert.equal(state.counters.retryAttempts, 2);
});

test('7C ambiguous, authorization, stale, invalid, and contradiction failures never retry', async () => {
  const reasons = [
    ['AMBIGUOUS_COMPLETION', 'UNEXPECTED_STATE'],
    ['AUTHORIZATION_FAILED', 'MISSING_AUTHORITY'],
    ['STALE_TARGET', 'STALE_TARGET'],
    ['INVALID_INPUT', 'UNEXPECTED_STATE'],
    ['CONTRADICTION', 'CONTRADICTION'],
  ];
  for (const [errorCode, reason] of reasons) {
    const program = await makeProgram({
      type: 'RETRY',
      policy: { attempts: 3, delayMs: 1 },
      body: { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'x' },
    }, `no-retry-${errorCode}`);
    const state = await createReactiveVm7C(program, options(`no-retry-${errorCode}`));
    const waiting = await advanceUntilEffect(program, state, 1001);
    const stopped = await advanceReactiveVm7C(program, waiting.state, {
      logicalNowMs: waiting.logicalNowMs + 1,
      effectResult: effectResult(waiting.transition.request, { ok: false, errorCode }),
    });
    assert.equal(stopped.state.status, 'SUSPENDED', errorCode);
    assert.equal(stopped.state.suspension.reason, reason, errorCode);
    assert.equal(stopped.state.counters.commandLeaves, 1, errorCode);
    assert.equal(stopped.state.counters.retryAttempts, 1, errorCode);
  }
});

test('7C exhausted retry reports exact cap and never exceeds declared attempts', async () => {
  const program = await makeProgram({
    type: 'RETRY',
    policy: { attempts: 3, delayMs: 0 },
    body: { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'x' },
  }, 'retry-exhausted');
  let state = await createReactiveVm7C(program, options('retry-exhausted-run'));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const waiting = await advanceUntilEffect(program, state, state.lastLogicalNowMs + 1);
    const failed = await advanceReactiveVm7C(program, waiting.state, {
      logicalNowMs: waiting.logicalNowMs + 1,
      effectResult: effectResult(waiting.transition.request, { ok: false, errorCode: 'NETWORK_ERROR' }),
    });
    state = failed.state;
    if (attempt < 3) assert.equal(failed.transition.kind, 'RETRY_SCHEDULED');
  }
  assert.equal(state.status, 'LIMIT_REACHED');
  assert.equal(state.suspension.context.limit, 'RETRY_ATTEMPTS');
  assert.equal(state.suspension.context.attempts, 3);
  assert.equal(state.suspension.context.lastErrorCode, 'NETWORK_ERROR');
  assert.equal(state.counters.retryAttempts, 3);
  assert.equal(state.counters.commandLeaves, 3);
});

test('7C enforces declared loop/wait/retry budgets, monotonic time, and rejects 7D opcodes', async () => {
  const loop = await makeProgram({
    type: 'LOOP', maxIterations: 2,
    body: { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
  }, 'loop-declared-budget', { budgets: { ...budgets, iterationsPerLoop: 1 } });
  await assertVmError('ITERATION_BUDGET_EXCEEDED', () => validateReactiveProgram7C(loop));

  const retry = await makeProgram({
    type: 'RETRY', policy: { attempts: 2, delayMs: 0 },
    body: { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'x' },
  }, 'retry-declared-budget', { budgets: { ...budgets, retryAttemptsPerNode: 1 } });
  await assertVmError('RETRY_BUDGET_EXCEEDED', () => validateReactiveProgram7C(retry));

  const pollHeavy = await makeProgram({
    type: 'WAIT_EVENT', observation: { method: 'page.read', arguments: { tabId: 7 } },
    predicate: { op: 'CONST', value: false }, intervalMs: 50, timeoutMs: 15000,
  }, 'wait-command-budget');
  await validateReactiveProgram(pollHeavy);
  await assertVmError('COMMAND_BUDGET_EXCEEDED', () => validateReactiveProgram7C(pollHeavy));

  const clockProgram = await makeProgram({ type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } }, 'clock-backwards');
  const clockState = await createReactiveVm7C(clockProgram, options('clock-backwards-run'));
  await assertVmError('INVALID_SEMANTICS', () => advanceReactiveVm7C(clockProgram, clockState, { logicalNowMs: 999 }));

  const collect = await makeProgram({ type: 'COLLECT', source: { op: 'PATH', path: ['items'] }, projection: ['id'], destination: 'out', maxItems: 10 }, 'later-collect');
  await validateReactiveProgram(collect);
  await assertVmError('INVALID_SEMANTICS', () => createReactiveVm7C(collect, options('later-collect-run', { items: [] })));
});

test('7C cancellation wins at pending-effect, wait, and retry-delay boundaries', async () => {
  const retryProgram = await makeProgram({
    type: 'RETRY', policy: { attempts: 3, delayMs: 100 },
    body: { type: 'COMMAND', method: 'page.read', arguments: { tabId: 7 }, resultBinding: 'x' },
  }, 'cancel-retry');
  const retryState = await createReactiveVm7C(retryProgram, options('cancel-retry-run'));
  const pending = await advanceUntilEffect(retryProgram, retryState, 1001);
  const cancelledPending = await advanceReactiveVm7C(retryProgram, pending.state, { logicalNowMs: 1002, cancelled: true });
  assert.equal(cancelledPending.state.status, 'CANCELLED');

  const retryState2 = await createReactiveVm7C(retryProgram, options('cancel-delay-run'));
  const pending2 = await advanceUntilEffect(retryProgram, retryState2, 1001);
  const scheduled = await advanceReactiveVm7C(retryProgram, pending2.state, {
    logicalNowMs: 1002,
    effectResult: effectResult(pending2.transition.request, { ok: false, errorCode: 'TIMEOUT' }),
  });
  const cancelledDelay = await advanceReactiveVm7C(retryProgram, scheduled.state, { logicalNowMs: 1003, cancelled: true });
  assert.equal(cancelledDelay.state.status, 'CANCELLED');

  const waitProgram = await makeProgram({
    type: 'WAIT_EVENT', observation: { method: 'page.read', arguments: { tabId: 7 } },
    predicate: { op: 'CONST', value: false }, intervalMs: 100, timeoutMs: 300,
  }, 'cancel-wait');
  const waitState = await createReactiveVm7C(waitProgram, options('cancel-wait-run'));
  const waitPending = await advanceUntilEffect(waitProgram, waitState, 1001);
  const cancelledWait = await advanceReactiveVm7C(waitProgram, waitPending.state, { logicalNowMs: 1002, cancelled: true });
  assert.equal(cancelledWait.state.status, 'CANCELLED');
});

test('7C fuzzed bounded loops and forced clock jumps always terminate', async () => {
  let seed = 0x7c0ffee;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let index = 0; index < 1000; index += 1) {
    const maxIterations = (random() % 5) + 1;
    const kind = random() % 2 === 0 ? 'LOOP' : 'UNTIL';
    const root = kind === 'LOOP'
      ? { type: 'LOOP', maxIterations, body: { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' } }
      : { type: 'UNTIL', predicate: { op: 'CONST', value: false }, maxIterations, body: { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' } };
    const program = await makeProgram(root, `fuzz-loop-${index}`);
    let state = await createReactiveVm7C(program, options(`fuzz-run-${index}`));
    for (let step = 0; step < 32 && !TERMINAL.has(state.status); step += 1) {
      state = (await advanceReactiveVm7C(program, state, { logicalNowMs: 1001 + step })).state;
    }
    assert.ok(TERMINAL.has(state.status), `program ${index} did not terminate`);
    assert.ok(state.counters.totalIterations <= maxIterations);
  }

  for (let index = 0; index < 100; index += 1) {
    const program = await makeProgram({
      type: 'WAIT_EVENT', observation: { method: 'page.read', arguments: { tabId: 7 } },
      predicate: { op: 'CONST', value: false }, intervalMs: 100, timeoutMs: 500,
    }, `fuzz-wait-${index}`);
    let state = await createReactiveVm7C(program, options(`fuzz-wait-run-${index}`));
    const pending = await advanceUntilEffect(program, state, 1001);
    state = (await advanceReactiveVm7C(program, pending.state, {
      logicalNowMs: 1002,
      effectResult: effectResult(pending.transition.request, { value: { ready: false } }),
    })).state;
    state = (await advanceReactiveVm7C(program, state, { logicalNowMs: 2000 + index })).state;
    assert.equal(state.status, 'LIMIT_REACHED');
  }
});

test('7C ordinary 7B-compatible transition p95 regression stays below 15% on the same runner', async (t) => {
  const program = await makeProgram({
    type: 'SEQUENCE',
    children: [
      { type: 'ASSERT', predicate: { op: 'CONST', value: true }, onFailure: 'FAIL' },
      { type: 'RETURN', valueSpec: { op: 'CONST', value: 1 } },
    ],
  }, '7c-latency-compare');

  const baseline = [];
  const candidate = [];
  for (let index = 0; index < 1050; index += 1) {
    const state7B = await create7B(program, options(`latency-b-${index}`));
    const start7B = performance.now();
    await advance7B(program, state7B, { logicalNowMs: 1001 });
    const time7B = performance.now() - start7B;

    const state7C = await createReactiveVm7C(program, options(`latency-c-${index}`));
    const start7C = performance.now();
    await advanceReactiveVm7C(program, state7C, { logicalNowMs: 1001 });
    const time7C = performance.now() - start7C;
    if (index >= 50) {
      baseline.push(time7B);
      candidate.push(time7C);
    }
  }
  baseline.sort((a, b) => a - b);
  candidate.sort((a, b) => a - b);
  const p95B = baseline[Math.floor(baseline.length * 0.95)];
  const p95C = candidate[Math.floor(candidate.length * 0.95)];
  const ratio = p95C / p95B;
  t.diagnostic(`Checkpoint 7C ordinary transition p95: 7B=${p95B.toFixed(4)} ms 7C=${p95C.toFixed(4)} ms ratio=${ratio.toFixed(3)}`);
  assert.ok(ratio < 1.15, `ordinary transition regression ${(ratio * 100 - 100).toFixed(2)}% must stay below 15%`);
});

test('7C runtime layer remains pure and environment-neutral', () => {
  const source = fs.readFileSync(new URL('../lib/reactive-vm-7c.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:globalThis\.(?:fetch|WebSocket|chrome|browser)|Deno\.serve|process\.env|createClient\s*\()/);
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  assert.match(source, /WAITING_EVENT/);
  assert.match(source, /RETRY_SCHEDULED/);
});
