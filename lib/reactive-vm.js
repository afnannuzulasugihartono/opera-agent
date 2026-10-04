// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: reactive-vm — vm — Shared pure module.
// @context: Shared pure module, server and extension.
// @state: remove five dead exports and generalize the dead-export guard.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: goal-ledger.

import { canonicalJson, digestCanonical } from './goal-ledger.js';

const PROGRAM_VERSION = 'OA_REACTIVE_VM_V1';
const STATE_VERSION = 'OA_REACTIVE_VM_STATE_7B_V1';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const SUPPORTED_7B_NODES = new Set(['SEQUENCE', 'IF', 'ASSERT', 'RETURN', 'COMMAND', 'SUSPEND']);
const TERMINAL_STATUSES = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const STATE_STATUSES = new Set(['READY', 'RUNNING', ...TERMINAL_STATUSES]);
const SUSPENSION_REASONS = new Set([
  'NEEDS_MODEL', 'NEEDS_USER', 'GOAL_REVISED', 'AMBIGUOUS_TARGET', 'UNEXPECTED_STATE',
  'ASSERTION_FAILED', 'MISSING_AUTHORITY', 'CONTRADICTION', 'LIMIT_REACHED', 'STALE_TARGET',
]);
const READ_ONLY_METHODS = new Set([
  'browser.ping', 'browser.burst', 'tabs.list', 'tabs.get', 'tabs.find',
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

// Not exported: this module's own budget checks are the only consumer, so an
// export would be unreachable surface. tests/r9-hygiene.test.mjs fails if it
// comes back without a caller.
const REACTIVE_VM_7B_LIMITS = Object.freeze({
  serializedProgramBytes: 131072,
  astNodes: 256,
  astDepth: 12,
  controlFlowDepth: 4,
  executedNodesPerRun: 1000,
  browserCommandLeavesPerRun: 200,
  bindings: 64,
  returnedResultBytes: 131072,
  runDeadlineMs: 300000,
});

export class ReactiveVmError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReactiveVmError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ReactiveVmError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlainObject(value, path, code = 'INVALID_SCHEMA') {
  if (!isPlainObject(value)) fail(code, `${path} must be a plain object.`);
}

function assertExactKeys(value, required, optional, path, code = 'INVALID_SCHEMA') {
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

function assertId(value, path) {
  if (typeof value !== 'string' || value.length < 1 || byteLength(value) > 128) fail('INVALID_SCHEMA', `${path} must be a bounded string.`);
}

function assertSafeInteger(value, path, min, max, code = 'INVALID_SCHEMA') {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code, `${path} is outside its bounds.`);
}

function withoutProgramDigest(program) {
  const { programDigest: _ignored, ...rest } = program;
  return rest;
}

function validatePath(path, label) {
  if (!Array.isArray(path) || path.length < 1 || path.length > 8) fail('UNKNOWN_EXPRESSION', `${label} is invalid.`);
  for (const segment of path) {
    if (typeof segment !== 'string' || !SAFE_SEGMENT.test(segment) || FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      fail('UNKNOWN_EXPRESSION', `${label} contains a forbidden segment.`);
    }
  }
  if (path[0] === 'pageText') fail('UNTRUSTED_PROGRAM_SOURCE', `${label} cannot source program authority from page text.`);
}

function validateExpression(expr, path = 'expression') {
  assertPlainObject(expr, path, 'UNKNOWN_EXPRESSION');
  const op = expr.op;
  if (op === 'CONST') {
    assertExactKeys(expr, ['op', 'value'], [], path, 'UNKNOWN_EXPRESSION');
    if (!(expr.value === null || ['string', 'boolean'].includes(typeof expr.value) || Number.isSafeInteger(expr.value))) {
      fail('UNKNOWN_EXPRESSION', `${path}.value has an unsupported type.`);
    }
    return;
  }
  if (op === 'PATH') {
    assertExactKeys(expr, ['op', 'path'], [], path, 'UNKNOWN_EXPRESSION');
    validatePath(expr.path, `${path}.path`);
    return;
  }
  if (['EQ', 'NE', 'LT', 'LTE', 'GT', 'GTE', 'AND', 'OR', 'IN'].includes(op)) {
    assertExactKeys(expr, ['op', 'args'], [], path, 'UNKNOWN_EXPRESSION');
    if (!Array.isArray(expr.args) || expr.args.length < 2 || expr.args.length > 16) fail('UNKNOWN_EXPRESSION', `${path}.args is invalid.`);
    expr.args.forEach((arg, index) => validateExpression(arg, `${path}.args[${index}]`));
    return;
  }
  if (['NOT', 'COUNT'].includes(op)) {
    assertExactKeys(expr, ['op', 'arg'], [], path, 'UNKNOWN_EXPRESSION');
    validateExpression(expr.arg, `${path}.arg`);
    return;
  }
  fail('UNKNOWN_EXPRESSION', `${path}.op is not supported.`);
}

function validateTarget(target) {
  assertExactKeys(target, ['deviceId', 'tabId'], ['documentGeneration'], 'program.target');
  assertId(target.deviceId, 'program.target.deviceId');
  assertSafeInteger(target.tabId, 'program.target.tabId', 0, Number.MAX_SAFE_INTEGER);
  if (target.documentGeneration !== undefined) assertId(target.documentGeneration, 'program.target.documentGeneration');
}

function validateBudgets(budgets) {
  const limits = {
    serializedProgramBytes: 131072, astNodes: 256, astDepth: 12, controlFlowDepth: 4,
    executedNodesPerRun: 1000, browserCommandLeavesPerRun: 200, iterationsPerLoop: 50,
    totalIterationsPerRun: 250, waitEventTimeoutMs: 15000, cumulativeWaitMs: 60000,
    retryAttemptsPerNode: 3, collectionItemsPerBinding: 1000, bindings: 64,
    persistedCheckpointBytes: 131072, returnedResultBytes: 131072,
    executionSliceMs: 20000, runDeadlineMs: 300000,
  };
  assertExactKeys(budgets, Object.keys(limits), [], 'program.budgets');
  for (const [key, maximum] of Object.entries(limits)) assertSafeInteger(budgets[key], `program.budgets.${key}`, 1, maximum);
}

function validateCommandNode(node, path) {
  assertExactKeys(node, ['type', 'method', 'arguments', 'resultBinding'], [], path);
  if (!READ_ONLY_METHODS.has(node.method)) fail('DISALLOWED_COMMAND', `${path}.method is not allowed in V1.`);
  assertPlainObject(node.arguments, `${path}.arguments`);
  assertNoSensitive(node.arguments, `${path}.arguments`);
  if (node.arguments.executionMode === 'foreground') fail('FOREGROUND_FORBIDDEN', `${path} cannot request foreground execution.`);
  if (node.method === 'browser.burst') {
    const steps = node.arguments.steps;
    if (!Array.isArray(steps) || steps.length < 1 || steps.some((step) => !isPlainObject(step) || !['read', 'find', 'wait'].includes(step.action))) {
      fail('DISALLOWED_COMMAND', `${path} contains a disallowed browser.burst step.`);
    }
  }
  if (typeof node.resultBinding !== 'string' || !SAFE_SEGMENT.test(node.resultBinding)) fail('INVALID_SCHEMA', `${path}.resultBinding is invalid.`);
}

function validateNode(node, ctx, path = 'program.root', depth = 1, controlDepth = 0) {
  assertPlainObject(node, path);
  ctx.staticNodes += 1;
  if (ctx.staticNodes > ctx.limits.astNodes) fail('NODE_BUDGET_EXCEEDED', 'Static AST node budget exceeded.');
  if (depth > ctx.limits.astDepth) fail('AST_TOO_DEEP', `${path} exceeds AST depth.`);
  const nextControlDepth = controlDepth + (['IF', 'LOOP', 'UNTIL', 'RETRY'].includes(node.type) ? 1 : 0);
  if (nextControlDepth > ctx.limits.controlFlowDepth) fail('CONTROL_FLOW_TOO_DEEP', `${path} exceeds control-flow depth.`);

  if (node.type === 'SEQUENCE') {
    assertExactKeys(node, ['type', 'children'], [], path);
    if (!Array.isArray(node.children) || node.children.length > 256) fail('INVALID_SCHEMA', `${path}.children is invalid.`);
    node.children.forEach((child, index) => validateNode(child, ctx, `${path}.children[${index}]`, depth + 1, nextControlDepth));
    return;
  }
  if (node.type === 'IF') {
    assertExactKeys(node, ['type', 'predicate', 'then'], ['else'], path);
    validateExpression(node.predicate, `${path}.predicate`);
    validateNode(node.then, ctx, `${path}.then`, depth + 1, nextControlDepth);
    if (node.else !== undefined) validateNode(node.else, ctx, `${path}.else`, depth + 1, nextControlDepth);
    return;
  }
  if (node.type === 'LOOP') {
    assertExactKeys(node, ['type', 'body', 'maxIterations'], [], path);
    assertSafeInteger(node.maxIterations, `${path}.maxIterations`, 1, 50, 'ITERATION_BUDGET_EXCEEDED');
    validateNode(node.body, ctx, `${path}.body`, depth + 1, nextControlDepth);
    return;
  }
  if (node.type === 'UNTIL') {
    assertExactKeys(node, ['type', 'predicate', 'body', 'maxIterations'], [], path);
    validateExpression(node.predicate, `${path}.predicate`);
    assertSafeInteger(node.maxIterations, `${path}.maxIterations`, 1, 50, 'ITERATION_BUDGET_EXCEEDED');
    validateNode(node.body, ctx, `${path}.body`, depth + 1, nextControlDepth);
    return;
  }
  if (node.type === 'WAIT_EVENT') {
    assertExactKeys(node, ['type', 'observation', 'predicate', 'intervalMs', 'timeoutMs'], [], path);
    assertPlainObject(node.observation, `${path}.observation`);
    assertExactKeys(node.observation, ['method', 'arguments'], [], `${path}.observation`);
    if (!['page.read', 'page.query', 'page.find', 'page.collect_links', 'page.capture', 'page.wait_for', 'media.state'].includes(node.observation.method)) {
      fail('DISALLOWED_COMMAND', `${path}.observation.method is not read-only.`);
    }
    assertPlainObject(node.observation.arguments, `${path}.observation.arguments`);
    assertNoSensitive(node.observation.arguments, `${path}.observation.arguments`);
    if (node.observation.arguments.executionMode === 'foreground') fail('FOREGROUND_FORBIDDEN', `${path} cannot request foreground execution.`);
    assertSafeInteger(node.intervalMs, `${path}.intervalMs`, 50, 15000, 'WAIT_BUDGET_EXCEEDED');
    assertSafeInteger(node.timeoutMs, `${path}.timeoutMs`, 50, 15000, 'WAIT_BUDGET_EXCEEDED');
    validateExpression(node.predicate, `${path}.predicate`);
    return;
  }
  if (node.type === 'ASSERT') {
    assertExactKeys(node, ['type', 'predicate', 'onFailure'], [], path);
    validateExpression(node.predicate, `${path}.predicate`);
    if (!['SUSPEND', 'FAIL'].includes(node.onFailure)) fail('INVALID_SEMANTICS', `${path}.onFailure is unsupported.`);
    return;
  }
  if (node.type === 'COLLECT') {
    assertExactKeys(node, ['type', 'source', 'projection', 'destination', 'maxItems'], [], path);
    validateExpression(node.source, `${path}.source`);
    if (!Array.isArray(node.projection) || node.projection.length < 1 || node.projection.length > 32 || node.projection.some((item) => typeof item !== 'string' || !SAFE_SEGMENT.test(item))) {
      fail('INVALID_SCHEMA', `${path}.projection is invalid.`);
    }
    if (typeof node.destination !== 'string' || !SAFE_SEGMENT.test(node.destination)) fail('INVALID_SCHEMA', `${path}.destination is invalid.`);
    assertSafeInteger(node.maxItems, `${path}.maxItems`, 1, 1000, 'BINDING_BUDGET_EXCEEDED');
    return;
  }
  if (node.type === 'DEDUP') {
    assertExactKeys(node, ['type', 'source', 'keySpec', 'destination'], [], path);
    validateExpression(node.source, `${path}.source`);
    if (!Array.isArray(node.keySpec) || node.keySpec.length < 1 || node.keySpec.length > 8 || node.keySpec.some((item) => typeof item !== 'string' || !SAFE_SEGMENT.test(item))) {
      fail('INVALID_SCHEMA', `${path}.keySpec is invalid.`);
    }
    if (typeof node.destination !== 'string' || !SAFE_SEGMENT.test(node.destination)) fail('INVALID_SCHEMA', `${path}.destination is invalid.`);
    return;
  }
  if (node.type === 'RETRY') {
    assertExactKeys(node, ['type', 'body', 'policy'], [], path);
    assertPlainObject(node.policy, `${path}.policy`);
    assertExactKeys(node.policy, ['attempts', 'delayMs'], [], `${path}.policy`);
    assertSafeInteger(node.policy.attempts, `${path}.policy.attempts`, 1, 3, 'RETRY_BUDGET_EXCEEDED');
    assertSafeInteger(node.policy.delayMs, `${path}.policy.delayMs`, 0, 15000, 'RETRY_BUDGET_EXCEEDED');
    validateNode(node.body, ctx, `${path}.body`, depth + 1, nextControlDepth);
    return;
  }
  if (node.type === 'RETURN') {
    assertExactKeys(node, ['type', 'valueSpec'], [], path);
    validateExpression(node.valueSpec, `${path}.valueSpec`);
    return;
  }
  if (node.type === 'COMMAND') {
    validateCommandNode(node, path);
    return;
  }
  if (node.type === 'SUSPEND') {
    assertExactKeys(node, ['type', 'reason', 'contextSpec'], [], path);
    if (!SUSPENSION_REASONS.has(node.reason)) fail('INVALID_SEMANTICS', `${path}.reason is unsupported.`);
    assertPlainObject(node.contextSpec, `${path}.contextSpec`);
    assertNoSensitive(node.contextSpec, `${path}.contextSpec`);
    return;
  }
  fail('UNKNOWN_NODE', `${path}.type is not supported.`);
}

function addMetrics(a, b) {
  return {
    nodes: a.nodes + b.nodes,
    commands: a.commands + b.commands,
    iterations: a.iterations + b.iterations,
    wait: a.wait + b.wait,
    bindings: new Set([...a.bindings, ...b.bindings]),
  };
}

function scaleMetrics(metric, multiplier) {
  return {
    nodes: metric.nodes * multiplier,
    commands: metric.commands * multiplier,
    iterations: metric.iterations * multiplier,
    wait: metric.wait * multiplier,
    bindings: new Set(metric.bindings),
  };
}

function estimateWorstCase(node) {
  const own = { nodes: 1, commands: 0, iterations: 0, wait: 0, bindings: new Set() };
  if (node.type === 'COMMAND') {
    own.commands = 1;
    own.bindings.add(node.resultBinding);
    return own;
  }
  if (node.type === 'WAIT_EVENT') {
    own.wait = node.timeoutMs;
    return own;
  }
  if (node.type === 'COLLECT' || node.type === 'DEDUP') {
    own.bindings.add(node.destination);
    return own;
  }
  if (node.type === 'SEQUENCE') return node.children.reduce((acc, child) => addMetrics(acc, estimateWorstCase(child)), own);
  if (node.type === 'IF') {
    const thenMetric = estimateWorstCase(node.then);
    const elseMetric = node.else ? estimateWorstCase(node.else) : { nodes: 0, commands: 0, iterations: 0, wait: 0, bindings: new Set() };
    return addMetrics(own, {
      nodes: Math.max(thenMetric.nodes, elseMetric.nodes),
      commands: Math.max(thenMetric.commands, elseMetric.commands),
      iterations: Math.max(thenMetric.iterations, elseMetric.iterations),
      wait: Math.max(thenMetric.wait, elseMetric.wait),
      bindings: new Set([...thenMetric.bindings, ...elseMetric.bindings]),
    });
  }
  if (node.type === 'LOOP' || node.type === 'UNTIL') {
    const body = scaleMetrics(estimateWorstCase(node.body), node.maxIterations);
    body.iterations += node.maxIterations;
    return addMetrics(own, body);
  }
  if (node.type === 'RETRY') return addMetrics(own, scaleMetrics(estimateWorstCase(node.body), node.policy.attempts));
  return own;
}

export async function validateReactiveProgram(input) {
  assertNoSensitive(input, 'program');
  assertExactKeys(
    input,
    ['schemaVersion', 'programId', 'tenantId', 'goalId', 'goalRevision', 'target', 'budgets', 'root', 'programDigest'],
    ['taskDependencies'],
    'program',
  );
  if (input.taskDependencies !== undefined && input.taskDependencies !== null) {
    assertPlainObject(input.taskDependencies, 'program.taskDependencies');
    assertNoSensitive(input.taskDependencies, 'program.taskDependencies');
    if (input.taskDependencies.source !== 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES') {
      fail('INVALID_SCHEMA', 'program.taskDependencies.source must be ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES.');
    }
    if (input.taskDependencies.goalId !== input.goalId) {
      fail('INVALID_SCHEMA', 'program.taskDependencies.goalId must match program.goalId.');
    }
  }
  if (input.schemaVersion !== PROGRAM_VERSION) fail('INVALID_SCHEMA', 'program.schemaVersion is unsupported.');
  assertId(input.programId, 'program.programId');
  assertId(input.tenantId, 'program.tenantId');
  assertId(input.goalId, 'program.goalId');
  assertSafeInteger(input.goalRevision, 'program.goalRevision', 1, Number.MAX_SAFE_INTEGER);
  validateTarget(input.target);
  validateBudgets(input.budgets);
  if (!DIGEST_RE.test(input.programDigest)) fail('INVALID_SCHEMA', 'program.programDigest has an invalid format.');

  let serialized;
  try {
    serialized = canonicalJson(input);
  } catch {
    fail('INVALID_SEMANTICS', 'program must be acyclic canonical JSON data.');
  }
  if (byteLength(serialized) > input.budgets.serializedProgramBytes || byteLength(serialized) > REACTIVE_VM_7B_LIMITS.serializedProgramBytes) {
    fail('PROGRAM_TOO_LARGE', 'program exceeds its serialized byte budget.');
  }
  const expectedDigest = await digestCanonical(withoutProgramDigest(input));
  if (expectedDigest !== input.programDigest) fail('PROGRAM_DIGEST_MISMATCH', 'programDigest does not match canonical content.');

  const ctx = { staticNodes: 0, limits: input.budgets };
  validateNode(input.root, ctx);
  const metrics = estimateWorstCase(input.root);
  if (metrics.nodes > input.budgets.executedNodesPerRun) fail('NODE_BUDGET_EXCEEDED', 'Worst-case executed node budget exceeded.');
  if (metrics.commands > input.budgets.browserCommandLeavesPerRun) fail('COMMAND_BUDGET_EXCEEDED', 'Worst-case command budget exceeded.');
  if (metrics.iterations > input.budgets.totalIterationsPerRun) fail('ITERATION_BUDGET_EXCEEDED', 'Worst-case iteration budget exceeded.');
  if (metrics.wait > input.budgets.cumulativeWaitMs) fail('WAIT_BUDGET_EXCEEDED', 'Worst-case wait budget exceeded.');
  if (metrics.bindings.size > input.budgets.bindings) fail('BINDING_BUDGET_EXCEEDED', 'Worst-case binding budget exceeded.');
  return deepFreeze(cloneJson(input));
}

function collectNodeTypes(node, output = new Set()) {
  output.add(node.type);
  if (node.type === 'SEQUENCE') node.children.forEach((child) => collectNodeTypes(child, output));
  else if (node.type === 'IF') {
    collectNodeTypes(node.then, output);
    if (node.else) collectNodeTypes(node.else, output);
  } else if (['LOOP', 'UNTIL', 'RETRY'].includes(node.type)) collectNodeTypes(node.body, output);
  return output;
}

function assert7BExecutable(program) {
  for (const type of collectNodeTypes(program.root)) {
    if (!SUPPORTED_7B_NODES.has(type)) fail('INVALID_SEMANTICS', `${type} is frozen by 7A but is not executable until a later checkpoint.`);
  }
}

function assertBindings(bindings, maximum, path = 'bindings') {
  assertPlainObject(bindings, path, 'INVALID_SEMANTICS');
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
      if (!Array.isArray(current) || !Number.isSafeInteger(segment) || segment < 0 || segment >= current.length) fail('INVALID_SEMANTICS', 'VM cursor index is invalid.');
      current = current[segment];
    } else {
      if (typeof segment !== 'string' || FORBIDDEN_PATH_SEGMENTS.has(segment) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        fail('INVALID_SEMANTICS', 'VM cursor segment is invalid.');
      }
      current = current[segment];
    }
  }
  if (!isPlainObject(current) || typeof current.type !== 'string') fail('INVALID_SEMANTICS', 'VM cursor does not reference an instruction.');
  return current;
}

