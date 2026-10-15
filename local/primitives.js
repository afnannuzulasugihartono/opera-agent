// @last-edited: 2026-10-11 UTC+7.
// @title: primitives — the actions the local driver offers, built on CDP and measured in the tens of milliseconds.
// @state: 10 locks; trusted typing, chunked insertion, chord dispatch, coordinate clicks, and bounded waits.
// @dependencies: ../local/cdp.js.

// WHY THIS FILE EXISTS
//
// These are the verbs that make the three targets possible: writing a document in
// Docs, filling a sheet in Sheets, laying out a deck in Slides. Each one is a CDP
// command underneath, so each inherits the half-millisecond transport measured in
// local-transport, and each has one rule that is not obvious and not optional.
//
// Typing does not replace a selection. That was measured against a real Google
// Docs canvas, where selecting all and then typing appended instead of
// overwriting, duplicated the document, and returned ok:true with nothing to
// indicate it had. The primitives therefore expose the two halves separately --
// select, then delete, then type -- rather than a convenient replace that does
// not exist at the protocol level.
//
// A newline is a real paragraph break, and a key event is not. Measured in the
// same document: text inserted with \n produced separately styled paragraphs,
// which is what lets a whole paper go in as one call rather than hundreds. The
// same document ignored a dispatched Enter key event entirely and still reported
// success, merging every paragraph into one. Both paths reach the editor, only
// one of them is read, and the result is indistinguishable from working unless
// the document is captured and looked at. So callers break paragraphs through
// type() and never through key('Enter').
//
// Structure is applied before content, never after. Measured in the same
// document: a paragraph style applied to a paragraph that already held its text
// did not take, while the identical chord applied to an empty paragraph did.
// The chord returns ok either way, so the outline is the only witness.
//
// Text belongs to the key only when nothing is held down. A chord is exactly two
// events — keyDown and keyUp with the modifiers mask, the virtual codes, and no
// text — and no separate modifier press around them. Measured 2026-10-13: the
// previous six-event frame, modifier downs plus a rawKeyDown, leaked its character
// into a Docs canvas under rapid fire ("e1Laporan", doc 11nW) while the two-event
// frame the extension sends styled cleanly on the same document at the same speed.
// Two events are also three round trips fewer per chord, which is what makes a
// twenty-key walk feel instant instead of deliberate.
//
// Tab carries no text. A real Tab keypress produces none, and the tab character
// this driver used to send moved the Sheets selection while stranding focus in
// the formula bar, which then swallowed every following key. Measured 2026-10-13:
// three identically misfilled sheets, then a name-box trace naming Tab as the
// poison and a textless Tab moving cleanly with focus intact.
//
// A hover moves and stops. A menu item that owns a submenu opens it on hover and
// closes on click, so a press here dismisses the menu the caller was reaching into
// and the submenu is then gone. Measured against a real View menu: the press did
// nothing but close it, the hover opened it.
//
// A capture is one pixel per clickable coordinate. Taken at device pixels on a
// HiDPI screen a picture comes back larger than the clickable viewport, so a
// coordinate read off it and sent as CSS pixels lands a quarter of the way off:
// that is what put a click meant for A1 into A3 on a 1.25 screen. Every capture
// is therefore clipped to the viewport at scale 1, which is the same space
// clickAt speaks, so looking at a picture and clicking what is in it is true.
//
// Text insertion is chunked. A single Input.insertText carries a practical limit,
// and a long document arriving in one piece can be dropped or truncated partway
// with no error. Chunking bounds the blast radius of that.
//
// Keys travel as a stream. Every lone key pays a full round trip, so a twenty-key
// menu walk costs twenty trips one at a time and one as a stream: order preserved,
// gaps ride along for UI that needs a beat, text and chords share the sequence.
//
// Dispatches pipeline. One CDP session answers every request by id, so ten sends
// without an await between them cost one round trip, not ten, and Chrome still
// processes them in arrival order. Anything that must wait — a gap for a menu
// animation, a tree before its boxes — awaits; everything else fires together.
//
// A snapshot names what can be clicked. A canvas page exposes no DOM worth
// querying, but Blink computes an accessibility tree for every rendered page, and
// every node in it resolves to a box. Reading role, name and center together turns
// "click the Insert menu" from a remembered coordinate into one fresh call.
//
// Every pointer action leaves a mark the person watching can see. A synthetic
// click moves no cursor, so without a mark the drive is invisible: a red ring for
// a click, blue for a hover, drawn as one fixed div by a fixed script that takes
// coordinates and nothing else — visible live and in captures, and pipelined with
// the action so the mark costs no round trip. A debugger overlay was tried first
// and discarded: it answers ok and renders nothing. The mark is best-effort by
// design: a page that refuses the script still gets its click.
//
// A hover does not wait for its own reply. A lone mouse move is the one dispatch
// whose acknowledgement Chrome answers on page time — measured 700 ms to 5 s on
// ordinary pages, while the same move inside a click answers in milliseconds. The
// move is sent and the mark awaited; the effect is proven by the snapshot read
// that follows every hover, which is also what makes a dead tab fail loudly one
// call later instead of silently now.

import nodeFs from 'node:fs';
import nodeOs from 'node:os';
import nodePath from 'node:path';
import { Buffer } from 'node:buffer';

import { findNode, menuTreeExpression, nearestNames, revealOf, stateOf } from './menu-tree.js';

