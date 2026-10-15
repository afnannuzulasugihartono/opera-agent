// @last-edited: 2026-10-15 UTC+7.
// @title: window-focus \u2014 a drive can tell that the window it is typing into is behind something.
// @state: the three platforms, the refusals, the tool that answers it.
// @dependencies: node:test, assert, ../local/window-focus.js, ../local/mcp-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { windowState, focusWindow } from '../local/window-focus.js';
import { createFocusGuard } from '../local/focus-guard.js';
import { TOOLS } from '../local/mcp-server.js';

// WHY THESE CLAIMS EXIST. Measured live on this machine, with the drive typing into a
// Google Docs document: a browser window behind another application still took the
// keys, and a minimized browser window did not. So the window is a thing the driver
// reports and a thing a drive can bring forward \u2014 and a machine that cannot do it
// says so instead of answering false and letting the drive wonder.

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
  if (!out.focused && out.title) {
    assert.match(out.why, /left .* in front/, 'a focus something else took back names what took it');
  }
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

// WHY THE GUARD IS MEASURED HERE, NOT ASSUMED. The two live measurements came out
// opposite ways, and a guard built on either one alone would have been wrong: a
// browser behind another application still hears input, and a minimized browser does
// not. So the guard asks the page, which answers for free and gets both cases right,
// and pays for the machine only when the page says it is deaf.

test('a page that hears input costs one evaluation and never asks the machine', async () => {
  let asks = 0;
  let focuses = 0;
  const ensure = createFocusGuard({ clock: () => 0, focus: async () => { focuses += 1; return { focused: true, title: 'x' }; } });

  const out = await ensure({ hasFocus: async () => { asks += 1; return true; } });

  assert.equal(asks, 1, 'the page was asked');
  assert.equal(focuses, 0, 'and the machine was left alone');
  assert.equal(out.window, 'the page hears input');
  assert.equal(out.checked, 'page', 'the answer says which of the two ran');
});

test('a page that cannot hear brings its window back and names the window', async () => {
  const wanted = [];
  const ensure = createFocusGuard({
    clock: () => 0,
    focus: async (match) => { wanted.push(match); return { focused: true, title: 'Paper - Google Chrome', foreground: 'Paper - Google Chrome' }; }
  });

  const out = await ensure({ hasFocus: async () => false, match: 'Paper' });

  assert.deepEqual(wanted, ['Paper'], 'the window holding the tab is the one asked for');
  assert.equal(out.window, 'brought Paper - Google Chrome forward');
  assert.equal(out.checked, 'machine');
});

test('a window that would not come forward says what the machine said instead', async () => {
  const ensure = createFocusGuard({ clock: () => 0, focus: async () => ({ focused: false, why: 'no window on this machine has that in its title' }) });

  const out = await ensure({ hasFocus: async () => false });

  assert.match(out.window, /could not bring a window forward: no window/);
});

test('a burst of actions asks the page once, and a machine refusal is never cached', async () => {
  let at = 0;
  let asks = 0;
  const ensure = createFocusGuard({ clock: () => at, focus: async () => ({ focused: false, why: 'refused' }) });

  await ensure({ hasFocus: async () => { asks += 1; return false; } });
  at = 500;
  const second = await ensure({ hasFocus: async () => { asks += 1; return false; } });

  assert.equal(asks, 2, 'a refusal is not cached, because the next action may work');
  assert.equal(second.checked, 'machine');

  at = 600;
  const listening = async () => { asks += 1; return true; };
  await ensure({ hasFocus: listening });
  at = 1200;
  const third = await ensure({ hasFocus: listening });

  assert.equal(third.checked, 'memory', 'once the page hears input, a burst does not ask again');
  assert.equal(asks, 3);
});

test('a driver that cannot see the page says so rather than pretending the window is fine', async () => {
  const ensure = createFocusGuard({ clock: () => 0, focus: async () => ({ focused: true, title: 'x' }) });

  const out = await ensure({});

  assert.equal(out.checked, 'nothing');
  assert.match(out.window, /cannot tell/);
});

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