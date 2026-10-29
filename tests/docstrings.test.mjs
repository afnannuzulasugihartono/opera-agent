// @last-edited: 2026-10-30 UTC+7.
// @title: docstrings — every exported declaration is documented, and the debt list only shrinks.
// @state: one gate: an exported function, arrow or class carries a `/** ... */` block unless it is named in scripts/docstring-baseline.mjs.
// @dependencies: node:test, strict, node:fs, node:child_process, docstrings, docstring-baseline.

// WHY THE RULE IS A GATE AND NOT A WISH.
// A docstring that exists only where someone remembered to write one is a docstring that drifts, and the drift is silent because an undocumented export still works.
// Pinning the current debt in a list that may only shrink makes the rule enforceable for every new export from the first commit, the same way the vertical-list baseline does it for lists.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { undocumentedExports } from './helpers/docstrings.mjs';
import {
  DOCSTRING_BASELINE,
  DOCSTRING_PENDING
} from '../scripts/docstring-baseline.mjs';

const root = new URL('..', import.meta.url);

const tracked = () => execFileSync('git', [
  'ls-files'
], {
  cwd: new URL('.', root),
  encoding: 'utf8'
})
  .split('\n')
  .filter((file) => /\.(js|mjs|ts)$/.test(file) && !file.startsWith('tests/'));

test('no exported declaration is undocumented unless the baseline names it, and the baseline only shrinks', () => {
  const pending = new Set(DOCSTRING_PENDING);
  for (const entry of pending) {
    const [file] = entry.split(':');
    assert.ok(fs.existsSync(new URL(file, root)), `the docstring baseline names a file that exists: ${file}`);
  }
  assert.ok(pending.size <= DOCSTRING_BASELINE,
    `the docstring baseline grew from ${DOCSTRING_BASELINE} to ${pending.size}; it may only shrink`);

  const offenders = [];
  for (const file of tracked()) {
    const text = fs.readFileSync(new URL(file, root), 'utf8');
    for (const hit of undocumentedExports(text)) {
      const key = `${file}: ${hit.kind} ${hit.name} (line ${hit.line})`;
      if (pending.has(key)) continue;
      offenders.push(key);
    }
  }
  assert.deepEqual(offenders, [],
    `an exported declaration carries a JSDoc block with @param/@returns unless the baseline names it:\n${offenders.join('\n')}`);
});
