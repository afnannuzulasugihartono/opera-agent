import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// U-P3 (research P3, 2026-09-20 method matrix): stale semantic pruning.
// (A) entities observed present-but-invisible for N consecutive observations
// are marked stale in the model-facing view while canonical state keeps them;
// (B) compact observations drop stale items so dismissed panels (Miro
// remnants, FAQ/cookie controls) stop reaching the model; (C) entities that
// return after a grace removal emit RETURNED_AFTER_ABSENCE instead of
// NEW_ENTITY so virtualized feeds (X scroll) stop reporting recurring state
// as new. Canonical identity is preserved in every path.

await import('../extension/semantic-identity.js');
const { createIdentityEngine } = globalThis.OperaAgentSemanticIdentity;

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const content = read('../extension/content.js');

function item(key, overrides = {}) {
  return {
    ref: `ref-${key}`,
    stableKey: `key-${key}`,
    stableKeySource: 'id',
    tag: 'button',
    role: 'button',
    label: `Item ${key}`,
    text: `Item ${key}`,
    rect: { x: 0, y: 0, width: 100, height: 30 },
    inViewport: true,
    visible: true,
    sensitive: false,
    ...overrides,
  };
}

test('entity invisible for N consecutive observations is marked stale', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  const first = engine.observe([item('a')]);
  assert.notEqual(first.items[0].stale, true);
  const second = engine.observe([item('a', { visible: false })]);
  assert.notEqual(second.items[0].stale, true);
  const third = engine.observe([item('a', { visible: false })]);
  assert.equal(third.items[0].stale, true);
});

test('stale clears when the entity is observed visible again', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  engine.observe([item('a')]);
  engine.observe([item('a', { visible: false })]);
  const third = engine.observe([item('a', { visible: false })]);
  assert.equal(third.items[0].stale, true);
  const fourth = engine.observe([item('a')]);
  assert.notEqual(fourth.items[0].stale, true);
});

test('canonical state keeps stale entities with identity intact', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  engine.observe([item('a')]);
  engine.observe([item('a', { visible: false })]);
  const third = engine.observe([item('a', { visible: false })]);
  assert.equal(third.items[0].stale, true);
  assert.ok(third.items[0].logicalId);
  assert.ok(third.items[0].semanticRevision >= 1);
  const state = engine.inspect();
  assert.equal(state.entityCount, 1);
  assert.equal(state.entities[0].stale, true);
});

test('entity absent one observation stays within grace without REMOVE', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  engine.observe([item('a')]);
  const gone = engine.observe([]);
  assert.equal(gone.delta.classification, 'NO_RELEVANT_CHANGE');
  const back = engine.observe([item('a')]);
  assert.notEqual(back.delta.classification, 'INSERT');
  assert.equal(back.delta.changes.some((change) => change.type === 'REMOVE'), false);
});

test('entity returning after grace removal emits RETURNED_AFTER_ABSENCE, not NEW_ENTITY', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  const first = engine.observe([item('a')]);
  engine.observe([]);
  const gone = engine.observe([]);
  assert.equal(gone.delta.classification, 'REMOVE');
  const back = engine.observe([item('a', { ref: 'ref-a-new' })]);
  assert.equal(back.items[0].logicalId, first.items[0].logicalId);
  assert.equal(back.delta.classification, 'UPDATE');
  assert.equal(back.delta.changes.length, 1);
  assert.equal(back.delta.changes[0].type, 'UPDATE');
  assert.equal(back.delta.changes[0].reason, 'RETURNED_AFTER_ABSENCE');
  const stable = engine.observe([item('a', { ref: 'ref-a-new' })]);
  assert.equal(stable.delta.classification, 'NO_RELEVANT_CHANGE');
});

test('content.js drops stale items from compact observations (pruning)', () => {
  assert.match(content, /const add = \(item\) => \{\s*\n\s*if \(!item \|\| item\.sensitive \|\| item\.stale\) return;/);
});

test('stale tracking is bounded and resets cleanly', () => {
  const engine = createIdentityEngine({ documentId: 'stale-document' });
  for (let index = 0; index < 10; index += 1) {
    engine.observe([item('a', { visible: false })]);
  }
  engine.reset('EXPLICIT_RESET');
  const fresh = engine.observe([item('a', { visible: false })]);
  assert.notEqual(fresh.items[0].stale, true);
  assert.equal(fresh.state.entityCount, 1);
});
