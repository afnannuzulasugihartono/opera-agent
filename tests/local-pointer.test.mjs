// @last-edited: 2026-10-23 UTC+7.
// @title: local-pointer — a click is a coordinate sent into a page that may have moved, and the answer says what was under it.
// @state: clicks, hovers, the mark a person watching can see, and the handles measured at the moment of the press.
// @dependencies: node:test, strict, ../local/primitives.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrimitives } from '../local/primitives.js';
import { createPointerMethods } from '../local/pointer.js';
import {
  pipelinedCdp,
  recordingCdp
} from './helpers/local-page.mjs';

test('a click answers with the element under the point', async () => {
  const cdp = recordingCdp();

  const out = await createPrimitives(cdp).clickAt(384, 46);

  assert.deepEqual(out.hit, {
    tag: 'BUTTON',
    role: 'button',
    name: 'Bold',
    canvas: false
  });
});


test('a click on canvas says canvas, because elementFromPoint cannot see through it', async () => {
  const cdp = {
    send: async (
      method,
      params = {}
    ) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('opera-hit')) {
        return { result: { value: {
          tag: 'CANVAS',
          role: '',
          name: ''
        } } };
      }
      return {};
    }
  };

  const out = await createPrimitives(cdp).clickAt(500, 600);

  assert.equal(out.hit.canvas, true);
  assert.equal(out.hit.tag, 'CANVAS');
});

// WHY THE CHORD IS ORDERED, NOT MERGED.
// Two sends racing in a Promise.all do not keep their order on the wire, because every send proves the link alive first and that proof is its own await.
// Chrome was handed a keyUp before its keyDown, so Ctrl+1 typed a literal "1" into a live Google Doc instead of making a heading.
// The order is the shortcut.

// WHY AN APPEND ANSWERS WHERE IT PUT THE TEXT.
// Measured live while building a thesis: the road to the end of a document was click, Ctrl+End, and trust - and once the caret did not go where it was told, a whole batch landed inside a table cell and four extra calls plus an undo were spent recovering.
// So the append carries the positioning, and its answer measures "at the end" instead of assuming it.


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


test('a click_row says when something else owns the point it clicked', async () => {
  const cdp = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      cdp.calls.push({
        method,
        params
      });
      if (method === 'DOM.getBoxModel') return { model: { content: [
        100,
        200,
        300,
        200,
        300,
        260,
        100,
        260
      ] } };
      if (method === 'DOM.resolveNode') return { object: { objectId: 'o-9' } };
      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: {
          covered: true,
          coveredBy: 'div[button]',
          coveredText: 'Reject the use of cookies and other data'
        } } };
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
    send: async (
      method,
      params = {}
    ) => {
      owned.calls.push({
        method,
        params
      });
      if (method === 'DOM.getBoxModel') return { model: { content: [
        100,
        200,
        300,
        200,
        300,
        260,
        100,
        260
      ] } };
      if (method === 'DOM.resolveNode') return { object: { objectId: 'o-9' } };
      if (method === 'Runtime.callFunctionOn') return { result: { value: { covered: false } } };
      return { result: {} };
    }
  };
  assert.equal((await createPrimitives(owned).clickHandle('opera-4321')).covered, false);

  const silent = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      silent.calls.push({
        method,
        params
      });
      if (method === 'DOM.getBoxModel') return { model: { content: [
        100,
        200,
        300,
        200,
        300,
        260,
        100,
        260
      ] } };
      return { result: {} };
    }
  };
  const out = await createPrimitives(silent).clickHandle('opera-4321');
  assert.equal('covered' in out, false, 'a page that cannot answer is not given an invented verdict');
});


test('a click fires move, press and release together', async () => {
  const cdp = pipelinedCdp();

  await createPrimitives(cdp).clickAt(10, 20);

  assert.equal(cdp.stats().max, 4, 'spotlight and three mouse events overlap');
});

// WHY A SNAPSHOT MUST NOT SEND A STALE SHAPE BACK.
// The page expression returns the list itself, so anything that is not a list means the page answered with something else — an exception object, a string from a transpiler shim.
// An empty list is the honest answer: an agent that gets [] will look again, and an agent that gets null will read it as a page with nothing on it.


