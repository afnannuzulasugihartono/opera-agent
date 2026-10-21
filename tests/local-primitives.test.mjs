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
// A chord is two masked events and nothing else. The previous shape — modifier
// downs, a rawKeyDown, modifier ups — leaked its character into a Docs canvas
// under rapid fire while this shape styled cleanly on the same document at the
// same speed, measured 2026-10-13. Two events are also three round trips fewer,
// which compounds over every menu walk an agent drives.
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
import path from 'node:path';
import {
  DOCS_COPY_EXPRESSION,
  DROP_PHASES,
  scrollExpression,
  UPLOAD_INPUT_EXPRESSION,
  dragMimeType,
  isDocsDocument,
  modifierMask,
  snapshotExpression,
  splitText
} from '../local/page-expressions.js';
import { createPrimitives } from '../local/primitives.js';

  // WHY THE FAKE PAGE REMEMBERS WHAT WAS TYPED. The runtime asks the page what it
// holds before and after an edit and fails the edit when nothing moved, so a fake
// whose page never changes would call every correctly typed character a failure -
// and the tests would be checking a browser that eats text.

function recordingCdp() {
  const calls = [];

  const page = { body: '9:body text', value: '', holds: true, tail: '' };
  return {
    calls,
    page,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Input.insertText') {
        const held = page.body.slice(page.body.indexOf(':') + 1);
        const grown = held + String(params.text ?? '');
        page.body = `${grown.length}:${grown}`;
      }
      if (method === 'Runtime.evaluate') {
        if (params.expression.includes('document.title')) {
          return { result: { value: { title: 't', url: 'u', text: 'body text', ready: 'complete' } } };
        }
        if (params.expression.includes('readyState')) return { result: { value: 'complete' } };
        if (params.expression.includes('devicePixelRatio')) {
          return { result: { value: { width: 1136, height: 770, dpr: 1.25 } } };
        }
        if (params.expression.includes('opera-locate')) {
          const held = page.body.slice(page.body.indexOf(':') + 1).replace(/\s+/g, ' ');
          const probe = JSON.parse(/const probe = ("(?:[^"\\]|\\.)*")/.exec(params.expression)[1]).replace(/\s+/g, ' ');
          const at = held.lastIndexOf(probe);
          const tail = page.tail ?? '';
          return { result: { value: {
            index: at,
            field: false,
            before: at < 0 ? held.slice(-40) : held.slice(Math.max(0, at - 40), at),
            after: at < 0 ? '' : held.slice(at + probe.length, at + probe.length + 40) + tail,
            len: held.length
          } } };
        }
        if (params.expression.includes('isContentEditable')) return { result: { value: { ...page } } };
        if (params.expression.includes('opera-hit')) {
          return { result: { value: { tag: 'BUTTON', role: 'button', name: 'Bold' } } };
        }
        return { result: { value: { title: 't', url: 'u', text: 'body text' } } };
      }
      if (method === 'Page.captureScreenshot') return { data: 'BASE64' };
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { pageX: 0, pageY: 0 }, contentSize: { x: 0, y: 0, width: 1136, height: 2400 } };
      }
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

// WHY PLACEMENT IS PROVED AND NOT TRUSTED. Measured live on a Google Doc: a batch
// reported landed:true from inside a table cell, and nothing in the answer said
// where. So type answers with the index and neighbours of what it inserted, and a
// click answers with the element under the point - and both say so when they cannot.

test('type answers where the text landed, not just that it did', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).type('Hello');

  assert.equal(out.landed, true);
  assert.equal(out.placed.found, true);
  assert.equal(out.placed.field, false);
  assert.ok(out.placed.before.endsWith('body text'), `the neighbours come back with the index: ${JSON.stringify(out.placed)}`);
  assert.equal(out.placed.delta, 5);
});

test('text typed into a field is found in the field, because a field never touches the body text', async () => {
  const sigs = [
    { body: '9:body text', value: '0:', holds: true },
    { body: '9:body text', value: '5:hello', holds: true }
  ];
  let asks = 0;
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-locate')) {
        return { result: { value: { index: 0, field: true, before: '', after: '', len: 9 } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: sigs[Math.min(asks++, sigs.length - 1)] } };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp).type('hello');

  assert.equal(out.landed, true);
  assert.equal(out.placed.found, true);
  assert.equal(out.placed.field, true);
  assert.equal(out.placed.delta, 5);
});

// WHY A SLOW MIRROR IS WAITED OUT. Measured live on a Google Doc: the second of two
// consecutive batches reported "nothing on the page changed" while its text sat in
// the document, and the retry duplicated it. The canvas mirrors into the DOM on Docs
// time with the outline lagging saves by seconds, so the check outlasts the lag
// instead of racing it.

test('type outlasts a slow mirror instead of failing over text that landed', async () => {
  let reads = 0;
  const slept = [];
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        reads += 1;
        const moved = reads >= 7;
        return { result: { value: moved
          ? { body: '14:body textHello', value: '', holds: true }
          : { body: '9:body text', value: '', holds: true } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-locate')) {
        return { result: { value: { index: 9, before: 'body text', after: '', len: 14 } } };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } }).type('Hello');

  assert.equal(out.landed, true);
  assert.ok(reads > 4, `a four-ask budget would have failed this: ${reads} reads`);
  assert.deepEqual(slept, new Array(slept.length).fill(150), 'and every beat of the wait is the same length');
});

test('type survives an unfindable probe, because the page moved even if the probe did not match', async () => {
  const sigs = [
    { body: '9:body text', value: '', holds: true },
    { body: '14:body textHello', value: '', holds: true }
  ];
  let asks = 0;
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-locate')) {
        return { result: { value: { index: -1, before: 'body textHello', after: '', len: 14 } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: sigs[Math.min(asks++, sigs.length - 1)] } };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp).type('Hello');

  assert.equal(out.landed, true);
  assert.equal(out.placed.found, false);
});

test('a click answers with the element under the point', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).clickAt(384, 46);

  assert.deepEqual(out.hit, { tag: 'BUTTON', role: 'button', name: 'Bold', canvas: false });
});

test('a click on canvas says canvas, because elementFromPoint cannot see through it', async () => {
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-hit')) {
        return { result: { value: { tag: 'CANVAS', role: '', name: '' } } };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp).clickAt(500, 600);

  assert.equal(out.hit.canvas, true);
  assert.equal(out.hit.tag, 'CANVAS');
});

// WHY THE CHORD IS ORDERED, NOT MERGED. Two sends racing in a Promise.all do
// not keep their order on the wire, because every send proves the link alive
// first and that proof is its own await. Chrome was handed a keyUp before its
// keyDown, so Ctrl+1 typed a literal "1" into a live Google Doc instead of
// making a heading. The order is the shortcut.

// WHY AN APPEND ANSWERS WHERE IT PUT THE TEXT. Measured live while building a thesis:
// the road to the end of a document was click, Ctrl+End, and trust - and once the caret
// did not go where it was told, a whole batch landed inside a table cell and four extra
// calls plus an undo were spent recovering. So the append carries the positioning, and
// its answer measures "at the end" instead of assuming it.

test('append puts the text at the end and proves nothing follows it', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).append('tail text');

  assert.equal(out.landed, true);
  assert.equal(out.atEnd, true);
  assert.match(out.atEndWhy, /nothing follows/);
  const endKey = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.ok(endKey.length >= 2, 'the caret is asked for the end before anything is typed');
  assert.match(cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent').params.key, /End/);
});

test('append says so when text follows it, because "at the end" is a claim to prove', async () => {
  const cdp = recordingCdp();
  cdp.page.tail = 'text the page already held after it';

  const out = await createPrimitives(cdp).append('tail text');

  assert.equal(out.atEnd, false);
  assert.match(out.atEndWhy, /text follows it/);
});

