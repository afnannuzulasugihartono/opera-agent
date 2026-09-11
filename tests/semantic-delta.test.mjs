import assert from 'node:assert/strict';
import test from 'node:test';

await import('../extension/semantic-identity.js');

const { createIdentityEngine } = globalThis.OperaAgentSemanticIdentity;

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
    sensitive: false,
    ...overrides,
  };
}

test('first observation and explicit reset require a complete snapshot', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const first = engine.observe([item('a')]);
  assert.equal(first.delta.classification, 'RESET');
  assert.equal(first.delta.resetReason, 'INITIAL_OBSERVATION');
  assert.equal(first.delta.completeSnapshotRequired, true);

  engine.reset('EXTENSION_RESTART');
  const restarted = engine.observe([item('a')]);
  assert.equal(restarted.delta.classification, 'RESET');
  assert.equal(restarted.delta.resetReason, 'EXTENSION_RESTART');
});

test('one semantic mutation produces exactly one UPDATE', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const first = engine.observe([item('a')]);
  const second = engine.observe([item('a', { label: 'Updated', text: 'Updated' })]);

  assert.equal(second.delta.classification, 'UPDATE');
  assert.equal(second.delta.changes.length, 1);
  assert.deepEqual(second.delta.changes[0], {
    type: 'UPDATE',
    logicalId: first.items[0].logicalId,
    revision: 2,
    reason: 'SEMANTIC_FIELDS_CHANGED',
    confidence: 0.98,
  });
});

test('irrelevant observation churn produces NO_RELEVANT_CHANGE', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  engine.observe([item('a')]);
  const unchanged = engine.observe([item('a')]);
  assert.equal(unchanged.delta.classification, 'NO_RELEVANT_CHANGE');
  assert.deepEqual(unchanged.delta.changes, []);
});

test('geometry and ordering changes produce MOVE without changing semantic revision', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const first = engine.observe([item('a'), item('b')]);
  const moved = engine.observe([
    item('b', { ref: 'ref-b-2', rect: { x: 0, y: 40, width: 100, height: 30 } }),
    item('a', { ref: 'ref-a-2', rect: { x: 0, y: 80, width: 100, height: 30 } }),
  ]);

  assert.equal(moved.delta.classification, 'MOVE');
  assert.equal(moved.delta.changes.length, 2);
  assert.ok(moved.delta.changes.every((change) => change.type === 'MOVE'));
  assert.deepEqual(moved.items.map((entry) => entry.semanticRevision), [1, 1]);
  assert.deepEqual(new Set(moved.items.map((entry) => entry.logicalId)), new Set(first.items.map((entry) => entry.logicalId)));
});

test('virtualized one-observation detach/reinsert preserves identity without REMOVE/INSERT', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document', removalGraceObservations: 1 });
  const first = engine.observe([item('a')]);
  const detached = engine.observe([]);
  assert.equal(detached.delta.classification, 'NO_RELEVANT_CHANGE');

  const reinserted = engine.observe([item('a', { ref: 'ref-a-new' })]);
  assert.equal(reinserted.items[0].logicalId, first.items[0].logicalId);
  assert.notEqual(reinserted.delta.classification, 'INSERT');
  assert.equal(reinserted.delta.changes.some((change) => change.type === 'REMOVE'), false);
});

test('a removal is emitted after the bounded grace window', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document', removalGraceObservations: 1 });
  const first = engine.observe([item('a')]);
  engine.observe([]);
  const removed = engine.observe([]);
  assert.equal(removed.delta.classification, 'REMOVE');
  assert.equal(removed.delta.changes[0].logicalId, first.items[0].logicalId);
});

test('insertions are bounded and overflow degrades to a safe RESET', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document', maxDeltaChanges: 2, maxDeltaBytes: 2_000 });
  engine.observe([]);
  const overflow = engine.observe([item('a'), item('b'), item('c')]);
  assert.equal(overflow.delta.classification, 'RESET');
  assert.equal(overflow.delta.resetReason, 'OUTPUT_CAP');
  assert.equal(overflow.delta.completeSnapshotRequired, true);
  assert.deepEqual(overflow.delta.changes, []);
});

test('a one-item delta is materially smaller than a 100-item snapshot', () => {
  const engine = createIdentityEngine({ documentId: 'delta-document' });
  const hundred = Array.from({ length: 100 }, (_, index) => item(String(index).padStart(3, '0')));
  const first = engine.observe(hundred);
  const changed = hundred.map((entry, index) => index === 50 ? { ...entry, label: 'Changed', text: 'Changed' } : { ...entry });
  const second = engine.observe(changed);
  const ratio = JSON.stringify(second.delta).length / JSON.stringify(first.items).length;

  assert.equal(second.delta.classification, 'UPDATE');
  assert.ok(ratio <= 0.5, ratio);
});