function validateFrame(frame, program) {
  assertPlainObject(frame, 'state.frames[]', 'INVALID_SEMANTICS');
  if (frame.kind === 'SEQUENCE') {
    assertExactKeys(frame, ['kind', 'parentPath', 'nextIndex'], [], 'state.frames[]', 'INVALID_SEMANTICS');
    const parent = nodeAtPath(program, frame.parentPath);
    if (parent.type !== 'SEQUENCE') fail('INVALID_SEMANTICS', 'Sequence frame does not reference SEQUENCE.');
    assertSafeInteger(frame.nextIndex, 'state.frames[].nextIndex', 0, parent.children.length, 'INVALID_SEMANTICS');
    return;
  }
  if (frame.kind === 'IF') {
    assertExactKeys(frame, ['kind', 'parentPath'], [], 'state.frames[]', 'INVALID_SEMANTICS');
    if (nodeAtPath(program, frame.parentPath).type !== 'IF') fail('INVALID_SEMANTICS', 'IF frame does not reference IF.');
    return;
  }
  fail('INVALID_SEMANTICS', 'Unknown VM frame kind.');
}

function validatePendingEffect(pending, program, state) {
  if (pending === null) return;
  assertExactKeys(
    pending,
    ['requestDigest', 'method', 'arguments', 'target', 'resultBinding', 'nodePath', 'ordinal'],
    [],
    'state.pendingEffect',
    'INVALID_SEMANTICS',
  );
  if (!DIGEST_RE.test(pending.requestDigest) || !READ_ONLY_METHODS.has(pending.method)) fail('INVALID_SEMANTICS', 'Pending effect is malformed.');
  if (canonicalJson(pending.target) !== canonicalJson(program.target)) fail('STALE_TARGET', 'Pending effect target differs from program target.');
  if (typeof pending.resultBinding !== 'string' || !SAFE_SEGMENT.test(pending.resultBinding)) fail('INVALID_SEMANTICS', 'Pending result binding is invalid.');
  if (nodeAtPath(program, pending.nodePath).type !== 'COMMAND') fail('INVALID_SEMANTICS', 'Pending effect path is not a command.');
  assertSafeInteger(pending.ordinal, 'state.pendingEffect.ordinal', 1, state.counters.commandLeaves, 'INVALID_SEMANTICS');
}