test('append admits it cannot see where the text went rather than claiming the end', async () => {
  const sigs = [
    { body: '9:body text', value: '', holds: true },
    { body: '18:body texttail text', value: '', holds: true }
  ];
  let asks = 0;
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-locate')) {
        return { result: { value: { index: -1, field: false, before: 'body texttail text', after: '', len: 18 } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: sigs[Math.min(asks++, sigs.length - 1)] } };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp).append('tail text');

  assert.equal(out.landed, true);
  assert.equal(out.atEnd, false, 'a page that cannot be seen into cannot be claimed for');
  assert.match(out.atEndWhy, /read_page\(\) is the proof/);
});

// WHY A SCROLL TOOL AND NOT A KEY. Measured live on a Google Doc with 21 pages: the
// only way to move the view was a key chord aimed at a guess, and an outline row the
// agent wanted to click answered with coordinates above the viewport - a click that
// reported success and hit nothing. Scroll is also the only road to an infinite feed
// and to anything that lazy-loads, so without it most of a web page does not exist.
// The answer carries the scroll it actually performed and where the view came to rest,
// because a scroll that moved the page and a scroll that moved the right thing look
// identical from the outside otherwise.

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

// WHY THE SCROLLER IS NAMED AND NOT ASSUMED. Measured live on a Google Doc with 21
// pages: an end scroll moved the document element by 56 pixels and answered atEnd
// true. A canvas editor scrolls a container of its own, so a tool that reports the
// window's offset is describing a page that did not move - and claiming its end.

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

// WHY THE WINDOW DOES NOT WIN BY BEING FIRST. Measured live on a Google Doc: the
// window carries 56 pixels of travel and the document below it carries 21,874, so a
// tool that prefers the window scrolls 56 pixels and reports a page that barely
// moved. The expression is what decides this, so the expression is what is read here.

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

// WHY A COMPUTED-STYLE READ AND NOT A FORMAT READER. The first draft of the missing
// piece was a format reader - font, size, spacing - and it was wrong twice over: it
// knew what a document is, and it could not tell an agent that a button turned blue.
// What an agent actually needs is the element it read, the handful of values that
// decide what a page is showing, and whether that element is even on screen.

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

// WHY A CLICK OFF THE PAGE IS REFUSED. Measured live: a click_row on an outline row
// below the fold answered with a click at x 150, y -139. A success, on a coordinate
// no pixel holds - the click landed in nothing and the answer said it landed. That is
// the one class of silence this product cannot be allowed to have, so the click is
// refused and the refusal names the road that reaches the row.

test('a click outside the viewport is refused, with the road that would reach the point', async () => {
  const cdp = recordingCdp();

  await assert.rejects(
    () => createPrimitives(cdp).clickAt(150, -139),
    /click refused: 150,-139 is outside the 1136x770 viewport.*scroll\(\{text\}\)/s
  );
  assert.equal(
    cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length,
    0,
    'and nothing was pressed against a coordinate no pixel holds'
  );
});

test('a click on the edge of the viewport is still allowed', async () => {
  const cdp = recordingCdp();

  await createPrimitives(cdp).clickAt(1136, 770);

  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 3);
});

test('a chord is two masked events with codes and no text, because separate modifier presses leaked under rapid fire', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  const out = await p.key('a', ['Control']);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.equal(events.length, 2, 'key down, key up, nothing else');
  assert.equal(events[0].params.type, 'rawKeyDown');
  assert.equal(events[0].params.key, 'a');
  assert.equal(events[0].params.modifiers, 2);
  assert.equal(events[0].params.text, undefined);
  assert.equal(events[0].params.windowsVirtualKeyCode, 65);
  assert.equal(events[0].params.nativeVirtualKeyCode, 65);
  assert.equal(events[1].params.type, 'keyUp');
  assert.equal(events[1].params.modifiers, 2);
  assert.deepEqual(out, { key: 'a', modifiers: 2 });
});

// WHY A MISSPELLED MODIFIER MAY NOT BECOME A PLAIN KEY. 'control' in lower
// case used to sum to zero, which turned Ctrl+1 into the keystroke "1" and
// looked like the page ignoring a shortcut. The name is either right or it is
// an error; there is no third answer that quietly presses something else.

test('a modifier nobody recognises is an error, not a keypress', async () => {
  const cdp = recordingCdp();
  await assert.rejects(() => createPrimitives(cdp).key('a', ['control']), /Unknown modifier.*Control/s);
  await assert.rejects(() => createPrimitives(cdp).key('a', ['Ctrl']), /Unknown modifier/);
  assert.deepEqual(cdp.calls, [], 'nothing reached the browser');
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

test('Tab carries no text, because text on Tab stranded Sheets focus in the formula bar', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('Tab');

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type !== 'keyUp');
  assert.equal(down.params.text, undefined);
  assert.equal(down.params.windowsVirtualKeyCode, 9);
  assert.equal(down.params.code, 'Tab');
});

test('punctuation types through its US key, because values carry underscores', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('_');

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
  assert.equal(down.params.text, '_');
  assert.equal(down.params.code, 'Minus');
  assert.equal(down.params.windowsVirtualKeyCode, 189);
});

test('an unknown key fails loudly before anything is sent, or a value silently loses a character', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  await assert.rejects(() => p.key('Frobnicator'), /Unknown key/);
  await assert.rejects(() => p.keys([{ text: 'a' }, { key: 'Frobnicator' }]), /Unknown key/);
  assert.deepEqual(cdp.calls, [], 'a refused stream must not partially execute');
});

test('a named key like Enter is dispatched with its virtual key code', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('Enter');

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
  assert.equal(down.params.windowsVirtualKeyCode, 13);
  assert.equal(down.params.code, 'Enter');
});

test('front brings the tab forward so the watcher sees where the agent is', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).front();

  assert.equal(out, true);
  assert.ok(cdp.calls.some((c) => c.method === 'Page.bringToFront'));
});

test('Space types a real blank, because Sheets values carry them', async () => {  const cdp = recordingCdp();
  await createPrimitives(cdp).key('Space');

  const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
  assert.equal(down.params.key, ' ');
  assert.equal(down.params.code, 'Space');
  assert.equal(down.params.windowsVirtualKeyCode, 32);
  assert.equal(down.params.text, ' ');
});

test('a stream preserves order, counts its work, and refuses what it cannot carry', async () => {
  const cdp = recordingCdp();
  const slept = [];
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  const out = await p.keys([
    { key: '1', modifiers: ['Control', 'Alt'] },
    { text: 'Hi' },
    { key: 'Enter', gapMs: 50 }
  ]);

  assert.equal(out.events, 3);
  assert.equal(out.chords, 2);
  assert.equal(out.chars, 2);
  assert.ok(out.execMs >= 0);
  assert.deepEqual(slept, [50, 50, 50, 50, 50],
    'each chord keeps its beat twice — inside the key and after it in the stream — then the asked gap');
  assert.deepEqual(
    cdp.calls.map((c) => c.method),
    ['Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Runtime.evaluate'],
    'the run is what was written, bracketed by the two questions that prove the text landed'
  );
  await assert.rejects(() => p.keys([]), /non-empty/);
  await assert.rejects(() => p.keys(new Array(101).fill({ key: 'a' })), /at most 100/);
  await assert.rejects(() => p.keys([{ key: 'a', gapMs: 5000 }]), /gap/);
  await assert.rejects(() => p.keys([{ key: 'a', text: 'b' }]), /not both/);
  await assert.rejects(() => p.keys([{}]), /needs text or a key/);
});

// WHY THIS CLAIM EXISTS. The snapshot used to read the accessibility tree and
// then ask for one box per element it liked, up to a hundred and twenty of
// them. The extension runs one command at a time on purpose, so those were
// sequential however the caller wrote them, and a snapshot on a Google Doc cost
// about two seconds before anything had decided anything. Chrome has no batch
// API for element boxes, so the work moved into the page. If this test ever
// needs more than one call again, that is the regression worth catching.

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

