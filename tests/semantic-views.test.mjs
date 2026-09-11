import assert from 'node:assert/strict';
import test from 'node:test';

await import('../extension/semantic-identity.js');
await import('../extension/semantic-views.js');

const { createViewEngine } = globalThis.OperaAgentSemanticViews;
const region = (overrides = {}) => ({ regionId: 'region-feed', kind: 'repeated', role: 'feed', label: 'Results', ...overrides });
const item = (id, overrides = {}) => ({ logicalId: `logical-${id}`, semanticRevision: 1, regionKey: 'region-feed', stableKey: `key-${id}`, stableKeySource: 'id', inViewport: true, ...overrides });

test('a repeated region grows incrementally and only its view revision changes', () => {
  const engine = createViewEngine();
  const first = engine.observe({ regions: [region(), region({ regionId: 'region-main', kind: 'landmark', role: 'main' })], items: [item('a')] });
  const second = engine.observe({ regions: [region(), region({ regionId: 'region-main', kind: 'landmark', role: 'main' })], items: [item('a'), item('b')] });
  assert.equal(second.regions[0].loadedEntityCount, 2);
  assert.equal(second.regions[0].viewRevision, first.regions[0].viewRevision + 1);
  assert.equal(second.regions[1].viewRevision, first.regions[1].viewRevision);
  assert.deepEqual(second.changedRegionIds, ['region-feed']);
});

test('boundary requires two stable observations before bounded completion', () => {
  const engine = createViewEngine();
  const scroll = { scrollTop: 500, scrollHeight: 600, clientHeight: 100, reachedBottom: true };
  const first = engine.observe({ regions: [region({ scroll })], items: [item('a')] });
  const second = engine.observe({ regions: [region({ scroll })], items: [item('a')] });
  assert.equal(first.regions[0].exhaustion.status, 'PARTIAL');
  assert.equal(second.regions[0].exhaustion.status, 'BOUNDED_COMPLETE');
});

test('scroll evidence changes only the affected region revision', () => {
  const engine = createViewEngine();
  const main = region({ regionId: 'region-main', kind: 'landmark', role: 'main' });
  const first = engine.observe({
    regions: [region({ scroll: { scrollTop: 0, scrollHeight: 600, clientHeight: 100, reachedBottom: false } }), main],
    items: [item('a')],
  });
  const second = engine.observe({
    regions: [region({ scroll: { scrollTop: 500, scrollHeight: 600, clientHeight: 100, reachedBottom: true } }), main],
    items: [item('a')],
  });
  assert.equal(second.regions[0].viewRevision, first.regions[0].viewRevision + 1);
  assert.equal(second.regions[1].viewRevision, first.regions[1].viewRevision);
  assert.deepEqual(second.changedRegionIds, ['region-feed']);
});

test('views distinguish loaded, visible, links, duplicates, and ambiguity', () => {
  const engine = createViewEngine();
  const result = engine.observe({ regions: [region()], items: [
    item('a', { stableKey: 'href-a', stableKeySource: 'href' }),
    item('b', { inViewport: false, stableKey: 'duplicate', identityAmbiguous: true }),
    item('c', { stableKey: 'duplicate', identityAmbiguous: true }),
  ] }).regions[0];
  assert.equal(result.loadedEntityCount, 3);
  assert.equal(result.visibleEntityCount, 2);
  assert.equal(result.uniqueCanonicalLinkCount, 1);
  assert.equal(result.duplicateKeyCount, 1);
  assert.equal(result.ambiguityCount, 2);
});

test('region and entity bounds are enforced', () => {
  const engine = createViewEngine({ maxRegions: 2, maxEntities: 2 });
  const result = engine.observe({
    regions: [region(), region({ regionId: 'two' }), region({ regionId: 'three' })],
    items: [item('a'), item('b'), item('c')],
  });
  assert.equal(result.regions.length, 2);
  assert.equal(result.regions[0].loadedEntityCount, 2);
});
