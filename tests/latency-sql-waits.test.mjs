import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { readSqlRamp, countPolls } from './helpers/pull-cadence-sim.mjs';

// Phase B Task 3 (2026-10-02): SQL-side corrections found during Phase B.
//
// Four items, all in one migration, none of which changes a response contract:
//
// 1. `expires_at` is computed at enqueue, so the time a command spends queued is
//    charged against its own execution budget. `opera_claim_next` sweeps any
//    `queued`/`claimed` row whose `expires_at` has passed into `expired`, and
//    `opera_complete_command` refuses to complete anything that is not
//    `claimed` or `queued`. So a command enqueued while the device was offline,
//    claimed on reconnect with almost no budget left, could be flipped to
//    `expired` by the very next poll while the extension was still working on
//    it -- and its result then rejected. The claim now restarts the clock.
//
// 2. `opera_watch_events_wait` spins at a flat 5ms for up to 32 seconds, which
//    Phase A measured at 6400 loop iterations per full-length call.
//
// 3. `created_at` defaults to `now()`, which in Postgres is
//    `transaction_timestamp()`: constant for the whole transaction. The claim
//    orders by it, so rows inserted together have a non-deterministic order.
//
// 4. `opera_run_fast` is dead code that cannot work: it enqueues and awaits in one
//    transaction, so the INSERT is invisible to the claimer until commit and the
//    wait always times out. It is granted to service_role, so it is a live trap.

const MIGRATION_URL = new URL(
  '../supabase/migrations/20261003110000_opera_agent_claim_budget_and_wait_ramp.sql',
  import.meta.url
);
const migration = fs.existsSync(MIGRATION_URL) ? fs.readFileSync(MIGRATION_URL, 'utf8') : null;

const RESTORE_URL = new URL(
  '../supabase/migrations/20261004090000_opera_agent_restore_run_fast.sql',
  import.meta.url
);

const core = fs.readFileSync(
  new URL('../supabase/migrations/20260907204146_opera_agent_1_0_0_core.sql', import.meta.url),
  'utf8'
);
const etw = fs.readFileSync(
  new URL('../supabase/migrations/20260922000000_opera_agent_ut_etw.sql', import.meta.url),
  'utf8'
);

function latest(sql, needle) {
  return sql.includes(needle) ? sql : null;
}

function redefine(sql, fnName) {
  const start = sql.indexOf(`create or replace function public.${fnName}(`);
  if (start < 0) return null;
  const end = sql.indexOf('end $$;', start);
  assert.ok(end > start, `${fnName} must be a complete definition`);
  return sql.slice(start, end + 'end $$;'.length);
}

// --- 1. the execution budget starts when the command is claimed -------------

test('the migration exists', () => {
  assert.ok(migration, '20261003110000_opera_agent_claim_budget_and_wait_ramp.sql must exist');
});

test('the claim restarts expires_at so queue wait is not charged to execution', () => {
  assert.ok(migration);
  const claim = redefine(migration, 'opera_claim_next');
  assert.ok(claim, 'opera_claim_next must be redefined');
  assert.match(claim, /expires_at\s*=\s*clock_timestamp\(\)\s*\+\s*make_interval\(secs=>\(v_cmd\.timeout_ms\/1000\.0\)\+5\)/);
  // claimed_at must move with it so the two clocks agree.
  assert.match(claim, /claimed_at=clock_timestamp\(\)/);
});

test('enqueue keeps an expiry so a command nobody ever claims is still swept', () => {
  assert.ok(migration);
  const enqueue = redefine(migration, 'opera_enqueue');
  assert.ok(enqueue, 'opera_enqueue must be redefined');
  // In an INSERT the column is named in the column list and the value supplied
  // in VALUES, so this is not an `expires_at =` assignment.
  const insert = enqueue.split('\n').find((line) => line.includes('insert into public.opera_commands'));
  assert.ok(insert, 'opera_enqueue must still insert a command row');
  assert.match(insert, /status,timeout_ms,expires_at\)/);
  assert.match(insert, /clock_timestamp\(\)\+make_interval\(secs=>\(v_timeout\/1000\.0\)\+5\)/);
  // A "never claimed" deadline is still bounded, not unbounded.
  assert.doesNotMatch(insert, /expires_at\) values\([^)]*infinity/i);
});

test('both claim paths set the budget, including the server-side wait', () => {
  assert.ok(migration);
  const wait = redefine(migration, 'opera_claim_next_wait');
  assert.ok(wait, 'opera_claim_next_wait must be redefined too');
  assert.match(wait, /expires_at=clock_timestamp\(\)\+make_interval\(secs=>\(v_cmd\.timeout_ms\/1000\.0\)\+5\)/);
});

test('the claim predicate still excludes expired rows', () => {
  assert.ok(migration);
  for (const fn of ['opera_claim_next', 'opera_claim_next_wait']) {
    const body = redefine(migration, fn);
    assert.match(body, /status='queued' and expires_at>now\(\)/, `${fn} must still filter by expiry`);
  }
});

// --- 2. the watch wait gets a ramp ----------------------------------------

