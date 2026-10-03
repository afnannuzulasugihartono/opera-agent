import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Doc caps (2026-10-03, owner-ordered): live context files stay short or the
// haystack regrows. Counts are lines including the trailing-newline artifact,
// so a 150-line file reads as 151 here — caps carry 1 line of slack.
// WHY no archive destination: docs/context-archive.md was removed 2026-10-04
// (owner-ordered) because a file nothing reads cannot make the code faster.
// Spent detail is recoverable from git, so the cap message points there instead.

function lines(url) {
  return fs.readFileSync(url, 'utf8').split('\n').length;
}

test('handoff stays at or under its cap', () => {
  const n = lines(new URL('../docs/next-session-handoff.md', import.meta.url));
  assert.ok(
    n <= 151,
    `handoff is ${n} lines, cap is 150 - spent detail belongs in git history, not in docs/`
  );
});

test('project-context stays at or under its cap', () => {
  const n = lines(new URL('../docs/project-context.md', import.meta.url));
  assert.ok(
    n <= 121,
    `project-context is ${n} lines, cap is 120 - spent detail belongs in git history, not in docs/`
  );
});