const KEY_CODES = Object.freeze({
  Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
  Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' },
  Backspace: { windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' },
  Delete: { windowsVirtualKeyCode: 46, code: 'Delete', key: 'Delete' },
  Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
  ArrowDown: { windowsVirtualKeyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
  ArrowUp: { windowsVirtualKeyCode: 38, code: 'ArrowUp', key: 'ArrowUp' },
  ArrowLeft: { windowsVirtualKeyCode: 37, code: 'ArrowLeft', key: 'ArrowLeft' },
  ArrowRight: { windowsVirtualKeyCode: 39, code: 'ArrowRight', key: 'ArrowRight' },
  Home: { windowsVirtualKeyCode: 36, code: 'Home', key: 'Home' },
  End: { windowsVirtualKeyCode: 35, code: 'End', key: 'End' },
  Space: { windowsVirtualKeyCode: 32, code: 'Space', key: ' ', text: ' ' }
});

const MODIFIER_BITS = Object.freeze({ Alt: 1, Control: 2, Meta: 4, Shift: 8 });

const TEXT_KEY = /^[A-Za-z0-9]$/;

function describeKey(name) {
  const known = KEY_CODES[name];
  if (known) return known;
  if (typeof name === 'string' && /^[0-9]$/.test(name)) {
    return { key: name, code: `Digit${name}`, windowsVirtualKeyCode: name.charCodeAt(0), text: name };
  }
  if (typeof name === 'string' && TEXT_KEY.test(name)) {
    return { key: name, code: `Key${name.toUpperCase()}`, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0), text: name };
  }
  if (typeof name === 'string' && name.length === 1) {
    const punct = PUNCTUATION.get(name);
    if (punct) return { key: name, code: punct[0], windowsVirtualKeyCode: punct[1], text: name };
  }
  throw new Error(`Unknown key: ${JSON.stringify(name)}. Use a named key or a single printable ASCII character.`);
}

const PUNCTUATION = new Map([
  ['_', ['Minus', 189]], ['-', ['Minus', 189]],
  ['=', ['Equal', 187]], ['+', ['Equal', 187]],
  ['[', ['BracketLeft', 219]], ['{', ['BracketLeft', 219]],
  [']', ['BracketRight', 221]], ['}', ['BracketRight', 221]],
  ['\\', ['Backslash', 220]], ['|', ['Backslash', 220]],
  [';', ['Semicolon', 186]], [':', ['Semicolon', 186]],
  ["'", ['Quote', 222]], ['"', ['Quote', 222]],
  ['`', ['Backquote', 192]], ['~', ['Backquote', 192]],
  [',', ['Comma', 188]], ['<', ['Comma', 188]],
  ['.', ['Period', 190]], ['>', ['Period', 190]],
  ['/', ['Slash', 191]], ['?', ['Slash', 191]],
  ['!', ['Digit1', 49]], ['@', ['Digit2', 50]], ['#', ['Digit3', 51]],
  ['$', ['Digit4', 52]], ['%', ['Digit5', 53]], ['^', ['Digit6', 54]],
  ['&', ['Digit7', 55]], ['*', ['Digit8', 56]], ['(', ['Digit9', 57]], [')', ['Digit0', 48]]
]);

const SNAPSHOT_ROLES = new Set([
  'button', 'link', 'menuitem', 'menu', 'toolbar', 'textbox', 'searchbox', 'combobox',
  'listbox', 'option', 'checkbox', 'radio', 'tab', 'switch', 'slider',
  'table', 'grid', 'row', 'gridcell', 'cell', 'columnheader', 'rowheader'
]);

// WHY THE SNAPSHOT IS ONE CALL AND NOT ONE PER ELEMENT. It used to read the
// accessibility tree and then ask for the box of every node it liked, which on
// a Google Doc is up to a hundred and twenty round trips. The extension runs
// one command at a time on purpose — two browser actions racing leave the page
// in neither state anyone asked for — so those were sequential no matter that
// the caller said Promise.all, and a snapshot cost about two seconds before
// anything had decided anything. Chrome has no batch API for element boxes, so
// the only way down to one round trip is to compute the boxes where the
// elements live: one evaluate inside the page walks the DOM once and returns
// role, name and centre for everything worth clicking.
//
// WHY THE ROLES ARE DERIVED IN THE PAGE. Dropping the accessibility tree is
// only safe because the role is recoverable: an explicit role attribute is
// what Google Docs itself puts on its menus, and the tag table below covers
// the plain-HTML remainder. A widget whose role only an assistive technology
// would compute would be missing, which is why the attribute is read first and
// the tag table is deliberately short.

// WHY SECRET VALUES NEVER LEAVE THE PAGE. The snapshot carries a field's
// current value so the agent can see what is already typed — a formula bar, a
// name box. A password field would ride along the same way, straight into
// model context, which is exfiltration wearing a snapshot's clothes. Password,
// hidden and one-time-code fields keep their role and their box and lose their
// value, decided where the value is read so no caller has to remember.

// WHY OVERLAY ROWS COME FIRST. Menus, dialogs and popups render at the end of
// the document but sit on top of it — and they are usually what the agent just
// caused. A snapshot that walks document order buries fifteen fresh menu rows
// past a sixty-row cap, so the menu the agent opened is missing from the page
// it gets back. Proven live: with a stable open menu, a sixty-row snapshot
// held zero menu rows and the same menu sat visible past the cap. The
// expression collects overlay descendants first and everything else after,
// skipping what it already took, so the cap cuts the least surprising rows
// instead of the most recent ones. Matched by ARIA role, never by site: a
// class name here would be per-site code wearing a generic primitive's name.

// WHY THE CARET RIDES THE SNAPSHOT. Every keystroke lands wherever the caret
// is, and until now the agent tracked that in its head: after a click or an
// arrow key, the caret's new home was a guess. A wrong guess types into the
// wrong paragraph. The caret therefore rides every snapshot as a final row,
// so the next keystroke's landing is read, not remembered. A collapsed
// selection reports its point; a ranged one reports nothing, because a
// selection's focus end has no honest single point and reads collapse
// selections anyway. Docs draws its caret as an element the page exposes,
// which is the one per-site selector this generic expression is allowed: a
// canvas caret has no other API, and the test below holds that exception to
// exactly one name. The row carries no line text: the mirror a copy reads
// from only holds what a selection put there, so a line is read by selecting
// it first, and that dance lives in caret_line rather than in every map.

// WHY A SUBMENU IS HOVERED AGAIN WHILE IT IS WAITED FOR. Measured live: a submenu
// opened by hover came and went with where the pointer was, and a walk that hovered
// once and then read was answered with an empty level often enough to matter. A
// menu bar item is a toggle that opens on the click and stays open, so it is never
// hovered again; a submenu is, because the pointer leaving it is what closes it
// and hovering is the only thing that opens it. Clicking it instead would run
// whatever it holds.

// WHY THE CARET IS CHOSEN BY ITS COLOUR AND NOT BY ITS PLACE. Measured live on a
// shared Google Doc: the page holds two carets, this client's drawn in the text
// colour and a collaborator's painted green and labelled with their name. Taking
// the last caret in the document measured and clicked somebody else's cursor —
// which never moves — so every restore reported success while the real caret went
// to the end of the document. The caret of this client is the one drawn in the
// text colour; the name and the colour of the others are how the page marks them.

const LOCAL_CARET_EXPRESSION = `
  const live = [...document.querySelectorAll('.kix-cursor-caret')].filter((el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
  if (!live.length) return null;
  const ink = getComputedStyle(document.body).color;
  const mine = live.find((el) => (el.getAttribute('style') || '').includes(ink))
    ?? live.find((el) => !(el.parentElement && el.parentElement.textContent || '').trim())
    ?? live[0];
  return mine;`;

const SNAPSHOT_EXPRESSION = `(() => {
  const LIMIT = __LIMIT__;
  const ROLES = new Set(__ROLES__);
  const TAG_ROLE = {
    A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    TABLE: 'table', TR: 'row', TD: 'cell', TH: 'columnheader'
  };
  const INPUT_ROLE = {
    button: 'button', submit: 'button', reset: 'button', checkbox: 'checkbox',
    radio: 'radio', range: 'slider', search: 'searchbox', text: 'textbox',
    email: 'textbox', tel: 'textbox', url: 'textbox', password: 'textbox',
    number: 'textbox'
  };

  const roleOf = (el) => {
    const stated = (el.getAttribute('role') || '').split(' ')[0].toLowerCase();
    if (stated && ROLES.has(stated)) return stated;
    const tag = el.tagName;
    if (tag === 'INPUT') return INPUT_ROLE[(el.type || 'text').toLowerCase()] || null;
    if (tag === 'TH') return el.scope === 'row' ? 'rowheader' : 'columnheader';
    return TAG_ROLE[tag] || null;
  };

  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(' ')
        .map((id) => { const n = document.getElementById(id); return n ? (n.textContent || '') : ''; })
        .join(' ').trim();
      if (text) return text;
    }
    const alt = el.getAttribute('alt');
    if (alt) return alt;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
    const title = el.getAttribute('title');
    if (title) return title;
    return (el.innerText || el.textContent || '').trim();
  };

  const valueOf = (el) => {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (el.getAttribute('autocomplete') === 'one-time-code') return '';
      if (tag === 'INPUT') {
        const kind = (el.type || 'text').toLowerCase();
        if (kind === 'password' || kind === 'hidden') return '';
      }
      return typeof el.value === 'string' ? el.value : '';
    }
    const marked = el.querySelector('[aria-selected="true"], [aria-checked="true"]');
    return marked ? (marked.innerText || marked.textContent || '').trim() : '';
  };

  const CANDIDATES = 'button, a[href], input, select, textarea, table, tr, td, th, [role], [tabindex], [contenteditable]';
  const OVERLAYS = '[role~="menu"],[role~="dialog"],[role~="listbox"]';
  const out = [];
  const nodes = [];

  const tryRow = (el) => {
    const role = roleOf(el);
    if (!role || !ROLES.has(role)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    const value = valueOf(el);
    nodes.push(el);
    out.push({
      role,
      name: nameOf(el).slice(0, 80),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      node: nodes.length - 1,
      ...(value ? { value: value.slice(0, 80) } : {})
    });
  };

  const caretOf = () => {
    const usable = (r) => (r && (r.x !== 0 || r.y !== 0 || r.width !== 0 || r.height !== 0)) ? r : null;
    const kix = (() => { ${LOCAL_CARET_EXPRESSION} })();
    if (kix) {
      const r = usable(kix.getBoundingClientRect());
      if (r) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
    try {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
      const r = usable(sel.getRangeAt(0).getBoundingClientRect());
      if (!r) return null;
      return { x: Math.round(r.x), y: Math.round(r.y) };
    } catch { return null; }
  };

  collect: {
    for (const box of document.querySelectorAll(OVERLAYS)) {
      if (box.parentElement && box.parentElement.closest(OVERLAYS)) continue;
      tryRow(box);
      for (const el of box.querySelectorAll(CANDIDATES)) {
        if (out.length >= LIMIT) break collect;
        tryRow(el);
      }
      if (out.length >= LIMIT) break collect;
    }
    for (const el of document.querySelectorAll(CANDIDATES)) {
      if (out.length >= LIMIT) break;
      if (el.closest(OVERLAYS)) continue;
      tryRow(el);
    }
  }
  const caret = caretOf();
  if (caret) out.push({ role: 'caret', name: 'text caret', x: caret.x, y: caret.y });

  // WHY THE ROWS KEEP THEIR ELEMENTS. A snapshot reports where things were; by
  // the time an agent acts on it the page has moved, a menu has closed, a list
  // has scrolled — and the coordinate is a point in the past. The elements stay
  // here beside their rows so a row can be resolved to the node itself and
  // measured again at the moment of the click. The caret row has no element: it
  // is a range in a document, and its coordinates are the only honest answer.
  window.__operaNodes = nodes;
  return out;
})()`;

// WHY A ROW IS RESOLVED TO A NODE AND MEASURED AGAIN. A menu lives about two
// seconds: a snapshot taken in one tool call and a click in the next hits dead
// background or, measured live, the button underneath it. So a row is resolved to
// the element it came from, and that element is measured at the moment of the
// click — the page may scroll, the row may move, and the click still lands on the
// thing that was asked for. The handle is the node's backend id, which the
// browser keeps for the life of that node and refuses the moment it is gone.

export const HANDLE_PREFIX = 'opera-';

// WHY ASKING IS A PRIMITIVE AND NOT A LEAK. The list of methods that may be
// asked is decided by the surface, not by the caller: reads of structure, no
// script, no input, no navigation. An agent confused about what a page is can
// ask the browser the question directly instead of inferring it from behaviour,
// and cannot turn the question into an action.

const DROPPED_HANDLE = 'is no longer in the page';

// WHY THE ROWS CARRY THEIR NODE INTERNAL. The index that ties a row to its
// element means nothing to a caller — it is not a handle and it does not survive
// the next snapshot — so it never leaves the snapshot. A caller that wants to
// hold on to a row asks for a handle, which is the browser's own name for the
// element and stays good for the element's life.

const centreOf = (quad) => {
  const xs = [];
  const ys = [];
  for (let i = 0; i + 1 < quad.length; i += 2) {
    xs.push(quad[i]);
    ys.push(quad[i + 1]);
  }
  return {
    x: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    y: Math.round(ys.reduce((a, b) => a + b, 0) / ys.length)
  };
};

export function snapshotExpression(limit) {
  return SNAPSHOT_EXPRESSION
    .replace('__LIMIT__', String(limit))
    .replace('__ROLES__', JSON.stringify([...SNAPSHOT_ROLES]));
}

// WHY A GOOGLE DOC IS READ THROUGH ITS OWN COPY PATH. Docs draws the document
// on a canvas, so body.innerText holds the toolbar chrome and none of the
// content: read_page on a Doc reported an empty document that was not empty,
// and the only thing that could see the text was a screenshot. Docs keeps a
// hidden iframe for text events, and dispatching a copy event there makes Docs
// itself populate a div with the selected text — Zotero's production
// technique, proven on this machine at thirteen milliseconds for a full
// document read. One adaptation: Zotero clears with innerHTML, which this
// document's Trusted Types policy refuses outright, so the div is emptied with
// replaceChildren instead. Same clearing, no string sink.
//
// WHY THE READ PREFERS INNERTEXT. The populated div keeps the document's block
// structure, and innerText renders it back as lines: headings, paragraphs and
// list items stay separated the way the person sees them. textContent would
// weld every paragraph into one run with no boundary at all, and joining blocks
// with a period instead would corrupt the text it claims to report —
// abbreviations, decimals and version numbers all contain periods that are not
// separators. textContent stays as the fallback for a frame that renders
// nothing. Trailing blank lines are trimmed on the way out: they are
// layout air, not content.
//
// WHY THE SELECTION IS BORROWED AND RETURNED. The copy path reads whatever is
// selected, so a full read selects all first — and anything the person had
// selected is replaced the moment Ctrl+A lands. End collapses the selection
// back to a caret at the end of the document, which is the one position a read
// can honestly promise: the content is untouched, the caret is not where it
// was. A read that left the whole document selected would turn the agent's
// next keystroke into a deletion.
//
// WHY AN EMPTY COPY EARNS ONE RETRY. Ctrl+A selects nothing when the editor
// never had focus, and the cleared box then reads as an empty document that is
// not empty. One click in the canvas tile focuses the editor for the second
// attempt; the retry is the only path that can pay the background-window mouse
// penalty, and only when the fast path came back with nothing.

export const DOCS_COPY_EXPRESSION = `(() => {
  try {
    const frame = document.querySelector('.docs-texteventtarget-iframe');
    if (!frame || !frame.contentDocument) return null;
    const target = frame.contentDocument.querySelector('[contenteditable]');
    if (!target) return null;
    target.replaceChildren();
    target.dispatchEvent(new CustomEvent('copy'));
    const body = frame.contentDocument.body;
    const raw = target.innerText || (body ? body.textContent : '') || '';
    const ZW_FIRST = 8203;
    const ZW_LAST = 8205;
    const BOM = 65279;
    let text = '';
    for (const ch of raw) {
      const code = ch.codePointAt(0);
      if ((code < ZW_FIRST || code > ZW_LAST) && code !== BOM) text += ch;
    }
    return text.trimEnd();
  } catch { return null; }
})()`;

// WHY AN UPLOAD NEVER OPENS THE FILE DIALOG. The native picker is OS chrome:
// CDP cannot see it, click it, or dismiss it, so a drive that opens one is
// stuck until a human intervenes. The file input behind it takes files
// directly instead — setFileInputFiles names local paths the way a dialog
// would have, the page uploads on the change event it already listens for,
// and no dialog ever appears. Bytes ride in as base64 and rest briefly in a
// temp file only CDP can name, because the protocol takes paths, not bytes.

// WHY THE SEARCH PIERCES FROM INSIDE. A file input rarely sits in the open:
// upload widgets hide it in an iframe or a shadow root, where a top-frame
// query finds nothing. Fetching a whole pierced tree to look for it timed out
// live on a heavy page instead, so the search walks from inside the page and
// returns the first input it meets — one call, one node back, however deep it
// hides. What it cannot find is an input that does not exist yet: some pages
// only create theirs on the way to the picker, and for those the agent walks
// the menu first and calls upload after.

// WHY THE INPUT IS LOOKED FOR FIVE TIMES. Clicking Upload creates the file
// input, but creation lands on the page's own time: the first look routinely
// finds nothing a second after the click. Five looks across two seconds cost
// nothing when the input is already there and catch it when it arrives late;
// still nothing after that is an honest inputFound:false, not a race lost.

const UPLOAD_FIND_ATTEMPTS = 5;
const UPLOAD_FIND_GAP_MS = 400;

// WHY A DROP EXISTS BESIDE AN UPLOAD. The upload fills a file input, which is
// the whole story on a site that has one. Google Docs' image picker has none:
// it opens the operating system's own dialog through the File System Access
// API, so there is no input to fill, nothing to suppress, and nothing to click
// once it is open. A drop is the road that is left, and it is the one the web
// itself offers — Chrome's drag events carry files, so a page that accepts a
// dropped image accepts this one. Measured live: the image landed in a
// document, with no dialog and no input anywhere in sight.

// WHY A SUBMENU NEEDS TWO GAPS AND NOT ONE NUMBER. The pointer has to be sent
// away and come back before a menu will treat it as entering, and then the
// submenu has to be rendered before it is worth reading. Both waits are short,
// both are the point where a slow machine fails, and neither is a guess about
// how long an application "usually" takes.

// WHY A CARET IS REMEMBERED AS A POINT IN THE VIEWPORT AND PUT BACK WITH A CLICK.
// Reading a Google Doc means selecting the document and copying it, because a
// canvas holds no text to read — and that leaves the caret at the end, so the next
// click lands where the agent has already been. Measured on this product's own
// author: the caret was lost on a read and the loss went unnoticed until a click
// landed in the wrong place.
//
// WHY A POINT AND NOT A SELECTION. What has to survive is where the caret will be
// next. Restoring a selection too would mean restoring offsets, and a read that
// restored the wrong selection would leave the next keystroke overwriting text
// nobody chose. A point, put back with a click, is what the page already
// understands: Docs draws its own caret as an element, and clicking it is how a
// person moves it.
//
// WHY THE RESTORE IS REPORTED RATHER THAN ASSUMED, AND WHY IT IS LEFT ALONE FOR A
// BEAT. A caret that cannot be put back is not a failure of the read — the text came
// — but it is the difference between an agent that knows where it is and one that
// clicks blind, so the answer says which happened. And a canvas redraws its caret
// asynchronously, so a click and an immediate read can still see the old one.

// WHY A CLICK TAKES A FRACTION AS WELL AS A PIXEL. Measured live by resizing

    // this machine's browser window: the viewport went 1144x714 to 1186x670 while
    // the device scale stayed at 1.25, so the same CSS pixel stopped meaning the
    // same place. A fraction is resolved against the viewport as it is at the
    // moment of the click, which survives that, and the answer says which pixels it
    // became and in what space - so a caller that meant a fixed pixel still gets the
    // truth about the space it landed in.

const CARET_RESTORE_GAP_MS = 180;
const CARET_TOLERANCE_PX = 12;

// WHY THE VIEW IS PUT BACK TWICE AND THE CLICK WAITS FOR THE SECOND. Measured
// live: the read scrolls the document to the caret, and the page finishes that
// scroll on its own frame — after the first write. A click that goes out in
// between lands on whatever happens to be under it, and on the thesis document
// that was an image: the caret was restored onto a picture. So the scroll is
// written, the page is given a beat to argue, and the click only goes out once a
// second write held.

const CARET_SCROLL_SETTLE_MS = 120;
const CARET_SCROLL_ATTEMPTS = 3;
const SCROLL_MARK = 'data-opera-scroll';
const MENU_HOVER_GAP_MS = 90;

const MENU_OPEN_GAP_MS = 260;

// WHY A MENU IS POLLED UNTIL IT IS DRAWN. Measured live, the Insert dropdown was
// still absent five seconds after the click; a fixed gap of any honest size is
// either slow on a good machine or early on a slow one. Polling the tree until
// the children are there costs nothing when they arrive immediately and is the
// only thing that works when they do not.

const MENU_OPEN_POLL_MS = 150;
const DROP_PHASE_GAP_MS = 120;
const DROP_FRONT_SETTLE_MS = 700;
const DROP_SETTLE_MS = 900;
const DRAG_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json'
};

