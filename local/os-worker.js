// @last-edited: 2026-11-01 UTC+7.
// @title: os-worker — one PowerShell process kept alive answers every window read on win32.
// @state: a loopback listener, base64 arguments, one command per request, death is a null answer.
// @dependencies: node:child_process, node:crypto, node:net, ./focus-confirm.js.

// WHY THIS FILE EXISTS Measured live on this machine: one powershell.exe start costs about 0.8 s and compiling the window class with Add-Type another 0.3 s, so every window read paid 1.7 s - and a drive asks the machine on every input step, which is where a 3.6 s click came from.
// A process that stays up answers the same question in about a millisecond, so the class is compiled once and the loop runs for the life of the agent.

// WHY THE ANSWER COMES OVER HTTP AND NOT OVER THE PIPE.
// Measured on this machine: a PowerShell loop that reads commands from stdin answers a ping in 1.1 s, because the console host flushes its pipeline on the way out; the same loop behind a loopback HttpListener answers in 1 ms. So the shell keeps its own listener and the agent talks to it over HTTP, where every request carries its own answer.

// WHY THE LISTENER IS ON THE LOOPBACK AND CARRYING A TOKEN.
// The listener can raise a window, so it answers only to a caller that knows a token that was made for this process; another program on the machine gets nothing.

// WHY THE ARGUMENTS TRAVEL BASE64.
// A window title is attacker-shaped text: a quote in a title would end the string the command is written into and inject PowerShell, and a title with a tab would break the line framing.
// Base64 carries the title as plain payload, and the loop decodes what it wrote itself.

// WHY DEATH IS A NULL AND NOT A THROW.
// The callers keep the one-shot shell as a fallback, so the worker only has to say "I cannot"; a dead process must not take the drive down with it.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

import { NOTICE } from './focus-confirm.js';

const b64 = (text) => Buffer.from(String(text ?? ''), 'utf8').toString('base64');

