// @last-edited: 2026-10-23 UTC+7.
// @title: local-input — typing, chords and streams must behave the way a page that ignores synthetic events actually behaves.
// @state: the typing and key verbs, and the edit signature that proves the text landed on the page.
// @dependencies: node:test, strict, ../local/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_BEAT_MS,
  modifierMask,
  SETTLE_POLL_MS,
  splitText
} from '../local/page-expressions.js';
import { createPrimitives } from '../local/primitives.js';
import { createInputMethods } from '../local/input.js';
import { pipelinedCdp, recordingCdp } from './helpers/local-page.mjs';

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

// WHY PLACEMENT IS PROVED AND NOT TRUSTED.
// Measured live on a Google Doc: a batch reported landed:true from inside a table cell, and nothing in the answer said where.
// So type answers with the index and neighbours of what it inserted, and a click answers with the element under the point - and both say so when they cannot.

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

// WHY A SLOW MIRROR IS WAITED OUT.
// Measured live on a Google Doc: the second of two consecutive batches reported "nothing on the page changed" while its text sat in the document, and the retry duplicated it.
// The canvas mirrors into the DOM on Docs time with the outline lagging saves by seconds, so the check outlasts the lag instead of racing it.

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

test('append waits for the page to be quiet, not for a fixed beat', async () => {
  const slept = [];
  const cdp = recordingCdp();

  await createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } }).append('tail text');

  assert.ok(slept.includes(SETTLE_POLL_MS), 'the end key is followed by a settle');
  assert.ok(!slept.includes(120), 'and not by the old fixed 120 ms beat');
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

// WHY A SCROLL TOOL AND NOT A KEY.
// Measured live on a Google Doc with 21 pages: the only way to move the view was a key chord aimed at a guess, and an outline row the agent wanted to click answered with coordinates above the viewport - a click that reported success and hit nothing.
// Scroll is also the only road to an infinite feed and to anything that lazy-loads, so without it most of a web page does not exist.
// The answer carries the scroll it actually performed and where the view came to rest, because a scroll that moved the page and a scroll that moved the right thing look identical from the outside otherwise.

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

// WHY A MISSPELLED MODIFIER MAY NOT BECOME A PLAIN KEY.
// 'control' in lower case used to sum to zero, which turned Ctrl+1 into the keystroke "1" and looked like the page ignoring a shortcut.
// The name is either right or it is an error; there is no third answer that quietly presses something else.

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
  assert.deepEqual(slept, [KEY_BEAT_MS, KEY_BEAT_MS, 50],
    'each chord keeps its beat once, inside the key; then the asked gap');
  assert.deepEqual(
    cdp.calls.map((c) => c.method),
    ['Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Runtime.evaluate', 'Runtime.evaluate'],
    'the run is what was written, bracketed by the signature before and the focus-plus-signature after'
  );
  await assert.rejects(() => p.keys([]), /non-empty/);
  await assert.rejects(() => p.keys(new Array(101).fill({ key: 'a' })), /at most 100/);
  await assert.rejects(() => p.keys([{ key: 'a', gapMs: 5000 }]), /gap/);
  await assert.rejects(() => p.keys([{ key: 'a', text: 'b' }]), /not both/);
  await assert.rejects(() => p.keys([{}]), /needs text or a key/);
});

// WHY THIS CLAIM EXISTS.
// The snapshot used to read the accessibility tree and then ask for one box per element it liked, up to a hundred and twenty of them.
// The extension runs one command at a time on purpose, so those were sequential however the caller wrote them, and a snapshot on a Google Doc cost about two seconds before anything had decided anything.
// Chrome has no batch API for element boxes, so the work moved into the page.
// If this test ever needs more than one call again, that is the regression worth catching.

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

// WHY A TYPE THAT LANDS NOWHERE MUST NAME WHAT HAD FOCUS.
// Measured live on YouTube: a cookie wall sat over the page, the type inserted nothing, and the answer offered two guesses - no caret, or a minimized window.
// The page was already saying the third thing: focus sat on the wall's button.
// A name costs one evaluation and ends the guessing, so the failure carries it.

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

// WHY A CLICK ASKS WHO OWNS THE POINT.
// A cookie wall over a page turns a click_row into a success report for a click that reached nothing: measured live, the row answered with its own name and point while focus never left the wall's button.
// The point has one owner, and saying which is cheaper than the guess that follows.

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
      'Runtime.evaluate:',
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

