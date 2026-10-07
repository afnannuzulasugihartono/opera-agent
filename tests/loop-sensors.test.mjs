// @last-edited: 2026-10-07 UTC+7.
// @title: loop-sensors.test — Test.
// @state: locks pixel sensor math on synthetic buffers: hash, diff, template match.
// @dependencies: node:test, strict, loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { downscaleHash, pixelDiff, matchTemplate } from '../extension/lib/loop.js';

function solidRgba(width, height, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

test('identical frames hash equal, different frames differ', () => {
  const a = solidRgba(16, 16, 10, 20, 30);
  const b = solidRgba(16, 16, 10, 20, 30);
  const c = solidRgba(16, 16, 200, 20, 30);
  assert.equal(downscaleHash(a, 16, 16), downscaleHash(b, 16, 16));
  assert.notEqual(downscaleHash(a, 16, 16), downscaleHash(c, 16, 16));
});

test('hash ignores size: same picture at two resolutions matches', () => {
  const small = solidRgba(8, 8, 10, 20, 30);
  const big = solidRgba(64, 64, 10, 20, 30);
  assert.equal(downscaleHash(small, 8, 8), downscaleHash(big, 64, 64));
});

test('pixel diff is the fraction of changed pixels', () => {
  const a = solidRgba(4, 4, 0, 0, 0);
  const b = solidRgba(4, 4, 0, 0, 0);
  assert.equal(pixelDiff(a, b), 0);

  // One of sixteen pixels flips to white: 1/16 = 0.0625.
  b[0] = 255;
  b[1] = 255;
  b[2] = 255;
  assert.equal(pixelDiff(a, b), 0.0625);
  assert.equal(pixelDiff(a, b, 300), 0);
  assert.equal(pixelDiff(a, solidRgba(2, 2, 0, 0, 0)), null);
});

test('template match finds the sprite position with a score', () => {
  const region = solidRgba(8, 8, 0, 0, 0);

  // Paint a 2x2 white sprite at (5, 3).
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const i = ((3 + dy) * 8 + (5 + dx)) * 4;
    region[i] = 255;
    region[i + 1] = 255;
    region[i + 2] = 255;
  }
  const found = matchTemplate(region, 8, 8, solidRgba(2, 2, 255, 255, 255), 2, 2);
  assert.equal(found.x, 5);
  assert.equal(found.y, 3);
  assert.ok(found.score > 0.99);
});

test('template match scores absence near zero', () => {
  const region = solidRgba(8, 8, 0, 0, 0);
  const found = matchTemplate(region, 8, 8, solidRgba(2, 2, 255, 255, 255), 2, 2);
  assert.ok(found.score < 0.05);
});

test('template larger than the region fails closed', () => {
  const region = solidRgba(2, 2, 0, 0, 0);
  assert.equal(matchTemplate(region, 2, 2, solidRgba(4, 4, 255, 255, 255), 4, 4), null);
  assert.equal(matchTemplate(null, 0, 0, null, 0, 0), null);
});
