// @last-edited: 2026-10-21 UTC+7.
// @title: delta-first-observation — the first observation of a change, sent as a patch instead of a snapshot.
// @state: the patch builder, the bounds it holds, and why a change was judged relevant.
// @dependencies: semantic-working-state.

import {
  type PublicWorkingState,
  type SemanticEntity,
  type SemanticView,
  SemanticWorkingStateError,
  type StoreOptions,
  createSemanticWorkingStateStore,
} from './semantic-working-state.js';

export interface ReasoningProvenance {
  category: string;
  sensor: string;
  sourceRevision?: number;
  confidence?: number;
  observedAt?: number;
}

export interface ReasoningPatch {
  insertedEntities: SemanticEntity[];
  updatedEntities: SemanticEntity[];
  movedEntities: SemanticEntity[];
  removedLogicalIds: string[];
  changedViews: SemanticView[];
  invalidatedViews: Array<{ regionId: string; causes: string[] }>;
  removedViewIds: string[];
}

export interface ReasoningObservation {
  kind: 'FULL_SNAPSHOT' | 'COMPACT_PATCH';
  sourceRevision: number | null;
  resultingRevision: number | null;
  classification: string;
  continuity: { status: string; replayed: boolean };
  provenance: ReasoningProvenance;
  resetRequired: boolean;
  resetReason: string | null;
  fullSnapshotIncluded: boolean;
  patch?: ReasoningPatch;
  fullSnapshot?: unknown;
  verification: { freshObservationRequired: boolean; reason: string | null };
  accounting: {
    maxPatchBytes: number;
    richSnapshotBytes?: number;
    compactPatchBytes?: number;
    pairedRichSnapshotBytes?: number;
  };
}

export interface DeltaFirstObservationResult {
  reasoningObservation: ReasoningObservation;
  canonicalState: PublicWorkingState | null;
}

export interface DeltaFirstObservationPipeline {
  observe(identity: unknown, observation: unknown, request?: { freshObservationRequired?: boolean; verificationReason?: unknown }): DeltaFirstObservationResult;
  inspect(identity: unknown): PublicWorkingState | null;
  hasContinuity(identity: unknown): boolean;
  clear(): void;
}

export interface DeltaFirstObservationOptions extends StoreOptions {
  maxPatchBytes?: number;
}

interface SnapshotMeta {
  sourceRevision: number | null;
  resultingRevision: number | null;
  classification: string;
  resetReason: string | null;
}

interface ScopeEntry {
  stateId: string;
  identity: unknown;
}

// The observation envelope is untyped at the edge, so narrow the bag once per function and read with isPlainObject as the code already does.

function asBag(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

const DEFAULT_MAX_PATCH_BYTES = 16 * 1024;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_REASON = 120;
const MAX_PROVENANCE_TEXT = 80;
const MAX_CAUSES = 16;
const MAX_CAUSE_TEXT = 80;

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

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function frozen<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value as object)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
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

function snapshotMeta(observation: unknown): SnapshotMeta {
  const delta = asBag(asBag(observation).semanticDelta);
  const state = asBag(asBag(observation).semanticState);
  const classification = bounded(delta.classification || 'RESET', 40) || 'RESET';
  return {
    sourceRevision: Number.isSafeInteger(delta.sourceRevision) ? (delta.sourceRevision as number) : null,
    resultingRevision: Number.isSafeInteger(delta.resultingRevision) ? (delta.resultingRevision as number) : null,
    classification,
    resetReason: bounded(delta.resetReason || state.resetReason, MAX_REASON) || null,
  };
}

