// @last-edited: 2026-10-08 UTC+7.
// @title: ephemeral-workflows.test — Test.
// @state: locks the ephemeral lifecycle migration: prefix guard, quota, sweep, grants.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261009000000_opera_agent_ephemeral_workflows.sql', import.meta.url), 'utf8'
);

test('lifecycle columns, functions, and prefix guard exist', () => {
  assert.match(migration, /add column if not exists ephemeral/);
  assert.match(migration, /add column if not exists lease_until/);
  assert.match(migration, /add column if not exists request_id/);
  for (const fn of ['opera_register_ephemeral_workflow', 'opera_delete_workflow', 'opera_sweep_ephemeral_workflows']) {
    assert.ok(migration.includes(fn), fn);
  }
  assert.ok(migration.includes('adhoc.'));
  assert.ok(migration.includes('PERMANENT_DELETE_REFUSED'));
  assert.ok(migration.includes('RATE_LIMITED'));
  assert.ok(migration.includes('if p_definition is null'));
});

test('grants are EXECUTE to service_role only', () => {
  assert.doesNotMatch(migration, /grant\s+\S+\s+on\s+function\s+public\.opera_(register_ephemeral_workflow|delete_workflow|sweep_ephemeral_workflows)[^;]*\b(authenticated|anon|public)\b/i);
  for (const fn of ['opera_register_ephemeral_workflow', 'opera_delete_workflow', 'opera_sweep_ephemeral_workflows']) {
    assert.ok(migration.includes(`grant execute on function public.${fn}`), fn);
  }
});

test('request_id reuse with a different definition is refused, not silently shared', () => {
  // WHY this pin: the first version returned the existing row for any caller
  // reusing a request_id, so two different adhoc graphs under one key silently
  // ran the first caller's workflow. Same definition stays idempotent; a
  // mismatch is an explicit conflict (surfaced by runAdhoc as
  // REQUEST_ID_CONFLICT) so the caller retries with a fresh key. Both return
  // paths — the fast select and the unique_violation race Retry — compare.
  const hits = migration.match(/v_existing\.definition is distinct from p_definition/g) || [];
  assert.equal(hits.length, 2, 'both the fast path and the race retry must compare definitions');
  assert.ok(migration.includes('REQUEST_ID_CONFLICT'));
});
