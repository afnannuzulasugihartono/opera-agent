// @last-edited: 2026-10-15 UTC+7.
// @title: dialog — read and drive the operating system's own dialogs.
// @state: three calls, Windows today, honest refusals everywhere else.
// @dependencies: node:child_process, node:util.

// WHY THIS FILE EXISTS

// Measured live on this product's own author: a drive inserted an image into Google Docs with a drop, and a drive that clicked "Upload from computer" opened the operating system's own file dialog - a window nothing inside the browser can reach, type into, or close again.
// The guide has said so for weeks, and it is true, and it was also the wrong conclusion: the agent is not in the cloud.
// It runs on the machine, in the user's own session, and a file dialog there is an ordinary window.
// So the road is closed, and this file is the road.

// WHY IT IS THREE NAMED CALLS AND NOT A FLAG ON THE OTHERS.
// Driving an operating system dialog is the first thing this product does outside the browser, so it is visible by name: an agent that types a path into a file picker has done something a browser sandbox cannot, and a caller reading the catalogue can see that before it happens rather than after.

// WHY EVERY CALL SAYS WHAT IT FOUND.
// A dialog belongs to no tab, has no tab id, and does not survive being looked at twice: reading it, typing into it, pressing its button are three separate turns, and the answer to each one is the only thing that tells the agent what to do next.
// So each answers with what was on the screen
// - title, controls, the text in the field - and a refusal says why instead of returning false.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { sharedOsWorker } from './os-worker.js';

const run = promisify(execFile);

// WHY ONE SCRIPT WITH A MODE.
// Three scripts would mean three copies of the same window-walking code, and the copies would drift the way copies do.
// The mode is data; the walk is written once.

// WHY A DIALOG FIELD IS READ WITH WM_GETTEXT AND NOT GetWindowText.
// Typed into a live file dialog and read back empty the first time, which reads exactly like a field that never took the text - and the write had gone through.
// GetWindowText on another process's edit returns the cached caption, which for an edit is nothing; WM_GETTEXT with a marshalled buffer is the message that carries text across a process boundary, so that is the one used, and it is what makes the answer worth reading.

const SCRIPT = `
$ErrorActionPreference = 'Stop'
# WHY THE CLASS IS COMPILED ONCE PER MACHINE AND NOT ONCE PER CALL.
# The same shell answers every dialog question, and a type that is already loaded cannot be loaded again, so the walk asks for the class only when it is missing.
if (-not ('OperaDialog' -as [type])) {
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class OperaDialog {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] public static extern IntPtr SendText(IntPtr h, uint m, IntPtr w, StringBuilder l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="PostMessageW")] public static extern bool Post(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  const uint WM_GETTEXT = 0x000D;
  const uint WM_SETTEXT = 0x000C;
  const uint BM_CLICK = 0x00F5;
  const uint SMTO_ABORTIFHUNG = 0x0002;

  public static string ClassOf(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }
  public static string TitleOf(IntPtr h) { var s = new StringBuilder(512); GetWindowTextW(h, s, 512); return s.ToString(); }
  public static string Read(IntPtr h) {
    IntPtr r;
    var buf = new StringBuilder(1024);
    var size = SendText(h, WM_GETTEXT, (IntPtr)1024, buf, SMTO_ABORTIFHUNG, 1000, out r);
    return size == IntPtr.Zero ? "" : buf.ToString();
  }
  public static bool Write(IntPtr h, string text) {
    IntPtr r;
    return SendText(h, WM_SETTEXT, IntPtr.Zero, new StringBuilder(text), SMTO_ABORTIFHUNG, 1000, out r) != IntPtr.Zero;
  }
  public static bool Visible(IntPtr h) {
    if (!IsWindowVisible(h)) return false;
    RECT r; if (!GetWindowRect(h, out r)) return false;
    return r.Right > r.Left && r.Bottom > r.Top;
  }
}
"@
}

function Get-OperaDialog {
  $front = [OperaDialog]::GetForegroundWindow()
  if ([OperaDialog]::Visible($front) -and [OperaDialog]::ClassOf($front) -eq '#32770') { return $front }
  # WHY THE COUNT IS SCRIPT-WIDE: the callback runs in script scope, so a function-local variable it writes is a different one and the search answers none.
  $script:found = [IntPtr]::Zero
  $cb = [OperaDialog+EnumProc]{
    param($h, $l)
    if ([OperaDialog]::Visible($h) -and [OperaDialog]::ClassOf($h) -eq '#32770') { $script:found = $h; return $false }
    return $true
  }
  [void][OperaDialog]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:found
}

function Get-OperaChildren($parent) {
  $kids = New-Object System.Collections.ArrayList
  $cb = [OperaDialog+EnumProc]{
    param($h, $l)
    [void]$kids.Add($h)
    return $true
  }
  [void][OperaDialog]::EnumChildWindows($parent, $cb, [IntPtr]::Zero)
  return $kids
}

$mode = $args[0]
$text = if ($args.Length -gt 1) { $args[1] } else { '' }
$name = if ($args.Length -gt 2) { $args[2] } else { '' }

$dlg = Get-OperaDialog
# WHY THE MODES ARE ONE BRANCH AND NOT A SCRIPT THAT EXITS.
# The same shell answers every dialog question, and a script that ends the process would end that shell with it; so one branch runs, prints one answer, and the shell lives on.
if ($dlg -eq [IntPtr]::Zero) {
  ConvertTo-Json @{ open = $false; platform = 'win32'; why = 'no dialog is open on this machine' } -Compress
} else {
  $children = Get-OperaChildren $dlg
  $controls = @()
  foreach ($child in $children) {
    $cls = [OperaDialog]::ClassOf($child)
    if (-not [OperaDialog]::Visible($child)) { continue }
    $controls += @{ cls = $cls; name = [OperaDialog]::TitleOf($child); text = [OperaDialog]::Read($child) }
  }

  if ($mode -eq 'state') {
    $fields = @($controls | Where-Object { $_.cls -eq 'Edit' })
    $field = if ($fields.Count -gt 0) { $fields[0] } else { $null }
    ConvertTo-Json @{
      open = $true
      platform = 'win32'
      title = [OperaDialog]::TitleOf($dlg)
      class = [OperaDialog]::ClassOf($dlg)
      field = if ($field) { $field.text } else { '' }
      buttons = @($controls | Where-Object { $_.cls -eq 'Button' } | ForEach-Object { $_.name })
      controls = $controls
      why = ''
    } -Compress -Depth 5
  } elseif ($mode -eq 'type') {
    $target = [IntPtr]::Zero
    foreach ($child in $children) {
      if ([OperaDialog]::ClassOf($child) -ne 'Edit') { continue }
      if ([OperaDialog]::Visible($child)) { $target = $child; break }
    }
    if ($target -eq [IntPtr]::Zero) {
      ConvertTo-Json @{ open = $true; platform = 'win32'; typed = $false; why = 'the dialog has no text field to type into' } -Compress
    } else {
      $ok = [OperaDialog]::Write($target, $text)
      ConvertTo-Json @{ open = $true; platform = 'win32'; typed = $ok; field = [OperaDialog]::Read($target); why = $(if ($ok) { '' } else { 'the field would not take the text' }) } -Compress
    }
  } elseif ($mode -eq 'press') {
    $target = [IntPtr]::Zero
    $matched = ''
    # WHY AN EMPTY NAME IS REFUSED: '***' matches the first button, so a blank name would press whichever button came first instead of answering that none was named.
    $named = -not [string]::IsNullOrWhiteSpace($name)
    foreach ($child in $children) {
      if (-not $named) { break }
      if ([OperaDialog]::ClassOf($child) -ne 'Button') { continue }
      $caption = [OperaDialog]::TitleOf($child)
      if ($caption -like "*$name*") { $target = $child; $matched = $caption; break }
    }
    if ($target -eq [IntPtr]::Zero) {
      ConvertTo-Json @{ open = $true; platform = 'win32'; pressed = $false; buttons = @($controls | Where-Object { $_.cls -eq 'Button' } | ForEach-Object { $_.name }); why = $(if ($named) { 'no button on this dialog is called ' + $name } else { 'no button name was given' }) } -Compress -Depth 5
    } else {
      [void][OperaDialog]::Post($target, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
      ConvertTo-Json @{ open = $true; platform = 'win32'; pressed = $true; button = $matched; why = '' } -Compress
    }
  } else {
    ConvertTo-Json @{ open = $true; platform = 'win32'; why = ('unknown mode ' + $mode) } -Compress
  }
}
`;