function validateVmState(program, state) {
  assertExactKeys(
    state,
    ['schemaVersion', 'runId', 'programDigest', 'tenantId', 'goalId', 'goalRevision', 'target', 'status', 'cursorPath',
     'frames', 'bindings', 'counters', 'pendingEffect', 'result', 'suspension', 'resultDigest', 'deadlineAtMs', 'transitionIndex'],
    [],
    'state',
    'INVALID_SEMANTICS',
  );
  if (state.schemaVersion !== STATE_VERSION) fail('INVALID_SEMANTICS', 'state.schemaVersion is unsupported.');
  assertId(state.runId, 'state.runId');
  if (state.programDigest !== program.programDigest) fail('PROGRAM_DIGEST_MISMATCH', 'State program digest differs from program.');
  if (state.tenantId !== program.tenantId) fail('CROSS_TENANT', 'State tenant differs from program.');
  if (state.goalId !== program.goalId || state.goalRevision !== program.goalRevision) fail('STALE_GOAL_REVISION', 'State goal revision differs from program.');
  if (canonicalJson(state.target) !== canonicalJson(program.target)) fail('STALE_TARGET', 'State target differs from program.');
  if (!STATE_STATUSES.has(state.status)) fail('INVALID_SEMANTICS', 'State status is invalid.');
  if (!Array.isArray(state.frames) || state.frames.length > program.budgets.astDepth) fail('INVALID_SEMANTICS', 'State frame stack is invalid.');
  state.frames.forEach((frame) => validateFrame(frame, program));
  assertBindings(state.bindings, program.budgets.bindings, 'state.bindings');
  assertExactKeys(state.counters, ['executedNodes', 'commandLeaves'], [], 'state.counters', 'INVALID_SEMANTICS');
  assertSafeInteger(state.counters.executedNodes, 'state.counters.executedNodes', 0, program.budgets.executedNodesPerRun, 'INVALID_SEMANTICS');
  assertSafeInteger(state.counters.commandLeaves, 'state.counters.commandLeaves', 0, program.budgets.browserCommandLeavesPerRun, 'INVALID_SEMANTICS');
  assertSafeInteger(state.deadlineAtMs, 'state.deadlineAtMs', 1, Number.MAX_SAFE_INTEGER, 'INVALID_SEMANTICS');
  assertSafeInteger(state.transitionIndex, 'state.transitionIndex', 0, Number.MAX_SAFE_INTEGER, 'INVALID_SEMANTICS');
  validatePendingEffect(state.pendingEffect, program, state);

  if (TERMINAL_STATUSES.has(state.status)) {
    if (state.cursorPath !== null || state.pendingEffect !== null) fail('INVALID_SEMANTICS', 'Terminal state cannot have a cursor or pending effect.');
    if (!DIGEST_RE.test(state.resultDigest || '')) fail('INVALID_SEMANTICS', 'Terminal state requires resultDigest.');
  } else {
    if (!Array.isArray(state.cursorPath)) fail('INVALID_SEMANTICS', 'Non-terminal state requires cursorPath.');
    nodeAtPath(program, state.cursorPath);
    if (state.resultDigest !== null || state.result !== null || state.suspension !== null) fail('INVALID_SEMANTICS', 'Non-terminal state contains terminal fields.');
  }
  return state;
}

