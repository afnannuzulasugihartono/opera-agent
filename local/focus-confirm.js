// @last-edited: 2026-11-01 UTC+7.
// @title: focus-confirm — the question asked in the window the person is working in, before the screen is taken from them.
// @state: the notice script, the answer it gives back, and the question of whether a focus would take the screen at all.
// @dependencies: node:child_process, node:url.

import {
  spawn
} from 'node:child_process';
import {
  fileURLToPath
} from 'node:url';

export const NOTICE = fileURLToPath(new URL('./focus-notice.ps1', import.meta.url));

// WHY THE PERSON IS ASKED IN THE WINDOW THEY ARE IN.
// The person may have moved on to another tab, another browser or another program while the drive was working, and a focus that lands under their hands takes that away without asking.
// So the question is asked where their eyes already are, and it is asked without taking the focus: the panel is shown without being activated, so the keys they are typing keep going where they were going.

// WHY THE QUESTION GOES OVER THE PIPE AND NOT IN THE ARGUMENTS.
// Measured on this machine: a window title handed to PowerShell as an argument arrived as `bring A` - every quote and every word after it was gone.
// The pipe carries the text as it is, so the person is told what is about to happen to their screen.

/**
 * Ask the person, in the window they are in, whether the drive may take the screen.
 * @param {object} [options] - what the drive wants, how long the question waits, and the process runner to ask with.
 * @returns {Promise<object>} whether the person allowed it, and the answer they gave.
 */

export const askFocus = ({
  what,
  timeoutMs = 30000,
  spawn: spawn_ = spawn
}) => new Promise((resolve) => {
  const child = spawn_('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    NOTICE,
    '-TimeoutSec',
    String(Math.max(1, Math.ceil(timeoutMs / 1000)))
  ], {
    windowsHide: true
  });
  let out = '';
  child.stdout?.on('data', (chunk) => {
    out += String(chunk);
  });
  child.stderr?.on('data', () => {});

  child.stdin?.end?.(String(what ?? ''));

  // WHY THERE IS A TIMEOUT ON THE WAIT AND NOT ONLY ON THE PANEL.
  // A person who is not at the machine must not leave a drive waiting forever, and a panel that nobody answered is not an answer of no. The panel answers yes at its own deadline, and this is the backstop for a panel that never comes back at all.

  const timer = setTimeout(() => {
    child.kill();
    resolve({
      allowed: true,
      answer: 'timeout'
    });
  }, timeoutMs + 1000);
  child.on('error', () => {
    clearTimeout(timer);
    resolve({
      allowed: false,
      answer: 'error'
    });
  });
  child.on('close', () => {
    clearTimeout(timer);
    const allowed = /\bALLOW\b/.test(out);
    resolve({
      allowed,
      answer: allowed ? 'allow' : 'dismiss'
    });
  });
});

// WHY A FOCUS THAT CHANGES NOTHING IS NOT ASKED ABOUT.
// The person is already on the tab or the window the drive wants, so there is nothing to take from them and a question would be noise.

/**
 * Say whether a focus would take the screen away from the person.
 * @param {object} [options] - the window in front, the title the drive wants, and the browser the drive is in.
 * @returns {object} whether to ask, and what the screen is on now.
 */

export const focusSteal = ({
  foreground,
  title,
  browser = ''
}) => {
  const front = String(foreground ?? '');
  if (front === '') {
    return {
      ask: false,
      why: 'the machine did not say which window is in front'
    };
  }

  // WHY THE BROWSER IS PART OF THE ANSWER.
  // The same page can be open in two browsers at once, and the window in front would then carry the title of the tab the drive wants - so a title alone says "the person is already here" while the screen is about to move to another browser.
  // A browser that did not name itself is no browser to compare, and a title alone is then the best answer there is.

  const lower = front.toLowerCase();
  const wanted = String(title ?? '').toLowerCase();
  const own = String(browser ?? '').toLowerCase();
  const sameTitle = wanted !== '' && lower.includes(wanted);
  const sameBrowser = own === '' || own === 'unknown' || lower.includes(own);
  if (sameTitle && sameBrowser) {
    return {
      ask: false,
      why: ''
    };
  }
  return {
    ask: true,
    why: `the screen is on "${front}"`
  };
};
