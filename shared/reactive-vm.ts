// @last-edited: 2026-10-21 UTC+7.
// @title: reactive-vm — the reactive VM's program: what may be written, and what it evaluates to.
// @state: the program validator, the expression evaluator, and the limits a program must fit in.
// @dependencies: digest.

import { canonicalJson, digestCanonical } from './digest.js';
import { makeGuards, ReactiveVmError, type Guards } from './reactive-vm-core.js';

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

// WHY A GUARD FACTORY AND NOT A LIBRARY OF NINETY EXPORTS.
// The collect, control-flow and host modules used to carry these helpers verbatim; the factory hands each module the exact same guards with its own default code, and the semantics stay byte-identical.

const guards = makeGuards('INVALID_SCHEMA');
const fail: Guards['fail'] = guards.fail;
const isPlainObject: Guards['isPlainObject'] = guards.isPlainObject;
const assertPlainObject: Guards['assertPlainObject'] = guards.assertPlainObject;
const assertExactKeys: Guards['assertExactKeys'] = guards.assertExactKeys;
const byteLength: Guards['byteLength'] = guards.byteLength;
const assertSafeInteger: Guards['assertSafeInteger'] = guards.assertSafeInteger;
const cloneJson: Guards['cloneJson'] = guards.cloneJson;
const deepFreeze: Guards['deepFreeze'] = guards.deepFreeze;
const assertNoSensitive: Guards['assertNoSensitive'] = guards.assertNoSensitive;

export { ReactiveVmError };

type Node = Record<string, unknown>;

interface WalkContext {
  staticNodes: number;
  limits: Record<string, number>;
}

interface Metric {
  nodes: number;
  commands: number;
  iterations: number;
  wait: number;
  bindings: Set<string>;
}

function assertId(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length < 1 || byteLength(value) > 128) fail('INVALID_SCHEMA', `${path} must be a bounded string.`);
}

function withoutProgramDigest(program: unknown): unknown {
  if (!isPlainObject(program)) return program;
  const { programDigest: _ignored, ...rest } = program;
  return rest;
}

function validatePath(path: unknown, label: string): asserts path is string[] {
  if (!Array.isArray(path) || path.length < 1 || path.length > 8) fail('UNKNOWN_EXPRESSION', `${label} is invalid.`);
  for (const segment of path) {
    if (typeof segment !== 'string' || !SAFE_SEGMENT.test(segment) || FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      fail('UNKNOWN_EXPRESSION', `${label} contains a forbidden segment.`);
    }
  }
  if ((path as string[])[0] === 'pageText') fail('UNTRUSTED_PROGRAM_SOURCE', `${label} cannot source program authority from page text.`);
}

function validateExpression(expr: unknown, path = 'expression'): asserts expr is Node {
  assertPlainObject(expr, path, 'UNKNOWN_EXPRESSION');
  const op = expr.op;
  if (op === 'CONST') {
    assertExactKeys(expr, ['op', 'value'], [], path, 'UNKNOWN_EXPRESSION');
    const constExpr = expr as { value: unknown };
    if (!(constExpr.value === null || ['string', 'boolean'].includes(typeof constExpr.value) || Number.isSafeInteger(constExpr.value))) {
      fail('UNKNOWN_EXPRESSION', `${path}.value has an unsupported type.`);
    }
    return;
  }
  if (op === 'PATH') {
    assertExactKeys(expr, ['op', 'path'], [], path, 'UNKNOWN_EXPRESSION');
    validatePath(expr.path, `${path}.path`);
    return;
  }
  if (['EQ', 'NE', 'LT', 'LTE', 'GT', 'GTE', 'AND', 'OR', 'IN'].includes(String(op))) {
    assertExactKeys(expr, ['op', 'args'], [], path, 'UNKNOWN_EXPRESSION');
    const argsExpr = expr as { args: unknown };
    if (!Array.isArray(argsExpr.args) || argsExpr.args.length < 2 || argsExpr.args.length > 16) fail('UNKNOWN_EXPRESSION', `${path}.args is invalid.`);
    argsExpr.args.forEach((arg: unknown, index: number) => validateExpression(arg, `${path}.args[${index}]`));
    return;
  }
  if (['NOT', 'COUNT'].includes(String(op))) {
    assertExactKeys(expr, ['op', 'arg'], [], path, 'UNKNOWN_EXPRESSION');
    validateExpression((expr as { arg: unknown }).arg, `${path}.arg`);
    return;
  }
  fail('UNKNOWN_EXPRESSION', `${path}.op is not supported.`);
}

