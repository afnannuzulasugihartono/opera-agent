// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: delta-first-observation-p2 — first-observation-p2 — Shared pure module.
// @state: feat(perf): add P2 delta-first observation pipeline.
// @dependencies: semantic-working-state-p1.

import {
  SemanticWorkingStateError,
  createSemanticWorkingStateStore,
} from './semantic-working-state-p1.js';

const DEFAULT_MAX_PATCH_BYTES = 16 * 1024;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_REASON = 120;
const MAX_PROVENANCE_TEXT = 80;
const MAX_CAUSES = 16;
const MAX_CAUSE_TEXT = 80;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function bounded(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) frozen(child);
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

function snapshotMeta(observation) {
  const delta = isPlainObject(observation?.semanticDelta) ? observation.semanticDelta : {};
  const state = isPlainObject(observation?.semanticState) ? observation.semanticState : {};
  return {
    sourceRevision: Number.isSafeInteger(delta.sourceRevision) ? delta.sourceRevision : null,
    resultingRevision: Number.isSafeInteger(delta.resultingRevision) ? delta.resultingRevision : null,
    classification: bounded(delta.classification || 'RESET', 40) || 'RESET',
    resetReason: bounded(delta.resetReason || state.resetReason, MAX_REASON) || null,
  };
}

function sanitizeProvenance(observation) {
  const provenance = isPlainObject(observation?.semanticViews?.provenance)
    ? observation.semanticViews.provenance
    : {};
  const output = {
    category: bounded(provenance.category, MAX_PROVENANCE_TEXT),
    sensor: bounded(provenance.sensor, MAX_PROVENANCE_TEXT),
  };
  if (Number.isSafeInteger(provenance.sourceRevision) && provenance.sourceRevision >= 0) {
    output.sourceRevision = provenance.sourceRevision;
  }
  if (Number.isFinite(provenance.confidence)) {
    output.confidence = Math.max(0, Math.min(1, Number(provenance.confidence)));
  }
  if (Number.isFinite(provenance.observedAt) && provenance.observedAt >= 0) {
    output.observedAt = Number(provenance.observedAt);
  }
  return frozen(output);
}

function sanitizeInvalidatedViews(observation) {
  const invalidated = Array.isArray(observation?.semanticViews?.viewDelta?.invalidatedViews)
    ? observation.semanticViews.viewDelta.invalidatedViews
    : [];
  const seen = new Set();
  const output = [];
  for (const item of invalidated) {
    if (!isPlainObject(item)) continue;
    const regionId = bounded(item.regionId, 200);
    if (!regionId || seen.has(regionId)) continue;
    seen.add(regionId);
    const causes = Array.isArray(item.causes)
      ? [...new Set(item.causes.map((cause) => bounded(cause, MAX_CAUSE_TEXT)).filter(Boolean))].slice(0, MAX_CAUSES)
      : [];
    output.push({ regionId, causes });
  }
  return output;
}

export function reasoningPayloadBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function finalizeCompactAccounting(observation, maxPatchBytes, richSnapshotBytes) {
  observation.accounting = {
    maxPatchBytes,
    compactPatchBytes: 0,
    pairedRichSnapshotBytes: richSnapshotBytes,
  };
  for (let index = 0; index < 12; index += 1) {
    const bytes = reasoningPayloadBytes(observation);
    if (bytes === observation.accounting.compactPatchBytes) return bytes;
    observation.accounting.compactPatchBytes = bytes;
  }
  const bytes = reasoningPayloadBytes(observation);
  observation.accounting.compactPatchBytes = bytes;
  return reasoningPayloadBytes(observation);
}

