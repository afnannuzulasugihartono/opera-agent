// @last-edited: 2026-10-08 UTC+7.
// @title: loop-decide.test — Test.
// @state: locks the frame-rate decision math for the t-rex state reader.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/loop-decide.js');

const decide = globalThis.OperaAgentLoopDecide.decideTrex;

function state(overrides = {}) {
  return {
    speed: 400,
    dinoX: 25,
    dinoW: 40,
    dinoH: 50,
    canvasH: 150,
    obstacles: [],
    ...overrides
  };
}

const params = { leadMs: 500 };

test('no obstacle means run', () => {
  assert.equal(decide(state(), params).action, 'run');
});

test('distant obstacle means run', () => {
  const result = decide(state({ obstacles: [{ x: 600, y: 100, w: 30, h: 50 }] }), params);
  assert.equal(result.action, 'run');
  assert.ok(result.tti > 500);
});

test('near ground obstacle means jump', () => {
  const result = decide(state({ obstacles: [{ x: 150, y: 100, w: 30, h: 50 }] }), params);
  assert.equal(result.action, 'jump');
  assert.ok(result.tti <= 500);
});

test('passed obstacle is ignored', () => {
  const result = decide(state({ obstacles: [{ x: 0, y: 100, w: 20, h: 50 }] }), params);
  assert.equal(result.action, 'run');
});

test('high pterodactyl means run, mid means duck', () => {
  const high = decide(state({ obstacles: [{ x: 150, y: 10, w: 40, h: 30 }] }), params);
  assert.equal(high.action, 'run');
  const mid = decide(state({ obstacles: [{ x: 150, y: 70, w: 40, h: 30 }] }), params);
  assert.equal(mid.action, 'duck');
});

test('pterodactyl of any low height means duck, cactus means jump', () => {
  const lowBird = decide(state({ obstacles: [{ x: 150, y: 100, w: 40, h: 30, kind: 'PTERODACTYL' }] }), params);
  assert.equal(lowBird.action, 'duck');
  const cactus = decide(state({ obstacles: [{ x: 150, y: 100, w: 30, h: 50, kind: 'CACTUS_SMALL' }] }), params);
  assert.equal(cactus.action, 'jump');
});

test('nearest obstacle decides', () => {
  const result = decide(state({ obstacles: [{ x: 500, y: 100, w: 30, h: 50 }, { x: 150, y: 100, w: 30, h: 50 }] }), params);
  assert.equal(result.action, 'jump');
});

test('malformed state fails closed', () => {
  assert.equal(decide(null, params).action, 'run');
  assert.equal(decide(state({ speed: 0 }), params).action, 'run');
  assert.equal(decide(state(), null).action, 'run');
});