test('type chunks fire together', async () => {
  const cdp = pipelinedCdp();

  await createPrimitives(cdp, { chunkSize: 10 }).type('x'.repeat(35));

  assert.equal(cdp.stats().max, 4);
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

// WHY THESE CLAIMS EXIST.
// Google Docs draws the document on a canvas, so the page text a read used to return held the toolbar chrome and none of the content.
// The document is read through its own copy path instead: select all, dispatch a copy event at the hidden text iframe, and take what Docs itself populated.
// Proven on a live document at thirteen milliseconds for a full read; these hold the wiring so the proof stays true.

test('a key holds its down edge a beat before the up', async () => {
  for (const modifiers of [['Control'], []]) {
    const slept = [];
    const cdp = recordingCdp();
    await createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } }).key('a', modifiers);

    assert.deepEqual(slept, [KEY_BEAT_MS], 'down, beat, up — chord and bare key alike');
  }
});

test('chords in a stream keep one beat, not two', async () => {
  const slept = [];
  const cdp = recordingCdp();
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  await p.keys([{ key: 'a', modifiers: ['Control'] }, { text: 'hi' }, { key: 'b', modifiers: ['Control'] }]);

  assert.deepEqual(slept, [KEY_BEAT_MS, KEY_BEAT_MS], 'the beat lives inside key(); the stream adds no second beat');
});

test('a chord-only stream settles once instead of polling for an edit that never comes', async () => {
  const slept = [];
  const cdp = recordingCdp();
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  const out = await p.keys([{ key: 'a', modifiers: ['Control'] }, { key: 'b', modifiers: ['Control'] }]);

  assert.equal(out.moved, false, 'a menu chord does not move the text signature');
  assert.equal(out.settled, true, 'and it says it already settled, so the page look does not pay twice');
  assert.deepEqual(slept, [KEY_BEAT_MS, KEY_BEAT_MS, SETTLE_POLL_MS], 'two key beats, then one settle — not twelve 150 ms polls');
});

test('a text stream with nothing focused fails fast instead of polling for text that cannot land', async () => {
  const slept = [];
  const cdp = {
    calls: [],
    send: async (method, params = {}) => {
      cdp.calls.push({ method, params });
      if (method === 'Runtime.evaluate' && String(params.expression).includes('shadowRoot')) {
        return { result: { value: { trail: 'button', tag: 'BUTTON', editable: false } } };
      }
      if (method === 'Runtime.evaluate' && String(params.expression).includes('document.body')) {
        return { result: { value: { body: '9:body text', value: '', holds: true } } };
      }
      return {};
    }
  };
  const p = createPrimitives(cdp, { sleep: async (ms) => { slept.push(ms); } });

  const out = await p.keys([{ text: 'abc' }]);

  assert.equal(out.moved, false, 'text sent to a button moves no signature');
  assert.deepEqual(slept, [], 'no edit poll runs when nothing can receive the text');
});

test('createInputMethods exposes the typing and key verbs', () => {
  const methods = createInputMethods({
    cdp: { send: async () => ({}) },
    primitives: { key: async () => ({}), settle: async () => ({}), type: async () => ({}) },
    sleep: async () => {},
    chunkSize: 2000
  });

  assert.deepEqual(Object.keys(methods).sort(), ['append', 'clear', 'key', 'keys', 'selectAll', 'type']);
});

test('all four arrows dispatch with their virtual key codes', async () => {
  for (const [name, vk, code] of [['ArrowLeft', 37, 'ArrowLeft'], ['ArrowRight', 39, 'ArrowRight'], ['ArrowUp', 38, 'ArrowUp'], ['ArrowDown', 40, 'ArrowDown']]) {
    const cdp = recordingCdp();
    await createPrimitives(cdp).key(name);

    const down = cdp.calls.find((c) => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'rawKeyDown');
    assert.equal(down.params.windowsVirtualKeyCode, vk, name);
    assert.equal(down.params.code, code, name);
  }
});

// WHY READING A LINE SELECTS IT FIRST.
// The mirror a copy reads from only holds what a selection put there: measured live as an empty line beside a perfectly visible caret.
// So the read selects its own line, copies, and collapses back to the line end.
// Steps breathe because injected keys land late; without the beats the copy runs before the selection exists.

