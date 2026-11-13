// @last-edited: 2026-11-10 UTC+7.
// @title: task-bar - the suite witnesses, the objective decides.
// @state: the hub carries the task-shaped completion rule, so a green suite can never stand in for the job done.
// @dependencies: node:test, node:assert, node:fs.

// WHY THIS GATE EXISTS: the owner's ruling - every job is tested by its job, never by the suite's green; a website means reading the structure, fixing the weakness and seeing the page; a bug fix means reproducing, fixing and driving the artefact.
// A constitution nobody can edit silently is a gate; the hub is the file that carries the rule, so the rule is what this locks.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the hub binds every job to its own verdict, not to the suite', () => {
  const hub = fs.readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
  for (const sentinel of [/Test the work by the work/, /never by the suite/, /the objective reached is the verdict/]) {
    assert.match(hub, sentinel, `AGENTS.md carries ${sentinel}`);
  }
});
