// @last-edited: 2026-10-13 UTC+7.
// @title: agent-drive — one driver, every canvas: locate by meaning, act, prove it.
// @state: 7 locks; envelope, locate, act-verify, timeouts, budget, fallback, no-leak.
// @dependencies: node:test, assert, ../lib/agent-drive.js.

// WHY THIS FILE EXISTS
//
// Canvas drives died three ways in measurement: coordinates went stale when the window
// moved, menus swallowed keys sent faster than they render, and one CDP call
// (Accessibility.queryAXTree) never answered at all. Each death teaches one lock
// below. The driver answers with envelopes shaped for an agent to consume in one
// glance: what was attempted, how long it took, what proves it, and — on failure —
// what was visible instead plus the single next action worth trying.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentDriver } from '../lib/agent-drive.js';

// A transport double with scripted latency: every call resolves after its delay with
// canned data, so timing behavior is deterministic without touching a browser.

function fakeTransport(script = {}) {
  const calls = [];
  return {
    calls,
    async axTree() {
      calls.push('axTree');
      await sleep(script.axMs ?? 0);
      return script.tree ?? [];
    },
    async box(id) {
      calls.push(['box', id]);
      await sleep(script.boxMs ?? 0);
      const found = (script.boxes ?? {})[id];
      if (!found) throw new Error(`no box for ${id}`);
      return found;
    },
    async click(x, y) {
      calls.push(['click', x, y]);
      await sleep(script.clickMs ?? 0);
      return { ok: true };
    },
    async keys(events) {
      calls.push(['keys', events.length]);
      await sleep(script.keysMs ?? 0);
      return { ok: true, events: events.length };
    },
    async type(text) {
      calls.push(['type', text.length]);
      await sleep(script.typeMs ?? 0);
      return { ok: true, chars: text.length };
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function node(id, role, name, extra = {}) {
  return { nodeId: String(id), role: { value: role }, name: { value: name }, backendDOMNodeId: 1000 + Number(id), childIds: [], ...extra };
}

const TREE = [
  node(1, 'menubar', '', { childIds: ['2', '3'] }),
  node(2, 'menuitem', 'Insert', { childIds: [] }),
  node(3, 'menuitem', 'Format', { childIds: [] }),
  node(4, 'button', 'Save', {})
];

test('locate returns the point and the proof, never bare coordinates', async () => {
  const transport = fakeTransport({
    tree: TREE,
    boxes: { 1002: [0, 0, 100, 40, 100, 40, 0, 40] }
  });
  const driver = createAgentDriver({ transport });

  const out = await driver.locate({ role: 'menuitem', name: 'ins' });

  assert.equal(out.ok, true);
  assert.deepEqual(out.point, { x: 50, y: 20 });
  assert.equal(out.target.role, 'menuitem');
  assert.equal(out.target.name, 'Insert');
  assert.ok(typeof out.ms === 'number');
});

test('a miss names what was visible instead of returning nothing', async () => {
  const transport = fakeTransport({ tree: TREE, boxes: {} });
  const driver = createAgentDriver({ transport });

  const out = await driver.locate({ role: 'menuitem', name: 'Nope' });

  assert.equal(out.ok, false);
  assert.equal(out.code, 'NOT_FOUND');
  assert.ok(out.visible.length >= 2, 'the failure must show candidates');
  assert.ok(out.visible.some((v) => v.includes('Insert')));
  assert.match(out.next, /broaden|widen|relax/i);
});

test('click composes locate plus action into one envelope with one clock', async () => {
  const transport = fakeTransport({
    tree: TREE,
    boxes: { 1002: [10, 10, 110, 10, 110, 50, 10, 50] },
    axMs: 20,
    clickMs: 30
  });
  const driver = createAgentDriver({ transport });

  const out = await driver.click({ role: 'menuitem', name: 'Insert' });

  assert.equal(out.ok, true);
  assert.deepEqual(transport.calls[2], ['click', 60, 30]);
  assert.ok(out.ms >= 50, `clock must cover both phases, got ${out.ms}`);
  assert.equal(out.steps.length, 2);
});

test('a hung transport call fails loudly with what completed, never silently', async () => {
  const transport = fakeTransport({ tree: TREE });
  transport.box = async () => {
    await sleep(5000);
    return [0, 0, 0, 0, 0, 0, 0, 0];
  };
  const driver = createAgentDriver({ transport, callTimeoutMs: 120 });

  const out = await driver.locate({ role: 'menuitem', name: 'Insert' });

  assert.equal(out.ok, false);
  assert.equal(out.code, 'TIMEOUT');
  assert.match(out.message, /box/);
});

test('verify-then-claim: type checks the landing and reports the evidence', async () => {
  const seen = [];
  const transport = fakeTransport({ tree: TREE });
  const driver = createAgentDriver({ transport });

  const out = await driver.typeText({
    text: 'hello',
    verify: async () => {
      seen.push('verified');
      return { ok: true, evidence: '11 chars at index 71' };
    }
  });

  assert.equal(out.ok, true);
  assert.deepEqual(seen, ['verified']);
  assert.equal(out.evidence, '11 chars at index 71');
});

test('a failed verification reports the mismatch, not a bare false', async () => {
  const transport = fakeTransport({ tree: TREE });
  const driver = createAgentDriver({ transport });

  const out = await driver.typeText({
    text: 'hello',
    verify: async () => ({ ok: false, expected: 'hello at 71', found: 'nothing at 71' })
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, 'VERIFY_FAILED');
  assert.equal(out.expected, 'hello at 71');
  assert.equal(out.found, 'nothing at 71');
});

test('every envelope carries its own clock and the call sequence stays inspectable', async () => {
  const transport = fakeTransport({ tree: TREE, boxes: { 1004: [0, 0, 8, 0, 8, 8, 0, 8] }, axMs: 5 });
  const driver = createAgentDriver({ transport });

  await driver.locate({ role: 'button', name: 'Save' });
  const summary = driver.summary();

  assert.equal(summary.calls, 2);
  assert.ok(summary.totalMs >= 5);
  assert.deepEqual(Object.keys(summary.byOp).sort(), ['axTree', 'box']);
});
