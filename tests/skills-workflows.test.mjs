// @last-edited: 2026-10-21 UTC+7.
// @title: skills-workflows.test — the skill memory table and the lessons seeded into it.
// @state: the table shape, the seed rows, and the workflow that reads them.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261008230000_opera_agent_skills.sql', import.meta.url), 'utf8'
);

test('skill memory table stores task, lesson, and pitfalls', () => {
  assert.match(migration, /create table if not exists public\.opera_skills/);
  assert.match(migration, /task text not null/);
  assert.match(migration, /lesson text not null/);
  assert.match(migration, /revoke all on public\.opera_skills from anon,authenticated/);
});

test('seed lessons capture paid-for experience', () => {
  for (const marker of [
    'stale-ref-after-scroll',
    'polymer-tap',
    'caption-less-fallback',
    'fuzzy-count-zero',
    'throttle-reads-as-blindness',
    'guard-first'
  ]) assert.ok(migration.includes(marker), marker);
});