function validateTarget(target: unknown): asserts target is Node {
  assertExactKeys(target, ['deviceId', 'tabId'], ['documentGeneration'], 'program.target');
  assertId(target.deviceId, 'program.target.deviceId');
  assertSafeInteger(target.tabId, 'program.target.tabId', 0, Number.MAX_SAFE_INTEGER);
  if (target.documentGeneration !== undefined) assertId(target.documentGeneration, 'program.target.documentGeneration');
}

function validateBudgets(budgets: unknown): asserts budgets is Node {
  const limits: Record<string, number> = {
    serializedProgramBytes: 131072, astNodes: 256, astDepth: 12, controlFlowDepth: 4,
    executedNodesPerRun: 1000, browserCommandLeavesPerRun: 200, iterationsPerLoop: 50,
    totalIterationsPerRun: 250, waitEventTimeoutMs: 15000, cumulativeWaitMs: 60000,
    retryAttemptsPerNode: 3, collectionItemsPerBinding: 1000, bindings: 64,
    persistedCheckpointBytes: 131072, returnedResultBytes: 131072,
    executionSliceMs: 20000, runDeadlineMs: 300000,
  };
  assertExactKeys(budgets, Object.keys(limits), [], 'program.budgets');
  for (const [key, maximum] of Object.entries(limits)) {
    assertSafeInteger(budgets[key], `program.budgets.${key}`, 1, maximum);
  }
}

function validateCommandNode(node: unknown, path: string): void {
  assertExactKeys(node, ['type', 'method', 'arguments', 'resultBinding'], [], path);
  if (!READ_ONLY_METHODS.has(node.method as string)) fail('DISALLOWED_COMMAND', `${path}.method is not allowed in V1.`);
  assertPlainObject(node.arguments, `${path}.arguments`);
  assertNoSensitive(node.arguments, `${path}.arguments`);
  if (node.arguments.executionMode === 'foreground') fail('FOREGROUND_FORBIDDEN', `${path} cannot request foreground execution.`);
  if (node.method === 'browser.burst') {
    const steps = node.arguments.steps;
    if (!Array.isArray(steps) || steps.length < 1 || steps.some((step) => !isPlainObject(step) || !['read', 'find', 'wait'].includes((step as Node).action as string))) {
      fail('DISALLOWED_COMMAND', `${path} contains a disallowed browser.burst step.`);
    }
  }
  if (typeof node.resultBinding !== 'string' || !SAFE_SEGMENT.test(node.resultBinding)) fail('INVALID_SCHEMA', `${path}.resultBinding is invalid.`);
}

