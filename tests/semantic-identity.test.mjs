import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

await import('../extension/semantic-identity.js');

const { createIdentityEngine } = globalThis.OperaAgentSemanticIdentity;

function element(overrides = {}) {
  return {
    ref: 'oa_doc_1',
    stableKey: 'oa_item_a',
    stableKeySource: 'id',
    tag: 'button',
    role: 'button',
    label: 'Open item',
    text: 'Open item',
    href: '',
    sensitive: false,
    ...overrides,
  };
}

test('stable intrinsic identity survives a compatible DOM-node replacement', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([element()]);
  const second = engine.observe([element({ ref: 'oa_doc_2' })]);

  assert.equal(second.items[0].logicalId, first.items[0].logicalId);
  assert.equal(second.items[0].semanticRevision, 1);
  assert.equal(second.items[0].identityAmbiguous ?? false, false);
});

test('a genuinely different intrinsic item cannot inherit an identity', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([element()]);
  const second = engine.observe([element({ ref: 'oa_doc_2', stableKey: 'oa_item_b', label: 'Other item', text: 'Other item' })]);

  assert.notEqual(second.items[0].logicalId, first.items[0].logicalId);
});

test('indistinguishable duplicate candidates are explicit ambiguities', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const result = engine.observe([
    element({ ref: 'oa_doc_1', stableKeySource: 'semantic' }),
    element({ ref: 'oa_doc_2', stableKeySource: 'semantic' }),
  ]);

  assert.equal(result.state.ambiguityCount, 2);
  assert.equal(result.items[0].identityAmbiguous, true);
  assert.equal(result.items[1].identityAmbiguous, true);
  assert.notEqual(result.items[0].logicalId, result.items[1].logicalId);
});

test('semantic changes retain intrinsic identity and increment its revision', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([element()]);
  const second = engine.observe([element({ ref: 'oa_doc_2', label: 'Close item', text: 'Close item' })]);

  assert.equal(second.items[0].logicalId, first.items[0].logicalId);
  assert.equal(second.items[0].semanticRevision, 2);
});

test('geometry changes have an independent revision and do not change identity', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const first = engine.observe([element({ rect: { x: 10, y: 20, width: 100, height: 30 }, inViewport: true })]);
  const second = engine.observe([element({ ref: 'oa_doc_2', rect: { x: 10, y: 70, width: 100, height: 30 }, inViewport: true })]);
  const cached = engine.inspect().entities[0];

  assert.equal(second.items[0].logicalId, first.items[0].logicalId);
  assert.equal(second.items[0].semanticRevision, 1);
  assert.equal(cached.geometryRevision, 2);
});

test('fresh engines deterministically replay the same logical identities', () => {
  const items = [element(), element({ ref: 'oa_doc_2', stableKey: 'oa_item_b' })];
  const left = createIdentityEngine({ documentId: 'document-a' }).observe(items.map((item) => ({ ...item })));
  const right = createIdentityEngine({ documentId: 'document-a' }).observe(items.map((item) => ({ ...item })));

  assert.deepEqual(left.items.map((item) => item.logicalId), right.items.map((item) => item.logicalId));
});

test('bounded corpus-sized observations produce no logical ID collision', () => {
  const engine = createIdentityEngine({ documentId: 'document-a', maxEntities: 500 });
  const result = engine.observe(Array.from({ length: 500 }, (_, index) => element({
    ref: `oa_doc_${index}`,
    stableKey: `oa_record_${String(index).padStart(3, '0')}`,
  })));
  const logicalIds = result.items.map((item) => item.logicalId);

  assert.equal(new Set(logicalIds).size, 500);
  assert.equal(result.state.collisionCount, 0);
});

test('logical IDs remain observational and are absent from every action schema', () => {
  const protocol = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  assert.doesNotMatch(protocol, /logicalId/);
});

test('sensitive elements are never retained in the semantic identity cache', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  const result = engine.observe([element({ sensitive: true, label: 'Password', text: '' })]);

  assert.equal(result.items[0].logicalId, undefined);
  assert.equal(result.state.entityCount, 0);
  assert.equal(result.state.excludedSensitiveCount, 1);
  assert.doesNotMatch(JSON.stringify(engine.inspect()), /Password/);
});

test('cache limits and explicit reset bound retained identity state', () => {
  let now = 1_000;
  const engine = createIdentityEngine({
    documentId: 'document-a',
    maxEntities: 2,
    maxCacheBytes: 2_000,
    maxAgeMs: 50,
    now: () => now,
  });
  engine.observe([element({ stableKey: 'oa_a' }), element({ ref: 'oa_2', stableKey: 'oa_b' })]);
  engine.observe([element({ ref: 'oa_3', stableKey: 'oa_c' })]);
  assert.ok(engine.inspect().entityCount <= 2);

  now += 60;
  engine.observe([]);
  assert.equal(engine.inspect().entityCount, 0);

  engine.observe([element()]);
  const reset = engine.reset('SPA_ROUTE');
  assert.equal(reset.resetReason, 'SPA_ROUTE');
  assert.equal(reset.documentGeneration, 2);
  assert.equal(engine.inspect().entityCount, 0);
});

test('cache inspection stores only hashed bindings, never raw hrefs', () => {
  const engine = createIdentityEngine({ documentId: 'document-a' });
  engine.observe([element({
    stableKey: '',
    stableKeySource: '',
    tag: 'a',
    href: 'https://example.test/account?private_token=secret-value#fragment',
  })]);

  const cache = JSON.stringify(engine.inspect());
  assert.doesNotMatch(cache, /private_token|secret-value|example\.test/);
});
