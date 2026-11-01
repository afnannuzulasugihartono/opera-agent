// @last-edited: 2026-11-01 UTC+7.
// @title: window-focus \u2014 whether the browser window is in front, and how to put it there.
// @state: one read from the operating system, one write, honest answers on every platform.
// @dependencies: node:child_process, node:util, ./focus-confirm.js.

// WHY THIS FILE EXISTS

// Measured live on this machine, with the drive typing into a Google Docs document: a browser window that is behind another application still takes the keys, and a browser window that has been minimized does not - text typed after it came back went nowhere.
// So the operating system is asked about the window, and the agent is told which of those two situations it is in before it wonders.

// WHY FOCUSING ONE WINDOW AND NOT ALL OF THEM.
// The machine had two browser windows open, and a script that walked every one of them ended with the wrong window in front \u2014 which looks exactly like nothing working at all.
// So the call takes the piece of the title to bring forward, and answers with the title it actually brought, so a drive can tell whether it got what it asked for.

// WHY THE ANSWER CARRIES WHY.
// A call that cannot focus a window on this machine says so in words.
// Returning a bare false would leave the agent guessing between "the window is behind something" and "this platform is not supported here".

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { NOTICE } from './focus-confirm.js';
import {
  WINDOW_CLASS,
  sharedOsWorker
} from './os-worker.js';

const run = promisify(execFile);

// WHY THE WORKER IS THE SHARED ONE.
// The window reads and the dialog reads ask the same machine the same way, so they share one shell: the first caller pays the slow start and every later one answers in milliseconds.

// WHY THE TITLES COME BACK AS LINES.
// Every one of these three tools answers with plain text on stdout, and a window title is one line; a title with a newline in it is not a thing a window manager shows.

const lines = (text) => String(text ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

// WHY A NO-OP ALT GOES OUT BEFORE THE WINDOW IS BROUGHT FORWARD.
// Windows refuses a foreground change while another application is taking input, and a drive that only calls SetForegroundWindow loses every time the user is typing somewhere else — measured live on this machine, with a typing app in another browser in front: the window came forward and the answer said it had.
// The operating system's own documented way round that is a no-op ALT, which makes the calling process eligible to come forward; it presses nothing and types nothing.
// With it, focus_window answered focused true while the typing app was still running.

// WHY THE BROWSER TRAVELS WITH THE TITLE.
// The extension may be talking to any browser on any machine, and two of them can hold the same page title.
// The window of the browser being driven is the one that should come forward, so the browser goes into the machine with the title and the window that carries it wins.
// A window with no browser in its title is still brought forward when no other window carries the browser, because a title that matches is better than no window at all.

// WHY ONLY A MINIMIZED WINDOW IS RESTORED.
// Measured live on this machine: bringing a maximized browser window forward restored it to its smaller plain size, and the page the person was reading shrank under them without being asked.
// A window that is not minimized already has a size the person chose, so its size is left alone and only the window that cannot take a click at all is restored.

// WHY THE PERSON IS ASKED BEFORE THE SCREEN IS TAKEN FROM THEM.
// The person may have moved on to another tab, another browser or another program while the drive was working, and bringing a window forward under their hands takes that away without asking.
// So the question is asked in the window they are in, and only an answer of yes lets the focus move.

const focusBody = (
  match,
  browser,
  ask
) => `
$h = [OperaWindow]::Find('${match.replace(/'/g, "''")}', '${String(browser ?? '').replace(/'/g, "''")}')
if ($h -ne [IntPtr]::Zero) {
  $t = [OperaWindow]::TitleOf($h)
  $ok = $true
  if ([OperaWindow]::Foreground() -ne $h -and ${ask ? '$true' : '$false'}) {
    $answer = ('bring "' + $t + '" forward') | & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '${NOTICE.replace(/'/g, "''")}' -TimeoutSec 30
    $ok = ("$answer" -match 'ALLOW')
  }
  if ($ok) {
    [OperaWindow]::Bring($h)
    Write-Output ('BROUGHT ' + $t)
  } else {
    Write-Output ('REFUSED ' + $t)
  }
}
`;

const WINDOWS_SCRIPT = (
  match,
  browser,
  ask = true
) => `
$ErrorActionPreference = 'Stop'
Add-Type @"
${WINDOW_CLASS}
"@
${match === null ? '[OperaWindow]::Read()' : focusBody(match, browser, ask)}`;

const APPLE_READ = 'tell application "System Events" to get name of every process whose frontmost is true';
const APPLE_FOCUS = (match) => [
  'tell application "System Events"',
  'set names to name of every process whose visible is true',
  `set target to first item of (every process whose name contains "${match.replace(/"/g, '\\"')}")`,
  'set frontmost of target to true',
  'return name of target',
  'end tell'
].join('\n');

// WHY THE REFUSAL HAS THE SAME SHAPE AS THE ANSWER.
// Measured on CI: a Linux runner took the refusal path and the answer came back without a `title` at all, because the refusal never had one - so a caller that reads the title of a refusal finds nothing where a caller on Windows finds an empty string.
// A shape that depends on the platform is a shape a caller has to guess.

const unsupported = (
  platform,
  why,
  browser = ''
) => ({
  platform,
  match: '',
  browser,
  foreground: '',
  windows: [],
  minimized: [],
  focused: false,
  title: '',
  why
});

const readWindows = (all) => {
  const rest = [...all];
  const foreground = (rest.shift() ?? '').replace(/^FOREGROUND\s*/, '');
  const minimized = rest.filter((line) => line.startsWith('MINIMIZED ')).map((line) => line.slice('MINIMIZED '.length));
  return {
    platform: 'win32',
    foreground,
    windows: rest.filter((line) => !line.startsWith('MINIMIZED ')),
    minimized
  };
};

// WHY THE WORKER GOES FIRST AND THE ONE-SHOT SHELL STAYS.
// The persistent process answers in milliseconds after one slow start; if it dies, the one-shot script still answers, so a dead worker never costs a read.

// WHY THE WORKER ONLY RUNS FOR THE DEFAULT RUNNER.
// A caller that hands in its own runner wants that runner used, so an injected runner means the one-shot path alone; the check is on the option rather than on the runner's identity, because Node hands out the same promisified execFile to everyone who asks for it.

async function windows(
  run_,
  platform = 'win32',
  injected = true
) {
  const fast = injected ? null : await sharedOsWorker(platform)?.ask('read').catch(() => null);
  if (typeof fast === 'string') return readWindows(lines(fast));
  const read = await run_('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_SCRIPT(null, '')
  ]);
  return readWindows(lines(read.stdout));
}