function validateNode(node: unknown, ctx: WalkContext, path = 'program.root', depth = 1, controlDepth = 0): void {
  assertPlainObject(node, path);
  const typedNode = node as Node;
  ctx.staticNodes += 1;
  if (ctx.staticNodes > (ctx.limits.astNodes as number)) fail('NODE_BUDGET_EXCEEDED', 'Static AST node budget exceeded.');
  if (depth > (ctx.limits.astDepth as number)) fail('AST_TOO_DEEP', `${path} exceeds AST depth.`);
  const nextControlDepth = controlDepth + (['IF', 'LOOP', 'UNTIL', 'RETRY'].includes(String(typedNode.type)) ? 1 : 0);
  if (nextControlDepth > (ctx.limits.controlFlowDepth as number)) fail('CONTROL_FLOW_TOO_DEEP', `${path} exceeds control-flow depth.`);

  if (typedNode.type === 'SEQUENCE') {
    assertExactKeys(typedNode, ['type', 'children'], [], path);
    if (!Array.isArray(typedNode.children) || typedNode.children.length > 256) fail('INVALID_SCHEMA', `${path}.children is invalid.`);
    typedNode.children.forEach((child: unknown, index: number) => validateNode(child, ctx, `${path}.children[${index}]`, depth + 1, nextControlDepth));
    return;
  }
  if (typedNode.type === 'IF') {
    assertExactKeys(typedNode, ['type', 'predicate', 'then'], ['else'], path);
    validateExpression(typedNode.predicate, `${path}.predicate`);
    validateNode(typedNode.then, ctx, `${path}.then`, depth + 1, nextControlDepth);
    if (typedNode.else !== undefined) validateNode(typedNode.else, ctx, `${path}.else`, depth + 1, nextControlDepth);
    return;
  }
  if (typedNode.type === 'LOOP') {
    assertExactKeys(typedNode, ['type', 'body', 'maxIterations'], [], path);
    assertSafeInteger(typedNode.maxIterations, `${path}.maxIterations`, 1, 50, 'ITERATION_BUDGET_EXCEEDED');
    validateNode(typedNode.body, ctx, `${path}.body`, depth + 1, nextControlDepth);
    return;
  }
  if (typedNode.type === 'UNTIL') {
    assertExactKeys(typedNode, ['type', 'predicate', 'body', 'maxIterations'], [], path);
    validateExpression(typedNode.predicate, `${path}.predicate`);
    assertSafeInteger(typedNode.maxIterations, `${path}.maxIterations`, 1, 50, 'ITERATION_BUDGET_EXCEEDED');
    validateNode(typedNode.body, ctx, `${path}.body`, depth + 1, nextControlDepth);
    return;
  }
  if (typedNode.type === 'WAIT_EVENT') {
    assertExactKeys(typedNode, ['type', 'observation', 'predicate', 'intervalMs', 'timeoutMs'], [], path);
    assertPlainObject(typedNode.observation, `${path}.observation`);
    const observation = typedNode.observation as Node;
    assertExactKeys(observation, ['method', 'arguments'], [], `${path}.observation`);
    if (!['page.read', 'page.query', 'page.find', 'page.collect_links', 'page.capture', 'page.wait_for', 'media.state'].includes(String(observation.method))) {
      fail('DISALLOWED_COMMAND', `${path}.observation.method is not read-only.`);
    }
    assertPlainObject(observation.arguments, `${path}.observation.arguments`);
    assertNoSensitive(observation.arguments, `${path}.observation.arguments`);
    if ((observation.arguments as Node).executionMode === 'foreground') fail('FOREGROUND_FORBIDDEN', `${path} cannot request foreground execution.`);
    assertSafeInteger(typedNode.intervalMs, `${path}.intervalMs`, 50, 15000, 'WAIT_BUDGET_EXCEEDED');
    assertSafeInteger(typedNode.timeoutMs, `${path}.timeoutMs`, 50, 15000, 'WAIT_BUDGET_EXCEEDED');
    validateExpression(typedNode.predicate, `${path}.predicate`);
    return;
  }
  if (typedNode.type === 'ASSERT') {
    assertExactKeys(typedNode, ['type', 'predicate', 'onFailure'], [], path);
    validateExpression(typedNode.predicate, `${path}.predicate`);
    if (!['SUSPEND', 'FAIL'].includes(String(typedNode.onFailure))) fail('INVALID_SEMANTICS', `${path}.onFailure is unsupported.`);
    return;
  }
  if (typedNode.type === 'COLLECT') {
    assertExactKeys(typedNode, ['type', 'source', 'projection', 'destination', 'maxItems'], [], path);
    validateExpression(typedNode.source, `${path}.source`);
    if (!Array.isArray(typedNode.projection) || typedNode.projection.length < 1 || typedNode.projection.length > 32 || typedNode.projection.some((item) => typeof item !== 'string' || !SAFE_SEGMENT.test(item))) {
      fail('INVALID_SCHEMA', `${path}.projection is invalid.`);
    }
    if (typeof typedNode.destination !== 'string' || !SAFE_SEGMENT.test(typedNode.destination)) fail('INVALID_SCHEMA', `${path}.destination is invalid.`);
    assertSafeInteger(typedNode.maxItems, `${path}.maxItems`, 1, 1000, 'BINDING_BUDGET_EXCEEDED');
    return;
  }
  if (typedNode.type === 'DEDUP') {
    assertExactKeys(typedNode, ['type', 'source', 'keySpec', 'destination'], [], path);
    validateExpression(typedNode.source, `${path}.source`);
    if (!Array.isArray(typedNode.keySpec) || typedNode.keySpec.length < 1 || typedNode.keySpec.length > 8 || typedNode.keySpec.some((item) => typeof item !== 'string' || !SAFE_SEGMENT.test(item))) {
      fail('INVALID_SCHEMA', `${path}.keySpec is invalid.`);
    }
    if (typeof typedNode.destination !== 'string' || !SAFE_SEGMENT.test(typedNode.destination)) fail('INVALID_SCHEMA', `${path}.destination is invalid.`);
    return;
  }
  if (typedNode.type === 'RETRY') {
    assertExactKeys(typedNode, ['type', 'body', 'policy'], [], path);
    assertPlainObject(typedNode.policy, `${path}.policy`);
    const policy = typedNode.policy as Node;
    assertExactKeys(policy, ['attempts', 'delayMs'], [], `${path}.policy`);
    assertSafeInteger(policy.attempts, `${path}.policy.attempts`, 1, 3, 'RETRY_BUDGET_EXCEEDED');
    assertSafeInteger(policy.delayMs, `${path}.policy.delayMs`, 0, 15000, 'RETRY_BUDGET_EXCEEDED');
    validateNode(typedNode.body, ctx, `${path}.body`, depth + 1, nextControlDepth);
    return;
  }
  if (typedNode.type === 'RETURN') {
    assertExactKeys(typedNode, ['type', 'valueSpec'], [], path);
    validateExpression(typedNode.valueSpec, `${path}.valueSpec`);
    return;
  }
  if (typedNode.type === 'COMMAND') {
    validateCommandNode(typedNode, path);
    return;
  }
  if (typedNode.type === 'SUSPEND') {
    assertExactKeys(typedNode, ['type', 'reason', 'contextSpec'], [], path);
    if (!SUSPENSION_REASONS.has(String(typedNode.reason))) fail('INVALID_SEMANTICS', `${path}.reason is unsupported.`);
    assertPlainObject(typedNode.contextSpec, `${path}.contextSpec`);
    assertNoSensitive(typedNode.contextSpec, `${path}.contextSpec`);
    return;
  }
  fail('UNKNOWN_NODE', `${path}.type is not supported.`);
}

