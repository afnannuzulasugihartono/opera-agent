// @last-edited: 2026-10-09 UTC+7.
// @title: extension-source — the bundle order keeps every slice anchor valid.
// @state: pins the two ordering constraints and proves the bundle equals background.js exactly, before any module has moved.
// @dependencies: node:test, strict, node:fs/promises, helpers/extension-source.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extensionSource, extensionSourceFiles } from './helpers/extension-source.mjs';

test('the bundle equals background.js exactly while nothing has moved', async () => {
  const raw = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.equal(await extensionSource(), raw,
    'with only one file listed the bundle must be byte-identical to background.js');
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