function fullSnapshotObservation(observation, {
  resetRequired,
  resetReason = null,
  continuityStatus,
  canonicalState = null,
  freshObservationRequired = false,
  verificationReason = null,
  maxPatchBytes,
} = {}) {
  const meta = snapshotMeta(observation);
  const reasoningObservation = {
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

function makePatch(observation, canonicalState, maxPatchBytes) {
  const meta = snapshotMeta(observation);
  const replayed = canonicalState?.replayed === true;
  const entityMap = new Map((canonicalState?.entities || []).map((item) => [item.logicalId, item]));
  const viewMap = new Map((canonicalState?.views || []).map((item) => [item.regionId, item]));
  const changes = replayed || !Array.isArray(observation?.semanticDelta?.changes)
    ? []
    : observation.semanticDelta.changes;

  const insertedEntities = [];
  const updatedEntities = [];
  const movedEntities = [];
  const removedLogicalIds = [];
  const seenChange = new Set();

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

  const changedRegionIds = replayed || !Array.isArray(observation?.semanticViews?.changedRegionIds)
    ? []
    : observation.semanticViews.changedRegionIds.map((value) => bounded(value, 200)).filter(Boolean);
  const changedViews = [...new Set(changedRegionIds)]
    .map((regionId) => viewMap.get(regionId))
    .filter(Boolean)
    .map(clone);
  const invalidatedViews = replayed ? [] : sanitizeInvalidatedViews(observation);
  const removedViewIds = replayed || !Array.isArray(observation?.semanticViews?.removedRegionIds)
    ? []
    : [...new Set(observation.semanticViews.removedRegionIds.map((value) => bounded(value, 200)).filter(Boolean))];

  const reasoningObservation = {
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
  };
  const bytes = finalizeCompactAccounting(reasoningObservation, maxPatchBytes, reasoningPayloadBytes(observation));
  return { reasoningObservation, bytes };
}

function errorReason(error) {
  if (error instanceof SemanticWorkingStateError) return bounded(error.code, MAX_REASON) || 'RESET_REQUIRED';
  return 'RESET_REQUIRED';
}

export function createDeltaFirstObservationPipeline(options = {}) {
  const maxPatchBytes = positiveInteger(options.maxPatchBytes, DEFAULT_MAX_PATCH_BYTES, MAX_PATCH_BYTES);
  const store = createSemanticWorkingStateStore(options);
  const scopes = new Map();

  function dropScope(key) {
    const entry = scopes.get(key);
    if (entry?.stateId) store.drop(entry.stateId);
    scopes.delete(key);
  }

  function dropRelatedTarget(identity, exceptKey) {
    for (const [key, entry] of scopes) {
      if (key === exceptKey) continue;
      const current = entry.identity;
      if (
        String(current?.tenantId ?? '') === String(identity?.tenantId ?? '')
        && String(current?.deviceId ?? '') === String(identity?.deviceId ?? '')
        && String(current?.tabId ?? '') === String(identity?.tabId ?? '')
      ) {
        if (entry.stateId) store.drop(entry.stateId);
        scopes.delete(key);
      }
    }
  }

  function failClosed(identity, observation, key, reason) {
    dropScope(key);
    return fullSnapshotObservation(observation, {
      resetRequired: true,
      resetReason: reason,
      continuityStatus: 'RESET_REQUIRED',
      canonicalState: null,
      maxPatchBytes,
    });
  }

  function bootstrap(identity, observation, key, meta) {
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
    } catch (error) {
      return failClosed(identity, observation, key, errorReason(error));
    }
  }

  function observe(identity, observation, request = {}) {
    const key = identityKey(identity);
    const meta = snapshotMeta(observation);
    if (meta.classification === 'RESET') {
      return bootstrap(identity, observation, key, meta);
    }

    const entry = scopes.get(key);
    if (!entry?.stateId) {
      return failClosed(identity, observation, key, 'MISSING_CONTINUITY');
    }

    let canonicalState;
    try {
      canonicalState = store.apply(entry.stateId, identity, observation);
    } catch (error) {
      return failClosed(identity, observation, key, errorReason(error));
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
      return failClosed(identity, observation, key, 'PATCH_OVERFLOW');
    }
    return frozen({
      reasoningObservation: compact.reasoningObservation,
      canonicalState,
    });
  }

  function inspect(identity) {
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

  function hasContinuity(identity) {
    return inspect(identity) !== null;
  }

  function clear() {
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
