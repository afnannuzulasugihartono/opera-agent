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
import {
  DOCS_COPY_EXPRESSION,
  DROP_PHASES,
  UPLOAD_INPUT_EXPRESSION,
  createPrimitives,
  dragMimeType,
  isDocsDocument,
  modifierMask,
  snapshotExpression,
  splitText
} from '../local/primitives.js';

function recordingCdp() {
  const calls = [];
  return {
    calls,
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') {
        if (params.expression.includes('readyState')) return { result: { value: 'complete' } };
        if (params.expression.includes('devicePixelRatio')) {
          return { result: { value: { width: 1136, height: 770, dpr: 1.25 } } };
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

// WHY THE CHORD IS ORDERED, NOT MERGED. Two sends racing in a Promise.all do
// not keep their order on the wire, because every send proves the link alive
// first and that proof is its own await. Chrome was handed a keyUp before its
// keyDown, so Ctrl+1 typed a literal "1" into a live Google Doc instead of
// making a heading. The order is the shortcut.

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
    ['Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']
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
      'Input.dispatchKeyEvent:rawKeyDown',
      'Input.dispatchKeyEvent:keyUp',
      'Input.insertText:',
      'Input.dispatchKeyEvent:keyDown',
      'Input.dispatchKeyEvent:keyUp'
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
  return {
    calls,
    stats: () => ({ max }),
    send: async (method, params = {}) => {
      calls.push({ method, params });
      inflight += 1;
      max = Math.max(max, inflight);
      await Promise.resolve();
      await Promise.resolve();
      inflight -= 1;
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

  assert.deepEqual(out, { x: 10, y: 20 });
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

function docsCdp(copyAnswers) {
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

test('a read on an ordinary page costs one call and keeps its shape', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).read();

  assert.deepEqual(out, { title: 't', url: 'u', text: 'body text' });
  assert.deepEqual(cdp.calls.map((c) => c.method), ['Runtime.evaluate']);
});

test('a read on a Google Doc borrows the selection and returns the document', async () => {
  const slept = [];
  const cdp = docsCdp([{ result: { value: 'First line\nSecond line' } }]);
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  const out = await p.read();

  assert.deepEqual(out, {
    title: 'Doc',
    url: DOC_URL,
    text: 'First line\nSecond line'
  });
  assert.deepEqual(
    cdp.calls.map((c) => c.method),
    ['Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent',
      'Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']
  );
  const keys = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(keys.map((k) => k.params.modifiers), [2, 2, 0, 0],
    'the select-all carries Control on both edges and the collapse carries none');
  assert.deepEqual(slept, [50, 150, 50],
    'each borrowed key keeps its beat, and the selection settles before the copy forces it out');
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

  const line = await p.caretLine();

  assert.equal(line, 'Kajian pustaka mencakup');
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

  const line = await createPrimitives(cdp).caretLine();

  assert.equal(line, 'plain line');
  assert.ok(!calls.some((c) => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('texteventtarget')),
    'no mirror on a plain page');
});

test('an unreadable line is empty, and the caret still collapses', async () => {
  const cdp = docsCdp([{ result: { value: null } }]);

  const line = await createPrimitives(cdp).caretLine();

  assert.equal(line, '');
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
  assert.deepEqual(cdp.calls.at(-1).method, 'Input.dispatchMouseEvent');
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
