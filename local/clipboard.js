// @last-edited: 2026-10-30 UTC+7.
// @title: clipboard — the system clipboard, and the paste that carries rich text into a page.
// @state: writeHtml, which puts HTML on the clipboard, and pasteHtml, which asks the page to take it.
// @dependencies: node:child_process.

// WHY THE HTML GOES THROUGH THE SYSTEM CLIPBOARD.
// Measured on a real Google Doc: an editor drawn on a canvas takes rich text from the paste buffer, and the buffer is the one place a browser keeps formatting that no key event carries.
// The text itself travels as base64, because a PowerShell pipe reads its input in the console's code page and an accented word would arrive mangled.

// WHY PLAIN TEXT GETS ITS OWN WRITER.
// Measured on a real spreadsheet: a paste of tab separated text lands as rows and columns, while a paste of rich HTML arrives as one mangled cell.
// So the sheet is fed plain text, and the buffer is written the same way the rich text is, only without the html format.

// WHY THE PASTE CARRIES THE PASTE COMMAND.
// The key event alone moved the caret and pasted nothing, because a synthetic key is not the browser's own paste command.
// The command is what the browser runs on Ctrl+V, and it reads the buffer this module filled.

import { execFileSync } from 'node:child_process';

const CONTROL = 2;

/**
 * Puts HTML on the system clipboard as rich text, so a paste into a page carries formatting, tables and pictures.
 * @param {string} html - the HTML to place on the clipboard.
 * @returns {{bytes: number}} how many bytes were written.
 */

export function writeHtml(html) {
  const text = String(html ?? '');
  if (text.trim() === '') {
    throw new Error('there is no HTML to put on the clipboard.');
  }
  if (process.platform !== 'win32') {
    throw new Error('rich HTML reaches the clipboard through PowerShell on Windows only; add a native clipboard writer before this runs on another system.');
  }
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$bytes = [Console]::In.ReadToEnd(); $html = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($bytes)); Set-Clipboard -AsHtml -Value $html'
    ],
    {
      input: encoded,
      encoding: 'utf8',
      windowsHide: true
    }
  );
  return {
    bytes: Buffer.byteLength(text, 'utf8')
  };
}

/**
 * Puts plain text on the system clipboard, so a paste into a spreadsheet lands as rows and columns.
 * @param {string} text - the text to place on the clipboard.
 * @returns {{bytes: number}} how many bytes were written.
 */

export function writeText(text) {
  const value = String(text ?? '');
  if (value.trim() === '') {
    throw new Error('there is no text to put on the clipboard.');
  }
  if (process.platform !== 'win32') {
    throw new Error('plain text reaches the clipboard through PowerShell on Windows only; add a native clipboard writer before this runs on another system.');
  }
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$bytes = [Console]::In.ReadToEnd(); $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($bytes)); Set-Clipboard -Value $text'
    ],
    {
      input: encoded,
      encoding: 'utf8',
      windowsHide: true
    }
  );
  return {
    bytes: Buffer.byteLength(value, 'utf8')
  };
}

// WHY THE CLIPBOARD IS READ BACK.
// The clipboard belongs to the whole machine, and on a machine where several agents drive one browser another agent's copy can land between a write and a paste.
// So the HTML is written, read back, and written again when the buffer holds something else, and the caller is told which of the two happened.

// WHY THE BUFFER IS ASKED WHAT IT HOLDS.
// Measured live on a real sheet: copying the chart and copying the cells behind it put the same format names on the buffer, and only the custom format says which one it is - "embedded-chart-clip" for the chart, "grid_range_clip" for the cells.
// So the custom format is read and the name inside it is the answer, because the format names alone cannot tell the two apart.

const CLIP_NAMES = 'Add-Type -AssemblyName System.Windows.Forms; $d = [System.Windows.Forms.Clipboard]::GetDataObject(); $m = $d.GetData("Chromium Web Custom MIME Data Format"); if ($null -eq $m) { "none" } else { $b = $m.ToArray(); $u = [System.Text.Encoding]::Unicode.GetString($b); $a = [System.Text.Encoding]::ASCII.GetString($b); if ($u -match "embedded-chart-clip" -or $a -match "embedded-chart-clip") { "chart" } elseif ($u -match "grid_range_clip" -or $a -match "grid_range_clip") { "range" } else { "other" } }';

/**
 * Says what the buffer carries: the chart, the cells behind it, or something else.
 * @returns {string} "chart", "range", "other", "none", or "unknown" when the buffer cannot be read.
 */

export function readChartClip() {
  if (process.platform !== 'win32') return 'unknown';
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        CLIP_NAMES
      ],
      {
        encoding: 'utf8',
        windowsHide: true
      }
    );
    const said = String(out ?? '').trim();
    return [
      'chart',
      'range',
      'other',
      'none'
    ].includes(said) ? said : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Reads the rich text back from the system clipboard.
 * @returns {string|null} the HTML on the clipboard, or null when the buffer holds none or the platform has no reader.
 */

export function readHtml() {
  if (process.platform !== 'win32') return null;
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; $d = [System.Windows.Forms.Clipboard]::GetDataObject(); $h = $d.GetData(\'HTML Format\'); if ($null -eq $h) { "" } else { [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$h)) }'
    ],
    {
      encoding: 'utf8',
      windowsHide: true
    }
  );
  const encoded = String(out ?? '').trim();
  if (encoded === '') return null;
  return Buffer.from(encoded, 'base64').toString('utf8');
}

/**
 * Writes the HTML and reads it back, writing once more when the buffer holds something else, and says which happened.
 * @param {string} html - the HTML to place on the clipboard.
 * @param {string} marker - a string the HTML carries, so the buffer can be checked for this very text.
 * @returns {{held: boolean, rewrote: boolean}} whether the buffer held the marker, and whether a second write was needed.
 */

export function ensureHtml(
  html,
  marker
) {
  const text = String(html ?? '');
  const mark = String(marker ?? '');
  writeHtml(text);
  const first = readHtml();
  if (typeof first === 'string' && first.includes(mark)) {
    return {
      held: true,
      rewrote: false
    };
  }
  writeHtml(text);
  const second = readHtml();
  return {
    held: typeof second === 'string' && second.includes(mark),
    rewrote: true
  };
}

/**
 * Asks the page to paste what the clipboard holds, by sending the paste command with the Ctrl+V key.
 * @param {object} cdp - the page connection the key events are sent over.
 * @returns {Promise<{pasted: boolean}>} that the paste was sent.
 */

export async function pasteHtml(cdp) {
  if (!cdp || typeof cdp.send !== 'function') {
    throw new Error('pasteHtml needs the page connection to send the paste.');
  }
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: CONTROL,
    key: 'v',
    code: 'KeyV',
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    commands: ['paste']
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: CONTROL,
    key: 'v',
    code: 'KeyV',
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86
  });
  return {
    pasted: true
  };
}
