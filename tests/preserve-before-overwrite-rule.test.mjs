import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The "mention, do not delete" rule (2026-10-03).
//
// This was not a new idea imported from outside. It closed a real gap in an
// existing rule: "preserve before overwrite" covered overwriting work, and said
// nothing about *discovering* something unusable. `opera_run_fast` was dropped
// and then locked in a test on 2026-10-02, and restored on 2026-10-03 only
// because somebody reviewed what had actually been removed.
//
// A rule written after being violated is only worth something if it is made
// checkable. This file pins the rule's text and, more importantly, its two
// escape hatches — because a rule with no permitted exception gets worked around
// rather than followed, and this repository already needs the distinction:
// removing a constant that this commit's own logic supersedes is correct, and
// removing a pre-existing function nobody called is not.

const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('the preserve rule covers discovery, not only overwriting', () => {
  assert.match(agents, /Preserve before overwrite/);
  assert.match(agents, /Mention, do not delete, pre-existing code this work did not create/);
  // The gap that let the violation through: the old rule only spoke about
  // overwriting, never about finding something unusable.
  assert.match(agents, /report to the owner/, 'the rule must require reporting, not tidying');
});

test('the rule distinguishes required removal from optional removal', () => {
  // Without this exception the rule is not followable: removing a superseded
  // constant IS required when the commit's own logic replaces it.
  assert.match(agents, /Removing it \*is\* allowed when the removal is \*\*required\*\*/);
  assert.match(agents, /Say which of the two it is, in the commit message/);
});

test('the rule forbids locking a removal in a test', () => {
  // This is the specific mechanism that made the violation irreversible.
  assert.match(agents, /Never lock a removal in a test/);
  assert.match(agents, /converts a preference into an irreversible decision/);
});

test('the rule names the incident so it is not an abstract caution', () => {
  assert.match(agents, /opera_run_fast/);
  assert.match(agents, /was still violated/);
});

test('the rule sits inside the preserve rule, not as a separate section', () => {
  const start = agents.indexOf('6. **Preserve before overwrite.**');
  const end = agents.indexOf('7. **Acceptance basis is CI evidence.**');
  assert.ok(start >= 0 && end > start, 'both rule anchors must exist');
  const section = agents.slice(start, end);
  // If it were a free-standing section it would read as optional advice rather
  // than as part of a rule that is already binding.
  assert.doesNotMatch(section, /^#{2,3} /m, 'the addition must not become its own heading');
  assert.match(section, /Mention, do not delete/);
});

test('the acceptance-basis rule is untouched', () => {
  // The addition must not have displaced rule 7 or weakened it.
  assert.match(agents, /7\. \*\*Acceptance basis is CI evidence\.\*\*/);
  assert.match(agents, /never granted by CI green alone/);
});

test('the restore migration still exists, so the rule has a real referent', () => {
  const restore = new URL(
    '../supabase/migrations/20261004090000_opera_agent_restore_run_fast.sql',
    import.meta.url
  );
  assert.ok(fs.existsSync(restore), 'the restore migration must exist');
  const sql = fs.readFileSync(restore, 'utf8');
  // The phrase spans a line wrap, so match the clause rather than the whole
  // sentence: this was an owner decision, not an implementation detail.
  assert.match(sql, /artifact is an owner decision rather than an\s+-- implementation detail/);
  assert.match(sql, /create or replace function public\.opera_run_fast\(/);
});

test('the test that used to demand the drop now demands the restore', () => {
  const waits = fs.readFileSync(
    new URL('./latency-sql-waits.test.mjs', import.meta.url),
    'utf8'
  );
  assert.match(waits, /opera_run_fast is not dropped, and a later migration restores it/);
  // And it still records the original mistake, so the reversion stays auditable.
  assert.match(waits, /the drop still exists in history/);
});