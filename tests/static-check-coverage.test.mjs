// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: static-check-coverage.test — check-coverage.test — Test.
// @state: require dynamic runtime safety scan.
// @dependencies: node:test, strict, node:fs, node:path, node:child_process, node:url.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('static checker scans newly added runtime files instead of a hardcoded file list', () => {
  const fixture = path.join(root, 'lib', '.check-coverage-fixture.js');
  try {
    fs.writeFileSync(fixture, 'export const unsafe = eval("1");\n', 'utf8');
    const result = spawnSync(process.execPath, ['scripts/check.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'npm run check must reject unsafe code in newly added runtime files');
    assert.match(`${result.stdout}\n${result.stderr}`, /\.check-coverage-fixture\.js must not use eval/);
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});