function sanitizeProvenance(observation: unknown): ReasoningProvenance {
  const views = asBag(asBag(observation).semanticViews);
  const provenance = isPlainObject(views.provenance) ? views.provenance : {};
  const output: Record<string, unknown> = {
    category: bounded(provenance.category, MAX_PROVENANCE_TEXT),
    sensor: bounded(provenance.sensor, MAX_PROVENANCE_TEXT),
  };
  if (Number.isSafeInteger(provenance.sourceRevision) && (provenance.sourceRevision as number) >= 0) {
    output.sourceRevision = provenance.sourceRevision;
  }
  const confidence = Number(provenance.confidence);
  if (Number.isFinite(confidence)) {
    output.confidence = Math.max(0, Math.min(1, confidence));
  }
  const observedAt = Number(provenance.observedAt);
  if (Number.isFinite(observedAt) && observedAt >= 0) {
    output.observedAt = observedAt;
  }
  return frozen(output) as unknown as ReasoningProvenance;
}

function sanitizeInvalidatedViews(observation: unknown): Array<{ regionId: string; causes: string[] }> {
  const views = asBag(asBag(observation).semanticViews);
  const viewDelta = asBag(views.viewDelta);
  const invalidated = Array.isArray(viewDelta.invalidatedViews) ? viewDelta.invalidatedViews : [];
  const seen = new Set<string>();
  const output: Array<{ regionId: string; causes: string[] }> = [];
  for (const item of invalidated) {
    if (!isPlainObject(item)) continue;
    const regionId = bounded(item.regionId, 200);
    if (!regionId || seen.has(regionId)) continue;
    seen.add(regionId);
    const causes = Array.isArray(item.causes)
      ? [...new Set((item.causes as unknown[]).map((cause) => bounded(cause, MAX_CAUSE_TEXT)).filter(Boolean))].slice(0, MAX_CAUSES)
      : [];
    output.push({ regionId, causes });
  }
  return output;
}

export function reasoningPayloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function finalizeCompactAccounting(observation: ReasoningObservation, maxPatchBytes: number, richSnapshotBytes: number): number {
  const accounting = observation.accounting as ReasoningObservation['accounting'] & { compactPatchBytes: number };
  accounting.maxPatchBytes = maxPatchBytes;
  accounting.richSnapshotBytes = richSnapshotBytes;
  accounting.compactPatchBytes = 0;
  for (let index = 0; index < 12; index += 1) {
    const bytes = reasoningPayloadBytes(observation);
    if (bytes === accounting.compactPatchBytes) return bytes;
    accounting.compactPatchBytes = bytes;
  }
  const bytes = reasoningPayloadBytes(observation);
  accounting.compactPatchBytes = bytes;
  return bytes;
}

interface FullSnapshotArgs {
  resetRequired: boolean;
  resetReason?: string | null | undefined;
  continuityStatus?: string | undefined;
  canonicalState?: PublicWorkingState | null | undefined;
  freshObservationRequired?: boolean | undefined;
  verificationReason?: unknown | undefined;
  maxPatchBytes: number;
}

function fullSnapshotObservation(observation: unknown, {
  resetRequired,
  resetReason = null,
  continuityStatus,
  canonicalState = null,
  freshObservationRequired = false,
  verificationReason = null,
  maxPatchBytes,
}: FullSnapshotArgs): DeltaFirstObservationResult {
  const meta = snapshotMeta(observation);
  const reasoningObservation: ReasoningObservation = {
    kind: 'FULL_SNAPSHOT',
    sourceRevision: meta.sourceRevision,
    resultingRevision: meta.resultingRevision,
    classification: meta.classification,
    continuity: {
      status: continuityStatus || (resetRequired ? 'RESET_REQUIRED' : 'BOOTSTRAP'),
      replayed: false,
    },
    provenance: sanitizeProvenance(observation),
    resetRequired: resetRequired === true,
    resetReason: bounded(resetReason || meta.resetReason, MAX_REASON) || null,
    fullSnapshotIncluded: true,
    fullSnapshot: observation,
    verification: {
      freshObservationRequired: freshObservationRequired === true,
      reason: bounded(verificationReason, MAX_REASON) || null,
    },
    accounting: {
      maxPatchBytes,
      richSnapshotBytes: reasoningPayloadBytes(observation),
    },
  };
  return frozen({ reasoningObservation, canonicalState });
}

