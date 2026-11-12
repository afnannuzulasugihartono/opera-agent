// @last-edited: 2026-11-12 UTC+7.
// @title: detect-browsers - one truth, two answers: what detectBrowsers finds, and what the installer does with it.
// @state: the package's one browser list, asked through its own detectBrowsers; no second path table anywhere.
// @dependencies: test, assert, ../local/browsers.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowsers, BROWSERS, expandPath } from '../local/browsers.js';

const tree = (paths) => { const set = new Set(paths); return (p) => set.has(p); };

const lower = (p) => String(p).toLowerCase().replace(/\\/g, '/');

test('finds chrome at the Program Files path', () => {
  const paths = BROWSERS.filter((b) => b.id === 'chrome').flatMap((b) => b.paths.win32).map((p) => lower(expandPath(p, {})));
  const found = detectBrowsers({ platform: 'win32', exists: tree(paths), env: {} });
  assert.deepEqual(found.map((b) => b.id), ['chrome']);
});

test('finds nothing when nothing exists', () => {
  const found = detectBrowsers({ platform: 'win32', exists: () => false, env: {} });
  assert.deepEqual(found, []);
});

test('finds brave when it exists', () => {
  const paths = BROWSERS.filter((b) => b.id === 'brave').flatMap((b) => b.paths.win32).map((p) => lower(expandPath(p, {})));
  const found = detectBrowsers({ platform: 'win32', exists: tree(paths), env: {} });
  assert.deepEqual(found.map((b) => b.id), ['brave']);
});

test('finds edge when it exists', () => {
  const paths = BROWSERS.filter((b) => b.id === 'edge').flatMap((b) => b.paths.win32).map((p) => lower(expandPath(p, {})));
  const found = detectBrowsers({ platform: 'win32', exists: tree(paths), env: {} });
  assert.deepEqual(found.map((b) => b.id), ['edge']);
});

test('finds all three with the three-browser filter the installer uses', () => {
  const paths = BROWSERS.filter((b) => ['chrome', 'brave', 'edge'].includes(b.id)).flatMap((b) => b.paths.win32).map((p) => lower(expandPath(p, {})));
  const found = detectBrowsers({ platform: 'win32', exists: tree(paths), env: {} }).filter((b) => ['chrome', 'brave', 'edge'].includes(b.id));
  assert.deepEqual(found.map((b) => b.id), ['chrome', 'edge', 'brave']);
});

test('ignores browsers the installer does not support', () => {
  const paths = BROWSERS.filter((b) => ['opera', 'vivaldi', 'chromium'].includes(b.id)).flatMap((b) => b.paths.win32).map((p) => lower(expandPath(p, {})));
  const found = detectBrowsers({ platform: 'win32', exists: tree(paths), env: {} }).filter((b) => ['chrome', 'brave', 'edge'].includes(b.id));
  assert.deepEqual(found, []);
});

test('%LOCALAPPDATA% expands against env', () => {
  assert.match(expandPath('%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe', { LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local' }), /Users\\X\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe/);
});
