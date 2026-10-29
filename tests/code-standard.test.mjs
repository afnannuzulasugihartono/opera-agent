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
import { listItemLines } from './helpers/vertical-lists.mjs';

const root = new URL('..', import.meta.url);
const repo = (p) => new URL(p, root);

const tracked = () => {
  const listed = execFileSync('git', ['ls-files'], {
    cwd: repo('.'),
    encoding: 'utf8'
  })
    .split('\n').filter(Boolean);
  const untracked = execFileSync('git', [
    'ls-files',
    '--others',
    '--exclude-standard'
  ],
    {
      cwd: repo('.'),
      encoding: 'utf8'
    }).split('\n').filter(Boolean);
  return [...new Set([
    ...listed,
    ...untracked
  ])];
};

const read = (file) => fs.readFileSync(repo(file), 'utf8');
const lines = (file) => read(file).split(/\r?\n/);

// WHY A SIZE GATE COUNTS THE LINES THAT CARRY CODE.
// A list written one item per line makes a file longer without making it bigger, so counting every line charges a file for the shape of its data.
// The list items are counted out, and what is left is the code: the same number for the same file whether its lists stand on one line or on twenty.
// The ceiling below then means what it says, and a reflow of a list cannot push a file past it.

const codeLines = (file) => {
  const text = read(file);
  const items = listItemLines(text);
  return text.split(/\r?\n/).filter((
    _,
    index
  ) => !items.has(index + 1));
};

// WHY THE CAP IS TWELVE HUNDRED LINES.
// The file that broke it was 2,327 lines and held three unrelated jobs: the expressions the page runs, the verbs that drive it, and the file verbs.
// Split along those lines and the largest file is 1,112, so the cap sits above the truth and below the accident.
// A file that grows past it has usually grown a second job.

const FILE_LINE_CAP = 1200;

// WHY NO FILE IS NAMED ANY MORE.
// content.js was excepted here with the claim that Chrome loads a content script as one unit, so splitting it would need separate manifest entries and separate isolated worlds.
// The claim was false, and the tree proved it: manifest.content_scripts[0].js has always loaded six files through one entry, in one isolated world, in order.
// What actually kept the file large was that sentence, not the platform — so the exception is gone and the ceiling in the content-script gate below is what holds the line now.
// The empty map stays because the size test below iterates it; deleting the name would break the gate that reads it.

const FILE_LINE_EXCEPTIONS = new Map();

// WHY A FILE WITH ITS OWN CEILING IS NOT MEASURED TWICE.
// content.js is the dispatcher, and the content-script gate below holds it under 300 lines - a stricter number than this cap.
// The general cap is for files with no ceiling of their own; measuring one file in two places reports one fact twice and lets the weaker number look like the rule that applies.

const DEDICATED_CEILING_FILES = new Set(['extension/content.js']);

// WHY THE CONTENT SCRIPT ENTRY HAS A CEILING OF ITS OWN.
// The file was 1,945 lines and held every page primitive in one IIFE: refs, geometry, the semantic layer, the write path, scroll, wait, media and watch.
// The manifest loads content scripts as a list, so one entry was never a platform requirement — it was a habit, and the cap below is what ends it.

const CONTENT_ENTRY_CEILING = 300;

// WHY THE LOAD ORDER IS PINNED AS A WHOLE LIST.
// A module read before it loads answers undefined, and the failure is silent: the helper is simply missing and the page keeps working with half its features.
// Pinning the whole list means a new file added in the wrong place fails here instead of in a user's browser.

const CONTENT_SCRIPT_LOAD_ORDER = [
  'lib/agent-log.js',
  'semantic-identity.js',
  'semantic-views.js',
  'role-reconcile.js',
  'hover-settle.js',
  'page-kit.js',
  'action-refs.js',
  'element-facts.js',
  'page-wait.js',
  'semantic-page.js',
  'page-actions.js',
  'page-scroll.js',
  'page-media.js',
  'content.js'
];

// WHY THE FIVE FILES THAT SHIPPED BEFORE THE SPLIT ARE LEFT OUT OF THE STATE COMPARISON.
// They carry their own private copies on purpose: content.js has its own stableHash and semantic-identity.js has one too, each inside its own IIFE.
// Comparing the entry against them would report a duplication that predates this split and is not what the gate is for.

