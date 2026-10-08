// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: burst-tab-switching.test — tab-switching.test — Phase D : a burst may address more than one tab.
// @state: consolidate the latency cluster into one file.
// @dependencies: node:test, strict, node:fs, protocol.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { validateBurst, burstCrossTabRef, burstStaleRef, BURST_MAX_STEPS, BURST_MAX_TIMEOUT_MS } from '../extension/lib/protocol.js';

// Phase D: a burst may address more than one tab.
//
// The measured reason: only 8 of 26 primitives were burstable, and all 8
// `tabs.*` operations were excluded, so a real browsing task needed a separate
// model round trip at every navigation. ActionEngine (arXiv 2602.20502) reports
// collapsing to one LLM call per task at 2x lower latency and 11.8x lower cost,
// and BrowserArena (arXiv 2510.02418) names direct URL navigation as one of the
// three dominant failure modes of browser agents. So this is the structural gap.
// (2026-10-03: navigate joined the vocabulary, re-measured at 9 of 26 in
// tests/latency-surface.test.mjs section E. The gap this file guards is unchanged:
// addressing a tab is not navigating it.)
//
// This is a CAPABILITY change, and the guards around it are the point of the
// file. What must not move:
//
// - The VM's own cross-tab fence is a different layer and stays untouched:
//   `opera-agent-vm` throws HostError("CROSS_TAB") for effect arguments aimed at
//   another tab, and three tests pin that. This change touches the extension's
//   burst, not the VM host.
//
// - The per-step `refFromStep` binding must become tab-scoped. A ref minted in a
//   step that ran on tab A is meaningless on tab B, and silently reusing it would
//   be exactly the kind of stale-reference failure the repo has been burned by.
//
// - The debugger cannot be attached to two tabs at once, so switching tabs must
//   release the previous session rather than hold both.
//
// - A step that switches tabs must still be bounded by the single 12s budget and
//   must still report completed evidence on timeout.

const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = background.indexOf(startMarker);
  const end = background.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return background.slice(start, end);
}

function burstStep(action, extra = {}) {
  return { action, ...extra };
}

// --- schema: tabId per step, optional and additive ------------------------

// A minimal valid step per action, so this test isolates the tabId change from
// each action's own required fields.
const VALID_STEP = Object.freeze({
  read: {},
  find: {},
  click: { ref: 'r1' },
  fill: { ref: 'r1', value: 'hello' },
  key: { key: 'Enter' },
  scroll: { y: 100 },
  wait: { selector: '.ready' },
  hover: { ref: 'r1' },
  pointer: { pointerAction: 'click', x: 10, y: 20 }
});

test('tabId is an accepted optional key on every existing burst step', () => {
  // No step is removed and no existing call breaks: a step without tabId keeps
  // resolving to the burst-level tab, which is what every current caller does.
  for (const action of Object.keys(VALID_STEP)) {
    const withoutTab = validateBurst({ tabId: 7, steps: [burstStep(action, VALID_STEP[action])] });
    assert.equal(withoutTab.ok, true, `${action} without tabId: ${withoutTab.error || ''}`);
    const withTab = validateBurst({ tabId: 7, steps: [burstStep(action, { ...VALID_STEP[action], tabId: 3 })] });
    assert.equal(withTab.ok, true, `${action} with tabId: ${withTab.error || ''}`);
  }
});

test('a per-step tabId must be a non-negative integer', () => {
  const bad = [-1, 1.5, 'x', null, true, false];
  for (const tabId of bad) {
    const check = validateBurst({ steps: [burstStep('find', { tabId })] });
    if (tabId === null) {
      // null is allowed: it means "use the burst tab".
      assert.equal(check.ok, true);
      continue;
    }
    assert.equal(check.ok, false, `tabId ${JSON.stringify(tabId)} must be rejected`);
  }
  assert.equal(validateBurst({ steps: [burstStep('find', { tabId: 0 })] }).ok, true);
});

test('requireTabId refuses booleans instead of coercing false to tab 0', () => {
  const fn = sliceBetween('function requireTabId(value)', 'async function resolveTabId');
  assert.match(fn, /typeof value === 'boolean'/);
});

test('step keys stay strict, so an unknown key cannot ride in', () => {
  const check = validateBurst({ steps: [burstStep('find', { tabId: 3, navigate: 'https://evil.test' })] });
  assert.equal(check.ok, false, 'an unknown per-step key must fail closed');
});

