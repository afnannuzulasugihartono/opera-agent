// @last-edited: 2026-10-08 UTC+7.
// @title: adhoc-compile — pure ad-hoc graph compiler shared by edge and tests.
// @state: validates an ad-hoc graph into a runner-shaped definition: allowlists, label plus confirm rules, budgets.
// @dependencies: none.

export const MAX_COMMAND_NODES = 12;
export const MAX_DEFINITION_BYTES = 32768;
export const REPEAT_MAX = 6;

const FOREACH_MAX = 100;
const WAIT_MAX_MS = 120000;

const READ_METHODS = new Set([
  'page.read',
  'page.find',
  'page.query',
  'page.collect_links',
  'page.scroll',
  'page.wait_for',
  'tabs.list',
  'tabs.get',
  'tabs.find',
  'media.state',
]);

const WRITE_METHODS = new Set(['page.click', 'page.fill', 'page.key', 'page.focus']);

const ALLOWED_METHODS = new Set([...READ_METHODS, ...WRITE_METHODS]);

const LABEL_METHODS = new Set(['page.click', 'page.fill']);

const CONSEQUENTIAL_LABEL = /pay|buy|checkout|submit|delete|remove|send|publish|subscribe|transfer|password|passcode|otp|2fa|card|cvv/i;

const NODE_TYPES = new Set(['command', 'if', 'repeat', 'foreach', 'set', 'wait', 'fail']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
}

function fail(code, message) {
  return { ok: false, code, message };
}

function compileList(nodes, path, state) {
  const steps = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const out = compileNode(nodes[index], `${path}[${index}]`, state);
    if (!out.ok) return out;
    steps.push(out.step);
  }
  return { ok: true, steps };
}

function branchList(node, field, path) {
  if (node[field] === undefined) return { ok: true, nodes: [] };
  if (!Array.isArray(node[field])) return fail('UNKNOWN_NODE_TYPE', `${path}: ${field} must be an array.`);
  return { ok: true, nodes: node[field] };
}

function compileCommand(node, path, state) {
  if (typeof node.method !== 'string' || !ALLOWED_METHODS.has(node.method)) {
    return fail('METHOD_NOT_ALLOWED', `${path}: method ${String(node.method)} is not allowlisted.`);
  }
  const step = { type: 'command', method: node.method, params: node.params === undefined ? {} : node.params };
  if (typeof node.id === 'string' && node.id.length > 0) step.id = node.id;
  if (LABEL_METHODS.has(node.method)) {
    if (typeof node.declaredLabel !== 'string' || node.declaredLabel.trim().length === 0) {
      return fail('LABEL_REQUIRED', `${path}: ${node.method} requires a non-empty declaredLabel.`);
    }
    step.declaredLabel = node.declaredLabel;
    const match = node.declaredLabel.match(CONSEQUENTIAL_LABEL);
    if (match && node.confirm !== true) {
      return fail('CONFIRM_REQUIRED', `${path}: consequential label requires confirm: true.`);
    }
    if (node.confirm === true) step.confirmed = true;
    if (match) step.confirmPattern = match[0];
  } else if (node.confirm === true) step.confirmed = true;
  state.commands += 1;
  return { ok: true, step };
}

function compileIf(node, path, state) {
  const thenRaw = branchList(node, 'then', path);
  if (!thenRaw.ok) return thenRaw;
  const elseRaw = branchList(node, 'else', path);
  if (!elseRaw.ok) return elseRaw;
  const thenOut = compileList(thenRaw.nodes, `${path}.then`, state);
  if (!thenOut.ok) return thenOut;
  const elseOut = compileList(elseRaw.nodes, `${path}.else`, state);
  if (!elseOut.ok) return elseOut;
  const step = { type: 'if', then: thenOut.steps, else: elseOut.steps };
  if (node.condition !== undefined) step.condition = node.condition;
  return { ok: true, step };
}

