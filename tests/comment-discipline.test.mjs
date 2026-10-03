import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Comment discipline (2026-10-03, owner-ordered): too many comments restate
// the code. A comment must answer WHY the code cannot say itself — a trap, an
// incident, or a frozen-contract reason. WHAT never gets a comment.

const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('AGENTS.md states the WHY-only comment rule', () => {
  assert.match(agents, /Comments answer WHY, never WHAT/);
});
