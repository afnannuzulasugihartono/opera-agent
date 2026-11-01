// @last-edited: 2026-11-01 UTC+7.
// @title: window-focus \u2014 a drive can tell that the window it is typing into is behind something.
// @state: the three platforms, the refusals, the tool that answers it.
// @dependencies: node:test, assert, ../local/window-focus.js, ../local/mcp-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  windowState,
  focusWindow
} from '../local/window-focus.js';
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
  const exec = async (
    command,
    args
  ) => {
    calls.push([
      command,
      args[args.length - 1]
    ]);
    return { stdout: 'FOREGROUND OpenCode\nPaper - Google Chrome\n' };
  };

  const out = await focusWindow('', {
    platform: 'win32',
    exec
  });

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

// WHY THE BROWSER GOES WITH THE TITLE.
// The extension may be talking to any browser on any machine, and two of them can hold the same page title.
// The window of the browser being driven is the one that should come forward, so the browser travels with the title into the machine.

test('the window brought forward is the one of the browser being driven', async () => {
  const calls = [];
  const exec = async (
    command,
    args
  ) => {
    calls.push([
      command,
      args[args.length - 1]
    ]);
    return { stdout: 'BROUGHT Paper - Google Chrome\nFOREGROUND Paper - Google Chrome\n' };
  };

  const out = await focusWindow('Paper', {
    platform: 'win32',
    exec,
    browser: 'Chrome'
  });

  assert.match(calls[0][1], /Find\('Paper', 'Chrome'\)/, 'the browser goes with the title');
  assert.equal(out.browser, 'Chrome', 'and the answer names it');
  assert.equal(out.title, 'Paper - Google Chrome', 'so the caller knows which window it got');
});

// WHY THE PERSON IS ASKED BEFORE THE SCREEN IS TAKEN FROM THEM.
// The person may have moved on to another tab, another browser or another program while the drive was working, and bringing a window forward under their hands takes that away without asking.
// So the question is asked in the window they are in, and only an answer of yes lets the focus move.

test('the person is asked in the window in front before the focus moves', async () => {
  const calls = [];
  const exec = async (
    command,
    args
  ) => {
    calls.push([
      command,
      args[args.length - 1]
    ]);
    return { stdout: 'BROUGHT Paper - Google Chrome\nFOREGROUND Paper - Google Chrome\n' };
  };

  await focusWindow('Paper', {
    platform: 'win32',
    exec
  });

  assert.match(calls[0][1], /focus-notice\.ps1/, 'the question is asked by the notice in this tree');
  assert.match(calls[0][1], /Foreground\(\) -ne \$h/, 'and only when the window in front is another one');
});

test('a person who says no leaves the screen where it was', async () => {
  const exec = async () => ({
    stdout: 'REFUSED Paper - Google Chrome\nFOREGROUND Typecelerate - Brave\nPaper - Google Chrome\n'
  });

  const out = await focusWindow('Paper', {
    platform: 'win32',
    exec
  });

  assert.equal(out.focused, false, 'the window did not come forward');
  assert.match(out.why, /did not allow/, 'and the answer says who said no');
  assert.match(out.why, /Typecelerate - Brave/, 'and what stayed on the screen');
});

// WHY A WINDOW THAT IS NOT MINIMIZED KEEPS ITS SIZE.
// Measured live on this machine: focusing a maximized browser window restored it to its smaller plain size, and the page the person was reading shrank under them without being asked.
// So the size is only touched for a window that is minimized, which cannot take a click at all.

