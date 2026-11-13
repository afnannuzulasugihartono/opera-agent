// @last-edited: 2026-11-13 UTC+7.
// @title: no-explicit-any - the one type the strict core can never carry.
// @state: the compiler refuses implicit any and the spec refuses explicit any; this gate is the second half.
// @dependencies: node:test, assert, fs, path, url.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../../shared', import.meta.url));

// The three shapes `any` takes in a type position.
// The words-in-comments are not types, and every string here is code, not prose.

const ANY_POSITION = /(:\s+any\b|<any>|as any\b|as any\[|\bany\[\]\()/g;

const offenders = (file, text) => {
  const code = text.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  const hits = [];
  for (const match of code.matchAll(ANY_POSITION)) {
    hits.push(`${file}:${(code.slice(0, match.index).match(/\n/g) || []).length + 1}`);
  }
  return hits;
};

test('no explicit any survives in the strict core', () => {
  const bad = [];
  for (const entry of fs.readdirSync(shared)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
    const text = fs.readFileSync(path.join(shared, entry), 'utf8');
    bad.push(...offenders(entry, text));
  }
  assert.deepEqual(bad, [], `no explicit any in shared/:\n${bad.join('\n')}`);
});