// WHY THE TYPE COMES FROM THE NAME. A drop tells the page what it is being
// offered through one mime type, and a wrong one is a file the page refuses.
// The name is the only thing the caller carries, so it decides; a type with no
// entry is still dropped, honestly typed as bytes.

export function dragMimeType(filename) {
  const name = String(filename ?? '');
  const dot = name.lastIndexOf('.');
  return (dot < 0 ? null : DRAG_MIME_TYPES[name.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
}

// WHY DRAGOVER IS SENT TWICE. Chrome decides whether a target accepts a drop
// from the dragover it just received, so a drop sent straight after a single
// dragover is refused with the event accepted and nothing delivered. Measured
// live: one dragover brought the page to "enter" and no file; a second one, and
// the same page reported the file name and size it had been handed.

export const DROP_PHASES = Object.freeze(['dragEnter', 'dragOver', 'dragOver', 'drop']);

export const UPLOAD_INPUT_EXPRESSION = `(() => {
  const seen = new Set();
  const scan = (root) => {
    if (!root || seen.has(root)) return null;
    seen.add(root);
    const direct = root.querySelector ? root.querySelector('input[type=file]') : null;
    if (direct) return direct;
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of elements) {
      if (el.shadowRoot) {
        const hit = scan(el.shadowRoot);
        if (hit) return hit;
      }
      if (el.tagName === 'IFRAME') {
        try {
          const inner = el.contentDocument;
          if (inner) {
            const hit = scan(inner);
            if (hit) return hit;
          }
        } catch {}
      }
    }
    return null;
  };
  return scan(document);
})()`;

export function isDocsDocument(url) {
  return String(url || '').includes('docs.google.com/document/d/');
}

// WHY READING A LINE SELECTS IT FIRST. The mirror a copy reads from only
// holds what a selection put there: measured live as an empty line beside a
// perfectly visible caret. So the read selects its own line — Home,
// Shift+End — copies, and collapses back to the line end, which is the
// documented end state: the caret moves within its line and never past it.
// Steps breathe between them because injected keys land late; without the
// beats the copy runs before the selection exists.

const CARET_LINE_GAP_MS = 300;

export const SELECTION_TEXT_EXPRESSION = `(() => {
  try {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    return String(sel.toString()).slice(0, 500);
  } catch { return ''; }
})()`;

export function modifierMask(modifiers = []) {
  return modifiers.reduce((mask, name) => {
    const bit = MODIFIER_BITS[name];
    if (bit === undefined) throw new Error(`Unknown modifier: ${JSON.stringify(name)}. Use one of ${Object.keys(MODIFIER_BITS).join(', ')}.`);
    return mask | bit;
  }, 0);
}

export function splitText(text, size) {
  const value = String(text ?? '');
  if (value.length === 0) return [];
  const out = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

// WHY A HOVER WAITS FOR THE MOVE IT DISPATCHED. It used to fire the move and
// forget it, which reported a hover that had not happened yet while a
// five-second command sat in the worker's queue — and the next command's
// liveness proof then queued behind that move and failed, so one lie became two
// failures. Measured on the user's own browser: Input.dispatchMouseEvent costs
// 2 ms for a press and a release, and about five seconds for a move or a
// wheel, because those wait on a compositor that is not running when the window
// is not in front. That cost is real either way, and the caller now finds out
// from the hover rather than from whatever it calls next.

// WHY A RUN HOLDS WORK, NOT PROMISES, AND KEYS KEEP A BEAT. A promise pushed
// into a run is work already begun: awaiting those in order afterwards ordered
// nothing, measured as a chord's keyUp landing after the next event's keyDown.
// So a run holds what to do and each event only starts when reached; the
// overlap given up was three milliseconds a key on loopback against twenty
// seconds each over the relay, which is why it existed at all. Order is only
// half of it: Docs drops edges that land in the same tick — three Enter
// presses vanished while typed characters beside them all survived — and the
// trust window hides this by spacing early calls with proof round trips while
// trusted ones fire back-to-back. So a key holds its down edge fifty
// milliseconds before the up, and chords in a stream breathe the same between
// them. Fifty is past any coalescing window and a sixtieth of one model turn.

const KEY_BEAT_MS = 50;

// WHY THE PICKER IS INTERCEPTED, NOT CLICKED THROUGH. The file input only
// exists once the upload flow starts it — measured live as inputFound:false on
// a page whose Upload menu item works fine — and starting that flow opens the
// native picker, which is OS chrome no CDP call can dismiss. Intercepting the
// chooser suppresses its UI while leaving the input behind for upload to fill,
// so the agent enables, walks the menu, uploads, and disables, and no dialog
// ever appears. Forgetting the last step leaves later Upload clicks silent,
// which is why the description says the dance out loud.

// WHY A STEP THAT IS ALREADY OPEN IS NOT OPENED AGAIN. A top-level menu is a
// toggle: measured live, walking the path twice in a row left the first walk
// with the dropdown open and the second one clicking it shut. So each step
// reads the level first, and only opens what is not already there: already open
// means the level has its children on screen, so clicking it again would close
// it, which is what made the second walk of one path fail.
//
// WHY A LEVEL IS WAITED FOR RATHER THAN ASSUMED. The page has not finished
// when the click returns — the Insert dropdown was still absent five seconds
// later in one measurement — so a tree read on a fixed gap reads a menu bar
// with no children and calls it a broken path. Every level waits for the
// rows it is looking for, and only a budget running out may report a break.
//
// WHY A BREAK NAMES THE LEVEL AND THE CONTENTS. "Upload from computer is not
// in the menu" sends an agent back to guessing. "the path broke at Image, and
// Insert holds: Table, Bookmark, Chart" hands it a map.

// WHY THE IMAGE SIZE IS READ FROM THE PICTURE AND NOT ASSUMED FROM THE VIEWPORT.
// A capture answers with bytes; a caller that is told "1430 by 963" can convert
// pixels to CSS without running anything, and a capture that was scaled to fit a
// size limit says so. The header is read where it is - a JPEG starts with a frame
// header that carries the size, a PNG with an IHDR chunk - because a size guessed
// from the viewport is wrong exactly when the agent needs it.

// WHY THOSE FOUR MARKERS ARE EXCLUDED. A JPEG frame header is SOF0 through SOF15,
// except the three that carry no frame at all - DHT, JPG and DAC - and those three
// have no size to read. Reading the first header that has one is why a caller gets
// 1430 by 963 rather than the width of a Huffman table.

const SOF = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];

const imageSize = async (data, format) => {
  const bytes = Buffer.from(String(data ?? ''), 'base64');
  if (format === 'png' && bytes.length > 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (format === 'jpeg') {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) break;
      const marker = bytes[at + 1];
      const length = bytes.readUInt16BE(at + 2);
      const frame = SOF.includes(marker);
      if (frame) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      at += 2 + length;
    }
  }
  return { width: 0, height: 0 };
};

// WHY AN EDIT CHECKS THE PAGE INSTEAD OF TRUSTING ITS OWN SUCCESS. Measured live on
// this machine, against a Google Docs document whose window had been minimized: five
// characters were typed, the call answered with the number of characters it had
// inserted, and the document did not hold one of them. A page with no caret takes
// text and drops it, and the protocol has no answer for that - so the page is asked
// what it holds, before and after, and the two answers are compared.
//
// WHY THE SIGNATURE IS A LENGTH AND A TAIL, NOT THE TEXT. A document can be hundreds
// of kilobytes, and an edit that reads the whole of it twice costs more than the edit.
// The tail changes whenever anything near the caret changes, and the length catches
// everything else, so a few hundred characters carry the whole claim.
//
// WHY THE FOCUSED ELEMENT IS IN IT AS WELL. Text typed into a field does not change
// the text of the page, so a page-only comparison would call every correctly typed
// field a failure. Measured live: the caret in Google Docs lives in an iframe and the
// document text is in the body, while a text field lives in the element itself - so
// both are compared and either one moving counts as the text landing.
//
// WHY PLACEMENT IS ASKED AFTER EVERY EDIT. Measured live on a Google Doc: a batch
// reported landed:true from inside a table cell, and nothing in the answer said
// where. landed proves the page changed; it cannot prove where, because the page
// changes the same way wherever the caret happens to be. So the page is asked for
// the index and neighbours of what was just inserted: one evaluation, the last
// occurrence of the opening words, whitespace folded because innerText renders
// rather than stores. A probe that matches nothing is found:false, not a failure -
// the page moved, and the proof is weaker than the verdict.
//
// WHY THE CLICK ASKS WHAT IT HIT. The same reason from the other side: a click
// answers with the element under the point - tag, role, name - so a drive can tell
// a button from the void around it. On a canvas page elementFromPoint sees only the
// canvas, and the answer says canvas:true rather than inventing a name for a pixel.

export const locateExpression = (probe) => `(() => {
  const t = document.body ? String(document.body.innerText || '').replace(/\\s+/g, ' ') : '';
  const el = document.activeElement;
  const tag = el ? el.tagName : '';
  const editable = Boolean(el) && (el.isContentEditable === true || /^(INPUT|TEXTAREA)$/i.test(tag));
  const v = editable ? String(el.value != null ? el.value : el.textContent || '').replace(/\\s+/g, ' ') : '';
  const probe = ${JSON.stringify(probe)}.replace(/\\s+/g, ' ');
  const inBody = t.lastIndexOf(probe);
  const inValue = inBody >= 0 ? -1 : v.lastIndexOf(probe);
  const at = inBody >= 0 ? inBody : inValue;
  const hay = inBody >= 0 ? t : v;
  return {
    index: at,
    field: inBody < 0 && inValue >= 0,
    before: at < 0 ? t.slice(-40) : hay.slice(Math.max(0, at - 40), at),
    after: at < 0 ? '' : hay.slice(at + probe.length, at + probe.length + 40),
    len: t.length
  };
})() /*opera-locate*/`;

export const hitExpression = (x, y) => `(() => {
  const el = document.elementFromPoint(${Math.round(Number(x) || 0)}, ${Math.round(Number(y) || 0)});
  if (!el) return null;
  const get = (name) => (el.getAttribute ? el.getAttribute(name) : null);
  const name = get('aria-label') || (typeof el.value === 'string' ? el.value : '') || el.innerText || el.textContent || '';
  return { tag: el.tagName || '', role: get('role') || '', name: String(name).trim().slice(0, 60) };
})() /*opera-hit*/`;

// WHY THE SCROLLER IS FOUND BY ITS SCROLL HEIGHT. Measured live on a Google Doc with
// 21 pages: the document scroller is div.kix-appview-editor with 21,874 pixels of
// travel, and the first version of this found it by walking up from a text node and
// therefore missed it, because a canvas editor holds its content as pixels and the text
// nodes around it belong to the chrome. A scroller is anything with room to move; the
// tallest room wins, the document itself comes first when it has room of its own, and
// the answer names which one moved - because the one that moved is not the one a caller
// would have guessed.
//
// WHY THE WHEEL IS NOT USED HERE. Measured live: a synthetic mouseWheel over the Docs
// canvas gets no answer at all from the tab - the command was still outstanding after
// eight seconds - on both documents tried. A scroll that hangs is worse than a scroll
// that does nothing, so the offset is set directly and the result is measured after.
//
// WHY "AT THE END" MEANS THE LAST TEXT IS ON SCREEN. An offset can sit at the bottom of
// a scroller while the content the caller came for lives in another. The only end that
// means anything is the one where the last words of the page are visible, and that is a
// question about the viewport, not about a number.

export const scrollExpression = (probe) => `(() => {
  const wanted = ${JSON.stringify(probe ?? null)};
  const doc = document.scrollingElement || document.documentElement;
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const onScreen = (box) => box.bottom > 0 && box.top < viewport.h && box.right > 0 && box.left < viewport.w;
  const canMove = (el) => el && el.scrollHeight - el.clientHeight > 40 && el.clientHeight > 80;
  const nameOf = (el) => el === doc
    ? 'document'
    : String(el.tagName || '').toLowerCase() + (el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : '');
  const lastText = (() => {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let last = null;
    let node = walker.nextNode();
    while (node) {
      if ((node.nodeValue || '').trim()) last = node;
      node = walker.nextNode();
    }
    return last ? last.parentElement : null;
  })();
  const pickScroller = () => {
    const all = document.querySelectorAll('div, main, section');
    const rooms = [];
    for (const el of all) {
      if (canMove(el)) rooms.push(el);
    }
    rooms.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    // WHY THE DOCUMENT DOES NOT WIN BY BEING FIRST. Measured live on a Google Doc:
    // the window itself has 56 pixels of travel - the toolbar strip - and the
    // document below it has 21,874, so preferring the window scrolls 56 pixels and
    // reports a page that barely moved. The container with the most room is the page
    // the caller meant; the window only wins by having more of it.
    const best = rooms[0];
    const docRoom = canMove(doc) ? doc.scrollHeight - doc.clientHeight : 0;
    const bestRoom = best ? best.scrollHeight - best.clientHeight : 0;
    if (canMove(doc) && docRoom >= bestRoom) return doc;
    return best ?? doc;
  };
  const before = { x: Math.round(window.scrollX), y: Math.round(window.scrollY) };
  let root = doc;
  let target = { found: false, visible: false, y: 0, text: '' };
  const finish = (extra) => ({
    from: before,
    to: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    root: nameOf(root),
    target,
    ...extra
  });
  if (wanted && typeof wanted === 'object' && wanted.selector) {
    const el = document.querySelector(wanted.selector);
    if (el) {
      root = pickScroller();
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = el.getBoundingClientRect();
      target = { found: true, visible: onScreen(box), y: Math.round(box.top), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) };
    }
    return finish({ scroller: { name: nameOf(root), from: 0, to: 0 }, movedPx: target.visible ? 1 : 0, atEnd: false });
  }
  if (wanted && typeof wanted === 'object' && wanted.text) {
    const needle = String(wanted.text).replace(/\\s+/g, ' ').trim();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let hit = null;
    let node = walker.nextNode();
    while (node && !hit) {
      const one = (node.nodeValue || '').replace(/\\s+/g, ' ').trim();
      if (one && (one === needle || one.includes(needle))) hit = node.parentElement;
      node = walker.nextNode();
    }
    if (hit) {
      root = pickScroller();
      hit.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = hit.getBoundingClientRect();
      target = { found: true, visible: onScreen(box), y: Math.round(box.top), text: (hit.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) };
    }
    return finish({ scroller: { name: nameOf(root), from: 0, to: 0 }, movedPx: target.visible ? 1 : 0, atEnd: false });
  }
  root = pickScroller();
  const from = Math.round(root.scrollTop);
  if (wanted && typeof wanted === 'object' && wanted.end) root.scrollTop = root.scrollHeight;
  else root.scrollTop = from + (Number(wanted && wanted.y) || 0);
  const to = Math.round(root.scrollTop);
  const endVisible = lastText ? onScreen(lastText.getBoundingClientRect()) : false;
  const exhausted = to + root.clientHeight >= root.scrollHeight - 8;
  const atEnd = wanted && typeof wanted === 'object' && wanted.end ? endVisible : false;
  return finish({
    scroller: { name: nameOf(root), from, to },
    movedPx: Math.abs(to - from),
    atEnd,
    exhausted,
    travelPx: Math.round(root.scrollHeight - root.clientHeight)
  });
})() /*opera-scroll*/`;

// WHY ONE READ OF COMPUTED STYLE INSTEAD OF ONE READ PER PROPERTY. Measured live: an
// agent verifying a page without eyes needs facts like "did this button turn blue",
// "is this modal open", "is this text clipped by a line clamp" - and each of those is
// three properties on one element. So one evaluation returns the handful that decide
// those questions, and names the element it read, because a style read without the
// element it belongs to is a number nobody can act on. This replaces a format-specific
// reader: nothing here knows what a document is.

export const computedExpression = (probe) => `(() => {
  const probe = ${JSON.stringify(probe ?? {})};
  let el = null;
  if (probe.selector) el = document.querySelector(probe.selector);
  else if (typeof probe.x === 'number' && typeof probe.y === 'number') el = document.elementFromPoint(probe.x, probe.y);
  if (!el) return null;
  const style = window.getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const name = el.getAttribute('aria-label') || (typeof el.value === 'string' ? el.value : '') || el.innerText || el.textContent || '';
  const rect = {
    x: Math.round(box.left), y: Math.round(box.top),
    w: Math.round(box.width), h: Math.round(box.height),
    onScreen: box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth,
    clipped: box.bottom > window.innerHeight || box.right > window.innerWidth
  };
  return {
    tag: el.tagName || '',
    role: el.getAttribute('role') || '',
    name: String(name).replace(/\s+/g, ' ').trim().slice(0, 60),
    rect,
    font: style.fontFamily ? style.fontFamily.split(',')[0].replace(/["']/g, '').trim() : '',
    size: style.fontSize || '',
    weight: style.fontWeight || '',
    color: style.color || '',
    background: style.backgroundColor || '',
    display: style.display || '',
    visibility: style.visibility || '',
    opacity: style.opacity || '',
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true'
  };
})() /*opera-computed*/`;

export const EDIT_SIGNATURE_EXPRESSION = `(() => {
  const el = document.activeElement;
  const tag = el ? el.tagName : '';
  const editable = Boolean(el) && (el.isContentEditable === true || /^(INPUT|TEXTAREA)$/i.test(tag));
  const body = document.body ? String(document.body.innerText || '') : '';
  const value = editable ? String(el.value != null ? el.value : el.textContent || '') : '';
  return {
    body: body.length + ':' + body.slice(-160),
    value: value.length + ':' + value.slice(-80),
    holds: editable || body.trim().length > 0
  };
})()`;

// WHY THE CHECK ASKS A FIXED NUMBER OF TIMES INSTEAD OF WAITING ON A CLOCK. A page
// that has taken the text usually shows it on the next evaluation, and one that
// debounces - a document editor, a sheet formula - shows it later. The count is a
// count rather than a deadline so that the cost of the check is the same everywhere
// and can be reasoned about instead of measured.
//
// WHY THE TAIL IS LONG. Measured live on a Google Doc: two consecutive batches,
// the second reported "nothing on the page changed" while its text sat in the
// document - and the retry duplicated it. The canvas mirrors into the DOM on Docs
// time, and the outline lags saves by seconds, so a short budget mistakes a slow
// mirror for a dead page. Twelve asks at 150ms cost one evaluation when the page
// is quick - the loop exits on the first move - and a slow page gets the better
// part of two seconds before the verdict. A false failure writes the text twice;
// a slow verdict only arrives late.

const EDIT_POLL_MS = 150;
const EDIT_POLLS = 12;

// WHY THE APPEND WAITS A BEAT AFTER THE END KEY. The end key asks the editor to move
// its caret and scroll to it; a document that scrolls answers the next insert before
// the view has caught up, and text lands where the caret used to be. One beat is the
// cheapest way to let the view arrive, and it costs nothing when the view already has.

const APPEND_SETTLE_MS = 120;

export function createPrimitives(cdp, { chunkSize = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), fs = nodeFs, os = nodeOs, path = nodePath } = {}) {
  const capped = (limit) => Math.min(Math.max(1, Number(limit) || 120), 500);

  const readRows = async (limit) => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: snapshotExpression(limit),
      returnByValue: true,
      awaitPromise: false
    });
    return Array.isArray(result?.value) ? result.value : [];
  };

  // WHY THE SPOT TAKES ITSELF AWAY. Measured live on this product's own author: a
  // click marker that never goes leaves a red ring sitting on the page for the rest
  // of the session, and every capture after it carries that ring - so the picture an
  // agent reads its own click out of has a 26-pixel circle drawn on top of the thing
  // it just clicked. The mark is worth having for the beat in which the person
  // watching sees where the drive went; it is not worth leaving on the page.
  const SPOT_MS = 700;

  const spot = (x, y, color) => {
    const px = Math.round(Number(x) || 0);
    const py = Math.round(Number(y) || 0);
    return cdp.send('Runtime.evaluate', {
      expression: `(() => { const d = document; if (!d || !d.documentElement) return false; let el = d.getElementById('opera-spot'); if (!el) { el = d.createElement('div'); el.id = 'opera-spot'; el.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid;border-radius:50%;width:26px;height:26px;margin:0;padding:0;box-sizing:border-box;transition:opacity 120ms linear;'; d.documentElement.appendChild(el); } clearTimeout(d.defaultView.__operaSpot); el.style.opacity = '1'; el.style.left = '${px - 13}px'; el.style.top = '${py - 13}px'; el.style.borderColor = '${color}'; d.defaultView.__operaSpot = d.defaultView.setTimeout(() => { el.remove(); }, ${SPOT_MS}); return true; })()`,
      returnByValue: true
    }).catch(() => null);
  };

  const caretHostExpression = `
    const drawn = (() => { ${LOCAL_CARET_EXPRESSION} })();
    if (drawn) return drawn;
    try {
      const sel = document.getSelection();
      if (sel && sel.rangeCount === 1 && sel.isCollapsed) return sel.getRangeAt(0).startContainer.parentElement;
    } catch { /* a range that will not hand over its node is simply no host */ }
    return null;`;

  const scrollChainExpression = `
    const chain = [];
    for (let el = host.parentElement; el; el = el.parentElement) {
      chain.push(el);
      if (el === document.documentElement) break;
    }
    return chain;`;

  // WHY THE BOXES THAT SCROLL ARE FOUND BY A MARK AND NOT BY THE CARET. Measured
  // live: while the whole document is selected the page draws no caret at all, so
  // anything that walks up from the caret has nothing to walk up from — and the
  // view stayed at the end of the document, putting the caret onto a picture. The
  // boxes are marked while the caret is still there to be measured, and the marks
  // are taken off again as soon as the restore is done with them.
  const markedChainExpression = `
    return [...document.querySelectorAll('[${SCROLL_MARK}]')]
      .sort((a, b) => Number(a.getAttribute('${SCROLL_MARK}')) - Number(b.getAttribute('${SCROLL_MARK}')));`;

  const clearMarkExpression = `
    document.querySelectorAll('[${SCROLL_MARK}]').forEach((el) => el.removeAttribute('${SCROLL_MARK}'));`;

  const scrollSumExpression = `
    return chain.reduce((acc, el) => ({ x: acc.x + el.scrollLeft, y: acc.y + el.scrollTop }), { x: 0, y: 0 });`;

  const rememberCaret = async () => primitives.evaluate(`(() => {
    const host = (() => { ${caretHostExpression} })();
    if (!host) return null;
    const box = host.getBoundingClientRect();
    if (!box || (!box.width && !box.height)) return null;
    const chain = (() => { ${scrollChainExpression} })();
    (() => { ${clearMarkExpression} })();
    chain.forEach((el, i) => el.setAttribute('${SCROLL_MARK}', String(i)));
    const sum = (() => { ${scrollSumExpression} })();
    const y = Math.round(box.top + box.height / 2);
    return {
      x: Math.round(box.left),
      y,
      absX: Math.round(box.left + sum.x),
      absY: Math.round(y + sum.y),
      scroll: chain.map((el) => [el.scrollLeft, el.scrollTop])
    };
  })()`);

  const putCaretBack = async (mark) => {
    if (!mark || !Array.isArray(mark.scroll)) return lost('the page showed no caret to remember');
    const pairs = JSON.stringify(mark.scroll.map(([x, y]) => [Number(x) || 0, Number(y) || 0]));
    const where = JSON.stringify([Number(mark.absX) || 0, Number(mark.absY) || 0]);
    let point = null;
    for (let attempt = 1; attempt <= CARET_SCROLL_ATTEMPTS; attempt += 1) {
      point = await primitives.evaluate(`(() => {
        const chain = (() => { ${markedChainExpression} })();
        const want = ${pairs};
        if (!chain.length || chain.length !== want.length) return { why: 'the page no longer has the boxes that were scrolling, so the place is not the one that was measured' };
        chain.forEach((el, i) => { el.scrollLeft = want[i][0]; el.scrollTop = want[i][1]; });
        const settled = chain.every((el, i) => el.scrollLeft === want[i][0] && el.scrollTop === want[i][1]);
        const now = (() => { ${scrollSumExpression} })();
        const mark = ${where};
        let x = Math.round(mark[0] - now.x);
        let y = Math.round(mark[1] - now.y);
        const inner = chain[0];
        if (inner && (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth)) {
          const dy = y < 0 ? y - 8 : Math.max(0, y - window.innerHeight + 8);
          const dx = x < 0 ? x - 8 : Math.max(0, x - window.innerWidth + 8);
          inner.scrollTop += dy;
          inner.scrollLeft += dx;
          x -= dx;
          y -= dy;
        }
        return { x, y, settled };
      })()`);
      if (point?.why) return lost(point.why);
      if (attempt > 1 && point.settled) break;
      await sleep(CARET_SCROLL_SETTLE_MS);
    }
    if (point.settled) await primitives.clickAt(point.x, point.y).catch(() => null);
    await sleep(CARET_RESTORE_GAP_MS);
    const seen = await primitives.evaluate(`(() => {
      const chain = (() => { ${markedChainExpression} })();
      const want = ${pairs};
      if (chain.length === want.length) {
        chain.forEach((el, i) => { el.scrollLeft = want[i][0]; el.scrollTop = want[i][1]; });
      }
      (() => { ${clearMarkExpression} })();
      const host = (() => { ${caretHostExpression} })();
      if (!host) return { why: 'the page showed no caret after the click' };
      const box = host.getBoundingClientRect();
      const sum = (() => { ${scrollSumExpression} })();
      return {
        absX: Math.round(box.left + sum.x),
        absY: Math.round(box.top + box.height / 2 + sum.y),
        settled: chain.every((el, i) => el.scrollLeft === want[i][0] && el.scrollTop === want[i][1])
      };
    })()`);
    if (!seen || seen.why) return lost(seen?.why ?? 'the page lost the caret again', point.settled);
    const same = Math.abs(seen.absX - mark.absX) <= CARET_TOLERANCE_PX
      && Math.abs(seen.absY - mark.absY) <= CARET_TOLERANCE_PX;
    if (!same) {
      return lost(point.settled
        ? 'the caret is not where it was left, so the click did not take'
        : 'the view did not go back where it was, so the place no longer holds the caret', point.settled && seen.settled);
    }
    return { caretRestored: true, viewRestored: seen.settled, caretWhy: '' };
  };

  const lost = (caretWhy, viewRestored = false) => ({ caretRestored: false, viewRestored, caretWhy });

  const insertText = async (text) => {
    const parts = splitText(text, chunkSize);
    await Promise.all(parts.map((part) => cdp.send('Input.insertText', { text: part })));
    return { chunks: parts.length, chars: String(text ?? '').length };
  };

  const editSignature = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: EDIT_SIGNATURE_EXPRESSION,
      returnByValue: true
    });
    return result?.value ?? { body: '', value: '', holds: false };
  };

  const moved = (before, after) => after.body !== before.body || after.value !== before.value;

  const sigLen = (sig) => Number(String(sig ?? '').split(':')[0]) || 0;

  const probeOf = (text) => String(text ?? '').replace(/^\s+/, '').slice(0, 32);

  const locateInsertion = async (text, before, after) => {
    const delta = (sigLen(after?.body) - sigLen(before?.body)) + (sigLen(after?.value) - sigLen(before?.value));
    const probe = probeOf(text);
    if (!probe) return { found: false, index: -1, field: false, before: '', after: '', delta };
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: locateExpression(probe), returnByValue: true });
      const at = result?.value;
      if (!at || typeof at.index !== 'number' || at.index < 0) {
        return { found: false, index: -1, field: false, before: String(at?.before ?? ''), after: '', delta };
      }
      return { found: true, index: at.index, field: at.field === true, before: String(at.before ?? ''), after: String(at.after ?? ''), delta };
    } catch {
      return { found: false, index: -1, field: false, before: '', after: '', delta };
    }
  };

  const hitAt = async (x, y) => {
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: hitExpression(x, y), returnByValue: true });
      const el = result?.value;
      if (!el) return null;
      const tag = String(el.tag ?? '');
      return { tag, role: String(el.role ?? ''), name: String(el.name ?? ''), canvas: tag === 'CANVAS' };
    } catch {
      return null;
    }
  };

  const waitForEdit = async (before) => {
    for (let ask = 0; ask < EDIT_POLLS; ask += 1) {
      if (ask > 0) await sleep(EDIT_POLL_MS);
      const now = await editSignature();
      if (moved(before, now)) return { moved: true, after: now };
    }
    return { moved: false, after: await editSignature() };
  };

  const readState = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: '({ title: document.title, url: location.href, text: document.body ? document.body.innerText : "" })',
      returnByValue: true
    });
    return result?.value ?? { title: '', url: '', text: '' };
  };

  const primitives = {
    async navigate(url) {
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url });
      return primitives.waitForIdle();
    },

    async front() {
      await cdp.send('Page.bringToFront', {});
      return true;
    },

    async read() {
      const state = await readState();
      if (!isDocsDocument(state.url)) return { ...state, caretMoved: false, caretRestored: true, viewRestored: true, caretWhy: '' };
      const mark = await rememberCaret();
      const text = await readDocsText();
      const back = await putCaretBack(mark);
      return { ...state, text: text ?? state.text, caretMoved: true, ...back };
    },

    async caretLine() {
      const { url } = await readState();
      const mark = await rememberCaret();
      await primitives.key('Home');
      await sleep(CARET_LINE_GAP_MS);
      await primitives.key('End', ['Shift']);
      await sleep(CARET_LINE_GAP_MS);
      const line = isDocsDocument(url) ? await copyDocsText() : await primitives.evaluate(SELECTION_TEXT_EXPRESSION);
      await primitives.key('End').catch(() => null);
      const back = await putCaretBack(mark);
      return { line: typeof line === 'string' ? line : '', caretMoved: true, ...back };
    },

    async upload({ filename, data = null, path: filePath = null } = {}) {
      if (!filename || typeof filename !== 'string') throw new Error('upload needs a filename.');
      const hasData = data !== null && data !== undefined;
      const hasPath = filePath !== null && filePath !== undefined;
      if (hasData === hasPath) throw new Error('upload needs exactly one of data or path.');
      let target;
      let bytes;
      let cleanup = null;
      if (hasPath) {
        if (!fs.existsSync(filePath)) throw new Error(`upload: no such file ${JSON.stringify(filePath)}`);
        target = filePath;
        bytes = fs.statSync(target).size;
      } else {
        const decoded = Buffer.from(String(data), 'base64');
        if (decoded.length === 0) throw new Error('upload: data carries no bytes.');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-upload-'));
        target = path.join(dir, path.basename(filename));
        fs.writeFileSync(target, decoded);
        bytes = decoded.length;
        cleanup = () => {
          try {
            fs.unlinkSync(target);
          } catch {}
          try {
            fs.rmdirSync(dir);
          } catch {}
        };
      }

      // WHY THE FINDER ASKS CDP BEFORE ASKING THE PAGE, AND SWEEPS THE FRAMES.
      // A page script can only walk shadow roots it is allowed to see, and
      // Google Docs keeps its image input in a closed one inside its picker
      // frame: the script reported no input while the input was demonstrably
      // there. `DOM.querySelectorAll` with `pierce` answers for a whole document,
      // closed roots included, and returns only the matches — the entire pierced
      // tree fetched at once timed out live on a heavy page. `pierce` does not
      // cross into a child frame, though, so each frame is asked for its owner,
      // its owner's content document, and then the same pierced query. The page
      // script stays as the last road: it is the only one that can follow a
      // frame the browser will not describe.

      const FILE_INPUT_SELECTOR = 'input[type=file]';

      const piercedInputIn = async (nodeId) => {
        const found = await cdp.send('DOM.querySelectorAll', { nodeId, selector: FILE_INPUT_SELECTOR, pierce: true });
        const hit = found?.nodeIds?.[0];
        if (!hit) return null;
        const described = await cdp.send('DOM.describeNode', { nodeId: hit });
        return described?.node?.backendNodeId ?? null;
      };
      const findInputNode = async () => {
        const document_ = await cdp.send('DOM.getDocument', { depth: 0, pierce: true });
        const rootNodeId = document_?.root?.nodeId;
        return rootNodeId ? piercedInputIn(rootNodeId) : null;
      };
      const findInputInFrames = async () => {
        const tree = await cdp.send('Page.getFrameTree');
        const frames = [];
        const collect = (node) => {
          if (node?.frame?.id) frames.push(node.frame.id);
          for (const child of node?.childFrames ?? []) collect(child);
        };
        collect(tree?.frameTree);
        for (const frameId of frames) {
          const owner = await cdp.send('DOM.getFrameOwner', { frameId }).catch(() => null);
          if (!owner?.backendNodeId) continue;
          const described = await cdp.send('DOM.describeNode', { backendNodeId: owner.backendNodeId }).catch(() => null);
          const documentNodeId = described?.node?.contentDocument?.nodeId ?? null;
          if (!documentNodeId) continue;
          const hit = await piercedInputIn(documentNodeId).catch(() => null);
          if (hit) return hit;
        }
        return null;
      };
      const findInputScript = async () => {
        const found = await cdp.send('Runtime.evaluate', {
          expression: UPLOAD_INPUT_EXPRESSION,
          returnByValue: false,
          objectGroup: 'opera-upload'
        });
        return found?.result?.objectId ?? null;
      };
      try {
        let node = null;
        let objectId = null;
        for (let attempt = 0; attempt < UPLOAD_FIND_ATTEMPTS && !node && !objectId; attempt++) {
          node = await findInputNode().catch(() => null);
          if (!node) node = await findInputInFrames().catch(() => null);
          if (!node) objectId = await findInputScript().catch(() => null);
          if (!node && !objectId && attempt + 1 < UPLOAD_FIND_ATTEMPTS) await sleep(UPLOAD_FIND_GAP_MS);
        }
        if (node) {
          await cdp.send('DOM.setFileInputFiles', { files: [target], backendNodeId: node });
          return { inputFound: true, filename, bytes };
        }
        if (!objectId) return { inputFound: false, filename };
        await cdp.send('DOM.setFileInputFiles', { files: [target], objectId });
        return { inputFound: true, filename, bytes };
      } finally {
        if (cleanup) cleanup();
        await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'opera-upload' }).catch(() => null);
      }
    },

    async dropFile({ x, y, filename, data = null, path: filePath = null } = {}) {
      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
        throw new Error('drop_file needs x and y in the viewport.');
      }
      if (!filename || typeof filename !== 'string') throw new Error('drop_file needs a filename.');
      const hasData = data !== null && data !== undefined;
      const hasPath = filePath !== null && filePath !== undefined;
      if (hasData === hasPath) throw new Error('drop_file needs exactly one of data or path.');
      let target;
      let bytes;
      let cleanup = null;
      if (hasPath) {
        if (!fs.existsSync(filePath)) throw new Error(`drop_file: no such file ${JSON.stringify(filePath)}`);
        target = filePath;
        bytes = fs.statSync(target).size;
      } else {
        const decoded = Buffer.from(String(data), 'base64');
        if (decoded.length === 0) throw new Error('drop_file: data carries no bytes.');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opera-drop-'));
        target = path.join(dir, path.basename(filename));
        fs.writeFileSync(target, decoded);
        bytes = decoded.length;
        cleanup = () => {
          try {
            fs.unlinkSync(target);
          } catch {}
          try {
            fs.rmdirSync(dir);
          } catch {}
        };
      }
      const mimeType = dragMimeType(filename);
      const payload = {
        items: [{ mimeType, title: filename, data: '' }],
        files: [target],
        dragOperationsMask: 1
      };

      // WHY DRAGS ARE INTERCEPTED FIRST AND RELEASED ON EVERY WAY OUT. Chrome
      // only accepts a dispatched drag while interception is on, and a page left
      // in that state stops believing real ones — the pointer would do nothing on
      // this tab until it was released, which is worse than the problem being
      // solved. So the release is in the finally, where a failure still reaches.
      try {
        await cdp.send('Page.bringToFront');
        await sleep(DROP_FRONT_SETTLE_MS);
        await cdp.send('Input.setInterceptDrags', { enabled: true });
        for (const phase of DROP_PHASES) {
          await cdp.send('Input.dispatchDragEvent', { type: phase, x: Number(x), y: Number(y), data: payload });
          await sleep(DROP_PHASE_GAP_MS);
        }
        await sleep(DROP_SETTLE_MS);
        return { dropped: true, filename, bytes, x: Number(x), y: Number(y), mimeType };
      } finally {
        await cdp.send('Input.setInterceptDrags', { enabled: false }).catch(() => null);
        if (cleanup) cleanup();
      }
    },

    async interceptFileChooser(enabled) {
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: enabled === true });
      return { intercepting: enabled === true };
    },

    async ask(method, params = {}) {
      return cdp.send(method, params);
    },

    async evaluate(expression) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true
      });
      return result?.value;
    },

    async type(text) {
      const before = await editSignature();
      const out = await insertText(text);
      const seen = await waitForEdit(before);
      if (!seen.moved) {
        throw new Error(seen.after.holds
          ? `typed ${out.chars} characters and nothing on the page changed: there is no caret here, or the browser window is minimized`
          : `typed ${out.chars} characters into a page that holds no text and no field to receive them`);
      }
      return { ...out, landed: true, placed: await locateInsertion(text, before, seen.after) };
    },

    // WHY AN APPEND AND NOT A TYPE. Measured live while building a thesis: the road to
    // the end of a document was click somewhere, press Ctrl+End, and trust the caret -
    // and once it did not go where it was told, a whole batch landed inside a table
    // cell and recovering cost four extra calls and an undo. An append is that promise
    // with the positioning inside it.
    //
    // WHY "AT THE END" IS READ AND NOT AIMED FOR. Moving a caret to the end of a long
    // canvas document and reading the caret back is several round trips against a
    // surface that mirrors into the DOM on the editor's own schedule. What one
    // evaluation can answer is whether anything follows the text that was just
    // inserted: at the end, nothing does. So atEnd is measured, and when the mirror is
    // too stale to tell, the answer says found:false instead of claiming it. Measured
    // live on a Google Doc: five appends in a row each reported atEnd false, because
    // what followed the inserted text was the editor's own chrome ("Banner hidden new
    // line 1 by 1") rather than document text. The appends were at the end; a strict
    // measure cannot see past a canvas editor's chrome, so it names what followed
    // rather than guessing either way.

    async append(text) {
      const chars = String(text ?? '').length;
      await primitives.key('End', ['Control']);
      await sleep(APPEND_SETTLE_MS);
      const typed = await primitives.type(text);
      const atEnd = typed.placed.found && String(typed.placed.after ?? '').trim() === '';
      return {
        ...typed,
        chars,
        atEnd,
        atEndWhy: typed.placed.found
          ? (atEnd ? 'nothing follows the inserted text' : `text follows it: "${String(typed.placed.after).trim().slice(0, 40)}"`)
          : 'the page could not say where the text went - read_page() is the proof on a canvas page'
      };
    },

    async key(name, modifiers = []) {
      const mask = modifierMask(modifiers);
      const descriptor = describeKey(name);

      if (mask !== 0) {
        const chord = {
          key: descriptor.key,
          code: descriptor.code,
          windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
          nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode
        };
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: mask, ...chord });
        await sleep(KEY_BEAT_MS);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, ...chord });
        return { key: name, modifiers: mask };
      }

      const printable = Object.prototype.hasOwnProperty.call(descriptor, 'text');
      const frame = printable
        ? { type: 'keyDown', modifiers: mask, ...descriptor }
        : { type: 'rawKeyDown', modifiers: mask, key: descriptor.key, code: descriptor.code, windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode };

      await cdp.send('Input.dispatchKeyEvent', frame);
      await sleep(KEY_BEAT_MS);
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', modifiers: mask, key: descriptor.key, code: descriptor.code,
        windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode
      });

      return { key: name, modifiers: mask };
    },

    // WHY A STREAM REPORTS THE COMPARISON INSTEAD OF A VERDICT. A shortcut in the
    // middle of a stream can change the page without the text ever landing, so "the
    // page changed" is the strongest thing a stream can honestly say - and it is the
    // thing an agent needs to decide whether to look again.

    async keys(events) {
      if (!Array.isArray(events) || events.length === 0) throw new Error('keys needs a non-empty event array.');
      if (events.length > 100) throw new Error('keys holds at most 100 events.');
      for (const [index, event] of events.entries()) {
        const gapMs = event?.gapMs ?? 0;
        if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > 2000) throw new Error(`event ${index} gap must be between 0 and 2000 ms.`);
        if (event?.text != null && event?.key != null) throw new Error(`event ${index} must be text or a key, not both.`);
        if (event?.text == null && event?.key == null) throw new Error(`event ${index} needs text or a key.`);
        if (event?.key != null) describeKey(event.key);
      }
      const started = Date.now();
      const before = await editSignature();
      let chords = 0;
      let chars = 0;
      let run = [];
      const reportMoved = async () => (await waitForEdit(before)).moved;

      const flush = async () => {
        for (const job of run) {
          const out = await job.go();
          if (job.kind === 'text') chars += out.chars;
          else {
            chords += 1;
            await sleep(KEY_BEAT_MS);
          }
        }
        run = [];
      };
      for (const event of events) {
        if (event.text != null) run.push({ kind: 'text', go: () => insertText(String(event.text)) });
        else run.push({ kind: 'chord', go: () => primitives.key(event.key, event.modifiers ?? []) });
        if ((event.gapMs ?? 0) > 0) {
          await flush();
          await sleep(event.gapMs);
        }
      }
      await flush();
      return { events: events.length, chords, chars, moved: await reportMoved(), execMs: Date.now() - started };
    },

    // WHY A CLICK TAKES A FRACTION AS WELL AS A PIXEL. Measured live by resizing
    // this machine's browser window: the viewport went 1144x714 to 1186x670 while
    // the device scale stayed at 1.25, so the same CSS pixel stopped meaning the
    // same place. A fraction is resolved against the viewport as it is at the
    // moment of the click, which survives that, and the answer says which pixels it
    // became and in what space - so a caller that meant a fixed pixel still gets the
    // truth about the space it landed in.
    async clickFraction(at) {
      const view = await primitives.viewport();
      const asked = { x: Number(at?.x) || 0, y: Number(at?.y) || 0 };
      const x = Math.round(Math.min(1, Math.max(0, asked.x)) * view.width);
      const y = Math.round(Math.min(1, Math.max(0, asked.y)) * view.height);
      await primitives.clickAt(x, y);
      return { x, y, of: asked, viewport: { width: view.width, height: view.height }, dpr: view.dpr };
    },

    // WHY ONE CALL, AND WHY IT ANSWERS WHAT IT DID. A scroll that moved the page and a
    // scroll that moved the right thing look identical from outside, so the answer
    // carries the scroller that moved and by how much, and - for a target - whether
    // that target is on screen now. Nothing here is aimed for: every fact is read
    // after the fact.
    //
    // WHY "AT THE END" CAN BE FALSE AND MEANS NOTHING MOVED. Measured live on a Google
    // Doc: an end scroll moved the document element 56 pixels and answered atEnd true,
    // because the document is not what scrolls on a canvas editor. So atEnd is true only
    // when the page reports its last text on screen, and the scroller that answers is
    // named - a refusal to claim an end it did not reach is the whole value here.

    async scroll({ y, end = false, text, selector } = {}) {
      const probe = { y: Number.isFinite(Number(y)) ? Number(y) : undefined, end: end === true, text, selector };
      void end;
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: scrollExpression(probe),
        returnByValue: true
      });
      const seen = result?.value ?? {
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        scroller: { name: 'unknown', from: 0, to: 0 },
        movedPx: 0,
        atEnd: false,
        root: 'unknown',
        target: { found: false, visible: false, y: 0, text: '' }
      };
      const wanted = text ?? selector;
      return {
        from: seen.from,
        to: seen.to,
        scroller: seen.scroller,
        movedPx: seen.movedPx,
        atEnd: seen.atEnd === true,
        travelPx: seen.travelPx ?? null,
        root: seen.root,
        target: seen.target,
        why: wanted && !seen.target?.found
          ? `found nothing on this page for ${JSON.stringify(String(wanted).slice(0, 40))} - read_page() to see what the page holds`
          : (end && !seen.atEnd
              ? (seen.exhausted
                  ? `${seen.root} is as far as it goes, and this page cannot show that its last words are on screen - the text it reports is not the text it draws, so capture_page() or read_page() is the proof`
                  : `moved ${seen.movedPx} of the way and the page still has text below`)
              : (!seen.movedPx && !seen.target?.visible
                  ? `nothing moved: ${seen.root} had no room to move (travelPx ${seen.travelPx ?? 'unknown'})`
                  : ''))
      };
    },

    // WHY THE ANSWER NAMES THE ELEMENT IT READ. A style value without its element is a
    // number nobody can act on, and two elements can share a colour and mean opposite
    // things. So tag, role, name and the box come back with the values, and rect says
    // whether the element is on screen or running past the viewport - which is the
    // difference between "the page shows a blue button" and "a blue button exists
    // somewhere below".

    async computed({ x, y, selector } = {}) {
      const probe = {
        selector: selector ?? undefined,
        x: Number.isFinite(Number(x)) ? Number(x) : undefined,
        y: Number.isFinite(Number(y)) ? Number(y) : undefined
      };
      if (!probe.selector && (probe.x === undefined || probe.y === undefined)) {
        throw new Error('computed needs a selector, or an x and a y inside the viewport');
      }
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: computedExpression(probe),
        returnByValue: true
      });
      const seen = result?.value ?? null;
      if (!seen) {
        return {
          found: false,
          why: probe.selector
            ? `no element on this page matches ${JSON.stringify(String(selector).slice(0, 40))}`
            : `nothing at ${probe.x},${probe.y} - ax_snapshot() to see what is on screen`
        };
      }
      return { found: true, ...seen };
    },

    async clickAt(x, y) {
      const common = { x, y, button: 'left', clickCount: 1, buttons: 1 };
      await Promise.all([
        spot(x, y, 'rgb(255,60,60)'),
        cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }),
        cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common }),
        cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common })
      ]);
      return { x, y, hit: await hitAt(x, y) };
    },

    // WHY A SUBMENU IS HOVERED AND NOT CLICKED. Clicking a row that turns out to be

