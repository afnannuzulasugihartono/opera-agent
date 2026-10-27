// @last-edited: 2026-10-23 UTC+7.
// @title: local-observe — what the page says about itself, read in as few round trips as it can be read in.
// @state: snapshot, scroll, computed, capture and viewport, and the page expressions that answer them.
// @dependencies: node:test, strict, ../local/drive/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollExpression,
  snapshotExpression
} from '../local/drive/page-expressions.js';
import { createPrimitives } from '../local/drive/primitives.js';
import { createObserveMethods } from '../local/drive/observe.js';
import { recordingCdp } from './helpers/local-page.mjs';

const SCROLL_CDP = (answer) => {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-scroll')) {
        return { result: { value: answer } };
      }
      return {};
    }
  };
};


test('a scroll by pixels answers how far the view actually moved', async () => {
  const cdp = SCROLL_CDP({ from: { x: 0, y: 1200 }, to: { x: 0, y: 2600 }, scroller: { name: 'document', from: 1200, to: 2600 }, movedPx: 1400, atEnd: false, root: 'document' });

  const out = await createPrimitives(cdp).scroll({ y: 1400 });

  assert.equal(out.movedPx, 1400);
  assert.equal(out.scroller.from, 1200);
  assert.equal(out.scroller.to, 2600);
  assert.equal(out.atEnd, false);
  assert.equal(out.root, 'document');
});

// WHY THE SCROLLER IS NAMED AND NOT ASSUMED.
// Measured live on a Google Doc with 21 pages: an end scroll moved the document element by 56 pixels and answered atEnd true.
// A canvas editor scrolls a container of its own, so a tool that reports the window's offset is describing a page that did not move - and claiming its end.


test('a scroll that reached no end says so, and names what it moved instead', async () => {
  const cdp = SCROLL_CDP({
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    scroller: { name: 'div.kix-canvas-tile-content', from: 0, to: 0 },
    movedPx: 0,
    atEnd: false,
    exhausted: true,
    root: 'div.kix-canvas-tile-content',
    target: { found: false, visible: false, y: 0, text: '' }
  });

  const out = await createPrimitives(cdp).scroll({ end: true });

  assert.equal(out.atEnd, false, 'an end that was not reached is never claimed');
  assert.equal(out.movedPx, 0);
  assert.equal(out.root, 'div.kix-canvas-tile-content', 'and the scroller it found is named');
  assert.match(out.why, /as far as it goes/);
  assert.match(out.why, /capture_page\(\) or read_page\(\) is the proof/, 'and it names the call that can actually confirm the end');
});


test('an exhausted scroller is not a page that is finished', async () => {
  const cdp = SCROLL_CDP({
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    scroller: { name: 'div.feed', from: 0, to: 0 },
    movedPx: 0,
    atEnd: false,
    exhausted: true,
    travelPx: 0,
    root: 'div.feed',
    target: { found: false, visible: false, y: 0, text: '' }
  });

  const out = await createPrimitives(cdp).scroll({ end: true });

  assert.equal(out.atEnd, false, 'the scroller had nothing left, but the page did');
  assert.match(out.why, /cannot show that its last words are on screen/, 'and it says exactly which claim it cannot make');
});

// WHY THE WINDOW DOES NOT WIN BY BEING FIRST.
// Measured live on a Google Doc: the window carries 56 pixels of travel and the document below it carries 21,874, so a tool that prefers the window scrolls 56 pixels and reports a page that barely moved.
// The expression is what decides this, so the expression is what is read here.


test('the scroll expression prefers the container with the most room over the window', () => {
  const expression = scrollExpression({ y: 900 });

  assert.match(expression, /docRoom >= bestRoom/, 'the window wins only when it has more room');
  assert.match(expression, /querySelectorAll\('div, main, section'\)/, 'and candidates are found by scroll height, not by guessing an ancestor');
});


test('a scroll whose scroller moved reports that scroller, not the window', async () => {
  const cdp = SCROLL_CDP({
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    scroller: { name: 'div.feed', from: 900, to: 26400 },
    movedPx: 25500,
    atEnd: true,
    root: 'div.feed',
    target: { found: false, visible: false, y: 0, text: '' }
  });

  const out = await createPrimitives(cdp).scroll({ end: true });

  assert.equal(out.root, 'div.feed');
  assert.equal(out.scroller.to, 26400);
  assert.equal(out.atEnd, true);
  assert.equal(out.from.y, 0, 'the window did not move, and the answer says so');
});


