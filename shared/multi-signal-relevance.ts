// @last-edited: 2026-10-21 UTC+7.
// @title: multi-signal-relevance — the signals that say a page changed, and whether the change matters.
// @state: the signal kinds, the epochs they group into, and the relevance each epoch produces.
// @dependencies: delta-first-observation, canonical-order.

import { createDeltaFirstObservationPipeline, type DeltaFirstObservationResult, type ReasoningObservation } from './delta-first-observation.js';
import { codeUnitCompare } from './canonical-order.js';

export interface MultiSignalRelevanceOptions {
  maxSignalsPerEpoch?: number;
  maxAffectedKeysPerEpoch?: number;
  maxDependencyKeys?: number;
  maxEpochAgeMs?: number;
  now?: () => number;
  maxEntitiesPerState?: number;
  maxViewsPerState?: number;
  maxStateBytes?: number;
  maxAgeMs?: number;
  maxPatchBytes?: number;
  maxStates?: number;
}

export interface MultiSignalSignal {
  type: string;
  logicalIds: string[];
  regionIds: string[];
  waitConditionIds: string[];
}

export interface EpochSnapshot {
  signalCount: number;
  signalTypes: string[];
  affectedDependencyKeys: string[];
  overflowed: boolean;
  overflowReasons: string[];
  expired: boolean;
}

export interface RelevanceDecision {
  decision: 'REASON_REQUIRED' | 'APPLY_AND_CONTINUE' | 'IGNORE_FOR_TASK';
  reasoningWakeRequired: boolean;
  reasoningObservation: ReasoningObservation | null;
  canonicalState: DeltaFirstObservationResult['canonicalState'];
  epoch: EpochSnapshot;
  relevance: {
    contextStatus: 'MISSING' | 'ACCEPTED' | 'INVALID';
    matchedReasonDependencyKeys: string[];
    matchedContinueDependencyKeys: string[];
    safetyReasons: string[];
  };
}

export interface MultiSignalRelevancePipeline {
  recordSignal(identity: unknown, input: unknown): EpochSnapshot;
  reconcile(identity: unknown, observation: unknown, taskContext: unknown): RelevanceDecision;
  inspectEpoch(identity: unknown): EpochSnapshot | null;
  clear(): void;
}

interface EpochCounter {
  openedAt: number;
  signalCount: number;
  signalTypes: Set<string>;
  affectedKeys: Set<string>;
  overflowReasons: Set<string>;
}

const P3_SIGNAL_TYPES = Object.freeze([
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function bounded(value: unknown, maximum: number = MAX_ID): string {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? Math.min(value as number, maximum) : fallback;
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value as object)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value as T & object) as T;
}

function identityKey(identity: unknown): string {
  const input = (identity ?? {}) as { tenantId?: unknown; deviceId?: unknown; tabId?: unknown; documentGeneration?: unknown; runtimeEpoch?: unknown };
  return JSON.stringify([
    String(input.tenantId ?? ''),
    String(input.deviceId ?? ''),
    String(input.tabId ?? ''),
    input.documentGeneration ?? null,
    String(input.runtimeEpoch ?? ''),
  ]);
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => bounded(item)).filter(Boolean))];
}

