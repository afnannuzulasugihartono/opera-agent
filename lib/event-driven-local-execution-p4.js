import {
  advanceReactiveVm7D,
  createReactiveVm7D,
  validateReactiveProgram7D,
} from './reactive-vm-7d.js';

export const P4_OUTCOMES = Object.freeze([
  'IDLE',
  'LOCAL_EFFECT_REQUIRED',
  'LOCAL_TERMINAL',
  'REASON_REQUIRED',
]);

export const P4_YIELD_REASONS = Object.freeze([
  'AMBIGUITY',
  'BUDGET_EXHAUSTED',
  'CANCELLED',
  'DECISION_REQUIRED',
  'EXPIRED',
  'FAILURE',
  'RESET_REQUIRED',
  'STABLE_BOUNDARY',
  'SUCCESS',
]);

const TERMINAL = new Set(['RETURNED', 'SUSPENDED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const DEFAULT_MAX_LOCAL_STEPS = 64;
const MAX_LOCAL_STEPS = 1024;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeInteger(value, fallback, maximum) {
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function identityKey(identity) {
  return JSON.stringify([
    String(identity?.tenantId ?? ''),
    String(identity?.deviceId ?? ''),
    identity?.tabId ?? null,
    identity?.documentGeneration ?? null,
    String(identity?.runtimeEpoch ?? ''),
  ]);
}

function validateIdentity(identity) {
  if (!isPlainObject(identity)) throw new TypeError('identity must be a plain object');
  if (!String(identity.tenantId ?? '')) throw new TypeError('identity.tenantId is required');
  if (!String(identity.deviceId ?? '')) throw new TypeError('identity.deviceId is required');
  if (!Number.isSafeInteger(identity.tabId) || identity.tabId < 0) throw new TypeError('identity.tabId is invalid');
  if (identity.documentGeneration === undefined || identity.documentGeneration === null) {
    throw new TypeError('identity.documentGeneration is required');
  }
  if (!String(identity.runtimeEpoch ?? '')) throw new TypeError('identity.runtimeEpoch is required');
  return identity;
}

function frozenResult(value) {
  return deepFreeze(value);
}

function reasoningResult(yieldReason, extra = {}) {
  return frozenResult({
    outcome: 'REASON_REQUIRED',
    yieldReason,
    reasoningWakeRequired: true,
    ...extra,
  });
}

function localTerminal(yieldReason, state) {
  return frozenResult({
    outcome: 'LOCAL_TERMINAL',
    yieldReason,
    reasoningWakeRequired: false,
    terminalStatus: state.status,
    result: state.result,
  });
}

function localEffect(state, request) {
  return frozenResult({
    outcome: 'LOCAL_EFFECT_REQUIRED',
    reasoningWakeRequired: false,
    effectRequest: request,
    localStatus: state.status,
  });
}

function idleResult(state, extra = {}) {
  return frozenResult({
    outcome: 'IDLE',
    reasoningWakeRequired: false,
    localStatus: state.status,
    ...extra,
  });
}

function stableBoundaryReached(state) {
  if (!isPlainObject(state?.bindings)) return false;
  return Object.values(state.bindings).some((binding) => (
    isPlainObject(binding)
    && isPlainObject(binding.completion)
    && binding.completion.completeWithinScope === true
    && binding.completion.status === 'BOUNDED_COMPLETE'
  ));
}

function terminalOutcome(state) {
  if (state.status === 'RETURNED') {
    return localTerminal(stableBoundaryReached(state) ? 'STABLE_BOUNDARY' : 'SUCCESS', state);
  }
  if (state.status === 'CANCELLED') return localTerminal('CANCELLED', state);
  if (state.status === 'EXPIRED') return localTerminal('EXPIRED', state);
  if (state.status === 'LIMIT_REACHED') {
    return reasoningResult('BUDGET_EXHAUSTED', { terminalStatus: state.status });
  }
  if (state.status === 'FAILED') {
    return reasoningResult('FAILURE', { terminalStatus: state.status });
  }
  if (state.status === 'SUSPENDED') {
    const reason = state.suspension?.reason;
    if (reason === 'AMBIGUOUS_TARGET') {
      return reasoningResult('AMBIGUITY', { terminalStatus: state.status });
    }
    if (reason === 'LIMIT_REACHED') {
      return reasoningResult('BUDGET_EXHAUSTED', { terminalStatus: state.status });
    }
    if (reason === 'STALE_TARGET') {
      return reasoningResult('RESET_REQUIRED', { terminalStatus: state.status });
    }
    if (['ASSERTION_FAILED', 'UNEXPECTED_STATE', 'CONTRADICTION'].includes(reason)) {
      return reasoningResult('FAILURE', { terminalStatus: state.status });
    }
    return reasoningResult('DECISION_REQUIRED', { terminalStatus: state.status });
  }
  return reasoningResult('FAILURE');
}

function safeInspect(entry) {
  if (!entry) return null;
  const state = entry.state;
  return frozenResult({
    status: state.status,
    runId: state.runId,
    programDigest: state.programDigest,
    goalId: state.goalId,
    goalRevision: state.goalRevision,
    terminal: TERMINAL.has(state.status),
    pendingEffect: state.pendingEffect !== null,
    counters: {
      executedNodes: state.counters?.executedNodes ?? 0,
      commandLeaves: state.counters?.commandLeaves ?? 0,
    },
  });
}

function isAcceptedRelevanceBase(gate) {
  return isPlainObject(gate)
    && isPlainObject(gate.relevance)
    && gate.relevance.contextStatus === 'ACCEPTED'
    && Array.isArray(gate.relevance.matchedReasonDependencyKeys)
    && Array.isArray(gate.relevance.matchedContinueDependencyKeys)
    && Array.isArray(gate.relevance.safetyReasons)
    && isPlainObject(gate.epoch)
    && gate.epoch.overflowed === false
    && gate.epoch.expired === false;
}

function resetRequired(gate) {
  return isPlainObject(gate)
    && (
      gate.reasoningObservation?.resetRequired === true
      || (gate.reasoningObservation?.kind === 'FULL_SNAPSHOT' && gate.canonicalState === null)
      || (Array.isArray(gate.relevance?.safetyReasons) && gate.relevance.safetyReasons.includes('P2_RESET_REQUIRED'))
    );
}

function acceptedIgnore(gate) {
  return isAcceptedRelevanceBase(gate)
    && gate.decision === 'IGNORE_FOR_TASK'
    && gate.reasoningWakeRequired === false
    && gate.reasoningObservation === null
    && isPlainObject(gate.canonicalState)
    && gate.relevance.matchedReasonDependencyKeys.length === 0
    && gate.relevance.matchedContinueDependencyKeys.length === 0
    && gate.relevance.safetyReasons.length === 0;
}

function acceptedContinue(gate) {
  return isAcceptedRelevanceBase(gate)
    && gate.decision === 'APPLY_AND_CONTINUE'
    && gate.reasoningWakeRequired === false
    && gate.reasoningObservation === null
    && isPlainObject(gate.canonicalState)
    && gate.relevance.matchedReasonDependencyKeys.length === 0
    && gate.relevance.matchedContinueDependencyKeys.length > 0
    && gate.relevance.safetyReasons.length === 0;
}

function acceptedReason(gate) {
  return isPlainObject(gate)
    && gate.decision === 'REASON_REQUIRED'
    && gate.reasoningWakeRequired === true;
}

function effectProvenanceMatches(identity, effectResult) {
  if (!isPlainObject(effectResult) || !isPlainObject(effectResult.provenance)) return false;
  const provenance = effectResult.provenance;
  return provenance.tenantId === identity.tenantId
    && provenance.deviceId === identity.deviceId
    && provenance.tabId === identity.tabId
    && provenance.documentGeneration === identity.documentGeneration;
}

export function createEventDrivenLocalExecutionP4(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const maxLocalStepsPerSlice = safeInteger(
    options.maxLocalStepsPerSlice,
    DEFAULT_MAX_LOCAL_STEPS,
    MAX_LOCAL_STEPS,
  );
  const runs = new Map();

  function currentNow() {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('clock must return a non-negative safe integer');
    return value;
  }

  async function drive(entry, initialInput = null) {
    let remaining = maxLocalStepsPerSlice;
    let input = initialInput;

    while (remaining > 0) {
      if (TERMINAL.has(entry.state.status)) return terminalOutcome(entry.state);
      let advanced;
      try {
        advanced = await advanceReactiveVm7D(entry.program, entry.state, input ?? { logicalNowMs: currentNow() });
      } catch {
        runs.delete(entry.key);
        return reasoningResult('FAILURE');
      }
      entry.state = advanced.state;
      remaining -= 1;
      input = null;

      if (advanced.transition?.kind === 'EFFECT_REQUEST') {
        return localEffect(entry.state, advanced.transition.request);
      }
      if (advanced.transition?.kind === 'AWAITING_EFFECT' && entry.state.pendingEffect) {
        return localEffect(entry.state, entry.state.pendingEffect);
      }
      if (advanced.transition?.kind === 'WAITING_EVENT') {
        return idleResult(entry.state, { nextLocalAtMs: advanced.transition.nextPollAtMs });
      }
      if (advanced.transition?.kind === 'WAITING_RETRY') {
        return idleResult(entry.state, { nextLocalAtMs: advanced.transition.notBeforeMs });
      }
      if (TERMINAL.has(entry.state.status)) return terminalOutcome(entry.state);
    }

    return reasoningResult('BUDGET_EXHAUSTED', { localStatus: entry.state.status });
  }

  async function register(identityInput, programInput, vmOptions) {
    const identity = validateIdentity(identityInput);
    const program = await validateReactiveProgram7D(programInput);
    if (program.tenantId !== identity.tenantId
        || program.target.deviceId !== identity.deviceId
        || program.target.tabId !== identity.tabId
        || (program.target.documentGeneration !== undefined
          && program.target.documentGeneration !== identity.documentGeneration)) {
      throw new TypeError('program target does not match local execution identity');
    }
    const state = await createReactiveVm7D(program, vmOptions);
    const key = identityKey(identity);
    const entry = { key, identity: { ...identity }, program, state };
    runs.set(key, entry);
    return safeInspect(entry);
  }

  async function applyRelevance(identityInput, gate) {
    const identity = validateIdentity(identityInput);
    const key = identityKey(identity);
    const entry = runs.get(key);

    if (!entry) return reasoningResult('DECISION_REQUIRED');
    if (resetRequired(gate)) {
      runs.delete(key);
      return reasoningResult('RESET_REQUIRED');
    }
    if (acceptedIgnore(gate)) return idleResult(entry.state);
    if (acceptedReason(gate)) return reasoningResult('DECISION_REQUIRED');
    if (!acceptedContinue(gate)) return reasoningResult('DECISION_REQUIRED');
    return drive(entry);
  }

  async function resumeEffect(identityInput, effectResult) {
    const identity = validateIdentity(identityInput);
    const key = identityKey(identity);
    const entry = runs.get(key);
    if (!entry || !entry.state.pendingEffect) return reasoningResult('FAILURE');
    if (!effectProvenanceMatches(identity, effectResult)) {
      runs.delete(key);
      return reasoningResult('FAILURE');
    }
    return drive(entry, { logicalNowMs: currentNow(), effectResult });
  }

  async function cancel(identityInput) {
    const identity = validateIdentity(identityInput);
    const key = identityKey(identity);
    const entry = runs.get(key);
    if (!entry) return reasoningResult('DECISION_REQUIRED');
    if (TERMINAL.has(entry.state.status)) return terminalOutcome(entry.state);
    try {
      const advanced = await advanceReactiveVm7D(entry.program, entry.state, {
        logicalNowMs: currentNow(),
        cancelled: true,
      });
      entry.state = advanced.state;
      return terminalOutcome(entry.state);
    } catch {
      runs.delete(key);
      return reasoningResult('FAILURE');
    }
  }

  function inspect(identityInput) {
    const identity = validateIdentity(identityInput);
    return safeInspect(runs.get(identityKey(identity)) ?? null);
  }

  function clear() {
    runs.clear();
  }

  return Object.freeze({
    register,
    applyRelevance,
    resumeEffect,
    cancel,
    inspect,
    clear,
  });
}
