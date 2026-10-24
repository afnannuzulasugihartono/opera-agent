// @last-edited: 2026-10-15 UTC+7.
// @title: window-focus \u2014 a drive can tell that the window it is typing into is behind something.
// @state: the three platforms, the refusals, the tool that answers it.
// @dependencies: node:test, assert, ../local/window-focus.js, ../local/mcp-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { windowState, focusWindow } from '../local/window-focus.js';
import { createFocusGuard } from '../local/focus-guard.js';
import { TOOLS } from '../local/mcp-server.js';

// WHY THESE CLAIMS EXIST.
// Measured live on this machine, with the drive typing into a Google Docs document: a browser window behind another application still took the keys, and a minimized browser window did not.
// So the window is a thing the driver reports and a thing a drive can bring forward \u2014 and a machine that cannot do it says so instead of answering false and letting the drive wonder.

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

test('focus_window with no match reads the machine and moves nothing', async () => {
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, args[args.length - 1]]);
    return { stdout: 'FOREGROUND OpenCode\nPaper - Google Chrome\n' };
  };

  const out = await focusWindow('', { platform: 'win32', exec });

  assert.equal(calls.length, 1, 'the machine is read once');
  assert.match(calls[0][1], /^\[OperaWindow\]::Read\(\)$/m, 'and only the read path is invoked');
  assert.doesNotMatch(calls[0][1], /^\[OperaWindow\]::Focus\(/m, 'no window is brought forward');
  assert.equal(out.match, '');
  assert.equal(out.focused, false);
  assert.equal(out.title, '');
  assert.equal(out.foreground, 'OpenCode');
  assert.deepEqual(out.windows, ['Paper - Google Chrome']);
  assert.match(out.why, /no match given/);
});

test('a platform with no implementation refuses in words rather than answering false', async () => {
  const state = await windowState({ platform: 'sunos' });

  assert.equal(state.focused, false);
  assert.match(state.why, /not implemented/);
});

// WHY THE REFUSAL IS HELD TO THE SAME SHAPE.
// Measured on CI: the Linux runner took the refusal path and the answer had no `title` key at all, so a caller reading the title of a refusal found undefined where a caller on Windows found an empty string.
// The keys a caller reads have to exist whether the machine answered or refused.

test('a refusal carries every key a real answer carries', async () => {
  const real = await windowState();
  const refused = await windowState({ platform: 'sunos' });
  const refusedFocus = await focusWindow('', { platform: 'sunos' });

  for (const key of ['platform', 'foreground', 'windows', 'minimized', 'focused', 'why']) {
    assert.ok(key in refused, `windowState refusal is missing ${key}`);
    assert.ok(key in refusedFocus, `focusWindow refusal is missing ${key}`);
  }
  for (const key of ['title', 'match', 'focused', 'why', 'foreground', 'windows', 'minimized']) {
    assert.ok(key in refusedFocus, `focusWindow refusal is missing ${key}`);
  }
  assert.equal(typeof refusedFocus.title, 'string', 'and the title is a string, not nothing');
  assert.ok(Array.isArray(real.windows), 'the real answer still answers');
});

// WHY THE READ AND THE WRITE ARE BOTH OFFERED.
// An agent that cannot type needs to know whether the window is behind something before it starts clicking, and an agent that has just been told needs one call that fixes it \u2014 not a paragraph about window managers.

// WHY THE GUARD IS MEASURED HERE, NOT ASSUMED.
// The two live measurements came out opposite ways, and a guard built on either one alone would have been wrong: a browser behind another application still hears input, and a minimized browser does not.
// So the guard asks the page, which answers for free and gets both cases right, and pays for the machine only when the page says it is deaf.

test('a page that hears input costs one evaluation and never asks the machine', async () => {
  let asks = 0;
  let reads = 0;
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => { reads += 1; return { foreground: '', minimized: [] }; },
    focus: async () => ({ focused: true, title: 'x' })
  });

  const out = await ensure({ hasFocus: async () => { asks += 1; return true; } });

  assert.equal(asks, 1, 'the page was asked');
  assert.equal(reads, 0, 'and the machine was left alone');
  assert.equal(out.window, 'the page hears input');
  assert.equal(out.checked, 'page', 'the answer says which of the two ran');
});