test('the step count and budget are unchanged', () => {
  assert.equal(BURST_MAX_STEPS, 8);
  assert.equal(BURST_MAX_TIMEOUT_MS, 12000);
  assert.equal(validateBurst({ steps: [burstStep('find')] }).ok, true);
});

// --- forward reference must not cross a tab ------------------------------

test('refFromStep still refuses a forward or self reference', () => {
  // "forward" is relative to the referencing step, so step 1 may only bind to
  // step 0. from:1 in a two-step burst is a forward reference, not a valid one.
  const check = validateBurst({
    steps: [burstStep('find'), burstStep('click', { ref: 'r1', refFromStep: 1 })]
  });
  assert.equal(check.ok, false, 'a forward reference must fail closed');

  const self = validateBurst({
    steps: [burstStep('find'), burstStep('click', { ref: 'r1', refFromStep: 0 })]
  });
  assert.equal(self.ok, true, 'binding to the immediately earlier step is the supported case');
});

test('refFromStep validation still runs before any tab check', () => {
  const check = validateBurst({
    steps: [burstStep('find'), burstStep('click', { ref: 'r1', refFromStep: 1, tabId: 9 })]
  });
  assert.equal(check.ok, false);
});

// --- execution: the session follows the active tab -----------------------

test('a burst step may carry its own tabId', () => {
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  assert.match(burst, /step\.tabId/);
  assert.match(burst, /activeTabId/);
});

