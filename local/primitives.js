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

export function modifierMask(modifiers = []) {
  return modifiers.reduce((mask, name) => mask | (MODIFIER_BITS[name] ?? 0), 0);
}

export function splitText(text, size) {
  const value = String(text ?? '');
  if (value.length === 0) return [];
  const out = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

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
      return readState();
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
        await Promise.all([
          cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mask, ...chord }),
          cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, ...chord })
        ]);
        return { key: name, modifiers: mask };
      }

      const printable = Object.prototype.hasOwnProperty.call(descriptor, 'text');
      const frame = printable
        ? { type: 'keyDown', modifiers: mask, ...descriptor }
        : { type: 'rawKeyDown', modifiers: mask, key: descriptor.key, code: descriptor.code, windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode };

      await Promise.all([
        cdp.send('Input.dispatchKeyEvent', frame),
        cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp', modifiers: mask, key: descriptor.key, code: descriptor.code,
          windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode
        })
      ]);

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
        const done = await Promise.all(run.map((job) => job.promise));
        for (const [i, out] of done.entries()) {
          if (run[i].kind === 'text') chars += out.chars;
          else chords += 1;
        }
        run = [];
      };
      for (const event of events) {
        if (event.text != null) run.push({ kind: 'text', promise: primitives.type(String(event.text)) });
        else run.push({ kind: 'chord', promise: primitives.key(event.key, event.modifiers ?? []) });
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
      cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }).catch(() => null);
      await mark;
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
      const [, tree] = await Promise.all([
        cdp.send('Accessibility.enable', {}),
        cdp.send('Accessibility.getFullAXTree', {})
      ]);
      const nodes = tree?.nodes ?? [];
      const wanted = [];
      for (const node of nodes) {
        if (wanted.length >= capped) break;
        const role = node?.role?.value ?? node?.role;
        if (!SNAPSHOT_ROLES.has(role)) continue;
        if (node?.backendDOMNodeId == null) continue;
        wanted.push(node);
      }
      const boxes = await Promise.all(wanted.map((node) =>
        cdp.send('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId }).catch(() => null)
      ));
      const out = [];
      for (const [i, node] of wanted.entries()) {
        const quad = boxes[i]?.model?.content;
        if (!Array.isArray(quad) || quad.length < 8) continue;
        const value = node?.value?.value ?? node?.value ?? '';
        out.push({
          role: node?.role?.value ?? node?.role,
          name: String(node?.name?.value ?? node?.name ?? '').slice(0, 80),
          x: Math.round((Math.min(quad[0], quad[4]) + Math.max(quad[0], quad[4])) / 2),
          y: Math.round((Math.min(quad[1], quad[5]) + Math.max(quad[1], quad[5])) / 2),
          ...(value ? { value: String(value).slice(0, 80) } : {})
        });
      }
      return out;
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

  return primitives;
}