// @last-edited: 2026-10-04 11:10 UTC.
// @title: multi-signal-relevance-p3 — signal-relevance-p3 — Shared pure module.
// @context: Shared pure module, server and extension.
// @state: refactor(quality): centralize code-unit comparator in lib/canonical-order.js - removes token-identical inline comparator blocks that tripped.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: delta-first-observation-p2, canonical-order.

import { createDeltaFirstObservationPipeline } from './delta-first-observation-p2.js';
import { codeUnitCompare } from './canonical-order.js';

export const P3_DECISIONS = Object.freeze([
  'IGNORE_FOR_TASK',
  'APPLY_AND_CONTINUE',
  'REASON_REQUIRED',
]);

export const P3_SIGNAL_TYPES = Object.freeze([
  'ACTION_RESULT',
  'DOM_MUTATION',
  'GEOMETRY_RESIZE',
  'NAVIGATION_HISTORY',
  'RECONNECT_RESET',
  'SCROLL_VIEWPORT',
  'SEMANTIC_MUTATION',
  'WAIT_CONDITION',
]);

const SIGNAL_TYPES = new Set(P3_SIGNAL_TYPES);
const SAFETY_SIGNAL_TYPES = new Set(['NAVIGATION_HISTORY', 'RECONNECT_RESET']);
const DEFAULT_MAX_SIGNALS_PER_EPOCH = 256;
const DEFAULT_MAX_AFFECTED_KEYS = 512;
const DEFAULT_MAX_DEPENDENCY_KEYS = 512;
const DEFAULT_MAX_EPOCH_AGE_MS = 5_000;
const MAX_SIGNALS_PER_EPOCH = 16_384;
const MAX_AFFECTED_KEYS = 8_192;
const MAX_DEPENDENCY_KEYS = 8_192;
const MAX_EPOCH_AGE_MS = 60_000;
const MAX_ID = 200;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function bounded(value, maximum = MAX_ID) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function positiveInteger(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function identityKey(identity) {
  return JSON.stringify([
    String(identity?.tenantId ?? ''),
    String(identity?.deviceId ?? ''),
    String(identity?.tabId ?? ''),
    identity?.documentGeneration ?? null,
    String(identity?.runtimeEpoch ?? ''),
  ]);
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => bounded(item)).filter(Boolean))];
}

function normalizeSignal(input) {
  if (!isPlainObject(input)) throw new TypeError('signal must be a plain object');
  const type = bounded(input.type, 40);
  if (!SIGNAL_TYPES.has(type)) throw new TypeError('signal.type is unsupported');
  if (input.source !== 'BROWSER_RUNTIME') throw new TypeError('signal.source is unsupported');
  return {
    type,
    logicalIds: normalizeIdList(input.logicalIds),
    regionIds: normalizeIdList(input.regionIds),
    waitConditionIds: normalizeIdList(input.waitConditionIds),
  };
}

function createEpoch(openedAt) {
  return {
    openedAt,
    signalCount: 0,
    signalTypes: new Set(),
    affectedKeys: new Set(),
    overflowReasons: new Set(),
  };
}

function addAffected(epoch, key, maximum) {
  if (epoch.affectedKeys.has(key)) return;
  if (epoch.affectedKeys.size >= maximum) {
    epoch.overflowReasons.add('AFFECTED_KEY_OVERFLOW');
    return;
  }
  epoch.affectedKeys.add(key);
}

function epochSnapshot(epoch, now, maxEpochAgeMs) {
  if (!epoch) {
    return freeze({
      signalCount: 0,
      signalTypes: [],
      affectedDependencyKeys: [],
      overflowed: false,
      overflowReasons: [],
      expired: false,
    });
  }
  const ageMs = Math.max(0, now - epoch.openedAt);
  return freeze({
    signalCount: epoch.signalCount,
    signalTypes: [...epoch.signalTypes].sort(codeUnitCompare),
    affectedDependencyKeys: [...epoch.affectedKeys].sort(codeUnitCompare),
    overflowed: epoch.overflowReasons.size > 0,
    overflowReasons: [...epoch.overflowReasons].sort(codeUnitCompare),
    expired: ageMs > maxEpochAgeMs,
  });
}

