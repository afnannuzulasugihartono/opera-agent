// @last-edited: 2026-10-09 UTC+7.
// @title: structure-gates — the split's rules are enforced, not remembered.
// @state: chrome-free lib with one written exception, size ceilings, and a complete worker module set.
// @dependencies: node:test, strict, node:fs/promises, node:path.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

// Buang komentar dan string, pertahankan jumlah baris supaya nomor baris akurat.

function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  const keep = (s) => (s.match(/\n/g) || ['']).join('');
  while (i < text.length) {
    const c = text[i];
    const c2 = text.slice(i, i + 2);
    if (c2 === '//') { const s = i; while (i < text.length && text[i] !== '\n') i++; out += keep(text.slice(s, i)); continue; }
    if (c2 === '/*') { const s = i; i += 2; while (i < text.length && text.slice(i, i + 2) !== '*/') i++; i += 2; out += keep(text.slice(s, i)); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; const s = i; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; out += '""' + keep(text.slice(s, i)); continue; }
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

test('the documented chrome.* exception is still real', async () => {
  // Kalau debugger-session.js berhenti memakai chrome, kecualiannya harus dihapus.
  const text = await readFile(new URL('extension/lib/debugger-session.js', root), 'utf8');
  assert.ok(chromeCodeLines(text).length > 0,
    'debugger-session.js no longer uses chrome.*; drop it from CHROME_FREE_EXCEPTIONS');
});

test('worker modules stay under their ceiling, and background.js does not grow', async () => {
  // Selama ekstraksi berjalan, background.js hanya boleh menyusut — bukan membesar.
  // Ambang < 600 dipasang di Task 18, pada saat ia bisa ditegakkan; memasangnya di
  // sini akan membuat suite merah selama dua belas task berturut-turut dan setiap
  // implementer tidak akan bisa membedakan kegagalan sendiri dari kegagalan ini.
  const bg = await readFile(new URL('extension/background.js', root), 'utf8');
  assert.ok(bg.split('\n').length < 600,
    `background.js must end up below 600 lines, got ${bg.split('\n').length}`);

  const worker = new URL('extension/worker/', root);
  let names = [];
  try { names = (await readdir(worker)).filter((n) => n.endsWith('.js')).sort(); } catch { names = []; }
  for (const name of names) {
    const text = await readFile(new URL(name, worker), 'utf8');
    assert.ok(text.split('\n').length < 550,
      `${name} exceeds 550 lines: ${text.split('\n').length}`);
  }
});