function makePatch(observation: unknown, canonicalState: PublicWorkingState, maxPatchBytes: number): { reasoningObservation: ReasoningObservation; bytes: number } {
  const meta = snapshotMeta(observation);
  const envelope = asBag(observation);
  const replayed = canonicalState?.replayed === true;
  const entityMap = new Map((canonicalState?.entities || []).map((item) => [item.logicalId, item]));
  const viewMap = new Map((canonicalState?.views || []).map((item) => [item.regionId, item]));
  const changes: unknown[] = replayed || !Array.isArray(asBag(envelope.semanticDelta).changes)
    ? []
    : (asBag(envelope.semanticDelta).changes as unknown[]);

  const insertedEntities: SemanticEntity[] = [];
  const updatedEntities: SemanticEntity[] = [];
  const movedEntities: SemanticEntity[] = [];
  const removedLogicalIds: string[] = [];
  const seenChange = new Set<string>();

  for (const change of changes) {
    if (!isPlainObject(change)) continue;
    const type = bounded(change.type, 20);
    const logicalId = bounded(change.logicalId, 200);
    const dedupeKey = `${type}:${logicalId}`;
    if (!logicalId || seenChange.has(dedupeKey)) continue;
    seenChange.add(dedupeKey);
    if (type === 'REMOVE') {
      removedLogicalIds.push(logicalId);
      continue;
    }
    const entity = entityMap.get(logicalId);
    if (!entity) continue;
    if (type === 'INSERT') insertedEntities.push(clone(entity));
    else if (type === 'UPDATE') updatedEntities.push(clone(entity));
    else if (type === 'MOVE') movedEntities.push(clone(entity));
  }

  const changedRegionIds = replayed || !Array.isArray(asBag(envelope.semanticViews).changedRegionIds)
    ? []
    : (asBag(envelope.semanticViews).changedRegionIds as unknown[]).map((value) => bounded(value, 200)).filter(Boolean);
  const changedViews = [...new Set(changedRegionIds)]
    .map((regionId) => viewMap.get(regionId))
    .filter((view): view is SemanticView => view !== undefined)
    .map(clone);
  const invalidatedViews = replayed ? [] : sanitizeInvalidatedViews(observation);
  const removedViewIds = replayed || !Array.isArray(asBag(envelope.semanticViews).removedRegionIds)
    ? []
    : [...new Set((asBag(envelope.semanticViews).removedRegionIds as unknown[]).map((value) => bounded(value, 200)).filter(Boolean))];

  const reasoningObservation: ReasoningObservation = {
    kind: 'COMPACT_PATCH',
    sourceRevision: meta.sourceRevision,
    resultingRevision: meta.resultingRevision,
    classification: meta.classification,
    continuity: {
      status: replayed ? 'REPLAY' : 'CONTIGUOUS',
      replayed,
    },
    provenance: sanitizeProvenance(observation),
    resetRequired: false,
    resetReason: null,
    fullSnapshotIncluded: false,
    verification: {
      freshObservationRequired: false,
      reason: null,
    },
    patch: {
      insertedEntities,
      updatedEntities,
      movedEntities,
      removedLogicalIds,
      changedViews,
      invalidatedViews,
      removedViewIds,
    },
    accounting: {
      maxPatchBytes: 0,
      compactPatchBytes: 0,
    },
  };
  const bytes = finalizeCompactAccounting(reasoningObservation, maxPatchBytes, reasoningPayloadBytes(observation));
  return { reasoningObservation, bytes };
}

function errorReason(error: unknown): string {
  if (error instanceof SemanticWorkingStateError) return bounded(error.code, MAX_REASON) || 'RESET_REQUIRED';
  return 'RESET_REQUIRED';
}