function compareValues(left, right) {
  if (left === null || right === null) return left === right ? 0 : null;
  if (typeof left !== typeof right) return null;
  if (typeof left === 'number' || typeof left === 'string') return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === 'boolean') return left === right ? 0 : left ? 1 : -1;
  return null;
}

function deepEqualCanonical(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function pathValue(bindings, path) {
  let current = bindings;
  for (const segment of path) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

export function evaluateReactiveExpression(expr, bindings) {
  validateExpression(expr);
  if (expr.op === 'CONST') return expr.value;
  if (expr.op === 'PATH') return pathValue(bindings, expr.path);
  if (expr.op === 'NOT') return !Boolean(evaluateReactiveExpression(expr.arg, bindings));
  if (expr.op === 'COUNT') {
    const value = evaluateReactiveExpression(expr.arg, bindings);
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    if (isPlainObject(value)) return Object.keys(value).length;
    if (value === null || value === undefined) return 0;
    return 1;
  }
  const values = expr.args.map((arg) => evaluateReactiveExpression(arg, bindings));
  if (expr.op === 'EQ') return values.every((value) => deepEqualCanonical(value, values[0]));
  if (expr.op === 'NE') {
    for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) if (deepEqualCanonical(values[i], values[j])) return false;
    return true;
  }
  if (expr.op === 'AND') return values.every(Boolean);
  if (expr.op === 'OR') return values.some(Boolean);
  if (expr.op === 'IN') {
    const [needle, ...containers] = values;
    return containers.some((container) => Array.isArray(container)
      ? container.some((item) => deepEqualCanonical(item, needle))
      : typeof container === 'string' && typeof needle === 'string' && container.includes(needle));
  }
  const comparator = { LT: (v) => v < 0, LTE: (v) => v <= 0, GT: (v) => v > 0, GTE: (v) => v >= 0 }[expr.op];
  if (comparator) {
    for (let index = 0; index < values.length - 1; index += 1) {
      const comparison = compareValues(values[index], values[index + 1]);
      if (comparison === null || !comparator(comparison)) return false;
    }
    return true;
  }
  fail('UNKNOWN_EXPRESSION', `Expression operator ${expr.op} is unsupported.`);
}

async function terminalState(program, state, status, { result = null, suspension = null } = {}) {
  const next = {
    ...state,
    status,
    cursorPath: null,
    frames: [],
    pendingEffect: null,
    result: cloneJson(result, 'result'),
    suspension: suspension === null ? null : cloneJson(suspension, 'suspension'),
    transitionIndex: state.transitionIndex,
  };
  const terminalPayload = { status: next.status, result: next.result, suspension: next.suspension };
  if (byteLength(canonicalJson(terminalPayload)) > Math.min(REACTIVE_VM_7B_LIMITS.returnedResultBytes, program.budgets.returnedResultBytes)) fail('OUTPUT_TOO_LARGE', 'Terminal result exceeds the declared V1 result bound.');
  next.resultDigest = await digestCanonical(terminalPayload);
  return deepFreeze(next);
}

function completeInstruction(program, state) {
  const next = cloneJson(state, 'state');
  while (next.frames.length) {
    const frame = next.frames.pop();
    if (frame.kind === 'IF') continue;
    const sequence = nodeAtPath(program, frame.parentPath);
    if (frame.nextIndex < sequence.children.length) {
      const childIndex = frame.nextIndex;
      frame.nextIndex += 1;
      next.frames.push(frame);
      next.cursorPath = [...frame.parentPath, 'children', childIndex];
      return { state: next, exhausted: false };
    }
  }
  next.cursorPath = null;
  return { state: next, exhausted: true };
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

function assertHostStepInput(input) {
  assertPlainObject(input, 'input', 'INVALID_SEMANTICS');
  assertExactKeys(input, ['logicalNowMs'], ['cancelled', 'effectResult'], 'input', 'INVALID_SEMANTICS');
  assertSafeInteger(input.logicalNowMs, 'input.logicalNowMs', 0, Number.MAX_SAFE_INTEGER, 'INVALID_SEMANTICS');
  if (input.cancelled !== undefined && typeof input.cancelled !== 'boolean') fail('INVALID_SEMANTICS', 'input.cancelled must be boolean.');
}

async function effectRequestFor(program, state, node) {
  const ordinal = state.counters.commandLeaves + 1;
  const body = {
    programDigest: program.programDigest,
    runId: state.runId,
    nodePath: state.cursorPath,
    ordinal,
    method: node.method,
    arguments: node.arguments,
    target: program.target,
  };
  return deepFreeze({
    requestDigest: await digestCanonical(body),
    method: node.method,
    arguments: cloneJson(node.arguments),
    target: cloneJson(program.target),
    resultBinding: node.resultBinding,
    nodePath: [...state.cursorPath],
    ordinal,
  });
}

function validateEffectResult(program, pending, effectResult) {
  assertExactKeys(effectResult, ['requestDigest', 'method', 'ok', 'provenance', 'value'], ['errorCode'], 'input.effectResult', 'INVALID_SEMANTICS');
  if (effectResult.requestDigest !== pending.requestDigest || effectResult.method !== pending.method) {
    fail('INVALID_SEMANTICS', 'Effect result does not match the pending request.');
  }
  if (typeof effectResult.ok !== 'boolean') fail('INVALID_SEMANTICS', 'Effect result ok must be boolean.');
  assertPlainObject(effectResult.provenance, 'input.effectResult.provenance', 'INVALID_SEMANTICS');
  const provenance = effectResult.provenance;
  if (provenance.tenantId !== program.tenantId) fail('CROSS_TENANT', 'Effect result belongs to another tenant.');
  if (provenance.deviceId !== program.target.deviceId) fail('CROSS_DEVICE', 'Effect result belongs to another device.');
  if (TAB_SCOPED_METHODS.has(pending.method) && provenance.tabId !== program.target.tabId) fail('CROSS_TAB', 'Effect result belongs to another tab.');
  if (DOCUMENT_SCOPED_METHODS.has(pending.method) && program.target.documentGeneration !== undefined
      && provenance.documentGeneration !== program.target.documentGeneration) {
    fail('STALE_DOCUMENT', 'Effect result belongs to another document generation.');
  }
  if (effectResult.errorCode !== undefined && (typeof effectResult.errorCode !== 'string' || byteLength(effectResult.errorCode) > 128)) {
    fail('INVALID_SEMANTICS', 'Effect result errorCode is invalid.');
  }
  if (effectResult.ok) {
    cloneJson(effectResult.value, 'input.effectResult.value');
    assertNoSensitive(effectResult.value, 'input.effectResult.value');
    if (byteLength(canonicalJson(effectResult.value)) > Math.min(REACTIVE_VM_7B_LIMITS.returnedResultBytes, program.budgets.returnedResultBytes)) {
      fail('OUTPUT_TOO_LARGE', 'Effect result exceeds the declared V1 value bound.');
    }
  }
}

export async function createReactiveVm(programInput, options) {
  const program = await validateReactiveProgram(programInput);
  assert7BExecutable(program);
  assertExactKeys(options, ['runId', 'tenantId', 'goalRevision', 'logicalNowMs'], ['deadlineAtMs', 'initialBindings'], 'options', 'INVALID_SEMANTICS');
  assertId(options.runId, 'options.runId');
  if (options.tenantId !== program.tenantId) fail('CROSS_TENANT', 'Authoritative tenant differs from program tenant.');
  if (options.goalRevision !== program.goalRevision) fail('STALE_GOAL_REVISION', 'Authoritative goal revision differs from program.');
  assertSafeInteger(options.logicalNowMs, 'options.logicalNowMs', 0, Number.MAX_SAFE_INTEGER, 'INVALID_SEMANTICS');
  const deadlineAtMs = options.deadlineAtMs ?? (options.logicalNowMs + program.budgets.runDeadlineMs);
  assertSafeInteger(deadlineAtMs, 'options.deadlineAtMs', options.logicalNowMs + 1, Number.MAX_SAFE_INTEGER, 'INVALID_SEMANTICS');
  if (deadlineAtMs - options.logicalNowMs > program.budgets.runDeadlineMs) fail('INVALID_SEMANTICS', 'Run deadline exceeds the frozen V1 budget.');
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
    counters: { executedNodes: 0, commandLeaves: 0 },
    pendingEffect: null,
    result: null,
    suspension: null,
    resultDigest: null,
    deadlineAtMs,
    transitionIndex: 0,
  });
}