function addMetrics(a: Metric, b: Metric): Metric {
  return {
    nodes: a.nodes + b.nodes,
    commands: a.commands + b.commands,
    iterations: a.iterations + b.iterations,
    wait: a.wait + b.wait,
    bindings: new Set([...a.bindings, ...b.bindings]),
  };
}

function scaleMetrics(metric: Metric, multiplier: number): Metric {
  return {
    nodes: metric.nodes * multiplier,
    commands: metric.commands * multiplier,
    iterations: metric.iterations * multiplier,
    wait: metric.wait * multiplier,
    bindings: new Set(metric.bindings),
  };
}

function estimateWorstCase(node: Node): Metric {
  const own: Metric = { nodes: 1, commands: 0, iterations: 0, wait: 0, bindings: new Set() };
  if (node.type === 'COMMAND') {
    own.commands = 1;
    own.bindings.add(node.resultBinding as string);
    return own;
  }
  if (node.type === 'WAIT_EVENT') {
    own.wait = node.timeoutMs as number;
    return own;
  }
  if (node.type === 'COLLECT' || node.type === 'DEDUP') {
    own.bindings.add(node.destination as string);
    return own;
  }
  if (node.type === 'SEQUENCE') {
    return (node.children as unknown[]).reduce<Metric>((acc, child) => addMetrics(acc, estimateWorstCase(child as Node)), own);
  }
  if (node.type === 'IF') {
    const thenMetric = estimateWorstCase(node.then as Node);
    const elseMetric = node.else !== undefined && node.else !== null ? estimateWorstCase(node.else as Node) : { nodes: 0, commands: 0, iterations: 0, wait: 0, bindings: new Set<string>() };
    return addMetrics(own, {
      nodes: Math.max(thenMetric.nodes, elseMetric.nodes),
      commands: Math.max(thenMetric.commands, elseMetric.commands),
      iterations: Math.max(thenMetric.iterations, elseMetric.iterations),
      wait: Math.max(thenMetric.wait, elseMetric.wait),
      bindings: new Set([...thenMetric.bindings, ...elseMetric.bindings]),
    });
  }
  if (node.type === 'LOOP' || node.type === 'UNTIL') {
    const body = scaleMetrics(estimateWorstCase(node.body as Node), node.maxIterations as number);
    body.iterations += node.maxIterations as number;
    return addMetrics(own, body);
  }
  if (node.type === 'RETRY') return addMetrics(own, scaleMetrics(estimateWorstCase(node.body as Node), (node.policy as Node).attempts as number));
  return own;
}

