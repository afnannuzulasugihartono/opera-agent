// @last-edited: 2026-10-21 UTC+7.
// @title: semantic-views — the semantic views a page publishes: regions, items and completion status.
// @state: the view builders, the bounds they hold, and the completion status a proof carries.
// @dependencies: none.

(() => {
  'use strict';
  if (globalThis.OperaAgentSemanticViews) return;

  interface CompletionResult {
    status: string;
    scope: string;
    evidence: string[];
    limits: string[];
    unresolved: string[];
    blockedReason?: string;
  }

  interface ViewEntity {
    [key: string]: unknown;
  }

  interface ViewDependencies {
    entitySet: { fingerprint: string; count: number };
    scrollState: { fingerprint: string } | null;
  }

  interface ViewExhaustion {
    reachedBoundary: boolean;
    stableObservations: number;
    status: string;
  }

  interface ViewObject {
    regionId: unknown;
    kind: string;
    role: string;
    label: string;
    viewRevision: number;
    actionableCount: number;
    repeatedEntityCount: number;
    loadedEntityCount: number;
    visibleEntityCount: number;
    uniqueCanonicalLinkCount: number;
    duplicateKeyCount: number;
    ambiguityCount: number;
    dependencies: ViewDependencies;
    exhaustion: ViewExhaustion | null;
    completion?: CompletionResult;
  }

  interface ViewState {
    entityFingerprint: string;
    scrollFingerprint: string;
    stableBoundaryObservations: number;
    viewRevision: number;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  const hash = (value: unknown): string => {
    const engine = globalThis.OperaAgentSemanticIdentity;
    if (!engine) throw new Error('OperaAgentSemanticIdentity must load before OperaAgentSemanticViews');
    return engine.stableHash(String(value ?? ''));
  };
  const bounded = (value: unknown, max = 160): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const COMPLETION_STATUSES = Object.freeze(['PROVED', 'BOUNDED_COMPLETE', 'PARTIAL', 'BLOCKED', 'UNKNOWN']);

  function classifyCompletion(input: Record<string, unknown> = {}): CompletionResult {
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

  function createViewEngine(options: Record<string, unknown> = {}) {
    const maxRegionsOption = options.maxRegions;
    const maxRegions = typeof maxRegionsOption === 'number' && Number.isInteger(maxRegionsOption) ? Math.min(100, Math.max(1, maxRegionsOption)) : 50;
    const maxEntitiesOption = options.maxEntities;
    const maxEntities = typeof maxEntitiesOption === 'number' && Number.isInteger(maxEntitiesOption) ? Math.min(1000, Math.max(1, maxEntitiesOption)) : 500;
    const now: () => number = typeof options.now === 'function' ? (options.now as () => number) : Date.now;
    const states = new Map<unknown, ViewState>();
    let revision = 0;

    function observe(input: Record<string, unknown> = {}) {
      revision += 1;
      const semanticState = isRecord(input.semanticState) ? input.semanticState : undefined;
      const inputDelta = isRecord(input.delta) ? input.delta : undefined;
      const regions = (Array.isArray(input.regions) ? input.regions : []).slice(0, maxRegions)
        .filter(isRecord);
      const items = (Array.isArray(input.items) ? input.items : [])
        .filter((item): item is ViewEntity => isRecord(item) && Boolean(item.logicalId))
        .slice(0, maxEntities);
      const grouped = new Map<unknown, ViewEntity[]>(
        regions.map((region): [unknown, ViewEntity[]] => [region.regionId, []]));
      for (const item of items) {
        const regionId = grouped.has(item.regionKey) ? item.regionKey : regions[0]?.regionId;
        if (regionId) grouped.get(regionId)?.push(item);
      }

      const views: ViewObject[] = [];
      const changedRegionIds: unknown[] = [];
      const invalidatedViews: Array<{ regionId: unknown; causes: string[] }> = [];
      for (const region of regions) {
        const entities = grouped.get(region.regionId) || [];
        const keyCounts = new Map<string, number>();
        const linkKeys = new Set<string>();
        for (const item of entities) {
          const key = bounded(item.stableKey, 180);
          if (key) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
          if (item.stableKeySource === 'href' && key) linkKeys.add(key);
        }
        const entityFingerprint = hash(entities.map((item) =>
          `${item.logicalId}:${item.semanticRevision}:${item.inViewport ? 1 : 0}`).join('|'));
        const scroll = isRecord(region.scroll) ? region.scroll : null;
        const scrollFingerprint = scroll ? hash([
          scroll.scrollTop, scroll.scrollHeight, scroll.clientHeight, scroll.reachedBottom,
        ].join('|')) : '';
        const previous = states.get(region.regionId);
        const changed = !previous || previous.entityFingerprint !== entityFingerprint || previous.scrollFingerprint !== scrollFingerprint;
        const invalidationCauses: string[] = [];
        if (previous && previous.entityFingerprint !== entityFingerprint) invalidationCauses.push('ENTITY_DEPENDENCY_CHANGED');
        if (previous && previous.scrollFingerprint !== scrollFingerprint) invalidationCauses.push('SCROLL_DEPENDENCY_CHANGED');
        const stableBoundaryObservations = scroll?.reachedBottom
          ? previous && previous.scrollFingerprint === scrollFingerprint && !changed
            ? previous.stableBoundaryObservations + 1 : 1
          : 0;
        const viewRevision = changed ? (previous?.viewRevision || 0) + 1 : (previous?.viewRevision ?? 0);
        const view: ViewObject = {
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
          sourceRevision: Number(semanticState?.observationRevision || semanticState?.revision || revision),
          sensor: 'DOM_ACCESSIBILITY',
          confidence: views.some((view) => view.ambiguityCount > 0) ? 0.5 : 0.9,
        },
        regions: views,
        changedRegionIds,
        removedRegionIds,
        viewDelta: {
          sourceClassification: bounded(inputDelta?.classification, 40) || 'UNKNOWN',
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
