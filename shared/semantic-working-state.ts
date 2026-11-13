// @last-edited: 2026-10-21 UTC+7.
// @title: semantic-working-state — the working state of the semantic engine, kept between observations.
// @state: the entities, the views and the change classifications it holds, with the bounds on each.
// @dependencies: node:crypto, canonical-order.

import { createHash } from 'node:crypto';
import { codeUnitCompare } from './canonical-order.js';

const DEFAULT_MAX_STATES = 32;
const DEFAULT_MAX_ENTITIES = 500;
const DEFAULT_MAX_VIEWS = 100;
const DEFAULT_MAX_STATE_BYTES = 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const CHANGE_TYPES = new Set(['INSERT', 'UPDATE', 'REMOVE', 'MOVE']);
const CLASSIFICATIONS = new Set(['INSERT', 'UPDATE', 'REMOVE', 'MOVE', 'MIXED', 'NO_RELEVANT_CHANGE', 'RESET']);

export interface SemanticIdentity {
  tenantId: string;
  deviceId: string;
  tabId: string;
  documentGeneration: number;
  runtimeEpoch: string;
}

export interface SemanticEntity {
  logicalId: string;
  semanticRevision: number;
  stableKey: string;
  stableKeySource: string;
  tag: string;
  role: string;
  regionKey: string;
  inViewport: boolean;
  identityAmbiguous: boolean;
  identityConfidence?: number;
}

export interface SemanticView {
  regionId: string;
  kind: string;
  role: string;
  viewRevision: number;
  actionableCount: number;
  repeatedEntityCount: number;
  loadedEntityCount: number;
  visibleEntityCount: number;
  uniqueCanonicalLinkCount: number;
  duplicateKeyCount: number;
  ambiguityCount: number;
  dependencies: {
    entitySet: { fingerprint: string; count: number };
    scrollState: { fingerprint: string } | null;
  };
  exhaustion: { reachedBoundary: boolean; stableObservations: number; status: string } | null;
  completionStatus: string;
}

export interface SemanticChange {
  type: string;
  logicalId: string;
  revision: number;
}

export interface SemanticObservation {
  documentGeneration: number;
  observationRevision: number;
  sourceRevision: number;
  resultingRevision: number;
  classification: string;
  completeSnapshotRequired: boolean;
  changes: SemanticChange[];
  entities: SemanticEntity[];
  regions: SemanticView[];
  changedRegionIds: string[];
  removedRegionIds: string[];
  digest: string;
}

export interface SemanticState {
  stateId: string;
  identity: SemanticIdentity;
  documentGeneration: number;
  semanticRevision: number;
  entities: Map<string, SemanticEntity>;
  views: Map<string, SemanticView>;
  lastSourceRevision: number;
  lastResultRevision: number;
  lastDigest: string;
  createdAt: number;
  updatedAt: number;
  createdOrder: number;
  lastAccessOrder: number;
}

export interface PublicWorkingState {
  stateId: string;
  documentGeneration: number;
  semanticRevision: number;
  entityCount: number;
  viewCount: number;
  continuity: 'CONTIGUOUS';
  lastSourceRevision: number;
  lastResultRevision: number;
  replayed: boolean;
  entities: SemanticEntity[];
  views: SemanticView[];
  dependencies: Array<{
    regionId: string;
    entitySetFingerprint: string;
    entityCount: number;
    scrollFingerprint: string;
  }>;
}

export interface StoreOptions {
  maxStates?: number;
  maxEntitiesPerState?: number;
  maxViewsPerState?: number;
  maxStateBytes?: number;
  maxAgeMs?: number;
  now?: () => number;
}

export interface SemanticWorkingStateStore {
  bootstrap(identityInput: unknown, observationInput: unknown): PublicWorkingState;
  apply(stateId: unknown, identityInput: unknown, observationInput: unknown): PublicWorkingState;
  inspect(stateId: unknown, identityInput: unknown): PublicWorkingState;
  drop(stateId: unknown): boolean;
  clear(): void;
  readonly size: number;
}

export class SemanticWorkingStateError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'SemanticWorkingStateError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code: string, message: string, details?: unknown): never {
  throw new SemanticWorkingStateError(code, message, details);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function bounded(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function positiveInteger(value: unknown, fallback: number, max: number = Number.MAX_SAFE_INTEGER): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? Math.min(value as number, max) : fallback;
}

