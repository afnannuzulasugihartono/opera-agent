// @last-edited: 2026-10-04 11:10 UTC.
// @title: reactive-vm-7c — vm-7c — Shared pure module.
// @context: Shared pure module, server and extension.
// @state: remove five dead exports and generalize the dead-export guard.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: goal-ledger, reactive-vm.

import { canonicalJson, digestCanonical } from './goal-ledger.js';
import {
  ReactiveVmError,
  evaluateReactiveExpression,
  validateReactiveProgram,
} from './reactive-vm.js';

const STATE_VERSION = 'OA_REACTIVE_VM_STATE_7C_V1';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const TERMINAL_STATUSES = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const STATE_STATUSES = new Set(['READY', 'RUNNING', ...TERMINAL_STATUSES]);
const EXECUTABLE_7C_NODES = new Set([
  'SEQUENCE', 'IF', 'LOOP', 'UNTIL', 'WAIT_EVENT', 'ASSERT', 'RETRY', 'RETURN', 'COMMAND', 'SUSPEND',
]);
const READ_ONLY_METHODS = new Set([
  'browser.ping', 'browser.burst', 'tabs.list', 'tabs.get', 'tabs.find',
  'page.read', 'page.query', 'page.find', 'page.collect_links', 'page.capture',
  'page.wait_for', 'media.state',
]);
const WAIT_METHODS = new Set([
  'page.read', 'page.query', 'page.find', 'page.collect_links', 'page.capture',
  'page.wait_for', 'media.state',
]);
const TAB_SCOPED_METHODS = new Set([
  'browser.burst', 'tabs.get', 'page.read', 'page.query', 'page.find',
  'page.collect_links', 'page.capture', 'page.wait_for', 'media.state',
]);
const DOCUMENT_SCOPED_METHODS = new Set([
  'browser.burst', 'page.read', 'page.query', 'page.find', 'page.collect_links',
  'page.capture', 'page.wait_for', 'media.state',
]);
const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|payment.?data|pairing.?code|signing.?key)/i;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9_-]{20,})/;

const TRANSIENT_ERRORS = new Set([
  'TIMEOUT', 'NETWORK_ERROR', 'NETWORK_DISCONNECTED', 'CONNECTION_RESET',
  'TEMPORARY_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'TRANSIENT', 'RETRYABLE',
]);
const AMBIGUOUS_ERRORS = new Set([
  'AMBIGUOUS_COMPLETION', 'UNKNOWN_COMPLETION', 'ACTION_AMBIGUOUS',
]);
const AUTHORITY_ERRORS = new Set([
  'AUTHORIZATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'MISSING_AUTHORITY',
]);
const STALE_ERRORS = new Set(['STALE_TARGET', 'STALE_DOCUMENT']);
const INVALID_ERRORS = new Set(['INVALID_INPUT', 'INVALID_ARGUMENT', 'INVALID_SCHEMA']);
const CONTRADICTION_ERRORS = new Set(['CONTRADICTION']);

export { ReactiveVmError };

