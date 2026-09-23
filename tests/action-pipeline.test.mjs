import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_RAMP_MS, pollDelays, classifyResolve, makeNotReady, attachResolution
} from '../extension/lib/action-pipeline.js';

// U-V Action Pipeline (2026-09-23): pure policy engine for Resolve -> Wait ->
// Heal -> Verify. Locked semantics: ramp shape, deadline clipping, resolve
// classification, TARGET_NOT_READY shape, resolved telemetry superset.

test('ACTION_RAMP_MS is the frozen 25..400 ramp', () => {
  assert.deepEqual(ACTION_RAMP_MS, [25, 50, 100, 200, 400]);
});

test('pollDelays follows the ramp with the last step repeating', () => {
  assert.deepEqual(pollDelays(2_000), [25, 50, 100, 200, 400, 400, 400, 400]);
});

test('pollDelays clips to remaining budget and is empty with none', () => {
  assert.deepEqual(pollDelays(300), [25, 50, 100]);
  assert.deepEqual(pollDelays(100, 100), []);
});

test('classifyResolve maps resolve states', () => {
  assert.equal(classifyResolve({ present: true, actionable: true }), 'ready');
  assert.equal(classifyResolve({ present: false }), 'not-found');
  assert.equal(classifyResolve({ present: true, actionable: false }), 'not-actionable');
  assert.equal(classifyResolve({ present: true, actionable: false, ambiguous: true, candidates: ['a', 'b'] }), 'ambiguous');
});

test('makeNotReady shape: ambiguous carries candidates, others do not', () => {
  const amb = makeNotReady('ambiguous', 8000, 'Pick deliberately.', ['x', 'y']);
  assert.equal(amb.code, 'TARGET_NOT_READY');
  assert.equal(amb.reason, 'ambiguous');
  assert.equal(amb.waitedMs, 8000);
  assert.deepEqual(amb.candidates, ['x', 'y']);
  const nf = makeNotReady('not-found', 8000, 'Wait or re-find.');
  assert.equal(nf.code, 'TARGET_NOT_READY');
  assert.equal('candidates' in nf, false);
});

test('attachResolution adds resolved and omits absent verified', () => {
  const env = attachResolution({ ok: true, method: 'debugger' }, { attempts: 3, waitedMs: 175, healed: true });
  assert.equal(env.ok, true);
  assert.deepEqual(env.resolved, { attempts: 3, waitedMs: 175, healed: true });
  assert.equal('verified' in env.resolved, false);
  const env2 = attachResolution({ ok: true }, { attempts: 1, waitedMs: 0, healed: false, verified: true });
  assert.equal(env2.resolved.verified, true);
});

// --- Task 2: content resolver source-contract ---
import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('content exposes page.action_state for the U-V pipeline', () => {
  const src = read('extension/content.js');
  assert.match(src, /page\.action_state/, 'handler must exist');
  assert.match(src, /resolveActionRef\(.*ref/, 'must resolve through the U-I rebind machinery');
  assert.match(src, /refusing automatic rebind/, 'ambiguity surfaced via the U-I refusal path');
  assert.match(src, /candidates/, 'ambiguity must surface candidates');
});
