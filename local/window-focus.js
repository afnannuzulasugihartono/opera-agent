// @last-edited: 2026-10-15 UTC+7.
// @title: window-focus \u2014 whether the browser window is in front, and how to put it there.
// @state: one read from the operating system, one write, honest answers on every platform.
// @dependencies: node:child_process, node:util.

// WHY THIS FILE EXISTS
//
// Measured live, repeatedly, on this product's own author: with the browser window
// behind another window, clicking and typing go nowhere. Google Docs took the keys
// and dropped them, the caret never appeared, and every drill failed in a way that
// looked like a bug in the page. It is not the page: a page cannot tell whether the
// window in front of it is the one the operating system has in front. So the driver
// asks the operating system, and the agent is told the truth before it wonders.
//
// WHY FOCUSING ONE WINDOW AND NOT ALL OF THEM. The machine had two browser windows
// open, and a script that walked every one of them ended with the wrong window in
// front \u2014 which looks exactly like nothing working at all. So the call takes the
// piece of the title to bring forward, and answers with the title it actually
// brought, so a drive can tell whether it got what it asked for.
//
// WHY THE ANSWER CARRIES WHY. A call that cannot focus a window on this machine says
// so in words. Returning a bare false would leave the agent guessing between "the
// window is behind something" and "this platform is not supported here".

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// WHY THE TITLES COME BACK AS LINES. Every one of these three tools answers with
// plain text on stdout, and a window title is one line; a title with a newline in it
// is not a thing a window manager shows.

const lines = (text) => String(text ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const WINDOWS_SCRIPT = (match) => `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class OperaWindow {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  public static string Read() {
    var sb = new StringBuilder();
    sb.AppendLine("FOREGROUND " + Title(GetForegroundWindow()));
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = Title(h);
      if (t.Length > 0) sb.AppendLine(t);
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static string Focus(string match) {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = Title(h);
      if (t.Length == 0) return true;
      if (match.Length > 0 && t.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0) return true;
      ShowWindow(h, 9);
      SetForegroundWindow(h);
      sb.AppendLine(t);
      return false;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  static string Title(IntPtr h) {
    var s = new StringBuilder(512);
    GetWindowTextW(h, s, 512);
    return s.ToString();
  }
}
"@
[OperaWindow]::${match === null ? 'Read()' : `Focus('${match.replace(/'/g, "''")}')`}`;

const APPLE_READ = 'tell application "System Events" to get name of every process whose frontmost is true';
const APPLE_FOCUS = (match) => [
  'tell application "System Events"',
  'set names to name of every process whose visible is true',
  `set target to first item of (every process whose name contains "${match.replace(/"/g, '\\"')}")`,
  'set frontmost of target to true',
  'return name of target',
  'end tell'
].join('\n');

const unsupported = (platform, why) => ({ platform, foreground: '', windows: [], focused: false, why });

async function windows(run_) {
  const read = await run_('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT(null)]);
  const all = lines(read.stdout);
  const foreground = (all.shift() ?? '').replace(/^FOREGROUND\s*/, '');
  return { platform: 'win32', foreground, windows: all };
}

async function apple(match, run_) {
  const read = await run_('osascript', ['-e', APPLE_READ]);
  const foreground = lines(read.stdout)[0] ?? '';
  if (match === null) return { platform: 'darwin', foreground, windows: [] };
  const out = await run_('osascript', ['-e', APPLE_FOCUS(match)]);
  return { platform: 'darwin', foreground: lines(out.stdout)[0] ?? '', windows: [] };
}

async function x11(match, run_) {
  const active = await run_('xdotool', ['getactivewindow', 'getwindowname']);
  const foreground = lines(active.stdout)[0] ?? '';
  if (match === null) return { platform: 'linux', foreground, windows: [] };
  const out = await run_('xdotool', ['search', '--name', match, 'windowactivate', '--sync']);
  return { platform: 'linux', foreground: lines(out.stdout)[0] ?? foreground, windows: [] };
}

// WHY THE READ ANSWERS INSTEAD OF GUESSING. windowFocused is the difference between
// "the page ignored my click" and "the page was never in front"; an agent that is
// told which one it was can act, and one that is told neither spends the drive
// re-clicking a page that was never listening.

export async function windowState({ platform = process.platform, exec = run } = {}) {
  try {
    if (platform === 'win32') return await windows(exec);
    if (platform === 'darwin') return await apple(null, exec);
    if (platform === 'linux') return await x11(null, exec);
    return unsupported(platform, `window focus is not implemented on ${platform}`);
  } catch (error) {
    return unsupported(platform, String(error?.message ?? error).split('\n')[0]);
  }
}

// WHY THE FOCUS ANSWER NAMES THE WINDOW IT BROUGHT. Windows can refuse to come
// forward \u2014 the operating system says no \u2014 and a drive that cannot tell refusal
// from success will go on driving a page that is still behind a spreadsheet.

export async function focusWindow(match = '', { platform = process.platform, exec = run } = {}) {
  const wanted = String(match ?? '').trim();
  try {
    const out = platform === 'win32'
      ? await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT(wanted)])
      : platform === 'darwin'
        ? await exec('osascript', ['-e', APPLE_FOCUS(wanted)])
        : platform === 'linux'
          ? await exec('xdotool', ['search', '--name', wanted, 'windowactivate', '--sync'])
          : null;
    if (out === null) return unsupported(platform, `window focus is not implemented on ${platform}`);
    const titles = lines(out.stdout);
    const after = await windowState({ platform, exec });
    const title = titles[titles.length - 1] ?? '';
    return {
      platform,
      match: wanted,
      focused: Boolean(title) && after.foreground.toLowerCase().includes(title.toLowerCase().slice(0, 24)),
      title,
      foreground: after.foreground,
      windows: after.windows,
      why: title ? '' : `no window on this machine has ${JSON.stringify(wanted)} in its title`
    };
  } catch (error) {
    return unsupported(platform, String(error?.message ?? error).split('\n')[0]);
  }
}