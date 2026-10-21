// @last-edited: 2026-10-11 UTC+7.
// @title: primitives — the actions the local driver offers, built on CDP and measured in the tens of milliseconds.
// @state: 10 locks; trusted typing, chunked insertion, chord dispatch, coordinate clicks, and bounded waits.
// @dependencies: ../local/cdp.js.

// WHY THIS FILE EXISTS

// These are the verbs that make the three targets possible: writing a document in Docs, filling a sheet in Sheets, laying out a deck in Slides.
// Each one is a CDP command underneath, so each inherits the half-millisecond transport measured in local-transport, and each has one rule that is not obvious and not optional.

// Typing does not replace a selection.
// That was measured against a real Google Docs canvas, where selecting all and then typing appended instead of overwriting, duplicated the document, and returned ok:true with nothing to indicate it had.
// The primitives therefore expose the two halves separately -- select, then delete, then type -- rather than a convenient replace that does not exist at the protocol level.

// A newline is a real paragraph break, and a key event is not.
// Measured in the same document: text inserted with \n produced separately styled paragraphs, which is what lets a whole paper go in as one call rather than hundreds.
// The same document ignored a dispatched Enter key event entirely and still reported success, merging every paragraph into one.
// Both paths reach the editor, only one of them is read, and the result is indistinguishable from working unless the document is captured and looked at.
// So callers break paragraphs through type() and never through key('Enter').

// Structure is applied before content, never after.
// Measured in the same document: a paragraph style applied to a paragraph that already held its text did not take, while the identical chord applied to an empty paragraph did.
// The chord returns ok either way, so the outline is the only witness.

// Text belongs to the key only when nothing is held down.
// A chord is exactly two events — keyDown and keyUp with the modifiers mask, the virtual codes, and no text — and no separate modifier press around them.
// Measured 2026-10-13: the previous six-event frame, modifier downs plus a rawKeyDown, leaked its character into a Docs canvas under rapid fire ("e1Laporan", doc 11nW) while the two-event frame the extension sends styled cleanly on the same document at the same speed.
// Two events are also three round trips fewer per chord, which is what makes a twenty-key walk feel instant instead of deliberate.

// Tab carries no text.
// A real Tab keypress produces none, and the tab character this driver used to send moved the Sheets selection while stranding focus in the formula bar, which then swallowed every following key.
// Measured 2026-10-13: three identically misfilled sheets, then a name-box trace naming Tab as the poison and a textless Tab moving cleanly with focus intact.

// A hover moves and stops.
// A menu item that owns a submenu opens it on hover and closes on click, so a press here dismisses the menu the caller was reaching into and the submenu is then gone.
// Measured against a real View menu: the press did nothing but close it, the hover opened it.

// A capture is one pixel per clickable coordinate.
// Taken at device pixels on a HiDPI screen a picture comes back larger than the clickable viewport, so a coordinate read off it and sent as CSS pixels lands a quarter of the way off: that is what put a click meant for A1 into A3 on a 1.25 screen.
// Every capture is therefore clipped to the viewport at scale 1, which is the same space clickAt speaks, so looking at a picture and clicking what is in it is true.

// Text insertion is chunked.
// A single Input.insertText carries a practical limit, and a long document arriving in one piece can be dropped or truncated partway with no error.
// Chunking bounds the blast radius of that.

// Keys travel as a stream.
// Every lone key pays a full round trip, so a twenty-key menu walk costs twenty trips one at a time and one as a stream: order preserved, gaps ride along for UI that needs a beat, text and chords share the sequence.

// Dispatches pipeline.
// One CDP session answers every request by id, so ten sends without an await between them cost one round trip, not ten, and Chrome still processes them in arrival order.
// Anything that must wait — a gap for a menu animation, a tree before its boxes — awaits; everything else fires together.

// A snapshot names what can be clicked.
// A canvas page exposes no DOM worth querying, but Blink computes an accessibility tree for every rendered page, and every node in it resolves to a box.
// Reading role, name and center together turns "click the Insert menu" from a remembered coordinate into one fresh call.