export function createDeltaFirstObservationPipeline(options: DeltaFirstObservationOptions = {}): DeltaFirstObservationPipeline {
  const { maxPatchBytes: requestedMaxPatchBytes, ...storeOptions } = options;
  const maxPatchBytes = positiveInteger(requestedMaxPatchBytes, DEFAULT_MAX_PATCH_BYTES, MAX_PATCH_BYTES);
  const store = createSemanticWorkingStateStore(storeOptions);
  const scopes = new Map<string, ScopeEntry>();

  function dropScope(key: string): void {
    const entry = scopes.get(key);
    if (entry?.stateId) store.drop(entry.stateId);
    scopes.delete(key);
  }

  function dropRelatedTarget(identity: unknown, exceptKey: string): void {
    for (const [key, entry] of scopes) {
      if (key === exceptKey) continue;
      const current = entry.identity as { tenantId?: unknown; deviceId?: unknown; tabId?: unknown } | undefined;
      const input = (identity ?? {}) as { tenantId?: unknown; deviceId?: unknown; tabId?: unknown };
      if (
        String(current?.tenantId ?? '') === String(input.tenantId ?? '')
        && String(current?.deviceId ?? '') === String(input.deviceId ?? '')
        && String(current?.tabId ?? '') === String(input.tabId ?? '')
      ) {
        if (entry.stateId) store.drop(entry.stateId);
        scopes.delete(key);
      }
    }
  }

  function failClosed(observation: unknown, key: string, reason: string): DeltaFirstObservationResult {
    dropScope(key);
    return fullSnapshotObservation(observation, {
      resetRequired: true,
      resetReason: reason,
      continuityStatus: 'RESET_REQUIRED',
      canonicalState: null,
      maxPatchBytes,
    });
  }

  function bootstrap(identity: unknown, observation: unknown, key: string, meta: SnapshotMeta): DeltaFirstObservationResult {
    dropScope(key);
    dropRelatedTarget(identity, key);
    try {
      const canonicalState = store.bootstrap(identity, observation);
      scopes.set(key, { stateId: canonicalState.stateId, identity: clone(identity) });
      return fullSnapshotObservation(observation, {
        resetRequired: false,
        resetReason: meta.resetReason,
        continuityStatus: 'BOOTSTRAP',
        canonicalState,
        maxPatchBytes,
      });
    } catch (error: unknown) {
      return failClosed(observation, key, errorReason(error));
    }
  }

  function observe(identity: unknown, observation: unknown, request: { freshObservationRequired?: boolean; verificationReason?: unknown } = {}): DeltaFirstObservationResult {
    const key = identityKey(identity);
    const meta = snapshotMeta(observation);
    if (meta.classification === 'RESET') {
      return bootstrap(identity, observation, key, meta);
    }

    const entry = scopes.get(key);
    if (!entry?.stateId) {
      return failClosed(observation, key, 'MISSING_CONTINUITY');
    }

    let canonicalState: PublicWorkingState;
    try {
      canonicalState = store.apply(entry.stateId, identity, observation);
    } catch (error: unknown) {
      return failClosed(observation, key, errorReason(error));
    }

    if (request?.freshObservationRequired === true) {
      return fullSnapshotObservation(observation, {
        resetRequired: false,
        resetReason: null,
        continuityStatus: canonicalState.replayed ? 'REPLAY' : 'CONTIGUOUS',
        canonicalState,
        freshObservationRequired: true,
        verificationReason: request.verificationReason,
        maxPatchBytes,
      });
    }

    const compact = makePatch(observation, canonicalState, maxPatchBytes);
    if (compact.bytes > maxPatchBytes) {
      return failClosed(observation, key, 'PATCH_OVERFLOW');
    }
    return frozen({
      reasoningObservation: compact.reasoningObservation,
      canonicalState,
    });
  }

  function inspect(identity: unknown): PublicWorkingState | null {
    const key = identityKey(identity);
    const entry = scopes.get(key);
    if (!entry?.stateId) return null;
    try {
      return store.inspect(entry.stateId, identity);
    } catch {
      scopes.delete(key);
      return null;
    }
  }

  function hasContinuity(identity: unknown): boolean {
    return inspect(identity) !== null;
  }

  function clear(): void {
    scopes.clear();
    store.clear();
  }

  return Object.freeze({
    observe,
    inspect,
    hasContinuity,
    clear,
  });
}