const CONTENT_SCRIPT_LEAF_FILES = new Set([
  'lib/agent-log.js',
  'semantic-identity.js',
  'semantic-views.js',
  'role-reconcile.js',
  'hover-settle.js'
]);

test('no source file grows past the cap without a named reason', () => {
  const offenders = [];
  for (const file of tracked()) {
    if (!/\.(js|mjs|ts|tsx)$/.test(file)) continue;
    if (file.startsWith('tests/')) continue;
    const count = codeLines(file).length;
    if (count <= FILE_LINE_CAP) continue;
    if (FILE_LINE_EXCEPTIONS.has(file)) continue;
    if (DEDICATED_CEILING_FILES.has(file)) continue;
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
    lines(file).forEach((
      line,
      index
    ) => {
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
    const body = codeLines(file).map((line) => line.trim());
    const seen = new Map();
    for (let i = 0; i + WINDOW <= body.length; i += 1) {
      const block = body.slice(i, i + WINDOW).join('\n');
      if (block.replace(/[^a-zA-Z]/g, '').length < 200) continue;
      if (seen.has(block)) {
        offenders.push(`${file} repeats a ${WINDOW}-line block of code at ${seen.get(block) + 1} and ${i + 1}`);
        break;
      }
      seen.set(block, i);
    }
  }
  assert.deepEqual(offenders, [],
    `the same twelve lines of code twice is a function that wants to be one:\n${offenders.join('\n')}`);
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

test('the content script entry stays thin, and its modules stay under the worker ceiling', () => {

  // WHY A MODULE THAT DOES NOT EXIST YET IS NOT MEASURED.
  // The ceiling is for a module that is there; a name in the load order with no file behind it is a step still to come.

  const movedModules = CONTENT_SCRIPT_LOAD_ORDER.filter(
    (name) => name !== 'content.js' && !name.startsWith('lib/') && tracked().includes(`extension/${name}`)
  );
  const entry = lines('extension/content.js').length;
  assert.ok(entry < CONTENT_ENTRY_CEILING,
    `content.js is the dispatcher, not the product: ${entry} lines`);
  for (const name of movedModules) {
    assert.ok(lines(`extension/${name}`).length < 550,
      `extension/${name} is ${lines(`extension/${
        name
      }`).length} lines`);
  }
});

test('the manifest loads the content scripts in dependency order', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.deepEqual(manifest.content_scripts[0].js, CONTENT_SCRIPT_LOAD_ORDER,
    `the load order is the topological order; a file added out of place loads before its namespace exists:\n  got ${JSON.stringify(manifest.content_scripts[0].js)}`);
});

test('every content script module publishes the namespace the entry reads', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const entry = read('extension/content.js');
  const offenders = [];
  for (const rel of manifest.content_scripts[0].js) {
    if (rel === 'content.js' || rel === 'lib/agent-log.js') continue;
    const stem = rel.split('/').pop().replace(/\.js$/, '');
    const namespace = `OperaAgent${stem.split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1)).join('')}`;
    const text = read(`extension/${rel}`);
    if (!text.includes(`globalThis.${namespace} =`)) {
      offenders.push(`${rel} does not publish globalThis.${namespace}`);
      continue;
    }
    if (!entry.includes(`globalThis.${namespace}`)) {
      offenders.push(`content.js never reads globalThis.${namespace}, so the module publishes into the void`);
    }
  }
  assert.deepEqual(offenders, [],
    `a namespace nobody reads is a feature that is missing without an error:\n${offenders.join('\n')}`);
});

test('the entry declares no state a content script module also declares', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const declaredIn = (text) => [
    ...[...text.matchAll(/^ {2}(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^ {2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
  ];
  const modules = new Map();
  for (const rel of manifest.content_scripts[0].js) {
    if (rel === 'content.js' || CONTENT_SCRIPT_LEAF_FILES.has(rel)) continue;
    for (const name of declaredIn(read(`extension/${rel}`))) {
      modules.set(name, [
        ...(modules.get(name) || []),
        rel
      ]);
    }
  }
  const duplicated = declaredIn(read('extension/content.js')).filter((name) => modules.has(name));
  assert.deepEqual(duplicated, [],
    `a name declared in the entry and in a module is two copies of one piece of state, and only one of them is live:\n${
      duplicated.map((name) => `  ${
        name
      }: entry + ${
        modules.get(name).join(', ')
      }`).join('\n')}`);
});