test('a window that is not minimized is not resized on the way forward', async () => {
  const calls = [];
  const exec = async (
    command,
    args
  ) => {
    calls.push([
      command,
      args[args.length - 1]
    ]);
    return { stdout: 'BROUGHT Paper - Google Chrome\nFOREGROUND Paper - Google Chrome\n' };
  };

  await focusWindow('Paper', {
    platform: 'win32',
    exec,
    browser: 'Google Chrome'
  });

  assert.match(calls[0][1], /if \(IsIconic\(h\)\) ShowWindow\(h, 9\);/, 'only a minimized window is restored');
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

// WHY THE GUARD IS MEASURED HERE, NOT ASSUMED.
// The live measurements came out opposite ways, and a guard built on either one alone would have been wrong: a browser behind another application still hears input, and a minimized browser does not.
// The second measurement was worse than the first: the page of a browser that is behind another program still says it has the focus, so the page cannot say whether the screen is the drive's.
// So the machine is asked what is in front - one read, shared - and the person is asked once when the screen is somebody else's.

test('the screen on the drive\'s own window is left alone', async () => {
  let asks = 0;
  let focuses = 0;
  let reads = 0;
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => {
      reads += 1; return {
        foreground: 'Paper - Google Chrome',
        windows: [
          'Paper - Google Chrome'
        ],
        minimized: []
      };
    },
    browser: async () => ({
      name: 'Google Chrome'
    }),
    ask: async () => {
      asks += 1;
      return {
        allowed: true,
        answer: 'allow'
      };
    },
    focus: async () => {
      focuses += 1;
      return {
        focused: true,
        title: 'Paper - Google Chrome'
      };
    }
  });

  const out = await ensure({
    hasFocus: async () => true,
    match: 'Paper'
  });

  assert.equal(reads, 1, 'the machine was asked once');
  assert.equal(asks, 0, 'and the person was not asked about a screen that is already the drive\'s');
  assert.equal(focuses, 0, 'and nothing was moved');
  assert.equal(out.window, 'the drive holds the screen');
  assert.equal(out.focused, true);
});

// WHY THE BROWSER TRAVELS WITH THE TITLE.
// Two windows can carry the same page title - one in Chrome and one in Brave - and a title alone would say the drive already holds the screen while the screen is about to move to another browser.

test('the same page in another browser is not the drive\'s screen', async () => {
  let asks = 0;
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      foreground: 'Paper - Brave',
      windows: [],
      minimized: []
    }),
    browser: async () => ({
      name: 'Google Chrome'
    }),
    ask: async () => {
      asks += 1;
      return {
        allowed: false,
        answer: 'dismiss'
      };
    },
    focus: async () => ({
      focused: true,
      title: 'Paper - Google Chrome'
    })
  });

  const out = await ensure({
    hasFocus: async () => true,
    match: 'Paper'
  });

  assert.equal(asks, 1, 'the person is asked, because the screen is another browser\'s');
  assert.match(out.window, /the screen is the person's/);
});

// WHY THE DRIVE HOLDS THE SCREEN WHILE IT WORKS.
// The person asked for a window lock: while the drive works, the focus cannot wander off to another tab, another browser or another program.
// So the first time the machine says the screen is somebody else's, the person is asked in the window they are in, and once the person says yes the drive takes the screen back on its own for the rest of the run - the question is asked once, not once per keystroke.

test('a screen that is somebody else\'s asks the person once and is taken back', async () => {
  let asks = 0;
  let fronts = 0;
  let focuses = 0;
  let focusOptions = null;
  let heard = false;
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      foreground: 'Typecelerate - Brave',
      windows: [
        'Paper - Google Chrome'
      ],
      minimized: []
    }),
    browser: async () => ({
      name: 'Google Chrome'
    }),
    front: async () => {
      fronts += 1;
    },
    ask: async () => {
      asks += 1;
      return {
        allowed: true,
        answer: 'allow'
      };
    },
    focus: async (match, options) => {
      focuses += 1;
      focusOptions = options;
      heard = true;
      return {
        focused: true,
        title: 'Paper - Google Chrome',
        foreground: 'Paper - Google Chrome',
        match,
        options
      };
    }
  });

  const out = await ensure({
    hasFocus: async () => heard,
    match: 'Paper'
  });

  assert.equal(asks, 1, 'the person was asked');
  assert.equal(fronts, 1, 'and the drive took its tab back to the front');
  assert.equal(focuses, 1, 'and its window with it');
  assert.equal(focusOptions.os, true, 'through the operating system, because CDP cannot lift a covered window');
  assert.equal(out.focused, true);
  assert.equal(out.checked, 'lock');
});

