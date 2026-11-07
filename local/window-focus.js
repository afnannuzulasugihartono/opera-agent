// @last-edited: 2026-10-25 UTC+7.
// @title: window-focus \u2014 whether the browser window is in front, and how to put it there.
// @state: one read from the operating system, one write, honest answers on every platform.
// @dependencies: node:child_process, node:util.

// WHY THIS FILE EXISTS

// Measured live on this machine, with the drive typing into a Google Docs document: a browser window that is behind another application still takes the keys, and a browser window that has been minimized does not - text typed after it came back went nowhere.
// So the operating system is asked about the window, and the agent is told which of those two situations it is in before it wonders.

// WHY FOCUSING ONE WINDOW AND NOT ALL OF THEM.
// The machine had two browser windows open, and a script that walked every one of them ended with the wrong window in front \u2014 which looks exactly like nothing working at all.
// So the call takes the piece of the title to bring forward, and answers with the title it actually brought, so a drive can tell whether it got what it asked for.

// WHY THE ANSWER CARRIES WHY.
// A call that cannot focus a window on this machine says so in words.
// Returning a bare false would leave the agent guessing between "the window is behind something" and "this platform is not supported here".

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

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

const WINDOWS_CLASS = `using System;
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
    sb.AppendLine("FOREGROUND " + Title(GetForegroundWindow()));
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = Title(h);
      if (t.Length > 0) sb.AppendLine((IsIconic(h) ? "MINIMIZED " : "") + t);
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
      keybd_event(0x12, 0, 0, UIntPtr.Zero);
      keybd_event(0x12, 0, 2, UIntPtr.Zero);
      SetForegroundWindow(h);
      sb.AppendLine("BROUGHT " + t);
      return false;
    }, IntPtr.Zero);
    sb.AppendLine(Read());
    return sb.ToString();
  }
  static string Title(IntPtr h) {
    var s = new StringBuilder(512);
    GetWindowTextW(h, s, 512);
    return s.ToString();
  }
}`;

// WHY THE CLASS IS ITS OWN PIECE.
// The warm shell below compiles it once and keeps the shell, so the fast path and the one-shot path can never drift apart.

const WINDOWS_SCRIPT = (match) => `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
${WINDOWS_CLASS}
"@
[OperaWindow]::${match === null ? 'Read()' : `Focus('${match.replace(/'/g, "''")}')`}`;

// WHY THE SHELL IS KEPT ALIVE INSTEAD OF STARTED AGAIN.
// Measured on this machine: every read compiled this C# class into a fresh PowerShell, and the compile was the whole cost - 1,096 to 1,376 ms a read, paid on every input action whose page sat behind another window.
// So one shell starts, compiles once, and then answers a line at a time: the same read, a few milliseconds.
// The one-shot script above stays the fallback, because a shell that dies must not take the guard with it.

const READER_END = '###opera-window-end###';
const READER_TIMEOUT_MS = 4000;

const WINDOWS_READER_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
${WINDOWS_CLASS}
"@
$out = [Console]::Out
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line.Length -eq 0) { continue }
  $verb = $line.Substring(0, 1)
  $arg = $line.Substring(1)
  $answer = if ($verb -eq 'F') { [OperaWindow]::Focus($arg) } else { [OperaWindow]::Read() }
  $out.Write($answer)
  $out.Write('${READER_END}')
  $out.Flush()
}`;

let reader = null;

// WHY THE READER IS ONE PROCESS AND NOT A POOL.
// Two shells would each hold their own copy of the window list and could answer with different truths, and the guard's answer has to be the one the machine gives right now.

// WHY EVERY SHELL IS KILLED WHEN THE DRIVER GOES.
// The reader outlives the call that started it on purpose, so the process that owns it has to say goodbye to it.

const shells = new Set();

process.once('exit', () => {
  for (const shell of shells) {
    try { shell.kill(); } catch { }
  }
});

function warmReader() {
  if (reader) return reader;
  const child = spawn('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(WINDOWS_READER_SCRIPT, 'utf16le').toString('base64')
  ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  shells.add(child);
  const waiting = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const at = buffer.indexOf(READER_END);
      if (at === -1) break;
      const part = buffer.slice(0, at);
      buffer = buffer.slice(at + READER_END.length);
      waiting.shift()?.(part);
    }
  });

  // WHY A READER THAT STOPS ANSWERING IS DROPPED AND NOT WAITED FOR.
  // A shell that dies mid-answer leaves a waiter behind, and the next answer would land on it.
  // So a timeout takes the waiter out, kills the shell, and lets the next call start a fresh one.

  const drop = () => {
    if (reader?.child === child) reader = null;
    shells.delete(child);
    try { child.kill(); } catch { }
  };
  child.on('exit', () => {
    shells.delete(child);
    if (reader?.child === child) reader = null;
  });
  child.on('error', drop);
  child.unref();
  child.stdout.unref();
  child.stdin.unref();
  reader = {
    child,
    ask: (verb, arg = '') => new Promise((resolve, reject) => {
      const waiter = (part) => { clearTimeout(timer); resolve(part); };
      const timer = setTimeout(() => {
        const at = waiting.indexOf(waiter);
        if (at !== -1) waiting.splice(at, 1);
        drop();
        reject(new Error('the window reader did not answer'));
      }, READER_TIMEOUT_MS);
      waiting.push(waiter);
      child.stdin.write(`${verb}${arg}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        drop();
        reject(error);
      });
    })
  };
  return reader;
}

