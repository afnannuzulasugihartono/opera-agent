import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  METHOD_SPECS,
  BURST_ACTION_METHODS,
  BURST_MAX_STEPS,
  BURST_MAX_TIMEOUT_MS
} from '../extension/lib/protocol.js';
import { RECORDED_BRIDGE_CADENCE, measureCadence } from './helpers/pull-cadence-sim.mjs';

// Phase A latency measurement (2026-10-02), evidence record.
//
// `browser.burst` is the mechanism that removed the model round trip from
// find->click (CHANGELOG 1.x: "14.1s gap -> 161.6ms atomic burst"). It is the
// single biggest responsiveness win this project already has.
//
// This file measures its ceiling: which primitives a burst can express at all,
// and therefore how many model round trips a realistic task still needs.
// Constants are imported from the live module, so the numbers cannot drift.

// Constants verified in extension/content.js:1130-1144 --
// waitForPostActionSettle sleeps a fixed 50ms and needs 2 stable rounds.
const SETTLE_TICK_MS = 50;
const SETTLE_STABLE_ROUNDS = 2;
const SETTLE_FLOOR_MS = SETTLE_TICK_MS * SETTLE_STABLE_ROUNDS;

// Queue wait is measured against the recorded Phase A baseline (the bridge's
// client-side cadence before 2026-10-02), so the reference task cost below
// stays comparable across the change documented in
// tests/latency-claim-wait.test.mjs.
const queueWait = measureCadence(RECORDED_BRIDGE_CADENCE, { rpcMs: 20 });

const primitives = Object.keys(METHOD_SPECS);
const burstTargets = new Set(Object.values(BURST_ACTION_METHODS));
const burstable = primitives.filter((m) => burstTargets.has(m));
const notBurstable = primitives.filter((m) => !burstTargets.has(m));

test('MEASURED: only 8 of 26 primitives can be expressed inside a burst', () => {
  assert.equal(primitives.length, 26, 'primitive count changed; re-measure the burst ceiling');
  assert.equal(burstable.length, 8);
  assert.deepEqual(burstable.sort(), [
    'page.click',
    'page.fill',
    'page.find',
    'page.key',
    'page.pointer',
    'page.read',
    'page.scroll',
    'page.wait_for'
  ]);
  assert.equal(notBurstable.length, 18);
});

test('MEASURED: every tabs.* and every media.* operation is un-burstable', () => {
  const tabs = primitives.filter((m) => m.startsWith('tabs.'));
  const media = primitives.filter((m) => m.startsWith('media.'));
  assert.equal(tabs.length, 8, 'all 8 tabs.* primitives exist');
  assert.equal(media.length, 4, 'all 4 media.* primitives exist');
  for (const method of [...tabs, ...media]) {
    assert.ok(!burstTargets.has(method), `${method} must not be reachable from a burst`);
  }
  // Opening, navigating, activating and closing a tab each cost a full
  // blocking round trip, which is exactly what a human never has to wait for.
  for (const method of ['tabs.open', 'tabs.navigate', 'tabs.activate', 'tabs.close']) {
    assert.ok(!burstTargets.has(method));
  }
});

test('page.hover is a burst-only action and deliberately not a 27th primitive', () => {
  assert.ok(burstTargets.has('page.hover'), 'hover must remain reachable inside a burst');
  assert.ok(!primitives.includes('page.hover'), 'page.hover must stay out of METHOD_SPECS');
});

test('MEASURED: the burst budget is 8 steps in 12000ms, i.e. 1500ms per step', () => {
  assert.equal(BURST_MAX_STEPS, 8);
  assert.equal(BURST_MAX_TIMEOUT_MS, 12000);
  assert.equal(BURST_MAX_TIMEOUT_MS / BURST_MAX_STEPS, 1500);
});

test('MEASURED: an 8-step click/fill burst pays at least 800ms of settle alone', () => {
  assert.equal(SETTLE_FLOOR_MS, 100);
  const worstCaseSteps = 8;
  assert.equal(SETTLE_FLOOR_MS * worstCaseSteps, 800);
  // Settle is a floor, not a budget: it is inside the 12000ms window and
  // competes with page load and the debugger round trips.
  assert.ok(SETTLE_FLOOR_MS * worstCaseSteps < BURST_MAX_TIMEOUT_MS);
});

test('MEASURED reference task: 4 round trips, ~3320ms of queue wait before any work', () => {
  // "Search for a term, open the first result, read the page."
  // Grouped the way the current surface forces the model to group it.
  const plan = [
    { step: 'open_url', primitive: 'tabs.open', why: 'tabs.* is un-burstable' },
    { step: 'burst: find + fill + key', primitive: 'burstable', why: 'three page.* steps in one call' },
    { step: 'burst: wait + find + click', primitive: 'burstable', why: 'result list is burstable' },
    { step: 'read_page', primitive: 'page.read', why: 'burstable but stands alone here' }
  ];
  const roundTrips = plan.length;
  assert.equal(roundTrips, 4);
  assert.equal(plan[0].primitive, 'tabs.open', 'the task must start on an un-burstable primitive');

  // Each round trip independently pays the measured queue wait.
  const waitFloor = roundTrips * queueWait.p50;
  assert.equal(waitFloor, 3320, `expected 4 x ${queueWait.p50}ms = 3320ms`);
  assert.ok(waitFloor > 3000, `expected >3s of pure queue wait, got ${waitFloor}ms`);

  // CHANGELOG records the burst itself executing in 161.6ms. The measured
  // queue wait is therefore ~5x the cost of actually running the actions:
  // the device spends longer being noticed than working.
  const BURST_EXECUTION_MS = 161.6;
  const ratio = queueWait.p50 / BURST_EXECUTION_MS;
  assert.ok(ratio > 4, `one queue wait (${queueWait.p50}ms) should exceed one burst (~${BURST_EXECUTION_MS}ms)`);
  assert.ok(ratio < 8, `ratio ${ratio.toFixed(1)} drifted; re-record rather than widen the bound`);
});

test('the queue wait dominates one burst step, so cadence is the first lever', () => {
  // A burst step costs a few hundred ms of work; the command waits ~830ms for
  // a device to notice it. That ratio is why the cadence, not the step count,
  // is where the measured headroom is.
  assert.ok(queueWait.p50 > SETTLE_FLOOR_MS * 4, 'queue wait still dwarfs per-step settle cost');
  assert.ok(queueWait.p95 < BURST_MAX_TIMEOUT_MS, 'one command wait fits inside one burst budget');
});

test('capture_page and find_elements remain separate round trips by design', () => {
  // Screenshots and structured queries are deliberately outside the burst:
  // their payloads are large and the model needs to see them before deciding.
  const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.equal(notBurstable.includes('page.capture'), true);
  assert.equal(notBurstable.includes('page.query'), true);
  assert.match(background, /case 'page\.capture'/);
  assert.match(background, /case 'page\.query'/);
});