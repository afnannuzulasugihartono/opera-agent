// @last-edited: 2026-10-21 UTC+7.
// @title: page-expressions — the JavaScript the page runs, and the helpers that build it.
// @state: the snapshot, focus, caret, scroll, upload and edit expressions, and the pure helpers around them.
// @dependencies: node:buffer.

// WHY THIS FILE EXISTS

// Most of the weight of a browser driver is not the driving; it is the JavaScript that has to run inside the page to answer a question the protocol cannot.
// A snapshot needs the accessibility tree's role, name and box in one pass, a click needs a mark the person watching can see, a caret needs to be put back exactly where it was, and an upload needs a file input that a page script cannot see.
// Each of those is a page expression, and each grows on its own schedule as the sites it meets grow stranger.

// They also have a property the driver does not: they are pure.
// A page expression is a string, evaluated in a page that knows nothing about this repository, and a helper that builds one takes no browser and no connection.
// That makes them the easiest part of the driver to test and the easiest to get wrong, which is exactly why they now live apart from the verbs that send them.

// WHY THE EXPRESSIONS ARE NOT STRINGS BUILT AT THE CALL SITE.
// A page expression is read by the person debugging a wrong answer, and one built by string concatenation at the call site hides the very thing that failed.
// Written out, it can be pasted into a console and run by hand.

import { Buffer } from 'node:buffer';

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

