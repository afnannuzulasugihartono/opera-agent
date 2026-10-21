// @last-edited: 2026-10-21 UTC+7.
// @title: code-standard — the rules this tree holds itself to, measured instead of promised.
// @state: four gates: file size, leftover markers, self-duplication, and an export nobody exercises.
// @dependencies: node:test, strict, node:fs, node:path, node:child_process.

// WHY THIS FILE EXISTS

// A standard that lives in a document is a promise; a standard that lives in a test is a measurement.
// The rules below are the ones this tree was written to and could not keep: the biggest file in the tree had grown to 2,327 lines because nothing said it should not, the comment rule had been unenforced in the very files that needed it because the scanner miscounted one template literal, and sixty exports sat in the tree with no test naming them.

// Each gate below measures one thing, and each names the failure it prevents.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const repo = (p) => new URL(p, root);

const tracked = () => {
  const listed = execFileSync('git', ['ls-files'], { cwd: repo('.'), encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'],
    { cwd: repo('.'), encoding: 'utf8' }).split('\n').filter(Boolean);
  return [...new Set([...listed, ...untracked])];
};

const read = (file) => fs.readFileSync(repo(file), 'utf8');
const lines = (file) => read(file).split(/\r?\n/);

// WHY THE CAP IS TWELVE HUNDRED LINES.
// The file that broke it was 2,327 lines and held three unrelated jobs: the expressions the page runs, the verbs that drive it, and the file verbs.
// Split along those lines and the largest file is 1,112, so the cap sits above the truth and below the accident.
// A file that grows past it has usually grown a second job.

const FILE_LINE_CAP = 1200;

// WHY ONE FILE IS NAMED INSTEAD OF FIXED HERE.
// Chrome loads a content script as one unit, so splitting extension/content.js means separate manifest entries and separate isolated worlds, which is a project of its own and not a line count.
// The exception is named, counted and visible, and the rest of the tree has no exceptions.

const FILE_LINE_EXCEPTIONS = new Map([
  ['extension/content.js', 'Chrome loads a content script as one unit; splitting it means separate manifest entries.']
]);

test('no source file grows past the cap without a named reason', () => {
  const offenders = [];
  for (const file of tracked()) {
    if (!/\.(js|mjs|ts|tsx)$/.test(file)) continue;
    if (file.startsWith('tests/')) continue;
    const count = lines(file).length;
    if (count <= FILE_LINE_CAP) continue;
    if (FILE_LINE_EXCEPTIONS.has(file)) continue;
    offenders.push(`${file} is ${count} lines`);
  }
  assert.deepEqual(offenders, [],
    `a file over ${FILE_LINE_CAP} lines has usually grown a second job:\n${offenders.join('\n')}`);

  for (const [file, reason] of FILE_LINE_EXCEPTIONS) {
    assert.ok(tracked().includes(file), `the exception names a file that exists: ${file}`);
    assert.ok(reason.length > 20, 'an exception has to say why, in words');
  }
});

test('no source file carries a leftover marker', () => {
  const markers = /\b(TODO|FIXME|XXX|HACK|WIP)\b/;
  const offenders = [];
  for (const file of tracked()) {
    if (!/\.(js|mjs|ts|tsx|py)$/.test(file)) continue;
    if (file.startsWith('tests/')) continue;
    lines(file).forEach((line, index) => {
      if (markers.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [],
    `a marker is a promise nobody kept:\n${offenders.join('\n')}`);
});

test('no file repeats a block of its own code', () => {
  const WINDOW = 12;
  const offenders = [];
  for (const file of tracked()) {
    if (!/\.(js|mjs|ts|tsx)$/.test(file)) continue;
    const body = lines(file).map((line) => line.trim());
    const seen = new Map();
    for (let i = 0; i + WINDOW <= body.length; i += 1) {
      const block = body.slice(i, i + WINDOW).join('\n');
      if (block.replace(/[^a-zA-Z]/g, '').length < 200) continue;
      if (seen.has(block)) {
        offenders.push(`${file} repeats a ${WINDOW}-line block at ${seen.get(block) + 1} and ${i + 1}`);
        break;
      }
      seen.set(block, i);
    }
  }
  assert.deepEqual(offenders, [],
    `the same twelve lines twice is a function that wants to be one:\n${offenders.join('\n')}`);
});

test('every exported function in local/ is exercised by the suite', () => {
  const suite = tracked()
    .filter((file) => file.startsWith('tests/'))
    .map((file) => read(file))
    .join('\n');

  const untested = [];
  for (const file of tracked()) {
    if (!file.startsWith('local/')) continue;
    if (!/\.(js|mjs)$/.test(file)) continue;
    const source = read(file);
    for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) {
      const name = match[1];
      if (!new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(suite)) {
        untested.push(`${file} exports ${name}, which no test names`);
      }
    }
  }
  assert.deepEqual(untested, [],
    `an exported function nobody calls is a function nobody knows works:\n${untested.join('\n')}`);
});
