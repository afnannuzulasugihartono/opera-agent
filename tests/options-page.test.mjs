// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: options-page.test — page.test — Test.
// @state: map options validation errors to actionable messages.
// @dependencies: node:test, strict, promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('options page never references secrets', async () => {
  const html = await readFile(new URL('../extension/options.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../extension/options.js', import.meta.url), 'utf8');
  for (const [name, src] of [['options.html', html], ['options.js', js]]) {
    assert.doesNotMatch(src, /deviceToken|pairCode|password|apiKey|ghp_/i, name);
    assert.doesNotMatch(src, /type\s*=\s*["']password["']/i, name);
  }
});

test('options page is registered in the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.options_page, 'options.html');
});

test('getConfig applies a stored log level with a safe fallback and never throws', async () => {
  // Plan Review Focus: a corrupt/invalid stored log level must leave the
  // threshold unchanged without throwing out of getConfig. background.js
  // registers chrome listeners at module top-level and cannot be imported
  // under node:test, so the guarded configure statement is pinned by exact
  // text (the frozen Task 3 Step 1b contract) and evaluated against a stub:
  // a corrupt stored value must fall back to 'warn' and a throwing configure
  // must never escape the guarded apply.
  const bg = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const guarded = bg.match(/try \{ globalThis\.OperaAgentLog\?\.configure\?\.\(\{ level: \['debug', ?'warn', ?'error'\]\.includes\(cfg\.logLevel\) \? cfg\.logLevel : 'warn' \}\); \} catch \{\}/);
  assert.ok(guarded, 'guarded log-level configure statement present verbatim');
  assert.match(bg, /const STORAGE_KEYS = \[[^\]]*'logLevel'[^\]]*\]/);
  assert.match(bg, /logLevel: \['debug', ?'warn', ?'error'\]\.includes\(cfg\.logLevel\) \? cfg\.logLevel : 'warn'/);
  assert.match(bg, /changes\.logLevel/);

  const calls = [];
  const saved = globalThis.OperaAgentLog;
  globalThis.OperaAgentLog = { configure: (options) => calls.push(options) };
  try {
    const apply = new Function('cfg', guarded[0]);
    apply({ logLevel: 'not-a-level' });
    apply({ logLevel: 'debug' });
  } finally {
    if (saved === undefined) delete globalThis.OperaAgentLog;
    else globalThis.OperaAgentLog = saved;
  }
  assert.deepEqual(calls, [{ level: 'warn' }, { level: 'debug' }]);

  globalThis.OperaAgentLog = { configure: () => { throw new Error('configure exploded'); } };
  try {
    assert.doesNotThrow(() => new Function('cfg', guarded[0])({ logLevel: 'debug' }));
  } finally {
    if (saved === undefined) delete globalThis.OperaAgentLog;
    else globalThis.OperaAgentLog = saved;
  }
});
