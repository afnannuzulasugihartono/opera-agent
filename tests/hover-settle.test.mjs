// @last-edited: 2026-10-10 UTC+7.
// @title: hover-settle.test — settle.test — Hover-as-a-first-class-step contracts.
// @state: drop the milestone prefix from the interaction test family.
// @dependencies: node:test, strict, promises, protocol, extension-source.

// Hover-as-a-first-class-step contracts.
//
// Root cause under test: multi-level menus needed a hand-built
// hover -> wait -> hover -> wait burst because hovering and settling were
// separate unbounded steps. These tests lock the policy, the burst contract,
// and — most importantly — the safety property that a hover never clicks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BURST_ACTION_METHODS, BURST_STEP_KEYS, validateBurst } from '../extension/lib/protocol.js';
import { extensionSource } from './helpers/extension-source.mjs';

await import('../extension/hover-settle.js');
const { DEFAULTS, normalize, plan } = globalThis.OperaAgentHoverSettle;

test('a hover with an expected submenu name settles only when it is observed', () => {
  const waiting = plan({ text: 'page numbers', observedText: 'insert', timeoutMs: 1500, elapsedMs: 10 });
  assert.equal(waiting.done, false);
  assert.equal(waiting.reason, 'awaiting_text');

  const seen = plan({ text: 'page numbers', observedText: 'Page Numbers', timeoutMs: 1500, elapsedMs: 120 });
  assert.equal(seen.done, true);
  assert.equal(seen.reason, 'text_appeared');
  assert.equal(seen.expectedText, 'page numbers');
});

test('an unmet submenu expectation terminates with a reason, never an exception', () => {
  const expired = plan({ text: 'page numbers', observedText: '', timeoutMs: 1500, elapsedMs: 1500 });
  assert.equal(expired.done, true);
  assert.equal(expired.reason, 'text_timeout');
  assert.equal(expired.expectedText, 'page numbers');
});

test('without an expectation, stability or an expansion flip settles the hover', () => {
  const stable = plan({ mutationVersion: 7, previousMutationVersion: 7, stableRounds: 2, elapsedMs: 50, timeoutMs: 1500 });
  assert.equal(stable.done, true);
  assert.equal(stable.reason, 'dom_stable');

  const flipped = plan({
    ariaExpanded: 'true', previousAriaExpanded: 'false',
    mutationVersion: 9, previousMutationVersion: 9, elapsedMs: 20, timeoutMs: 1500
  });
  assert.equal(flipped.done, true);

  assert.equal(flipped.reason, 'aria_expanded_changed');

  const mutating = plan({ mutationVersion: 9, previousMutationVersion: 8, elapsedMs: 20, timeoutMs: 1500 });
  assert.equal(mutating.done, false);
  assert.equal(mutating.reason, 'mutating');
});

test('a still-mutating page terminates on the timeout instead of hanging', () => {
  const expired = plan({ mutationVersion: 12, previousMutationVersion: 11, elapsedMs: 1500, timeoutMs: 1500 });
  assert.equal(expired.done, true);
  assert.equal(expired.reason, 'timeout');
});

test('settle bounds are clamped so a caller cannot ask for an unbounded wait', () => {
  const defaults = normalize({});
  assert.equal(defaults.timeoutMs, DEFAULTS.timeoutMs);
  assert.equal(defaults.intervalMs, DEFAULTS.intervalMs);
  assert.equal(defaults.stableRounds, DEFAULTS.stableRounds);
  assert.equal(defaults.text, '');
  assert.equal(normalize({ timeoutMs: 1 }).timeoutMs, 50);
  assert.equal(normalize({ timeoutMs: 999999 }).timeoutMs, 8000);
  assert.equal(normalize({ intervalMs: 0 }).intervalMs, 25);
  assert.equal(normalize({ stableRounds: 0 }).stableRounds, 1);
  assert.equal(normalize({ stableRounds: 999 }).stableRounds, 10);
  assert.equal(normalize({ text: '  Page Numbers  ' }).text, 'page numbers');
  assert.equal(normalize({ text: '   ' }).text, '');
  assert.equal(normalize({ timeoutMs: 'abc' }).timeoutMs, DEFAULTS.timeoutMs);
});

