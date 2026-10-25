// @last-edited: 2026-10-25 UTC+7.
// @title: window-restore — the window update that takes a window off the taskbar, decided without a browser.
// @state: one rule per case: minimize is restored with focus, an unfocused window is focused, a focused window is left alone, and the caller can refuse the whole ask.
// @dependencies: node:test, node:assert/strict, ../extension/lib/window-restore.js.

// WHY THIS RULE IS PURE.
// The live proof is a browser window on the taskbar, and a test that needs one cannot run on a CI runner.
// So the decision is a function of what chrome.windows.get answers, and the live suite drives the same decision against a real minimized window.

import test from 'node:test';
import assert from 'node:assert/strict';

import { windowUpdateFor, windowUpdateCase } from '../extension/lib/window-restore.js';

test('a minimized window is restored with state normal, because focus alone leaves it on the taskbar', () => {
  assert.deepEqual(windowUpdateFor({ state: 'minimized', focused: false }), { focused: true, state: 'normal' });
});

test('a window that is already restored but behind is only focused', () => {
  assert.deepEqual(windowUpdateFor({ state: 'normal', focused: false }), { focused: true });
});

test('a focused window is left alone, so a drive pays no round trip for nothing', () => {
  assert.equal(windowUpdateFor({ state: 'normal', focused: true }), null);
});

test('a caller that refuses the window ask gets no update at all', () => {
  assert.equal(windowUpdateFor({ state: 'minimized', focused: false }, { focus: false }), null);
});

test('a window with no state and no focus is focused, and a state that is not minimized is not a restore', () => {
  assert.deepEqual(windowUpdateFor({}), { focused: true });
  assert.deepEqual(windowUpdateFor({ state: 'fullscreen', focused: false }), { focused: true });
});

test('the answer names which case it was, so a caller reports it instead of inferring it', () => {
  assert.equal(windowUpdateCase({ focused: true, state: 'normal' }), 'restored');
  assert.equal(windowUpdateCase({ focused: true }), 'focused');
  assert.equal(windowUpdateCase(null), 'left-alone');
});
