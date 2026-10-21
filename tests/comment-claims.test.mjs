// @last-edited: 2026-10-21 UTC+7.
// @title: comment-claims — a number a comment quotes must exist somewhere in the tree, or the comment must say where it was measured.
// @state: one gate, with the teeth proven: a number nothing holds is refused, and a measurement with no source is refused.
// @dependencies: node:test, node:assert/strict, node:fs, node:path, node:child_process, tests/helpers/comment-format.mjs.

// WHY A NUMBER IN A COMMENT MUST EXIST SOMEWHERE.
// A comment that quotes a number is making a claim, and a claim about a measurement is the kind people believe.
// If nothing in the tree holds that number, the claim was invented, and an invented measurement is worse than no measurement: the next reader trusts it and builds a decision on it.
// The number may live in the code, in a test, in a file name, or in a measurement whose source the comment names.
// A number that satisfies none of those is refused.

// WHY THE SOURCE IS PART OF THE RULE.
// "Measured" alone says the author believed a number, and a belief with no source cannot be re-checked by the next person.
// "Measured on this machine" says where to look.
// The escape is deliberately narrow: it is for a number that is genuinely new, and it costs the author a sentence saying where they measured it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commentLineMask } from './helpers/comment-format.mjs';

const root = new URL('..', import.meta.url);
const repo = (p) => new URL(p, root);

const skipDirs = new Set(['.git', 'node_modules', '.kilo', 'dist', 'build', 'tmp', 'coverage', '__pycache__', '.vercel', '.next', '.temp']);
const SOURCE_EXT = /\.(?:js|mjs|cjs|ts|jsx|tsx|py|html|htm|css|sql|yml|yaml|toml|cmd|bat|example)$/;

const walk = (relative) => {
  const out = [];
  for (const entry of fs.readdirSync(repo(relative), { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const next = relative ? `${relative}/${entry.name}` : relative;
    if (entry.isDirectory()) out.push(...walk(next));
    else out.push(next);
  }
  return out;
};

const files = walk('.').filter((file) => SOURCE_EXT.test(file));
const tracked = execFileSync('git', ['ls-files'], { cwd: repo('.'), encoding: 'utf8' }).split('\n').filter(Boolean);
const treeText = files.map((file) => fs.readFileSync(repo(file), 'utf8')).join('\n');
const nameText = tracked.join('\n');

// A measurement has to say it was measured, and where.

const MEASURED = /\b(?:measured|observed)\b/i;
const SOURCE = /\b(?:on this machine|here|on a real|in production|live|on the same|on that machine|on this project|on a real job)\b/i;

const clean = (line) => line.replace(/^\s*(?:\/\/+|#+|--+|@?REM|::|\*|\/\*+|\*+\/|<!--|-->)\s?/i, '').trim();

// A number of three digits or more, standing on its own: not part of a longer one.

const numbersIn = (text) => [...text.matchAll(/(?<![\w.])(\d[\d_]*)(?![\w.])/g)]
  .map((match) => match[1].replace(/_/g, ''))
  .filter((number) => number.length >= 3);

export function unsupportedNumbers(text, ext) {
  const mask = commentLineMask(text, ext);
  const lines = text.split('\n');
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!mask[index]) continue;
    const body = clean(lines[index]);
    if (!body || body.startsWith('@')) continue;
    for (const number of numbersIn(body)) {
      if (treeText.includes(number) || nameText.includes(number)) continue;
      if (MEASURED.test(body) && SOURCE.test(body)) continue;
      found.push({ line: index + 1, number, body: body.slice(0, 110) });
      break;
    }
  }
  return found;
}

test('every number a comment quotes exists somewhere in the tree', () => {
  const problems = [];
  for (const file of files) {
    const text = fs.readFileSync(repo(file), 'utf8');
    for (const row of unsupportedNumbers(text, path.extname(file).toLowerCase())) {
      problems.push(`${file}:${row.line} quotes ${row.number}, which nothing in the tree holds | ${row.body}`);
    }
  }
  assert.deepEqual(problems, [], `a number nothing supports is an invented measurement:\n${problems.join('\n')}`);
});

test('the rule has teeth: a number nothing holds is refused', () => {
  // The number is computed, so this file does not put it in the tree either.
  const fabricated = String(9876543 + files.length);
  assert.equal(treeText.includes(fabricated), false, 'the fabricated number must be absent from the tree');
  const source = [
    '// @state: probe.',
    '// @dependencies: none.',
    '',
    `// The ramp climbs to ${fabricated} ms before it gives up.`,
    'const x = 1;',
    '',
  ].join('\n');
  const found = unsupportedNumbers(source, '.mjs');
  assert.equal(found.length, 1, 'a number nothing in the tree holds must be refused');
  assert.equal(found[0].number, fabricated);
});

test('the rule has teeth: a measurement with no source is refused', () => {
  const fabricated = String(9876543 + files.length);
  const source = [
    '// @state: probe.',
    '// @dependencies: none.',
    '',
    `// Measured, a burst spent ${fabricated} ms in the browser.`,
    'const x = 1;',
    '',
  ].join('\n');
  const found = unsupportedNumbers(source, '.mjs');
  assert.equal(found.length, 1, 'a measurement must say where it was taken');
  assert.equal(found[0].number, fabricated);
});

test('the rule lets a measurement through when it says where it was taken', () => {
  // The escape is for a number that is genuinely new, and it is the honest limit of the rule: no gate can tell a real measurement from an invented one, so the rule asks for the source instead.
  // A reader can then go and check it.
  const fabricated = String(9876543 + files.length);
  const source = [
    '// @state: probe.',
    '// @dependencies: none.',
    '',
    `// Measured on this machine, a burst spent ${fabricated} ms in the browser.`,
    'const x = 1;',
    '',
  ].join('\n');
  assert.deepEqual(unsupportedNumbers(source, '.mjs'), [],
    'a measurement that names its source is allowed, and that is the limit of the rule');
});
