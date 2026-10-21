// @last-edited: 2026-10-21 UTC+7.
// @title: reactive-vm — the reactive VM's program: what may be written, and what it evaluates to.
// @state: the program validator, the expression evaluator, and the limits a program must fit in.
// @dependencies: goal-ledger.

import { canonicalJson, digestCanonical } from '../supabase/functions/_shared/goal-ledger.js';
import { SECRET_VALUE } from './secret-pattern.js';

const PROGRAM_VERSION = 'OA_REACTIVE_VM_V1';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const SUSPENSION_REASONS = new Set([
  'NEEDS_MODEL', 'NEEDS_USER', 'GOAL_REVISED', 'AMBIGUOUS_TARGET', 'UNEXPECTED_STATE',
  'ASSERTION_FAILED', 'MISSING_AUTHORITY', 'CONTRADICTION', 'LIMIT_REACHED', 'STALE_TARGET',
]);
const READ_ONLY_METHODS = new Set([
  'browser.ping', 'browser.burst', 'tabs.list', 'tabs.get', 'tabs.find',
  'page.read', 'page.query', 'page.find', 'page.collect_links', 'page.capture',
  'page.wait_for', 'media.state',
]);
const SECRET_FIELD = /(?:password|passcode|otp|secret|credential|private.?key|access.?token|refresh.?token|card.?number|cvv|payment.?data|pairing.?code|signing.?key)/i;

const REACTIVE_VM_LIMITS = Object.freeze({
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
  if (byteLength(serialized) > input.budgets.serializedProgramBytes || byteLength(serialized) > REACTIVE_VM_LIMITS.serializedProgramBytes) {
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