function fail(code, message, details) {
  throw new ReactiveVmError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlainObject(value, path, code = 'INVALID_SEMANTICS') {
  if (!isPlainObject(value)) fail(code, `${path} must be a plain object.`);
}

function assertExactKeys(value, required, optional, path, code = 'INVALID_SEMANTICS') {
  assertPlainObject(value, path, code);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${path}.${key} is not allowed.`);
  }
  for (const key of required) {
    if (!(key in value)) fail(code, `${path}.${key} is required.`);
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function assertSafeInteger(value, path, min, max, code = 'INVALID_SEMANTICS') {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code, `${path} is outside its bounds.`);
}

function assertId(value, path) {
  if (typeof value !== 'string' || value.length < 1 || byteLength(value) > 128) {
    fail('INVALID_SEMANTICS', `${path} must be a bounded string.`);
  }
}

function cloneJson(value, path = '$') {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail('INVALID_SEMANTICS', `${path} must be acyclic canonical JSON data.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertNoSensitive(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('SENSITIVE_VALUE', `${path} contains a secret-like value.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('INVALID_SEMANTICS', `${path} contains a cycle.`);
  seen.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, child] of entries) {
    if (!Array.isArray(value) && SECRET_FIELD.test(key)) fail('SENSITIVE_VALUE', `${path}.${key} is a forbidden sensitive field.`);
    assertNoSensitive(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function assertBindings(bindings, maximum, path = 'bindings') {
  assertPlainObject(bindings, path);
  const keys = Object.keys(bindings);
  if (keys.length > maximum) fail('BINDING_BUDGET_EXCEEDED', `${path} exceeds the binding budget.`);
  for (const key of keys) {
    if (!SAFE_SEGMENT.test(key) || FORBIDDEN_PATH_SEGMENTS.has(key)) fail('INVALID_SEMANTICS', `${path}.${key} is invalid.`);
  }
  assertNoSensitive(bindings, path);
  cloneJson(bindings, path);
}

function nodeAtPath(program, path) {
  if (!Array.isArray(path) || path.length < 1 || path[0] !== 'root') fail('INVALID_SEMANTICS', 'VM cursor path is invalid.');
  let current = program;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || !Number.isSafeInteger(segment) || segment < 0 || segment >= current.length) {
        fail('INVALID_SEMANTICS', 'VM cursor index is invalid.');
      }
      current = current[segment];
    } else {
      if (typeof segment !== 'string' || FORBIDDEN_PATH_SEGMENTS.has(segment)
          || !Object.prototype.hasOwnProperty.call(current, segment)) {
        fail('INVALID_SEMANTICS', 'VM cursor segment is invalid.');
      }
      current = current[segment];
    }
  }
  if (!isPlainObject(current) || typeof current.type !== 'string') fail('INVALID_SEMANTICS', 'VM cursor does not reference an instruction.');
  return current;
}

function addAnalysis(left, right) {
  return {
    commands: left.commands + right.commands,
    iterations: left.iterations + right.iterations,
  };
}

function scaleAnalysis(value, multiplier) {
  return {
    commands: value.commands * multiplier,
    iterations: value.iterations * multiplier,
  };
}

function analyze7CNode(node, budgets, path = 'program.root') {
  if (!EXECUTABLE_7C_NODES.has(node.type)) {
    fail('INVALID_SEMANTICS', `${node.type} is frozen by 7A but is not executable in Checkpoint 7C.`);
  }

  if (node.type === 'COMMAND') return { commands: 1, iterations: 0 };

  if (node.type === 'WAIT_EVENT') {
    if (node.timeoutMs > budgets.waitEventTimeoutMs) {
      fail('WAIT_BUDGET_EXCEEDED', `${path}.timeoutMs exceeds the declared wait-event budget.`);
    }
    const polls = Math.ceil(node.timeoutMs / node.intervalMs);
    return { commands: polls, iterations: 0 };
  }

  if (node.type === 'SEQUENCE') {
    return node.children.reduce(
      (total, child, index) => addAnalysis(total, analyze7CNode(child, budgets, `${path}.children[${index}]`)),
      { commands: 0, iterations: 0 },
    );
  }

  if (node.type === 'IF') {
    const yes = analyze7CNode(node.then, budgets, `${path}.then`);
    const no = node.else ? analyze7CNode(node.else, budgets, `${path}.else`) : { commands: 0, iterations: 0 };
    return {
      commands: Math.max(yes.commands, no.commands),
      iterations: Math.max(yes.iterations, no.iterations),
    };
  }

  if (node.type === 'LOOP' || node.type === 'UNTIL') {
    if (node.maxIterations > budgets.iterationsPerLoop) {
      fail('ITERATION_BUDGET_EXCEEDED', `${path}.maxIterations exceeds the declared per-loop budget.`);
    }
    const body = scaleAnalysis(analyze7CNode(node.body, budgets, `${path}.body`), node.maxIterations);
    body.iterations += node.maxIterations;
    return body;
  }

  if (node.type === 'RETRY') {
    if (node.policy.attempts > budgets.retryAttemptsPerNode) {
      fail('RETRY_BUDGET_EXCEEDED', `${path}.policy.attempts exceeds the declared retry budget.`);
    }
    return scaleAnalysis(analyze7CNode(node.body, budgets, `${path}.body`), node.policy.attempts);
  }

  return { commands: 0, iterations: 0 };
}

export async function validateReactiveProgram7C(programInput) {
  const program = await validateReactiveProgram(programInput);
  const analysis = analyze7CNode(program.root, program.budgets);
  if (analysis.commands > program.budgets.browserCommandLeavesPerRun) {
    fail('COMMAND_BUDGET_EXCEEDED', '7C worst-case observation command budget exceeded.');
  }
  if (analysis.iterations > program.budgets.totalIterationsPerRun) {
    fail('ITERATION_BUDGET_EXCEEDED', '7C worst-case total iteration budget exceeded.');
  }
  return program;
}

function controlVector(frames) {
  return frames
    .filter((frame) => ['LOOP', 'UNTIL', 'RETRY'].includes(frame.kind))
    .map((frame) => ({
      kind: frame.kind,
      parentPath: frame.parentPath,
      ...(frame.iteration === undefined ? {} : { iteration: frame.iteration }),
      ...(frame.attempt === undefined ? {} : { attempt: frame.attempt }),
    }));
}

function validateFrame(frame, program) {
  assertPlainObject(frame, 'state.frames[]');
  if (frame.kind === 'SEQUENCE') {
    assertExactKeys(frame, ['kind', 'parentPath', 'nextIndex'], [], 'state.frames[]');
    const parent = nodeAtPath(program, frame.parentPath);
    if (parent.type !== 'SEQUENCE') fail('INVALID_SEMANTICS', 'Sequence frame does not reference SEQUENCE.');
    assertSafeInteger(frame.nextIndex, 'state.frames[].nextIndex', 0, parent.children.length);
    return;
  }
  if (frame.kind === 'IF') {
    assertExactKeys(frame, ['kind', 'parentPath'], [], 'state.frames[]');
    if (nodeAtPath(program, frame.parentPath).type !== 'IF') fail('INVALID_SEMANTICS', 'IF frame does not reference IF.');
    return;
  }
  if (frame.kind === 'LOOP' || frame.kind === 'UNTIL') {
    assertExactKeys(frame, ['kind', 'parentPath', 'iteration'], [], 'state.frames[]');
    const parent = nodeAtPath(program, frame.parentPath);
    if (parent.type !== frame.kind) fail('INVALID_SEMANTICS', `${frame.kind} frame references the wrong node.`);
    assertSafeInteger(frame.iteration, 'state.frames[].iteration', 1, parent.maxIterations);
    return;
  }
  if (frame.kind === 'RETRY') {
    assertExactKeys(frame, ['kind', 'parentPath', 'attempt', 'notBeforeMs'], [], 'state.frames[]');
    const parent = nodeAtPath(program, frame.parentPath);
    if (parent.type !== 'RETRY') fail('INVALID_SEMANTICS', 'RETRY frame references the wrong node.');
    assertSafeInteger(frame.attempt, 'state.frames[].attempt', 1, parent.policy.attempts);
    if (frame.notBeforeMs !== null) {
      assertSafeInteger(frame.notBeforeMs, 'state.frames[].notBeforeMs', 0, Number.MAX_SAFE_INTEGER);
    }
    return;
  }
  fail('INVALID_SEMANTICS', 'Unknown VM frame kind.');
}

function validateWaitState(waitState, program) {
  if (waitState === null) return;
  assertExactKeys(
    waitState,
    ['nodePath', 'startedAtMs', 'deadlineAtMs', 'lastChargedAtMs', 'nextPollAtMs', 'polls'],
    [],
    'state.waitState',
  );
  const node = nodeAtPath(program, waitState.nodePath);
  if (node.type !== 'WAIT_EVENT') fail('INVALID_SEMANTICS', 'waitState does not reference WAIT_EVENT.');
  assertSafeInteger(waitState.startedAtMs, 'state.waitState.startedAtMs', 0, Number.MAX_SAFE_INTEGER);
  assertSafeInteger(waitState.deadlineAtMs, 'state.waitState.deadlineAtMs', waitState.startedAtMs + 1, Number.MAX_SAFE_INTEGER);
  assertSafeInteger(waitState.lastChargedAtMs, 'state.waitState.lastChargedAtMs', waitState.startedAtMs, waitState.deadlineAtMs);
  assertSafeInteger(waitState.nextPollAtMs, 'state.waitState.nextPollAtMs', waitState.startedAtMs, Number.MAX_SAFE_INTEGER);
  assertSafeInteger(waitState.polls, 'state.waitState.polls', 0, program.budgets.browserCommandLeavesPerRun);
  if (waitState.deadlineAtMs - waitState.startedAtMs !== node.timeoutMs) {
    fail('INVALID_SEMANTICS', 'waitState timeout differs from WAIT_EVENT.');
  }
}

function validatePendingEffect(pending, program, state) {
  if (pending === null) return;
  assertExactKeys(
    pending,
    ['requestDigest', 'purpose', 'method', 'arguments', 'target', 'resultBinding', 'nodePath', 'ordinal'],
    [],
    'state.pendingEffect',
  );
  if (!DIGEST_RE.test(pending.requestDigest)) fail('INVALID_SEMANTICS', 'Pending effect digest is malformed.');
  if (!['COMMAND', 'WAIT_EVENT'].includes(pending.purpose)) fail('INVALID_SEMANTICS', 'Pending effect purpose is invalid.');
  if (!READ_ONLY_METHODS.has(pending.method)) fail('INVALID_SEMANTICS', 'Pending effect method is not read-only.');
  if (canonicalJson(pending.target) !== canonicalJson(program.target)) fail('STALE_TARGET', 'Pending effect target differs from program target.');
  assertSafeInteger(pending.ordinal, 'state.pendingEffect.ordinal', 1, state.counters.commandLeaves);
  assertPlainObject(pending.arguments, 'state.pendingEffect.arguments');
  assertNoSensitive(pending.arguments, 'state.pendingEffect.arguments');

  const node = nodeAtPath(program, pending.nodePath);
  if (pending.purpose === 'COMMAND') {
    if (node.type !== 'COMMAND' || node.method !== pending.method
        || canonicalJson(node.arguments) !== canonicalJson(pending.arguments)
        || node.resultBinding !== pending.resultBinding) {
      fail('INVALID_SEMANTICS', 'Pending COMMAND does not match its program node.');
    }
  } else {
    if (node.type !== 'WAIT_EVENT' || node.observation.method !== pending.method
        || canonicalJson(node.observation.arguments) !== canonicalJson(pending.arguments)
        || pending.resultBinding !== null) {
      fail('INVALID_SEMANTICS', 'Pending WAIT_EVENT observation does not match its program node.');
    }
    if (state.waitState === null || canonicalJson(state.waitState.nodePath) !== canonicalJson(pending.nodePath)) {
      fail('INVALID_SEMANTICS', 'Pending WAIT_EVENT is missing matching waitState.');
    }
  }
}

function validateVmState(program, state) {
  assertExactKeys(
    state,
    ['schemaVersion', 'runId', 'programDigest', 'tenantId', 'goalId', 'goalRevision', 'target', 'status', 'cursorPath',
     'frames', 'bindings', 'counters', 'pendingEffect', 'waitState', 'result', 'suspension', 'resultDigest',
     'deadlineAtMs', 'lastLogicalNowMs', 'transitionIndex'],
    [],
    'state',
  );
  if (state.schemaVersion !== STATE_VERSION) fail('INVALID_SEMANTICS', 'state.schemaVersion is unsupported.');
  assertId(state.runId, 'state.runId');
  if (state.programDigest !== program.programDigest) fail('PROGRAM_DIGEST_MISMATCH', 'State program digest differs from program.');
  if (state.tenantId !== program.tenantId) fail('CROSS_TENANT', 'State tenant differs from program.');
  if (state.goalId !== program.goalId || state.goalRevision !== program.goalRevision) {
    fail('STALE_GOAL_REVISION', 'State goal revision differs from program.');
  }
  if (canonicalJson(state.target) !== canonicalJson(program.target)) fail('STALE_TARGET', 'State target differs from program.');
  if (!STATE_STATUSES.has(state.status)) fail('INVALID_SEMANTICS', 'State status is invalid.');
  if (!Array.isArray(state.frames) || state.frames.length > program.budgets.astDepth) fail('INVALID_SEMANTICS', 'State frame stack is invalid.');
  state.frames.forEach((frame) => validateFrame(frame, program));
  assertBindings(state.bindings, program.budgets.bindings, 'state.bindings');

  assertExactKeys(
    state.counters,
    ['executedNodes', 'commandLeaves', 'totalIterations', 'cumulativeWaitMs', 'retryAttempts'],
    [],
    'state.counters',
  );
  assertSafeInteger(state.counters.executedNodes, 'state.counters.executedNodes', 0, program.budgets.executedNodesPerRun);
  assertSafeInteger(state.counters.commandLeaves, 'state.counters.commandLeaves', 0, program.budgets.browserCommandLeavesPerRun);
  assertSafeInteger(state.counters.totalIterations, 'state.counters.totalIterations', 0, program.budgets.totalIterationsPerRun);
  assertSafeInteger(state.counters.cumulativeWaitMs, 'state.counters.cumulativeWaitMs', 0, program.budgets.cumulativeWaitMs);
  assertSafeInteger(state.counters.retryAttempts, 'state.counters.retryAttempts', 0, program.budgets.executedNodesPerRun);
  assertSafeInteger(state.deadlineAtMs, 'state.deadlineAtMs', 1, Number.MAX_SAFE_INTEGER);
  assertSafeInteger(state.lastLogicalNowMs, 'state.lastLogicalNowMs', 0, Number.MAX_SAFE_INTEGER);
  assertSafeInteger(state.transitionIndex, 'state.transitionIndex', 0, Number.MAX_SAFE_INTEGER);

  validateWaitState(state.waitState, program);
  validatePendingEffect(state.pendingEffect, program, state);

  if (TERMINAL_STATUSES.has(state.status)) {
    if (state.cursorPath !== null || state.pendingEffect !== null || state.waitState !== null) {
      fail('INVALID_SEMANTICS', 'Terminal state cannot retain a cursor, pending effect, or wait state.');
    }
    if (!DIGEST_RE.test(state.resultDigest || '')) fail('INVALID_SEMANTICS', 'Terminal state requires resultDigest.');
  } else {
    if (!Array.isArray(state.cursorPath)) fail('INVALID_SEMANTICS', 'Non-terminal state requires cursorPath.');
    const node = nodeAtPath(program, state.cursorPath);
    if (!EXECUTABLE_7C_NODES.has(node.type)) fail('INVALID_SEMANTICS', 'Cursor references a later-checkpoint opcode.');
    if (state.resultDigest !== null || state.result !== null || state.suspension !== null) {
      fail('INVALID_SEMANTICS', 'Non-terminal state contains terminal fields.');
    }
    if (state.waitState !== null && node.type !== 'WAIT_EVENT') fail('INVALID_SEMANTICS', 'waitState cursor must remain on WAIT_EVENT.');
  }
}

function assertHostStepInput(input) {
  assertExactKeys(input, ['logicalNowMs'], ['cancelled', 'effectResult'], 'input');
  assertSafeInteger(input.logicalNowMs, 'input.logicalNowMs', 0, Number.MAX_SAFE_INTEGER);
  if (input.cancelled !== undefined && typeof input.cancelled !== 'boolean') {
    fail('INVALID_SEMANTICS', 'input.cancelled must be boolean.');
  }
}

function effectBody(program, state, pending) {
  return {
    programDigest: program.programDigest,
    runId: state.runId,
    nodePath: pending.nodePath,
    ordinal: pending.ordinal,
    purpose: pending.purpose,
    method: pending.method,
    arguments: pending.arguments,
    target: pending.target,
    controlVector: controlVector(state.frames),
  };
}

async function assertPendingEffectDigest(program, state) {
  if (state.pendingEffect === null) return;
  const expected = await digestCanonical(effectBody(program, state, state.pendingEffect));
  if (expected !== state.pendingEffect.requestDigest) {
    fail('INVALID_SEMANTICS', 'Pending effect digest does not match current VM control state.');
  }
}

async function makeEffectRequest(program, state, { purpose, method, arguments: args, resultBinding, nodePath }) {
  const pending = {
    requestDigest: '',
    purpose,
    method,
    arguments: cloneJson(args, 'effect arguments'),
    target: cloneJson(program.target),
    resultBinding,
    nodePath: [...nodePath],
    ordinal: state.counters.commandLeaves + 1,
  };
  pending.requestDigest = await digestCanonical(effectBody(program, state, pending));
  return deepFreeze(pending);
}

function validateEffectResult(program, pending, effectResult) {
  assertExactKeys(
    effectResult,
    ['requestDigest', 'method', 'ok', 'provenance', 'value'],
    ['errorCode'],
    'input.effectResult',
  );
  if (effectResult.requestDigest !== pending.requestDigest || effectResult.method !== pending.method) {
    fail('INVALID_SEMANTICS', 'Effect result does not match the pending request.');
  }
  if (typeof effectResult.ok !== 'boolean') fail('INVALID_SEMANTICS', 'Effect result ok must be boolean.');
  assertPlainObject(effectResult.provenance, 'input.effectResult.provenance');
  const provenance = effectResult.provenance;
  if (provenance.tenantId !== program.tenantId) fail('CROSS_TENANT', 'Effect result belongs to another tenant.');
  if (provenance.deviceId !== program.target.deviceId) fail('CROSS_DEVICE', 'Effect result belongs to another device.');
  if (TAB_SCOPED_METHODS.has(pending.method) && provenance.tabId !== program.target.tabId) {
    fail('CROSS_TAB', 'Effect result belongs to another tab.');
  }
  if (DOCUMENT_SCOPED_METHODS.has(pending.method) && program.target.documentGeneration !== undefined
      && provenance.documentGeneration !== program.target.documentGeneration) {
    fail('STALE_DOCUMENT', 'Effect result belongs to another document generation.');
  }
  if (effectResult.errorCode !== undefined
      && (typeof effectResult.errorCode !== 'string' || effectResult.errorCode.length < 1 || byteLength(effectResult.errorCode) > 128)) {
    fail('INVALID_SEMANTICS', 'Effect result errorCode is invalid.');
  }
  if (!effectResult.ok && effectResult.value !== null) {
    fail('INVALID_SEMANTICS', 'Failed effects may carry only a structured errorCode and null value.');
  }
  cloneJson(effectResult.value, 'input.effectResult.value');
  assertNoSensitive(effectResult.value, 'input.effectResult.value');
  if (byteLength(canonicalJson(effectResult.value)) > program.budgets.returnedResultBytes) {
    fail('OUTPUT_TOO_LARGE', 'Effect result exceeds the declared V1 value bound.');
  }
}

function failureDisposition(errorCode = 'EFFECT_FAILED') {
  const normalized = String(errorCode).toUpperCase();
  if (TRANSIENT_ERRORS.has(normalized)) return { kind: 'TRANSIENT', reason: 'UNEXPECTED_STATE' };
  if (AMBIGUOUS_ERRORS.has(normalized)) return { kind: 'AMBIGUOUS', reason: 'UNEXPECTED_STATE' };
  if (AUTHORITY_ERRORS.has(normalized)) return { kind: 'AUTHORITY', reason: 'MISSING_AUTHORITY' };
  if (STALE_ERRORS.has(normalized)) return { kind: 'STALE', reason: 'STALE_TARGET' };
  if (CONTRADICTION_ERRORS.has(normalized)) return { kind: 'CONTRADICTION', reason: 'CONTRADICTION' };
  if (INVALID_ERRORS.has(normalized)) return { kind: 'INVALID', reason: 'UNEXPECTED_STATE' };
  return { kind: 'OTHER', reason: 'UNEXPECTED_STATE' };
}

async function terminalState(program, state, status, { result = null, suspension = null } = {}) {
  const next = {
    ...state,
    status,
    cursorPath: null,
    frames: [],
    pendingEffect: null,
    waitState: null,
    result: cloneJson(result, 'result'),
    suspension: suspension === null ? null : cloneJson(suspension, 'suspension'),
    transitionIndex: state.transitionIndex,
  };
  const terminalPayload = { status: next.status, result: next.result, suspension: next.suspension };
  assertNoSensitive(terminalPayload, 'terminal');
  if (byteLength(canonicalJson(terminalPayload)) > program.budgets.returnedResultBytes) {
    fail('OUTPUT_TOO_LARGE', 'Terminal result exceeds the declared V1 result bound.');
  }
  next.resultDigest = await digestCanonical(terminalPayload);
  return deepFreeze(next);
}

async function terminalTransition(program, state, status, details, increment = true) {
  const base = increment ? { ...state, transitionIndex: state.transitionIndex + 1 } : state;
  const next = await terminalState(program, base, status, details);
  return deepFreeze({
    state: next,
    transition: deepFreeze({
      kind: 'TERMINAL',
      status: next.status,
      resultDigest: next.resultDigest,
      transitionIndex: next.transitionIndex,
    }),
  });
}

function limitContext(limit, context = {}) {
  return { reason: 'LIMIT_REACHED', context: { limit, ...context } };
}

function findRetryFrameIndex(frames) {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].kind === 'RETRY') return index;
  }
  return -1;
}

function activeRetryDelay(frames) {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame.kind === 'RETRY' && frame.notBeforeMs !== null) return { index, frame };
  }
  return null;
}

function startIteration(program, state, frame, bodyPath) {
  if (state.counters.totalIterations >= program.budgets.totalIterationsPerRun) {
    return {
      limit: limitContext('TOTAL_ITERATIONS', {
        budget: program.budgets.totalIterationsPerRun,
        iterationsCompleted: state.counters.totalIterations,
      }),
    };
  }
  const next = cloneJson(state, 'state');
  next.counters.totalIterations += 1;
  next.frames.push(frame);
  next.cursorPath = bodyPath;
  return { state: next };
}

function completeInstruction(program, state) {
  const next = cloneJson(state, 'state');
  while (next.frames.length) {
    const frame = next.frames.pop();

    if (frame.kind === 'IF') continue;

    if (frame.kind === 'SEQUENCE') {
      const sequence = nodeAtPath(program, frame.parentPath);
      if (frame.nextIndex < sequence.children.length) {
        const childIndex = frame.nextIndex;
        frame.nextIndex += 1;
        next.frames.push(frame);
        next.cursorPath = [...frame.parentPath, 'children', childIndex];
        return { state: next, exhausted: false };
      }
      continue;
    }

    if (frame.kind === 'LOOP') {
      const loop = nodeAtPath(program, frame.parentPath);
      if (frame.iteration < loop.maxIterations) {
        if (next.counters.totalIterations >= program.budgets.totalIterationsPerRun) {
          return {
            state: next,
            limit: limitContext('TOTAL_ITERATIONS', {
              nodePath: frame.parentPath,
              budget: program.budgets.totalIterationsPerRun,
              iterationsCompleted: next.counters.totalIterations,
            }),
          };
        }
        frame.iteration += 1;
        next.counters.totalIterations += 1;
        next.frames.push(frame);
        next.cursorPath = [...frame.parentPath, 'body'];
        return { state: next, exhausted: false };
      }
      continue;
    }

    if (frame.kind === 'UNTIL') {
      const until = nodeAtPath(program, frame.parentPath);
      const met = Boolean(evaluateReactiveExpression(until.predicate, next.bindings));
      if (met) continue;
      if (frame.iteration >= until.maxIterations) {
        return {
          state: next,
          limit: limitContext('UNTIL_MAX_ITERATIONS', {
            nodePath: frame.parentPath,
            maxIterations: until.maxIterations,
            iterationsCompleted: frame.iteration,
            conditionMet: false,
          }),
        };
      }
      if (next.counters.totalIterations >= program.budgets.totalIterationsPerRun) {
        return {
          state: next,
          limit: limitContext('TOTAL_ITERATIONS', {
            nodePath: frame.parentPath,
            budget: program.budgets.totalIterationsPerRun,
            iterationsCompleted: next.counters.totalIterations,
            conditionMet: false,
          }),
        };
      }
      frame.iteration += 1;
      next.counters.totalIterations += 1;
      next.frames.push(frame);
      next.cursorPath = [...frame.parentPath, 'body'];
      return { state: next, exhausted: false };
    }

    if (frame.kind === 'RETRY') {
      continue;
    }

    fail('INVALID_SEMANTICS', 'Unknown frame encountered while completing an instruction.');
  }
  next.cursorPath = null;
  return { state: next, exhausted: true };
}

async function finishCompleted(program, state, transition) {
  const completed = completeInstruction(program, state);
  if (completed.limit) {
    return terminalTransition(program, completed.state, 'LIMIT_REACHED', {
      result: null,
      suspension: completed.limit,
    }, false);
  }
  if (completed.exhausted) {
    const terminal = await terminalState(program, completed.state, 'RETURNED', { result: null, suspension: null });
    return deepFreeze({
      state: terminal,
      transition: deepFreeze({
        ...transition,
        terminalStatus: terminal.status,
        resultDigest: terminal.resultDigest,
        transitionIndex: terminal.transitionIndex,
      }),
    });
  }
  return deepFreeze({
    state: deepFreeze(completed.state),
    transition: deepFreeze({ ...transition, transitionIndex: completed.state.transitionIndex }),
  });
}

function chargeWait(program, state, logicalNowMs) {
  if (state.waitState === null) return { state };
  const next = cloneJson(state, 'state');
  const chargedUntil = Math.min(logicalNowMs, next.waitState.deadlineAtMs);
  const delta = Math.max(0, chargedUntil - next.waitState.lastChargedAtMs);
  const cumulative = next.counters.cumulativeWaitMs + delta;
  if (cumulative > program.budgets.cumulativeWaitMs) {
    return {
      state: next,
      limit: limitContext('CUMULATIVE_WAIT', {
        budgetMs: program.budgets.cumulativeWaitMs,
        waitedMs: cumulative,
      }),
    };
  }
  next.counters.cumulativeWaitMs = cumulative;
  next.waitState.lastChargedAtMs = chargedUntil;
  return { state: next };
}

async function issueEffect(program, state, spec) {
  if (state.counters.commandLeaves >= program.budgets.browserCommandLeavesPerRun) {
    return terminalTransition(program, state, 'LIMIT_REACHED', {
      result: null,
      suspension: limitContext('BROWSER_COMMAND_LEAVES', {
        budget: program.budgets.browserCommandLeavesPerRun,
      }),
    }, false);
  }
  const next = cloneJson(state, 'state');
  const request = await makeEffectRequest(program, next, spec);
  next.counters.commandLeaves += 1;
  next.pendingEffect = cloneJson(request);
  if (spec.purpose === 'WAIT_EVENT') next.waitState.polls += 1;
  return deepFreeze({
    state: deepFreeze(next),
    transition: deepFreeze({ kind: 'EFFECT_REQUEST', request, transitionIndex: next.transitionIndex }),
  });
}

async function issueWaitObservation(program, state) {
  const node = nodeAtPath(program, state.cursorPath);
  return issueEffect(program, state, {
    purpose: 'WAIT_EVENT',
    method: node.observation.method,
    arguments: node.observation.arguments,
    resultBinding: null,
    nodePath: state.cursorPath,
  });
}

function waitTimeoutSuspension(node, state) {
  return limitContext('WAIT_EVENT_TIMEOUT', {
    nodePath: state.waitState.nodePath,
    timeoutMs: node.timeoutMs,
    elapsedMs: Math.max(0, state.waitState.lastChargedAtMs - state.waitState.startedAtMs),
    polls: state.waitState.polls,
    conditionMet: false,
  });
}

async function handleWaitEffectResult(program, state, input) {
  const node = nodeAtPath(program, state.pendingEffect.nodePath);
  const disposition = input.effectResult.ok ? null : failureDisposition(input.effectResult.errorCode);

  if (!input.effectResult.ok && disposition.kind !== 'TRANSIENT') {
    return terminalTransition(program, state, 'SUSPENDED', {
      result: null,
      suspension: {
        reason: disposition.reason,
        context: {
          method: state.pendingEffect.method,
          requestDigest: state.pendingEffect.requestDigest,
          errorCode: input.effectResult.errorCode ?? 'EFFECT_FAILED',
          disposition: disposition.kind,
        },
      },
    });
  }

  const next = cloneJson(state, 'state');
  next.pendingEffect = null;
  next.status = 'RUNNING';
  next.transitionIndex += 1;

  if (input.effectResult.ok) {
    const predicateBindings = { ...next.bindings, observation: cloneJson(input.effectResult.value, 'wait observation') };
    const matched = Boolean(evaluateReactiveExpression(node.predicate, predicateBindings));
    if (matched) {
      next.waitState = null;
      return finishCompleted(program, next, {
        kind: 'WAIT_EVENT_MATCHED',
        polls: state.waitState.polls,
      });
    }
  }

  if (input.logicalNowMs >= next.waitState.deadlineAtMs) {
    return terminalTransition(program, next, 'LIMIT_REACHED', {
      result: null,
      suspension: waitTimeoutSuspension(node, next),
    }, false);
  }

  next.waitState.nextPollAtMs = Math.min(
    next.waitState.deadlineAtMs,
    input.logicalNowMs + node.intervalMs,
  );
  return deepFreeze({
    state: deepFreeze(next),
    transition: deepFreeze({
      kind: input.effectResult.ok ? 'WAIT_EVENT_OBSERVED' : 'WAIT_EVENT_RETRY',
      matched: false,
      ...(input.effectResult.ok ? {} : { errorCode: input.effectResult.errorCode ?? 'EFFECT_FAILED' }),
      nextPollAtMs: next.waitState.nextPollAtMs,
      transitionIndex: next.transitionIndex,
    }),
  });
}

async function handleCommandFailure(program, state, input) {
  const disposition = failureDisposition(input.effectResult.errorCode);
  const retryIndex = findRetryFrameIndex(state.frames);

  if (disposition.kind === 'TRANSIENT' && retryIndex >= 0) {
    const retryFrame = state.frames[retryIndex];
    const retryNode = nodeAtPath(program, retryFrame.parentPath);

    if (retryFrame.attempt >= retryNode.policy.attempts) {
      return terminalTransition(program, state, 'LIMIT_REACHED', {
        result: null,
        suspension: limitContext('RETRY_ATTEMPTS', {
          nodePath: retryFrame.parentPath,
          attempts: retryNode.policy.attempts,
          lastErrorCode: input.effectResult.errorCode ?? 'EFFECT_FAILED',
          retryable: true,
        }),
      });
    }

    const next = cloneJson(state, 'state');
    next.frames = next.frames.slice(0, retryIndex + 1);
    const frame = next.frames[retryIndex];
    frame.attempt += 1;
    frame.notBeforeMs = input.logicalNowMs + retryNode.policy.delayMs;
    next.counters.retryAttempts += 1;
    next.pendingEffect = null;
    next.waitState = null;
    next.cursorPath = [...frame.parentPath, 'body'];
    next.status = 'RUNNING';
    next.transitionIndex += 1;
    return deepFreeze({
      state: deepFreeze(next),
      transition: deepFreeze({
        kind: 'RETRY_SCHEDULED',
        attempt: frame.attempt,
        maxAttempts: retryNode.policy.attempts,
        notBeforeMs: frame.notBeforeMs,
        errorCode: input.effectResult.errorCode ?? 'EFFECT_FAILED',
        transitionIndex: next.transitionIndex,
      }),
    });
  }

  return terminalTransition(program, state, 'SUSPENDED', {
    result: null,
    suspension: {
      reason: disposition.reason,
      context: {
        method: state.pendingEffect.method,
        requestDigest: state.pendingEffect.requestDigest,
        errorCode: input.effectResult.errorCode ?? 'EFFECT_FAILED',
        disposition: disposition.kind,
      },
    },
  });
}

async function handleCommandEffectResult(program, state, input) {
  if (!input.effectResult.ok) return handleCommandFailure(program, state, input);

  const next = cloneJson(state, 'state');
  const binding = next.pendingEffect.resultBinding;
  if (!Object.prototype.hasOwnProperty.call(next.bindings, binding)
      && Object.keys(next.bindings).length >= program.budgets.bindings) {
    return terminalTransition(program, next, 'LIMIT_REACHED', {
      result: null,
      suspension: limitContext('BINDINGS', { budget: program.budgets.bindings }),
    });
  }
  next.bindings[binding] = cloneJson(input.effectResult.value, 'effect value');
  next.pendingEffect = null;
  next.status = 'RUNNING';
  next.transitionIndex += 1;
  return finishCompleted(program, next, {
    kind: 'EFFECT_ACCEPTED',
    requestDigest: state.pendingEffect.requestDigest,
  });
}

export async function createReactiveVm7C(programInput, options) {
  const program = await validateReactiveProgram7C(programInput);
  assertExactKeys(options, ['runId', 'tenantId', 'goalRevision', 'logicalNowMs'], ['deadlineAtMs', 'initialBindings'], 'options');
  assertId(options.runId, 'options.runId');
  if (options.tenantId !== program.tenantId) fail('CROSS_TENANT', 'Authoritative tenant differs from program tenant.');
  if (options.goalRevision !== program.goalRevision) fail('STALE_GOAL_REVISION', 'Authoritative goal revision differs from program.');
  assertSafeInteger(options.logicalNowMs, 'options.logicalNowMs', 0, Number.MAX_SAFE_INTEGER);

  const deadlineAtMs = options.deadlineAtMs ?? (options.logicalNowMs + program.budgets.runDeadlineMs);
  assertSafeInteger(deadlineAtMs, 'options.deadlineAtMs', options.logicalNowMs + 1, Number.MAX_SAFE_INTEGER);
  if (deadlineAtMs - options.logicalNowMs > program.budgets.runDeadlineMs) {
    fail('INVALID_SEMANTICS', 'Run deadline exceeds the frozen V1 budget.');
  }

  const bindings = cloneJson(options.initialBindings ?? {}, 'options.initialBindings');
  assertBindings(bindings, program.budgets.bindings, 'options.initialBindings');

  return deepFreeze({
    schemaVersion: STATE_VERSION,
    runId: options.runId,
    programDigest: program.programDigest,
    tenantId: program.tenantId,
    goalId: program.goalId,
    goalRevision: program.goalRevision,
    target: cloneJson(program.target),
    status: 'READY',
    cursorPath: ['root'],
    frames: [],
    bindings,
    counters: {
      executedNodes: 0,
      commandLeaves: 0,
      totalIterations: 0,
      cumulativeWaitMs: 0,
      retryAttempts: 0,
    },
    pendingEffect: null,
    waitState: null,
    result: null,
    suspension: null,
    resultDigest: null,
    deadlineAtMs,
    lastLogicalNowMs: options.logicalNowMs,
    transitionIndex: 0,
  });
}

export async function advanceReactiveVm7C(programInput, stateInput, input) {
  const program = await validateReactiveProgram7C(programInput);
  let state = cloneJson(stateInput, 'state');
  validateVmState(program, state);
  await assertPendingEffectDigest(program, state);
  assertHostStepInput(input);

  if (TERMINAL_STATUSES.has(state.status)) fail('INVALID_SEMANTICS', 'A terminal VM state cannot advance.');
  if (input.logicalNowMs < state.lastLogicalNowMs) {
    fail('INVALID_SEMANTICS', 'logicalNowMs must be monotonic for Checkpoint 7C.');
  }

  state.lastLogicalNowMs = input.logicalNowMs;

  if (input.cancelled === true) {
    return terminalTransition(program, state, 'CANCELLED', { suspension: null, result: null });
  }
  if (input.logicalNowMs >= state.deadlineAtMs) {
    return terminalTransition(program, state, 'EXPIRED', { suspension: null, result: null });
  }

  const charged = chargeWait(program, state, input.logicalNowMs);
  state = charged.state;
  if (charged.limit) {
    return terminalTransition(program, state, 'LIMIT_REACHED', { result: null, suspension: charged.limit });
  }

  if (state.pendingEffect !== null) {
    if (input.effectResult === undefined) {
      return deepFreeze({
        state: deepFreeze(state),
        transition: deepFreeze({
          kind: 'AWAITING_EFFECT',
          requestDigest: state.pendingEffect.requestDigest,
          transitionIndex: state.transitionIndex,
        }),
      });
    }
    validateEffectResult(program, state.pendingEffect, input.effectResult);
    if (state.pendingEffect.purpose === 'WAIT_EVENT') {
      return handleWaitEffectResult(program, state, input);
    }
    return handleCommandEffectResult(program, state, input);
  }

  if (input.effectResult !== undefined) fail('INVALID_SEMANTICS', 'No effect result is expected.');

  const retryDelay = activeRetryDelay(state.frames);
  if (retryDelay !== null) {
    if (input.logicalNowMs < retryDelay.frame.notBeforeMs) {
      return deepFreeze({
        state: deepFreeze(state),
        transition: deepFreeze({
          kind: 'WAITING_RETRY',
          attempt: retryDelay.frame.attempt,
          notBeforeMs: retryDelay.frame.notBeforeMs,
          transitionIndex: state.transitionIndex,
        }),
      });
    }
    state.frames[retryDelay.index].notBeforeMs = null;
  }

  if (state.waitState !== null) {
    const waitNode = nodeAtPath(program, state.waitState.nodePath);
    if (input.logicalNowMs >= state.waitState.deadlineAtMs) {
      return terminalTransition(program, state, 'LIMIT_REACHED', {
        result: null,
        suspension: waitTimeoutSuspension(waitNode, state),
      });
    }
    if (input.logicalNowMs < state.waitState.nextPollAtMs) {
      return deepFreeze({
        state: deepFreeze(state),
        transition: deepFreeze({
          kind: 'WAITING_EVENT',
          nextPollAtMs: state.waitState.nextPollAtMs,
          deadlineAtMs: state.waitState.deadlineAtMs,
          polls: state.waitState.polls,
          transitionIndex: state.transitionIndex,
        }),
      });
    }
    return issueWaitObservation(program, state);
  }

  const node = nodeAtPath(program, state.cursorPath);
  if (state.counters.executedNodes >= program.budgets.executedNodesPerRun) {
    return terminalTransition(program, state, 'LIMIT_REACHED', {
      result: null,
      suspension: limitContext('EXECUTED_NODES', { budget: program.budgets.executedNodesPerRun }),
    });
  }

  const next = cloneJson(state, 'state');
  next.status = 'RUNNING';
  next.counters.executedNodes += 1;
  next.transitionIndex += 1;

  if (node.type === 'SEQUENCE') {
    if (node.children.length === 0) {
      return finishCompleted(program, next, { kind: 'CONTINUE', instruction: 'SEQUENCE' });
    }
    next.frames.push({ kind: 'SEQUENCE', parentPath: [...state.cursorPath], nextIndex: 1 });
    next.cursorPath = [...state.cursorPath, 'children', 0];
    return deepFreeze({
      state: deepFreeze(next),
      transition: deepFreeze({ kind: 'CONTINUE', instruction: 'SEQUENCE', transitionIndex: next.transitionIndex }),
    });
  }

  if (node.type === 'IF') {
    const selected = Boolean(evaluateReactiveExpression(node.predicate, next.bindings));
    if (!selected && node.else === undefined) {
      return finishCompleted(program, next, { kind: 'CONTINUE', instruction: 'IF', selected: 'NONE' });
    }
    next.frames.push({ kind: 'IF', parentPath: [...state.cursorPath] });
    next.cursorPath = [...state.cursorPath, selected ? 'then' : 'else'];
    return deepFreeze({
      state: deepFreeze(next),
      transition: deepFreeze({
        kind: 'CONTINUE',
        instruction: 'IF',
        selected: selected ? 'THEN' : 'ELSE',
        transitionIndex: next.transitionIndex,
      }),
    });
  }

  if (node.type === 'LOOP') {
    const started = startIteration(program, next, {
      kind: 'LOOP',
      parentPath: [...state.cursorPath],
      iteration: 1,
    }, [...state.cursorPath, 'body']);
    if (started.limit) {
      return terminalTransition(program, next, 'LIMIT_REACHED', { result: null, suspension: started.limit }, false);
    }
    return deepFreeze({
      state: deepFreeze(started.state),
      transition: deepFreeze({
        kind: 'CONTINUE',
        instruction: 'LOOP',
        iteration: 1,
        maxIterations: node.maxIterations,
        transitionIndex: started.state.transitionIndex,
      }),
    });
  }

  if (node.type === 'UNTIL') {
    const met = Boolean(evaluateReactiveExpression(node.predicate, next.bindings));
    if (met) {
      return finishCompleted(program, next, {
        kind: 'CONTINUE',
        instruction: 'UNTIL',
        conditionMet: true,
        iterations: 0,
      });
    }
    const started = startIteration(program, next, {
      kind: 'UNTIL',
      parentPath: [...state.cursorPath],
      iteration: 1,
    }, [...state.cursorPath, 'body']);
    if (started.limit) {
      return terminalTransition(program, next, 'LIMIT_REACHED', { result: null, suspension: started.limit }, false);
    }
    return deepFreeze({
      state: deepFreeze(started.state),
      transition: deepFreeze({
        kind: 'CONTINUE',
        instruction: 'UNTIL',
        conditionMet: false,
        iteration: 1,
        maxIterations: node.maxIterations,
        transitionIndex: started.state.transitionIndex,
      }),
    });
  }

  if (node.type === 'WAIT_EVENT') {
    next.waitState = {
      nodePath: [...state.cursorPath],
      startedAtMs: input.logicalNowMs,
      deadlineAtMs: input.logicalNowMs + node.timeoutMs,
      lastChargedAtMs: input.logicalNowMs,
      nextPollAtMs: input.logicalNowMs,
      polls: 0,
    };
    return issueWaitObservation(program, next);
  }

  if (node.type === 'ASSERT') {
    const passed = Boolean(evaluateReactiveExpression(node.predicate, next.bindings));
    if (!passed) {
      if (node.onFailure === 'SUSPEND') {
        return terminalTransition(program, next, 'SUSPENDED', {
          result: null,
          suspension: { reason: 'ASSERTION_FAILED', context: { nodePath: state.cursorPath } },
        }, false);
      }
      return terminalTransition(program, next, 'FAILED', { result: null, suspension: null }, false);
    }
    return finishCompleted(program, next, {
      kind: 'CONTINUE',
      instruction: 'ASSERT',
      passed: true,
    });
  }

  if (node.type === 'RETRY') {
    next.frames.push({
      kind: 'RETRY',
      parentPath: [...state.cursorPath],
      attempt: 1,
      notBeforeMs: null,
    });
    next.counters.retryAttempts += 1;
    next.cursorPath = [...state.cursorPath, 'body'];
    return deepFreeze({
      state: deepFreeze(next),
      transition: deepFreeze({
        kind: 'CONTINUE',
        instruction: 'RETRY',
        attempt: 1,
        maxAttempts: node.policy.attempts,
        transitionIndex: next.transitionIndex,
      }),
    });
  }

  if (node.type === 'RETURN') {
    const result = evaluateReactiveExpression(node.valueSpec, next.bindings);
    assertNoSensitive(result, 'return value');
    const terminal = await terminalState(program, next, 'RETURNED', { result, suspension: null });
    return deepFreeze({
      state: terminal,
      transition: deepFreeze({
        kind: 'TERMINAL',
        status: 'RETURNED',
        resultDigest: terminal.resultDigest,
        transitionIndex: terminal.transitionIndex,
      }),
    });
  }

  if (node.type === 'SUSPEND') {
    const terminal = await terminalState(program, next, 'SUSPENDED', {
      result: null,
      suspension: { reason: node.reason, context: cloneJson(node.contextSpec, 'suspend context') },
    });
    return deepFreeze({
      state: terminal,
      transition: deepFreeze({
        kind: 'TERMINAL',
        status: 'SUSPENDED',
        resultDigest: terminal.resultDigest,
        transitionIndex: terminal.transitionIndex,
      }),
    });
  }

  if (node.type === 'COMMAND') {
    return issueEffect(program, next, {
      purpose: 'COMMAND',
      method: node.method,
      arguments: node.arguments,
      resultBinding: node.resultBinding,
      nodePath: state.cursorPath,
    });
  }

  fail('INVALID_SEMANTICS', `${node.type} is not executable in Checkpoint 7C.`);
}