// WHY A GAPLESS RUN IS NO LONGER ASSERTED AS "FIRED TOGETHER". It used to be,
// and the overlap was real — but it bought almost nothing here and cost the one
// thing that mattered. A round trip over loopback is about three milliseconds,
// so ten keys cost thirty; over the relay they cost twenty seconds, which is
// why the overlap existed at all. What it actually cost was order: every send
// proves the link alive before it goes out, so two sends racing reach the wire
// in the order they finish proving. Measured on a live Google Doc, Ctrl+1 typed
// a literal "1" instead of making a heading. A run is now a list of things to
// do, in order, and only becomes work when it is reached.

// WHY THESE CLAIMS EXIST. Measured live on this machine, against a Google Docs
// document whose window had been minimized: five characters were typed, the call
// answered with the number of characters it had inserted, and the document held
// none of them. The page had no caret to receive them, and nothing in the answer said
// so - so the runtime asks the page what it holds before and after, and fails the
// edit when nothing moved.

test('text that lands is reported as landed, and the page is asked once on the way in and once on the way out', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).type('Hi');

  assert.equal(out.landed, true);
  const asks = cdp.calls.filter((c) => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('isContentEditable') && !String(c.params.expression).includes('opera-locate'));
  assert.equal(asks.length, 2, 'one question before, one after, and the page answered the first time');
  const locates = cdp.calls.filter((c) => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('opera-locate'));
  assert.equal(locates.length, 1, 'and one question about where it landed');
});

test('a page with no caret fails the edit instead of counting the characters it inserted', async () => {
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: { body: '19:Untitled document\n\n', value: '', holds: true } } };
      }
      return {};
    }
  };

  await assert.rejects(() => createPrimitives(cdp).type('GUARD'), /typed 5 characters and nothing on the page changed: nothing on the page held focus - click_row the field that should receive it/);
});

// WHY A TYPE THAT LANDS NOWHERE MUST NAME WHAT HAD FOCUS. Measured live on YouTube:
// a cookie wall sat over the page, the type inserted nothing, and the answer offered
// two guesses - no caret, or a minimized window. The page was already saying the third
// thing: focus sat on the wall's button. A name costs one evaluation and ends the
// guessing, so the failure carries it.

test('a type that lands nowhere names the element that had focus', async () => {
  const cdp = {
    calls: [],
    send: async (method, params = {}) => {
      cdp.calls.push({ method, params });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('trail')) {
        return { result: { value: { trail: 'button#button', tag: 'BUTTON', editable: false } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: { body: '19:Untitled document\n\n', value: '', holds: true } } };
      }
      return {};
    }
  };

  await assert.rejects(
    () => createPrimitives(cdp).type('GUARD'),
    /nothing on the page changed: focus was on button#button, which takes no text - click_row the field that should receive it, or press Escape if a dialog is over it/
  );
});

// WHY A CLICK ASKS WHO OWNS THE POINT. A cookie wall over a page turns a click_row into
// a success report for a click that reached nothing: measured live, the row answered
// with its own name and point while focus never left the wall's button. The point has
// one owner, and saying which is cheaper than the guess that follows.

test('a click_row says when something else owns the point it clicked', async () => {
  const cdp = {
    calls: [],
    send: async (method, params = {}) => {
      cdp.calls.push({ method, params });
      if (method === 'DOM.getBoxModel') return { model: { content: [100, 200, 300, 200, 300, 260, 100, 260] } };
      if (method === 'DOM.resolveNode') return { object: { objectId: 'o-9' } };
      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: { covered: true, coveredBy: 'div[button]', coveredText: 'Reject the use of cookies and other data' } } };
      }
      return { result: {} };
    }
  };

  const out = await createPrimitives(cdp).clickHandle('opera-4321');

  assert.equal(out.covered, true, 'the point belongs to something else');
  assert.equal(out.coveredBy, 'div[button]');
  assert.match(out.coveredText, /Reject the use of cookies/);
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 3,
    'the click still goes out - the caller decides, and now with a fact');
});

test('a click_row whose point belongs to the row says so, and one that belongs to nothing claims nothing', async () => {
  const owned = {
    calls: [],
    send: async (method, params = {}) => {
      owned.calls.push({ method, params });
      if (method === 'DOM.getBoxModel') return { model: { content: [100, 200, 300, 200, 300, 260, 100, 260] } };
      if (method === 'DOM.resolveNode') return { object: { objectId: 'o-9' } };
      if (method === 'Runtime.callFunctionOn') return { result: { value: { covered: false } } };
      return { result: {} };
    }
  };
  assert.equal((await createPrimitives(owned).clickHandle('opera-4321')).covered, false);

  const silent = {
    calls: [],
    send: async (method, params = {}) => {
      silent.calls.push({ method, params });
      if (method === 'DOM.getBoxModel') return { model: { content: [100, 200, 300, 200, 300, 260, 100, 260] } };
      return { result: {} };
    }
  };
  const out = await createPrimitives(silent).clickHandle('opera-4321');
  assert.equal('covered' in out, false, 'a page that cannot answer is not given an invented verdict');
});

test('a page with nothing to type into says so in the words of that fact', async () => {
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: { body: '0:', value: '', holds: false } } };
      }
      return {};
    }
  };

  await assert.rejects(() => createPrimitives(cdp).type('GUARD'), /holds no text and no field to receive them/);
});

test('text typed into a field counts as landed, because a field does not change the page text', async () => {
  let value = '';
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Input.insertText') value += params.text;
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: { body: '9:no change', value: `${value.length}:${value}`, holds: true } } };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp).type('q');

  assert.equal(out.landed, true, 'the field moved, so the text landed');
});

test('a stream reports whether the page moved, because a shortcut in it can move the page on its own', async () => {
  const cdp = pipelinedCdp();

  const out = await createPrimitives(cdp).keys([{ key: 'a', modifiers: ['Control'] }, { text: 'Hi' }]);

  assert.equal(out.moved, true, 'the text moved the page, and the stream says so');
});

test('a run reaches the wire in the order it was written', async () => {
  const cdp = pipelinedCdp();

  await createPrimitives(cdp, { sleep: async () => {} }).keys([
    { key: '1', modifiers: ['Control'] },
    { text: 'Hi' },
    { key: 'Enter' }
  ]);

  assert.deepEqual(
    cdp.calls.map((c) => `${c.method}:${c.params.type ?? ''}`),
    [
      'Runtime.evaluate:',
      'Input.dispatchKeyEvent:rawKeyDown',
      'Input.dispatchKeyEvent:keyUp',
      'Input.insertText:',
      'Input.dispatchKeyEvent:keyDown',
      'Input.dispatchKeyEvent:keyUp',
      'Runtime.evaluate:'
    ],
    'a chord closes before the next event starts, and the text lands between them'
  );
});

test('a gap splits the run, so a beat for the UI is a real beat', async () => {
  const slept = [];
  const cdp = pipelinedCdp();
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  await p.keys([{ text: 'a', gapMs: 50 }, { text: 'b' }]);

  assert.deepEqual(slept, [50]);
  assert.deepEqual(
    cdp.calls.filter((c) => c.method === 'Input.insertText').map((c) => c.params.text),
    ['a', 'b']
  );
});

test('a click fires move, press and release together', async () => {
  const cdp = pipelinedCdp();

  await createPrimitives(cdp).clickAt(10, 20);

  assert.equal(cdp.stats().max, 4, 'spotlight and three mouse events overlap');
});

// WHY A SNAPSHOT MUST NOT SEND A STALE SHAPE BACK. The page expression returns
// the list itself, so anything that is not a list means the page answered with
// something else — an exception object, a string from a transpiler shim. An
// empty list is the honest answer: an agent that gets [] will look again, and an
// agent that gets null will read it as a page with nothing on it.

test('a snapshot answers with a list, or with nothing at all', async () => {
  const cdp = {
    send: async () => ({ result: { value: null } })
  };
  assert.deepEqual(await createPrimitives(cdp).snapshot(), []);

  const throwing = { send: async () => ({ result: {} }) };
  assert.deepEqual(await createPrimitives(throwing).snapshot(), []);
});

test('type chunks fire together', async () => {
  const cdp = pipelinedCdp();

  await createPrimitives(cdp, { chunkSize: 10 }).type('x'.repeat(35));

  assert.equal(cdp.stats().max, 4);
});

