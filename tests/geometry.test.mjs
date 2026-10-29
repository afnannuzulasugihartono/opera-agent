// @last-edited: 2026-10-15 UTC+7.
// @title: geometry — a point that means the same place after the window changes.
// @state: the capture's own size, the fraction resolved at click time, the answer that says which.
// @dependencies: node:test, assert, ../local/primitives.js.

// WHY THESE CLAIMS EXIST.
// Measured live on this product's own author, by resizing this machine's browser window: the viewport went 1144x714 to 1186x670, the capture went 1430x963 to 1483x838, and the device scale stayed at 1.25.
// So the picture is the viewport times that scale, and both move under the agent's feet - a window resized, a window dragged to a monitor with another scale.
// The cost is not the division, it is the guessing: an agent that divides pixels by eye clicks the wrong thing while every answer says the click was delivered.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPrimitives } from '../local/primitives.js';

const VIEWPORT = {
  width: 1186,
  height: 670,
  dpr: 1.25
};

const sizedCdp = (viewport = VIEWPORT) => {
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
        if (String(params.expression).includes('devicePixelRatio')) return { result: { value: viewport } };
      }
      if (method === 'Page.captureScreenshot') return { data: 'AAAA' };
      if (method === 'Page.getLayoutMetrics') return { contentSize: {
        width: 1440,
        height: 4000
      } };
      return { result: {} };
    }
  };
};

// WHY THE SIZE COMES FROM THE PICTURE AND NOT FROM THE VIEWPORT.
// A capture that was scaled to fit a limit, or a device whose scale the caller does not know, makes a size worked out from the viewport wrong - and wrong in the one case where the number is needed to turn a pixel into a click.

test('a sized capture reports the viewport, the scale and the picture it took', async () => {
  const shot = await createPrimitives(sizedCdp()).captureSized();

  assert.deepEqual(shot.viewport, {
    width: 1186,
    height: 670
  });
  assert.equal(shot.dpr, 1.25);
  assert.match(shot.note, /css pixels times 1.25/);
  assert.ok(shot.data, 'the picture itself is still there for a model to look at');
});

// WHY A FRACTION IS RESOLVED AT CLICK TIME AND NOT AT CAPTURE TIME.
// This is the whole point: the window resized between the look and the click, and the aim is still the aim.

test('a fraction is resolved against the viewport as it is at the click', async () => {
  const before = createPrimitives(sizedCdp({
    width: 1144,
    height: 714,
    dpr: 1.25
  }));
  const after = createPrimitives(sizedCdp({
    width: 1186,
    height: 670,
    dpr: 1.25
  }));

  const first = await before.clickFraction({
    x: 0.5,
    y: 0.5
  });
  const second = await after.clickFraction({
    x: 0.5,
    y: 0.5
  });

  assert.deepEqual([
    first.x,
    first.y
  ], [
    572,
    357
  ]);
  assert.deepEqual([
    second.x,
    second.y
  ], [
    593,
    335
  ]);
  assert.deepEqual(second.viewport, {
    width: 1186,
    height: 670
  }, 'and the answer names the space it landed in');
});

test('a fraction outside the page is clamped to the page, not sent off it', async () => {
  const p = createPrimitives(sizedCdp());

  const out = await p.clickFraction({
    x: 1.4,
    y: -0.2
  });

  assert.deepEqual([
    out.x,
    out.y
  ], [
    1186,
    0
  ]);
});

// WHY A HANDLE STILL WINS.
// A fraction aims at a place in a space; a handle names the thing, and the box is measured from the node at the moment of the click.
// Nothing an agent does to the window can make the handle mean somewhere else.

test('a click that carries no fraction is unchanged', async () => {
  const cdp = sizedCdp();
  const p = createPrimitives(cdp);

  const out = await p.clickAt(120, 240);

  assert.deepEqual(out, {
    x: 120,
    y: 240,
    hit: null
  });
  const moved = cdp.calls.filter((c) => c.params?.type === 'mouseMoved').at(-1);
  assert.deepEqual([
    moved.params.x,
    moved.params.y
  ], [
    120,
    240
  ]);
});