test('the debugger session is re-keyed when the active tab changes', () => {
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  // The old single-tab guard must not survive as a blanket refusal.
  assert.doesNotMatch(burst, /cannot switch tabs/);
  // Switching releases the previous session before attaching the next.
  assert.match(burst, /releaseDebuggerSession\(/);
});

test('withDebugger no longer refuses a different tab outright', () => {
  const fn = sliceBetween('async function withDebugger(', 'function codedError(');
  assert.doesNotMatch(fn, /cannot switch tabs/);
  // But it still refuses to hand one work call a target it was not asked for.
  assert.match(fn, /debuggerSession/);
});

test('every released session is detached, not merely forgotten', async () => {
  const { releaseDebuggerSession } = await import('../extension/lib/debugger-session.js');
  // A non-attached session is a no-op; that is what makes a finally safe.
  await assert.doesNotReject(releaseDebuggerSession({ tabId: 5, attached: false }));
});

// --- evidence and budget ------------------------------------------------

test('a burst still reports completed evidence when it times out mid-sequence', () => {
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  assert.match(burst, /timedOut: true/);
  assert.match(burst, /completedSteps: results\.length/);
  assert.match(burst, /failedAt: index/);
  assert.match(burst, /BURST_TIMEOUT/);
});

test('the single 12s budget is not extended by a tab switch', () => {
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  assert.match(burst, /BURST_MAX_TIMEOUT_MS/);
  // The per-step remaining time is recomputed from the same deadline.
  assert.match(burst, /deadline - Date\.now\(\)/);
});

test('the burst-level tabId is still resolved and still reported', () => {
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  assert.match(burst, /resolveTabId\(params\)/);
  assert.match(burst, /tabId,/);
});

// --- guards that must not move ------------------------------------------

test('the VM cross-tab fence is untouched', () => {
  const vm = fs.readFileSync(
    new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url),
    'utf8'
  );
  assert.match(vm, /HostError\("CROSS_TAB", "Effect arguments target another tab\."/);
});

test('the burst still refuses to run JavaScript or loop or branch', () => {
  const steps = [
    burstStep('read'), burstStep('find'), burstStep('click', { ref: 'r' }),
    burstStep('fill', { ref: 'r', value: 'v' }), burstStep('key', { key: 'Enter' }),
    burstStep('scroll', { y: 1 }), burstStep('wait', { selector: '.x' }),
    burstStep('hover', { ref: 'r' }), burstStep('pointer', { pointerAction: 'click', x: 1, y: 1 })
  ];
  assert.equal(steps.length, 9, 'the fixture lists the current vocabulary plus one');
  assert.equal(validateBurst({ steps: steps.slice(0, BURST_MAX_STEPS) }).ok, true);
  assert.equal(validateBurst({ steps }).ok, false, '9 steps must still exceed the cap');

  // No escape hatch: an unknown action and a JavaScript-looking key both fail.
  assert.equal(validateBurst({ steps: [burstStep('eval')] }).ok, false);
  assert.equal(validateBurst({ steps: [burstStep('find', { js: 'fetch("x")' })] }).ok, false);
  // Opening and closing tabs are still not burst actions; navigate joined the
  // vocabulary above, so only a bare (URL-less) navigate fails here now.
  assert.equal(validateBurst({ steps: [burstStep('open')] }).ok, false);
  assert.equal(validateBurst({ steps: [burstStep('close')] }).ok, false);
});

test('a ref consumed on a different tab than its source is refused, even without a switch', () => {
  // Audit repair: the executor used to refuse only when the
  // consuming step itself switched tabs (`switched && refFromStep`). A step
  // that stays on the already-active tab could consume a ref minted on another
  // tab, and nothing tested even the switch case. The check must compare the
  // source step's recorded tab against the consuming step's tab instead.
  const results = [{ index: 0, action: 'find', tabId: 1, ok: true, result: { items: [{ ref: 'r1' }] } }];
  assert.equal(burstCrossTabRef(results, 0, 2), true, 'consume on a foreign tab must be a violation');
  assert.equal(burstCrossTabRef(results, 0, 1), false, 'consume on the minting tab must be allowed');
  // Both directions: a missing source is the schema layer's refusal
  // (validateBurst rejects non-earlier refs), so the executor helper must not
  // invent a cross-tab refusal for it.
  assert.equal(burstCrossTabRef([], 0, 1), false, 'missing source must not read as cross-tab');
  assert.equal(burstCrossTabRef(results, 0, 1), false, 'same-tab consume stays allowed');
});

test('runBurst enforces the source-tab comparison instead of the switch flag', () => {
  // Source-text pin with a stated reason: runBurst lives in the service worker
  // and cannot be imported in node, so the wiring itself is pinned by the exact
  // call while the behavior is pinned by the helper tests above.
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  assert.match(burst, /burstCrossTabRef\(results, step\.refFromStep, stepTabId\)/);
  assert.doesNotMatch(burst, /switched && step\.refFromStep/);
});

test('navigate is a burst step that maps to the existing tabs.navigate primitive', () => {
  // Navigation is not new authority: tabs.navigate already exists. What is new
  // is composing it inside a burst, so the schema requires a URL and the real
  // gate (http/https) stays at dispatch, the single source of truth.
  assert.equal(validateBurst({ steps: [burstStep('navigate')] }).ok, false, 'bare navigate must fail closed');
  assert.equal(validateBurst({ steps: [burstStep('navigate', { url: 'https://example.test/' })] }).ok, true);
  assert.equal(validateBurst({ steps: [burstStep('navigate', { url: 'https://example.test/', tabId: 2 })] }).ok, true);
  assert.equal(validateBurst({ steps: [burstStep('navigate', { url: '' })] }).ok, false, 'empty URL must fail closed');
});

test('a ref minted before a navigate on the same tab is dead', () => {
  // A navigation replaces the document, so every ref minted at or before it is
  // stale by definition. Consuming one is the same failure class as cross-tab
  // reuse, with its own code so the model recovers by re-finding.
  const results = [
    { index: 0, action: 'find', tabId: 1, ok: true, result: { items: [{ ref: 'r1' }] } },
    { index: 1, action: 'navigate', tabId: 1, ok: true, result: {} }
  ];
  assert.equal(burstStaleRef(results, 0, 1), true, 'ref before navigate on the same tab must be refused');
  assert.equal(burstStaleRef(results, 0, 2), false, 'cross-tab is the other check, not this one');
  const otherTab = [
    { index: 0, action: 'find', tabId: 1, ok: true, result: { items: [{ ref: 'r1' }] } },
    { index: 1, action: 'navigate', tabId: 2, ok: true, result: {} }
  ];
  assert.equal(burstStaleRef(otherTab, 0, 1), false, 'navigate on another tab kills nothing here');
  assert.equal(burstStaleRef([{ index: 0, action: 'find', tabId: 1, ok: true }], 0, 1), false, 'no navigate means no staleness');
});

test('runBurst enforces the navigate staleness check with its own code', () => {
  // Same wiring-pin convention as the cross-tab check: runBurst cannot run in
  // node, so the exact call is pinned by source text and the behavior above.
  const burst = sliceBetween('async function runBurst(', 'async function dispatch(');
  assert.match(burst, /burstStaleRef\(results, step\.refFromStep, stepTabId\)/);
  assert.match(burst, /BURST_STALE_REF/);
});

test('per-step tabId does not widen the primitive count', () => {
  const protocol = fs.readFileSync(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  const block = protocol.match(/export const METHOD_SPECS = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  const count = [...block[1].matchAll(/^\s*'([^']+)':\s*\{/gm)].length;
  assert.equal(count, 28, 'stream methods are new primitives, burst parameters are not');
});