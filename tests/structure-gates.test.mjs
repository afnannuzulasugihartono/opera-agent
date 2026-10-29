// @last-edited: 2026-10-09 UTC+7.
// @title: structure-gates — the split's rules are enforced, not remembered.
// @state: chrome-free lib with one written exception, size ceilings, and a complete worker module set.
// @dependencies: node:test, strict, node:fs/promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  readdir
} from 'node:fs/promises';
import { listItemLines } from './helpers/vertical-lists.mjs';

const root = new URL('../', import.meta.url);

function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  const keep = (s) => (s.match(/\n/g) || ['']).join('');
  while (i < text.length) {
    const c = text[i];
    const c2 = text.slice(i, i + 2);
    if (c2 === '//') {
      const s = i; while (i < text.length && text[i] !== '\n') i++; out += keep(text.slice(s, i)); continue;
    }
    if (c2 === '/*') {
      const s = i; i += 2; while (i < text.length && text.slice(i, i + 2) !== '*/') i++; i += 2; out += keep(text.slice(s, i)); continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; const s = i; i++; while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++; i++;
      } i++; out += '""' + keep(text.slice(s, i)); continue;
    }
    out += c; i++;
  }
  return out;
}

function chromeCodeLines(text) {
  const clean = stripCommentsAndStrings(text);
  const hits = [];
  let idx = 0;
  while ((idx = clean.indexOf('chrome.', idx)) !== -1) {
    const m = clean.slice(idx + 7, idx + 67).match(/^[A-Za-z_$][\w$]*/);
    if (m) hits.push(clean.slice(0, idx).split('\n').length);
    idx += 7;
  }
  return hits;
}

const CHROME_FREE_EXCEPTIONS = new Set(['debugger-session.js']);

const WORKER_CHROME_REQUIRED_EXCEPTIONS = new Set(['burst.js']);

test('extension/lib is free of chrome.* as code, except the written exception', async () => {
  const dir = new URL('extension/lib/', root);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.js')).sort();
  const offenders = [];
  for (const name of names) {
    if (CHROME_FREE_EXCEPTIONS.has(name)) continue;
    const hits = chromeCodeLines(await readFile(new URL(name, dir), 'utf8'));
    if (hits.length) offenders.push(`${name}:${hits.join(',')}`);
  }
  assert.deepEqual(offenders, [],
    'lib/ must stay testable without a browser; move the file to extension/worker/ instead');
});

test('the documented chrome.* exceptions are still real, and no more have crept in', async () => {
  const text = await readFile(new URL('extension/lib/debugger-session.js', root), 'utf8');
  assert.ok(chromeCodeLines(text).length > 0,
    'debugger-session.js no longer uses chrome.*; drop it from CHROME_FREE_EXCEPTIONS');

  assert.equal(CHROME_FREE_EXCEPTIONS.size, 1,
    'CHROME_FREE_EXCEPTIONS grew; every new exception needs a written reason');
  assert.equal(WORKER_CHROME_REQUIRED_EXCEPTIONS.size, 1,
    'WORKER_CHROME_REQUIRED_EXCEPTIONS grew; every new exception needs a written reason');
  const burst = await readFile(new URL('extension/worker/burst.js', root), 'utf8');
  assert.equal(chromeCodeLines(burst).length, 0,
    'burst.js now uses chrome.*; drop it from WORKER_CHROME_REQUIRED_EXCEPTIONS');
});

test('a worker module with no chrome.* belongs in lib/, with one written exception', async () => {
  const dir = new URL('extension/worker/', root);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.js')).sort();
  const offenders = [];
  for (const name of names) {
    if (WORKER_CHROME_REQUIRED_EXCEPTIONS.has(name)) continue;
    const hits = chromeCodeLines(await readFile(new URL(name, dir), 'utf8'));
    if (!hits.length) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    'lib/ is the chrome-free home; a worker module that never touches chrome.* has no reason to live here');
});

// WHY THE CONTENT SCRIPTS ARE CHECKED TOO.
// The page half of a primitive touches the DOM, never the extension API, so a chrome.* inside one is a sign the code belongs in a worker.
// One file is excepted and named: page-media speaks to the service worker for the listen chunks and the watch facts, which is the one job a content script legitimately does through chrome.*.

test('the content script modules reach for no chrome.* as code, with one named exception', async () => {
  const manifest = JSON.parse(await readFile(new URL('extension/manifest.json', root), 'utf8'));
  const CONTENT_CHROME_EXCEPTIONS = new Set(['page-media.js']);
  const offenders = [];
  for (const rel of manifest.content_scripts[0].js) {
    const name = rel.split('/').pop();
    if (name === 'content.js' || name === 'agent-log.js') continue;
    if (CONTENT_CHROME_EXCEPTIONS.has(name)) continue;
    const hits = chromeCodeLines(await readFile(new URL(`extension/${rel}`, root), 'utf8'));
    if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [],
    `the page half of a primitive touches the DOM, not chrome.*:\n${offenders.join('\n')}`);
});

// WHY THE CEILING COUNTS THE LINES THAT CARRY CODE.
// A list written one item per line makes a file longer without making it bigger, so the list items are counted out before the number is compared.
// The ceiling then holds the same module it held before a list was reflowed.

const codeLineCount = (text) => {
  const items = listItemLines(text);
  return text.split('\n').filter((
    _,
    index
  ) => !items.has(index + 1)).length;
};

test('worker modules stay under their ceiling, and background.js does not grow', async () => {
  const bg = await readFile(new URL('extension/background.js', root), 'utf8');
  assert.ok(codeLineCount(bg) < 600,
    `background.js must end up below 600 lines, got ${codeLineCount(bg)}`);

  const worker = new URL('extension/worker/', root);

  let names;
  try {
    names = (await readdir(worker)).filter((n) => n.endsWith('.js')).sort();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    names = [];
  }
  for (const name of names) {
    const text = await readFile(new URL(name, worker), 'utf8');
    assert.ok(codeLineCount(text) < 550,
      `${name} exceeds 550 lines: ${codeLineCount(text)}`);
  }
});
