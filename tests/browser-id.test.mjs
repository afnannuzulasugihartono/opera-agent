// @last-edited: 2026-11-01 UTC+7.
// @title: browser-id — which browser this page is running in, asked of the page itself.
// @state: the user agent expression, and the name and version that user agent carries.
// @dependencies: node:test, strict, ../local/browser-id.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_EXPRESSION,
  browserId
} from '../local/browser-id.js';

// WHY THE PAGE IS ASKED.
// The extension may be talking to any browser on any machine, and every window the operating system holds belongs to one of them.
// The page knows which browser it runs in, so the driver asks the page rather than guessing from the machine or from the tab list.

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test('the browser is named from what the page says about itself', () => {
  assert.equal(browserId(CHROME).name, 'Google Chrome');
  assert.equal(browserId(CHROME).version, '131.0.0.0');
});

test('a browser that says its own name is named by that name, not by the engine it rides on', () => {
  const brave = `${CHROME} Brave/1.62.0`;
  const edge = `${CHROME} Edg/131.0.2903.86`;
  const opera = `${CHROME} OPR/115.0.0.0`;
  const vivaldi = `${CHROME} Vivaldi/6.5.3206.39`;

  assert.equal(browserId(brave).name, 'Brave');
  assert.equal(browserId(brave).version, '1.62.0');
  assert.equal(browserId(edge).name, 'Microsoft Edge');
  assert.equal(browserId(edge).version, '131.0.2903.86');
  assert.equal(browserId(opera).name, 'Opera');
  assert.equal(browserId(opera).version, '115.0.0.0');
  assert.equal(browserId(vivaldi).name, 'Vivaldi');
  assert.equal(browserId(vivaldi).version, '6.5.3206.39');
});

test('the name is the one the machine knows the browser by, so the two answers can be compared', () => {
  const installed = new Set([
    'Google Chrome',
    'Microsoft Edge',
    'Brave',
    'Opera',
    'Vivaldi',
    'Chromium'
  ]);

  for (const agent of [
    CHROME,
    `${CHROME} Brave/1.62.0`,
    `${CHROME} Edg/131.0.2903.86`,
    `${CHROME} OPR/115.0.0.0`,
    `${CHROME} Vivaldi/6.5.3206.39`
  ]) {
    assert.ok(installed.has(browserId(agent).name), `${browserId(agent).name} is a name the machine uses`);
  }
});

test('a page that names no browser says so instead of guessing one', () => {
  assert.deepEqual(browserId(''), {
    name: 'unknown',
    version: ''
  });
  assert.deepEqual(browserId(null), {
    name: 'unknown',
    version: ''
  });
});

test('the page is asked for its user agent and nothing else', () => {
  assert.match(BROWSER_EXPRESSION, /navigator\.userAgent/);
});