function safeRevision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('INVALID_OBSERVATION', `${path} must be a non-negative safe integer.`);
  return value as number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(codeUnitCompare).map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function frozen<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value as object)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  return Object.freeze(value as T & object) as T;
}

function normalizeIdentity(input: unknown): SemanticIdentity {
  if (!isPlainObject(input)) fail('INVALID_IDENTITY', 'identity must be a plain object.');
  const identity: SemanticIdentity = {
    tenantId: bounded(input.tenantId, 160),
    deviceId: bounded(input.deviceId, 160),
    tabId: bounded(input.tabId, 160),
    documentGeneration: input.documentGeneration as number,
    runtimeEpoch: bounded(input.runtimeEpoch, 160),
  };
  if (!identity.tenantId || !identity.deviceId || !identity.tabId || !identity.runtimeEpoch) {
    fail('INVALID_IDENTITY', 'identity.tenantId, deviceId, tabId and runtimeEpoch are required.');
  }
  if (!Number.isSafeInteger(identity.documentGeneration) || (identity.documentGeneration as number) < 1) {
    fail('INVALID_IDENTITY', 'identity.documentGeneration must be a positive safe integer.');
  }
  return identity;
}

function assertSameIdentity(expected: SemanticIdentity, actual: SemanticIdentity): void {
  if (actual.tenantId !== expected.tenantId) fail('CROSS_TENANT', 'Working state belongs to another tenant.');
  if (actual.deviceId !== expected.deviceId) fail('CROSS_DEVICE', 'Working state belongs to another device.');
  if (actual.tabId !== expected.tabId) fail('CROSS_TAB', 'Working state belongs to another tab.');
  if (actual.documentGeneration !== expected.documentGeneration) fail('CROSS_DOCUMENT', 'Working state belongs to another document generation.');
  if (actual.runtimeEpoch !== expected.runtimeEpoch) fail('RUNTIME_EPOCH_MISMATCH', 'Working state belongs to another runtime epoch.');
}

function sanitizeEntity(input: unknown): SemanticEntity | null {
  if (!isPlainObject(input)) fail('INVALID_OBSERVATION', 'Every semantic entity must be a plain object.');
  if (input.sensitive === true) return null;
  const logicalId = bounded(input.logicalId, 200);
  if (!logicalId) fail('INVALID_OBSERVATION', 'Observed non-sensitive entity is missing logicalId.');
  const semanticRevision = safeRevision(input.semanticRevision, `entity(${logicalId}).semanticRevision`);
  if (semanticRevision < 1) fail('INVALID_OBSERVATION', `entity(${logicalId}).semanticRevision must be positive.`);
  const entity: SemanticEntity = {
    logicalId,
    semanticRevision,
    stableKey: bounded(input.stableKey, 200),
    stableKeySource: bounded(input.stableKeySource, 40),
    tag: bounded(input.tag, 80),
    role: bounded(input.role, 80),
    regionKey: bounded(input.regionKey, 160),
    inViewport: input.inViewport === true,
    identityAmbiguous: input.identityAmbiguous === true,
  };
  const confidence = Number(input.identityConfidence);
  if (Number.isFinite(confidence)) entity.identityConfidence = Math.max(0, Math.min(1, confidence));
  return entity;
}

