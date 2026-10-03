import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Scoped first-read files (2026-10-03, owner-ordered).
//
// The root AGENTS.md is harness-injected; these are the only other files an
// agent must read before touching an area. Each stays a pointer list, not a
// second manual, so the haystack does not grow a new haystack.

const areas = ['extension', 'lib', 'supabase'];

for (const area of areas) {
  test(`${area}/AGENTS.md exists, stays short, and points at the root`, () => {
    const url = new URL(`../${area}/AGENTS.md`, import.meta.url);
    assert.ok(fs.existsSync(url), `${area}/AGENTS.md must exist`);
    const text = fs.readFileSync(url, 'utf8');
    assert.ok(
      text.split('\n').length <= 15,
      `${area}/AGENTS.md must stay a pointer list (cap 15 lines)`
    );
    assert.match(text, /Root `AGENTS\.md` binds/);
  });
}