const freePort = async () => new Promise((
  resolve,
  reject
) => {
  const probe = createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// WHY THE CLASS LIVES HERE AND NOT IN window-focus.
// The one-shot script and the persistent loop need the same P/Invoke declarations, and two copies of a class drift apart; window-focus builds its fallback script from this one string.

export const WINDOW_CLASS = `using System;
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
}`;

// WHY THE FOCUS BRANCH MIRRORS focusBody IN window-focus.
// The persistent loop and the one-shot fallback must answer the same verdict lines (BROUGHT/REFUSED) for the same inputs, or the two paths disagree about the screen.

const WORKER_INIT = (
  port,
  token,
  noticePath
) => `
$ErrorActionPreference = 'Continue'
Add-Type @"
${WINDOW_CLASS}
"@
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://127.0.0.1:${port}/')
$listener.Start()
Write-Output 'READY'
[Console]::Out.Flush()
while ($true) {
  $ctx = $listener.GetContext()
  $query = $ctx.Request.QueryString
  if ($query['t'] -ne '${token}') {
    $ctx.Response.StatusCode = 403
    $ctx.Response.Close()
    continue
  }
  $mode = $query['m']
  $body = ''
  try {
    if ($mode -eq 'read') {
      $body = [OperaWindow]::Read()
    } elseif ($mode -eq 'focus') {
      $match = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($query['a0']))
      $browser = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($query['a1']))
      $ask = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($query['a2'])) -eq '1'
      $h = [OperaWindow]::Find($match, $browser)
      if ($h -ne [IntPtr]::Zero) {
        $t = [OperaWindow]::TitleOf($h)
        $ok = $true
        if ([OperaWindow]::Foreground() -ne $h -and $ask) {
          $answer = ('bring "' + $t + '" forward') | & powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '${String(noticePath).replace(/'/g, "''")}' -TimeoutSec 30
          $ok = ("$answer" -match 'ALLOW')
        }
        if ($ok) {
          [OperaWindow]::Bring($h)
          $body = 'BROUGHT ' + $t
        } else {
          $body = 'REFUSED ' + $t
        }
      }
    } elseif ($mode -eq 'script') {
      # WHY THE SOURCE ARRIVES IN THE BODY AND NOT IN THE QUERY.
      # The dialog script is several kilobytes of PowerShell, and a request line has a length limit; the body has none, so the source travels there and only the arguments travel in the query.
      $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
      $code = $reader.ReadToEnd()
      $reader.Close()
      $one = ''
      $two = ''
      $three = ''
      if ($query['a0']) { $one = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($query['a0'])) }
      if ($query['a1']) { $two = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($query['a1'])) }
      if ($query['a2']) { $three = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($query['a2'])) }
      $block = [ScriptBlock]::Create($code)
      $out = & $block $one $two $three
      $body = (($out | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
    }
  } catch {
    $body = 'ERROR ' + $_.Exception.Message
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $response = $ctx.Response
  $response.ContentType = 'text/plain; charset=utf-8'
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}
`;

/**
 * Keep one operating-system shell alive and answer window commands over its own loopback listener.
 * @param {object} [options] - the command, the spawn and fetch to use, and the timeouts.
 * @param {string} [options.command] - the shell to start.
 * @param {Function} [options.spawn] - the process spawner, injected for tests.
 * @param {Function} [options.fetch] - the request maker, injected for tests.
 * @param {number} [options.port] - the loopback port to listen on; one is picked when it is absent.
 * @param {string} [options.token] - the secret every request carries.
 * @param {number} [options.readyTimeoutMs] - how long to wait for the shell to say it is listening.
 * @param {number} [options.commandTimeoutMs] - how long one command may take; the focus panel can hold 30 s.
 * @returns {object} the worker: ask(mode, args) resolves the answer text, or null when the worker cannot answer.
 */

export function createOsWorker({
  command = 'powershell',
  spawn: spawnFn = spawn,
  fetch: fetchFn = fetch,
  port = null,
  token = randomUUID(),
  readyTimeoutMs = 20000,
  commandTimeoutMs = 45000
} = {}) {
  let child = null;
  let chosen = port;
  let down = false;
  let ready = false;

  // WHY THE DEAD SHELL IS KILLED AND NOT JUST FORGOTTEN.
  // A shell that stopped answering still holds a loopback listener and a compiled window class, so the worker that gives up on it takes the process with it.
  // A process that is already gone needs no kill, and a kill that fails says so instead of taking the worker down with it.

  const onDead = () => {
    down = true;
    ready = false;
    const running = child;
    child = null;
    try {
      running?.kill();
    } catch {}
  };

  const waitReady = (target) => new Promise((resolve) => {
    let seen = '';
    const timer = setTimeout(() => {
      target.stdout?.off('data', onData);
      resolve(false);
    }, readyTimeoutMs);
    const onData = (chunk) => {
      seen += String(chunk);
      if (seen.includes('READY')) {
        clearTimeout(timer);
        target.stdout?.off('data', onData);
        resolve(true);
      }
    };
    target.stdout?.on('data', onData);
  });

  // WHY THE SHELL DOES NOT HOLD THE PROCESS OPEN.
  // The agent must be able to end while the shell is still up, so the shell is let go of here and killed by the exit hook when the process really ends.

  const start = async () => {
    if (down) return false;
    if (child && ready) return true;
    if (chosen === null) {
      chosen = await freePort().catch(() => null);
      if (chosen === null) {
        down = true;
        return false;
      }
    }
    const script = WORKER_INIT(chosen, token, NOTICE);
    try {
      child = spawnFn(command, [
        '-NoProfile',
        '-NonInteractive',
        '-NoLogo',
        '-Command',
        script
      ], { stdio: [
        'ignore',
        'pipe',
        'pipe'
      ] });
    } catch {
      onDead();
      return false;
    }
    child.on('error', onDead);
    child.on('exit', onDead);
    child.unref?.();
    child.stdout?.unref?.();
    child.stderr?.unref?.();
    process.once('exit', () => {
      try {
        child?.kill();
      } catch {}
    });
    const listening = await waitReady(child);
    if (!listening) {
      onDead();
      return false;
    }
    ready = true;
    return true;
  };

  // WHY A SCRIPT REQUEST CARRIES ITS SOURCE IN THE BODY.
  // The source is kilobytes of PowerShell and a request line has a length limit, so the source travels in the body and only the small arguments travel in the query.

  const ask = async (
    mode,
    args = []
  ) => {
    if (!(await start())) return null;
    const query = new URLSearchParams({
      t: token,
      m: mode
    });
    const source = mode === 'script' ? String(args[0] ?? '') : null;
    const rest = source === null ? args : args.slice(1);
    rest.forEach((
      value,
      index
    ) => query.set(`a${index}`, b64(value)));
    try {
      const response = await fetchFn(`http://127.0.0.1:${chosen}/?${query.toString()}`, {
        method: source === null ? 'GET' : 'POST',
        body: source,
        signal: AbortSignal.timeout(commandTimeoutMs)
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      onDead();
      return null;
    }
  };

  const close = () => {
    onDead();
  };

  return {
    ask,
    close
  };
}

// WHY ONE WORKER FOR THE WHOLE PROCESS.
// The window reads and the dialog reads are the same question asked of the same machine, and two shells would mean two slow starts and two compiled window classes; the first caller pays the start and the rest get milliseconds.

let shared = null;

/**
 * The one operating-system shell this process keeps alive, started on the first question.
 * @param {string} [platform] - the platform to answer for; only Windows has one.
 * @returns {object|null} the worker, or null on a platform with no such shell.
 */

export const sharedOsWorker = (platform = process.platform) => {
  if (platform !== 'win32') return null;
  if (shared === null) shared = createOsWorker({});
  return shared;
};
