// @last-edited: 2026-10-09 UTC+7.
// @title: extension-source — the bundle order keeps every slice anchor valid.
// @state: pins background.js as the first FILES entry and the bundle's byte-identical prefix — a claim that survives a second file.
// @dependencies: node:test, strict, node:fs/promises, helpers/extension-source.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extensionSource, extensionSourceFiles } from './helpers/extension-source.mjs';

test('the helper reads background.js itself, and lists it first', async () => {
  const raw = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const files = extensionSourceFiles();
  assert.equal(files[0], 'extension/background.js',
    'background.js must stay the first entry; every anchor is measured from it');
  const bundle = await extensionSource();
  assert.ok(bundle.startsWith(raw),
    'the bundle must begin with background.js byte-for-byte — a wrong path, a '
    + 'wrong encoding, or a reordered FILES array all break this');
});

test('the bundle order keeps every cross-module indexOf anchor valid', async () => {
  const src = await extensionSource();
  const files = extensionSourceFiles();
  const idx = (name) => files.indexOf(name);

  // serialize sebelum watch-registry: hygiene menyatukan pasangan ini.
  if (files.includes('extension/lib/serialize.js') && files.includes('extension/worker/watch-registry.js')) {
    assert.ok(idx('extension/lib/serialize.js') < idx('extension/worker/watch-registry.js'),
      'serialize must precede watch-registry');
    assert.ok(src.indexOf('function boundedResult') >= 0, 'boundedResult must be in the bundle');
    assert.ok(src.indexOf('// ---- Event-Triggered Workflows') > src.indexOf('function boundedResult'),
      'the watch section marker must follow boundedResult');
  }

  // execute-pull terakhir: hygiene memotong executeCommand tanpa batas kedua.
  if (files.includes('extension/worker/execute-pull.js')) {
    assert.equal(idx('extension/worker/execute-pull.js'), files.length - 1,
      'execute-pull must be last so its slice runs to the end of the bundle');
  }

  // Anchor yang selalu ada — menangkap kasus seperti U-V yang memotong -1.
  for (const anchor of [
    'async function executeCommand',
    'async function withForegroundFocusGate',
    '// Action Pipeline',
    'function boundedResult',
    'function oversized',
    '// ---- Event-Triggered Workflows',
  ]) {
    assert.ok(src.indexOf(anchor) > 0, `anchor must exist in the bundle: ${anchor}`);
  }
});