test('the hover burst step exists and requires a ref target', () => {
  assert.equal(BURST_ACTION_METHODS.hover, 'page.hover');

  assert.deepEqual(BURST_STEP_KEYS.hover, ['action', 'ref', 'refFromStep', 'refIndex', 'text', 'timeoutMs', 'tabId']);

  assert.equal(validateBurst({ steps: [{ action: 'hover', ref: 'oa-1' }] }).ok, true);

  assert.deepEqual(
    validateBurst({ steps: [{ action: 'find', text: 'Insert' }, { action: 'hover', refFromStep: 0, text: 'Page numbers' }] }),
    { ok: true }
  );

  assert.equal(validateBurst({ steps: [{ action: 'hover', refFromStep: 0 }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'hover' }] }).ok, false);
  assert.equal(validateBurst({ steps: [{ action: 'hover', text: 'Insert' }] }).ok, false);

  assert.equal(validateBurst({ steps: [{ action: 'hover', ref: 'oa-1', click: true }] }).ok, false);
  assert.equal(validateBurst({
    steps: Array.from({ length: 9 }, () => ({ action: 'hover', ref: 'oa-1' }))
  }).ok, false);
});

test('page.hover stays a burst-internal action, not a new public primitive', async () => {

  const protocol = await readFile(new URL('../extension/lib/protocol.js', import.meta.url), 'utf8');
  const allowlist = protocol.match(/export const ALLOWED_METHODS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  assert.doesNotMatch(allowlist, /page\.hover/);
  assert.equal(BURST_ACTION_METHODS.hover, 'page.hover');
});

test('a hover never clicks, and it goes through the shared focus gate', async () => {
  const source = await extensionSource();
  const start = source.indexOf('async function trustedHover');
  assert.ok(start > 0, 'trustedHover must exist');
  const block = source.slice(start, source.indexOf('\n}\n', start) + 2);

  assert.equal((block.match(/Input\.dispatchMouseEvent/g) || []).length, 1);
  assert.match(block, /type: 'mouseMoved'/);
  for (const forbidden of ['mousePressed', 'mouseReleased', 'Input\.insertText', 'dispatchKeyEvent']) {
    assert.doesNotMatch(block, new RegExp(forbidden.replace(/\./g, '\\.')));
  }
  assert.match(block, /withForegroundFocusGate/);
});

test('the in-page settle only observes and never carries document text out', async () => {
  const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function hoverSettleState');
  assert.ok(start > 0, 'hoverSettleState must exist');
  const block = source.slice(start, source.indexOf('function containsVisibleText', start));

  assert.match(block, /observedText: options\.text \? containsVisibleText\(options\.text\) : ''/);
  assert.doesNotMatch(block, /innerText|textContent/);

  assert.match(source, /case 'page\.hover_settle': return hoverSettleState\(args\)/);
  assert.match(source, /const hoverRuntime = globalThis\.OperaAgentHoverSettle;/,
    'the runtime is no longer read straight into a bare binding');
  assert.match(source, /typeof hoverRuntime\.plan === 'function'/,
    'the planner is not checked before it is used');
});

test('the manifest loads the settle runtime before the content script', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('hover-settle.js'), 'the settle runtime must be injected');
  assert.ok(scripts.indexOf('hover-settle.js') < scripts.indexOf('content.js'));
  assert.equal(manifest.version, '1.6.24');
});

test('the public burst schema accepts a hover step and still bounds everything', async () => {
  const source = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  const hover = source.match(/z\.object\(\{\s*action: z\.literal\("hover"\)[\s\S]*?\}\)\.strict\(\)/)?.[0] ?? '';
  assert.ok(hover, 'the hover burst step must be declared publicly');
  assert.match(hover, /ref: z\.string\(\)\.max\(200\)\.optional\(\)/);
  assert.match(hover, /text: z\.string\(\)\.max\(300\)\.optional\(\)/);
  assert.match(hover, /timeoutMs: z\.number\(\)\.int\(\)\.min\(50\)\.max\(8000\)\.optional\(\)/);

  for (const action of ['read', 'find', 'click', 'fill', 'key', 'scroll', 'wait', 'pointer']) {
    assert.ok(source.includes(`z.literal("${action}")`), `burst step ${action} must remain`);
  }
  assert.match(source, /z\.array\(burstStepSchema\)\.min\(1\)\.max\(8\)/);
});
