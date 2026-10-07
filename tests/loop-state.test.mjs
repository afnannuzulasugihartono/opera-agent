// @last-edited: 2026-10-07 UTC+7.
// @title: loop-state.test — Test.
// @state: locks the tick state machine: trace ring, degrade modes, overrun guard.
// @dependencies: node:test, strict, loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_TRACE_LIMIT, LOOP_BAND_WINDOW, LOOP_OVERRUN_REDS, startLoopState, recordTick, loopMode, loopOverrun } from '../extension/lib/loop.js';

test('loop state starts empty', () => {
  const state = startLoopState();
  assert.equal(state.tick, 0);
  assert.equal(state.firedTotal, 0);
  assert.deepEqual(state.trace, []);
  assert.equal(loopMode(state), 'full');
  assert.equal(loopOverrun(state), false);
});

test('recordTick appends the band and counts fired rules', () => {
  const state = startLoopState();
  assert.equal(recordTick(state, { workMs: 30, fired: 2 }).band, 'green');
  assert.equal(recordTick(state, { workMs: 100, fired: 0 }).band, 'yellow');
  assert.equal(state.tick, 2);
  assert.equal(state.firedTotal, 2);
  assert.equal(state.trace.length, 2);
});

test('trace ring caps at the limit', () => {
  const state = startLoopState();
  for (let i = 0; i < LOOP_TRACE_LIMIT + 50; i += 1) recordTick(state, { workMs: 10, fired: 0 });
  assert.equal(state.trace.length, LOOP_TRACE_LIMIT);
  assert.equal(state.tick, LOOP_TRACE_LIMIT + 50);
});

test('mode degrades on yellow and sheds on orange', () => {
  const state = startLoopState();
  for (let i = 0; i < LOOP_BAND_WINDOW; i += 1) recordTick(state, { workMs: 100, fired: 0 });
  assert.equal(loopMode(state), 'degraded');
  for (let i = 0; i < LOOP_BAND_WINDOW; i += 1) recordTick(state, { workMs: 200, fired: 0 });
  assert.equal(loopMode(state), 'shed');
});

test('recovery returns to full on green', () => {
  const state = startLoopState();
  for (let i = 0; i < LOOP_BAND_WINDOW; i += 1) recordTick(state, { workMs: 200, fired: 0 });
  assert.equal(loopMode(state), 'shed');
  for (let i = 0; i < LOOP_BAND_WINDOW; i += 1) recordTick(state, { workMs: 10, fired: 0 });
  assert.equal(loopMode(state), 'full');
});

test('overrun fires on consecutive reds only', () => {
  const state = startLoopState();
  for (let i = 0; i < LOOP_OVERRUN_REDS - 1; i += 1) recordTick(state, { workMs: 500, fired: 0 });
  assert.equal(loopOverrun(state), false);
  recordTick(state, { workMs: 500, fired: 0 });
  assert.equal(loopOverrun(state), true);

  // Scattered reds are slow, not stuck: green breaks the streak.
  const scattered = startLoopState();
  for (let i = 0; i < LOOP_OVERRUN_REDS * 2; i += 1) {
    recordTick(scattered, { workMs: 500, fired: 0 });
    recordTick(scattered, { workMs: 10, fired: 0 });
  }
  assert.equal(loopOverrun(scattered), false);
});