// Every pointer action leaves a mark the person watching can see.
// A synthetic click moves no cursor, so without a mark the drive is invisible: a red ring for a click, blue for a hover, drawn as one fixed div by a fixed script that takes coordinates and nothing else — visible live and in captures, and pipelined with the action so the mark costs no round trip.
// A debugger overlay was tried first and discarded: it answers ok and renders nothing.
// The mark is best-effort by design: a page that refuses the script still gets its click.

// A hover does not wait for its own reply.
// A lone mouse move is the one dispatch whose acknowledgement Chrome answers on page time — measured 700 ms to 5 s on ordinary pages, while the same move inside a click answers in milliseconds.
// The move is sent and the mark awaited; the effect is proven by the snapshot read that follows every hover, which is also what makes a dead tab fail loudly one call later instead of silently now.

import nodeFs from 'node:fs';
import nodeOs from 'node:os';
import nodePath from 'node:path';

import { findNode, menuTreeExpression, nearestNames, revealOf, stateOf } from './menu-tree.js';
import {
  APPEND_SETTLE_MS,
  CARET_LINE_GAP_MS,
  CARET_RESTORE_GAP_MS,
  CARET_SCROLL_ATTEMPTS,
  CARET_SCROLL_SETTLE_MS,
  CARET_TOLERANCE_PX,
  DOCS_COPY_EXPRESSION,
  EDIT_POLLS,
  EDIT_POLL_MS,
  EDIT_SIGNATURE_EXPRESSION,
  FOCUS_EXPRESSION,
  HANDLE_PREFIX,
  KEY_BEAT_MS,
  LOCAL_CARET_EXPRESSION,
  MENU_HOVER_GAP_MS,
  MENU_OPEN_GAP_MS,
  MENU_OPEN_POLL_MS,
  READ_SETTLE_MS,
  SCROLL_MARK,
  SELECTION_TEXT_EXPRESSION,
  centreOf,
  computedExpression,
  describeKey,
  hitExpression,
  imageSize,
  isDocsDocument,
  locateExpression,
  modifierMask,
  snapshotExpression,
  scrollExpression,
  splitText
} from './page-expressions.js';
import { filePrimitives } from './primitives-file.js';

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

  // WHY THE SPOT TAKES ITSELF AWAY.
  // Measured live on this product's own author: a click marker that never goes leaves a red ring sitting on the page for the rest of the session, and every capture after it carries that ring - so the picture an agent reads its own click out of has a 26-pixel circle drawn on top of the thing it just clicked.
  // The mark is worth having for the beat in which the person watching sees where the drive went; it is not worth leaving on the page.
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

  // WHY THE BOXES THAT SCROLL ARE FOUND BY A MARK AND NOT BY THE CARET.
  // Measured live: while the whole document is selected the page draws no caret at all, so anything that walks up from the caret has nothing to walk up from — and the view stayed at the end of the document, putting the caret onto a picture.
  // The boxes are marked while the caret is still there to be measured, and the marks are taken off again as soon as the restore is done with them.
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

  const focusNow = async () => {
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: FOCUS_EXPRESSION, returnByValue: true });
      return result?.value ?? null;
    } catch {
      return null;
    }
  };

  // WHY A CLICK ASKS WHO OWNS THE POINT BEFORE IT PRESSES.
  // Measured live on YouTube: a cookie wall covered the page, click_row on the search box answered with the row's name and its point as if the click had reached it, focus never left the wall's button, and the type that followed had nothing to say but a guess.
  // The point either belongs to the row or to something laid over it, and that is one question with one answer.
  // When the page cannot answer, nothing is claimed.

  const ownershipAt = async (handle, point) => {
    const raw = String(handle ?? '');
    if (!raw.startsWith(HANDLE_PREFIX)) return {};
    const backendNodeId = Number(raw.slice(HANDLE_PREFIX.length));
    if (!Number.isFinite(backendNodeId)) return {};

    // WHY THE DOM AGENT IS SWITCHED ON FIRST.
    // Measured live: without it resolveNode answers an error, the catch below swallowed it, and the click reported no fact at all - a silent fallback that looks the same as a page that cannot answer.
    try {
      await cdp.send('DOM.enable').catch(() => null);
      const resolved = await cdp.send('DOM.resolveNode', { backendNodeId });
      const objectId = resolved?.object?.objectId;
      if (!objectId) return {};
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function (x, y) {
          const at = document.elementFromPoint(x, y);
          if (!at) return {};
          if (at === this || this.contains(at)) return { covered: false };
          const label = (at.getAttribute('aria-label') || at.innerText || at.textContent || '')
            .replace(/\s+/g, ' ').trim().slice(0, 60);
          return {
            covered: true,
            coveredBy: at.tagName.toLowerCase() + (at.getAttribute('role') ? '[' + at.getAttribute('role') + ']' : ''),
            coveredText: label
          };
        }`,
        arguments: [{ value: Number(point.x) }, { value: Number(point.y) }],
        returnByValue: true
      });
      return result?.value ?? {};
    } catch {
      return {};
    }
  };

  const readState = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: '({ title: document.title, url: location.href, text: document.body ? document.body.innerText : "", ready: document.readyState })',
      returnByValue: true
    });
    return result?.value ?? { title: '', url: '', text: '' };
  };

  // WHY AN ACTION'S PAGE STATE IS MEASURED AND NOT COPIED.
  // Measured on a real job: eight calls spent 34,974 characters, most of it the same sixty rows and the same page text riding along after every click.
  // An agent does not read that; it pays for it in tokens and in attention.
  // So an action reports where the page is and what moved - url, title, how much text it holds, which element has focus - and the rows that changed.
  // The rest stays one deliberate ax_snapshot away.

  // WHY THE TEXT IS COUNTED AND NOT RETURNED.
  // The count answers "did this action change what the page says", which is the question an action's answer owes.
  // The words themselves belong to read_page, where the caller asked for them.
  const PAGE_STATE_EXPRESSION = `(() => {
    const body = document.body ? document.body.innerText : '';
    const active = document.activeElement;
    let focus = null;
    if (active && active !== document.body) {
      const name = (active.getAttribute('aria-label')
        || active.getAttribute('placeholder')
        || active.getAttribute('title')
        || active.innerText
        || active.textContent
        || '').trim();
      focus = { tag: active.tagName, role: active.getAttribute('role') || '', name: name.slice(0, 60) };
    }
    return { url: location.href, title: document.title, textChars: body.length, focus };
  })()`;

  const pageState = async () => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: PAGE_STATE_EXPRESSION,
      returnByValue: true
    });
    return result?.value ?? { url: '', title: '', textChars: 0, focus: null };
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
      if (!isDocsDocument(state.url)) {
        await sleep(READ_SETTLE_MS);
        const again = await readState();
        return {
          title: again.title,
          url: again.url,
          text: again.text,
          ready: again.ready ?? null,
          settled: again.text === state.text,
          grewBy: again.text.length - state.text.length,
          caretMoved: false,
          caretRestored: true,
          viewRestored: true,
          caretWhy: ''
        };
      }
      const mark = await rememberCaret();
      const text = await readDocsText();
      const back = await putCaretBack(mark);

      // WHY settled IS UNKNOWN HERE RATHER THAN GUESSED.
      // This text comes from a selection copy, and asking whether it has stopped changing would mean a second copy - another select-all and another caret move, on the one path where a caret move is the expensive thing.
      // So the read reports what it did not measure, and names the cost of measuring it.
      return {
        ...state,
        text: text ?? state.text,
        ready: state.ready ?? null,
        settled: null,
        settledWhy: 'the text came from a selection copy; a second copy would move the caret twice, so read again after wait_still() or take capture_page() as the proof',
        caretMoved: true,
        ...back
      };
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
        const focus = await focusNow();
        const where = focus?.tag
          ? `focus was on ${focus.trail}${focus.editable ? '' : ', which takes no text'}`
          : 'nothing on the page held focus';
        throw new Error(seen.after.holds
          ? `typed ${out.chars} characters and nothing on the page changed: ${where} - click_row the field that should receive it, or press Escape if a dialog is over it`
          : `typed ${out.chars} characters into a page that holds no text and no field to receive them`);
      }
      return { ...out, landed: true, placed: await locateInsertion(text, before, seen.after) };
    },

    // WHY AN APPEND AND NOT A TYPE.
    // Measured live while building a thesis: the road to the end of a document was click somewhere, press Ctrl+End, and trust the caret - and once it did not go where it was told, a whole batch landed inside a table cell and recovering cost four extra calls and an undo.
    // An append is that promise with the positioning inside it.

    // WHY "AT THE END" IS READ AND NOT AIMED FOR.
    // Moving a caret to the end of a long canvas document and reading the caret back is several round trips against a surface that mirrors into the DOM on the editor's own schedule.
    // What one evaluation can answer is whether anything follows the text that was just inserted: at the end, nothing does.
    // So atEnd is measured, and when the mirror is too stale to tell, the answer says found:false instead of claiming it.
    // Measured live on a Google Doc: five appends in a row each reported atEnd false, because what followed the inserted text was the editor's own chrome ("Banner hidden new line 1 by 1") rather than document text.
    // The appends were at the end; a strict measure cannot see past a canvas editor's chrome, so it names what followed rather than guessing either way.

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

    // WHY A STREAM REPORTS THE COMPARISON INSTEAD OF A VERDICT.
    // A shortcut in the middle of a stream can change the page without the text ever landing, so "the page changed" is the strongest thing a stream can honestly say - and it is the thing an agent needs to decide whether to look again.

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

    // WHY A CLICK TAKES A FRACTION AS WELL AS A PIXEL.
    // Measured live by resizing this machine's browser window: the viewport went 1144x714 to 1186x670 while the device scale stayed at 1.25, so the same CSS pixel stopped meaning the same place.
    // A fraction is resolved against the viewport as it is at the moment of the click, which survives that, and the answer says which pixels it became and in what space - so a caller that meant a fixed pixel still gets the truth about the space it landed in.
    async clickFraction(at) {
      const view = await primitives.viewport();
      const asked = { x: Number(at?.x) || 0, y: Number(at?.y) || 0 };
      const x = Math.round(Math.min(1, Math.max(0, asked.x)) * view.width);
      const y = Math.round(Math.min(1, Math.max(0, asked.y)) * view.height);
      await primitives.clickAt(x, y);
      return { x, y, of: asked, viewport: { width: view.width, height: view.height }, dpr: view.dpr };
    },

    // WHY ONE CALL, AND WHY IT ANSWERS WHAT IT DID.
    // A scroll that moved the page and a scroll that moved the right thing look identical from outside, so the answer carries the scroller that moved and by how much, and - for a target - whether that target is on screen now.
    // Nothing here is aimed for: every fact is read after the fact.

    // WHY "AT THE END" CAN BE FALSE AND MEANS NOTHING MOVED.
    // Measured live on a Google Doc: an end scroll moved the document element 56 pixels and answered atEnd true, because the document is not what scrolls on a canvas editor.
    // So atEnd is true only when the page reports its last text on screen, and the scroller that answers is named - a refusal to claim an end it did not reach is the whole value here.

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

    // WHY THE ANSWER NAMES THE ELEMENT IT READ.
    // A style value without its element is a number nobody can act on, and two elements can share a colour and mean opposite things.
    // So tag, role, name and the box come back with the values, and rect says whether the element is on screen or running past the viewport - which is the difference between "the page shows a blue button" and "a blue button exists somewhere below".

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
      const px = Number(x);
      const py = Number(y);
      const view = await primitives.viewport().catch(() => null);
      if (view && view.width > 0 && view.height > 0
        && (px < 0 || py < 0 || px > view.width || py > view.height)) {
        throw new Error(`click refused: ${Math.round(px)},${Math.round(py)} is outside the ${view.width}x${view.height} viewport - scroll({text}) or scroll({y}) to bring it into view, then click again`);
      }
      const common = { x: px, y: py, button: 'left', clickCount: 1, buttons: 1 };
      await Promise.all([
        spot(x, y, 'rgb(255,60,60)'),
        cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }),
        cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common }),
        cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common })
      ]);
      return { x, y, hit: await hitAt(x, y) };
    },

    // WHY A SUBMENU IS HOVERED AND NOT CLICKED.
    // Clicking a row that turns out to be a branch runs whatever it was — Delete, Remove, Send.
    // Hover opens the same submenu and activates nothing, so it is what the walker uses, and only a click is used when the caller says the item is a command.

    // WHY THE POINTER LEAVES FIRST.
    // Measured live: a submenu that would not open on hover opened once the pointer was sent somewhere else first and came back.
    // A menu that has never seen the pointer arrive from outside does not treat the hover as entering it, so the away-and-back is not politeness, it is the enter transition the menu is waiting for.
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
          // Measured live on Google Docs: a menu on the bar is a toggle - hover does nothing and it only opens on a click - while a submenu opens on hover.
          // And a leaf that turns out to be a command is never clicked on the way to anywhere else: "Upload from computer" opens the operating system's own file dialog, which nothing here can close again.
          // So a click goes out for the bar item that opens the menu, and for a leaf only when the caller said this item is the command to run.
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

    // WHY THE PAGE IS ASKED BEFORE THE MACHINE, AND WHY IT IS ENOUGH.
    // Measured live on this machine, twice, with the drive typing into a Google Docs document: a browser behind another application still reported focus here and took the text, and a minimized browser reported no focus and dropped it.
    // So this one evaluation answers the only case that costs anything to be wrong about, and the machine is asked only when it says the page is deaf.
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

    // WHY A CAPTURE ANSWERS WITH THE SPACE IT WAS TAKEN IN.
    // Measured live by resizing this machine's browser window: the viewport went 1144x714 -> 1186x670 and the capture went 1430x963 -> 1483x838, with the scale factor constant at 1.25.
    // So the picture is the CSS viewport times the device's scale, and both move under the agent's feet: a window resized, a window dragged to a monitor with another scale.
    // An agent given a picture and nothing else has to guess that number, and it guesses wrong - which is how a click lands on the wrong thing while every answer says the click was delivered.
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

    // WHY A MENU ROW RESOLVES THE SAME WAY A SNAPSHOT ROW DOES.
    // Both are places on the screen that stop being true when the menu closes, so both are held on to as elements and measured again at the moment of the click.
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
      const owner = await ownershipAt(handle, at);
      await primitives.clickAt(at.x, at.y);
      return { ...at, handle: String(handle), ...owner };
    },

    async snapshot({ limit = 120 } = {}) {
      const rows = await readRows(capped(limit));
      return rows.map(({ node, ...row }) => row);
    },

    pageState,

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

    // WHY WAITING FOR A ROW AND NOT FOR TEXT.
    // Half of what an agent waits for is not text: a menu row that has to appear, a button that has to go away, a dialog that has to be dismissed.
    // Reading the page and searching a string cannot see any of it, so an agent polls a snapshot by hand — which is how today was spent: a loop of sleeps and snapshots, guessing when to stop.
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

    // WHY STILLNESS IS THE WAIT AN AGENT CAN TRUST.
    // Every other wait here is for something named in advance; most of what an agent waits for is not named — it is a menu that is still animating, a list still filling, a save still running.
    // Two identical reads in a row is the honest signal that the page has stopped moving, and it ends on evidence rather than on a number somebody picked.
    // Measured: an upload needed a dozen hand-rolled sleep loops before this existed; it now returns in one call.
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

  Object.assign(primitives, filePrimitives(primitives, { cdp, sleep, fs, os, path, readState }));

  return primitives;
}