// a branch runs whatever it was — Delete, Remove, Send. Hover opens the same
// submenu and activates nothing, so it is what the walker uses, and only a
// click is used when the caller says the item is a command.
//
// WHY THE POINTER LEAVES FIRST. Measured live: a submenu that would not open on
// hover opened once the pointer was sent somewhere else first and came back. A
// menu that has never seen the pointer arrive from outside does not treat the
// hover as entering it, so the away-and-back is not politeness, it is the enter
// transition the menu is waiting for.

    async hoverRow(row) {
      const away = row.y > 200 ? { x: row.x, y: Math.max(2, row.y - 160) } : { x: row.x, y: row.y + 160 };
      await primitives.hover(away.x, away.y);
      await sleep(MENU_HOVER_GAP_MS);
      const here = await primitives.handleBox(row.handle);
      await primitives.hover(here.x, here.y);
      await sleep(MENU_OPEN_GAP_MS);
      return here;
    },

    async menuTree({ limit } = {}) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: menuTreeExpression(limit),
        returnByValue: true,
        awaitPromise: false
      });
      const rows = Array.isArray(result?.value) ? result.value : [];
      return rows.map((row) => ({ ...row, state: stateOf(row), revealedBy: revealOf(row), handle: null }));
    },

    async openMenu({ path = [], clickLeaf = false, limit, timeoutMs = 8000 } = {}) {
      const wanted = path.map((step) => String(step ?? '').trim()).filter(Boolean);
      if (wanted.length === 0) return { opened: false, at: [], tree: await primitives.menuTree({ limit }) };
      let rows = await primitives.menuTree({ limit });
      const at = [];
      for (let index = 0; index < wanted.length; index += 1) {
        const name = wanted[index];
        const last = index + 1 === wanted.length;
        const deadline = Date.now() + timeoutMs;
        let node = findNode(name, rows.filter((row) => row.depth === index));
        let here = rows.filter((row) => row.depth === index);
        while (!node && Date.now() < deadline) {
          await primitives.waitForRow({ role: 'menuitem', name, timeoutMs: 400, intervalMs: 120 });
          rows = await primitives.menuTree({ limit });
          here = rows.filter((row) => row.depth === index);
          node = findNode(name, here);
        }
        if (!node) {
          const levelNames = [...new Set(here.map((row) => row.name))];
          return {
            opened: false,
            at,
            brokeAt: name,
            level: index,
            visible: levelNames.slice(0, 20),
            nearest: nearestNames(name, levelNames),
            tree: rows
          };
        }
        at.push(node.name);
        const row = await primitives.resolveHandle(node);
        const alreadyOpen = Boolean(node.expanded) && here.some((r) => r.depth === index + 1);
        let acted = false;
        if (!alreadyOpen) {
          // WHY A TOP-LEVEL MENU IS CLICKED AND EVERYTHING BELOW IT IS HOVERED.
          // Measured live on Google Docs: a menu on the bar is a toggle - hover does
          // nothing and it only opens on a click - while a submenu opens on hover.
          // And a leaf that turns out to be a command is never clicked on the way to
          // anywhere else: "Upload from computer" opens the operating system's own
          // file dialog, which nothing here can close again. So a click goes out for
          // the bar item that opens the menu, and for a leaf only when the caller
          // said this item is the command to run.
          if (index === 0) {
            await primitives.clickAt(row.x, row.y);
            acted = true;
          } else if (node.branch) {
            await primitives.hoverRow(row);
          } else if (last && clickLeaf) {
            await primitives.clickAt(row.x, row.y);
            acted = true;
          }
          const hoverAgain = index > 0 && node.branch;
          const childDeadline = Date.now() + timeoutMs;
          for (;;) {
            rows = await primitives.menuTree({ limit });
            if (rows.some((found) => found.depth === index + 1) || Date.now() >= childDeadline) break;
            if (hoverAgain) await primitives.hoverRow(row);
            await sleep(MENU_OPEN_POLL_MS);
          }
        } else {
          rows = await primitives.menuTree({ limit });
        }
        if (last) {
          return { opened: true, at, acted, row: findNode(name, rows.filter((r) => r.depth === index)) ?? node, tree: rows };
        }
      }
      return { opened: true, at, acted, tree: rows };
    },

    async hover(x, y) {
      const mark = spot(x, y, 'rgb(66,133,244)');
      const moved = cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await Promise.all([mark, moved]);
      return { x, y };
    },

    async selectAll() {
      return primitives.key('a', ['Control']);
    },

    async clear() {
      await primitives.selectAll();
      await primitives.key('Delete');
    },

    // WHY THE PAGE IS ASKED BEFORE THE MACHINE, AND WHY IT IS ENOUGH. Measured live
    // on this machine, twice, with the drive typing into a Google Docs document: a
    // browser behind another application still reported focus here and took the text,
    // and a minimized browser reported no focus and dropped it. So this one
    // evaluation answers the only case that costs anything to be wrong about, and
    // the machine is asked only when it says the page is deaf.
    async hasFocus() {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: 'document.hasFocus()',
        returnByValue: true
      });
      return result?.value === true;
    },

    async viewport() {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })',
        returnByValue: true
      });
      return result?.value ?? { width: 0, height: 0, dpr: 1 };
    },

    // WHY A CAPTURE ANSWERS WITH THE SPACE IT WAS TAKEN IN. Measured live by
    // resizing this machine's browser window: the viewport went 1144x714 -> 1186x670
    // and the capture went 1430x963 -> 1483x838, with the scale factor constant at
    // 1.25. So the picture is the CSS viewport times the device's scale, and both
    // move under the agent's feet: a window resized, a window dragged to a monitor
    // with another scale. An agent given a picture and nothing else has to guess
    // that number, and it guesses wrong - which is how a click lands on the wrong
    // thing while every answer says the click was delivered.
    async captureSized({ format = 'jpeg', quality = 60, fullPage = false } = {}) {
      const view = await primitives.viewport();
      const data = await primitives.capture({ format, quality, fullPage });
      const pixels = await imageSize(data, format);
      return {
        data,
        viewport: { width: view.width, height: view.height },
        dpr: view.dpr,
        image: pixels,
        note: fullPage
          ? 'a full-page capture is the whole document, not the window: convert through the page, not the viewport'
          : `image pixels are css pixels times ${view.dpr}`
      };
    },

    async capture({ format = 'jpeg', quality = 60, fullPage = false } = {}) {
      if (fullPage) {
        const metrics = await cdp.send('Page.getLayoutMetrics', {});
        const content = metrics?.contentSize ?? {};
        const width = Number(content.width);
        const height = Number(content.height);
        if (!(width > 0 && height > 0)) throw new Error('Full-page capture needs a content size the page did not report.');
        const scale = Math.min(1, 1600 / width, 2400 / height);
        const { data } = await cdp.send('Page.captureScreenshot', {
          format,
          quality,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale }
        });
        return data;
      }
      const { width, height } = await primitives.viewport();
      const { data } = await cdp.send('Page.captureScreenshot', {
        format,
        quality,
        clip: { x: 0, y: 0, width, height, scale: 1 }
      });
      return data;
    },

    // WHY A MENU ROW RESOLVES THE SAME WAY A SNAPSHOT ROW DOES. Both are places
    // on the screen that stop being true when the menu closes, so both are held
    // on to as elements and measured again at the moment of the click.
    async resolveHandle(row) {
      if (row.handle || row.node === undefined) return row;
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `window.__operaMenuNodes[${row.node}]`,
        returnByValue: false
      });
      if (!result?.objectId) return row;
      const described = await cdp.send('DOM.describeNode', { objectId: result.objectId });
      const backendNodeId = described?.node?.backendNodeId;
      return backendNodeId ? { ...row, handle: HANDLE_PREFIX + backendNodeId } : row;
    },

    async handleBox(handle) {
      const backendNodeId = Number(String(handle ?? '').replace(HANDLE_PREFIX, ''));
      if (!Number.isInteger(backendNodeId)) throw new Error(`"${handle}" is not an element handle.`);
      const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId });
      const quad = model?.content ?? model?.border;
      if (!Array.isArray(quad) || quad.length < 4) {
        throw new Error(`handle ${handle} is no longer in the page — resolve the row again`);
      }
      return centreOf(quad);
    },

    async resolveRow({ role, name, limit = 120 } = {}) {
      const rows = await readRows(capped(limit));
      const want = String(name ?? '').toLowerCase();
      const row = rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase() === want)
        ?? rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase().includes(want));
      if (!row) {
        const visible = rows.filter((r) => r.role === role).map((r) => r.name).slice(0, 12).join(' | ');
        throw new Error(`no ${role} matching "${name}". Visible: ${visible}`);
      }
      if (row.node === undefined) return { ...row, handle: null };
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `window.__operaNodes[${row.node}]`,
        returnByValue: false
      });
      if (!result?.objectId) return { ...row, handle: null };
      const described = await cdp.send('DOM.describeNode', { objectId: result.objectId });
      const backendNodeId = described?.node?.backendNodeId;
      return { ...row, handle: backendNodeId ? HANDLE_PREFIX + backendNodeId : null };
    },

    async clickHandle(handle) {
      const at = await primitives.handleBox(handle);
      await primitives.clickAt(at.x, at.y);
      return { ...at, handle: String(handle) };
    },

    async snapshot({ limit = 120 } = {}) {
      const rows = await readRows(capped(limit));
      return rows.map(({ node, ...row }) => row);
    },

    async waitForIdle({ timeoutMs = 10000, intervalMs = 100, readyState = 'complete' } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const state = await primitives.evaluate('document.readyState');
        if (state === readyState) return state;
        if (Date.now() >= deadline) return state;
        await sleep(intervalMs);
      }
    },

    async waitForText(text, { timeoutMs = 10000, intervalMs = 100 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const state = await readState();
        if (state.text.includes(text)) return state;
        if (Date.now() >= deadline) return state;
        await sleep(intervalMs);
      }
    },

    // WHY WAITING FOR A ROW AND NOT FOR TEXT. Half of what an agent waits for
    // is not text: a menu row that has to appear, a button that has to go away,
    // a dialog that has to be dismissed. Reading the page and searching a string
    // cannot see any of it, so an agent polls a snapshot by hand — which is how
    // today was spent: a loop of sleeps and snapshots, guessing when to stop.
    async waitForRow({ role, name, timeoutMs = 10000, intervalMs = 150, absent = false } = {}) {
      const want = String(name ?? '').toLowerCase();
      const deadline = Date.now() + timeoutMs;
      const seen = [];
      for (;;) {
        const rows = await readRows(120);
        const hit = rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase() === want)
          ?? rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase().includes(want));
        const present = Boolean(hit);
        if (present !== absent) {
          return { found: absent ? true : present, role, name, row: hit ?? null, checks: seen.length + 1 };
        }
        seen.push(hit?.name ?? null);
        if (Date.now() >= deadline) {
          return { found: false, role, name, row: null, checks: seen.length };
        }
        await sleep(intervalMs);
      }
    },

    // WHY STILLNESS IS THE WAIT AN AGENT CAN TRUST. Every other wait here is for
    // something named in advance; most of what an agent waits for is not named —
    // it is a menu that is still animating, a list still filling, a save still
    // running. Two identical reads in a row is the honest signal that the page
    // has stopped moving, and it ends on evidence rather than on a number
    // somebody picked. Measured: an upload needed a dozen hand-rolled sleep
    // loops before this existed; it now returns in one call.
    async waitForStill({ timeoutMs = 8000, quietMs = 400, intervalMs = 120, limit = 120 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let previous = null;
      let unchangedSince = Date.now();
      let checks = 0;
      for (;;) {
        const rows = await readRows(limit);
        const shape = JSON.stringify(rows.map(({ role, name, x, y }) => [role, name, x, y]));
        checks += 1;
        if (shape === previous && Date.now() - unchangedSince >= quietMs) {
          return { still: true, ms: Date.now() - (deadline - timeoutMs), checks };
        }
        if (shape !== previous) {
          previous = shape;
          unchangedSince = Date.now();
        }
        if (Date.now() >= deadline) {
          return { still: false, ms: Date.now() - (deadline - timeoutMs), checks };
        }
        await sleep(intervalMs);
      }
    }
  };

  const copyDocsText = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: DOCS_COPY_EXPRESSION,
      returnByValue: true
    });
    return typeof result?.value === 'string' ? result.value : null;
  };

  const focusDocsCanvas = async () => {
    const point = await primitives.evaluate(`(() => {
      const tile = document.querySelector('.kix-canvas-tile-content');
      if (!tile) return null;
      const r = tile.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(150, r.height / 2)) };
    })()`);
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      await primitives.clickAt(point.x, point.y);
    } else {
      const { width } = await primitives.viewport();
      await primitives.clickAt(Math.round(width * 0.45), 200);
    }
  };

  const readDocsText = async () => {
    try {
      await primitives.key('a', ['Control']);
      await sleep(150);
      let text = await copyDocsText();
      if (text === '') {
        await focusDocsCanvas();
        await primitives.key('a', ['Control']);
        await sleep(150);
        text = await copyDocsText();
      }
      return text;
    } finally {
      await primitives.key('End').catch(() => null);
    }
  };

  return primitives;
}