// WHY THE READER STARTS WITH THE PROCESS AND NOT WITH THE FIRST READ.
// The first read would otherwise pay the compile - about a second on this machine - and that read is the one an agent waits on when it sends its first keystroke.
// So the shell starts in the background when this module loads, and the compile is done long before the first action needs an answer.

if (process.platform === 'win32') warmReader();

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

const unsupported = (platform, why) => ({
  platform,
  match: '',
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

// WHY THE WARM READER IS ASKED FIRST AND THE ONE-SHOT IS THE FALLBACK.
// The warm shell answers in milliseconds because it compiled the class once; the one-shot answers in about a second because it compiles every time.
// A shell that cannot start must not take the guard with it, so the one-shot stays.

async function windowsAsk(verb, match, run_) {
  if (run_ === run) {
    const warm = await warmReader().ask(verb, match ?? '').catch(() => null);
    if (warm !== null) return warm;
  }
  const read = await run_('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_SCRIPT(verb === 'F' ? match : null)
  ]);
  return read.stdout;
}

async function windows(run_) {
  return readWindows(lines(await windowsAsk('R', '', run_)));
}

async function apple(match, run_) {
  const read = await run_('osascript', ['-e', APPLE_READ]);
  const foreground = lines(read.stdout)[0] ?? '';
  if (match === null) return { platform: 'darwin', foreground, windows: [], minimized: [] };
  const out = await run_('osascript', ['-e', APPLE_FOCUS(match)]);
  return { platform: 'darwin', foreground: lines(out.stdout)[0] ?? '', windows: [], minimized: [] };
}

async function x11(match, run_) {
  const active = await run_('xdotool', ['getactivewindow', 'getwindowname']);
  const foreground = lines(active.stdout)[0] ?? '';
  if (match === null) return { platform: 'linux', foreground, windows: [], minimized: [] };
  const out = await run_('xdotool', ['search', '--name', match, 'windowactivate', '--sync']);
  return { platform: 'linux', foreground: lines(out.stdout)[0] ?? foreground, windows: [], minimized: [] };
}

// WHY THE READ ANSWERS INSTEAD OF GUESSING.
// windowFocused is the difference between "the page ignored my click" and "the page was never in front"; an agent that is told which one it was can act, and one that is told neither spends the drive re-clicking a page that was never listening.

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

// WHY THE FOCUS ANSWER NAMES THE WINDOW IT BROUGHT.
// Windows can refuse to come forward \u2014 the operating system says no \u2014 and a drive that cannot tell refusal from success will go on driving a page that is still behind a spreadsheet.

export async function focusWindow(match = '', { platform = process.platform, exec = run } = {}) {
  const wanted = String(match ?? '').trim();
  if (wanted === '') {
    const state = await windowState({ platform, exec });
    return {
      platform: state.platform ?? platform,
      match: '',
      focused: false,
      title: '',
      foreground: state.foreground ?? '',
      windows: state.windows ?? [],
      minimized: state.minimized ?? [],
      why: 'no match given; pass a piece of the window title to bring forward (e.g. "Google Chrome", "Google Docs")'
    };
  }
  try {
    const text = platform === 'win32'
      ? await windowsAsk('F', wanted, exec)
      : platform === 'darwin'
        ? (await exec('osascript', ['-e', APPLE_FOCUS(wanted)])).stdout
        : platform === 'linux'
          ? (await exec('xdotool', ['search', '--name', wanted, 'windowactivate', '--sync'])).stdout
          : null;
    if (text === null) return unsupported(platform, `window focus is not implemented on ${platform}`);
    const all = lines(text);
    const brought = all.filter((line) => line.startsWith('BROUGHT ')).map((line) => line.slice('BROUGHT '.length));
    const title = brought[brought.length - 1] ?? '';
    const after = all.length ? readWindows(all) : await windowState({ platform, exec });
    const focused = Boolean(title) && after.foreground.toLowerCase().includes(title.toLowerCase().slice(0, 24));
    return {
      platform,
      match: wanted,
      focused,
      title,
      foreground: after.foreground,
      windows: after.windows,
      minimized: after.minimized,
      why: focused
        ? ''
        : title
          ? `the machine brought ${JSON.stringify(title)} forward and then left ${JSON.stringify(after.foreground)} in front of it — something is taking the focus back`
          : `no window on this machine has ${JSON.stringify(wanted)} in its title`
    };
  } catch (error) {
    return unsupported(platform, String(error?.message ?? error).split('\n')[0]);
  }
}