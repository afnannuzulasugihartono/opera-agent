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

const run = promisify(execFile);

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
using System;
using System.Text;
using System.Runtime.InteropServices;
public class OperaWindow {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static string Read() {
    var sb = new StringBuilder();
    sb.AppendLine("FOREGROUND " + TitleOf(GetForegroundWindow()));
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = TitleOf(h);
      if (t.Length > 0) sb.AppendLine((IsIconic(h) ? "MINIMIZED " : "") + t);
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static IntPtr Find(string match, string browser) {
    IntPtr any = IntPtr.Zero;
    IntPtr ours = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = TitleOf(h);
      if (t.Length == 0) return true;
      if (match.Length > 0 && t.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0) return true;
      if (any == IntPtr.Zero) any = h;
      if (browser.Length > 0 && t.IndexOf(browser, StringComparison.OrdinalIgnoreCase) >= 0) {
        ours = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return ours != IntPtr.Zero ? ours : any;
  }
  public static string TitleOf(IntPtr h) {
    var s = new StringBuilder(512);
    GetWindowTextW(h, s, 512);
    return s.ToString();
  }
  public static IntPtr Foreground() { return GetForegroundWindow(); }
  public static void Bring(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }
}
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

async function windows(run_) {
  const read = await run_('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_SCRIPT(null, '')
  ]);
  return readWindows(lines(read.stdout));
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
 * @returns {Promise<object>} the foreground window, the windows behind it, and the minimized ones.
 */

export async function windowState({
  platform = process.platform,
  exec = run
} = {}) {
  try {
    if (platform === 'win32') return await windows(exec);
    if (platform === 'darwin') return await apple(null, exec);
    if (platform === 'linux') return await x11(null, exec);
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
 * @returns {Promise<object>} the title it brought, whether the operating system let it, and the browser it belongs to.
 */

export async function focusWindow(
  match = '',
  {
    platform = process.platform,
    exec = run,
    browser = '',
    ask = true
  } = {}
) {
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
      ? await exec('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        WINDOWS_SCRIPT(wanted, ours, ask)
      ])
      : platform === 'darwin'
        ? await exec('osascript', [
          '-e',
          APPLE_FOCUS(wanted)
        ])
        : platform === 'linux'
          ? await exec('xdotool', [
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