function pipelinedCdp(handler = () => ({})) {
  const calls = [];
  let inflight = 0;
  let max = 0;
  const page = { body: '9:body text', value: '', holds: true };
  return {
    calls,
    page,
    stats: () => ({ max }),
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Input.insertText') {
        const held = page.body.slice(page.body.indexOf(':') + 1);
        const grown = held + String(params.text ?? '');
        page.body = `${grown.length}:${grown}`;
      }
      inflight += 1;
      max = Math.max(max, inflight);
      await Promise.resolve();
      await Promise.resolve();
      inflight -= 1;
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-locate')) {
        const held = page.body.slice(page.body.indexOf(':') + 1).replace(/\s+/g, ' ');
        const probe = JSON.parse(/const probe = ("(?:[^"\\]|\\.)*")/.exec(params.expression)[1]).replace(/\s+/g, ' ');
        const at = held.lastIndexOf(probe);
        return { result: { value: { index: at, field: false, before: '', after: '', len: held.length } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('isContentEditable')) {
        return { result: { value: { ...page } } };
      }
      return handler(method, params);
    }
  };
}

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

  const downs = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'rawKeyDown');
  assert.equal(downs.length, 1, 'one keyDown carries the whole chord');
  assert.equal(downs[0].params.key, '2');
  assert.equal(downs[0].params.text, undefined, 'sending text here types a literal 2 into the document');
  assert.equal(downs[0].params.code, 'Digit2');
  assert.equal(downs[0].params.modifiers, 3, 'control and alt both held');
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

  const downs = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'rawKeyDown');
  assert.equal(downs.length, 1);
  assert.equal(downs[0].params.key, 'a');
  assert.equal(downs[0].params.text, undefined);
});

test('every keyUp carries the same mask as its keyDown, so the chord reads whole on both edges', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('2', ['Control', 'Alt']);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(events.map((e) => e.params.type), ['rawKeyDown', 'keyUp']);
  assert.equal(events[1].params.modifiers, 3);
  assert.equal(events[1].params.text, undefined);
});

test('a hover moves the pointer and stops, because a submenu opens on hover and a click closes the menu', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).hover(193, 113);

  const calls = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.equal(calls.length, 1, 'a hover must not press anything');
  assert.equal(calls[0].params.type, 'mouseMoved');
  assert.equal(calls[0].params.buttons, 0);
});

test('every pointer action marks its spot for the watcher, red for click and blue for hover', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  await p.hover(100, 100);
  await p.clickAt(200, 220);

  const marks = cdp.calls.filter((c) => c.method === 'Runtime.evaluate' && c.params.expression.includes('opera-spot'));
  assert.equal(marks.length, 2);
  assert.match(marks[0].params.expression, /66,133,244/);
  assert.match(marks[0].params.expression, /87px.*87px/);
  assert.match(marks[1].params.expression, /255,60,60/);
  assert.match(marks[1].params.expression, /187px.*207px/);
  assert.match(marks[1].params.expression, /el\.remove\(\)/, 'and the mark takes itself off the page, because a mark that stays is a ring over the next picture');
});

test('a refused spotlight never breaks the click it decorates', async () => {
  const cdp = {
    calls: [],
    send: async (method, params = {}) => {
      cdp.calls.push({ method, params });
      if (method === 'Runtime.evaluate') throw new Error('script not allowed here');
      return { result: {} };
    }
  };

  const out = await createPrimitives(cdp).clickAt(10, 20);

  assert.deepEqual(out, { x: 10, y: 20, hit: null });
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 3);
});

// WHY THIS USED TO BE THE OTHER WAY ROUND. This test once asserted that a hover
// must NOT wait for the page's reply, and it proved that with a promise that
// never settles. That was measured as a hover that returned in one millisecond
// while its move sat in the worker's queue for five, and the next command's
// liveness proof then queued behind it and failed — so one lie became two
// failures. A page that never answers is now visible from this call.

test('a hover waits for the move it dispatched, or it has not hovered', async () => {
  let moves = 0;
  const cdp = {
    send: (method) => {
      if (method === 'Input.dispatchMouseEvent') {
        moves += 1;
        return new Promise(() => {});
      }
      return Promise.resolve({});
    }
  };

  const settled = await Promise.race([
    createPrimitives(cdp).hover(10, 20).then(() => 'returned'),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), 150))
  ]);

  assert.equal(settled, 'still waiting', 'a hover cannot claim success while its move is unanswered');
  assert.equal(moves, 1, 'the move is sent exactly once');
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

// WHY THESE CLAIMS EXIST. Google Docs draws the document on a canvas, so the
// page text a read used to return held the toolbar chrome and none of the
// content. The document is read through its own copy path instead: select all,
// dispatch a copy event at the hidden text iframe, and take what Docs itself
// populated. Proven on a live document at thirteen milliseconds for a full
// read; these hold the wiring so the proof stays true.

const DOC_URL = 'https://docs.google.com/document/d/abc/edit';

// WHY THE FAKE ANSWERS THREE CARET QUESTIONS AND NOT ONE. A read writes the caret
// down, puts the view back so the click lands on that spot, and then looks again to
// see whether the caret came back. One answer cannot serve all three, because the
// third is the measurement the whole claim rests on.
//
// WHY THE MEASUREMENT IS IN CONTENT COORDINATES. Measured live: after a read the
// caret sat below the visible page, at y=1649 in a 1215-tall viewport, so the
// viewport point before and after matched while the caret was nowhere near where it
// started. Content coordinates — the viewport point plus the scroll of every box
// around it — do not move when the page scrolls, so they can tell the truth about a
// caret that is off the screen.

function docsCdp(copyAnswers, caret = null) {
  const calls = [];
  const pending = [...copyAnswers];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        if (params.expression.includes('texteventtarget')) {
          return pending.shift() ?? { result: { value: null } };
        }
        if (params.expression.includes('scroll: chain.map(')) {
          return { result: { value: caret?.mark ?? null } };
        }
        if (params.expression.includes('const now =')) {
          return { result: { value: caret?.point ?? null } };
        }
        if (params.expression.includes('absX: Math.round')) {
          return { result: { value: caret?.seen ?? null } };
        }
        if (params.expression.includes('kix-canvas-tile')) {
          return { result: { value: { x: 700, y: 200 } } };
        }
        if (params.expression.includes('document.title')) {
          return { result: { value: { title: 'Doc', url: DOC_URL, text: 'chrome' } } };
        }
      }
      return { result: {} };
    }
  };
}

test('a read on a settled page takes two samples and says the text stood still', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).read();

  assert.deepEqual(out, {
    title: 't',
    url: 'u',
    text: 'body text',
    ready: 'complete',
    settled: true,
    grewBy: 0,
    caretMoved: false,
    caretRestored: true,
    viewRestored: true,
    caretWhy: ''
  });
  assert.deepEqual(cdp.calls.map((c) => c.method), ['Runtime.evaluate', 'Runtime.evaluate'],
    'two cheap samples, not a guess');
});

// WHY A READ THAT RETURNS A TENTH OF THE PAGE IS THE BUG THIS PINS. Measured live on
// YouTube: at 1.9 seconds readyState said complete with 871 characters; by 2.4 seconds
// the page held 8,478. One read there is not wrong about what it saw - it is wrong
// about what it implies, because nothing in the answer says the page was still filling
// in. The second sample turns that into a fact the caller can act on.

test('a read on a page still filling in says so, and answers with the later sample', async () => {
  const samples = [
    { title: 'YouTube', url: 'https://www.youtube.com/', text: 'x'.repeat(871), ready: 'complete' },
    { title: 'YouTube', url: 'https://www.youtube.com/', text: 'x'.repeat(8478), ready: 'complete' }
  ];
  let ask = 0;
  const cdp = {
    calls: [],
    send: async (method, params = {}) => {
      cdp.calls.push({ method, params });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('document.title')) {
        return { result: { value: samples[Math.min(ask++, samples.length - 1)] } };
      }
      return { result: {} };
    }
  };

  const out = await createPrimitives(cdp).read();

  assert.equal(out.ready, 'complete', 'readyState said complete, and that is exactly why it cannot be the only signal');
  assert.equal(out.settled, false, 'the page had not stopped moving');
  assert.equal(out.grewBy, 7607, 'and it says by how much');
  assert.equal(out.text.length, 8478, 'the answer is the later sample, not the one already stale');
});

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
  assert.deepEqual(slept, [50, 150, 50],
    'each borrowed key keeps its beat, and the selection settles before the copy forces it out');
});