function sanitizeView(input: unknown): SemanticView {
  if (!isPlainObject(input)) fail('INVALID_OBSERVATION', 'Every semantic view must be a plain object.');
  const regionId = bounded(input.regionId, 200);
  if (!regionId) fail('INVALID_OBSERVATION', 'Semantic view is missing regionId.');
  const number = (value: unknown): number => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0);
  const dependencies = isPlainObject(input.dependencies) ? input.dependencies : {};
  const entitySet = isPlainObject(dependencies.entitySet) ? dependencies.entitySet : {};
  const scrollState = isPlainObject(dependencies.scrollState) ? dependencies.scrollState : null;
  const exhaustion = isPlainObject(input.exhaustion) ? input.exhaustion : null;
  const completion = isPlainObject(input.completion) ? input.completion : null;
  return {
    regionId,
    kind: bounded(input.kind, 40),
    role: bounded(input.role, 80),
    viewRevision: number(input.viewRevision),
    actionableCount: number(input.actionableCount),
    repeatedEntityCount: number(input.repeatedEntityCount),
    loadedEntityCount: number(input.loadedEntityCount),
    visibleEntityCount: number(input.visibleEntityCount),
    uniqueCanonicalLinkCount: number(input.uniqueCanonicalLinkCount),
    duplicateKeyCount: number(input.duplicateKeyCount),
    ambiguityCount: number(input.ambiguityCount),
    dependencies: {
      entitySet: {
        fingerprint: bounded(entitySet.fingerprint, 200),
        count: number(entitySet.count),
      },
      scrollState: scrollState ? { fingerprint: bounded(scrollState.fingerprint, 200) } : null,
    },
    exhaustion: exhaustion ? {
      reachedBoundary: exhaustion.reachedBoundary === true,
      stableObservations: number(exhaustion.stableObservations),
      status: bounded(exhaustion.status, 40),
    } : null,
    completionStatus: bounded(completion?.status, 40),
  };
}

function mapUnique<T>(items: T[], key: keyof T & string, code: string): Map<string, T> {
  const output = new Map<string, T>();
  for (const item of items) {
    const id = String(item[key]);
    if (output.has(id)) fail(code, `Duplicate ${key} in semantic observation.`);
    output.set(id, item);
  }
  return output;
}

function normalizeObservation(input: unknown): SemanticObservation {
  if (!isPlainObject(input)) fail('INVALID_OBSERVATION', 'observation must be a plain object.');
  const semanticState = input.semanticState;
  const semanticDelta = input.semanticDelta;
  const semanticViews = input.semanticViews;
  if (!isPlainObject(semanticState) || !isPlainObject(semanticDelta) || !isPlainObject(semanticViews)) {
    fail('INVALID_OBSERVATION', 'semanticState, semanticDelta, and semanticViews are required.');
  }
  const documentGeneration = safeRevision(semanticState.documentGeneration, 'semanticState.documentGeneration');
  if (documentGeneration < 1) fail('INVALID_OBSERVATION', 'semanticState.documentGeneration must be positive.');
  const observationRevision = safeRevision(semanticState.observationRevision, 'semanticState.observationRevision');
  const sourceRevision = safeRevision(semanticDelta.sourceRevision, 'semanticDelta.sourceRevision');
  const resultingRevision = safeRevision(semanticDelta.resultingRevision, 'semanticDelta.resultingRevision');
  if (observationRevision !== resultingRevision) fail('INVALID_OBSERVATION', 'semanticState and semanticDelta revisions disagree.');
  const classification = bounded(semanticDelta.classification, 40);
  if (!CLASSIFICATIONS.has(classification)) fail('INVALID_OBSERVATION', 'semanticDelta.classification is unsupported.');
  const changes: SemanticChange[] = Array.isArray(semanticDelta.changes) ? semanticDelta.changes.map((change) => {
    if (!isPlainObject(change)) fail('INVALID_OBSERVATION', 'semanticDelta changes must be plain objects.');
    const type = bounded(change.type, 20);
    const logicalId = bounded(change.logicalId, 200);
    if (!CHANGE_TYPES.has(type) || !logicalId) fail('INVALID_OBSERVATION', 'semanticDelta change is invalid.');
    return {
      type,
      logicalId,
      revision: safeRevision(change.revision, `change(${logicalId}).revision`),
    };
  }) : fail('INVALID_OBSERVATION', 'semanticDelta.changes must be an array.');
  if (classification === 'NO_RELEVANT_CHANGE' && changes.length) fail('INVALID_OBSERVATION', 'NO_RELEVANT_CHANGE cannot carry semantic changes.');

  const rawElements = Array.isArray(input.elements) ? input.elements : [];
  const entities = rawElements.map(sanitizeEntity).filter((entity): entity is SemanticEntity => entity !== null);
  mapUnique(entities, 'logicalId', 'AMBIGUOUS_IDENTITY');
  const regions = Array.isArray(semanticViews.regions) ? semanticViews.regions.map(sanitizeView) : [];
  mapUnique(regions, 'regionId', 'INVALID_OBSERVATION');
  const changedRegionIds = Array.isArray(semanticViews.changedRegionIds)
    ? semanticViews.changedRegionIds.map((value) => bounded(value, 200)).filter(Boolean) : [];
  const removedRegionIds = Array.isArray(semanticViews.removedRegionIds)
    ? semanticViews.removedRegionIds.map((value) => bounded(value, 200)).filter(Boolean) : [];
  const ambiguityCount = safeRevision(semanticState.ambiguityCount ?? 0, 'semanticState.ambiguityCount');
  if (ambiguityCount > 0 || entities.some((item) => item.identityAmbiguous) || regions.some((item) => item.ambiguityCount > 0)) {
    fail('AMBIGUOUS_IDENTITY', 'Ambiguous semantic identity cannot extend P1 continuity.');
  }

  const normalized: SemanticObservation = {
    documentGeneration,
    observationRevision,
    sourceRevision,
    resultingRevision,
    classification,
    completeSnapshotRequired: semanticDelta.completeSnapshotRequired === true,
    changes,
    entities,
    regions,
    changedRegionIds,
    removedRegionIds,
    digest: '',
  };
  normalized.digest = digest(normalized);
  return normalized;
}

