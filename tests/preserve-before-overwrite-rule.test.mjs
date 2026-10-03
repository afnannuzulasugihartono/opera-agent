import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The "mention, do not delete" rule. AGENTS.md states it in prose; locking that
// prose proved nothing, because a lock only proves something when it has a real
// referent outside the file. The two tests below do: the restore migration, and
// the latency test that now demands the restore instead of the drop.

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
    new URL('./latency-surface.test.mjs', import.meta.url),
    'utf8'
  );
  assert.match(waits, /opera_run_fast is not dropped, and a later migration restores it/);
  // And it still records the original mistake, so the reversion stays auditable.
  assert.match(waits, /the drop still exists in history/);
});
