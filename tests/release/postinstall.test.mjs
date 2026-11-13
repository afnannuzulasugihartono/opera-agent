// @last-edited: 2026-11-12 UTC+7.
// @title: postinstall - global install only, CI-skip, opt-out honoured, never red.
// @state: the guard decides before any browser is named, so the failure mode is silence with exit 0.
// @dependencies: test, assert, node:child_process, node:path, ../local/postinstall.js behaviour via env simulation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const script = new URL('../../local/postinstall.js', import.meta.url);

const run = (env) => {
  const result = execFileSync(process.execPath, [fileURLToPath(script)], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: fileURLToPath(root),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result;
};

test('not global install exits 0 with no output about installing', () => {
  const out = run({ npm_config_global: 'false', OT_SUPPRESS: '1' });
  assert.equal(typeof out, 'string');
  assert.doesNotMatch(out, /extension registered/);
});

test('CI=true exits 0 and does not attempt the install', () => {
  const out = run({ npm_config_global: 'true', CI: 'true' });
  assert.equal(out, '');
});

test('OPERA_AGENT_NO_INSTALL=1 exits 0 silently', () => {
  const out = run({ npm_config_global: 'true', OPERA_AGENT_NO_INSTALL: '1' });
  assert.equal(out, '');
});