function sortedValues<T>(map: Map<string, T>, key: keyof T & string): T[] {
  return [...map.values()].map(clone).sort((left, right) => String(left[key]).localeCompare(String(right[key])));
}

function dependenciesFromViews(views: Map<string, SemanticView>): PublicWorkingState['dependencies'] {
  return sortedValues(views, 'regionId').map((view) => ({
    regionId: view.regionId,
    entitySetFingerprint: view.dependencies.entitySet.fingerprint,
    entityCount: view.dependencies.entitySet.count,
    scrollFingerprint: view.dependencies.scrollState?.fingerprint || '',
  }));
}

function stateBytes(state: SemanticState): number {
  return new TextEncoder().encode(canonical({
    identity: state.identity,
    documentGeneration: state.documentGeneration,
    semanticRevision: state.semanticRevision,
    entities: sortedValues(state.entities, 'logicalId'),
    views: sortedValues(state.views, 'regionId'),
    lastSourceRevision: state.lastSourceRevision,
    lastResultRevision: state.lastResultRevision,
  })).length;
}

function publicState(state: SemanticState, replayed = false): PublicWorkingState {
  return frozen({
    stateId: state.stateId,
    documentGeneration: state.documentGeneration,
    semanticRevision: state.semanticRevision,
    entityCount: state.entities.size,
    viewCount: state.views.size,
    continuity: 'CONTIGUOUS',
    lastSourceRevision: state.lastSourceRevision,
    lastResultRevision: state.lastResultRevision,
    replayed,
    entities: sortedValues(state.entities, 'logicalId'),
    views: sortedValues(state.views, 'regionId'),
    dependencies: dependenciesFromViews(state.views),
  });
}

