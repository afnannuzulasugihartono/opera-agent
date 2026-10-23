// @last-edited: 2026-10-23 UTC+7.
// @title: local-canvas — a Google Doc is a canvas, so a read borrows the selection and puts the caret back.
// @state: the document copy path, the caret restore, and the caret line read.
// @dependencies: node:test, strict, ../local/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCS_COPY_EXPRESSION,
  isDocsDocument,
  KEY_BEAT_MS,
  SETTLE_POLL_MS
} from '../local/page-expressions.js';
import { createPrimitives } from '../local/primitives.js';
import { createCanvasMethods } from '../local/canvas.js';
import { DOC_URL, docsCdp } from './helpers/local-page.mjs';

test('a read on a Google Doc borrows the selection and returns the document', async () => {
  const slept = [];
  const cdp = docsCdp([{ result: { value: 'First line\nSecond line' } }]);
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  const out = await p.read();

  assert.deepEqual(out, {
    title: 'Doc',
    url: DOC_URL,
    text: 'First line\nSecond line',
    ready: null,
    settled: null,
    settledWhy: 'the text came from a selection copy; a second copy would move the caret twice, so read again after wait_still() or take capture_page() as the proof',
    caretMoved: true,
    caretRestored: false,
    viewRestored: false,
    caretWhy: 'the page showed no caret to remember'
  });
  assert.deepEqual(
    cdp.calls.map((c) => c.method),
    ['Runtime.evaluate', 'Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent',
      'Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']
  );
  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(keys.map((k) => k.params.modifiers), [2, 2, 0, 0],
    'the select-all carries Control on both edges and the collapse carries none');
  assert.deepEqual(slept, [KEY_BEAT_MS, 150, KEY_BEAT_MS],
    'each borrowed key keeps its beat, and the selection settles before the copy forces it out');
});

// WHY THE READ PUTS THE CARET BACK.
// Reading a Doc borrows the selection, and a borrowed selection leaves the caret at the end of the document, so the next click lands where the agent has already been.
// Measured live: a read followed by a click typed into the wrong place because of exactly that, twice.

// WHY THE POINT IS TAKEN RELATIVE TO THE SCROLLING BOX, NOT THE WINDOW.
// The read scrolls the document to the caret, so a viewport point measured before the read points at different text after it.
// The place that survives is the caret's offset inside the box that scrolls, so that is what is written down, together with the scroll the view was at — which is put back before the click, so the click lands on the text the caret was on and the caller gets the view back too.

// WHY THE ANSWER IS A MEASUREMENT.
// A read that reports a restore it did not check is an assertion, and the first time the page does not oblige it teaches the agent to trust it.
// The caret is looked at again after the click and compared, and a caret that did not come back is reported as one that did not come back.


test('a read on a Doc puts the caret back where it found it', async () => {
  const cdp = docsCdp([{ result: { value: 'First line' } }], {
    mark: { x: 660, y: 300, absX: 660, absY: 420, scroll: [[0, 120]] },
    point: { x: 660, y: 300, settled: true },
    seen: { absX: 661, absY: 421, settled: true }
  });

  const out = await createPrimitives(cdp).read();

  assert.equal(out.caretMoved, true, 'the read does move the caret, and says so');
  assert.equal(out.caretRestored, true, 'and the caret was measured back within a line');
  assert.equal(out.viewRestored, true, 'and the scroll the read caused was put back');
  assert.equal(out.caretWhy, '', 'and nothing is left to explain');
  const press = cdp.calls.find((c) => c.params?.type === 'mousePressed');
  assert.ok(press, 'a caret with a place on it gets a click');
  assert.equal(press.params.x, 660);
  assert.equal(press.params.y, 300);
  const ask = cdp.calls.findIndex((c) => String(c.params?.expression ?? '').includes('scroll: chain.map('));
  const copy = cdp.calls.findIndex((c) => c.method === 'Input.dispatchKeyEvent');
  assert.ok(ask < copy, 'the caret is written down before the selection is borrowed');
  const looks = (c) => String(c.params?.expression ?? '').includes('kix-cursor-caret')
    && !String(c.params?.expression ?? '').includes('scroll: chain.map(');
  const check = cdp.calls.map((c, i) => (looks(c) ? i : -1)).filter((i) => i >= 0).at(-1);
  const click = cdp.calls.findIndex((c) => c.params?.type === 'mousePressed');
  assert.ok(check > click, 'the caret is looked at again after the click, not before');
});