function normalizeSignal(input: unknown): MultiSignalSignal {
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

function createEpoch(openedAt: number): EpochCounter {
  return {
    openedAt,
    signalCount: 0,
    signalTypes: new Set(),
    affectedKeys: new Set(),
    overflowReasons: new Set(),
  };
}

function addAffected(epoch: EpochCounter, key: string, maximum: number): void {
  if (epoch.affectedKeys.has(key)) return;
  if (epoch.affectedKeys.size >= maximum) {
    epoch.overflowReasons.add('AFFECTED_KEY_OVERFLOW');
    return;
  }
  epoch.affectedKeys.add(key);
}

function epochSnapshot(epoch: EpochCounter | undefined, now: number, maxEpochAgeMs: number): EpochSnapshot {
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

function dependencyKeySet(input: unknown, prefix: string, validator: ((value: string) => boolean) | null = null): Set<string> {
  if (!Array.isArray(input)) throw new TypeError('dependency list must be an array');
  const output = new Set<string>();
  for (const raw of input) {
    const value = bounded(raw);
    if (!value) throw new TypeError('dependency id is invalid');
    if (validator && !validator(value)) throw new TypeError('dependency value is unsupported');
    output.add(`${prefix}:${value}`);
  }
  return output;
}

function mergeInto<T>(target: Set<T>, source: Set<T>): Set<T> {
  for (const value of source) target.add(value);
  return target;
}

interface NormalizedContext {
  status: 'MISSING' | 'ACCEPTED' | 'INVALID';
  reason: Set<string>;
  continuation: Set<string>;
}

function normalizeContext(input: unknown, maxDependencyKeys: number): NormalizedContext {
  if (input === undefined || input === null) {
    return { status: 'MISSING', reason: new Set(), continuation: new Set() };
  }
  try {
    if (!isPlainObject(input)) throw new TypeError('context must be an object');
    if (input.source !== 'ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES') throw new TypeError('context source is not accepted');
    if (!bounded(input.goalId, 128)) throw new TypeError('goalId is required');
    if (!Number.isSafeInteger(input.ledgerRevision) || (input.ledgerRevision as number) < 1) throw new TypeError('ledgerRevision is invalid');
    if (typeof input.ledgerDigest !== 'string' || !DIGEST.test(input.ledgerDigest)) throw new TypeError('ledgerDigest is invalid');
    if (!isPlainObject(input.reasonDependencies) || !isPlainObject(input.continueDependencies)) {
      throw new TypeError('dependency groups are required');
    }

    const reason = new Set<string>();
    const continuation = new Set<string>();
    const addGroup = (target: Set<string>, group: Record<string, unknown>) => {
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

function semanticAffectedKeys(reasoningObservation: ReasoningObservation | null): Set<string> {
  const keys = new Set<string>();
  if (reasoningObservation?.kind !== 'COMPACT_PATCH' || !isPlainObject(reasoningObservation.patch)) return keys;
  const patch = reasoningObservation.patch as Record<string, unknown>;
  for (const groupName of ['insertedEntities', 'updatedEntities', 'movedEntities']) {
    const list = Array.isArray(patch[groupName]) ? patch[groupName] as unknown[] : [];
    for (const item of list) {
      const id = bounded(isPlainObject(item) ? item.logicalId : '');
      if (id) keys.add(`entity:${id}`);
    }
  }
  const removedEntities = Array.isArray(patch.removedLogicalIds) ? patch.removedLogicalIds as unknown[] : [];
  for (const raw of removedEntities) {
    const id = bounded(raw);
    if (id) keys.add(`entity:${id}`);
  }
  for (const groupName of ['changedViews', 'invalidatedViews']) {
    const list = Array.isArray(patch[groupName]) ? patch[groupName] as unknown[] : [];
    for (const item of list) {
      const id = bounded(isPlainObject(item) ? item.regionId : '');
      if (id) keys.add(`view:${id}`);
    }
  }
  const removedViews = Array.isArray(patch.removedViewIds) ? patch.removedViewIds as unknown[] : [];
  for (const raw of removedViews) {
    const id = bounded(raw);
    if (id) keys.add(`view:${id}`);
  }
  return keys;
}

function intersections(affected: Set<string>, dependencies: Set<string>): string[] {
  return [...affected].filter((key) => dependencies.has(key)).sort(codeUnitCompare);
}

export function createMultiSignalRelevancePipeline(options: MultiSignalRelevanceOptions = {}): MultiSignalRelevancePipeline {
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
  const now: () => number = typeof options.now === 'function' ? options.now : Date.now;
  const deltaPipeline = createDeltaFirstObservationPipeline(options);
  const epochs = new Map<string, EpochCounter>();

  function currentNow(): number {
    const value = Number(now());
    if (!Number.isFinite(value) || value < 0) throw new TypeError('clock must be finite and non-negative');
    return value;
  }

  function recordSignal(identity: unknown, input: unknown): EpochSnapshot {
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

  function inspectEpoch(identity: unknown): EpochSnapshot | null {
    const epoch = epochs.get(identityKey(identity));
    return epoch ? epochSnapshot(epoch, currentNow(), maxEpochAgeMs) : null;
  }

  function reconcile(identity: unknown, observation: unknown, taskContext: unknown): RelevanceDecision {
    const key = identityKey(identity);
    const timestamp = currentNow();
    const epoch = epochs.get(key) || undefined;
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
    if (p2.reasoningObservation.resetRequired === true || p2.canonicalState === null) {
      safetyReasons.add('P2_RESET_REQUIRED');
    }

    const matchedReasonDependencyKeys = context.status === 'ACCEPTED'
      ? intersections(affected, context.reason)
      : [];
    const matchedContinueDependencyKeys = context.status === 'ACCEPTED'
      ? intersections(affected, context.continuation)
      : [];

    let decision: RelevanceDecision['decision'];
    if (p2.reasoningObservation.kind === 'FULL_SNAPSHOT') decision = 'REASON_REQUIRED';
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

  function clear(): void {
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