// WHY THE READ PUTS THE CARET BACK. Reading a Doc borrows the selection, and a
// borrowed selection leaves the caret at the end of the document, so the next click
// lands where the agent has already been. Measured live: a read followed by a click
// typed into the wrong place because of exactly that, twice.
//
// WHY THE POINT IS TAKEN RELATIVE TO THE SCROLLING BOX, NOT THE WINDOW. The read
// scrolls the document to the caret, so a viewport point measured before the read
// points at different text after it. The place that survives is the caret's offset
// inside the box that scrolls, so that is what is written down, together with the
// scroll the view was at — which is put back before the click, so the click lands
// on the text the caret was on and the caller gets the view back too.
//
// WHY THE ANSWER IS A MEASUREMENT. A read that reports a restore it did not check is
// an assertion, and the first time the page does not oblige it teaches the agent to
// trust it. The caret is looked at again after the click and compared, and a caret
// that did not come back is reported as one that did not come back.

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

// WHY NO CLICK GOES OUT WHEN THE VIEW DID NOT COME BACK. The point was measured in
// the view as it was before the read, so with the view somewhere else the same
// numbers point at other text. Clicking there would move the caret and the
// selection to whatever happens to be under them, which is the very damage the
// restore exists to prevent.

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

// WHY THIS IS PINNED AS TEXT, NOT BEHAVIOR. There is no DOM in a unit test,
// so the only thing checkable here is that the page expression carries the
// guards. A password value that reaches model context is exfiltration wearing
// a snapshot's clothes; ordinary values still ride along, because a formula
// bar the agent cannot see is a formula bar it cannot use.

test('secret field values never leave the page', () => {
  const expression = snapshotExpression(120);

  assert.ok(expression.includes("kind === 'password'"), 'password values stay in the page');
  assert.ok(expression.includes('one-time-code'), 'one-time codes stay in the page');
  assert.ok(expression.includes('el.value'), 'ordinary values still ride along');
});

test('a document read trims trailing blank lines', () => {
  assert.ok(DOCS_COPY_EXPRESSION.includes('trimEnd'), 'layout air is not content');
});

// WHY OVERLAY ORDER IS PINNED HERE. Menus render at the end of the document
// but sit on top of it; a snapshot that walks document order buries fresh
// menu rows past its cap. The expression takes overlay descendants first by
// ARIA role — matched generically, never by site, because a class name here
// would be per-site code wearing a generic primitive's name.

test('overlay rows come first, matched by role and never by site', () => {
  const expression = snapshotExpression(120);

  assert.ok(expression.includes('[role~="menu"]'), 'menus come before document order');
  assert.ok(expression.includes('OVERLAYS'), 'one list names every overlay container');
  assert.ok(!/kix-(?!cursor-caret)/.test(expression), 'no per-site selectors except the one caret exception below');
});

test('the text caret rides the snapshot so the next keystroke lands knowingly', () => {
  const expression = snapshotExpression(120);

  assert.ok(expression.includes('kix-cursor-caret'), 'the canvas caret Docs exposes');
  assert.ok(expression.includes("role: 'caret'"), 'rides as a final row, past the limit');
  assert.ok(expression.includes('isCollapsed'), 'a ranged selection reports nothing rather than a dishonest point');
  assert.ok(!expression.includes('docs-texteventtarget-iframe'), 'the line lives behind caret_line, which selects first; the map carries coordinates only');
});

// WHY THE BEAT IS PINNED, NOT THE TIMING. Docs drops a keyDown and keyUp that
// land in the same tick — three Enter presses vanished live while typed
// characters beside them survived — so a key holds its down edge fifty
// milliseconds before the up, and chords in a stream breathe the same between
// them. Fake sleep makes the beats observable without waiting for them.

test('a key holds its down edge a beat before the up', async () => {
  for (const modifiers of [['Control'], []]) {
    const slept = [];
    const cdp = recordingCdp();
    await createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } }).key('a', modifiers);

    assert.deepEqual(slept, [50], 'down, beat, up — chord and bare key alike');
  }
});

test('chords in a stream breathe between them, texts do not need to', async () => {
  const slept = [];
  const cdp = recordingCdp();
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  await p.keys([{ key: 'a', modifiers: ['Control'] }, { text: 'hi' }, { key: 'b', modifiers: ['Control'] }]);

  assert.deepEqual(slept, [50, 50, 50, 50], 'each chord beats inside and after; the text passes through');
});

// WHY ALL FOUR ARROWS ARE PINNED. The table grid in Google Docs expands right
// and down; with only Up and Down known, a drive that needed Right died on an
// "Unknown key" in the middle of a live thesis. Directions come in fours.

test('all four arrows dispatch with their virtual key codes', async () => {
  for (const [name, vk, code] of [['ArrowLeft', 37, 'ArrowLeft'], ['ArrowRight', 39, 'ArrowRight'], ['ArrowUp', 38, 'ArrowUp'], ['ArrowDown', 40, 'ArrowDown']]) {
    const cdp = recordingCdp();
    await createPrimitives(cdp).key(name);

    const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'rawKeyDown');
    assert.equal(down.params.windowsVirtualKeyCode, vk, name);
    assert.equal(down.params.code, code, name);
  }
});

// WHY READING A LINE SELECTS IT FIRST. The mirror a copy reads from only
// holds what a selection put there: measured live as an empty line beside a
// perfectly visible caret. So the read selects its own line, copies, and
// collapses back to the line end. Steps breathe because injected keys land
// late; without the beats the copy runs before the selection exists.

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
  assert.deepEqual(slept.filter((ms) => ms === 300).length, 2, 'a beat after each move');
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

// WHY UPLOADS ARE TESTED AGAINST A FAKE FILESYSTEM. The bytes rest briefly in
// a temp file only CDP can name, because the protocol takes paths, not bytes —
// and a test that wrote real temp files would pass while littering the disk it
// ran on. The fake records every touch, so the test pins the whole lifecycle:
// stage, hand over, clean up.

function fakeUploadFs() {
  const calls = [];
  return {
    calls,
    existsSync: (p) => { calls.push(['exists', p]); return p === '/files/pic.png'; },
    statSync: (p) => { calls.push(['stat', p]); return { size: 42 }; },
    mkdtempSync: (prefix) => { calls.push(['mkdtemp', prefix]); return '/tmp/opera-upload-x'; },
    writeFileSync: (p, bytes) => { calls.push(['write', p, bytes.length]); },
    unlinkSync: (p) => { calls.push(['unlink', p]); },
    rmdirSync: (p) => { calls.push(['rmdir', p]); }
  };
}

const fakeUploadOs = { tmpdir: () => '/tmp' };
const fakeUploadPath = { join: (...parts) => parts.join('/'), basename: (p) => p.split('/').pop() };

function uploadCdp() {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { objectId: 'o1' } };
      return { result: {} };
    }
  };
}

// WHY THE FINDER HAS TWO ROADS. The pierced query is what finds a closed
// shadow root; the page script is what finds a frame the browser refuses to
// pierce. Each is proven on its own: a cdp that answers the DOM road proves the
// pierced path, a cdp that answers only the script proves the fallback, and a
// cdp that answers neither proves the honest `inputFound: false`.

function piercedUploadCdp() {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelectorAll') return { nodeIds: [42] };
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 'b7' } };
      if (method === 'Runtime.evaluate') return { result: { subtype: 'null' } };
      return { result: {} };
    }
  };
}