test('a caret that did not come back is reported as one that did not', async () => {
  const cdp = docsCdp([{ result: { value: 'First line' } }], {
    mark: { x: 660, y: 300, absX: 660, absY: 420, scroll: [[0, 120]] },
    point: { x: 660, y: 300, settled: true },
    seen: { absX: 660, absY: 880, settled: true }
  });

  const out = await createPrimitives(cdp).read();

  assert.equal(out.caretRestored, false, 'the click landed and the caret is elsewhere: that is false');
  assert.equal(out.viewRestored, true, 'the view still came back, and is not confused with the caret');
  assert.match(out.caretWhy, /not where it was left/, 'and it says so rather than leaving a bare false');
});

// WHY NO CLICK GOES OUT WHEN THE VIEW DID NOT COME BACK.
// The point was measured in the view as it was before the read, so with the view somewhere else the same numbers point at other text.
// Clicking there would move the caret and the selection to whatever happens to be under them, which is the very damage the restore exists to prevent.


test('a view that did not go back is not clicked into', async () => {
  const cdp = docsCdp([{ result: { value: 'First line' } }], {
    mark: { x: 660, y: 300, absX: 660, absY: 420, scroll: [[0, 120]] },
    point: { x: 660, y: 300, settled: false },
    seen: { absX: 660, absY: 1180, settled: true }
  });

  const out = await createPrimitives(cdp).read();

  assert.equal(out.caretRestored, false);
  assert.equal(out.viewRestored, false);
  assert.match(out.caretWhy, /view did not go back/);
  assert.ok(!cdp.calls.some((c) => c.params?.type === 'mousePressed'),
    'a place that is no longer the place must not be clicked');
});


test('a read that finds no document structure keeps the page text', async () => {
  const cdp = docsCdp([{ result: { value: null } }]);

  const out = await createPrimitives(cdp).read();

  assert.equal(out.text, 'chrome', 'a null copy is a page without the editor, not an empty document');
  assert.ok(!cdp.calls.some((c) => c.params?.type === 'mousePressed'),
    'no structure means nothing to focus, so no retry click goes out');
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent').length, 4,
    'the selection is still collapsed even when the copy found nothing');
});


test('an empty copy earns one focused retry before the read admits empty', async () => {
  const cdp = docsCdp([{ result: { value: '' } }, { result: { value: 'Retried text' } }]);

  const out = await createPrimitives(cdp).read();

  assert.equal(out.text, 'Retried text');
  const pressed = cdp.calls.filter((c) => c.params?.type === 'mousePressed');
  assert.equal(pressed.length, 1, 'exactly one focusing click, on the retry only');
  assert.deepEqual(pressed[0].params.x, 700, 'the click lands where the canvas tile is, not on a guess');
  const chords = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.modifiers === 2);
  assert.equal(chords.length, 4, 'select-all runs twice: the fast attempt and the focused retry');
});


test('the document copy reads through the editor without touching a string sink', () => {
  assert.ok(DOCS_COPY_EXPRESSION.includes('replaceChildren'));
  assert.ok(!DOCS_COPY_EXPRESSION.includes('innerHTML'),
    'Trusted Types refuses innerHTML on this document, which is how the first live proof failed');
  assert.ok(DOCS_COPY_EXPRESSION.includes("CustomEvent('copy')"));
  assert.ok(DOCS_COPY_EXPRESSION.includes('[contenteditable]'));
  assert.ok(DOCS_COPY_EXPRESSION.includes('innerText'),
    'paragraphs stay separated as lines instead of welded into one run');
});