test('a scroll to the end says the end was reached, in pixels the page measured', async () => {
  const cdp = SCROLL_CDP({ from: { x: 0, y: 0 }, to: { x: 0, y: 26400 }, scroller: { name: 'document', from: 0, to: 26400 }, movedPx: 26400, atEnd: true, root: 'document' });

  const out = await createPrimitives(cdp).scroll({ end: true });

  assert.equal(out.atEnd, true);
  assert.equal(out.scroller.to, 26400);
  assert.match(cdp.calls[0].params.expression, /opera-scroll/);
});


test('a scroll to a text reports whether that text is now on screen', async () => {
  const cdp = SCROLL_CDP({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, scroller: { name: 'target', from: 0, to: 0 }, movedPx: 1, atEnd: false, root: 'target', target: { found: true, visible: true, y: 420, text: 'BAB V KESIMPULAN DAN SARAN' } });

  const out = await createPrimitives(cdp).scroll({ text: 'BAB V KESIMPULAN DAN SARAN' });

  assert.equal(out.target.found, true);
  assert.equal(out.target.visible, true);
  assert.equal(out.target.y, 420);
  assert.match(cdp.calls[0].params.expression, /BAB V KESIMPULAN/);
});


test('a scroll that finds nothing says so, rather than reporting a scroll that went nowhere', async () => {
  const cdp = SCROLL_CDP({ from: { x: 0, y: 500 }, to: { x: 0, y: 500 }, scroller: { name: 'document', from: 500, to: 500 }, movedPx: 0, atEnd: false, root: 'document', target: { found: false, visible: false, y: 0, text: '' } });

  const out = await createPrimitives(cdp).scroll({ text: 'a heading that is not on this page' });

  assert.equal(out.movedPx, 0);
  assert.equal(out.target.found, false);
  assert.match(out.why, /found nothing/);
});

// WHY A COMPUTED-STYLE READ AND NOT A FORMAT READER.
// The first draft of the missing piece was a format reader - font, size, spacing - and it was wrong twice over: it knew what a document is, and it could not tell an agent that a button turned blue.
// What an agent actually needs is the element it read, the handful of values that decide what a page is showing, and whether that element is even on screen.


const COMPUTED_CDP = (answer) => {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-computed')) {
        return { result: { value: answer } };
      }
      return {};
    }
  };
};


const BLUE_BUTTON = {
  tag: 'BUTTON',
  role: 'button',
  name: 'Bold',
  rect: { x: 12, y: 30, w: 40, h: 30, onScreen: true, clipped: false },
  font: 'Arial',
  size: '13px',
  weight: '700',
  color: 'rgb(255, 255, 255)',
  background: 'rgb(26, 115, 232)',
  display: 'inline-block',
  visibility: 'visible',
  opacity: '1',
  disabled: false
};


test('a computed read names the element it read and the values that decide what the page shows', async () => {
  const cdp = COMPUTED_CDP(BLUE_BUTTON);

  const out = await createPrimitives(cdp).computed({ selector: 'button.bold' });

  assert.equal(out.found, true);
  assert.equal(out.tag, 'BUTTON');
  assert.equal(out.name, 'Bold');
  assert.equal(out.background, 'rgb(26, 115, 232)', 'a turned-blue button is a fact, not a guess');
  assert.equal(out.rect.onScreen, true);
  assert.match(cdp.calls[0].params.expression, /button\.bold/);
});


test('a computed read by point answers about whatever is under that point', async () => {
  const cdp = COMPUTED_CDP({ ...BLUE_BUTTON, tag: 'CANVAS', role: '', name: '', rect: { x: 0, y: 0, w: 1430, h: 893, onScreen: true, clipped: true } });

  const out = await createPrimitives(cdp).computed({ x: 500, y: 300 });

  assert.equal(out.tag, 'CANVAS');
  assert.equal(out.rect.clipped, true, 'an element that runs past the viewport says so');
});


test('a computed read that finds nothing says so, with the call that would find something', async () => {
  const cdp = COMPUTED_CDP(null);

  const out = await createPrimitives(cdp).computed({ x: 5, y: 5 });

  assert.equal(out.found, false);
  assert.match(out.why, /ax_snapshot\(\)/);
});