export function createSemanticWorkingStateStore(options: StoreOptions = {}): SemanticWorkingStateStore {
  const maxStates = positiveInteger(options.maxStates, DEFAULT_MAX_STATES, 1024);
  const maxEntitiesPerState = positiveInteger(options.maxEntitiesPerState, DEFAULT_MAX_ENTITIES, 5000);
  const maxViewsPerState = positiveInteger(options.maxViewsPerState, DEFAULT_MAX_VIEWS, 1000);
  const maxStateBytes = positiveInteger(options.maxStateBytes, DEFAULT_MAX_STATE_BYTES, 16 * 1024 * 1024);
  const maxAgeMs = positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS, 24 * 60 * 60 * 1000);
  const now: () => number = typeof options.now === 'function' ? options.now : Date.now;
  const states = new Map<string, SemanticState>();
  let stateCounter = 0;
  let accessCounter = 0;

  function currentNow(): number {
    const value = Number(now());
    if (!Number.isFinite(value) || value < 0) fail('INVALID_CLOCK', 'Working-state clock must be finite and non-negative.');
    return value;
  }

  function scopeKey(identity: SemanticIdentity): string {
    return canonical(identity);
  }

  function stateIdFor(identity: SemanticIdentity): string {
    stateCounter += 1;
    return `p1_${digest({ identity, stateCounter }).slice(0, 24)}`;
  }

  function removeSameScope(identity: SemanticIdentity): void {
    const target = scopeKey(identity);
    for (const [stateId, state] of states) {
      if (scopeKey(state.identity) === target) states.delete(stateId);
    }
  }

  function enforceCapacity(): void {
    while (states.size > maxStates) {
      const oldest = [...states.values()].sort((left, right) =>
        left.lastAccessOrder - right.lastAccessOrder || left.createdOrder - right.createdOrder)[0];
      if (!oldest) return;
      states.delete(oldest.stateId);
    }
  }

  function assertWithinBounds(entities: Map<string, SemanticEntity>, views: Map<string, SemanticView>, partialState: SemanticState | null = null): void {
    if (entities.size > maxEntitiesPerState || views.size > maxViewsPerState) {
      fail('OVERFLOW', 'Working-state entity/view bounds exceeded.');
    }
    if (partialState && stateBytes({ ...partialState, entities, views }) > maxStateBytes) {
      fail('OVERFLOW', 'Working-state byte bound exceeded.');
    }
  }

  function lookup(stateId: unknown, identityInput: unknown, expiredCode = 'EXPIRED'): SemanticState {
    const identity = normalizeIdentity(identityInput);
    const state = states.get(String(stateId ?? ''));
    if (!state) fail('RESET_REQUIRED', 'Working state is unavailable; a trusted full snapshot is required.');
    const timestamp = currentNow();
    if (timestamp - state.updatedAt > maxAgeMs) {
      states.delete(state.stateId);
      fail(expiredCode, 'Working state expired; a trusted full snapshot is required.');
    }
    assertSameIdentity(state.identity, identity);
    accessCounter += 1;
    state.lastAccessOrder = accessCounter;
    return state;
  }

  function bootstrap(identityInput: unknown, observationInput: unknown): PublicWorkingState {
    const identity = normalizeIdentity(identityInput);
    const observation = normalizeObservation(observationInput);
    if (observation.documentGeneration !== identity.documentGeneration) fail('CROSS_DOCUMENT', 'Observation document generation does not match trusted identity.');
    if (observation.classification !== 'RESET' || observation.completeSnapshotRequired !== true) {
      fail('FULL_SNAPSHOT_REQUIRED', 'P1 bootstrap requires a RESET/full-snapshot observation.');
    }
    if (observation.resultingRevision < 1) fail('INVALID_OBSERVATION', 'Bootstrap resulting revision must be positive.');
    if (observation.sourceRevision >= observation.resultingRevision) fail('INVALID_OBSERVATION', 'Bootstrap revision order is invalid.');

    const entities = new Map(observation.entities.map((item) => [item.logicalId, clone(item)]));
    const views = new Map(observation.regions.map((item) => [item.regionId, clone(item)]));
    const timestamp = currentNow();
    accessCounter += 1;
    const stateId = stateIdFor(identity);
    const state: SemanticState = {
      stateId,
      identity,
      documentGeneration: identity.documentGeneration,
      semanticRevision: observation.resultingRevision,
      entities,
      views,
      lastSourceRevision: observation.sourceRevision,
      lastResultRevision: observation.resultingRevision,
      lastDigest: observation.digest,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdOrder: stateCounter,
      lastAccessOrder: accessCounter,
    };
    assertWithinBounds(entities, views, state);
    removeSameScope(identity);
    states.set(stateId, state);
    enforceCapacity();
    if (!states.has(stateId)) fail('RESET_REQUIRED', 'New working state was evicted by capacity policy.');
    return publicState(state, false);
  }

  function apply(stateId: unknown, identityInput: unknown, observationInput: unknown): PublicWorkingState {
    const state = lookup(stateId, identityInput);
    const observation = normalizeObservation(observationInput);
    if (observation.documentGeneration !== state.documentGeneration) fail('CROSS_DOCUMENT', 'Observation document generation differs from working state.');
    if (observation.classification === 'RESET' || observation.completeSnapshotRequired) {
      fail('RESET_REQUIRED', 'Observation requires a fresh full-snapshot bootstrap.');
    }

    if (observation.resultingRevision === state.semanticRevision) {
      if (observation.sourceRevision === state.lastSourceRevision && observation.resultingRevision === state.lastResultRevision) {
        if (observation.digest === state.lastDigest) return publicState(state, true);
        fail('INCOMPATIBLE_DUPLICATE', 'Same semantic revision was replayed with different material.');
      }
      fail('OUT_OF_ORDER', 'Observation revision is not newer than accepted state.');
    }
    if (observation.resultingRevision < state.semanticRevision || observation.sourceRevision < state.semanticRevision) {
      fail('OUT_OF_ORDER', 'Observation precedes the accepted semantic revision.');
    }
    if (observation.sourceRevision !== state.semanticRevision || observation.resultingRevision !== observation.sourceRevision + 1) {
      fail('REVISION_GAP', 'Semantic revision continuity is not exact.');
    }

    const nextEntities = new Map([...state.entities].map(([key, value]) => [key, clone(value)]));
    const nextViews = new Map([...state.views].map(([key, value]) => [key, clone(value)]));
    const currentEntities = new Map(observation.entities.map((item) => [item.logicalId, item]));

    for (const change of observation.changes) {
      if (change.type === 'REMOVE') {
        nextEntities.delete(change.logicalId);
        continue;
      }
      const current = currentEntities.get(change.logicalId);
      if (!current) fail('DELTA_MISMATCH', `Changed entity ${change.logicalId} is absent from the trusted current observation.`);
      if (current.semanticRevision !== change.revision) fail('DELTA_MISMATCH', `Changed entity ${change.logicalId} revision disagrees with delta.`);
      if (change.type === 'INSERT' && nextEntities.has(change.logicalId)) fail('DELTA_MISMATCH', `INSERT entity ${change.logicalId} already exists.`);
      if ((change.type === 'UPDATE' || change.type === 'MOVE') && !nextEntities.has(change.logicalId)) {
        fail('DELTA_MISMATCH', `${change.type} entity ${change.logicalId} is unknown to working state.`);
      }
      nextEntities.set(change.logicalId, clone(current));
    }

    const changedRegions = new Set(observation.changedRegionIds);
    const currentViews = new Map(observation.regions.map((item) => [item.regionId, item]));
    for (const regionId of observation.removedRegionIds) nextViews.delete(regionId);
    for (const regionId of changedRegions) {
      const current = currentViews.get(regionId);
      if (!current) fail('VIEW_DELTA_MISMATCH', `Changed view ${regionId} is absent from current observation.`);
      nextViews.set(regionId, clone(current));
    }

    for (const [logicalId, current] of currentEntities) {
      const reconstructed = nextEntities.get(logicalId);
      if (!reconstructed || canonical(reconstructed) !== canonical(current)) {
        fail('DELTA_MISMATCH', `Delta reconstruction disagrees with current entity ${logicalId}.`);
      }
    }
    for (const [regionId, current] of currentViews) {
      const reconstructed = nextViews.get(regionId);
      if (!reconstructed || canonical(reconstructed) !== canonical(current)) {
        fail('VIEW_DELTA_MISMATCH', `View reconstruction disagrees with current view ${regionId}.`);
      }
    }

    const candidate: SemanticState = {
      ...state,
      semanticRevision: observation.resultingRevision,
      entities: nextEntities,
      views: nextViews,
      lastSourceRevision: observation.sourceRevision,
      lastResultRevision: observation.resultingRevision,
      lastDigest: observation.digest,
    };
    assertWithinBounds(nextEntities, nextViews, candidate);

    state.semanticRevision = candidate.semanticRevision;
    state.entities = nextEntities;
    state.views = nextViews;
    state.lastSourceRevision = candidate.lastSourceRevision;
    state.lastResultRevision = candidate.lastResultRevision;
    state.lastDigest = candidate.lastDigest;
    state.updatedAt = currentNow();
    accessCounter += 1;
    state.lastAccessOrder = accessCounter;
    return publicState(state, false);
  }

  function inspect(stateId: unknown, identityInput: unknown): PublicWorkingState {
    return publicState(lookup(stateId, identityInput), false);
  }

  function drop(stateId: unknown): boolean {
    return states.delete(String(stateId ?? ''));
  }

  function clear() {
    states.clear();
  }

  return Object.freeze({
    bootstrap,
    apply,
    inspect,
    drop,
    clear,
    get size() {
      return states.size;
    },
  });
}
