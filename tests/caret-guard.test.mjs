// @last-edited: 2026-10-27 UTC+7.
// @title: caret-guard — the gate that keeps a read from moving a user's caret, and the verdict that says so when it did.
// @state: the gate as a table, and the restore verdict on the case the measurement proved impossible.
// @dependencies: node:test, node:assert/strict, ../local/caret-guard.js, ../local/read-strategy.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HARM_CARET_MOVE, HARM_NONE } from '../local/read-strategy.js';
import { createCaretGuard, gateRead, rememberedState, restoreVerdict } from '../local/caret-guard.js';

test('a read that harms nothing is always allowed', () => {
  const gate = gateRead({ harm: HARM_NONE, allowCaretMove: false });
  assert.equal(gate.allowed, true);
  assert.ok(gate.why.length > 0);
});

test('a caret-move read with no evidence of restoration is refused', () => {
  const gate = gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: false });
  assert.equal(gate.allowed, false);
  assert.match(gate.why, /caret/i);
});

test('a caret-move read runs only with consent recorded on the call', () => {
  const gate = gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: true });
  assert.equal(gate.allowed, true);
});

test('consent is per call and never carried', () => {
  assert.equal(gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: true }).allowed, true);
  assert.equal(gateRead({ harm: HARM_CARET_MOVE, allowCaretMove: false }).allowed, false);
  assert.equal(gateRead({ harm: HARM_CARET_MOVE }).allowed, false);
});

test('a canvas caret that is not in the DOM cannot be promised back', () => {
  const mark = rememberedState({ rangeCount: 1, collapsed: true, anchorOffset: 0, hostTextLength: 0 });
  assert.equal(mark.restorable, false);
  const verdict = restoreVerdict({ before: mark, after: { rangeCount: 1, collapsed: true, anchorOffset: 0, hostTextLength: 0 } });
  assert.equal(verdict.restored, false);
  assert.ok(verdict.why.length > 0);
});

test('a DOM selection with a real position is restorable', () => {
  const mark = rememberedState({ rangeCount: 1, collapsed: true, anchorOffset: 42, hostTextLength: 300 });
  assert.equal(mark.restorable, true);
  const verdict = restoreVerdict({ before: mark, after: { rangeCount: 1, collapsed: true, anchorOffset: 42, hostTextLength: 300 } });
  assert.equal(verdict.restored, true);
});

test('a DOM selection that moved is reported as moved, not as restored', () => {
  const mark = rememberedState({ rangeCount: 1, collapsed: true, anchorOffset: 42, hostTextLength: 300 });
  const verdict = restoreVerdict({ before: mark, after: { rangeCount: 1, collapsed: true, anchorOffset: 900, hostTextLength: 300 } });
  assert.equal(verdict.restored, false);
});

test('the guard remembers a position and reports it back', async () => {
  // The fake evaluate walks the frames the expression names, so the expression itself is what is under test rather than a stubbed answer.
  const evaluate = async () => ({
    rangeCount: 1,
    collapsed: true,
    anchorOffset: 42,
    hostTextLength: 300
  });
  const guard = createCaretGuard({ evaluate });
  const mark = await guard.remember();
  assert.equal(mark.restorable, true);
  assert.equal(mark.anchorOffset, 42);
  const verdict = await guard.verdict(mark);
  assert.equal(verdict.restored, true);
});

test('the guard reports a canvas caret as something it cannot put back', async () => {
  const evaluate = async () => ({ rangeCount: 1, collapsed: true, anchorOffset: 0, hostTextLength: 0 });
  const guard = createCaretGuard({ evaluate });
  const mark = await guard.remember();
  assert.equal(mark.restorable, false);
  const verdict = await guard.verdict(mark);
  assert.equal(verdict.restored, false);
  assert.match(verdict.why, /nothing to put back/);
});