test('the screen is taken back without asking again once the person said yes', async () => {
  let asks = 0;
  let focuses = 0;
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      foreground: 'Typecelerate - Brave',
      windows: [],
      minimized: []
    }),
    browser: async () => ({
      name: 'Google Chrome'
    }),
    ask: async () => {
      asks += 1;
      return {
        allowed: true,
        answer: 'allow'
      };
    },
    focus: async () => {
      focuses += 1;
      return {
        focused: true,
        title: 'Paper - Google Chrome'
      };
    }
  });

  await ensure({
    hasFocus: async () => true,
    match: 'Paper'
  });
  await ensure({
    hasFocus: async () => true,
    match: 'Paper'
  });

  assert.equal(asks, 1, 'the question is asked once for the whole run');
  assert.equal(focuses, 2, 'and the drive holds the screen every time it loses it');
});

test('a person who keeps the screen lets the drive work in the background', async () => {
  let asks = 0;
  let focuses = 0;
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      foreground: 'Typecelerate - Brave',
      windows: [],
      minimized: []
    }),
    browser: async () => ({
      name: 'Google Chrome'
    }),
    ask: async () => {
      asks += 1;
      return {
        allowed: false,
        answer: 'dismiss'
      };
    },
    focus: async () => {
      focuses += 1;
      return {
        focused: true,
        title: 'Paper - Google Chrome'
      };
    }
  });

  const out = await ensure({
    hasFocus: async () => false,
    match: 'Paper'
  });

  assert.equal(asks, 1, 'the person was asked once');
  assert.equal(focuses, 0, 'and the screen stayed where they put it');
  assert.match(out.window, /the screen is the person's/);
  assert.equal(out.blocked, undefined, 'the work goes on in the background, because the page still hears the input');
});

// WHY AN OWNED WINDOW NEEDS NO NAME.
// A CDP session answers "is my window minimized" through Browser.getWindowForTarget, and it carries no title - only the fact that this is the window the session is attached to.
// So the guard restores it on the session's own word; requiring a name there left a minimized browser on the taskbar for every drive that arrived through a debugging port.

test('a window the session owns is brought back without a name', async () => {
  const wanted = [];
  let restored = false;
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      platform: 'win32',
      ownWindow: true,
      foreground: '',
      windows: [],
      minimized: ['the browser window']
    }),
    focus: async (match) => {
      wanted.push(match); restored = true; return {
        focused: true,
        title: 'the browser window'
      };
    }
  });

  const out = await ensure({
    hasFocus: async () => restored,
    match: 'Notes - Google Docs'
  });

  assert.deepEqual(wanted, ['the browser window'], 'the session\'s own window is the one restored');
  assert.equal(out.focused, true, 'and the page confirmed it hears input again');
  assert.equal(out.blocked, undefined);
  assert.match(out.window, /brought the browser window back from the taskbar/);
});

test('a window on the taskbar is brought back, because that is where text goes to die', async () => {
  const wanted = [];
  let restored = false;
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      foreground: 'OpenCode',
      windows: [],
      minimized: ['Paper - Google Chrome']
    }),
    focus: async (match) => {
      wanted.push(match); restored = true; return {
        focused: true,
        title: 'Paper - Google Chrome',
        foreground: 'Paper - Google Chrome'
      };
    }
  });

  const out = await ensure({
    hasFocus: async () => restored,
    match: 'Paper'
  });

  assert.deepEqual(wanted, ['Paper - Google Chrome'], 'the window that was minimized is the one named');
  assert.equal(out.window, 'brought Paper - Google Chrome back from the taskbar');
});

// WHY A WINDOW THAT CAME FORWARD IS NOT ENOUGH.
// Measured live on this machine: two Chrome windows held the same page title, and the machine brought forward the one that was awake while the minimized one stayed on the taskbar.
// The answer said a window was back, the page was still deaf, and the drive would have typed into nothing - so the page is asked again, and a deaf page blocks the action.