export async function validateReactiveProgram(input: unknown): Promise<unknown> {
  assertNoSensitive(input, 'program');
  assertExactKeys(
    input,
    ['schemaVersion', 'programId', 'tenantId', 'goalId', 'goalRevision', 'target', 'budgets', 'root', 'programDigest'],
    ['taskDependencies'],
    'program',
  );
  const program = input as Node;
  if (program.taskDependencies !== undefined && program.taskDependencies !== null) {
    assertPlainObject(program.taskDependencies, 'program.taskDependencies');
    assertNoSensitive(program.taskDependencies, 'program.taskDependencies');
    const taskDeps = program.taskDependencies as Node;
    if (taskDeps.source !== 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES') {
      fail('INVALID_SCHEMA', 'program.taskDependencies.source must be ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES.');
    }
    if (taskDeps.goalId !== program.goalId) {
      fail('INVALID_SCHEMA', 'program.taskDependencies.goalId must match program.goalId.');
    }
  }
  if (program.schemaVersion !== PROGRAM_VERSION) fail('INVALID_SCHEMA', 'program.schemaVersion is unsupported.');
  assertId(program.programId, 'program.programId');
  assertId(program.tenantId, 'program.tenantId');
  assertId(program.goalId, 'program.goalId');
  assertSafeInteger(program.goalRevision, 'program.goalRevision', 1, Number.MAX_SAFE_INTEGER);
  validateTarget(program.target);
  validateBudgets(program.budgets);
  if (typeof program.programDigest !== 'string' || !DIGEST_RE.test(program.programDigest)) fail('INVALID_SCHEMA', 'program.programDigest has an invalid format.');

  let serialized = '';
  try {
    serialized = canonicalJson(program);
  } catch {
    fail('INVALID_SEMANTICS', 'program must be acyclic canonical JSON data.');
  }
  const programBytes = byteLength(serialized);
  const byteBudget = (program.budgets as Node).serializedProgramBytes as number;
  if (programBytes > byteBudget || programBytes > REACTIVE_VM_LIMITS.serializedProgramBytes) {
    fail('PROGRAM_TOO_LARGE', 'program exceeds its serialized byte budget.');
  }
  const expectedDigest = await digestCanonical(withoutProgramDigest(program));
  if (expectedDigest !== program.programDigest) fail('PROGRAM_DIGEST_MISMATCH', 'programDigest does not match canonical content.');

  const ctx: WalkContext = { staticNodes: 0, limits: program.budgets as Record<string, number> };
  validateNode(program.root, ctx);
  const metrics = estimateWorstCase(program.root as Node);
  const b = program.budgets as Node;
  if (metrics.nodes > (b.executedNodesPerRun as number)) fail('NODE_BUDGET_EXCEEDED', 'Worst-case executed node budget exceeded.');
  if (metrics.commands > (b.browserCommandLeavesPerRun as number)) fail('COMMAND_BUDGET_EXCEEDED', 'Worst-case command budget exceeded.');
  if (metrics.iterations > (b.totalIterationsPerRun as number)) fail('ITERATION_BUDGET_EXCEEDED', 'Worst-case iteration budget exceeded.');
  if (metrics.wait > (b.cumulativeWaitMs as number)) fail('WAIT_BUDGET_EXCEEDED', 'Worst-case wait budget exceeded.');
  if (metrics.bindings.size > (b.bindings as number)) fail('BINDING_BUDGET_EXCEEDED', 'Worst-case binding budget exceeded.');
  return deepFreeze(cloneJson(program));
}

