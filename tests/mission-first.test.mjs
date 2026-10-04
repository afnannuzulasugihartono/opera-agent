// @last-edited: 2026-10-04 23:36 UTC+7.
// @title: mission-first.test — Test..
// @state: The mission says runtime code is the product; the assertions bind meaning, not prose.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Mission-first (2026-10-04, owner-ordered).
//
// The failure this exists for is real and recent: sixteen consecutive commits
// shipped docs, tests and governance while the runtime code — the actual
// product — went untouched. AGENTS.md is the only channel guaranteed read, so it
// opens with the standing instructions, the Goals and then the Mission.
//
// WHY these assertions are phrases and not whole sentences. The owner asked for
// the Mission to be denser, and a lock on exact prose cannot survive that: it
// fails on wording, not on meaning. Each assertion below still fails if the rule
// it names is gone or reversed.

const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('AGENTS.md opens with the mission: runtime code is the product', () => {
  assert.match(agents, /## Mission/);
  assert.match(agents, /runtime code is the product/);
});

test('docs and tests are support, never the task', () => {
  assert.match(agents, /[Dd]ocs and tests (are )?support/);
  assert.match(agents, /never the task/);
});

test('a session that ships no runtime change must justify it', () => {
  assert.match(agents, /no runtime (change|code)/);
  assert.match(agents, /justify it/);
});

test('the mission names the runtime areas concretely', () => {
  assert.match(agents, /`extension\/`/, 'the mission must name extension/');
  assert.match(agents, /`lib\/`/, 'the mission must name lib/');
  assert.match(agents, /`supabase\/functions\/`/, 'the mission must name supabase/functions/');
});