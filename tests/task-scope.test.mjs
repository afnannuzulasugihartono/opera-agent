import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Task scope (2026-10-04, owner-ordered): the repo is ~0.94M tokens, about one
// full 1M context window, and docs+tests are two thirds of it. An agent that
// reads broadly drowns and hallucinates. So each task declares one area and
// the diff must stay inside it — scope is checkable on the diff even though
// reading behavior itself is not observable.

const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('AGENTS.md declares one task, one area', () => {
  assert.match(agents, /## Task scope/);
  assert.match(agents, /declare scope.*diff stays inside it/);
});

test('AGENTS.md forbids whole-file reads of large files', () => {
  assert.match(agents, /never read fully/);
});

test('spec work stays in spec, code changes get their own task', () => {
  assert.match(agents, /Spec work touches spec/);
});
