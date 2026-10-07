// @last-edited: 2026-10-07 UTC+7.
// @title: loop.test — Test.
// @state: locks the loop program schema for the local real-time game loop.
// @dependencies: node:test, strict, loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_TICK_MS_MIN, LOOP_TICK_MS_MAX, LOOP_TICK_MS_DEFAULT, LOOP_MAX_TICKS, LOOP_MAX_DURATION_MS, LOOP_MAX_RULES, LOOP_MAX_SENSORS, LOOP_TEMPLATE_MAX_BYTES, LOOP_TIMER_MIN_MS, LOOP_TIMER_MAX_MS, LOOP_TICK_BANDS, LOOP_SENSOR_KINDS, LOOP_ACTIONS, LOOP_POINTER_ACTIONS, LOOP_SYNTHETIC_DEAD_TICKS, validateLoopProgram, classifyTickBand } from '../extension/lib/loop.js';

function minimalProgram(overrides = {}) {
  return {
    sensors: [{ id: 'moved', kind: 'pixelDiff', region: { x: 0, y: 0, width: 64, height: 64 }, threshold: 0.2 }],
    rules: [{ when: { sensor: 'moved' }, do: { action: 'key', key: 'ArrowLeft' } }],
    ...overrides
  };
}

test('loop constants match the locked plan budgets', () => {
  assert.equal(LOOP_TICK_MS_MIN, 50);
  assert.equal(LOOP_TICK_MS_MAX, 500);
  assert.equal(LOOP_TICK_MS_DEFAULT, 100);
  assert.equal(LOOP_MAX_TICKS, 3600);
  assert.equal(LOOP_MAX_DURATION_MS, 120000);
  assert.equal(LOOP_MAX_RULES, 32);
  assert.equal(LOOP_MAX_SENSORS, 8);
  assert.equal(LOOP_TEMPLATE_MAX_BYTES, 32768);
  assert.equal(LOOP_TIMER_MIN_MS, 50);
  assert.equal(LOOP_TIMER_MAX_MS, 60000);
  assert.deepEqual(LOOP_TICK_BANDS, { green: 60, yellow: 150, orange: 250 });
  assert.deepEqual([...LOOP_SENSOR_KINDS].sort(), ['pixelDiff', 'regionHash', 'templateMatch', 'timer']);
  assert.deepEqual([...LOOP_ACTIONS].sort(), ['key', 'pointer']);
  assert.deepEqual([...LOOP_POINTER_ACTIONS].sort(), ['click', 'move']);
});

test('valid program normalizes defaults', () => {
  const result = validateLoopProgram(minimalProgram());
  assert.equal(result.ok, true);
  assert.equal(result.program.tickMs, 100);
  assert.equal(result.program.maxTicks, 3600);
  assert.equal(result.program.maxDurationMs, 120000);
});

test('tickMs is clamped, not rejected', () => {
  assert.equal(validateLoopProgram(minimalProgram({ tickMs: 10 })).program.tickMs, 50);
  assert.equal(validateLoopProgram(minimalProgram({ tickMs: 5000 })).program.tickMs, 500);
  assert.equal(validateLoopProgram(minimalProgram({ tickMs: 120 })).program.tickMs, 120);
});

test('program shape is strict', () => {
  assert.equal(validateLoopProgram(null).ok, false);
  assert.equal(validateLoopProgram({}).ok, false);
  assert.equal(validateLoopProgram(minimalProgram({ sensors: [] })).ok, false);
  assert.equal(validateLoopProgram(minimalProgram({ rules: [] })).ok, false);
  assert.equal(validateLoopProgram(minimalProgram({ extra: true })).ok, false);
});