function compareValues(left: unknown, right: unknown): number | null {
  if (left === null || right === null) return left === right ? 0 : null;
  if (typeof left !== typeof right) return null;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === right ? 0 : left ? 1 : -1;
  return null;
}

function deepEqualCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function pathValue(bindings: unknown, path: string[]): unknown {
  let current: unknown = bindings;
  for (const segment of path) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    if (Array.isArray(current)) current = (current as unknown[])[Number(segment)];
    else current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function evaluateReactiveExpression(expr: unknown, bindings: unknown): unknown {
  validateExpression(expr);
  const typedExpr = expr as Node;
  if (typedExpr.op === 'CONST') return typedExpr.value;
  if (typedExpr.op === 'PATH') {
    if (!Array.isArray(typedExpr.path)) return undefined;
    return pathValue(bindings, typedExpr.path as string[]);
  }
  if (typedExpr.op === 'NOT') return !Boolean(evaluateReactiveExpression(typedExpr.arg, bindings));
  if (typedExpr.op === 'COUNT') {
    const value = evaluateReactiveExpression(typedExpr.arg, bindings);
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    if (isPlainObject(value)) return Object.keys(value).length;
    if (value === null || value === undefined) return 0;
    return 1;
  }
  if (!Array.isArray(typedExpr.args)) return null;
  const values = typedExpr.args.map((arg: unknown) => evaluateReactiveExpression(arg, bindings));
  if (typedExpr.op === 'EQ') return values.every((value: unknown) => deepEqualCanonical(value, values[0]));
  if (typedExpr.op === 'NE') {
    for (let i = 0; i < values.length; i += 1) for (let j = i + 1; j < values.length; j += 1) if (deepEqualCanonical(values[i], values[j])) return false;
    return true;
  }
  if (typedExpr.op === 'AND') return values.every(Boolean);
  if (typedExpr.op === 'OR') return values.some(Boolean);
  if (typedExpr.op === 'IN') {
    const needle = values[0];
    const containers = values.slice(1);
    return containers.some((container: unknown) => Array.isArray(container)
      ? container.some((item: unknown) => deepEqualCanonical(item, needle))
      : typeof container === 'string' && typeof needle === 'string' && container.includes(needle));
  }
  const comparator = ({ LT: (v: number) => v < 0, LTE: (v: number) => v <= 0, GT: (v: number) => v > 0, GTE: (v: number) => v >= 0 } as Record<string, (v: number) => boolean>)[typedExpr.op as string];
  if (comparator) {
    for (let index = 0; index < values.length - 1; index += 1) {
      const comparison = compareValues(values[index], values[index + 1]);
      if (comparison === null || !comparator(comparison)) return false;
    }
    return true;
  }
  fail('UNKNOWN_EXPRESSION', `Expression operator ${String(typedExpr.op)} is unsupported.`);
}
