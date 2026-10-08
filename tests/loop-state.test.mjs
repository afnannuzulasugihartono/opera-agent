// @last-edited: 2026-10-07 UTC+7.
// @title: loop-state.test — Test.
// @state: locks the tick state machine: trace ring, degrade modes, overrun guard.
// @dependencies: node:test, strict, loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_TRACE_LIMIT, LOOP_BAND_WINDOW, LOOP_OVERRUN_REDS, LOOP_TRACK_MIN_RUN, startLoopState, recordTick, loopMode, loopOverrun, centroidTrack, frontOfChanged } from '../extension/lib/loop.js';

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

test('trace records active sensors for input-output matching', () => {
  const state = startLoopState();
  const result = recordTick(state, { workMs: 30, fired: 1, active: ['obstacle', 'calm'] });
  assert.equal(result.band, 'green');
  assert.deepEqual(state.trace[0].sensors, ['obstacle', 'calm']);
  recordTick(state, { workMs: 30, fired: 0 });
  assert.deepEqual(state.trace[1].sensors, []);
});

test('trace carries compact sensor values', () => {
  const state = startLoopState();
  recordTick(state, { workMs: 30, fired: 0, active: [], values: { obstacle: 0.04, calm: 7 } });
  assert.deepEqual(state.trace[0].values, { obstacle: 0.04, calm: 7 });
  recordTick(state, { workMs: 30, fired: 0, values: { obstacle: null, calm: { deep: true } } });
  assert.deepEqual(state.trace[1].values, {});
});

test('centroid tracker fires on time-to-impact, not on presence', () => {

  // No history, no motion, or receding motion never fires.
  assert.equal(centroidTrack(null, 300, 200, 90, 500), null);
  assert.equal(centroidTrack(300, null, 200, 90, 500), null);
  assert.equal(centroidTrack(300, 300, 200, 90, 500), null);
  assert.equal(centroidTrack(280, 300, 200, 90, 500), null);
  assert.equal(centroidTrack(300, 250, 0, 90, 500), null);

  // Approaching at 100px per 200ms (500px/s): 110px past the pad takes
  // 220ms, inside a 500ms lead, so it fires with the impact estimate.
  assert.equal(centroidTrack(300, 200, 200, 90, 500), 220);
  assert.equal(centroidTrack(300, 290, 200, 90, 500), null);

  // Already past the pad fires immediately: late is better than never.
  assert.equal(centroidTrack(300, 50, 200, 90, 500), 0);
});

test('front detection finds solid masses, not speckle', () => {
  assert.equal(LOOP_TRACK_MIN_RUN, 12);
  const blank = (w, h) => new Uint8ClampedArray(w * h * 4);
  const paint = (buf, w, x, y0, y1) => {
    for (let y = y0; y < y1; y += 1) {
      const i = (y * w + x) * 4;
      buf[i] = 255;
      buf[i + 1] = 255;
      buf[i + 2] = 255;
    }
  };

  // Identical frames have no front.
  assert.equal(frontOfChanged(blank(10, 10), blank(10, 10), 10, 10), null);

  // Scattered changed pixels never form the required vertical run.
  const a = blank(10, 10);
  const speckled = blank(10, 10);
  paint(speckled, 10, 8, 0, 2);
  paint(speckled, 10, 9, 5, 7);
  assert.equal(frontOfChanged(a, speckled, 10, 10, 16, 3), null);

  // A solid bar reads at its column; the rightmost of two wins.
  const bar = blank(10, 10);
  paint(bar, 10, 7, 0, 10);
  assert.equal(frontOfChanged(a, bar, 10, 10, 16, 3), 7);
  paint(bar, 10, 4, 0, 10);
  assert.equal(frontOfChanged(a, bar, 10, 10, 16, 3), 7);
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