test('a computed read without a target is refused before it costs a round trip', async () => {
  const cdp = COMPUTED_CDP(BLUE_BUTTON);

  await assert.rejects(() => createPrimitives(cdp).computed({}), /needs a selector, or an x and a y/);
  assert.equal(cdp.calls.length, 0, 'and nothing went to the page');
});

// WHY A CLICK OFF THE PAGE IS REFUSED.
// Measured live: a click_row on an outline row below the fold answered with a click at x 150, y -139.
// A success, on a coordinate no pixel holds - the click landed in nothing and the answer said it landed.
// That is the one class of silence this product cannot be allowed to have, so the click is refused and the refusal names the road that reaches the row.


test('a snapshot costs one round trip, whatever the page holds', async () => {
  const calls = [];
  const cdp = {
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: [
              { role: 'menuitem', name: 'Table t ►', x: 200, y: 220 },
              { role: 'textbox', name: 'Formula', x: 200, y: 220, value: '=SUM(A1)' }
            ]
          }
        };
      }
      return {};
    }
  };

  const snap = await createPrimitives(cdp).snapshot();

  assert.deepEqual(calls.map((call) => call.method), ['Runtime.evaluate'],
    'one call decides the whole snapshot');
  assert.equal(calls[0].params.returnByValue, true, 'the list comes back as a value, not a handle');
  assert.deepEqual(snap, [
    { role: 'menuitem', name: 'Table t ►', x: 200, y: 220 },
    { role: 'textbox', name: 'Formula', x: 200, y: 220, value: '=SUM(A1)' }
  ]);
});


test('the page expression keeps every role the old tree filter kept', () => {
  const expression = snapshotExpression(120);
  for (const role of [
    'button', 'link', 'menuitem', 'menu', 'toolbar', 'textbox', 'searchbox', 'combobox',
    'listbox', 'option', 'checkbox', 'radio', 'tab', 'switch', 'slider',
    'table', 'grid', 'row', 'gridcell', 'cell', 'columnheader', 'rowheader'
  ]) {
    assert.ok(expression.includes(`"${role}"`), `the page still recognises ${role}`);
  }
  assert.match(expression, /getAttribute\('role'\)/,
    'an explicit role attribute is read first, which is what Google Docs puts on its menus');
});


test('a snapshot carries its limit into the page, because the page does the filtering', async () => {
  let expression = '';
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate') { expression = params.expression; return { result: { value: [] } }; }
      return {};
    }
  };

  await createPrimitives(cdp).snapshot({ limit: 2 });
  assert.match(expression, /LIMIT = 2;/);
});


test('a snapshot clamps its limit, so a wild request cannot walk the whole document', async () => {
  const limits = [];
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate') { limits.push(params.expression); return { result: { value: [] } }; }
      return {};
    }
  };

  await createPrimitives(cdp).snapshot({ limit: 99999 });
  assert.match(limits.at(-1), /LIMIT = 500;/, 'a huge request is capped');
  await createPrimitives(cdp).snapshot({ limit: 1 });
  assert.match(limits.at(-1), /LIMIT = 1;/);
});

// WHY A GAPLESS RUN IS NO LONGER ASSERTED AS "FIRED TOGETHER".
// It used to be, and the overlap was real — but it bought almost nothing here and cost the one thing that mattered.
// A round trip over loopback is about three milliseconds, so ten keys cost thirty; over the relay they cost twenty seconds, which is why the overlap existed at all.
// What it actually cost was order: every send proves the link alive before it goes out, so two sends racing reach the wire in the order they finish proving.
// Measured on a live Google Doc, Ctrl+1 typed a literal "1" instead of making a heading.
// A run is now a list of things to do, in order, and only becomes work when it is reached.

// WHY THESE CLAIMS EXIST.
// Measured live on this machine, against a Google Docs document whose window had been minimized: five characters were typed, the call answered with the number of characters it had inserted, and the document held none of them.
// The page had no caret to receive them, and nothing in the answer said so - so the runtime asks the page what it holds before and after, and fails the edit when nothing moved.