export async function advanceReactiveVm(programInput, stateInput, input) {
  const program = await validateReactiveProgram(programInput);
  assert7BExecutable(program);
  const state = cloneJson(stateInput, 'state');
  validateVmState(program, state);
  assertHostStepInput(input);

  if (TERMINAL_STATUSES.has(state.status)) fail('INVALID_SEMANTICS', 'A terminal VM state cannot advance.');
  if (input.cancelled === true) return terminalTransition(program, state, 'CANCELLED', { suspension: null, result: null });
  if (input.logicalNowMs >= state.deadlineAtMs) return terminalTransition(program, state, 'EXPIRED', { suspension: null, result: null });

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
    if (!input.effectResult.ok) {
      return terminalTransition(program, state, 'SUSPENDED', {
        result: null,
        suspension: {
          reason: 'UNEXPECTED_STATE',
          context: {
            method: state.pendingEffect.method,
            requestDigest: state.pendingEffect.requestDigest,
            errorCode: input.effectResult.errorCode ?? 'EFFECT_FAILED',
          },
        },
      });
    }

    const cutover = input.effectResult.value?.performanceCutover;
    if (cutover?.reasoningObservation?.resetRequired === true) {
      return terminalTransition(program, state, 'SUSPENDED', {
        result: null,
        suspension: {
          reason: 'STALE_TARGET',
          context: {
            method: state.pendingEffect.method,
            requestDigest: state.pendingEffect.requestDigest,
            resetReason: cutover.reasoningObservation.resetReason || 'CONTINUITY_FAILURE',
          },
        },
      });
    }

    if (cutover !== undefined) {
      const applyAndContinueAccepted = cutover !== null
        && cutover.decision === 'APPLY_AND_CONTINUE'
        && cutover.reasoningWakeRequired === false
        && cutover.reasoningObservation === null
        && cutover.contextStatus === 'ACCEPTED';

      if (!applyAndContinueAccepted) {
        return terminalTransition(program, state, 'SUSPENDED', {
          result: null,
          suspension: {
            reason: 'NEEDS_MODEL',
            context: {
              method: state.pendingEffect.method,
              requestDigest: state.pendingEffect.requestDigest,
              cutoverDecision: typeof cutover?.decision === 'string' ? cutover.decision : 'INVALID_OR_MISSING',
              contextStatus: typeof cutover?.contextStatus === 'string' ? cutover.contextStatus : 'INVALID_OR_MISSING',
              reasoningObservation: cutover?.reasoningObservation ?? null,
            },
          },
        });
      }
    }
    const next = cloneJson(state, 'state');
    const binding = next.pendingEffect.resultBinding;
    if (!Object.prototype.hasOwnProperty.call(next.bindings, binding) && Object.keys(next.bindings).length >= program.budgets.bindings) {
      return terminalTransition(program, next, 'LIMIT_REACHED', {
        result: null,
        suspension: { reason: 'LIMIT_REACHED', context: { budget: 'bindings' } },
      });
    }
    next.bindings[binding] = cloneJson(input.effectResult.value, 'effect value');
    next.pendingEffect = null;
    next.status = 'RUNNING';
    next.transitionIndex += 1;
    const completed = completeInstruction(program, next);
    if (completed.exhausted) {
      const terminal = await terminalState(program, completed.state, 'RETURNED', { result: null, suspension: null });
      return deepFreeze({
        state: terminal,
        transition: deepFreeze({
          kind: 'EFFECT_ACCEPTED',
          requestDigest: state.pendingEffect.requestDigest,
          terminalStatus: terminal.status,
          resultDigest: terminal.resultDigest,
          transitionIndex: terminal.transitionIndex,
        }),
      });
    }
    return deepFreeze({
      state: deepFreeze(completed.state),
      transition: deepFreeze({
        kind: 'EFFECT_ACCEPTED',
        requestDigest: state.pendingEffect.requestDigest,
        transitionIndex: completed.state.transitionIndex,
      }),
    });
  }

  if (input.effectResult !== undefined) fail('INVALID_SEMANTICS', 'No effect result is expected.');
  const node = nodeAtPath(program, state.cursorPath);
  if (state.counters.executedNodes >= program.budgets.executedNodesPerRun) {
    return terminalTransition(program, state, 'LIMIT_REACHED', {
      result: null,
      suspension: { reason: 'LIMIT_REACHED', context: { budget: 'executedNodesPerRun' } },
    });
  }

  const next = cloneJson(state, 'state');
  next.status = 'RUNNING';
  next.counters.executedNodes += 1;
  next.transitionIndex += 1;

  if (node.type === 'SEQUENCE') {
    if (node.children.length === 0) {
      const completed = completeInstruction(program, next);
      if (completed.exhausted) return terminalTransition(program, completed.state, 'RETURNED', { result: null, suspension: null }, false);
      return deepFreeze({ state: deepFreeze(completed.state), transition: deepFreeze({ kind: 'CONTINUE', instruction: 'SEQUENCE', transitionIndex: completed.state.transitionIndex }) });
    }
    next.frames.push({ kind: 'SEQUENCE', parentPath: [...state.cursorPath], nextIndex: 1 });
    next.cursorPath = [...state.cursorPath, 'children', 0];
    return deepFreeze({ state: deepFreeze(next), transition: deepFreeze({ kind: 'CONTINUE', instruction: 'SEQUENCE', transitionIndex: next.transitionIndex }) });
  }

  if (node.type === 'IF') {
    const selected = Boolean(evaluateReactiveExpression(node.predicate, next.bindings));
    if (!selected && node.else === undefined) {
      const completed = completeInstruction(program, next);
      if (completed.exhausted) return terminalTransition(program, completed.state, 'RETURNED', { result: null, suspension: null }, false);
      return deepFreeze({ state: deepFreeze(completed.state), transition: deepFreeze({ kind: 'CONTINUE', instruction: 'IF', selected: 'NONE', transitionIndex: completed.state.transitionIndex }) });
    }
    next.frames.push({ kind: 'IF', parentPath: [...state.cursorPath] });
    next.cursorPath = [...state.cursorPath, selected ? 'then' : 'else'];
    return deepFreeze({ state: deepFreeze(next), transition: deepFreeze({ kind: 'CONTINUE', instruction: 'IF', selected: selected ? 'THEN' : 'ELSE', transitionIndex: next.transitionIndex }) });
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
    const completed = completeInstruction(program, next);
    if (completed.exhausted) return terminalTransition(program, completed.state, 'RETURNED', { result: null, suspension: null }, false);
    return deepFreeze({ state: deepFreeze(completed.state), transition: deepFreeze({ kind: 'CONTINUE', instruction: 'ASSERT', passed: true, transitionIndex: completed.state.transitionIndex }) });
  }

  if (node.type === 'RETURN') {
    const result = evaluateReactiveExpression(node.valueSpec, next.bindings);
    assertNoSensitive(result, 'return value');
    const terminal = await terminalState(program, next, 'RETURNED', { result, suspension: null });
    return deepFreeze({
      state: terminal,
      transition: deepFreeze({ kind: 'TERMINAL', status: 'RETURNED', resultDigest: terminal.resultDigest, transitionIndex: terminal.transitionIndex }),
    });
  }

  if (node.type === 'SUSPEND') {
    const terminal = await terminalState(program, next, 'SUSPENDED', {
      result: null,
      suspension: { reason: node.reason, context: cloneJson(node.contextSpec, 'suspend context') },
    });
    return deepFreeze({
      state: terminal,
      transition: deepFreeze({ kind: 'TERMINAL', status: 'SUSPENDED', resultDigest: terminal.resultDigest, transitionIndex: terminal.transitionIndex }),
    });
  }

  if (node.type === 'COMMAND') {
    if (next.counters.commandLeaves >= program.budgets.browserCommandLeavesPerRun) {
      return terminalTransition(program, next, 'LIMIT_REACHED', {
        result: null,
        suspension: { reason: 'LIMIT_REACHED', context: { budget: 'browserCommandLeavesPerRun' } },
      }, false);
    }
    const request = await effectRequestFor(program, next, node);
    next.counters.commandLeaves += 1;
    next.pendingEffect = cloneJson(request);
    return deepFreeze({
      state: deepFreeze(next),
      transition: deepFreeze({ kind: 'EFFECT_REQUEST', request, transitionIndex: next.transitionIndex }),
    });
  }

  fail('INVALID_SEMANTICS', `${node.type} is not executable in Checkpoint 7B.`);
}