test('an upload refuses anything but exactly one source', async () => {
  const p = createPrimitives(uploadCdp());

  await assert.rejects(() => p.upload({}), /filename/);
  await assert.rejects(() => p.upload({ filename: 'a.png' }), /exactly one/);
  await assert.rejects(() => p.upload({ filename: 'a.png', data: 'eA==', path: '/files/pic.png' }), /exactly one/);
  await assert.rejects(() => p.upload({ filename: 'a.png', data: '' }), /no bytes/);
  await assert.rejects(() => p.upload({ filename: 'a.png', path: '/files/missing.png' }), /no such file/);
});

test('bytes are staged, handed over, and cleaned up', async () => {
  const fs = fakeUploadFs();
  const cdp = uploadCdp();
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', data: Buffer.from('bytes').toString('base64') });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 5 });
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/tmp/opera-upload-x/pic.png'], objectId: 'o1' });
  assert.deepEqual(fs.calls.map((c) => c[0]), ['mkdtemp', 'write', 'unlink', 'rmdir'], 'stage, hand over, clean up, in that order');
  assert.ok(cdp.calls.some((c) => c.method === 'Runtime.releaseObjectGroup'), 'the handle is released, not leaked');
});

test('a path uploads in place with no staging', async () => {
  const fs = fakeUploadFs();
  const cdp = uploadCdp();
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  assert.deepEqual(fs.calls.map((c) => c[0]), ['exists', 'stat']);
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params.files, ['/files/pic.png']);
});

// WHY THE CLOSED SHADOW ROOT IS PROVEN HERE. Google Docs keeps its file input
// where a page script cannot see it, so the script road reported no input while
// the input was demonstrably there. The pierced query is asked first and names
// the closed root by backend node id.

test('an input inside a closed shadow root is found and filled', async () => {
  const fs = fakeUploadFs();
  const cdp = piercedUploadCdp();
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  const query = cdp.calls.find((c) => c.method === 'DOM.querySelectorAll');
  assert.deepEqual(query.params, { nodeId: 1, selector: 'input[type=file]', pierce: true },
    'the tree is pierced and only the matches come back');
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/files/pic.png'], backendNodeId: 'b7' });
  assert.ok(!cdp.calls.some((c) => c.method === 'Runtime.evaluate'),
    'a pierced hit never falls through to the page script');
});

test('a frame the browser refuses to pierce is still found by the page script', async () => {
  const fs = fakeUploadFs();
  const cdp = piercedUploadCdp();
  const original = cdp.send;
  cdp.send = async (method, params = {}) => {
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'Runtime.evaluate') return { result: { objectId: 'o1' } };
    return original(method, params);
  };
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  const set = cdp.calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/files/pic.png'], objectId: 'o1' }, 'the second road still fills');
});

// WHY THE CHILD FRAME IS ITS OWN CASE. `pierce` answers for a document and
// stops at the frame boundary, and Google Docs keeps its image input in a
// picker frame: every road that looked at the top document reported nothing
// while the input was there. A frame is reached by its owner, the owner names
// its content document, and the same pierced query runs there.

test('an input inside a child frame is found through the frame owner', async () => {
  const fs = fakeUploadFs();
  const calls = [];
  const cdp = {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F1' }, childFrames: [{ frame: { id: 'F2' } }] } };
      if (method === 'DOM.getFrameOwner') return params.frameId === 'F2' ? { backendNodeId: 'owner-2' } : {};
      if (method === 'DOM.describeNode') {
        if (params.backendNodeId === 'owner-2') return { node: { contentDocument: { nodeId: 99 } } };
        return { node: { backendNodeId: 'b9' } };
      }
      if (method === 'DOM.querySelectorAll') {
        return params.nodeId === 99 ? { nodeIds: [7] } : { nodeIds: [] };
      }
      if (method === 'Runtime.evaluate') return { result: { subtype: 'null' } };
      return { result: {} };
    }
  };
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { inputFound: true, filename: 'pic.png', bytes: 42 });
  const query = calls.filter((c) => c.method === 'DOM.querySelectorAll').pop();
  assert.deepEqual(query.params, { nodeId: 99, selector: 'input[type=file]', pierce: true },
    'the frame document is asked with the same pierced query');
  const set = calls.find((c) => c.method === 'DOM.setFileInputFiles');
  assert.deepEqual(set.params, { files: ['/files/pic.png'], backendNodeId: 'b9' });
});

test('a page with no file input is reported, not filled', async () => {
  const fs = fakeUploadFs();
  const cdp = uploadCdp();
  cdp.send = async (method, params = {}) => {
    cdp.calls.push({ method, params });
    if (method === 'Runtime.evaluate') return { result: { subtype: 'null' } };
    return { result: {} };
  };
  const p = createPrimitives(cdp, { fs, os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.upload({ filename: 'pic.png', data: Buffer.from('bytes').toString('base64') });

  assert.deepEqual(out, { inputFound: false, filename: 'pic.png' });
  assert.ok(!cdp.calls.some((c) => c.method === 'DOM.setFileInputFiles'), 'nothing to fill, nothing sent');
  assert.ok(fs.calls.some((c) => c[0] === 'unlink'), 'the staging is still cleaned');
});

// WHY THE PIERCING IS PINNED AS TEXT. There is no DOM in a unit test, so the
// only thing checkable here is that the finder walks into shadow roots and
// same-origin frames instead of stopping at the top document. Fetching a whole
// pierced tree to do the same timed out live on a heavy page; the walk answers
// with one node back.

test('the input finder pierces shadow roots and same-origin frames', () => {
  assert.ok(UPLOAD_INPUT_EXPRESSION.includes('shadowRoot'), 'shadow trees are entered');
  assert.ok(UPLOAD_INPUT_EXPRESSION.includes('contentDocument'), 'same-origin frames are entered');
  assert.ok(UPLOAD_INPUT_EXPRESSION.includes("input[type=file]"), 'the quarry never changed');
});

test('intercepting the file chooser is one page call either way', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  assert.deepEqual(await p.interceptFileChooser(true), { intercepting: true });
  assert.deepEqual(await p.interceptFileChooser(false), { intercepting: false });
  assert.deepEqual(
    cdp.calls.filter((c) => c.method === 'Page.setInterceptFileChooserDialog').map((c) => c.params.enabled),
    [true, false]
  );
});

// WHY THE RETRY IS PINNED BY COUNT, NOT TIME. Clicking Upload creates the
// input on the page's own schedule; the first look routinely finds nothing a
// second after the click. Five looks with sleeps between them cost nothing
// when the input is already there.

test('a late input is caught by looking again', async () => {
  const slept = [];
  let calls = 0;
  const cdp = {
    send: async (method) => {
      if (method === 'Runtime.evaluate') {
        calls += 1;
        return calls < 3 ? { result: {} } : { result: { objectId: 'late' } };
      }
      return { result: {} };
    }
  };
  const p = createPrimitives(cdp, {
    sleep: async (ms) => { slept.push(ms); },
    fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath
  });

  const out = await p.upload({ filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out.inputFound, true);
  assert.deepEqual(slept, [400, 400],
    'a beat between looks, none after the hit, and one pass over every road each time');
});

// WHY THE DROP IS PINNED IN ORDER, WITH ITS RELEASE. The drop is the road into a
// page whose file chooser has no input behind it, and it only works while Chrome
// is intercepting drags; a tab left intercepting would stop believing a person
// dragging anything onto it, which is worse than the problem being solved. So
// the phases are sent in the order a drag happens and the release is asserted
// on the happy road and on the road where the page refuses the file.

test('a drop walks the drag phases in order and releases interception after', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp, { fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath });

  const out = await p.dropFile({ x: 750, y: 440, filename: 'pic.png', path: '/files/pic.png' });

  assert.deepEqual(out, { dropped: true, filename: 'pic.png', bytes: 42, x: 750, y: 440, mimeType: 'image/png' });
  assert.deepEqual(
    cdp.calls.map((c) => (c.method === 'Input.dispatchDragEvent' ? c.params.type : c.method)),
    ['Page.bringToFront', 'Input.setInterceptDrags', ...DROP_PHASES, 'Input.setInterceptDrags'],
    'front tab, interception on, the drag phases, interception off'
  );
  const last = cdp.calls.at(-1);
  assert.equal(last.params.enabled, false, 'and the tab is handed back its real pointer');
  const dropped = cdp.calls.find((c) => c.params.type === 'drop');
  assert.deepEqual(dropped.params.data.files, ['/files/pic.png']);
  assert.deepEqual(dropped.params.data.items, [{ mimeType: 'image/png', title: 'pic.png', data: '' }]);
});

