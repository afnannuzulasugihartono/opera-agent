// @last-edited: 2026-10-21 UTC+7.
// @title: semantic-views — the semantic views a page publishes: regions, items and completion status.
// @state: the view builders, the bounds they hold, and the completion status a proof carries.
// @dependencies: none.

(() => {
  'use strict';
  if (globalThis.OperaAgentSemanticViews) return;

  const hash = (value) => globalThis.OperaAgentSemanticIdentity.stableHash(String(value ?? ''));
  const bounded = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const COMPLETION_STATUSES = Object.freeze(['PROVED', 'BOUNDED_COMPLETE', 'PARTIAL', 'BLOCKED', 'UNKNOWN']);

  function classifyCompletion(input = {}) {
    const evidence = (Array.isArray(input.evidence) ? input.evidence : []).slice(0, 12).map((value) => bounded(value, 160));
    const blockedReason = bounded(input.blockedReason, 160);
    let status = 'UNKNOWN';
    if (blockedReason) status = 'BLOCKED';
    else if (input.scopeKind === 'closed-world' && input.exhaustiveEvidence === true && evidence.length) status = 'PROVED';
    else if (input.boundaryStable === true && evidence.length) status = 'BOUNDED_COMPLETE';
    else if (input.observed === true) status = 'PARTIAL';
    return {
      status,
      scope: bounded(input.scope, 160) || 'unspecified observation scope',
      evidence,
      limits: (Array.isArray(input.limits) ? input.limits : []).slice(0, 12).map((value) => bounded(value, 160)),
      unresolved: (Array.isArray(input.unresolved) ? input.unresolved : []).slice(0, 12).map((value) => bounded(value, 160)),
      ...(blockedReason ? { blockedReason } : {}),
    };
  }

  function createViewEngine(options = {}) {
    const maxRegions = Number.isInteger(options.maxRegions) ? Math.min(100, Math.max(1, options.maxRegions)) : 50;
    const maxEntities = Number.isInteger(options.maxEntities) ? Math.min(1000, Math.max(1, options.maxEntities)) : 500;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const states = new Map();
    let revision = 0;

    function observe(input = {}) {
      revision += 1;
      const regions = (Array.isArray(input.regions) ? input.regions : []).slice(0, maxRegions);
      const items = (Array.isArray(input.items) ? input.items : []).filter((item) => item.logicalId).slice(0, maxEntities);
      const grouped = new Map(regions.map((region) => [region.regionId, []]));
      for (const item of items) {
        const regionId = grouped.has(item.regionKey) ? item.regionKey : regions[0]?.regionId;
        if (regionId) grouped.get(regionId).push(item);
      }

      const views = [];
      const changedRegionIds = [];
      const invalidatedViews = [];
      for (const region of regions) {
        const entities = grouped.get(region.regionId) || [];
        const keyCounts = new Map();
        const linkKeys = new Set();
        for (const item of entities) {
          const key = bounded(item.stableKey, 180);
          if (key) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
          if (item.stableKeySource === 'href' && key) linkKeys.add(key);
        }
        const entityFingerprint = hash(entities.map((item) =>
          `${item.logicalId}:${item.semanticRevision}:${item.inViewport ? 1 : 0}`).join('|'));
        const scroll = region.scroll || null;
        const scrollFingerprint = scroll ? hash([
          scroll.scrollTop, scroll.scrollHeight, scroll.clientHeight, scroll.reachedBottom,
        ].join('|')) : '';
        const previous = states.get(region.regionId);
        const changed = !previous || previous.entityFingerprint !== entityFingerprint || previous.scrollFingerprint !== scrollFingerprint;
        const invalidationCauses = [];
        if (previous && previous.entityFingerprint !== entityFingerprint) invalidationCauses.push('ENTITY_DEPENDENCY_CHANGED');
        if (previous && previous.scrollFingerprint !== scrollFingerprint) invalidationCauses.push('SCROLL_DEPENDENCY_CHANGED');
        const stableBoundaryObservations = scroll?.reachedBottom
          ? previous?.scrollFingerprint === scrollFingerprint && !changed
            ? previous.stableBoundaryObservations + 1 : 1
          : 0;
        const viewRevision = changed ? (previous?.viewRevision || 0) + 1 : previous.viewRevision;
        const view = {
          regionId: region.regionId,
          kind: bounded(region.kind, 40),
          role: bounded(region.role, 80),
          label: bounded(region.label, 160),
          viewRevision,
          actionableCount: entities.length,
          repeatedEntityCount: entities.length,
          loadedEntityCount: entities.length,
          visibleEntityCount: entities.filter((item) => item.inViewport).length,
          uniqueCanonicalLinkCount: linkKeys.size,
          duplicateKeyCount: [...keyCounts.values()].filter((count) => count > 1).length,
          ambiguityCount: entities.filter((item) => item.identityAmbiguous).length,
          dependencies: {
            entitySet: { fingerprint: entityFingerprint, count: entities.length },
            scrollState: scroll ? { fingerprint: scrollFingerprint } : null,
          },
          exhaustion: scroll ? {
            reachedBoundary: !!scroll.reachedBottom,
            stableObservations: stableBoundaryObservations,
            status: scroll.reachedBottom && stableBoundaryObservations >= 2 ? 'BOUNDED_COMPLETE' : 'PARTIAL',
          } : null,
        };
        view.completion = classifyCompletion({
          observed: true,
          boundaryStable: view.exhaustion?.status === 'BOUNDED_COMPLETE',
          scope: `rendered entities in region ${region.regionId}`,
          evidence: [`view-revision:${viewRevision}`, `loaded-entities:${entities.length}`,
            ...(scroll ? [`stable-boundary-observations:${stableBoundaryObservations}`] : [])],
          limits: ['DOM_AND_ACCESSIBILITY_OBSERVATION_ONLY', `ENTITY_CAP:${maxEntities}`, `REGION_CAP:${maxRegions}`],
          unresolved: [
            ...(view.exhaustion?.status === 'BOUNDED_COMPLETE' ? [] : ['CONTENT_MAY_EXIST_OUTSIDE_OBSERVED_SCOPE']),
            ...(view.ambiguityCount ? [`IDENTITY_AMBIGUITIES:${view.ambiguityCount}`] : []),
          ],
        });
        if (changed) changedRegionIds.push(region.regionId);
        if (invalidationCauses.length) invalidatedViews.push({ regionId: region.regionId, causes: invalidationCauses });
        states.set(region.regionId, { entityFingerprint, scrollFingerprint, stableBoundaryObservations, viewRevision });
        views.push(view);
      }
      const present = new Set(regions.map((region) => region.regionId));
      const removedRegionIds = [...states.keys()].filter((regionId) => !present.has(regionId));
      for (const regionId of removedRegionIds) states.delete(regionId);
      return {
        schemaVersion: 1,
        revision,
        provenance: {
          category: 'DIRECT_OBSERVATION',
          observedAt: Number(now()),
          sourceRevision: Number(input.semanticState?.observationRevision || input.semanticState?.revision || revision),
          sensor: 'DOM_ACCESSIBILITY',
          confidence: views.some((view) => view.ambiguityCount > 0) ? 0.5 : 0.9,
        },
        regions: views,
        changedRegionIds,
        removedRegionIds,
        viewDelta: {
          sourceClassification: bounded(input.delta?.classification, 40) || 'UNKNOWN',
          invalidatedViews,
          removedRegionIds,
        },
      };
    }

    function reset() {
      states.clear();
      revision = 0;
    }

    return Object.freeze({ observe, reset });
  }

  globalThis.OperaAgentSemanticViews = Object.freeze({ COMPLETION_STATUSES, classifyCompletion, createViewEngine });
})();