test('a snapshot answers with a list, or with nothing at all', async () => {
  const cdp = {
    send: async () => ({ result: { value: null } })
  };
  assert.deepEqual(await createPrimitives(cdp).snapshot(), []);

  const throwing = { send: async () => ({ result: {} }) };
  assert.deepEqual(await createPrimitives(throwing).snapshot(), []);
});


test('a capture is clipped to the clickable viewport at one to one, or every visual click misses', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).capture();

  const shot = cdp.calls.find((c) => c.method === 'Page.captureScreenshot');
  assert.deepEqual(shot.params.clip, { x: 0, y: 0, width: 1136, height: 770, scale: 1 },
    'a pixel in the picture must be a coordinate clickAt accepts');
});


test('a full-page capture spans the content size beyond the viewport', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).capture({ fullPage: true });

  const shot = cdp.calls.find((c) => c.method === 'Page.captureScreenshot');
  assert.equal(shot.params.captureBeyondViewport, true);
  assert.deepEqual(shot.params.clip, { x: 0, y: 0, width: 1136, height: 2400, scale: 1 });
});


test('a huge document scales the full page down instead of hanging the capture', async () => {
  const calls = [];
  const cdp = {
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Page.getLayoutMetrics') {
        return { contentSize: { x: 0, y: 0, width: 800, height: 4800 } };
      }
      if (method === 'Page.captureScreenshot') return { data: 'BASE64' };
      return { result: {} };
    }
  };
  await createPrimitives(cdp).capture({ fullPage: true });

  const shot = calls.find((c) => c.method === 'Page.captureScreenshot');
  assert.deepEqual(shot.params.clip, { x: 0, y: 0, width: 800, height: 4800, scale: 0.5 });
});


test('the viewport reports the device pixel ratio, so a scaled screen is not mistaken for a scaled picture', async () => {
  const cdp = recordingCdp();
  const view = await createPrimitives(cdp).viewport();

  assert.equal(view.width, 1136);
  assert.equal(view.dpr, 1.25);
});


test('secret field values never leave the page', () => {
  const expression = snapshotExpression(120);

  assert.ok(expression.includes("kind === 'password'"), 'password values stay in the page');
  assert.ok(expression.includes('one-time-code'), 'one-time codes stay in the page');
  assert.ok(expression.includes('el.value'), 'ordinary values still ride along');
});


test('overlay rows come first, matched by role and never by site', () => {
  const expression = snapshotExpression(120);

  assert.ok(expression.includes('[role~="menu"]'), 'menus come before document order');
  assert.ok(expression.includes('OVERLAYS'), 'one list names every overlay container');
  assert.ok(!/kix-(?!cursor-caret)/.test(expression), 'no per-site selectors except the one caret exception below');
});


test('the text caret rides the snapshot so the next keystroke lands knowingly', () => {
  const expression = snapshotExpression(120);

  assert.ok(!expression.includes('kix-cursor-caret'), 'the drawn caret is not read: on a shared document it is somebody else\'s');
  assert.ok(expression.includes('getSelection'), 'the caret row comes from this client\'s own selection');
  assert.ok(expression.includes("role: 'caret'"), 'rides as a final row, past the limit');
  assert.ok(expression.includes('isCollapsed'), 'a ranged selection reports nothing rather than a dishonest point');
  assert.ok(!expression.includes('docs-texteventtarget-iframe'), 'the line lives behind caret_line, which selects first; the map carries coordinates only');
});

// WHY THE BEAT IS PINNED, NOT THE TIMING.
// Docs drops a keyDown and keyUp that land in the same tick — three Enter presses vanished live while typed characters beside them survived — so a key holds its down edge one frame before the up, and a stream does not pay that beat twice.
// Fake sleep makes the beats observable without waiting for them.


test('createObserveMethods exposes the reads of the page', () => {
  const methods = createObserveMethods({
    cdp: { send: async () => ({ result: { value: [] } }) },
    primitives: { waitForRow: async () => ({}), resolveHandle: async () => ({}), clickAt: async () => ({}), hoverRow: async () => ({}), settle: async () => ({}) },
    capped: (limit) => limit
  });

  assert.deepEqual(Object.keys(methods).sort(),
    ['capture', 'captureSized', 'computed', 'menuTree', 'openMenu', 'pageState', 'readRows', 'readState', 'resolveRow', 'scroll', 'snapshot', 'viewport']);
});

