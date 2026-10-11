// @last-edited: 2026-10-08 UTC+7.
// @title: seal-vm-program — seal — Repository file.
// @state: run_program sealing extracted from the MCP entrypoint, unchanged behavior.
// @dependencies: goal-ledger.

import { digestCanonical } from './goal-ledger.js';

export class CommandFailure extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'CommandFailure';
    this.code = code;
    this.details = details;
  }
}

export const VM_PROGRAM_VERSION = 'OA_REACTIVE_VM_V1';

export const VM_READ_ONLY_METHODS = new Set([
  'browser.ping', 'browser.burst', 'tabs.list', 'tabs.get', 'tabs.find',
  'page.read', 'page.query', 'page.find', 'page.collect_links', 'page.capture',
  'page.wait_for', 'media.state'
]);

export const VM_OBSERVATION_METHODS = new Set([
  'page.read', 'page.query', 'page.find', 'page.collect_links', 'page.capture',
  'page.wait_for', 'media.state'
]);

export const VM_BURST_STEP_ACTIONS = new Set(['read', 'find', 'wait']);

export const VM_BUDGET_MAXIMA = {
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
  runDeadlineMs: 300000
};

export const VM_BUDGET_DEFAULTS = {
  serializedProgramBytes: 16384,
  astNodes: 64,
  astDepth: 8,
  controlFlowDepth: 2,
  executedNodesPerRun: 200,
  browserCommandLeavesPerRun: 12,
  iterationsPerLoop: 10,
  totalIterationsPerRun: 50,
  waitEventTimeoutMs: 5000,
  cumulativeWaitMs: 15000,
  retryAttemptsPerNode: 2,
  collectionItemsPerBinding: 100,
  bindings: 16,
  persistedCheckpointBytes: 16384,
  returnedResultBytes: 16384,
  executionSliceMs: 8000,
  runDeadlineMs: 60000
};

function isVmRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertSealableNode(node, path, depth = 1) {
  if (depth > 64) throw new CommandFailure('INVALID_PROGRAM', `${path} nests deeper than the sealing walk.`);
  if (!isVmRecord(node)) throw new CommandFailure('INVALID_PROGRAM', `${path} must be an object.`);
  if (Object.hasOwn(node, 'steps')) {
    throw new CommandFailure('INVALID_PROGRAM', `${path} must use children, never steps.`);
  }
  switch (node.type) {
    case 'SEQUENCE': {
      if (!Array.isArray(node.children)) throw new CommandFailure('INVALID_PROGRAM', `${path}.children must be an array.`);
      node.children.forEach((child, index) => assertSealableNode(child, `${path}.children[${index}]`, depth + 1));
      return;
    }
    case 'IF': {
      assertSealableNode(node.then, `${path}.then`, depth + 1);
      if (node.else !== undefined) assertSealableNode(node.else, `${path}.else`, depth + 1);
      return;
    }
    case 'LOOP':
    case 'UNTIL':
    case 'RETRY': {
      assertSealableNode(node.body, `${path}.body`, depth + 1);
      return;
    }
    case 'COMMAND': {
      if (typeof node.method !== 'string' || !VM_READ_ONLY_METHODS.has(node.method)) {
        throw new CommandFailure('DISALLOWED_COMMAND', `${path}.method is not read-only in OA_REACTIVE_VM_V1.`);
      }
      if (node.method === 'browser.burst') {
        const args = isVmRecord(node.arguments) ? node.arguments : null;
        const steps = args && Array.isArray(args.steps) ? args.steps : null;
        if (!steps || steps.length < 1 || steps.some((step) => !isVmRecord(step) || !VM_BURST_STEP_ACTIONS.has(String(step.action)))) {
          throw new CommandFailure('DISALLOWED_COMMAND', `${path} carries a disallowed browser.burst step.`);
        }
      }
      return;
    }
    case 'WAIT_EVENT': {
      const observation = isVmRecord(node.observation) ? node.observation : null;
      if (!observation || typeof observation.method !== 'string' || !VM_OBSERVATION_METHODS.has(observation.method)) {
        throw new CommandFailure('DISALLOWED_COMMAND', `${path}.observation.method is not read-only.`);
      }
      return;
    }
    case 'ASSERT':
    case 'COLLECT':
    case 'DEDUP':
    case 'RETURN':
    case 'SUSPEND':
      return;
    default:
      throw new CommandFailure('INVALID_PROGRAM', `${path}.type is not executable in OA_REACTIVE_VM_V1.`);
  }
}

export async function sealVmProgram(programInput, caller) {
  if (!caller || typeof caller.userId !== 'string' || !caller.userId) {
    throw new CommandFailure('UNAUTHORIZED', 'run_program needs a user access token; the static token names no tenant, so the VM host could not scope the run.');
  }
  if (!isVmRecord(programInput)) throw new CommandFailure('INVALID_PROGRAM', 'program must be an object.');
  if (programInput.schemaVersion !== VM_PROGRAM_VERSION) {
    throw new CommandFailure('INVALID_PROGRAM', 'program.schemaVersion must be OA_REACTIVE_VM_V1.');
  }
  for (const field of ['programId', 'goalId']) {
    const value = programInput[field];
    if (typeof value !== 'string' || value.length < 1 || new TextEncoder().encode(value).length > 128) {
      throw new CommandFailure('INVALID_PROGRAM', `program.${field} must be a bounded string.`);
    }
  }
  if (!Number.isSafeInteger(programInput.goalRevision) || programInput.goalRevision < 1) {
    throw new CommandFailure('INVALID_PROGRAM', 'program.goalRevision must be a positive integer.');
  }
  if (!isVmRecord(programInput.target)) throw new CommandFailure('INVALID_PROGRAM', 'program.target must be an object.');
  const root = programInput.root;
  if (!isVmRecord(root) || !Array.isArray(root.children)) {
    throw new CommandFailure('INVALID_PROGRAM', 'program.root must use children, never steps.');
  }
  assertSealableNode(root, 'program.root');
  const provided = isVmRecord(programInput.budgets) ? programInput.budgets : {};
  const budgets = {};
  for (const key of Object.keys(VM_BUDGET_MAXIMA)) {
    if (!Object.hasOwn(provided, key)) {
      budgets[key] = VM_BUDGET_DEFAULTS[key];
      continue;
    }
    const value = provided[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new CommandFailure('INVALID_SCHEMA', `program.budgets.${key} must be a positive integer.`);
    }
    if (value > VM_BUDGET_MAXIMA[key]) {
      throw new CommandFailure('OVER_LIMIT', `program.budgets.${key} exceeds the frozen maximum ${VM_BUDGET_MAXIMA[key]}.`);
    }
    budgets[key] = value;
  }
  for (const key of Object.keys(provided)) {
    if (!Object.hasOwn(VM_BUDGET_MAXIMA, key)) throw new CommandFailure('INVALID_SCHEMA', `program.budgets.${key} is not a VM budget.`);
  }
  const { programDigest: _ignored, ...body } = programInput;
  const sealed = { ...body, budgets, tenantId: caller.userId };
  sealed.programDigest = await digestCanonical(sealed);
  return sealed;
}