test('a window that comes forward but leaves the page deaf is blocked, not promised', async () => {
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      foreground: 'OpenCode',
      windows: [],
      minimized: ['Paper - Google Chrome']
    }),
    focus: async () => ({
      focused: true,
      title: 'Paper - Google Chrome',
      foreground: 'Paper - Google Chrome'
    })
  });

  const out = await ensure({
    hasFocus: async () => false,
    match: 'Paper'
  });

  assert.equal(out.focused, false);
  assert.equal(out.blocked, true, 'and the caller is told not to send input');
  assert.match(out.window, /brought Paper - Google Chrome back from the taskbar, but the page still cannot hear input/);
});

// WHY THE GUARD NEVER TAKES WHATEVER IS ON THE TASKBAR.
// Measured live on this machine: a read-only burst on a page that was merely behind another application brought a minimized Settings window to the front, because nothing had named the browser and the guard took the first taskbar window it found.
// The next drive that typed would have typed into Settings.
// A window is restored only when the caller names a piece of it.

test('a minimized window the caller did not name stays on the taskbar', async () => {
  const wanted = [];
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => ({
      foreground: 'OpenCode',
      windows: [],
      minimized: [
        'Settings',
        'Paper - Google Chrome'
      ]
    }),
    ask: async () => ({
      allowed: true,
      answer: 'allow'
    }),
    focus: async (match) => {
      wanted.push(match); return {
        focused: true,
        title: 'Settings'
      };
    }
  });

  const out = await ensure({ hasFocus: async () => false });

  assert.deepEqual(wanted, [], 'no window is touched without a name');
  assert.match(out.window, /the screen is the person's/);
  assert.match(out.window, /OpenCode is in front/);
});

test('a minimized window that does not fit the name stays on the taskbar', async () => {
  const wanted = [];
  const ensure = createFocusGuard({
    clock: () => 0,
    sleep: async () => {},
    read: async () => ({
      foreground: 'Settings',
      windows: [],
      minimized: ['Settings']
    }),
    browser: async () => ({
      name: 'Google Chrome'
    }),
    ask: async () => ({
      allowed: true,
      answer: 'allow'
    }),
    focus: async (match) => {
      wanted.push(match); return {
        focused: true,
        title: 'Paper - Google Chrome'
      };
    }
  });

  const out = await ensure({
    hasFocus: async () => false,
    match: 'Paper'
  });

  assert.deepEqual(wanted, ['Paper'], 'the window that is named is the one brought forward, and never the other one');
  assert.match(out.window, /the page still cannot hear input/);
  assert.doesNotMatch(out.window, /brought Settings back/, 'and the unnamed one stays on the taskbar');
});

test('a taskbar window the machine will not bring back says what it said', async () => {
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => ({
      foreground: 'OpenCode',
      windows: [],
      minimized: ['Paper - Google Chrome']
    }),
    focus: async () => ({
      focused: false,
      why: 'something is taking the focus back'
    })
  });

  const out = await ensure({
    hasFocus: async () => false,
    match: 'Paper'
  });

  assert.match(out.window, /on the taskbar and the machine would not bring .* back: something is taking the focus back/);
});

test('a burst pays for one shell and keeps the answer', async () => {
  let at = 0;
  let reads = 0;
  const ensure = createFocusGuard({
    clock: () => at,
    read: async () => {
      reads += 1; return {
        foreground: 'Paper - Google Chrome',
        windows: [],
        minimized: []
      };
    },
    browser: async () => ({
      name: 'Google Chrome'
    }),
    focus: async () => ({
      focused: true,
      title: 'Paper - Google Chrome'
    })
  });

  await ensure({
    hasFocus: async () => true,
    match: 'Paper'
  });
  at = 400;
  const second = await ensure({
    hasFocus: async () => true,
    match: 'Paper'
  });

  assert.equal(reads, 1, 'the shell is paid once for the burst');
  assert.equal(second.checked, 'machine');

  at = 1600;
  await ensure({
    hasFocus: async () => true,
    match: 'Paper'
  });
  assert.equal(reads, 2, 'a shell older than a beat is asked again, because a human brings windows back');
});

test('a driver that cannot see the page says so rather than pretending the window is fine', async () => {
  const ensure = createFocusGuard({
    clock: () => 0,
    read: async () => ({}),
    focus: async () => ({
      focused: true,
      title: 'x'
    })
  });

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