function dependencyKeySet(input, prefix, validator = null) {
  if (!Array.isArray(input)) throw new TypeError('dependency list must be an array');
  const output = new Set();
  for (const raw of input) {
    const value = bounded(raw);
    if (!value) throw new TypeError('dependency id is invalid');
    if (validator && !validator(value)) throw new TypeError('dependency value is unsupported');
    output.add(`${prefix}:${value}`);
  }
  return output;
}

function mergeInto(target, source) {
  for (const value of source) target.add(value);
  return target;
}

function normalizeContext(input, maxDependencyKeys) {
  if (input === undefined || input === null) {
    return { status: 'MISSING', reason: new Set(), continuation: new Set() };
  }
  try {
    if (!isPlainObject(input)) throw new TypeError('context must be an object');
    if (input.source !== 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES') throw new TypeError('context source is not accepted');
    if (!bounded(input.goalId, 128)) throw new TypeError('goalId is required');
    if (!Number.isSafeInteger(input.ledgerRevision) || input.ledgerRevision < 1) throw new TypeError('ledgerRevision is invalid');
    if (typeof input.ledgerDigest !== 'string' || !DIGEST.test(input.ledgerDigest)) throw new TypeError('ledgerDigest is invalid');
    if (!isPlainObject(input.reasonDependencies) || !isPlainObject(input.continueDependencies)) {
      throw new TypeError('dependency groups are required');
    }

    const reason = new Set();
    const continuation = new Set();
    const addGroup = (target, group) => {
      mergeInto(target, dependencyKeySet(group.entityIds, 'entity'));
      mergeInto(target, dependencyKeySet(group.viewIds, 'view'));
      mergeInto(target, dependencyKeySet(group.waitConditionIds, 'wait'));
      mergeInto(target, dependencyKeySet(group.signalTypes, 'signal', (value) => SIGNAL_TYPES.has(value)));
    };
    addGroup(reason, input.reasonDependencies);
    addGroup(continuation, input.continueDependencies);
    if (reason.size + continuation.size > maxDependencyKeys) throw new TypeError('dependency context exceeds its bound');
    return { status: 'ACCEPTED', reason, continuation };
  } catch {
    return { status: 'INVALID', reason: new Set(), continuation: new Set() };
  }
}

function semanticAffectedKeys(reasoningObservation) {
  const keys = new Set();
  if (reasoningObservation?.kind !== 'COMPACT_PATCH') return keys;
  const patch = reasoningObservation.patch || {};
  for (const group of ['insertedEntities', 'updatedEntities', 'movedEntities']) {
    for (const item of Array.isArray(patch[group]) ? patch[group] : []) {
      const id = bounded(item?.logicalId);
      if (id) keys.add(`entity:${id}`);
    }
  }
  for (const raw of Array.isArray(patch.removedLogicalIds) ? patch.removedLogicalIds : []) {
    const id = bounded(raw);
    if (id) keys.add(`entity:${id}`);
  }
  for (const group of ['changedViews', 'invalidatedViews']) {
    for (const item of Array.isArray(patch[group]) ? patch[group] : []) {
      const id = bounded(item?.regionId);
      if (id) keys.add(`view:${id}`);
    }
  }
  for (const raw of Array.isArray(patch.removedViewIds) ? patch.removedViewIds : []) {
    const id = bounded(raw);
    if (id) keys.add(`view:${id}`);
  }
  return keys;
}

function intersections(affected, dependencies) {
  return [...affected].filter((key) => dependencies.has(key)).sort(codeUnitCompare);
}

export function createMultiSignalRelevancePipeline(options = {}) {
  const maxSignalsPerEpoch = positiveInteger(
    options.maxSignalsPerEpoch,
    DEFAULT_MAX_SIGNALS_PER_EPOCH,
    MAX_SIGNALS_PER_EPOCH,
  );
  const maxAffectedKeysPerEpoch = positiveInteger(
    options.maxAffectedKeysPerEpoch,
    DEFAULT_MAX_AFFECTED_KEYS,
    MAX_AFFECTED_KEYS,
  );
  const maxDependencyKeys = positiveInteger(
    options.maxDependencyKeys,
    DEFAULT_MAX_DEPENDENCY_KEYS,
    MAX_DEPENDENCY_KEYS,
  );
  const maxEpochAgeMs = positiveInteger(
    options.maxEpochAgeMs,
    DEFAULT_MAX_EPOCH_AGE_MS,
    MAX_EPOCH_AGE_MS,
  );
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const deltaPipeline = createDeltaFirstObservationPipeline(options);
  const epochs = new Map();

  function currentNow() {
    const value = Number(now());
    if (!Number.isFinite(value) || value < 0) throw new TypeError('clock must be finite and non-negative');
    return value;
  }

  function recordSignal(identity, input) {
    const signal = normalizeSignal(input);
    const key = identityKey(identity);
    let epoch = epochs.get(key);
    if (!epoch) {
      epoch = createEpoch(currentNow());
      epochs.set(key, epoch);
    }
    epoch.signalCount += 1;
    if (epoch.signalCount > maxSignalsPerEpoch) epoch.overflowReasons.add('SIGNAL_OVERFLOW');
    epoch.signalTypes.add(signal.type);
    addAffected(epoch, `signal:${signal.type}`, maxAffectedKeysPerEpoch);
    for (const logicalId of signal.logicalIds) addAffected(epoch, `entity:${logicalId}`, maxAffectedKeysPerEpoch);
    for (const regionId of signal.regionIds) addAffected(epoch, `view:${regionId}`, maxAffectedKeysPerEpoch);
    for (const waitId of signal.waitConditionIds) addAffected(epoch, `wait:${waitId}`, maxAffectedKeysPerEpoch);
    return epochSnapshot(epoch, currentNow(), maxEpochAgeMs);
  }

  function inspectEpoch(identity) {
    const epoch = epochs.get(identityKey(identity));
    return epoch ? epochSnapshot(epoch, currentNow(), maxEpochAgeMs) : null;
  }

  function reconcile(identity, observation, taskContext) {
    const key = identityKey(identity);
    const timestamp = currentNow();
    const epoch = epochs.get(key) || null;
    const epochView = epochSnapshot(epoch, timestamp, maxEpochAgeMs);
    epochs.delete(key);

    const p2 = deltaPipeline.observe(identity, observation);
    const context = normalizeContext(taskContext, maxDependencyKeys);
    const affected = new Set(epochView.affectedDependencyKeys);
    for (const semanticKey of semanticAffectedKeys(p2.reasoningObservation)) affected.add(semanticKey);

    const safetyReasons = new Set(epochView.overflowReasons);
    if (epochView.expired) safetyReasons.add('EPOCH_EXPIRED');
    for (const type of epochView.signalTypes) {
      if (SAFETY_SIGNAL_TYPES.has(type)) safetyReasons.add(type);
    }
    if (p2.reasoningObservation?.resetRequired === true || p2.canonicalState === null) {
      safetyReasons.add('P2_RESET_REQUIRED');
    }

    const matchedReasonDependencyKeys = context.status === 'ACCEPTED'
      ? intersections(affected, context.reason)
      : [];
    const matchedContinueDependencyKeys = context.status === 'ACCEPTED'
      ? intersections(affected, context.continuation)
      : [];

    let decision;
    if (p2.reasoningObservation?.kind === 'FULL_SNAPSHOT') decision = 'REASON_REQUIRED';
    else if (safetyReasons.size > 0) decision = 'REASON_REQUIRED';
    else if (context.status !== 'ACCEPTED') decision = 'REASON_REQUIRED';
    else if (matchedReasonDependencyKeys.length > 0) decision = 'REASON_REQUIRED';
    else if (matchedContinueDependencyKeys.length > 0) decision = 'APPLY_AND_CONTINUE';
    else decision = 'IGNORE_FOR_TASK';

    const reasoningWakeRequired = decision === 'REASON_REQUIRED';
    return freeze({
      decision,
      reasoningWakeRequired,
      reasoningObservation: reasoningWakeRequired ? p2.reasoningObservation : null,
      canonicalState: p2.canonicalState,
      epoch: epochView,
      relevance: {
        contextStatus: context.status,
        matchedReasonDependencyKeys,
        matchedContinueDependencyKeys,
        safetyReasons: [...safetyReasons].sort(codeUnitCompare),
      },
    });
  }

  function clear() {
    epochs.clear();
    deltaPipeline.clear();
  }

  return Object.freeze({
    recordSignal,
    reconcile,
    inspectEpoch,
    clear,
  });
}