async function win32Focus(
  wanted,
  ours,
  ask,
  run_,
  injected = true
) {
  const fast = injected
    ? null
    : await sharedOsWorker('win32')?.ask('focus', [
      wanted,
      ours,
      ask ? '1' : '0'
    ]).catch(() => null);
  if (typeof fast === 'string') return { stdout: fast };
  return run_('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_SCRIPT(wanted, ours, ask)
  ]);
}

async function apple(
  match,
  run_
) {
  const read = await run_('osascript', [
    '-e',
    APPLE_READ
  ]);
  const foreground = lines(read.stdout)[0] ?? '';
  if (match === null) return {
    platform: 'darwin',
    foreground,
    windows: [],
    minimized: []
  };
  const out = await run_('osascript', [
    '-e',
    APPLE_FOCUS(match)
  ]);
  return {
    platform: 'darwin',
    foreground: lines(out.stdout)[0] ?? '',
    windows: [],
    minimized: []
  };
}

async function x11(
  match,
  run_
) {
  const active = await run_('xdotool', [
    'getactivewindow',
    'getwindowname'
  ]);
  const foreground = lines(active.stdout)[0] ?? '';
  if (match === null) return {
    platform: 'linux',
    foreground,
    windows: [],
    minimized: []
  };
  const out = await run_('xdotool', [
    'search',
    '--name',
    match,
    'windowactivate',
    '--sync'
  ]);
  return {
    platform: 'linux',
    foreground: lines(out.stdout)[0] ?? foreground,
    windows: [],
    minimized: []
  };
}

// WHY THE READ ANSWERS INSTEAD OF GUESSING.
// windowFocused is the difference between "the page ignored my click" and "the page was never in front"; an agent that is told which one it was can act, and one that is told neither spends the drive re-clicking a page that was never listening.

/**
 * Read what the operating system says about the windows on this machine.
 * @param {object} [options] - the platform to read, and the command runner to read it with.
 * @param {string} [options.platform] - the platform whose windows are read.
 * @param {Function} [options.exec] - the runner to use; a runner of your own means the one-shot path, never the shell that stays up.
 * @returns {Promise<object>} the foreground window, the windows behind it, and the minimized ones.
 */

