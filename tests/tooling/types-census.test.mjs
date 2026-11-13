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

test('the runtime census lists shared/*.ts, not only .js', () => {
  const listed = execFileSync(process.execPath, ['scripts/verify/check.mjs', '--list'], { cwd: repo, encoding: 'utf8' });
  const lines = listed.split(/\r?\n/).map((line) => line.replace(/\\/g, '/'));
  assert.ok(lines.includes('shared/canonical-order.ts'), `the census lists the .ts sources:\n${lines.join('\n')}`);
  assert.ok(!lines.some((line) => /^shared\/[^/]+\.js$/.test(line)), 'the census never lists the emitted shared/*.js copies');
});