function compileLoop(kind, node, path, state) {
  const raw = branchList(node, 'steps', path);
  if (!raw.ok) return raw;
  if (kind === 'repeat') {
    if (!Number.isSafeInteger(node.maxIterations) || node.maxIterations < 1 || node.maxIterations > REPEAT_MAX) {
      return fail('BUDGET_EXCEEDED', `${path}: maxIterations must be an integer from 1 to ${REPEAT_MAX}.`);
    }
  } else if (!Number.isSafeInteger(node.maxItems) || node.maxItems < 1 || node.maxItems > FOREACH_MAX) {
    return fail('BUDGET_EXCEEDED', `${path}: maxItems must be an integer from 1 to ${FOREACH_MAX}.`);
  }
  const out = compileList(raw.nodes, `${path}.steps`, state);
  if (!out.ok) return out;
  const step = { type: kind, steps: out.steps };
  if (kind === 'repeat') {
    step.maxIterations = node.maxIterations;
    if (node.until !== undefined) step.until = node.until;
    if (node.failOnLimit !== undefined) step.failOnLimit = node.failOnLimit;
  } else {
    if (node.items !== undefined) step.items = node.items;
    if (node.itemVar !== undefined) step.itemVar = node.itemVar;
    step.maxItems = node.maxItems;
    if (node.collectVar !== undefined) step.collectVar = node.collectVar;
    if (node.collect !== undefined) step.collect = node.collect;
  }
  return { ok: true, step };
}

function compileNode(node, path, state) {
  if (!isPlainObject(node) || typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) {
    return fail('UNKNOWN_NODE_TYPE', `${path}: unknown node type.`);
  }
  if (node.type === 'command') return compileCommand(node, path, state);
  if (node.type === 'if') return compileIf(node, path, state);
  if (node.type === 'repeat' || node.type === 'foreach') return compileLoop(node.type, node, path, state);
  if (node.type === 'set') {
    const step = { type: 'set' };
    if (node.name !== undefined) step.name = node.name;
    if (node.value !== undefined) step.value = node.value;
    return { ok: true, step };
  }
  if (node.type === 'wait') {
    if (typeof node.ms === 'number' && node.ms > WAIT_MAX_MS) {
      return fail('BUDGET_EXCEEDED', `${path}: wait ms above ${WAIT_MAX_MS} is refused.`);
    }
    const step = { type: 'wait' };
    if (node.ms !== undefined) step.ms = node.ms;
    return { ok: true, step };
  }
  const step = { type: 'fail' };
  if (node.code !== undefined) step.code = node.code;
  if (node.message !== undefined) step.message = node.message;
  return { ok: true, step };
}

export function compileAdhocGraph(graph) {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) {
    return fail('GRAPH_NOT_OBJECT', 'graph must be an object with a nodes array.');
  }
  let raw;
  try {
    raw = JSON.stringify(graph);
  } catch (_error) {
    return fail('GRAPH_NOT_OBJECT', 'graph must be JSON-serializable.');
  }
  if (utf8Bytes(raw) > MAX_DEFINITION_BYTES) {
    return fail('GRAPH_TOO_LARGE', `graph exceeds ${MAX_DEFINITION_BYTES} bytes.`);
  }
  const state = { commands: 0 };
  const out = compileList(graph.nodes, 'nodes', state);
  if (!out.ok) return out;
  if (state.commands > MAX_COMMAND_NODES) {
    return fail('BUDGET_EXCEEDED', `graph has ${state.commands} command nodes; the cap is ${MAX_COMMAND_NODES}.`);
  }
  const definition = { steps: out.steps, output: { result: { $ref: 'steps' }, status: 'completed' } };
  if (utf8Bytes(JSON.stringify(definition)) > MAX_DEFINITION_BYTES) {
    return fail('GRAPH_TOO_LARGE', `definition exceeds ${MAX_DEFINITION_BYTES} bytes.`);
  }
  return { ok: true, definition };
}
