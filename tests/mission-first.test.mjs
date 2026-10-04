// Last edited: 2026-10-04 17:52. Title: mission-first.test — The failure this exists for is real and recent: sixteen consecutive commits Now: mission-first AGENTS.md (owner-ordered).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Mission-first (2026-10-04, owner-ordered).
//
// The failure this exists for is real and recent: sixteen consecutive commits
// shipped docs, tests and governance while the runtime code — the actual
// product — went untouched. A directives file that opens with commands and
// rules reads as process, not purpose, so sessions drift into whatever is
// cheapest to change. The mission has to be the first thing an agent reads,
// because AGENTS.md is the only channel guaranteed read.

const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('AGENTS.md opens with the mission: runtime code is the product', () => {
  assert.match(agents, /## Mission/);
  assert.match(agents, /runtime code is the product/);
});

test('docs and tests are support, never the task', () => {
  assert.match(agents, /Docs and tests support them — never the task/);
});

test('a session that ships no runtime change must justify it', () => {
  assert.match(agents, /ships no runtime change/);
});

test('the mission names the runtime areas concretely', () => {
  assert.match(agents, /`extension\/`/, 'the mission must name extension/');
  assert.match(agents, /`lib\/`/, 'the mission must name lib/');
  assert.match(agents, /`supabase\/functions\/`/, 'the mission must name supabase/functions/');
});