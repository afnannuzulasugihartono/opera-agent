// @last-edited: 2026-10-15 UTC+7.
// @title: advice — a failure that names the problem and what to do about it.
// @state: rules keyed by failure, moves that name real calls, honesty locks.
// @dependencies: node:test, strict, ../local/advice.js, ../local/mcp-server.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RULES,
  withAdvice
} from '../local/advice.js';
import { TOOLS } from '../local/mcp-server.js';

const names = new Set(TOOLS.map((tool) => tool.name));

// WHY THE MOVES ARE PINNED AGAINST THE TOOL LIST.
// Advice is the one place a product can send an agent after a tool it does not have, and that is worse than saying nothing: the agent follows it, the call fails, and the advice is the thing it learns to distrust.
// So a move naming a tool that does not exist is a build failure.

test('every move names a call the server actually has', () => {
  const rows = [];
  for (const rule of RULES) {
    const asked = {
      'ask_page is read-only. Allowed: Page.getFrameTree': {},
      'bridge: extension is not connected': {},
      'Browser on port 9450 is not reachable: fetch failed': {},
      'No page target 7. Open pages: 1 | 2': {},
      '"nope" is not an element handle.': {},
      'handle opera-7 is no longer in the page - resolve the row again': {},
      'inputFound: false': {},
      'Cannot access a chrome:// URL': {},
      'click refused: 150,-139 is outside the 1136x770 viewport - scroll({text}) or scroll({y}) to bring it into view, then click again': {},
      'typed 5 characters and nothing on the page changed: focus was on button#button, which takes no text - click_row the field that should receive it, or press Escape if a dialog is over it': {},
      'no menuitem matching "Image". Visible: Insert | Table': {}
    };
    for (const text of Object.keys(asked)) {
      if (!rule.when(text)) continue;
      const moves = typeof rule.next === 'function' ? rule.next(text, { rows: [] }) : rule.next;
      for (const move of moves) {
        const call = /([a-z_]+)\(/.exec(move);
        if (!call) continue;
        rows.push([
          call[1],
          names.has(call[1])
        ]);
      }
      break;
    }
  }
  const unknown = rows.filter(([
    ,
    known
  ]) => !known);
  assert.deepEqual(unknown, [], `advice names calls that do not exist: ${unknown.map(([n]) => n).join(', ')}`);
  assert.ok(rows.length > 5, 'the rules do name real calls');
});

// WHY THE ORIGINAL MESSAGE IS KEPT VERBATIM.
// Advice that replaces the error is advice about something the agent cannot verify: the first line is what actually happened, and everything after it is a suggestion about it.

test('advice adds to the failure and never replaces it', () => {
  const out = withAdvice(new Error('no menuitem matching "Image". Visible: Insert | Table'), { rows: [] });

  assert.ok(out.startsWith('no menuitem matching "Image". Visible: Insert | Table'));
  assert.match(out, /\nNext: /);
});

test('an unknown failure is left exactly as it was', () => {
  const out = withAdvice(new Error('something nobody has ever seen'));

  assert.equal(out, 'something nobody has ever seen');
});

test('an empty failure stays empty rather than gaining advice', () => {
  assert.equal(withAdvice(new Error('')), '');
  assert.equal(withAdvice(undefined), '');
});

// WHY A NEARBY NAME IS SPELLED OUT.
// The caller asked for one thing and the page holds another that starts the same way; seeing the difference written down is the difference between "I spelled it wrong" and "the page does not have it".

test('a row the page nearly has is offered by its real name', () => {
  const rows = [{
    role: 'menuitem',
    name: 'Upload from computer'
  }];
  const out = withAdvice(new Error('no menuitem matching "Upload". Visible: nothing'), { rows });

  assert.match(out, /Upload from computer/);
  assert.match(out, /click_row/);
});

test('a missing menu row is sent to the menu tools, which know what a menu is', () => {
  const out = withAdvice(new Error('no menuitem matching "Image". Visible: none'), { rows: [] });

  assert.match(out, /list_menus\(\)/);
  assert.match(out, /open_menu\(/);
});

test('a missing button is not sent to the menu tools', () => {
  const out = withAdvice(new Error('no button matching "Save". Visible: none'), { rows: [] });

  assert.ok(!/list_menus/.test(out), 'a button is not a menu row');
  assert.match(out, /ax_snapshot\(\)/);
});

// WHY THE FILE-CHOOSER RULE EXISTED.
// Google Docs opens the operating system dialog through the File System Access API: upload reports that it found no input while the page is perfectly reachable, and the only road in is a drop.

test('an input that could not be filled is sent to the drop', () => {
  const out = withAdvice(new Error('upload: inputFound: false'), { rows: [] });

  assert.match(out, /drop_file\(/);
  assert.match(out, /no file input/i);
});

// WHY AN EXTENSION PAGE IS SENT TO THE TAB LIST.
// Measured live: a drive named the Extensions tab and the bridge refused it with "Cannot access a chrome:// URL", which is a wall, not a failure - no move on that tab can ever succeed.
// The only useful next step is the list of tabs that can be driven.

test('a click off the page is sent to the scroll that reaches it', () => {
  const out = withAdvice(new Error('click refused: 150,-139 is outside the 1136x770 viewport - scroll to bring it into view'), { rows: [] });

  assert.match(out, /scroll\(\{text\}\)/);
  assert.match(out, /click_row\(\)/);
});

// WHY AN OFF-PAGE CLICK IS PINNED HERE.
// It is the one failure measured as a success: a click at y -139 was reported as delivered.
// A failure like that teaches an agent to trust an answer that is not true, which is worse than any failure it can name.

test('an off-page click names the scroll that would reach the point', () => {
  const out = withAdvice(new Error('click refused: 150,-139 is outside the 1136x770 viewport'), { rows: [] });

  assert.match(out, /scroll\(\{y\}\)/);
  assert.match(out, /click_row\(\) answers coordinates/, 'because the row is where an off-viewport coordinate comes from');
});

test('an extension page refusal is sent to the tab list, which is all an agent can do about it', () => {
  const out = withAdvice(new Error('Cannot access a chrome:// URL'), { rows: [] });

  assert.match(out, /list_tabs\(\)/);
  assert.match(out, /chrome:\/\//);
});

// WHY TEXT THAT WENT NOWHERE LEADS WITH THE ELEMENT THAT HAD FOCUS.
// Measured live on YouTube: a type inserted nothing and the answer offered two guesses - no caret, or a minimized window.
// The truth was a third thing the page was already telling: focus sat on a cookie wall's button.
// The failure now names that element, so the first move is the field itself, and an overlay gets its own move.

test('text the page did not take leads with the element that had focus', () => {
  const out = withAdvice(new Error('typed 5 characters and nothing on the page changed: focus was on button#button, which takes no text - click_row the field that should receive it, or press Escape if a dialog is over it'), { rows: [] });

  assert.match(out, /click_row/);
  assert.match(out, /Escape/, 'because a dialog over the field is the case that looks like a lost caret');
  assert.match(out, /caret_line\(\)/);
  assert.match(out, /read_page\(\) before typing again/, 'because on a canvas page the text may have landed after the check');
});

test('a page with nothing to type into gets the same moves', () => {
  const out = withAdvice(new Error('typed 5 characters into a page that holds no text and no field to receive them'), { rows: [] });

  assert.match(out, /click_row/);
  assert.match(out, /caret_line\(\)/);
});

// WHY THE LINK RULES ARE SEPARATE.
// "The extension is not connected" and "the port is not reachable" look alike and need the same first move, but a drive that has silently slid onto a debug port needs a different warning: that road opens a profile nobody is signed into.

test('a dead link says how to bring it back', () => {
  const out = withAdvice(new Error('bridge: extension is not connected (start the local driver, then reload the extension)'));

  assert.match(out, /reload it in chrome:\/\/extensions/);
});

test('a failure with nothing left to advise stays short', () => {
  const out = withAdvice(new Error('upload needs exactly one of data or path'));

  assert.equal(out, 'upload needs exactly one of data or path');
});
