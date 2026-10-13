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
import { createPrimitives, modifierMask, splitText } from '../local/primitives.js';

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

test('a chord is two masked events with codes and no text, because separate modifier presses leaked under rapid fire', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  const out = await p.key('a', ['Control']);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.equal(events.length, 2, 'key down, key up, nothing else');
  assert.equal(events[0].params.type, 'keyDown');
  assert.equal(events[0].params.key, 'a');
  assert.equal(events[0].params.modifiers, 2);
  assert.equal(events[0].params.text, undefined);
  assert.equal(events[0].params.windowsVirtualKeyCode, 65);
  assert.equal(events[0].params.nativeVirtualKeyCode, 65);
  assert.equal(events[1].params.type, 'keyUp');
  assert.equal(events[1].params.modifiers, 2);
  assert.deepEqual(out, { key: 'a', modifiers: 2 });
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
  assert.deepEqual(slept, [50]);
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

test('a snapshot maps clickable nodes to centers with names an agent can read', async () => {
  const cdp = {
    calls: [],
    send: async (method, params = {}) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            { nodeId: '1', role: { value: 'menuitem' }, name: { value: 'Table t ►' }, backendDOMNodeId: 7 },
            { nodeId: '2', role: { value: 'StaticText' }, name: { value: 'Table' }, backendDOMNodeId: 8 },
            { nodeId: '3', role: { value: 'button' }, name: { value: 'Share' } },
            { nodeId: '4', role: { value: 'textbox' }, name: { value: 'Formula' }, value: { value: '=SUM(A1)' }, backendDOMNodeId: 9 }
          ]
        };
      }
      if (method === 'DOM.getBoxModel') {
        assert.deepEqual(Object.keys(params), ['backendNodeId'], 'the AX property is backendDOMNodeId but the CDP param is backendNodeId, and Chrome rejects anything else');
        assert.ok([7, 9].includes(params.backendNodeId), 'only clickable boxed nodes are resolved');
        return { model: { content: [100, 200, 300, 200, 300, 240, 100, 240] } };
      }
      return {};
    }
  };

  const snap = await createPrimitives(cdp).snapshot();

  assert.deepEqual(snap, [
    { role: 'menuitem', name: 'Table t ►', x: 200, y: 220 },
    { role: 'textbox', name: 'Formula', x: 200, y: 220, value: '=SUM(A1)' }
  ]);
});

test('a snapshot honors its limit, because a tree can hold thousands of nodes', async () => {
  const cdp = {
    send: async (method) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: Array.from({ length: 5 }, (_, i) => ({
            nodeId: String(i), role: { value: 'button' }, name: { value: `b${i}` }, backendDOMNodeId: i
          }))
        };
      }
      if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
      return {};
    }
  };

  const snap = await createPrimitives(cdp).snapshot({ limit: 2 });

  assert.equal(snap.length, 2);
});

test('a snapshot clamps its limit, so a wild request cannot ask for ten thousand boxes', async () => {
  const boxes = [];
  const cdp = {
    send: async (method, params = {}) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: Array.from({ length: 5 }, (_, i) => ({
            nodeId: String(i), role: { value: 'button' }, name: { value: `b${i}` }, backendDOMNodeId: i
          }))
        };
      }
      if (method === 'DOM.getBoxModel') {
        boxes.push(params.backendNodeId);
        return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
      }
      return {};
    }
  };

  await createPrimitives(cdp).snapshot({ limit: 99999 });
  assert.equal(boxes.length, 5, 'five nodes resolve even when the cap is huge');
  await createPrimitives(cdp).snapshot({ limit: 1 });
  assert.equal(boxes.length, 6, 'and a limit of one resolves exactly one more');
});

test('a gapless run fires together, so ten keys cost one round trip', async () => {
  const cdp = pipelinedCdp();
  const p = createPrimitives(cdp);

  const out = await p.keys([{ text: 'a' }, { text: 'b' }, { key: 'Enter' }]);

  assert.equal(out.events, 3);
  assert.equal(out.chars, 2);
  assert.equal(out.chords, 1);
  assert.equal(cdp.stats().max, 4, 'two inserts and a down/up pair overlap');
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

test('a snapshot resolves its boxes together', async () => {
  const cdp = pipelinedCdp((method) => {
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: Array.from({ length: 3 }, (_, i) => ({
          nodeId: String(i), role: { value: 'button' }, name: { value: `b${i}` }, backendDOMNodeId: i
        }))
      };
    }
    if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
    return {};
  });

  const snap = await createPrimitives(cdp).snapshot();

  assert.equal(snap.length, 3);
  assert.equal(cdp.stats().max, 3);
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

  const downs = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
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

  const downs = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown');
  assert.equal(downs.length, 1);
  assert.equal(downs[0].params.key, 'a');
  assert.equal(downs[0].params.text, undefined);
});

test('every keyUp carries the same mask as its keyDown, so the chord reads whole on both edges', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).key('2', ['Control', 'Alt']);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(events.map((e) => e.params.type), ['keyDown', 'keyUp']);
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

test('a hover dispatches its move without awaiting the page-timed reply', async () => {
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

  const t0 = Date.now();
  const out = await createPrimitives(cdp).hover(10, 20);
  const ms = Date.now() - t0;

  assert.deepEqual(out, { x: 10, y: 20 });
  assert.equal(moves, 1, 'the move is sent exactly once');
  assert.ok(ms < 1000, `hover waited ${ms} ms for a reply it must not wait for`);
});

test('a capture is clipped to the clickable viewport at one to one, or every visual click misses', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).capture();

  const shot = cdp.calls.find((c) => c.method === 'Page.captureScreenshot');
  assert.deepEqual(shot.params.clip, { x: 0, y: 0, width: 1136, height: 770, scale: 1 },
    'a pixel in the picture must be a coordinate clickAt accepts');
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