test('a refused drop still hands the tab its pointer back', async () => {
  const cdp = recordingCdp();
  const original = cdp.send;
  cdp.send = async (method, params = {}) => {
    if (method === 'Input.dispatchDragEvent') throw new Error('the page said no');
    return original(method, params);
  };
  const p = createPrimitives(cdp, { fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath });

  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'pic.png', path: '/files/pic.png' }), /page said no/);
  assert.equal(cdp.calls.at(-1).method, 'Input.setInterceptDrags');
  assert.equal(cdp.calls.at(-1).params.enabled, false, 'a failure does not leave drags intercepted');
});

test('a drop refuses anything but one source and a place to drop it', async () => {
  const p = createPrimitives(recordingCdp(), { fs: fakeUploadFs(), os: fakeUploadOs, path: fakeUploadPath });

  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png' }), /exactly one/);
  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png', data: 'eA==', path: '/files/a.png' }), /exactly one/);
  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png', data: '' }), /no bytes/);
  await assert.rejects(() => p.dropFile({ x: 1, y: 2, filename: 'a.png', path: '/files/missing.png' }), /no such file/);
  await assert.rejects(() => p.dropFile({ filename: 'a.png', path: '/files/pic.png' }), /x and y/);
});

// WHY THE TYPE IS PINNED BY NAME. A drop tells the page what it is being
// offered, and a wrong type is a file the page refuses — the difference between
// an image landing and nothing happening at all.

test('a drop types the file by its name, and admits what it does not know', () => {
  assert.equal(dragMimeType('thesis-test.png'), 'image/png');
  assert.equal(dragMimeType('photo.JPEG'), 'image/jpeg', 'case is the caller spelling, not the page');
  assert.equal(dragMimeType('report.pdf'), 'application/pdf');
  assert.equal(dragMimeType('mystery.zzz'), 'application/octet-stream');
  assert.equal(dragMimeType('noextension'), 'application/octet-stream');
});

// WHY A HANDLE IS PROVEN BY WHAT IT HOLDS. The point of a handle is that the
// click lands on the element, not on the point it once occupied, so these tests
// read the row, read the node behind it, and read the box the browser reports
// for that node at the moment of the click.

function handleCdp(rows) {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        if (/^window\.__operaNodes\[\d+\]$/.test(params.expression)) return { result: { objectId: 'o-1' } };
        return { result: { value: rows } };
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 4321 } };
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [100, 200, 300, 200, 300, 260, 100, 260] } };
      }
      return { result: {} };
    }
  };
}

test('a row resolves to the node behind it and the handle is that node', async () => {
  const cdp = handleCdp([
    { role: 'menu', name: 'Upload from computer\nSearch the web', x: 630, y: 87, node: 0 },
    { role: 'menuitem', name: 'Upload from computer', x: 630, y: 175, node: 1 }
  ]);
  const p = createPrimitives(cdp);

  const row = await p.resolveRow({ role: 'menuitem', name: 'Upload from computer' });

  assert.equal(row.handle, 'opera-4321');
  const asked = cdp.calls.find((c) => c.method === 'Runtime.evaluate' && c.params.expression.startsWith('window.__operaNodes['));
  assert.match(asked.params.expression, /__operaNodes\[1\]/, 'the second row, not the container around it');
});

test('a row with no element behind it is returned without a handle', async () => {
  const cdp = handleCdp([{ role: 'caret', name: 'text caret', x: 4, y: 5 }]);
  const p = createPrimitives(cdp);

  const row = await p.resolveRow({ role: 'caret', name: 'text caret' });

  assert.deepEqual(row, { role: 'caret', name: 'text caret', x: 4, y: 5, handle: null });
});

test('a missing row names what is visible instead of guessing', async () => {
  const cdp = handleCdp([
    { role: 'menuitem', name: 'Insert', x: 1, y: 2, node: 0 },
    { role: 'menuitem', name: 'Image', x: 3, y: 4, node: 1 }
  ]);
  const p = createPrimitives(cdp);

  await assert.rejects(() => p.resolveRow({ role: 'menuitem', name: 'Footnote' }), (error) => {
    assert.match(error.message, /no menuitem matching "Footnote"/);
    assert.match(error.message, /Insert \| Image/);
    return true;
  });
});

// WHY THE BOX IS RE-MEASURED. The snapshot said where the row stood a moment
// ago; this is what the browser says about that node now. Clicking the older
// point is the bug that made a menu click land on the button underneath it.

test('a handle is measured from the node at the moment of the click', async () => {
  const cdp = handleCdp([{ role: 'menuitem', name: 'Image', x: 630, y: 175, node: 0 }]);
  const p = createPrimitives(cdp);

  const at = await p.clickHandle('opera-4321');

  assert.deepEqual(at, { x: 200, y: 230, handle: 'opera-4321' });
  const measured = cdp.calls.find((c) => c.method === 'DOM.getBoxModel');
  assert.deepEqual(measured.params, { backendNodeId: 4321 });
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 3, 'move, press and release still go out');
  assert.equal(cdp.calls.at(-1).method, 'Runtime.evaluate', 'and the click asks what it hit last');
  assert.match(cdp.calls.at(-1).params.expression, /opera-hit/);
});

test('a handle that is gone says so instead of clicking a stale point', async () => {
  const cdp = handleCdp([]);
  cdp.send = async (method, params = {}) => {
    cdp.calls.push({ method, params });
    if (method === 'Runtime.evaluate') return { result: { value: [{ role: 'menuitem', name: 'Gone', x: 1, y: 1, node: 0 }] } };
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 4321 } };
    return {};
  };
  const p = createPrimitives(cdp);

  await assert.rejects(() => p.clickHandle('opera-4321'), /no longer in the page/);
  assert.ok(!cdp.calls.some((c) => c.method === 'Input.dispatchMouseEvent'), 'nothing was clicked');
});

test('a handle that is not a handle is refused by name', async () => {
  const p = createPrimitives(handleCdp([]));

  await assert.rejects(() => p.clickHandle('not-a-handle'), /is not an element handle/);
});

// WHY THESE TWO WAITS ARE PINNED ON WHAT THEY OBSERVE. The row wait ends on the
// first read that matches, names what it saw, and gives up with found:false
// rather than hanging. The stillness wait ends on two identical reads in a row,
// which is the only signal that a page which was never named in advance has
// actually stopped moving — and it must be able to say it never went still.

function rowsCdp(reads) {
  const queue = [...reads];
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { result: { value: next } };
    }
  };
}

test('a row wait ends on the first read that has the row', async () => {
  const cdp = rowsCdp([[], [], [{ role: 'menuitem', name: 'Upload from computer', x: 5, y: 6, node: 0 }]]);
  const p = createPrimitives(cdp, { sleep: async () => {} });

  const out = await p.waitForRow({ role: 'menuitem', name: 'Upload from computer' });

  assert.equal(out.found, true);
  assert.equal(out.checks, 3, 'it stopped looking the moment the row was there');
  assert.equal(out.row.name, 'Upload from computer');
});

test('a row wait can wait for a row to go away', async () => {
  const cdp = rowsCdp([[{ role: 'menuitem', name: 'Upload', x: 1, y: 1, node: 0 }], []]);
  const p = createPrimitives(cdp, { sleep: async () => {} });

  const out = await p.waitForRow({ role: 'menuitem', name: 'Upload', absent: true });

  assert.equal(out.found, true, 'gone is what was asked for');
  assert.equal(out.row, null);
});

