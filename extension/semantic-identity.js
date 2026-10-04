// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: semantic-identity — identity — MV3 runtime.
// @context: MV3 browser runtime.
// @state: log previously silent catches in background/popup/protocol/identity.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

(() => {
  'use strict';
  if (globalThis.OperaAgentSemanticIdentity) return;

  const DEFAULT_MAX_ENTITIES = 500;
  const DEFAULT_MAX_CACHE_BYTES = 256 * 1024;
  const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
  const DEFAULT_MAX_DELTA_CHANGES = 100;
  const DEFAULT_MAX_DELTA_BYTES = 64 * 1024;

  function bounded(value, max = 300) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function stableHash(value) {
    const input = String(value ?? '');
    let first = 2166136261;
    let second = 5381;
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619);
      second = Math.imul(second, 33) ^ code;
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function canonicalHref(value) {
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.hash = '';
      return url.toString();
    } catch (error) {
      // Classic-script safe: this IIFE loads via manifest content scripts,
      // executeScript injection, and Node test imports — never import the
      // logger, resolve it lazily and tolerate its absence.
      globalThis.OperaAgentLog?.debug?.('HREF_CANONICALIZE_FAILED', error?.message || String(error));
      return '';
    }
  }

  function bindingFor(item) {
    const stableKey = bounded(item.stableKey, 160);
    const source = bounded(item.stableKeySource, 40).toLowerCase();
    if (stableKey && (source === 'href' || source === 'id')) {
      return { key: `${source}:${stableKey}`, kind: 'intrinsic', confidence: 0.98 };
    }
    const href = canonicalHref(item.href);
    if (href) return { key: `href-hash:${stableHash(href)}`, kind: 'intrinsic', confidence: 0.95 };
    if (stableKey) return { key: `semantic-key:${stableKey}`, kind: 'semantic', confidence: 0.75 };
    const fingerprint = [item.tag, item.role, item.name, item.label, item.text, item.structuralKey]
      .map((part) => bounded(part, 300)).join('|');
    return { key: `fingerprint:${stableHash(fingerprint)}`, kind: 'semantic', confidence: 0.65 };
  }

  function signatureFor(item) {
    return stableHash([
      item.tag, item.role, item.name, item.label, item.text, item.type,
      item.checked, item.selected, item.disabled, item.ariaPressed,
      item.ariaChecked, item.ariaExpanded, item.ariaSelected,
    ].map((part) => bounded(part, 300)).join('|'));
  }

  function geometrySignatureFor(item) {
    const rect = item?.rect || {};
    return stableHash([rect.x, rect.y, rect.width, rect.height, item.inViewport]
      .map((part) => bounded(part, 40)).join('|'));
  }

  function positiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  function createIdentityEngine(options = {}) {
    const documentScope = stableHash(bounded(options.documentId || 'document', 200));
    const maxEntities = positiveInteger(options.maxEntities, DEFAULT_MAX_ENTITIES);
    const maxCacheBytes = positiveInteger(options.maxCacheBytes, DEFAULT_MAX_CACHE_BYTES);
    const maxAgeMs = positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS);
    const maxDeltaChanges = positiveInteger(options.maxDeltaChanges, DEFAULT_MAX_DELTA_CHANGES);
    const maxDeltaBytes = positiveInteger(options.maxDeltaBytes, DEFAULT_MAX_DELTA_BYTES);
    const removalGraceObservations = Number.isInteger(options.removalGraceObservations) && options.removalGraceObservations >= 0
      ? Math.min(options.removalGraceObservations, 3) : 1;
    // U-P3 (research P3): an entity observed present-but-invisible for this
    // many consecutive observations is marked stale in the model-facing view.
    // Canonical state keeps stale entities; the marking is advisory only.
    const invisibleGraceObservations = Number.isInteger(options.invisibleGraceObservations) && options.invisibleGraceObservations >= 1
      ? Math.min(options.invisibleGraceObservations, 3) : 2;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const records = new Map();
    const bindingIndex = new Map();
    const refIndex = new Map();
    const lastObserved = new Map();
    const missingObservations = new Map();
    // U-P3: entities emitted as REMOVE after grace; a later re-observation
    // reports RETURNED_AFTER_ABSENCE instead of NEW_ENTITY so virtualized
    // feeds stop surfacing returning content as new state.
    const returnedAfterGrace = new Set();
    let documentGeneration = 1;
    let observationRevision = 0;
    let logicalCounter = 0;
    let lastResetReason = null;
    let pendingResetReason = 'INITIAL_OBSERVATION';
    let retainedBytes = 0;

    function recordBytes(record) {
      return 256 + record.logicalId.length + record.bindingHash.length + record.bindingKind.length +
        record.ref.length + record.stableKey.length + record.signature.length +
        record.kind.length + record.role.length + record.semanticLabel.length + record.regionMembership.length;
    }

    function remove(logicalId) {
      const record = records.get(logicalId);
      if (!record) return;
      records.delete(logicalId);
      returnedAfterGrace.delete(logicalId);
      retainedBytes -= record.retainedBytes;
      if (record.ref && refIndex.get(record.ref) === logicalId) refIndex.delete(record.ref);
      const ids = bindingIndex.get(record.bindingHash);
      ids?.delete(logicalId);
      if (ids?.size === 0) bindingIndex.delete(record.bindingHash);
    }

    function cacheBytes() {
      return retainedBytes;
    }

    function evict(timestamp) {
      for (const record of records.values()) {
        if (timestamp - record.lastSeenAt > maxAgeMs) remove(record.logicalId);
      }
      const oldest = () => [...records.values()].sort((left, right) =>
        left.lastSeenRevision - right.lastSeenRevision || left.createdOrder - right.createdOrder)[0];
      while (records.size > maxEntities || cacheBytes() > maxCacheBytes) {
        const record = oldest();
        if (!record) break;
        remove(record.logicalId);
      }
    }

    function createRecord(binding, bindingHash, item, timestamp) {
      logicalCounter += 1;
      const logicalId = `se_${documentScope.slice(0, 4)}_${bindingHash.slice(0, 10)}_${logicalCounter.toString(36)}`;
      const record = {
        logicalId,
        revision: 1,
        bindingHash,
        bindingKind: binding.kind,
        ref: bounded(item.ref, 120),
        stableKey: bounded(item.stableKey, 160),
        signature: signatureFor(item),
        kind: bounded(item.tag, 80),
        role: bounded(item.role, 80),
        semanticLabel: bounded(item.label || item.text, 200),
        regionMembership: bounded(item.regionKey, 120),
        geometrySignature: geometrySignatureFor(item),
        geometryRevision: 1,
        firstSeenRevision: observationRevision,
        lastSeenRevision: observationRevision,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        createdOrder: logicalCounter,
        confidence: binding.confidence,
        invisibleStreak: 0,
        stale: false,
        ambiguous: false,
      };
      record.retainedBytes = recordBytes(record);
      retainedBytes += record.retainedBytes;
      records.set(logicalId, record);
      if (!bindingIndex.has(record.bindingHash)) bindingIndex.set(record.bindingHash, new Set());
      bindingIndex.get(record.bindingHash).add(logicalId);
      if (record.ref) refIndex.set(record.ref, logicalId);
      return record;
    }

    function updateRecord(record, item, timestamp) {
      retainedBytes -= record.retainedBytes;
      const signature = signatureFor(item);
      if (signature !== record.signature) {
        record.signature = signature;
        record.revision += 1;
      }
      const geometrySignature = geometrySignatureFor(item);
      if (geometrySignature !== record.geometrySignature) {
        record.geometrySignature = geometrySignature;
        record.geometryRevision += 1;
      }
      if (record.ref && refIndex.get(record.ref) === record.logicalId) refIndex.delete(record.ref);
      record.ref = bounded(item.ref, 120);
      record.stableKey = bounded(item.stableKey, 160);
      record.kind = bounded(item.tag, 80);
      record.role = bounded(item.role, 80);
      record.semanticLabel = bounded(item.label || item.text, 200);
      record.regionMembership = bounded(item.regionKey, 120);
      record.lastSeenRevision = observationRevision;
      record.lastSeenAt = timestamp;
      record.retainedBytes = recordBytes(record);
      retainedBytes += record.retainedBytes;
      if (record.ref) refIndex.set(record.ref, record.logicalId);
      return record;
    }

    // U-P3 (research P3): track consecutive present-but-invisible observations
    // per entity. After the grace the entity is marked stale in the
    // model-facing view; canonical state keeps it and the marking is advisory.
    function trackStaleness(record, item) {
      const rendered = item.visible !== false;
      if (rendered) {
        record.invisibleStreak = 0;
        record.stale = false;
        return;
      }
      record.invisibleStreak = (record.invisibleStreak || 0) + 1;
      if (record.invisibleStreak >= invisibleGraceObservations) record.stale = true;
    }

    function observe(inputItems = []) {
      observationRevision += 1;
      const timestamp = Number(now());
      evict(timestamp);
      const items = Array.isArray(inputItems) ? inputItems : [];
      const candidates = items.map((item, index) => {
        const binding = bindingFor(item);
        return { item, index, binding, bindingHash: stableHash(binding.key) };
      });
      const currentGroups = new Map();
      for (const candidate of candidates) {
        if (!currentGroups.has(candidate.bindingHash)) currentGroups.set(candidate.bindingHash, []);
        currentGroups.get(candidate.bindingHash).push(candidate);
      }

      let ambiguityCount = 0;
      let collisionCount = 0;
      let excludedSensitiveCount = 0;
      const output = items;

      for (const candidate of candidates) {
        const { item, index, binding, bindingHash } = candidate;
        if (item?.sensitive) {
          excludedSensitiveCount += 1;
          continue;
        }
        const currentAmbiguous = currentGroups.get(bindingHash).length > 1;
        const historicalIds = bindingIndex.get(bindingHash) || new Set();
        const byRef = item.ref ? records.get(refIndex.get(bounded(item.ref, 120))) : null;
        let record = byRef?.bindingHash === bindingHash ? byRef : null;
        let ambiguous = currentAmbiguous || historicalIds.size > 1;
        if (!record && !ambiguous && historicalIds.size === 1) record = records.get([...historicalIds][0]);
        if (!record) {
          if (historicalIds.size > 0) collisionCount += 1;
          record = createRecord(binding, bindingHash, item, timestamp);
        } else {
          updateRecord(record, item, timestamp);
        }
        trackStaleness(record, item);
        if (ambiguous) ambiguityCount += 1;
        item.logicalId = record.logicalId;
        item.semanticRevision = record.revision;
        if (record.stale) item.stale = true;
        record.ambiguous = ambiguous;
        record.confidence = ambiguous ? 0.25 : binding.confidence;
        if (ambiguous) {
          item.identityConfidence = record.confidence;
          item.identityAmbiguous = true;
        }
        output[index] = item;
      }

      evict(timestamp);
      const currentObserved = new Map();
      for (let index = 0; index < output.length; index += 1) {
        const item = output[index];
        if (!item.logicalId) continue;
        const record = records.get(item.logicalId);
        if (!record) continue;
        currentObserved.set(item.logicalId, {
          logicalId: item.logicalId,
          revision: record.revision,
          geometryRevision: record.geometryRevision,
          index,
          regionMembership: record.regionMembership,
          inViewport: !!item.inViewport,
          confidence: record.confidence,
        });
      }

      const sourceRevision = Math.max(0, observationRevision - 1);
      let changes = [];
      let resetReason = pendingResetReason;
      if (!resetReason) {
        for (const current of currentObserved.values()) {
          const previous = lastObserved.get(current.logicalId);
          missingObservations.delete(current.logicalId);
          if (!previous) {
            if (returnedAfterGrace.has(current.logicalId)) {
              returnedAfterGrace.delete(current.logicalId);
              changes.push({
                type: 'UPDATE', logicalId: current.logicalId, revision: current.revision,
                reason: 'RETURNED_AFTER_ABSENCE', confidence: current.confidence,
              });
            } else {
              changes.push({
                type: 'INSERT', logicalId: current.logicalId, revision: current.revision,
                reason: 'NEW_ENTITY', confidence: current.confidence,
              });
            }
          } else if (current.revision !== previous.revision) {
            changes.push({
              type: 'UPDATE', logicalId: current.logicalId, revision: current.revision,
              reason: 'SEMANTIC_FIELDS_CHANGED', confidence: current.confidence,
            });
          } else if (current.geometryRevision !== previous.geometryRevision || current.index !== previous.index ||
            current.regionMembership !== previous.regionMembership || current.inViewport !== previous.inViewport) {
            changes.push({
              type: 'MOVE', logicalId: current.logicalId, revision: current.revision,
              reason: 'GEOMETRY_OR_ORDER_CHANGED', confidence: current.confidence,
            });
          }
          lastObserved.set(current.logicalId, current);
        }
        for (const [logicalId, previous] of lastObserved) {
          if (currentObserved.has(logicalId)) continue;
          const missed = (missingObservations.get(logicalId) || 0) + 1;
          missingObservations.set(logicalId, missed);
          if (missed > removalGraceObservations) {
            changes.push({
              type: 'REMOVE', logicalId, revision: previous.revision,
              reason: 'ABSENT_AFTER_GRACE', confidence: previous.confidence,
            });
            missingObservations.delete(logicalId);
            lastObserved.delete(logicalId);
            returnedAfterGrace.add(logicalId);
          }
        }
      } else {
        lastObserved.clear();
        missingObservations.clear();
        for (const current of currentObserved.values()) lastObserved.set(current.logicalId, current);
      }

      let classification;
      let completeSnapshotRequired = false;
      if (resetReason) {
        classification = 'RESET';
        completeSnapshotRequired = true;
        changes = [];
      } else if (!changes.length) {
        classification = 'NO_RELEVANT_CHANGE';
      } else {
        const types = new Set(changes.map((change) => change.type));
        classification = types.size === 1 ? changes[0].type : 'MIXED';
      }
      let delta = {
        schemaVersion: 1,
        sourceRevision,
        resultingRevision: observationRevision,
        classification,
        changes,
        completeSnapshotRequired,
        ...(resetReason ? { resetReason } : {}),
      };
      if (changes.length > maxDeltaChanges || JSON.stringify(delta).length > maxDeltaBytes) {
        resetReason = 'OUTPUT_CAP';
        delta = {
          schemaVersion: 1,
          sourceRevision,
          resultingRevision: observationRevision,
          classification: 'RESET',
          changes: [],
          completeSnapshotRequired: true,
          resetReason,
        };
        lastObserved.clear();
        missingObservations.clear();
        for (const current of currentObserved.values()) lastObserved.set(current.logicalId, current);
      }
      pendingResetReason = null;
      return {
        items: output,
        delta,
        state: {
          schemaVersion: 1,
          documentGeneration,
          observationRevision,
          entityCount: records.size,
          observedEntityCount: output.length - excludedSensitiveCount,
          ambiguityCount,
          collisionCount,
          excludedSensitiveCount,
          cacheBytes: cacheBytes(),
          resetReason: lastResetReason,
        },
      };
    }

    function reset(reason = 'EXPLICIT_RESET') {
      records.clear();
      bindingIndex.clear();
      refIndex.clear();
      lastObserved.clear();
      missingObservations.clear();
      returnedAfterGrace.clear();
      retainedBytes = 0;
      documentGeneration += 1;
      observationRevision = 0;
      lastResetReason = bounded(reason, 80) || 'EXPLICIT_RESET';
      pendingResetReason = lastResetReason;
      return { documentGeneration, resetReason: lastResetReason };
    }

    function inspect() {
      return {
        documentGeneration,
        observationRevision,
        entityCount: records.size,
        cacheBytes: cacheBytes(),
        resetReason: lastResetReason,
        entities: [...records.values()].map((record) => ({ ...record })),
      };
    }

    return Object.freeze({ observe, reset, inspect });
  }

  globalThis.OperaAgentSemanticIdentity = Object.freeze({ createIdentityEngine, stableHash });
})();
