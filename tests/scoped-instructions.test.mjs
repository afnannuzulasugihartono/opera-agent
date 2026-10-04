// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: scoped-instructions.test — instructions.test — Scoped first-read files.
// @state: every file mention carries its full address, and contradictions fixed.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Scoped first-read files (2026-10-03, owner-ordered).
//
// The root AGENTS.md is harness-injected; these are the only other files an
// agent must read before touching an area. Each stays a pointer list, not a
// second manual, so the haystack does not grow a new haystack.

const areas = ['extension', 'lib', 'supabase'];
const root = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

for (const area of areas) {
  test(`${area}/AGENTS.md exists, stays short, and points at the root`, () => {
    const url = new URL(`../${area}/AGENTS.md`, import.meta.url);
    assert.ok(fs.existsSync(url), `${area}/AGENTS.md must exist`);
    const text = fs.readFileSync(url, 'utf8');
    assert.ok(
      text.split('\n').length <= 15,
      `${area}/AGENTS.md must stay a pointer list (cap 15 lines)`
    );
    assert.match(text, /\[AGENTS\.md\]\(\.\.\/AGENTS\.md\)/, `${area}/AGENTS.md must name and address the root`);
  });
}

test('root AGENTS.md states the scoped-file rules', () => {
  assert.match(root, /## Scoped instructions/);
  // Both halves: the rule and the forbidden opposite, so a rewrite that drops
  // either one fails here instead of passing on a section header alone.
  assert.match(root, /consistent with the root/);
  assert.match(root, /contradict the root/);
});

test('every scoped file is registered in the root area table', () => {
  for (const area of areas) {
    assert.ok(
      root.includes(`| \`${area}/\` |`),
      `${area}/AGENTS.md exists but has no row in the root Bootstrap table`
    );
  }
});
