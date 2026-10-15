// @last-edited: 2026-10-15 UTC+7.
// @title: window-focus \u2014 a drive can tell that the window it is typing into is behind something.
// @state: the three platforms, the refusals, the tool that answers it.
// @dependencies: node:test, assert, ../local/window-focus.js, ../local/mcp-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { windowState, focusWindow } from '../local/window-focus.js';
import { TOOLS } from '../local/mcp-server.js';

// WHY THESE CLAIMS EXIST. Measured live on this product's own author: with the
// browser window behind another one, clicks and typing went nowhere, Google Docs
// took the keys and dropped them, and every drill failed in a way that looked like
// a bug in the page. Nothing in the answer said why. So the window is a thing the
// driver reports and a thing a drive can bring forward \u2014 and a machine that cannot
// do it says so instead of answering false and letting the drive wonder.

test('the window state names the window in front and the ones behind it', async () => {
  const state = await windowState();

  assert.equal(typeof state.platform, 'string');
  assert.equal(typeof state.foreground, 'string');
  assert.ok(Array.isArray(state.windows), 'the other windows come back as a list');
  assert.ok(state.windows.every((title) => typeof title === 'string' && title.length > 0));
});

test('focusing names the window it brought and whether the machine allowed it', async () => {
  const out = await focusWindow('a window that is not on this machine');

  assert.equal(typeof out.focused, 'boolean');
  assert.equal(typeof out.title, 'string');
  assert.equal(typeof out.why, 'string');
  if (out.focused) assert.equal(out.why, '', 'a focus that happened has nothing left to explain');
  else assert.ok(out.why.length > 0, 'a focus that did not happen says why');
});

test('a platform with no implementation refuses in words rather than answering false', async () => {
  const state = await windowState({ platform: 'sunos' });

  assert.equal(state.focused, false);
  assert.match(state.why, /not implemented/);
});

// WHY THE READ AND THE WRITE ARE BOTH OFFERED. An agent that cannot type needs to
// know whether the window is behind something before it starts clicking, and an
// agent that has just been told needs one call that fixes it \u2014 not a paragraph
// about window managers.

test('the catalogue offers the window state inside browser_status and a call that moves it', () => {
  const status = TOOLS.find((tool) => tool.name === 'browser_status');
  const focus = TOOLS.find((tool) => tool.name === 'focus_window');

  assert.ok(status, 'browser_status is there');
  assert.match(status.description, /front/i, 'and it says whether a browser window is in front');
  assert.ok(focus, 'focus_window is there');
  assert.match(focus.description, /title/, 'and it says which window to bring forward');
  assert.deepEqual(Object.keys(focus.inputSchema.properties), ['match']);
});

test('every tool the advice can name still exists after this', () => {
  const names = new Set(TOOLS.map((tool) => tool.name));

  assert.ok(names.has('focus_window'), 'the advice below points at focus_window, so it has to be there');
});