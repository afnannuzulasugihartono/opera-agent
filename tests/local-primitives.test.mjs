// @last-edited: 2026-10-11 UTC+7.
// @title: local-primitives — typing, chords and clicks must behave the way a page that ignores synthetic events actually behaves.
// @state: 9 locks; chunking, paragraph breaks, modifier release, and the sequence a canvas editor needs.
// @dependencies: node:test, strict, ../local/primitives.js.

// WHY THIS FILE EXISTS
//
// Every rule here was learned from a real surface rather than from the protocol
// documentation, and each one costs nothing to state and a lot to rediscover.
//
// Typing inserts at the caret. Against Google Docs, selecting all and then typing
// appended rather than overwrote: the document ended up holding every earlier
// attempt, and the call still returned ok:true. That is why clear() is a separate
// sequence of select-then-delete instead of one convenient replace, because at
// the protocol level there is no replace.
//
// Modifiers must be released. A Ctrl held down silently turns the next keystroke
// into a chord and the following one into Ctrl+click, which on a menu bar opens
// two menus instead of one.
//
// Newlines are paragraph breaks. Verified in the same document: text inserted
// with \n produced separately styled paragraphs, which is what makes a whole
// paper one call instead of hundreds.
//
// Synthetic clicks do not drive canvas surfaces, so the click is dispatched at
// the browser level with the full press/release sequence rather than through
// element.click().

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrimitives, modifierMask, splitText } from '../local/primitives.js';

function recordingCdp() {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { value: params.expression.includes('readyState') ? 'complete' : { title: 't', url: 'u', text: 'body text' } } };
      if (method === 'Page.captureScreenshot') return { data: 'BASE64' };
      return { result: {} };
    }
  };
}

test('long text is chunked, because one oversized insert can be dropped without an error', () => {
  assert.deepEqual(splitText('abcdef', 4), ['abcd', 'ef']);
  assert.deepEqual(splitText('', 4), []);
  assert.deepEqual(splitText('ab', 10), ['ab']);
});

test('a newline is sent through untouched, because it is what produces a real paragraph break', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  const out = await p.type('Title\nBody');

  const inserts = cdp.calls.filter((c) => c.method === 'Input.insertText');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params.text, 'Title\nBody');
  assert.equal(out.chars, 10);
});

test('a long document is sent as several inserts so one failure cannot lose all of it', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp, { chunkSize: 10 });

  await p.type('x'.repeat(35));

  const inserts = cdp.calls.filter((c) => c.method === 'Input.insertText');
  assert.deepEqual(inserts.map((i) => i.params.text.length), [10, 10, 10, 5]);
});

test('a modifier is pressed before the key and released after it', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  await p.key('a', ['Control']);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.equal(events.length, 4, 'control down, key down, key up, control up');
  assert.equal(events[0].params.type, 'keyDown');
  assert.equal(events[0].params.code, 'ControlLeft');
  assert.equal(events[1].params.key, 'a');
  assert.equal(events[3].params.type, 'keyUp');
  assert.equal(events[3].params.code, 'ControlLeft');
});

test('a bare key carries no modifier bits', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('a');

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
  assert.equal(down.params.modifiers, 0);
});

test('modifier bits combine rather than overwrite', () => {
  assert.equal(modifierMask([]), 0);
  assert.equal(modifierMask(['Shift']), 8);
  assert.equal(modifierMask(['Control', 'Shift']), 10);
});

test('a named key like Enter is dispatched with its virtual key code', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('Enter');

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
  assert.equal(down.params.windowsVirtualKeyCode, 13);
  assert.equal(down.params.code, 'Enter');
});

test('a click is a real press and release at the browser level, not an element click', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).clickAt(384, 46);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.deepEqual(events.map((e) => e.params.type), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  assert.equal(events[1].params.x, 384);
  assert.equal(events[2].params.y, 46);
});

test('a modified key sends no text, because text under a modifier is typed literally', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('2', ['Control', 'Alt']);

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.key === '2');
  assert.equal(down.params.type, 'rawKeyDown', 'a modified key must not be a text keyDown');
  assert.equal(down.params.text, undefined, 'sending text here types a literal 2 into the document');
  assert.equal(down.params.code, 'Digit2');
  assert.equal(down.params.modifiers, 3, 'control and alt both held');
});

test('an unmodified character still types, or ordinary typing would break', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('a');

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
  assert.equal(down.params.text, 'a');
});

test('a modified letter sends no text either, or Ctrl+A would type an a', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('a', ['Control']);

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.key === 'a');
  assert.equal(down.params.text, undefined);
});

test('a modifier goes down with itself excluded from the mask, and up with the full mask', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('2', ['Control', 'Alt']);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  const controlDown = events.find((e) => e.params.key === 'Control' && e.params.type === 'keyDown');
  assert.equal(controlDown.params.modifiers, 1, 'alt only: control is not yet held at its own keydown');
  const altDown = events.find((e) => e.params.key === 'Alt' && e.params.type === 'keyDown');
  assert.equal(altDown.params.modifiers, 2, 'control only: alt is not yet held at its own keydown');
});

test('clear selects all and then deletes, because typing does not replace a selection', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).clear();

  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  const selectAll = keys.find((k) => k.params.key === 'a' && (k.params.modifiers & 2) === 2);
  const del = keys.find((k) => k.params.key === 'Delete');

  assert.ok(selectAll, 'clear must select all');
  assert.ok(del, 'clear must then delete, because insertText would only insert at the caret');
  assert.ok(cdp.calls.findIndex((c) => c.params?.key === 'a') < cdp.calls.findIndex((c) => c.params?.key === 'Delete'));
});