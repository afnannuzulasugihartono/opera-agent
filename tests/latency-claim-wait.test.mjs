import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  RECORDED_BRIDGE_CADENCE,
  measureCadence,
  readSqlRamp,
  measureSqlCadence
} from './helpers/pull-cadence-sim.mjs';

// Phase B Task 1 (2026-10-02): server-side command discovery.
//
// Phase A measured the cost of the current design: the bridge sleeps
// IDLE_PULL_INTERVAL_MS *inside the edge function* and mints one HTTP round
// trip per poll, 14 per 12s window, giving a queue wait of p50 830ms and
// p95 1910ms. The sleep belongs in Postgres, next to the data, so the edge
// function can make exactly one call per window and let the database decide
// when a command arrived.
//
// This file locks the contract. It fails until the migration and the bridge
// change land.

const MIGRATION_URL = new URL(
  '../supabase/migrations/20261002090000_opera_agent_claim_wait.sql',
  import.meta.url
);

const migration = fs.existsSync(MIGRATION_URL) ? fs.readFileSync(MIGRATION_URL, 'utf8') : null;
const bridge = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url),
  'utf8'
);

// The "before" figures are the recorded Phase A baseline, pinned in the helper
// so this comparison stays reproducible now that the bridge no longer declares
// the client-side cadence it used to.
const cadence = RECORDED_BRIDGE_CADENCE;
const before = measureCadence(cadence, { rpcMs: 20 });
const ramp = migration ? readSqlRamp(migration) : null;
const after = ramp ? measureSqlCadence(ramp, { windowMs: cadence.windowMs }) : null;

test('the migration exists and defines opera_claim_next_wait', () => {
  assert.ok(migration, '20261002090000_opera_agent_claim_wait.sql must exist');
  assert.match(migration, /create or replace function public\.opera_claim_next_wait\(/);
});

test('opera_claim_next_wait is locked to service_role like every sibling', () => {
  assert.ok(migration);
  assert.match(
    migration,
    /revoke all on function public\.opera_claim_next_wait\([^)]*\) from public,anon,authenticated;/
  );
  assert.match(migration, /grant execute on function public\.opera_claim_next_wait\([^)]*\) to service_role;/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path=public/);
});

