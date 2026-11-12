// @last-edited: 2026-11-12 UTC+7.
// @title: detect-browsers - the paths this machine carries, and what the probe answers.
// @state: the probe is a pure function; it reads nothing but the environment it is given.
// @dependencies: test, assert, ../local/detect-browsers.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBrowsers, browserCandidates } from '../local/detect-browsers.js';

const tree = (paths) => { const set = new Set(paths); return (p) => set.has(p); };

test('finds chrome at Program Files', () => {
  const found = probeBrowsers(tree(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']));
  assert.deepEqual(found, [{ id: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }]);
});

test('finds nothing when nothing exists', () => assert.deepEqual(probeBrowsers(() => false), []));

test('finds brave at Program Files', () => {
  const found = probeBrowsers(tree(['C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe']));
  assert.deepEqual(found, [{ id: 'brave', path: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' }]);
});

test('finds edge under Program Files (x86)', () => {
  const found = probeBrowsers(tree(['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']));
  assert.deepEqual(found, [{ id: 'edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }]);
});

test('finds all three when present, one entry each, in report order', () => {
  const all = new Set(browserCandidates().map((entry) => entry.path));
  const found = probeBrowsers((p) => all.has(p));
  assert.deepEqual(found.map((entry) => entry.id), ['chrome', 'brave', 'edge']);
});

test('candidates are absolute paths under an existing drive root', () => {
  for (const entry of browserCandidates()) {
    assert.match(entry.path, /^[A-Z]:\\/, entry.path);
  }
});