export async function windowState({
  platform = process.platform,
  exec = null
} = {}) {
  const runner = exec ?? run;
  try {
    if (platform === 'win32') return await windows(runner, platform, exec !== null);
    if (platform === 'darwin') return await apple(null, runner);
    if (platform === 'linux') return await x11(null, runner);
    return unsupported(platform, `window focus is not implemented on ${platform}`);
  } catch (error) {
    return unsupported(platform, String(error?.message ?? error).split('\n')[0]);
  }
}

// WHY THE FOCUS ANSWER NAMES THE WINDOW IT BROUGHT.
// Windows can refuse to come forward \u2014 the operating system says no \u2014 and a drive that cannot tell refusal from success will go on driving a page that is still behind a spreadsheet.

/**
 * Bring one browser window to the front of the machine.
 * @param {string} [match] - the piece of the window title to bring forward.
 * @param {object} [options] - the platform, the command runner, the browser whose window wins when two hold the same title, and whether the person is asked first.
 * @param {string} [options.platform] - the platform whose windows are moved.
 * @param {Function} [options.exec] - the runner to use; a runner of your own means the one-shot path, never the shell that stays up.
 * @param {string} [options.browser] - the browser whose window wins when two hold the same title.
 * @param {boolean} [options.ask] - whether the person is asked before the screen is taken.
 * @returns {Promise<object>} the title it brought, whether the operating system let it, and the browser it belongs to.
 */

export async function focusWindow(
  match = '',
  {
    platform = process.platform,
    exec = null,
    browser = '',
    ask = true
  } = {}
) {
  const runner = exec ?? run;
  const wanted = String(match ?? '').trim();
  const ours = String(browser ?? '').trim();
  if (wanted === '') {
    const state = await windowState({
      platform,
      exec
    });
    return {
      platform: state.platform ?? platform,
      match: '',
      browser: ours,
      focused: false,
      title: '',
      foreground: state.foreground ?? '',
      windows: state.windows ?? [],
      minimized: state.minimized ?? [],
      why: 'no match given; pass a piece of the window title to bring forward (e.g. "Google Chrome", "Google Docs")'
    };
  }
  try {
    const out = platform === 'win32'
      ? await win32Focus(wanted, ours, ask, runner, exec !== null)
      : platform === 'darwin'
        ? await runner('osascript', [
          '-e',
          APPLE_FOCUS(wanted)
        ])
        : platform === 'linux'
          ? await runner('xdotool', [
            'search',
            '--name',
            wanted,
            'windowactivate',
            '--sync'
          ])
          : null;
    if (out === null) return unsupported(platform, `window focus is not implemented on ${platform}`, ours);
    const all = lines(out.stdout);
    const brought = all.filter((line) => line.startsWith('BROUGHT ')).map((line) => line.slice('BROUGHT '.length));
    const refused = all.filter((line) => line.startsWith('REFUSED ')).map((line) => line.slice('REFUSED '.length));

    // WHY THE TWO VERDICT LINES ARE TAKEN OUT BEFORE THE MACHINE IS READ.
    // The window list is read as lines after the first one, so a verdict left in it would be read as the window in front.

    const state = all.filter((line) => !line.startsWith('BROUGHT ') && !line.startsWith('REFUSED '));
    const title = brought[brought.length - 1] ?? '';
    const after = state.length ? readWindows(state) : await windowState({
      platform,
      exec
    });
    const focused = Boolean(title) && after.foreground.toLowerCase().includes(title.toLowerCase().slice(0, 24));
    return {
      platform,
      match: wanted,
      browser: ours,
      focused,
      title,
      foreground: after.foreground,
      windows: after.windows,
      minimized: after.minimized,
      why: focused
        ? ''
        : refused.length
          ? `the person did not allow ${JSON.stringify(refused[refused.length - 1])} to come forward; the screen stayed on ${JSON.stringify(after.foreground)}`
          : title
            ? `the machine brought ${JSON.stringify(title)} forward and then left ${JSON.stringify(after.foreground)} in front of it — something is taking the focus back`
            : `no window on this machine has ${JSON.stringify(wanted)} in its title`
    };
  } catch (error) {
    return unsupported(platform, String(error?.message ?? error).split('\n')[0], ours);
  }
}