export function describeKey(name) {
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

// WHY THE SNAPSHOT IS ONE CALL AND NOT ONE PER ELEMENT.
// It used to read the accessibility tree and then ask for the box of every node it liked, which on a Google Doc is up to a hundred and twenty round trips.
// The extension runs one command at a time on purpose — two browser actions racing leave the page in neither state anyone asked for — so those were sequential no matter that the caller said Promise.all, and a snapshot cost about two seconds before anything had decided anything.
// Chrome has no batch API for element boxes, so the only way down to one round trip is to compute the boxes where the elements live: one evaluate inside the page walks the DOM once and returns role, name and centre for everything worth clicking.

// WHY THE ROLES ARE DERIVED IN THE PAGE.
// Dropping the accessibility tree is only safe because the role is recoverable: an explicit role attribute is what Google Docs itself puts on its menus, and the tag table below covers the plain-HTML remainder.
// A widget whose role only an assistive technology would compute would be missing, which is why the attribute is read first and the tag table is deliberately short.

// WHY SECRET VALUES NEVER LEAVE THE PAGE.
// The snapshot carries a field's current value so the agent can see what is already typed — a formula bar, a name box.
// A password field would ride along the same way, straight into model context, which is exfiltration wearing a snapshot's clothes.
// Password, hidden and one-time-code fields keep their role and their box and lose their value, decided where the value is read so no caller has to remember.

// WHY OVERLAY ROWS COME FIRST.
// Menus, dialogs and popups render at the end of the document but sit on top of it — and they are usually what the agent just caused.
// A snapshot that walks document order buries fifteen fresh menu rows past a sixty-row cap, so the menu the agent opened is missing from the page it gets back.
// Proven live: with a stable open menu, a sixty-row snapshot held zero menu rows and the same menu sat visible past the cap.
// The expression collects overlay descendants first and everything else after, skipping what it already took, so the cap cuts the least surprising rows instead of the most recent ones.
// Matched by ARIA role, never by site: a class name here would be per-site code wearing a generic primitive's name.

// WHY THE CARET RIDES THE SNAPSHOT.
// Every keystroke lands wherever the caret is, and until now the agent tracked that in its head: after a click or an arrow key, the caret's new home was a guess.
// A wrong guess types into the wrong paragraph.
// The caret therefore rides every snapshot as a final row, so the next keystroke's landing is read, not remembered.
// A collapsed selection reports its point; a ranged one reports nothing, because a selection's focus end has no honest single point and reads collapse selections anyway.
// Docs draws its caret as an element the page exposes, which is the one per-site selector this generic expression is allowed: a canvas caret has no other API, and the test below holds that exception to exactly one name.
// The row carries no line text: the mirror a copy reads from only holds what a selection put there, so a line is read by selecting it first, and that dance lives in caret_line rather than in every map.

// WHY A SUBMENU IS HOVERED AGAIN WHILE IT IS WAITED FOR.
// Measured live: a submenu opened by hover came and went with where the pointer was, and a walk that hovered once and then read was answered with an empty level often enough to matter.
// A menu bar item is a toggle that opens on the click and stays open, so it is never hovered again; a submenu is, because the pointer leaving it is what closes it and hovering is the only thing that opens it.
// Clicking it instead would run whatever it holds.

// WHY THE CARET IS CHOSEN BY ITS COLOUR AND NOT BY ITS PLACE.
// Measured live on a shared Google Doc: the page holds two carets, this client's drawn in the text colour and a collaborator's painted green and labelled with their name.
// Taking the last caret in the document measured and clicked somebody else's cursor — which never moves — so every restore reported success while the real caret went to the end of the document.
// The caret of this client is the one drawn in the text colour; the name and the colour of the others are how the page marks them.

export const LOCAL_CARET_EXPRESSION = `
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

// WHY A ROW IS RESOLVED TO A NODE AND MEASURED AGAIN.
// A menu lives about two seconds: a snapshot taken in one tool call and a click in the next hits dead background or, measured live, the button underneath it.
// So a row is resolved to the element it came from, and that element is measured at the moment of the click — the page may scroll, the row may move, and the click still lands on the thing that was asked for.
// The handle is the node's backend id, which the browser keeps for the life of that node and refuses the moment it is gone.

// WHY THE FAILURE NAMES WHAT HAD FOCUS.
// Measured live on YouTube: a type inserted nothing and the answer offered two guesses - "there is no caret here, or the browser window is minimized" - when the page was already saying that focus sat on a button belonging to a cookie wall.
// The element that holds focus is one evaluation away, and a name is worth more than two branches of a guess.

export const FOCUS_EXPRESSION = `(() => {
  let deep = document.activeElement;
  const trail = [];
  while (deep) {
    trail.push(deep.tagName.toLowerCase()
      + (deep.id ? '#' + deep.id : '')
      + (deep.getAttribute && deep.getAttribute('role') ? '[' + deep.getAttribute('role') + ']' : ''));
    if (deep.shadowRoot && deep.shadowRoot.activeElement) deep = deep.shadowRoot.activeElement;
    else break;
  }
  return {
    trail: trail.join(' > ') || 'nothing',
    tag: deep ? deep.tagName : null,
    editable: deep ? (deep.isContentEditable === true || deep.tagName === 'INPUT' || deep.tagName === 'TEXTAREA') : false
  };
})()`;

export const HANDLE_PREFIX = 'opera-';

// WHY ASKING IS A PRIMITIVE AND NOT A LEAK.
// The list of methods that may be asked is decided by the surface, not by the caller: reads of structure, no script, no input, no navigation.
// An agent confused about what a page is can ask the browser the question directly instead of inferring it from behaviour, and cannot turn the question into an action.

// WHY THE ROWS CARRY THEIR NODE INTERNAL.
// The index that ties a row to its element means nothing to a caller — it is not a handle and it does not survive the next snapshot — so it never leaves the snapshot.
// A caller that wants to hold on to a row asks for a handle, which is the browser's own name for the element and stays good for the element's life.

export const centreOf = (quad) => {
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

// WHY A GOOGLE DOC IS READ THROUGH ITS OWN COPY PATH.
// Docs draws the document on a canvas, so body.innerText holds the toolbar chrome and none of the content: read_page on a Doc reported an empty document that was not empty, and the only thing that could see the text was a screenshot.
// Docs keeps a hidden iframe for text events, and dispatching a copy event there makes Docs itself populate a div with the selected text — Zotero's production technique, proven on this machine at thirteen milliseconds for a full document read.
// One adaptation: Zotero clears with innerHTML, which this document's Trusted Types policy refuses outright, so the div is emptied with replaceChildren instead.
// Same clearing, no string sink.

// WHY THE READ PREFERS INNERTEXT.
// The populated div keeps the document's block structure, and innerText renders it back as lines: headings, paragraphs and list items stay separated the way the person sees them.
// textContent would weld every paragraph into one run with no boundary at all, and joining blocks with a period instead would corrupt the text it claims to report — abbreviations, decimals and version numbers all contain periods that are not separators.
// textContent stays as the fallback for a frame that renders nothing.
// Trailing blank lines are trimmed on the way out: they are layout air, not content.

// WHY THE SELECTION IS BORROWED AND RETURNED.
// The copy path reads whatever is selected, so a full read selects all first — and anything the person had selected is replaced the moment Ctrl+A lands.
// End collapses the selection back to a caret at the end of the document, which is the one position a read can honestly promise: the content is untouched, the caret is not where it was.
// A read that left the whole document selected would turn the agent's next keystroke into a deletion.

// WHY AN EMPTY COPY EARNS ONE RETRY.
// Ctrl+A selects nothing when the editor never had focus, and the cleared box then reads as an empty document that is not empty.
// One click in the canvas tile focuses the editor for the second attempt; the retry is the only path that can pay the background-window mouse penalty, and only when the fast path came back with nothing.

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

// WHY AN UPLOAD NEVER OPENS THE FILE DIALOG.
// The native picker is OS chrome: CDP cannot see it, click it, or dismiss it, so a drive that opens one is stuck until a human intervenes.
// The file input behind it takes files directly instead — setFileInputFiles names local paths the way a dialog would have, the page uploads on the change event it already listens for, and no dialog ever appears.
// Bytes ride in as base64 and rest briefly in a temp file only CDP can name, because the protocol takes paths, not bytes.

// WHY THE SEARCH PIERCES FROM INSIDE.
// A file input rarely sits in the open: upload widgets hide it in an iframe or a shadow root, where a top-frame query finds nothing.
// Fetching a whole pierced tree to look for it timed out live on a heavy page instead, so the search walks from inside the page and returns the first input it meets — one call, one node back, however deep it hides.
// What it cannot find is an input that does not exist yet: some pages only create theirs on the way to the picker, and for those the agent walks the menu first and calls upload after.

// WHY THE INPUT IS LOOKED FOR FIVE TIMES.
// Clicking Upload creates the file input, but creation lands on the page's own time: the first look routinely finds nothing a second after the click.
// Five looks across two seconds cost nothing when the input is already there and catch it when it arrives late; still nothing after that is an honest inputFound:false, not a race lost.

export const UPLOAD_FIND_ATTEMPTS = 5;
export const UPLOAD_FIND_GAP_MS = 400;

// WHY A DROP EXISTS BESIDE AN UPLOAD.
// The upload fills a file input, which is the whole story on a site that has one.
// Google Docs' image picker has none: it opens the operating system's own dialog through the File System Access API, so there is no input to fill, nothing to suppress, and nothing to click once it is open.
// A drop is the road that is left, and it is the one the web itself offers — Chrome's drag events carry files, so a page that accepts a dropped image accepts this one.
// Measured live: the image landed in a document, with no dialog and no input anywhere in sight.

// WHY A SUBMENU NEEDS TWO GAPS AND NOT ONE NUMBER.
// The pointer has to be sent away and come back before a menu will treat it as entering, and then the submenu has to be rendered before it is worth reading.
// Both waits are short, both are the point where a slow machine fails, and neither is a guess about how long an application "usually" takes.

// WHY A CARET IS REMEMBERED AS A POINT IN THE VIEWPORT AND PUT BACK WITH A CLICK.
// Reading a Google Doc means selecting the document and copying it, because a canvas holds no text to read — and that leaves the caret at the end, so the next click lands where the agent has already been.
// Measured on this product's own author: the caret was lost on a read and the loss went unnoticed until a click landed in the wrong place.

// WHY A POINT AND NOT A SELECTION.
// What has to survive is where the caret will be next.
// Restoring a selection too would mean restoring offsets, and a read that restored the wrong selection would leave the next keystroke overwriting text nobody chose.
// A point, put back with a click, is what the page already understands: Docs draws its own caret as an element, and clicking it is how a person moves it.

// WHY THE RESTORE IS REPORTED RATHER THAN ASSUMED, AND WHY IT IS LEFT ALONE FOR A BEAT.
// A caret that cannot be put back is not a failure of the read — the text came — but it is the difference between an agent that knows where it is and one that clicks blind, so the answer says which happened.
// And a canvas redraws its caret asynchronously, so a click and an immediate read can still see the old one.

// WHY A CLICK TAKES A FRACTION AS WELL AS A PIXEL.
// Measured live by resizing

    // this machine's browser window: the viewport went 1144x714 to 1186x670 while the device scale stayed at 1.25, so the same CSS pixel stopped meaning the same place.
    // A fraction is resolved against the viewport as it is at the moment of the click, which survives that, and the answer says which pixels it became and in what space - so a caller that meant a fixed pixel still gets the truth about the space it landed in.

export const CARET_RESTORE_GAP_MS = 180;
export const CARET_TOLERANCE_PX = 12;

// WHY THE VIEW IS PUT BACK TWICE AND THE CLICK WAITS FOR THE SECOND.
// Measured live: the read scrolls the document to the caret, and the page finishes that scroll on its own frame — after the first write.
// A click that goes out in between lands on whatever happens to be under it, and on the thesis document that was an image: the caret was restored onto a picture.
// So the scroll is written, the page is given a beat to argue, and the click only goes out once a second write held.

export const CARET_SCROLL_SETTLE_MS = 120;
export const CARET_SCROLL_ATTEMPTS = 3;
export const SCROLL_MARK = 'data-opera-scroll';
export const MENU_HOVER_GAP_MS = 90;

export const MENU_OPEN_GAP_MS = 260;

// WHY A MENU IS POLLED UNTIL IT IS DRAWN.
// Measured live, the Insert dropdown was still absent five seconds after the click; a fixed gap of any honest size is either slow on a good machine or early on a slow one.
// Polling the tree until the children are there costs nothing when they arrive immediately and is the only thing that works when they do not.

export const MENU_OPEN_POLL_MS = 150;
export const DROP_PHASE_GAP_MS = 120;
export const DROP_FRONT_SETTLE_MS = 700;
export const DROP_SETTLE_MS = 900;
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

// WHY THE TYPE COMES FROM THE NAME.
// A drop tells the page what it is being offered through one mime type, and a wrong one is a file the page refuses.
// The name is the only thing the caller carries, so it decides; a type with no entry is still dropped, honestly typed as bytes.

export function dragMimeType(filename) {
  const name = String(filename ?? '');
  const dot = name.lastIndexOf('.');
  return (dot < 0 ? null : DRAG_MIME_TYPES[name.slice(dot).toLowerCase()]) ?? 'application/octet-stream';
}

// WHY DRAGOVER IS SENT TWICE.
// Chrome decides whether a target accepts a drop from the dragover it just received, so a drop sent straight after a single dragover is refused with the event accepted and nothing delivered.
// Measured live: one dragover brought the page to "enter" and no file; a second one, and the same page reported the file name and size it had been handed.

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

// WHY READING A LINE SELECTS IT FIRST.
// The mirror a copy reads from only holds what a selection put there: measured live as an empty line beside a perfectly visible caret.
// So the read selects its own line — Home, Shift+End — copies, and collapses back to the line end, which is the documented end state: the caret moves within its line and never past it.
// Steps breathe between them because injected keys land late; without the beats the copy runs before the selection exists.

export const CARET_LINE_GAP_MS = 300;

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

// WHY A HOVER WAITS FOR THE MOVE IT DISPATCHED.
// It used to fire the move and forget it, which reported a hover that had not happened yet while a five-second command sat in the worker's queue — and the next command's liveness proof then queued behind that move and failed, so one lie became two failures.
// Measured on the user's own browser: Input.dispatchMouseEvent costs 2 ms for a press and a release, and about five seconds for a move or a wheel, because those wait on a compositor that is not running when the window is not in front.
// That cost is real either way, and the caller now finds out from the hover rather than from whatever it calls next.

// WHY A RUN HOLDS WORK, NOT PROMISES, AND KEYS KEEP A BEAT.
// A promise pushed into a run is work already begun: awaiting those in order afterwards ordered nothing, measured as a chord's keyUp landing after the next event's keyDown.
// So a run holds what to do and each event only starts when reached; the overlap given up was three milliseconds a key on loopback against twenty seconds each over the relay, which is why it existed at all.
// Order is only half of it: Docs drops edges that land in the same tick — three Enter presses vanished while typed characters beside them all survived — and the trust window hides this by spacing early calls with proof round trips while trusted ones fire back-to-back.
// So a key holds its down edge fifty milliseconds before the up, and chords in a stream breathe the same between them.
// Fifty is past any coalescing window and a sixtieth of one model turn.

export const KEY_BEAT_MS = 50;

// WHY THE PICKER IS INTERCEPTED, NOT CLICKED THROUGH.
// The file input only exists once the upload flow starts it — measured live as inputFound:false on a page whose Upload menu item works fine — and starting that flow opens the native picker, which is OS chrome no CDP call can dismiss.
// Intercepting the chooser suppresses its UI while leaving the input behind for upload to fill, so the agent enables, walks the menu, uploads, and disables, and no dialog ever appears.
// Forgetting the last step leaves later Upload clicks silent, which is why the description says the dance out loud.

// WHY A STEP THAT IS ALREADY OPEN IS NOT OPENED AGAIN.
// A top-level menu is a toggle: measured live, walking the path twice in a row left the first walk with the dropdown open and the second one clicking it shut.
// So each step reads the level first, and only opens what is not already there: already open means the level has its children on screen, so clicking it again would close it, which is what made the second walk of one path fail.

// WHY A LEVEL IS WAITED FOR RATHER THAN ASSUMED.
// The page has not finished when the click returns — the Insert dropdown was still absent five seconds later in one measurement — so a tree read on a fixed gap reads a menu bar with no children and calls it a broken path.
// Every level waits for the rows it is looking for, and only a budget running out may report a break.

// WHY A BREAK NAMES THE LEVEL AND THE CONTENTS.
// "Upload from computer is not in the menu" sends an agent back to guessing.
// "the path broke at Image, and Insert holds: Table, Bookmark, Chart" hands it a map.

// WHY THE IMAGE SIZE IS READ FROM THE PICTURE AND NOT ASSUMED FROM THE VIEWPORT.
// A capture answers with bytes; a caller that is told "1430 by 963" can convert pixels to CSS without running anything, and a capture that was scaled to fit a size limit says so.
// The header is read where it is - a JPEG starts with a frame header that carries the size, a PNG with an IHDR chunk - because a size guessed from the viewport is wrong exactly when the agent needs it.

// WHY THOSE FOUR MARKERS ARE EXCLUDED.
// A JPEG frame header is SOF0 through SOF15, except the three that carry no frame at all - DHT, JPG and DAC - and those three have no size to read.
// Reading the first header that has one is why a caller gets 1430 by 963 rather than the width of a Huffman table.

const SOF = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];

export const imageSize = async (data, format) => {
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

// WHY AN EDIT CHECKS THE PAGE INSTEAD OF TRUSTING ITS OWN SUCCESS.
// Measured live on this machine, against a Google Docs document whose window had been minimized: five characters were typed, the call answered with the number of characters it had inserted, and the document did not hold one of them.
// A page with no caret takes text and drops it, and the protocol has no answer for that - so the page is asked what it holds, before and after, and the two answers are compared.

// WHY THE SIGNATURE IS A LENGTH AND A TAIL, NOT THE TEXT.
// A document can be hundreds of kilobytes, and an edit that reads the whole of it twice costs more than the edit.
// The tail changes whenever anything near the caret changes, and the length catches everything else, so a few hundred characters carry the whole claim.

// WHY THE FOCUSED ELEMENT IS IN IT AS WELL.
// Text typed into a field does not change the text of the page, so a page-only comparison would call every correctly typed field a failure.
// Measured live: the caret in Google Docs lives in an iframe and the document text is in the body, while a text field lives in the element itself - so both are compared and either one moving counts as the text landing.

// WHY PLACEMENT IS ASKED AFTER EVERY EDIT.
// Measured live on a Google Doc: a batch reported landed:true from inside a table cell, and nothing in the answer said where.
// landed proves the page changed; it cannot prove where, because the page changes the same way wherever the caret happens to be.
// So the page is asked for the index and neighbours of what was just inserted: one evaluation, the last occurrence of the opening words, whitespace folded because innerText renders rather than stores.
// A probe that matches nothing is found:false, not a failure - the page moved, and the proof is weaker than the verdict.

// WHY THE CLICK ASKS WHAT IT HIT.
// The same reason from the other side: a click answers with the element under the point - tag, role, name - so a drive can tell a button from the void around it.
// On a canvas page elementFromPoint sees only the canvas, and the answer says canvas:true rather than inventing a name for a pixel.

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

// WHY THE SCROLLER IS FOUND BY ITS SCROLL HEIGHT.
// Measured live on a Google Doc with 21 pages: the document scroller is div.kix-appview-editor with 21,874 pixels of travel, and the first version of this found it by walking up from a text node and therefore missed it, because a canvas editor holds its content as pixels and the text nodes around it belong to the chrome.
// A scroller is anything with room to move; the tallest room wins, the document itself comes first when it has room of its own, and the answer names which one moved - because the one that moved is not the one a caller would have guessed.

// WHY THE WHEEL IS NOT USED HERE.
// Measured live: a synthetic mouseWheel over the Docs canvas gets no answer at all from the tab - the command was still outstanding after eight seconds - on both documents tried.
// A scroll that hangs is worse than a scroll that does nothing, so the offset is set directly and the result is measured after.

// WHY "AT THE END" MEANS THE LAST TEXT IS ON SCREEN.
// An offset can sit at the bottom of a scroller while the content the caller came for lives in another.
// The only end that means anything is the one where the last words of the page are visible, and that is a question about the viewport, not about a number.

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

// WHY ONE READ OF COMPUTED STYLE INSTEAD OF ONE READ PER PROPERTY.
// Measured live: an agent verifying a page without eyes needs facts like "did this button turn blue", "is this modal open", "is this text clipped by a line clamp" - and each of those is three properties on one element.
// So one evaluation returns the handful that decide those questions, and names the element it read, because a style read without the element it belongs to is a number nobody can act on.
// This replaces a format-specific reader: nothing here knows what a document is.

// WHY A POINT OFF THE PAGE IS REFUSED RATHER THAN SENT.
// Measured live: a click_row on an outline row below the fold answered with a click at x 150, y -139 - a success, on a coordinate no pixel holds.
// The click lands in nothing and the answer says it landed, which is the worst kind of answer this product can give.
// A row outside the viewport now names the road that reaches it: scroll({text}) or scroll({y}), then click again.

// WHY A PAGE THAT CANNOT SAY ITS VIEWPORT IS LEFT ALONE.
// A viewport of zero, or no answer at all, is not a small viewport - it is an unknown one, and refusing every click on a page whose scripts we could not read would break the one job this call has.
// The refusal is for a viewport we actually measured.

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

// WHY THE CHECK ASKS A FIXED NUMBER OF TIMES INSTEAD OF WAITING ON A CLOCK.
// A page that has taken the text usually shows it on the next evaluation, and one that debounces - a document editor, a sheet formula - shows it later.
// The count is a count rather than a deadline so that the cost of the check is the same everywhere and can be reasoned about instead of measured.

// WHY THE TAIL IS LONG.
// Measured live on a Google Doc: two consecutive batches, the second reported "nothing on the page changed" while its text sat in the document - and the retry duplicated it.
// The canvas mirrors into the DOM on Docs time, and the outline lags saves by seconds, so a short budget mistakes a slow mirror for a dead page.
// Twelve asks at 150ms cost one evaluation when the page is quick - the loop exits on the first move - and a slow page gets the better part of two seconds before the verdict.
// A false failure writes the text twice; a slow verdict only arrives late.

export const EDIT_POLL_MS = 150;
export const EDIT_POLLS = 12;

// WHY A READ TAKES TWO SAMPLES A BEAT APART.
// Measured live on YouTube: readyState said "complete" at 1.9s with 871 characters of text, and the text reached 8,478 by 2.4s.
// readyState is about the network, not about a page that renders itself afterwards, so an agent that read once had a tenth of the page and no way to know it.
// 100ms is the gap that caught every growth step in that trace (871 -> 4,008 -> 8,428 -> 8,478), and on a settled page it costs one extra read and nothing else.

export const READ_SETTLE_MS = 100;

// WHY THE SETTLE IS POLLED FROM NODE INSTEAD OF WAITING IN THE PAGE.
// The first shape installed a MutationObserver and resolved from a page-side setTimeout(120).
// Measured live on a hidden Google Docs tab, that timer was clamped by background-tab throttling: the call took 304ms, and repeated runs reached 1,009ms, while a snapshot of the same page took 4ms.
// The observer still belongs to the page, but the clock that decides "quiet" now belongs to Node, whose timers are not throttled.
// The page installs only the watcher; Node waits 8ms, asks the watcher how long the page has been still, and stops after 32ms of quiet or 120ms total.
// Fifteen asks is the worst case, and four is the common one; no page-side timer is left for a hidden tab to clamp.

export const SETTLE_QUIET_MS = 32;
export const SETTLE_MAX_MS = 120;
export const SETTLE_POLL_MS = 8;

export const SETTLE_ARM_EXPRESSION = `(() => {
  const key = '__operaSettle';
  const old = window[key];
  if (old?.observer) { try { old.observer.disconnect(); } catch { /* a page already gone has nothing to disconnect */ } }
  const started = performance.now();
  const state = { started, lastChange: started, changes: 0, observer: null };
  state.observer = new MutationObserver(() => {
    state.changes += 1;
    state.lastChange = performance.now();
  });
  try {
    state.observer.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch { /* settling a page that refuses observation is still cheaper than not looking */ }
  window[key] = state;
  return true;
})() /*opera-settle-arm*/`;

export const SETTLE_READ_EXPRESSION = `(() => {
  const state = window.__operaSettle;
  if (!state) return { missing: true };
  const now = performance.now();
  return {
    changes: state.changes,
    quietMs: Math.max(0, Math.round(now - state.lastChange)),
    elapsedMs: Math.max(0, Math.round(now - state.started)),
    visibility: document.visibilityState
  };
})() /*opera-settle-read*/`;

export const SETTLE_DISARM_EXPRESSION = `(() => {
  const state = window.__operaSettle;
  if (state?.observer) { try { state.observer.disconnect(); } catch { /* a page already gone has nothing to disconnect */ } }
  try { delete window.__operaSettle; } catch { /* a page that froze its globals still loses the observer */ }
  return true;
})() /*opera-settle-disarm*/`;

// WHY THE APPEND WAITS A BEAT AFTER THE END KEY.
// The end key asks the editor to move its caret and scroll to it; a document that scrolls answers the next insert before the view has caught up, and text lands where the caret used to be.
// One beat is the cheapest way to let the view arrive, and it costs nothing when the view already has.

export const APPEND_SETTLE_MS = 120;
