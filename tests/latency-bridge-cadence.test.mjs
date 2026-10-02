import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  readCadenceConstants,
  measureCadence,
  pollIssueTimes,
  claimWaitMs,
  percentile
} from './helpers/pull-cadence-sim.mjs';

// Phase A latency measurement (2026-10-02), evidence record.
//
// tests/efficiency.test.mjs already pins the bridge cadence constants. This
// file deliberately does something different: it MEASURES what those
// constants cost a waiting command and records the numbers, so that a later
// cadence change shows up as a stated delta instead of a silent regression.
//
// Model: one idle device, permanently parked on a fresh 12s long-poll window,
// which is the steady state for interactive use. Clock-injected, no network,
// no real timers — these are reproducible figures, not timing flakes.
// This is a model of the cadence, not a measurement against Supabase.

const bridge = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url),
  'utf8'
);

const cadence = readCadenceConstants(bridge);

// Assumed cost of one `opera_claim_next` round trip (PostgREST + Postgres).
// The model is reported at three values because the real figure is not
// measured here; the latency conclusions below hold across all three.
const RPC_COSTS_MS = [10, 20, 50];

test('the bridge cadence model reads its constants from live source', () => {
  assert.deepEqual(cadence, { fastPolls: 8, fastIntervalMs: 50, idleIntervalMs: 2000, windowMs: 12000 });
});

test('an idle device issues 14 claim calls per 12s window (4200/hour)', () => {
  for (const rpcMs of RPC_COSTS_MS) {
    const report = measureCadence(cadence, { rpcMs });
    assert.equal(report.windowCalls, 14, `rpc=${rpcMs}ms should still yield 14 calls per window`);
    assert.equal(
      Math.round(report.callsPerHourPerIdleDevice),
      4200,
      `rpc=${rpcMs}ms should still yield 4200 claim calls per hour per idle device`
    );
  }
});

test('the fast window is 400ms of a 12000ms window, so ~97% of waits are idle-rate', () => {
  const report = measureCadence(cadence, { rpcMs: 20 });
  assert.equal(report.fastWindowMs, 400);
  const fastShare = report.fastWindowMs / report.windowMs;
  assert.ok(fastShare < 0.04, `fast window is only ${(fastShare * 100).toFixed(1)}% of the window`);
});

test('MEASURED queue wait for a command: p50 ~830ms, p95 ~1910ms (rpc=20ms)', () => {
  const report = measureCadence(cadence, { rpcMs: 20 });
  // These are the recorded Phase A figures. If a cadence change moves them,
  // this test must be updated in the same commit with the new numbers and a
  // stated reason -- that is the point of recording them.
  assert.equal(report.p50, 830);
  assert.equal(report.p95, 1910);
  assert.ok(report.max <= 2100, 'worst case stays bounded by the idle interval');
});

test('the latency floor is insensitive to RPC cost: idle interval dominates', () => {
  const reports = RPC_COSTS_MS.map((rpcMs) => measureCadence(cadence, { rpcMs }));
  const p50s = reports.map((r) => r.p50);
  const p95s = reports.map((r) => r.p95);
  assert.ok(Math.max(...p50s) - Math.min(...p50s) <= 100, 'p50 varies <=100ms across a 5x RPC cost range');
  assert.ok(Math.max(...p95s) - Math.min(...p95s) <= 100, 'p95 varies <=100ms across a 5x RPC cost range');
  for (const p95 of p95s) {
    assert.ok(p95 >= 1800, 'p95 stays near the 2000ms idle interval at every RPC cost');
  }
});

test('the documented egress figure refers to the pre-2026-09-24 cadence, not today', () => {
  // The bridge comment records "~52 opera_claim_next calls (6x50ms + 250ms
  // loop), ~13k claims/hour/device" as the state that motivated the ramp.
  // It is a changelog entry describing the old 250ms loop, not a claim about
  // the current code. The "~52" is the instantaneous-poll bound; a real RPC
  // costs a few milliseconds each and mints slightly fewer calls.
  const oldCadence = { fastPolls: 6, fastIntervalMs: 50, idleIntervalMs: 250, windowMs: 12000 };
  const oldInstant = measureCadence(oldCadence, { rpcMs: 0 });
  const oldReal = measureCadence(oldCadence, { rpcMs: 20 });
  // Exact modelled counts: 53 with instantaneous polls, 49 with a 20ms RPC.
  // The comment's "~52" sits between them, so it is a fair approximation.
  assert.ok(
    oldInstant.windowCalls >= 51 && oldInstant.windowCalls <= 54,
    `zero-cost polls should reproduce the documented ~52, got ${oldInstant.windowCalls}`
  );
  assert.ok(
    oldReal.windowCalls >= 48 && oldReal.windowCalls <= 52,
    `real RPC cost should mint 48-52 calls, got ${oldReal.windowCalls}`
  );
  assert.ok(
    oldReal.callsPerHourPerIdleDevice > 14000,
    `old cadence should exceed 13k calls/hour, got ${Math.round(oldReal.callsPerHourPerIdleDevice)}`
  );

  const now = measureCadence(cadence, { rpcMs: 20 });
  assert.ok(
    now.callsPerHourPerIdleDevice < oldReal.callsPerHourPerIdleDevice / 3,
    'current cadence should be at least 3x cheaper in claim calls than the pre-ramp one'
  );
});

test('poll issue times match the loop structure: 8 fast then 2000ms spacing', () => {
  const issued = pollIssueTimes({ ...cadence, rpcMs: 0 });
  // With zero RPC cost the fast polls are an exact 50ms ladder.
  assert.deepEqual(issued.slice(0, 8), [0, 50, 100, 150, 200, 250, 300, 350]);
  // The 9th poll is issued immediately at 400ms; only after it does the loop
  // sleep the idle interval, so the first 2000ms gap appears after that.
  assert.equal(issued[8], 400);
  assert.equal(issued[9] - issued[8], 2000);
});

test('a command committed inside the fast window is claimed within one fast interval', () => {
  const issued = pollIssueTimes({ ...cadence, rpcMs: 0 });
  for (const at of [0, 10, 51, 200, 399]) {
    const wait = claimWaitMs(issued, at, 0);
    assert.ok(wait <= 50, `command at ${at}ms waited ${wait}ms, expected <=50ms`);
  }
});

test('a command committed after the fast window waits up to the idle interval', () => {
  const issued = pollIssueTimes({ ...cadence, rpcMs: 0 });
  const wait = claimWaitMs(issued, 401, 0);
  assert.ok(wait > 1900 && wait <= 2000, `expected ~2000ms idle wait, got ${wait}`);
});

test('percentile helper is order-independent and boundary-safe', () => {
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([1], 99), 1);
  assert.equal(percentile([10, 20, 30, 40], 100), 40);
});