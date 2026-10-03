import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Claims and evidence (2026-10-04, owner-ordered audit).
//
// Hallucination here is asserting repository state that was never verified:
// "CI is green", "the migration is applied", "the function exists". Every one
// of those is checkable in seconds, and a confident wrong answer is worse than
// an admitted gap because the owner stops looking.
//
// These rules are behavioural and cannot be locked by a test on the agent, so
// what is locked here is that AGENTS.md states them at all — the same
// judgement used for the karpathy-core lock.

const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('AGENTS.md has a claims-and-evidence section', () => {
  assert.match(agents, /## Claims and evidence/);
});

test('a repository-state claim must cite a file:line or a command that ran', () => {
  assert.match(agents, /cites? `path:line`/);
  assert.match(agents, /command you ran/);
});

test('comments, commit messages and prior docs are leads, not evidence', () => {
  assert.match(agents, /comment, commit message, or older doc is a lead/);
});

test('an unverified answer must be marked as unverified', () => {
  assert.match(agents, /say it is unverified/);
});

test('absence is reported as absence, never as nonexistence', () => {
  assert.match(agents, /"not found" is reported as not found/);
  assert.match(agents, /never proof it does not exist/);
});