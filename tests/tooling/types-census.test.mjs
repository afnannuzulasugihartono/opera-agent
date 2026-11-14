// @last-edited: 2026-11-13 UTC+7.
// @title: types-census - the runtime census counts the TypeScript sources, not only the .js.
// @state: a source carries its types beside it in the tree; the census scans the owned file, never the emitted copy.
// The list IS the judge: a gate that cannot see the .ts twins cannot fail on them.
// @dependencies: node:test, assert, child_process, url.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
import path from 'node:path';
import fs from 'node:fs';

// WHY THE SPAWN RETRIES ONCE AND THEN DUMPS EVIDENCE.
// A handful of fresh GitHub runner VMs has thrown a census whose spawn lost whole top-level directories between the build step and the test, with no code change anywhere; the gate is right to assert the sources, it just must not say nothing about what it saw.
// One retry separates a fluke from a real tree, and if both attempts lose the directory the test prints the directory itself so the next failure arrives with the runner's own eyes.

const census = () => {
  const listed = execFileSync(process.execPath, ['scripts/verify/check.mjs', '--list'], { cwd: repo, encoding: 'utf8' });
  return listed.split(/\r?\n/).map((line) => line.replace(/\\/g, '/'));
};

const snapshot = () => {
  const out = {};
  for (const dir of ['local', 'shared']) {
    try {
      out[dir] = fs.readdirSync(path.join(repo, dir));
    } catch (error) {
      out[dir] = `readdir error: ${String(error)}`;
    }
  }
  return JSON.stringify(out);
};

const censusOrEvidence = () => {
  const first = census();
  const ok = first.includes('local/primitives.ts') && first.includes('shared/canonical-order.ts');
  if (ok) return first;
  const second = census();
  if (second.includes('local/primitives.ts') && second.includes('shared/canonical-order.ts')) return second;
  process.stderr.write(`types-census: the census lost these directories on this machine: ${snapshot()}\n`);
  return first;
};

test('the runtime census lists local/*.ts, not only .js', () => {
  const lines = censusOrEvidence();
  assert.ok(lines.includes('local/primitives.ts'), `the census lists the .ts sources:\n${lines.join('\n')}`);
  assert.ok(!lines.some((line) => /^(local\/[^/]+|local\/bin\/[^/]+|local\/office\/[^/]+|local\/lib\/[^/]+)\.js$/.test(line)), 'the census never lists the emitted local/*.js copies');
  assert.ok(!lines.some((line) => /^local\/.*\.d\.ts$/.test(line)), 'the census never lists local type declarations as runtime files');
});

test('the runtime census lists shared/*.ts, not only .js', () => {
  const lines = censusOrEvidence();
  assert.ok(lines.includes('shared/canonical-order.ts'), `the census lists the .ts sources:\n${lines.join('\n')}`);
  assert.ok(!lines.some((line) => /^shared\/[^/]+\.js$/.test(line)), 'the census never lists the emitted shared/*.js copies');
});
