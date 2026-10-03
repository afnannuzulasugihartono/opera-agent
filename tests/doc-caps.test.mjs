import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Doc caps (2026-10-03, owner-ordered): live context files stay short or the
// haystack regrows. Counts are lines including the trailing-newline artifact,
// so a 150-line file reads as 151 here — caps carry 1 line of slack.

function lines(url) {
  return fs.readFileSync(url, 'utf8').split('\n').length;
}

test('handoff stays at or under its cap', () => {
  const n = lines(new URL('../docs/next-session-handoff.md', import.meta.url));
  assert.ok(
    n <= 151,
    `handoff is ${n} lines, cap is 150 — relocate spent detail to docs/context-archive.md`
  );
});

test('project-context stays at or under its cap', () => {
  const n = lines(new URL('../docs/project-context.md', import.meta.url));
  assert.ok(
    n <= 121,
    `project-context is ${n} lines, cap is 120 — relocate spent detail to docs/context-archive.md`
  );
});