test('opera_watch_events_wait uses an adaptive ramp instead of a flat 5ms', () => {
  assert.ok(migration);
  const body = redefine(migration, 'opera_watch_events_wait');
  assert.ok(body, 'opera_watch_events_wait must be redefined');
  const ramp = readSqlRamp(body);
  assert.ok(ramp, 'the watch wait must use a pg_sleep ramp');
  assert.deepEqual(ramp, [
    { upto: 4, seconds: 0.005 },
    { upto: 8, seconds: 0.01 },
    { upto: 10, seconds: 0.02 },
    { upto: Infinity, seconds: 0.05 }
  ]);
});

test('MEASURED: the watch wait drops from 6400 iterations to 648 for a 32s call', () => {
  assert.ok(migration);
  const ramp = readSqlRamp(redefine(migration, 'opera_watch_events_wait'));
  const after = countPolls(ramp, 32000);
  const before = countPolls([{ upto: Infinity, seconds: 0.005 }], 32000);
  assert.equal(before, 6400, 'the flat 5ms figure Phase A recorded');
  assert.equal(after, 648);
  assert.ok(before / after > 9, `expected a ~10x reduction, got ${(before / after).toFixed(1)}x`);
});

test('the first 100ms of a watch wait stays as fine as it was', () => {
  assert.ok(migration);
  const ramp = readSqlRamp(redefine(migration, 'opera_watch_events_wait'));
  assert.equal(countPolls(ramp, 100), 10);
  // A watch fires in response to start_watch, so the opening window is the one
  // that matters; the coarse tail is where the cost was.
  assert.equal(ramp[0].seconds, 0.005);
});

test('the watch wait still returns events immediately when one exists', () => {
  assert.ok(migration);
  const body = redefine(migration, 'opera_watch_events_wait');
  // The check must stay before the sleep, and the deadline check must stay.
  const checkAt = body.indexOf('jsonb_array_length(v_rows) > 0');
  const sleepAt = body.indexOf('perform pg_sleep');
  assert.ok(checkAt > 0 && sleepAt > checkAt, 'rows must be checked before sleeping');
  assert.match(body, /if clock_timestamp\(\) >= v_deadline then/);
});

// --- 3. created_at orders deterministically --------------------------------

test('created_at defaults to clock_timestamp, not now()', () => {
  assert.ok(migration);
  assert.match(migration, /alter\s+column\s+created_at\s+set\s+default\s+clock_timestamp\(\)/);
  assert.doesNotMatch(migration, /alter\s+column\s+created_at\s+set\s+default\s+now\(\)/);
});

test('the core migration still shows the historical now() default', () => {
  // History is not rewritten: the alter is additive and the old definition stays
  // on record so the change is auditable.
  assert.match(core, /created_at timestamptz not null default now\(\)/);
});

test('the queue index still serves the claim ordering', () => {
  assert.match(core, /opera_commands_queue_idx on public\.opera_commands\(device_id,status,created_at\)/);
});

// --- 4. the dead trap is removed ------------------------------------------

// Corrected 2026-10-03 after an owner review of what Phase B actually removed.
// opera_run_fast was dropped on the reasoning that a dead, service_role-granted
// function is a trap. It was not a caller and nothing broke either way, so the
// drop was a preference rather than a requirement -- and removing pre-existing
// code that this work did not create is an owner decision, not an
// implementation detail. The drop was reverted in
// 20261004090000_opera_agent_restore_run_fast.sql; the function is documented as
// non-functional instead, which changes no behavior and keeps the warning
// without discarding someone else's artifact.
test('opera_run_fast is not dropped, and a later migration restores it', () => {
  const restore = fs.existsSync(RESTORE_URL) ? fs.readFileSync(RESTORE_URL, 'utf8') : null;
  assert.ok(restore, '20261004090000_opera_agent_restore_run_fast.sql must exist');
  assert.match(restore, /create or replace function public\.opera_run_fast\(/i);
  // It is granted again, because the grant is part of the pre-existing surface.
  assert.match(restore, /grant execute on function public\.opera_run_fast\(text,jsonb,integer,text,text\) to service_role;/);
  // And the defect that makes it non-functional is recorded rather than removed.
  assert.match(restore, /cannot work|not visible until|always times out/i);
});

test('the drop still exists in history, so the reversion is auditable', () => {
  assert.match(migration, /drop\s+function\s+(if\s+exists\s+)?public\.opera_run_fast\(/i);
  assert.doesNotMatch(migration, /grant execute on function public\.opera_run_fast/i);
});

test('the drop is reversible because the definition stays in history', () => {
  assert.ok(latest(etw, 'create or replace function public.opera_run_fast('));
  assert.match(etw, /grant execute on function public\.opera_run_fast\(text,jsonb,integer,text,text\) to service_role;/);
});

test('no migration drops a table', () => {
  assert.ok(migration);
  assert.doesNotMatch(migration, /drop\s+table/i);
});

test('nothing in the runtime still calls opera_run_fast', () => {
  for (const file of [
    '../supabase/functions/opera-agent-gateway/index.ts',
    '../supabase/functions/opera-agent-mcp/index.ts',
    '../supabase/functions/opera-agent-bridge/index.ts',
    '../supabase/functions/opera-agent-runner/index.ts',
    '../supabase/functions/opera-agent-vm/index.ts'
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /opera_run_fast/, `${file} must not call opera_run_fast`);
  }
});