test('a row wait that runs out says so and hands back the page', async () => {
  const cdp = rowsCdp([[{ role: 'menuitem', name: 'Other', x: 1, y: 1, node: 0 }]]);
  const p = createPrimitives(cdp, { sleep: async () => {}, now: () => clock });

  let clock = 0;
  const result = await p.waitForRow({ role: 'menuitem', name: 'Upload', timeoutMs: 200, intervalMs: 100 });

  assert.equal(result.found, false);
  assert.equal(result.row, null);
  assert.ok(result.checks >= 2, 'it looked more than once before saying no');
});

test('stillness ends on two identical reads and names how long it took', async () => {
  const still = [{ role: 'menuitem', name: 'Image', x: 3, y: 4, node: 0 }];
  const cdp = rowsCdp([[{ role: 'menuitem', name: 'Image', x: 3, y: 4, node: 0 }], still, still]);
  const p = createPrimitives(cdp, { sleep: async () => {} });

  const out = await p.waitForStill({ quietMs: 0, intervalMs: 1, timeoutMs: 5000 });

  assert.equal(out.still, true);
  assert.ok(out.checks >= 2, 'one matching pair is what stillness means');
});

// WHY THE CLOCK MOVES INSTEAD OF THE SLEEP. The wait measures quiet time against
// the wall clock, so a one-millisecond budget is over before a second read can be
// reached and the wait would answer "still" having read once — the opposite of
// what a page that never stops moving deserves.

test('a page that never settles says so instead of pretending', async () => {
  let tick = 0;
  const cdp = {
    calls: [],
    send: async (method, params = {}) => {
      cdp.calls.push({ method, params });
      tick += 1;
      return { result: { value: [{ role: 'menuitem', name: 'Image', x: tick, y: 4, node: 0 }] } };
    }
  };
  let at = 1000;
  const p = createPrimitives(cdp, {
    sleep: async (ms) => { at += ms; }
  });

  const out = await p.waitForStill({ quietMs: 50, intervalMs: 10, timeoutMs: 100 });

  assert.equal(out.still, false);
  assert.ok(out.checks >= 5, `a page moving every read is not still (read ${out.checks} times)`);
});

test('stillness watches the rows an agent acts on, not the whole document', async () => {
  const cdp = rowsCdp([[{ role: 'menuitem', name: 'Image', x: 3, y: 4, node: 0 }]]);
  const p = createPrimitives(cdp, { sleep: async () => {} });

  await p.waitForStill({ quietMs: 0, intervalMs: 1, timeoutMs: 2000 });

  const asked = cdp.calls.find((c) => c.method === 'Runtime.evaluate');
  assert.match(asked.params.expression, /__LIMIT__|getBoundingClientRect/, 'the read is the snapshot the agent already uses');
});

// WHY A DOWNLOAD IS TESTED AGAINST A DISK AND NOT AN EVENT. The bridge road carries
// commands and not CDP events, so an implementation that waited for
// downloadProgress would pass on a debugging port and hang on the signed-in
// profile. These tests therefore give the primitive a fake filesystem and check
// what an observer would check: a file appeared, it stopped growing, the folder
// was armed before the click, and the browser-wide behavior was handed back.

function fakeDisk() {
  const files = new Map();
  return {
    files,
    mkdirSync() {},
    readdirSync(dir) {
      return [...files.keys()].filter((f) => path.dirname(f) === dir).map((f) => path.basename(f));
    },
    statSync(file) {
      const hit = files.get(file);
      if (!hit) throw new Error('ENOENT ' + file);
      return { size: hit.bytes, mtimeMs: hit.mtimeMs };
    },
    rmSync(file) { files.delete(file); },
    renameSync(from, to) {
      const hit = files.get(from);
      if (!hit) throw new Error('ENOENT ' + from);
      files.delete(from);
      files.set(to, hit);
    },
    put(file, bytes) { files.set(file, { bytes, mtimeMs: Date.now() }); }
  };
}

function downloadCdp(disk, { onRelease = null } = {}) {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased' && onRelease) onRelease();
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression);
        if (expression.includes('devicePixelRatio')) return { result: { value: { width: 1136, height: 770, dpr: 1 } } };
        if (expression.includes('opera-hit')) return { result: { value: { tag: 'A', role: 'link', name: 'download' } } };
        return { result: { value: { title: 'statements', url: 'https://bank.example/statements', text: '' } } };
      }
      return { result: {} };
    }
  };
}

test('a download is proven by the file on disk, and the folder is armed before the click', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-test');
  const cdp = downloadCdp(disk, {
    onRelease: () => disk.put(path.join(dir, 'statement-2026-09.pdf'), 1234)
  });
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  const out = await p.download({ x: 10, y: 10, dir, settleMs: 0 });

  assert.equal(out.downloaded, true);
  assert.equal(out.file, 'statement-2026-09.pdf');
  assert.equal(out.bytes, 1234);
  const armed = cdp.calls.findIndex((c) => c.method === 'Browser.setDownloadBehavior' && c.params.behavior === 'allow');
  const released = cdp.calls.findIndex((c) => c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mouseReleased');
  assert.ok(armed >= 0 && armed < released, 'the folder is armed before the click that fills it');
  const last = cdp.calls.filter((c) => c.method === 'Browser.setDownloadBehavior').at(-1);
  assert.equal(last.params.behavior, 'default', 'the browser-wide behavior is handed back, or later downloads vanish into it');
});

test('a click that downloads nothing says what it saw, and names the next move', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-test-empty');
  const cdp = downloadCdp(disk);
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  const out = await p.download({ x: 5, y: 5, dir, timeoutMs: 500, settleMs: 0 });

  assert.equal(out.downloaded, false);
  assert.match(out.why, /no file appeared/);
  assert.match(out.why, /dialog_state/);
  assert.ok(out.clicked, 'the answer still says where the click landed');
});

test('a file still being written is not a delivered file', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-test-partial');
  const cdp = downloadCdp(disk, {
    onRelease: () => disk.put(path.join(dir, 'statement.pdf.crdownload'), 50)
  });
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  const out = await p.download({ x: 5, y: 5, dir, timeoutMs: 500, settleMs: 0 });

  assert.equal(out.downloaded, false);
  assert.match(out.why, /still being written/);
  assert.equal(out.partial, 'statement.pdf.crdownload');
});

test('download refuses to guess what to click', async () => {
  const p = createPrimitives(downloadCdp(fakeDisk()), { sleep: async () => {} });
  await assert.rejects(() => p.download({}), /exactly one of/);
  await assert.rejects(() => p.download({ role: 'link' }), /also needs a name/);
  await assert.rejects(() => p.download({ handle: 'opera-1', x: 1, y: 2 }), /exactly one of/);
});

// WHY THE NAME IS GIVEN AFTER THE FILE LANDS. A portal decides what it calls its own
// statement ("statement.pdf", "download (3).pdf"), and a bookkeeper cannot bill a
// folder of those. Renaming mid-write would leave Chrome writing to a name that no
// longer exists, so the new name is applied at the only moment the file is whole.

test('a download can be named as it lands, and a path is refused before the click', async () => {
  const disk = fakeDisk();
  const dir = path.resolve('opera-download-named');
  const cdp = downloadCdp(disk, {
    onRelease: () => disk.put(path.join(dir, 'statement.pdf'), 99)
  });
  const p = createPrimitives(cdp, { fs: disk, sleep: async () => {} });

  await assert.rejects(
    () => p.download({ x: 1, y: 2, dir, saveAs: 'sub/klien.pdf' }),
    /file name, not a path/
  );

  const out = await p.download({ x: 1, y: 2, dir, saveAs: 'klien-bca-2026-09.pdf' });

  assert.equal(out.file, 'klien-bca-2026-09.pdf');
  assert.equal(out.path, path.join(dir, 'klien-bca-2026-09.pdf'));
  assert.equal(out.landedAs, 'statement.pdf', 'the answer says what the portal called it');
  assert.ok(disk.files.has(out.path), 'the file is on disk under the name the caller chose');
  assert.equal(disk.files.has(path.join(dir, 'statement.pdf')), false, 'the old name is gone, not duplicated');
});