const powershell = (
  mode,
  ...rest
) => run('powershell', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `& { ${SCRIPT} } ${mode} ${rest.map((one) => `'${String(one).replace(/'/g,
  "''"
)}'`).join(' ')}`
]);

const readAnswer = (text) => {
  if (typeof text !== 'string') return null;
  const last = text.trim().split('\n').pop()?.trim() ?? '';
  if (!last.startsWith('{')) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
};

// WHY THE SHELL THAT IS ALREADY UP IS ASKED FIRST.
// Measured live on this machine: a dialog read cost 1.67 s because every call started its own PowerShell and compiled the window class again.
// The worker that already answers the window questions runs this same script, so a dialog read is a round trip over the loopback; the one-shot shell stays as the fallback for a machine where the worker cannot answer.

const parse = async (
  mode,
  rest,
  options = {}
) => {
  const platform = process.platform;
  const ask = options.worker ?? sharedOsWorker(platform);
  if (ask) {
    const body = await ask.ask('script', [
      SCRIPT,
      mode,
      ...rest
    ]).catch(() => null);
    const parsed = readAnswer(body);
    if (parsed) return {
      ...parsed,
      mode
    };
  }
  if (platform !== 'win32') {
    return {
      open: false,
      platform,
      why: `operating system dialogs are not driven on ${platform} yet`
    };
  }
  try {
    const { stdout } = await powershell(mode, ...rest);
    const parsed = readAnswer(stdout);
    if (!parsed) throw new Error('the shell answered with something that is not a dialog');
    return {
      ...parsed,
      mode
    };
  } catch (error) {
    return {
      open: false,
      platform,
      mode,
      why: String(error?.message ?? error).split('\n')[0]
    };
  }
};

/**
 * Read the operating system's own dialog, if one is open.
 * @param {object} [options] - the worker to ask, injected for tests.
 * @returns {Promise<object>} what the dialog holds, or why there is none.
 */

export function dialogState(options = {}) {
  return parse('state', [], options);
}

/**
 * Type into the text field of the operating system's own dialog.
 * @param {string} text - the text to type.
 * @param {object} [options] - the worker to ask, injected for tests.
 * @returns {Promise<object>} what the field reads back, or why it did not take it.
 */

export function dialogType(
  text,
  options = {}
) {
  return parse('type', [
    String(text ?? '')
  ], options);
}

/**
 * Press a named button on the operating system's own dialog.
 * @param {string} name - the button to press; a blank name is refused.
 * @param {object} [options] - the worker to ask, injected for tests.
 * @returns {Promise<object>} the button that answered, or why none did.
 */

export function dialogPress(
  name,
  options = {}
) {
  return parse('press', [
    '',
    String(name ?? '')
  ], options);
}