test('a click is a real press and release at the browser level, not an element click', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).clickAt(384, 46);

  const events = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.deepEqual(events.map((e) => e.params.type), [
    'mouseMoved',
    'mousePressed',
    'mouseReleased'
  ]);
  assert.equal(events[1].params.x, 384);
  assert.equal(events[2].params.y, 46);
});


test('a hover moves the pointer and stops, because a submenu opens on hover and a click closes the menu', async () => {
  const cdp = recordingCdp();
  await createPrimitives(cdp).hover(193, 113);

  const calls = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.equal(calls.length, 1, 'a hover must not press anything');
  assert.equal(calls[0].params.type, 'mouseMoved');
  assert.equal(calls[0].params.buttons, 0);
});


// WHY THE MARK IS CHECKED BY ITS AXES AND NOT BY TWO NUMBERS ON A LINE.
// The claim is that the ring is centred on the point: 13px is half the 26px ring, so left and top are the point minus 13.
// This used to be asserted as /87px.*87px/, which required both coordinates on one source line - a fact about how the expression was formatted rather than about where the mark landed.
// Reading each axis by name states the claim, and it survives the expression being written across lines for a person to read.

test('every pointer action marks its spot for the watcher, red for click and blue for hover', async () => {
  const cdp = recordingCdp();
  const p = createPrimitives(cdp);

  await p.hover(100, 100);
  await p.clickAt(200, 220);

  const marks = cdp.calls.filter((c) => c.method === 'Runtime.evaluate' && c.params.expression.includes('opera-spot'));
  assert.equal(marks.length, 2);
  assert.match(marks[0].params.expression, /66,133,244/);
  assert.match(marks[1].params.expression, /255,60,60/);

  const at = (
    expression,
    axis
  ) => {
    const found = new RegExp(`el\\.style\\.${axis} = '(\\d+)px'`).exec(expression);
    return found ? Number(found[1]) : null;
  };
  assert.equal(at(marks[0].params.expression, 'left'), 87, 'the ring is centred on the hovered point');
  assert.equal(at(marks[0].params.expression, 'top'), 87);
  assert.equal(at(marks[1].params.expression, 'left'), 187, 'and on the clicked point');
  assert.equal(at(marks[1].params.expression, 'top'), 207);

  assert.match(marks[1].params.expression, /el\.remove\(\)/, 'and the mark takes itself off the page, because a mark that stays is a ring over the next picture');
});


test('a refused spotlight never breaks the click it decorates', async () => {
  const cdp = {
    calls: [],
    send: async (
      method,
      params = {}
    ) => {
      cdp.calls.push({
        method,
        params
      });
      if (method === 'Runtime.evaluate') throw new Error('script not allowed here');
      return { result: {} };
    }
  };

  const out = await createPrimitives(cdp).clickAt(10, 20);

  assert.deepEqual(out, {
    x: 10,
    y: 20,
    hit: null
  });
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 3);
});

// WHY THIS USED TO BE THE OTHER WAY ROUND.
// This test once asserted that a hover must NOT wait for the page's reply, and it proved that with a promise that never settles.
// That was measured as a hover that returned in one millisecond while its move sat in the worker's queue for five, and the next command's liveness proof then queued behind it and failed — so one lie became two failures.
// A page that never answers is now visible from this call.


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


test('createPointerMethods exposes the clicks, the hovers and the handles', () => {
  const methods = createPointerMethods({
    cdp: { send: async () => ({}) },
    primitives: {
      viewport: async () => ({
        width: 1,
        height: 1
      }),
      settle: async () => ({}),
      handleBox: async () => ({})
    }
  });

  assert.deepEqual(Object.keys(methods).sort(),
    [
      'clickAt',
      'clickFraction',
      'clickHandle',
      'handleBox',
      'hover',
      'hoverRow',
      'resolveHandle'
    ]);
});

// WHY ALL FOUR ARROWS ARE PINNED.
// The table grid in Google Docs expands right and down; with only Up and Down known, a drive that needed Right died on an "Unknown key" in the middle of a live thesis.
// Directions come in fours.


