(() => {
  'use strict';
  if (globalThis.OperaAgentSemanticViews) return;

  const hash = (value) => globalThis.OperaAgentSemanticIdentity.stableHash(String(value ?? ''));
  const bounded = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  function createViewEngine(options = {}) {
    const maxRegions = Number.isInteger(options.maxRegions) ? Math.min(100, Math.max(1, options.maxRegions)) : 50;
    const maxEntities = Number.isInteger(options.maxEntities) ? Math.min(1000, Math.max(1, options.maxEntities)) : 500;
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
          exhaustion: scroll ? {
            reachedBoundary: !!scroll.reachedBottom,
            stableObservations: stableBoundaryObservations,
            status: scroll.reachedBottom && stableBoundaryObservations >= 2 ? 'BOUNDED_COMPLETE' : 'PARTIAL',
          } : null,
        };
        if (changed) changedRegionIds.push(region.regionId);
        states.set(region.regionId, { entityFingerprint, scrollFingerprint, stableBoundaryObservations, viewRevision });
        views.push(view);
      }
      const present = new Set(regions.map((region) => region.regionId));
      const removedRegionIds = [...states.keys()].filter((regionId) => !present.has(regionId));
      for (const regionId of removedRegionIds) states.delete(regionId);
      return { schemaVersion: 1, revision, regions: views, changedRegionIds, removedRegionIds };
    }

    function reset() {
      states.clear();
      revision = 0;
    }

    return Object.freeze({ observe, reset });
  }

  globalThis.OperaAgentSemanticViews = Object.freeze({ createViewEngine });
})();