test('only document pages take the document path', () => {
  assert.equal(isDocsDocument('https://docs.google.com/document/d/abc/edit'), true);
  assert.equal(isDocsDocument('https://docs.google.com/spreadsheets/d/abc/edit'), false);
  assert.equal(isDocsDocument('https://example.com/'), false);
  assert.equal(isDocsDocument(null), false);
});

// WHY THIS IS PINNED AS TEXT, NOT BEHAVIOR.
// There is no DOM in a unit test, so the only thing checkable here is that the page expression carries the guards.
// A password value that reaches model context is exfiltration wearing a snapshot's clothes; ordinary values still ride along, because a formula bar the agent cannot see is a formula bar it cannot use.


test('a document read trims trailing blank lines', () => {
  assert.ok(DOCS_COPY_EXPRESSION.includes('trimEnd'), 'layout air is not content');
});

// WHY OVERLAY ORDER IS PINNED HERE.
// Menus render at the end of the document but sit on top of it; a snapshot that walks document order buries fresh menu rows past its cap.
// The expression takes overlay descendants first by ARIA role — matched generically, never by site, because a class name here would be per-site code wearing a generic primitive's name.


test('createCanvasMethods exposes read and caretLine', () => {
  const methods = createCanvasMethods({
    cdp: { send: async () => ({}) },
    primitives: { evaluate: async () => null, key: async () => ({}), settle: async () => ({}), clickAt: async () => ({}), viewport: async () => ({ width: 1 }) },
    sleep: async () => {},
    readState: async () => ({ url: 'https://example.com', title: '', text: '' })
  });

  assert.deepEqual(Object.keys(methods).sort(), ['caretLine', 'read']);
});


test('a caret line on a Doc selects, copies, and ends at the line end', async () => {
  const slept = [];
  const cdp = docsCdp([{ result: { value: 'Kajian pustaka mencakup' } }]);
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  const out = await p.caretLine();

  assert.equal(out.line, 'Kajian pustaka mencakup');
  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(keys.map((k) => [k.params.key, k.params.modifiers ?? 0]), [
    ['Home', 0], ['Home', 0], ['End', 8], ['End', 8], ['End', 0], ['End', 0]
  ], 'home, shift-end, copy between, then collapse');
  assert.ok(slept.filter((ms) => ms === SETTLE_POLL_MS).length >= 2, 'a settle after each selection move and restore step, not a fixed beat');
  assert.ok(!slept.some((ms) => ms === 120 || ms === 180), 'and not the old scroll/restore gaps');
});


test('a caret line outside Docs reads the selection instead of the mirror', async () => {
  const calls = [];
  const cdp = {
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        if (params.expression.includes('getSelection')) return { result: { value: 'plain line' } };
        return { result: { value: { title: 't', url: 'https://example.com/', text: 'body' } } };
      }
      return { result: {} };
    }
  };

  const out = await createPrimitives(cdp).caretLine();

  assert.equal(out.line, 'plain line');
  assert.ok(!calls.some((c) => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('texteventtarget')),
    'no mirror on a plain page');
});


test('an unreadable line is empty, and the caret still collapses', async () => {
  const cdp = docsCdp([{ result: { value: null } }]);

  const out = await createPrimitives(cdp).caretLine();

  assert.equal(out.line, '');
  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.equal(keys.at(-1).params.key, 'End', 'the collapse is not skipped on failure');
  assert.equal(keys.at(-1).params.modifiers, 0);
});

// WHY UPLOADS ARE TESTED AGAINST A FAKE FILESYSTEM.
// The bytes rest briefly in a temp file only CDP can name, because the protocol takes paths, not bytes — and a test that wrote real temp files would pass while littering the disk it ran on.
// The fake records every touch, so the test pins the whole lifecycle: stage, hand over, clean up.