function handleCdp(rows) {
  const calls = [];
  return {
    calls,
    send: async (
      method,
      params = {}
    ) => {
      calls.push({
        method,
        params
      });
      if (method === 'Runtime.evaluate') {
        if (/^window\.__operaNodes\[\d+\]$/.test(params.expression)) return { result: { objectId: 'o-1' } };
        return { result: { value: rows } };
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 4321 } };
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [
          100,
          200,
          300,
          200,
          300,
          260,
          100,
          260
        ] } };
      }
      return { result: {} };
    }
  };
}


test('a row resolves to the node behind it and the handle is that node', async () => {
  const cdp = handleCdp([
    {
      role: 'menu',
      name: 'Upload from computer\nSearch the web',
      x: 630,
      y: 87,
      node: 0
    },
    {
      role: 'menuitem',
      name: 'Upload from computer',
      x: 630,
      y: 175,
      node: 1
    }
  ]);
  const p = createPrimitives(cdp);

  const row = await p.resolveRow({
    role: 'menuitem',
    name: 'Upload from computer'
  });

  assert.equal(row.handle, 'opera-4321');
  const asked = cdp.calls.find((c) => c.method === 'Runtime.evaluate' && c.params.expression.startsWith('window.__operaNodes['));
  assert.match(asked.params.expression, /__operaNodes\[1\]/, 'the second row, not the container around it');
});


test('a row with no element behind it is returned without a handle', async () => {
  const cdp = handleCdp([{
    role: 'caret',
    name: 'text caret',
    x: 4,
    y: 5
  }]);
  const p = createPrimitives(cdp);

  const row = await p.resolveRow({
    role: 'caret',
    name: 'text caret'
  });

  assert.deepEqual(row, {
    role: 'caret',
    name: 'text caret',
    x: 4,
    y: 5,
    handle: null
  });
});


test('a missing row names what is visible instead of guessing', async () => {
  const cdp = handleCdp([
    {
      role: 'menuitem',
      name: 'Insert',
      x: 1,
      y: 2,
      node: 0
    },
    {
      role: 'menuitem',
      name: 'Image',
      x: 3,
      y: 4,
      node: 1
    }
  ]);
  const p = createPrimitives(cdp);

  await assert.rejects(() => p.resolveRow({
    role: 'menuitem',
    name: 'Footnote'
  }), (error) => {
    assert.match(error.message, /no menuitem matching "Footnote"/);
    assert.match(error.message, /Insert \| Image/);
    return true;
  });
});

// WHY THE BOX IS RE-MEASURED.
// The snapshot said where the row stood a moment ago; this is what the browser says about that node now.
// Clicking the older point is the bug that made a menu click land on the button underneath it.


test('a handle is measured from the node at the moment of the click', async () => {
  const cdp = handleCdp([{
    role: 'menuitem',
    name: 'Image',
    x: 630,
    y: 175,
    node: 0
  }]);
  const p = createPrimitives(cdp);

  const at = await p.clickHandle('opera-4321');

  assert.deepEqual(at, {
    x: 200,
    y: 230,
    handle: 'opera-4321'
  });
  const measured = cdp.calls.find((c) => c.method === 'DOM.getBoxModel');
  assert.deepEqual(measured.params, { backendNodeId: 4321 });
  assert.equal(cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 3, 'move, press and release still go out');
  assert.equal(cdp.calls.at(-1).method, 'Runtime.evaluate', 'and the click asks what it hit last');
  assert.match(cdp.calls.at(-1).params.expression, /opera-hit/);
});


test('a handle that is gone says so instead of clicking a stale point', async () => {
  const cdp = handleCdp([]);
  cdp.send = async (
    method,
    params = {}
  ) => {
    cdp.calls.push({
      method,
      params
    });
    if (method === 'Runtime.evaluate') return { result: { value: [{
      role: 'menuitem',
      name: 'Gone',
      x: 1,
      y: 1,
      node: 0
    }] } };
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

// WHY THESE TWO WAITS ARE PINNED ON WHAT THEY OBSERVE.
// The row wait ends on the first read that matches, names what it saw, and gives up with found:false rather than hanging.
// The stillness wait ends on two identical reads in a row, which is the only signal that a page which was never named in advance has actually stopped moving — and it must be able to say it never went still.