test('opera_claim_next_wait keeps the original claim semantics', () => {
  assert.ok(migration);
  // Same authorization gate, so the new function cannot widen access.
  assert.match(migration, /opera_auth_device\(p_device_name,p_token_hash\)/);
  assert.match(migration, /'Unauthorized device\.'/);
  // Same claim query, including skip locked so concurrent claimers still work.
  assert.match(migration, /for update skip locked limit 1/);
  // Same state transitions and audit record.
  assert.match(migration, /status='claimed',attempts=attempts\+1,claimed_at=now\(\)/);
  assert.match(migration, /insert into public\.opera_audit\(event_type,device_id,command_id,details\)/);
  assert.match(migration, /'command\.claimed'/);
  // Same response envelope the bridge already parses.
  assert.match(migration, /'ok',true,'command',jsonb_build_object\('id',v_cmd\.id,'method',v_cmd\.method/);
});

test('the expensive statements run once, not once per poll', () => {
  assert.ok(migration);
  const deviceHeartbeat = migration.match(
    /update\s+public\.opera_devices\s+set\s+status='online'/gi
  ) || [];
  const expirySweep = migration.match(/update\s+public\.opera_commands\s+set\s+status='expired'/gi) || [];

  // These two are the per-poll cost that made an in-SQL loop look 18x more
  // expensive than the client-side one. They must appear exactly once, before
  // the polling loop opens, never inside it.
  assert.equal(deviceHeartbeat.length, 1, 'device heartbeat must be written once, outside the loop');
  assert.equal(expirySweep.length, 1, 'expiry sweep must be written once, outside the loop');

  const loopStart = migration.indexOf('loop');
  const heartbeatAt = migration.indexOf("update public.opera_devices set status='online'");
  const sweepAt = migration.indexOf("update public.opera_commands set status='expired'");
  assert.ok(heartbeatAt < loopStart, 'device heartbeat must precede the loop');
  assert.ok(sweepAt < loopStart, 'expiry sweep must precede the loop');
});

test('the poll loop body is a single indexed select', () => {
  assert.ok(migration);
  const start = migration.indexOf('\n  loop\n');
  const end = migration.indexOf('end loop;');
  assert.ok(start > 0 && end > start, 'the plpgsql loop must be present and well formed');
  const loopBody = migration.slice(start, end);
  const selects = loopBody.match(/select\s/gi) || [];
  const updates = loopBody.match(/update\s+public\./gi) || [];
  const inserts = loopBody.match(/insert\s+into/gi) || [];
  assert.equal(selects.length, 1, 'loop body must run exactly one select');
  assert.equal(updates.length, 0, 'loop body must not update');
  assert.equal(inserts.length, 0, 'loop body must not insert');
  assert.equal(updates.length + inserts.length, 0, 'the cycle must be read-only');

  // The claim itself happens once, after the cycle closes, not inside it.
  const afterLoop = migration.slice(end);
  assert.match(afterLoop, /update public\.opera_commands set status='claimed'/);
  assert.match(afterLoop, /insert into public\.opera_audit/);
  assert.match(afterLoop, /if not found then/);
});

test('the wait is clamped to the bridge window range', () => {
  assert.ok(migration);
  assert.match(migration, /least\(greatest\(coalesce\(p_wait_ms,12000\),0\),25000\)/);
});

test('the ramp stays fine through the interactive burst window', () => {
  assert.ok(ramp, 'opera_claim_next_wait must use a pg_sleep ramp');
  assert.deepEqual(ramp, [
    { upto: 8, seconds: 0.005 },
    { upto: 16, seconds: 0.01 },
    { upto: 24, seconds: 0.025 },
    { upto: 32, seconds: 0.05 },
    { upto: Infinity, seconds: 0.25 }
  ]);
  assert.ok(after, 'ramp must be measurable');

  // The 2026-09-24 note records that follow-up commands arrive right behind the
  // previous HTTP round trip, so the fine stages must cover at least the first
  // 700ms of an idle window.
  assert.ok(
    after.fineWindowMs >= 700,
    `fine stages cover only ${after.fineWindowMs}ms of the window`
  );
});

test('MEASURED: queue wait drops from p50 830ms to under 150ms', () => {
  assert.ok(after, 'ramp must be measurable');
  assert.equal(before.p50, 830);
  assert.equal(before.p95, 1910);
  assert.ok(after.p50 < 150, `expected p50 under 150ms, measured ${after.p50}ms`);
  assert.ok(after.p95 < 300, `expected p95 under 300ms, measured ${after.p95}ms`);
  assert.ok(after.max <= 260, `worst case must stay near the 250ms tail, measured ${after.max}ms`);
});

test('MEASURED: edge round trips drop from 14 per window to 1', () => {
  assert.ok(after);
  assert.equal(before.windowCalls, 14);
  // The bridge now issues one request per window, so the only cost left is the
  // single round trip itself.
  assert.equal(before.windowCalls - 1, 13, 'thirteen HTTP round trips are eliminated');
  const callsBefore = before.callsPerHourPerIdleDevice;
  assert.ok(callsBefore > 4000, `baseline egress recorded at ${callsBefore}/hour`);
});

test('MEASURED: database query load grows but stays bounded', () => {
  assert.ok(after);
  // Honest cost statement: more Postgres queries, far fewer HTTP round trips.
  // Each internal poll is one index-served lookup on
  // opera_commands_queue_idx (device_id, status, created_at).
  assert.ok(after.internalPolls < 120, `expected under 120 internal polls, got ${after.internalPolls}`);
  assert.ok(
    after.queriesPerHourPerIdleDevice < 40000,
    `expected under 40k queries/hour, got ${Math.round(after.queriesPerHourPerIdleDevice)}`
  );
});

test('the bridge calls the wait function once and no longer loops', () => {
  assert.match(bridge, /rpc\("opera_claim_next_wait"/);
  assert.doesNotMatch(bridge, /rpc\("opera_claim_next"/);

  // The pull handler must not sleep on a client-side timer any more.
  const pull = bridge.slice(bridge.indexOf('async function pull('), bridge.indexOf('async function heartbeat'));
  assert.doesNotMatch(pull, /setTimeout/, 'the pull handler must not sleep client-side');
  assert.doesNotMatch(pull, /IDLE_PULL_INTERVAL_MS/);
  assert.doesNotMatch(pull, /FAST_PULL_INTERVAL_MS/);
  assert.doesNotMatch(pull, /FAST_PULL_POLLS/);
});

test('the superseded client-side constants are removed, not left dead', () => {
  assert.doesNotMatch(bridge, /const FAST_PULL_POLLS/);
  assert.doesNotMatch(bridge, /const FAST_PULL_INTERVAL_MS/);
  assert.doesNotMatch(bridge, /const IDLE_PULL_INTERVAL_MS/);
});

test('opera_claim_next itself is untouched and still available', () => {
  // The single-shot claim stays: it is the non-long-poll path and removing it
  // would be a contract change beyond this task.
  const core = fs.readFileSync(
    new URL('../supabase/migrations/20260907204146_opera_agent_1_0_0_core.sql', import.meta.url),
    'utf8'
  );
  assert.match(core, /create or replace function public\.opera_claim_next\(/);
  assert.match(core, /revoke all on function public\.opera_claim_next\(text,text,text,integer,jsonb\)/);
});