test('sensor kinds are allowlisted with bounded params', () => {
  assert.equal(validateLoopProgram(minimalProgram({ sensors: [{ id: 's', kind: 'eval' }] })).ok, false);
  const withSensor = (sensor) => ({ sensors: [sensor], rules: [{ when: { sensor: sensor.id }, do: { action: 'key', key: 'ArrowLeft' } }] });
  assert.equal(validateLoopProgram(withSensor({ id: 's', kind: 'regionHash', region: { x: 0, y: 0, width: 64, height: 64 } })).ok, true);
  assert.equal(validateLoopProgram(withSensor({ id: 's', kind: 'timer', everyMs: 1000 })).ok, true);
  assert.equal(validateLoopProgram(withSensor({ id: 's', kind: 'timer', everyMs: 5 })).ok, false);

  // A template over the byte cap is rejected, not truncated.
  assert.equal(validateLoopProgram(withSensor({ id: 's', kind: 'templateMatch', template: 'a'.repeat(32769), region: { x: 0, y: 0, width: 64, height: 64 }, threshold: 0.8 })).ok, false);
  assert.equal(validateLoopProgram(withSensor({ id: 's', kind: 'templateMatch', template: 'a'.repeat(100), region: { x: 0, y: 0, width: 64, height: 64 }, threshold: 1.5 })).ok, false);
});

test('rules bind only to declared sensors with allowlisted actions', () => {
  assert.equal(validateLoopProgram(minimalProgram({ rules: [{ when: { sensor: 'ghost' }, do: { action: 'key', key: 'ArrowLeft' } }] })).ok, false);
  assert.equal(validateLoopProgram(minimalProgram({ rules: [{ when: { sensor: 'moved' }, do: { action: 'eval', code: 'x' } }] })).ok, false);
  assert.equal(validateLoopProgram(minimalProgram({ rules: [{ when: { sensor: 'moved' }, do: { action: 'pointer', pointerAction: 'click', x: 10, y: 20 } }] })).ok, true);
  assert.equal(validateLoopProgram(minimalProgram({ rules: [{ when: { sensor: 'moved' }, do: { action: 'pointer', pointerAction: 'drag', x: 10, y: 20 } }] })).ok, false);
});

test('counts are capped', () => {
  const manyRules = Array.from({ length: 33 }, () => ({ when: { sensor: 'moved' }, do: { action: 'key', key: 'a' } }));
  assert.equal(validateLoopProgram(minimalProgram({ rules: manyRules })).ok, false);
  const manySensors = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, kind: 'timer', everyMs: 1000 }));
  assert.equal(validateLoopProgram(minimalProgram({ sensors: manySensors, rules: [{ when: { sensor: 's0' }, do: { action: 'key', key: 'a' } }] })).ok, false);
});

test('stopWhen is optional but strict', () => {
  assert.equal(validateLoopProgram(minimalProgram({ stopWhen: [{ sensor: 'moved' }] })).ok, true);
  assert.equal(validateLoopProgram(minimalProgram({ stopWhen: [{ sensor: 'ghost' }] })).ok, false);
});

test('tick bands match the locked FPS-style thresholds', () => {
  assert.equal(classifyTickBand(0), 'green');
  assert.equal(classifyTickBand(60), 'green');
  assert.equal(classifyTickBand(61), 'yellow');
  assert.equal(classifyTickBand(150), 'yellow');
  assert.equal(classifyTickBand(151), 'orange');
  assert.equal(classifyTickBand(250), 'orange');
  assert.equal(classifyTickBand(251), 'red');
  assert.equal(classifyTickBand(5000), 'red');
});

test('synthetic dead-tick fallback budget is locked', () => {
  assert.equal(LOOP_SYNTHETIC_DEAD_TICKS, 3);
});

test('trusted flag defaults off and stays boolean', () => {
  assert.equal(validateLoopProgram(minimalProgram()).program.trusted, false);
  assert.equal(validateLoopProgram(minimalProgram({ trusted: true })).program.trusted, true);
  assert.equal(validateLoopProgram(minimalProgram({ trusted: 'yes' })).ok, false);
});
