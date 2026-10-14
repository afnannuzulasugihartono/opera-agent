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
// selections anyway. Docs draws its caret as an element the page exposes, and
// mirrors its text in a hidden frame the selection API can read: those two
// narrowly named selectors are the per-site exception this generic expression
// allows, because a canvas caret and its line have no other API, and the test
// below holds that exception to exactly these names. The row carries the line
// the caret stands on, so moving between lines is verified by text, not pixels.

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

  const tryRow = (el) => {
    const role = roleOf(el);
    if (!role || !ROLES.has(role)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    const value = valueOf(el);
    out.push({
      role,
      name: nameOf(el).slice(0, 80),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      ...(value ? { value: value.slice(0, 80) } : {})
    });
  };

  const cleanLine = (s) => {
    let out = '';
    for (const ch of String(s || '')) {
      const code = ch.codePointAt(0);
      if ((code < 8203 || code > 8205) && code !== 65279) out += ch;
    }
    return out.trim().slice(0, 120);
  };

  const caretLineOf = (doc, win) => {
    try {
      const focus = doc.activeElement;
      if (focus && (focus.tagName === 'INPUT' || focus.tagName === 'TEXTAREA')) {
        const kind = (focus.type || 'text').toLowerCase();
        if (kind === 'password' || kind === 'hidden') return '';
        if (focus.getAttribute('autocomplete') === 'one-time-code') return '';
        return cleanLine(focus.value);
      }
      const sel = win.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return '';
      const node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
      const block = node && node.closest ? node.closest('p,div,li,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote') : null;
      return cleanLine((block || node || {}).textContent);
    } catch { return ''; }
  };

  const caretOf = () => {
    const usable = (r) => (r && (r.x !== 0 || r.y !== 0 || r.width !== 0 || r.height !== 0)) ? r : null;
    const frame = document.querySelector('.docs-texteventtarget-iframe');
    const doc = frame && frame.contentDocument ? frame.contentDocument : document;
    const win = frame && frame.contentWindow ? frame.contentWindow : window;
    const kix = document.querySelector('.kix-cursor-caret');
    if (kix) {
      const r = usable(kix.getBoundingClientRect());
      if (r) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), line: caretLineOf(doc, win) };
    }
    try {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
      const r = usable(sel.getRangeAt(0).getBoundingClientRect());
      if (!r) return null;
      return { x: Math.round(r.x), y: Math.round(r.y), line: caretLineOf(document, window) };
    } catch { return null; }
  };

  for (const box of document.querySelectorAll(OVERLAYS)) {
    if (box.parentElement && box.parentElement.closest(OVERLAYS)) continue;
    tryRow(box);
    for (const el of box.querySelectorAll(CANDIDATES)) {
      if (out.length >= LIMIT) return out;
      tryRow(el);
    }
    if (out.length >= LIMIT) return out;
  }
  for (const el of document.querySelectorAll(CANDIDATES)) {
    if (out.length >= LIMIT) break;
    if (el.closest(OVERLAYS)) continue;
    tryRow(el);
  }
  const caret = caretOf();
  if (caret) {
    out.push({ role: 'caret', name: 'text caret', x: caret.x, y: caret.y, ...(caret.line ? { value: caret.line } : {}) });
  }
  return out;
})()`;

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

export function isDocsDocument(url) {
  return String(url || '').includes('docs.google.com/document/d/');
}

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

export function createPrimitives(cdp, { chunkSize = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const spot = (x, y, color) => {
    const px = Math.round(Number(x) || 0);
    const py = Math.round(Number(y) || 0);
    return cdp.send('Runtime.evaluate', {
      expression: `(() => { const d = document; if (!d || !d.documentElement) return false; let el = d.getElementById('opera-spot'); if (!el) { el = d.createElement('div'); el.id = 'opera-spot'; el.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid;border-radius:50%;width:26px;height:26px;margin:0;padding:0;box-sizing:border-box;'; d.documentElement.appendChild(el); } el.style.left = '${px - 13}px'; el.style.top = '${py - 13}px'; el.style.borderColor = '${color}'; return true; })()`,
      returnByValue: true
    }).catch(() => null);
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
      if (!isDocsDocument(state.url)) return state;
      const text = await readDocsText();
      return { ...state, text: text ?? state.text };
    },

    async evaluate(expression) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true
      });
      return result?.value;
    },

    async type(text) {
      const parts = splitText(text, chunkSize);
      await Promise.all(parts.map((part) => cdp.send('Input.insertText', { text: part })));
      return { chunks: parts.length, chars: String(text ?? '').length };
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
      let chords = 0;
      let chars = 0;
      let run = [];
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
        if (event.text != null) run.push({ kind: 'text', go: () => primitives.type(String(event.text)) });
        else run.push({ kind: 'chord', go: () => primitives.key(event.key, event.modifiers ?? []) });
        if ((event.gapMs ?? 0) > 0) {
          await flush();
          await sleep(event.gapMs);
        }
      }
      await flush();
      return { events: events.length, chords, chars, execMs: Date.now() - started };
    },

    async clickAt(x, y) {
      const common = { x, y, button: 'left', clickCount: 1, buttons: 1 };
      await Promise.all([
        spot(x, y, 'rgb(255,60,60)'),
        cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }),
        cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common }),
        cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common })
      ]);
      return { x, y };
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

    async viewport() {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })',
        returnByValue: true
      });
      return result?.value ?? { width: 0, height: 0, dpr: 1 };
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

    async snapshot({ limit = 120 } = {}) {
      const capped = Math.min(Math.max(1, Number(limit) || 120), 500);
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: snapshotExpression(capped),
        returnByValue: true,
        awaitPromise: false
      });
      return Array.isArray(result?.value) ? result.value : [];
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