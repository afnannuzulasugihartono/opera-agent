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
// A newline is a real paragraph break. Measured in the same document: text
// inserted with \n produced separately styled paragraphs, which is what lets a
// whole paper go in as one call rather than hundreds.
//
// Text insertion is chunked. A single Input.insertText carries a practical limit,
// and a long document arriving in one piece can be dropped or truncated partway
// with no error. Chunking bounds the blast radius of that.

const KEY_CODES = Object.freeze({
  Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
  Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab', text: '\t' },
  Backspace: { windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' },
  Delete: { windowsVirtualKeyCode: 46, code: 'Delete', key: 'Delete' },
  Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
  ArrowDown: { windowsVirtualKeyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
  ArrowUp: { windowsVirtualKeyCode: 38, code: 'ArrowUp', key: 'ArrowUp' },
  Home: { windowsVirtualKeyCode: 36, code: 'Home', key: 'Home' },
  End: { windowsVirtualKeyCode: 35, code: 'End', key: 'End' }
});

const MODIFIER_BITS = Object.freeze({ Alt: 1, Control: 2, Meta: 4, Shift: 8 });

const TEXT_KEY = /^[A-Za-z0-9]$/;

export const MODIFIER_CODE = Object.freeze({ Control: 'ControlLeft', Alt: 'AltLeft', Shift: 'ShiftLeft', Meta: 'MetaLeft' });

function modifierCode(name) {
  for (const code of [MODIFIER_CODE[name], MODIFIER_CODE[`${name}Right`]]) if (code) return code;
  return null;
}

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
      for (const part of parts) {
        await cdp.send('Input.insertText', { text: part });
        if (parts.length > 1) await sleep(0);
      }
      return { chunks: parts.length, chars: String(text ?? '').length };
    },

    async key(name, modifiers = []) {
      const mask = modifierMask(modifiers);

      for (const modifier of modifiers) {
        const code = modifierCode(modifier);
        if (!code) continue;
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mask, code, key: modifier });
      }

      const known = KEY_CODES[name];
      const descriptor = known ?? (TEXT_KEY.test(name)
        ? { key: name, code: `Key${name.toUpperCase()}`, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0), text: name }
        : { key: name, code: name });

      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mask, ...descriptor });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, ...descriptor });

      for (const modifier of [...modifiers].reverse()) {
        const code = modifierCode(modifier);
        if (!code) continue;
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, code, key: modifier });
      }

      return { key: name, modifiers: mask };
    },

    async clickAt(x, y) {
      const common = { x, y, button: 'left', clickCount: 1, buttons: 1 };
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common });
      return { x, y };
    },

    async selectAll() {
      return primitives.key('a', ['Control']);
    },

    async clear() {
      await primitives.selectAll();
      await primitives.key('Delete');
    },

    async capture({ format = 'jpeg', quality = 60 } = {}) {
      const { data } = await cdp.send('Page.captureScreenshot', { format, quality });
      return data;
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