// WHY THESE THREE CLAIMS ARE ONE CLAIM.
// Measured live: a background tab and a minimized window report exactly the same thing to the page - no focus, not visible
// - and need opposite answers, because text lands in the first and goes nowhere in the second.
//   Only the machine can tell them apart, so it is asked once, and only when the page is deaf.

test('a page that cannot hear asks the machine once and says what it found', async () => {
  let reads = 0;
  let focuses = 0;
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => { reads += 1; return { foreground: 'Typecelerate', windows: ['Typecelerate', 'Paper - Google Chrome'], minimized: [] }; },
    focus: async () => { focuses += 1; return { focused: true, title: 'x' }; }
  });

  const out = await ensure({ hasFocus: async () => false, match: 'Paper' });

  assert.equal(reads, 1, 'the shell was spent once');
  assert.equal(focuses, 0, 'and a window that is merely behind is left where the human put it');
  assert.match(out.window, /in the background and hears input anyway/);
  assert.match(out.window, /Typecelerate is in front/, 'and the answer names what is in front');
  assert.equal(out.checked, 'machine');
});

test('a window on the taskbar is brought back, because that is where text goes to die', async () => {
  const wanted = [];
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => ({ foreground: 'OpenCode', windows: [], minimized: ['Paper - Google Chrome'] }),
    focus: async (match) => { wanted.push(match); return { focused: true, title: 'Paper - Google Chrome', foreground: 'Paper - Google Chrome' }; }
  });

  const out = await ensure({ hasFocus: async () => false, match: 'Paper' });

  assert.deepEqual(wanted, ['Paper - Google Chrome'], 'the window that was minimized is the one named');
  assert.equal(out.window, 'brought Paper - Google Chrome back from the taskbar');
});

// WHY THE GUARD NAMES THE TASKBAR WINDOW ITSELF.
// An empty match now means "ask, do not move", so a guard that forwarded the caller's empty match would stop bringing back the very window it had just found on the taskbar.
// The guard therefore passes the title it found; this test is the one that notices if that is ever undone.

test('a taskbar window is named even when the caller gave no match', async () => {
  const wanted = [];
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => ({ foreground: 'OpenCode', windows: [], minimized: ['Paper - Google Chrome'] }),
    focus: async (match) => { wanted.push(match); return { focused: true, title: 'Paper - Google Chrome' }; }
  });

  await ensure({ hasFocus: async () => false });

  assert.deepEqual(wanted, ['Paper - Google Chrome'], 'the minimized window is named, not the empty match');
});

test('a taskbar window the machine will not bring back says what it said', async () => {
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => ({ foreground: 'OpenCode', windows: [], minimized: ['Paper - Google Chrome'] }),
    focus: async () => ({ focused: false, why: 'something is taking the focus back' })
  });

  const out = await ensure({ hasFocus: async () => false });

  assert.match(out.window, /on the taskbar and the machine would not bring .* back: something is taking the focus back/);
});

test('a burst on a page that cannot hear pays for one shell and keeps asking the page', async () => {
  let at = 0;
  let asks = 0;
  let reads = 0;
  const ensure = createFocusGuard({
    clock: () => at,
    read: async () => { reads += 1; return { foreground: 'OpenCode', windows: [], minimized: [] }; },
    focus: async () => ({ focused: true, title: 'x' })
  });

  await ensure({ hasFocus: async () => { asks += 1; return false; } });
  at = 400;
  const second = await ensure({ hasFocus: async () => { asks += 1; return false; } });

  assert.equal(asks, 2, 'the page is asked every time, because it costs one evaluation and it is the answer that changes fastest');
  assert.equal(reads, 1, 'and the shell is paid once for the burst');
  assert.equal(second.checked, 'memory', 'the answer says it came from the machine it already asked');

  at = 1600;
  const third = await ensure({ hasFocus: async () => { asks += 1; return false; } });
  assert.equal(reads, 2, 'a shell older than a beat is asked again, because a human brings windows back');

  at = 1700;
  const listening = await ensure({ hasFocus: async () => { asks += 1; return true; } });
  assert.equal(listening.window, 'the page hears input');
  assert.equal(reads, 2, 'a page that hears costs nothing, whatever the machine was doing a moment ago');
  assert.equal(asks, 4);
});

test('a driver that cannot see the page says so rather than pretending the window is fine', async () => {
  const ensure = createFocusGuard({ clock: () => 0, read: async () => ({}), focus: async () => ({ focused: true, title: 'x' }) });

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