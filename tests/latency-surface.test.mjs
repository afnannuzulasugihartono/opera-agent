// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: latency-surface.test — surface.test — Test.
// @context: Test.
// @state: latency-surface comments state what is true now.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: node:test, strict, node:fs, protocol, pull-cadence-sim.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  METHOD_SPECS,
  BURST_ACTION_METHODS,
  BURST_MAX_STEPS,
  BURST_MAX_TIMEOUT_MS
} from '../extension/lib/protocol.js';
import {
  readCadenceConstants,
  measureCadence,
  pollIssueTimes,
  claimWaitMs,
  percentile,
  readSqlRamp,
  countPolls,
  measureSqlCadence,
  RECORDED_BRIDGE_CADENCE
} from './helpers/pull-cadence-sim.mjs';

// Latency surface: every figure is a clock-injected model of the server +
// extension path, never an observation of a model loop. Real round-trip cost
// per task is unmeasured. Sections: A pg_sleep inventory, B client-side
// cadence, C server-side discovery, D claim-budget repair, E burst ceiling.

// --- shared reads ------------------------------------------------------------

const bridge = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-bridge/index.ts', import.meta.url),
  'utf8'
);
const core = fs.readFileSync(
  new URL('../supabase/migrations/20260907204146_opera_agent_1_0_0_core.sql', import.meta.url),
  'utf8'
);
const etw = fs.readFileSync(
  new URL('../supabase/migrations/20260922000000_opera_agent_ut_etw.sql', import.meta.url),
  'utf8'
);

// Phase B Task 1: the sleep moved into Postgres, so one HTTP call per window.

const claimWaitUrl = new URL(
  '../supabase/migrations/20261002090000_opera_agent_claim_wait.sql',
  import.meta.url
);
const claimWaitSql = fs.existsSync(claimWaitUrl) ? fs.readFileSync(claimWaitUrl, 'utf8') : null;

// Phase B Task 3: four SQL-side corrections, one migration.

const budgetRampUrl = new URL(
  '../supabase/migrations/20261003110000_opera_agent_claim_budget_and_wait_ramp.sql',
  import.meta.url
);
const budgetRamp = fs.existsSync(budgetRampUrl) ? fs.readFileSync(budgetRampUrl, 'utf8') : null;

const restoreRunFastUrl = new URL(
  '../supabase/migrations/20261004090000_opera_agent_restore_run_fast.sql',
  import.meta.url
);

// The bridge delegates this wait to Postgres, so "before" is measured from a
// recorded baseline, not live source. Pinned in
// tests/helpers/pull-cadence-sim.mjs to stay reproducible.

const recordedCadence = RECORDED_BRIDGE_CADENCE;

// Assumed cost of one `opera_claim_next` round trip. Reported at three values
// because the real figure is unmeasured; section B's conclusions hold across all.

const RPC_COSTS_MS = [10, 20, 50];

// Shared by B (what the old cadence cost) and C (what replaced it): identical
// deterministic model, defined once so the two cannot drift apart.

const clientSideBaseline = measureCadence(recordedCadence, { rpcMs: 20 });
const claimWaitRamp = claimWaitSql ? readSqlRamp(claimWaitSql) : null;
const serverSideCadence = claimWaitRamp
  ? measureSqlCadence(claimWaitRamp, { windowMs: recordedCadence.windowMs })
  : null;

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const migrationFiles = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const allSql = migrationFiles.map((name) => ({
  name,
  sql: fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
}));

/** Every `perform pg_sleep(...)` in the migrations, with its file and line. */
function allSleeps() {
  const found = [];
  for (const { name, sql } of allSql) {
    sql.split('\n').forEach((line, index) => {
      const match = line.match(/perform\s+pg_sleep\(([^;]*)\)/i);
      if (match) found.push({ file: name, line: index + 1, expr: match[1].trim() });
    });
  }
  return found;
}

/** The enclosing `create or replace function <name>` for a given line. */
function enclosingFunction(file, line) {
  const entry = allSql.find((m) => m.name === file);
  const lines = entry.sql.split('\n');
  for (let i = line - 1; i >= 0; i -= 1) {
    const match = lines[i].match(/create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)/i);
    if (match) return match[1];
  }
  return null;
}

/**
 * Parse a pg_sleep expression into a list of [pollUpperBound, seconds].
 * Handles both `pg_sleep(0.05)` and the adaptive
 * `pg_sleep(case when v_polls<=4 then 0.005 ... else 0.050 end)` form.
 */
function parseSchedule(expr) {
  const literal = expr.match(/^([0-9.]+)$/);
  if (literal) return [{ upto: Infinity, seconds: Number(literal[1]) }];
  const ramp = [...expr.matchAll(/v_polls\s*<=\s*(\d+)\s*then\s*([0-9.]+)/gi)].map(
    (m) => ({ upto: Number(m[1]), seconds: Number(m[2]) })
  );
  const tail = expr.match(/else\s+([0-9.]+)\s+end/i);
  if (ramp.length && tail) return [...ramp, { upto: Infinity, seconds: Number(tail[1]) }];
  return null;
}

/** Loop iterations needed to cover `budgetMs` of waiting at this schedule. */
function iterationsFor(schedule, budgetMs) {
  let elapsed = 0;
  let polls = 0;
  while (elapsed < budgetMs) {
    const step = schedule.find((s) => polls + 1 <= s.upto) || schedule[schedule.length - 1];
    elapsed += step.seconds * 1000;
    polls += 1;
    if (polls > 1_000_000) throw new Error('runaway schedule');
  }
  return polls;
}

/** Worst-case delay between a command completing and the loop noticing. */
function detectionLagMs(schedule) {
  return Math.max(...schedule.map((s) => s.seconds * 1000));
}

/** Finest granularity, which is what a fast command actually experiences. */
function finestMs(schedule) {
  return Math.min(...schedule.map((s) => s.seconds * 1000));
}

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

const sleeps = allSleeps();
const schedules = new Map();
for (const sleep of sleeps) {
  const fn = enclosingFunction(sleep.file, sleep.line);
  const schedule = parseSchedule(sleep.expr);
  if (fn && schedule) schedules.set(fn, { ...sleep, fn, schedule });
}

// Budgets are the clamped ceilings declared in each function, so the numbers
// are the worst case a caller can actually request.
const BUDGETS_MS = {
  opera_await: 55000,
  opera_await_capture: 32000,
  opera_await_workflow: 120000,
  opera_watch_events_wait: 32000,
  opera_await_adaptive: 55000
};

// --- A. the SQL wait inventory and what each loop costs ----------------------
//
// Every result wait in this system is a Postgres spin loop: `perform

// pg_sleep(...)` inside plpgsql, re-reading the command row until it settles.
// That design is CPU-cheap but it pins a pooled Postgres backend for the whole
// wait and re-executes a SELECT once per sleep.
//
// This section measures what each loop actually costs: how finely it can detect
// a completed command, and how many loop iterations a full-length wait burns.

test('all nine pg_sleep loops in the migrations are accounted for', () => {
  assert.equal(sleeps.length, 9, 'migration sleep count changed; update this record');
  assert.deepEqual(
    sleeps.map((s) => `${s.file.split('_')[0]}:${s.line}`),
    [
      '20260907204146:204',
      '20260907204221:212',
      '20260908031756:110',
      '20260910121107:110',
      '20260922000000:79',
      '20260922000000:104',
      '20261002090000:61',
      // The claim wait repeats here after the budget fix, and the watch wait
      // replaced its flat 5ms spin with a ramp.
      '20261003110000:112',
      '20261003110000:156'
    ]
  );
});

test('the new claim wait ramp is fine through the interactive burst window', () => {
  const entry = schedules.get('opera_claim_next_wait');
  assert.ok(entry, 'opera_claim_next_wait must be an inventory entry');
  assert.deepEqual(entry.schedule, [
    { upto: 8, seconds: 0.005 },
    { upto: 16, seconds: 0.01 },
    { upto: 24, seconds: 0.025 },
    { upto: 32, seconds: 0.05 },
    { upto: Infinity, seconds: 0.25 }
  ]);
  // The 5ms stages cover the first 40ms; the sub-50ms stages cover 720ms.
  assert.equal(finestMs(entry.schedule), 5);
  assert.equal(detectionLagMs(entry.schedule), 250);
});

test('MEASURED: opera_await burns 1100 iterations for a 55s wait at a flat 50ms', () => {
  const entry = schedules.get('opera_await');
  assert.ok(entry, 'opera_await must still be a spin loop');
  assert.equal(entry.schedule[0].seconds, 0.05);
  assert.equal(detectionLagMs(entry.schedule), 50);
  assert.equal(finestMs(entry.schedule), 50);
  assert.equal(iterationsFor(entry.schedule, BUDGETS_MS.opera_await), 1100);
});

test('MEASURED: opera_watch_events_wait dropped from 6400 iterations to 648', () => {
  // The flat 5ms figure is the recorded baseline the comparison reproduces
  // against; section D holds the repair and its own measurement of the same
  // transition.
  assert.equal(
    iterationsFor([{ upto: Infinity, seconds: 0.005 }], BUDGETS_MS.opera_watch_events_wait),
    6400,
    'the flat 5ms baseline Phase A recorded'
  );
  const entry = schedules.get('opera_watch_events_wait');
  assert.ok(entry, 'opera_watch_events_wait must still be a spin loop');
  assert.ok(entry.schedule.length > 1, 'the flat 5ms spin must no longer be live');
  assert.equal(finestMs(entry.schedule), 5);
  assert.equal(iterationsFor(entry.schedule, BUDGETS_MS.opera_watch_events_wait), 648);
});

test('MEASURED: the adaptive ramp detects a fast completion in 5ms, then settles at 50ms', () => {
  const entry = schedules.get('opera_await_adaptive');
  assert.ok(entry, 'opera_await_adaptive must still exist');
  assert.deepEqual(entry.schedule, [
    { upto: 4, seconds: 0.005 },
    { upto: 8, seconds: 0.01 },
    { upto: 10, seconds: 0.02 },
    { upto: Infinity, seconds: 0.05 }
  ]);
  assert.equal(finestMs(entry.schedule), 5);
  assert.equal(detectionLagMs(entry.schedule), 50);
  // 10 polls cover the first 100ms, then it coarsens.
  assert.equal(iterationsFor(entry.schedule, 100), 10);
});

test('MEASURED: adaptive and flat waits cost the same iterations but differ 10x in first-response', () => {
  const flat = schedules.get('opera_await');
  const adaptive = schedules.get('opera_await_adaptive');
  const flatIters = iterationsFor(flat.schedule, 32000);
  const adaptiveIters = iterationsFor(adaptive.schedule, 32000);
  // Same order of magnitude: swapping MCP onto the adaptive ramp is not a
  // database-cost change.
  assert.ok(Math.abs(flatIters - adaptiveIters) <= 20, `flat=${flatIters} adaptive=${adaptiveIters}`);
  // But the first response inside the first second is 10x finer.
  const flatFirst = flat.schedule[0].seconds * 1000;
  const adaptiveFirst = adaptive.schedule[0].seconds * 1000;
  assert.equal(flatFirst / adaptiveFirst, 10);
});

test('the watch wait now costs about the same as a 32s command wait', () => {
  // A flat 5ms is 10x finer than the command wait's flat 50ms. Both now ramp,
  // so they cost about the same.
  const watch = iterationsFor(schedules.get('opera_watch_events_wait').schedule, 32000);
  const command = iterationsFor(schedules.get('opera_await').schedule, 32000);
  assert.ok(watch / command < 1.2, `watch=${watch} command=${command}, expected them close`);
  assert.ok(watch < 700, `watch wait should now be well under 700 iterations, got ${watch}`);
});

test('the AI-facing MCP path uses the adaptive ramp, not the flat 50ms wait', () => {
  // The flat 50ms `opera_await` is the coarser of the two available waits. The
  // two share a signature and a response envelope, so the swap is
  // latency-only; see tests/mcp-surface.test.mjs for the contract-neutrality
  // proof.
  const mcp = fs.readFileSync(
    new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url),
    'utf8'
  );
  // Match the assignment, not the comment above it.
  const line = mcp.split('\n').find((l) => l.includes('const awaitFunction'));
  assert.ok(line, 'MCP must choose an await function');
  assert.match(line, /"opera_await_adaptive"/);
  assert.match(line, /page\.capture/);
  assert.doesNotMatch(line, /: "opera_await"/);
  // page.capture keeps its own wait because it rewrites the stored screenshot.
  assert.match(line, /"opera_await_capture"/);
  // The flat 50ms wait still exists and is still granted; it is simply no longer
  // on the AI's path.
  assert.match(core, /create or replace function public\.opera_await\(/);
  assert.match(core, /pg_sleep\(0\.05\)/);
  const gateway = fs.readFileSync(
    new URL('../supabase/functions/opera-agent-gateway/index.ts', import.meta.url),
    'utf8'
  );
  assert.match(gateway, /opera_await_adaptive/);
});

test('migration files stay append-only for this measurement work', () => {
  for (const { name, sql } of allSql) {
    assert.doesNotMatch(sql, /drop\s+table/i, `${name} must not drop tables`);
  }
  assert.ok(
    migrationFiles.every((n) => /^\d{14}_[a-z0-9_]+\.sql$/.test(n)),
    'every migration filename must keep its timestamp prefix convention'
  );
});

test('the full migration history was read, not a partial subset', () => {
  assert.ok(migrationFiles.length > 10, 'expected the full migration history to be present');
});

// --- B. the client-side cadence that the server-side wait replaced -----------
//
// Model: one idle device, permanently parked on a fresh 12s long-poll window,
// which is the steady state for interactive use. Clock-injected, no network,
// no real timers -- these are reproducible figures, not timing flakes. This is
// a model of the cadence, not a measurement against Supabase.

test('the recorded baseline matches the retired client-side constants', () => {
  assert.deepEqual(recordedCadence, {
    fastPolls: 8,
    fastIntervalMs: 50,
    idleIntervalMs: 2000,
    windowMs: 12000
  });
});

test('the bridge no longer carries a client-side cadence', () => {
  assert.equal(
    readCadenceConstants(bridge),
    null,
    'the bridge must not reintroduce FAST_PULL_*/IDLE_PULL_* constants'
  );
  assert.doesNotMatch(bridge, /FAST_PULL_|IDLE_PULL_/);
  assert.match(bridge, /opera_claim_next_wait/);
});

test('an idle device issues 14 claim calls per 12s window (4200/hour)', () => {
  for (const rpcMs of RPC_COSTS_MS) {
    const report = measureCadence(recordedCadence, { rpcMs });
    assert.equal(report.windowCalls, 14, `rpc=${rpcMs}ms should still yield 14 calls per window`);
    assert.equal(
      Math.round(report.callsPerHourPerIdleDevice),
      4200,
      `rpc=${rpcMs}ms should still yield 4200 claim calls per hour per idle device`
    );
  }
});

test('the fast window is 400ms of a 12000ms window, so ~97% of waits are idle-rate', () => {
  const report = measureCadence(recordedCadence, { rpcMs: 20 });
  assert.equal(report.fastWindowMs, 400);
  const fastShare = report.fastWindowMs / report.windowMs;
  assert.ok(fastShare < 0.04, `fast window is only ${(fastShare * 100).toFixed(1)}% of the window`);
});

test('MEASURED queue wait for a command: p50 ~830ms, p95 ~1910ms (rpc=20ms)', () => {
  const report = clientSideBaseline;
  // These are the recorded Phase A figures. If a cadence change moves them,
  // this test must be updated in the same commit with the new numbers and a
  // stated reason -- that is the point of recording them.
  assert.equal(report.p50, 830);
  assert.equal(report.p95, 1910);
  assert.ok(report.max <= 2100, 'worst case stays bounded by the idle interval');
});

test('the latency floor is insensitive to RPC cost: idle interval dominates', () => {
  const reports = RPC_COSTS_MS.map((rpcMs) => measureCadence(recordedCadence, { rpcMs }));
  const p50s = reports.map((r) => r.p50);
  const p95s = reports.map((r) => r.p95);
  assert.ok(Math.max(...p50s) - Math.min(...p50s) <= 100, 'p50 varies <=100ms across a 5x RPC cost range');
  assert.ok(Math.max(...p95s) - Math.min(...p95s) <= 100, 'p95 varies <=100ms across a 5x RPC cost range');
  for (const p95 of p95s) {
    assert.ok(p95 >= 1800, 'p95 stays near the 2000ms idle interval at every RPC cost');
  }
});

test('the documented egress figure describes the old 250ms loop, not today', () => {
  // The bridge comment records "~52 opera_claim_next calls (6x50ms + 250ms
  // loop), ~13k claims/hour/device" as the state that motivated the ramp.
  // It is a changelog entry describing the old 250ms loop, not a claim about
  // the current code. The "~52" is the instantaneous-poll bound; a real RPC
  // costs a few milliseconds each and mints slightly fewer calls.
  const oldCadence = { fastPolls: 6, fastIntervalMs: 50, idleIntervalMs: 250, windowMs: 12000 };
  const oldInstant = measureCadence(oldCadence, { rpcMs: 0 });
  const oldReal = measureCadence(oldCadence, { rpcMs: 20 });
  // Exact modelled counts: 53 with instantaneous polls, 49 with a 20ms RPC.
  // The comment's "~52" sits between them, so it is a fair approximation.
  assert.ok(
    oldInstant.windowCalls >= 51 && oldInstant.windowCalls <= 54,
    `zero-cost polls should reproduce the documented ~52, got ${oldInstant.windowCalls}`
  );
  assert.ok(
    oldReal.windowCalls >= 48 && oldReal.windowCalls <= 52,
    `real RPC cost should mint 48-52 calls, got ${oldReal.windowCalls}`
  );
  assert.ok(
    oldReal.callsPerHourPerIdleDevice > 14000,
    `old cadence should exceed 13k calls/hour, got ${Math.round(oldReal.callsPerHourPerIdleDevice)}`
  );

  const now = measureCadence(recordedCadence, { rpcMs: 20 });
  assert.ok(
    now.callsPerHourPerIdleDevice < oldReal.callsPerHourPerIdleDevice / 3,
    'current cadence should be at least 3x cheaper in claim calls than the pre-ramp one'
  );
});

test('poll issue times match the loop structure: 8 fast then 2000ms spacing', () => {
  const issued = pollIssueTimes({ ...recordedCadence, rpcMs: 0 });
  // With zero RPC cost the fast polls are an exact 50ms ladder.
  assert.deepEqual(issued.slice(0, 8), [0, 50, 100, 150, 200, 250, 300, 350]);
  // The 9th poll is issued immediately at 400ms; only after it does the loop
  // sleep the idle interval, so the first 2000ms gap appears after that.
  assert.equal(issued[8], 400);
  assert.equal(issued[9] - issued[8], 2000);
});

test('a command committed inside the fast window is claimed within one fast interval', () => {
  const issued = pollIssueTimes({ ...recordedCadence, rpcMs: 0 });
  for (const at of [0, 10, 51, 200, 399]) {
    const wait = claimWaitMs(issued, at, 0);
    assert.ok(wait <= 50, `command at ${at}ms waited ${wait}ms, expected <=50ms`);
  }
});

test('a command committed after the fast window waits up to the idle interval', () => {
  const issued = pollIssueTimes({ ...recordedCadence, rpcMs: 0 });
  const wait = claimWaitMs(issued, 401, 0);
  assert.ok(wait > 1900 && wait <= 2000, `expected ~2000ms idle wait, got ${wait}`);
});

test('percentile helper is order-independent and boundary-safe', () => {
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([1], 99), 1);
  assert.equal(percentile([10, 20, 30, 40], 100), 40);
});

// --- C. server-side discovery -----------------------------------------------
//
// Phase A measured the cost of the client-side design above: the bridge slept
// IDLE_PULL_INTERVAL_MS *inside the edge function* and minted one HTTP round
// trip per poll, 14 per 12s window, giving a queue wait of p50 830ms and
// p95 1910ms. The sleep belongs in Postgres, next to the data, so the edge
// function can make exactly one call per window and let the database decide
// when a command arrived.

test('the migration exists and defines opera_claim_next_wait', () => {
  assert.ok(claimWaitSql, '20261002090000_opera_agent_claim_wait.sql must exist');
  assert.match(claimWaitSql, /create or replace function public\.opera_claim_next_wait\(/);
});

test('opera_claim_next_wait is locked to service_role like every sibling', () => {
  assert.ok(claimWaitSql);
  assert.match(
    claimWaitSql,
    /revoke all on function public\.opera_claim_next_wait\([^)]*\) from public,anon,authenticated;/
  );
  assert.match(claimWaitSql, /grant execute on function public\.opera_claim_next_wait\([^)]*\) to service_role;/);
  assert.match(claimWaitSql, /security definer/);
  assert.match(claimWaitSql, /set search_path=public/);
});

test('opera_claim_next_wait keeps the original claim semantics', () => {
  assert.ok(claimWaitSql);
  // Same authorization gate, so the new function cannot widen access.
  assert.match(claimWaitSql, /opera_auth_device\(p_device_name,p_token_hash\)/);
  assert.match(claimWaitSql, /'Unauthorized device\.'/);
  // Same claim query, including skip locked so concurrent claimers still work.
  assert.match(claimWaitSql, /for update skip locked limit 1/);
  // Same state transitions and audit record.
  assert.match(claimWaitSql, /status='claimed',attempts=attempts\+1,claimed_at=now\(\)/);
  assert.match(claimWaitSql, /insert into public\.opera_audit\(event_type,device_id,command_id,details\)/);
  assert.match(claimWaitSql, /'command\.claimed'/);
  // Same response envelope the bridge already parses.
  assert.match(claimWaitSql, /'ok',true,'command',jsonb_build_object\('id',v_cmd\.id,'method',v_cmd\.method/);
});

test('the expensive statements run once, not once per poll', () => {
  assert.ok(claimWaitSql);
  const deviceHeartbeat = claimWaitSql.match(
    /update\s+public\.opera_devices\s+set\s+status='online'/gi
  ) || [];
  const expirySweep = claimWaitSql.match(/update\s+public\.opera_commands\s+set\s+status='expired'/gi) || [];

  // These two are the per-poll cost that made an in-SQL loop look 18x more
  // expensive than the client-side one. They must appear exactly once, before
  // the polling loop opens, never inside it.
  assert.equal(deviceHeartbeat.length, 1, 'device heartbeat must be written once, outside the loop');
  assert.equal(expirySweep.length, 1, 'expiry sweep must be written once, outside the loop');

  const loopStart = claimWaitSql.indexOf('loop');
  const heartbeatAt = claimWaitSql.indexOf("update public.opera_devices set status='online'");
  const sweepAt = claimWaitSql.indexOf("update public.opera_commands set status='expired'");
  assert.ok(heartbeatAt < loopStart, 'device heartbeat must precede the loop');
  assert.ok(sweepAt < loopStart, 'expiry sweep must precede the loop');
});

test('the poll loop body is a single indexed select', () => {
  assert.ok(claimWaitSql);
  const start = claimWaitSql.indexOf('\n  loop\n');
  const end = claimWaitSql.indexOf('end loop;');
  assert.ok(start > 0 && end > start, 'the plpgsql loop must be present and well formed');
  const loopBody = claimWaitSql.slice(start, end);
  const selects = loopBody.match(/select\s/gi) || [];
  const updates = loopBody.match(/update\s+public\./gi) || [];
  const inserts = loopBody.match(/insert\s+into/gi) || [];
  assert.equal(selects.length, 1, 'loop body must run exactly one select');
  assert.equal(updates.length, 0, 'loop body must not update');
  assert.equal(inserts.length, 0, 'loop body must not insert');
  assert.equal(updates.length + inserts.length, 0, 'the cycle must be read-only');

  // The claim itself happens once, after the cycle closes, not inside it.
  const afterLoop = claimWaitSql.slice(end);
  assert.match(afterLoop, /update public\.opera_commands set status='claimed'/);
  assert.match(afterLoop, /insert into public\.opera_audit/);
  assert.match(afterLoop, /if not found then/);
});

test('the wait is clamped to the bridge window range', () => {
  assert.ok(claimWaitSql);
  assert.match(claimWaitSql, /least\(greatest\(coalesce\(p_wait_ms,12000\),0\),25000\)/);
});

test('the ramp stays fine through the interactive burst window', () => {
  assert.ok(claimWaitRamp, 'opera_claim_next_wait must use a pg_sleep ramp');
  assert.deepEqual(claimWaitRamp, [
    { upto: 8, seconds: 0.005 },
    { upto: 16, seconds: 0.01 },
    { upto: 24, seconds: 0.025 },
    { upto: 32, seconds: 0.05 },
    { upto: Infinity, seconds: 0.25 }
  ]);
  assert.ok(serverSideCadence, 'ramp must be measurable');

  // Follow-up commands arrive right behind the previous HTTP round trip, so the
  // fine stages must cover at least the first 700ms of an idle window.
  assert.ok(
    serverSideCadence.fineWindowMs >= 700,
    `fine stages cover only ${serverSideCadence.fineWindowMs}ms of the window`
  );
});

test('MEASURED: queue wait drops from p50 830ms to under 150ms', () => {
  assert.ok(serverSideCadence, 'ramp must be measurable');
  assert.equal(clientSideBaseline.p50, 830);
  assert.equal(clientSideBaseline.p95, 1910);
  assert.ok(serverSideCadence.p50 < 150, `expected p50 under 150ms, measured ${serverSideCadence.p50}ms`);
  assert.ok(serverSideCadence.p95 < 300, `expected p95 under 300ms, measured ${serverSideCadence.p95}ms`);
  assert.ok(
    serverSideCadence.max <= 260,
    `worst case must stay near the 250ms tail, measured ${serverSideCadence.max}ms`
  );
});

test('MEASURED: edge round trips drop from 14 per window to 1', () => {
  assert.ok(serverSideCadence);
  assert.equal(clientSideBaseline.windowCalls, 14);
  // The bridge now issues one request per window, so the only cost left is the
  // single round trip itself.
  assert.equal(clientSideBaseline.windowCalls - 1, 13, 'thirteen HTTP round trips are eliminated');
  const callsBefore = clientSideBaseline.callsPerHourPerIdleDevice;
  assert.ok(callsBefore > 4000, `baseline egress recorded at ${callsBefore}/hour`);
});

test('MEASURED: database query load grows but stays bounded', () => {
  assert.ok(serverSideCadence);
  // Honest cost statement: more Postgres queries, far fewer HTTP round trips.
  // Each internal poll is one index-served lookup on
  // opera_commands_queue_idx (device_id, status, created_at).
  assert.ok(
    serverSideCadence.internalPolls < 120,
    `expected under 120 internal polls, got ${serverSideCadence.internalPolls}`
  );
  assert.ok(
    serverSideCadence.queriesPerHourPerIdleDevice < 40000,
    `expected under 40k queries/hour, got ${Math.round(serverSideCadence.queriesPerHourPerIdleDevice)}`
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
  assert.match(core, /create or replace function public\.opera_claim_next\(/);
  assert.match(core, /revoke all on function public\.opera_claim_next\(text,text,text,integer,jsonb\)/);
});

// --- D. the claim-budget and watch-ramp repair --------------------------------
//
// Four SQL-side corrections, all in one migration, none of which changes a
// response contract:
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

test('the migration exists', () => {
  assert.ok(budgetRamp, '20261003110000_opera_agent_claim_budget_and_wait_ramp.sql must exist');
});

test('the claim restarts expires_at so queue wait is not charged to execution', () => {
  assert.ok(budgetRamp);
  const claim = redefine(budgetRamp, 'opera_claim_next');
  assert.ok(claim, 'opera_claim_next must be redefined');
  assert.match(claim, /expires_at\s*=\s*clock_timestamp\(\)\s*\+\s*make_interval\(secs=>\(v_cmd\.timeout_ms\/1000\.0\)\+5\)/);
  // claimed_at must move with it so the two clocks agree.
  assert.match(claim, /claimed_at=clock_timestamp\(\)/);
});

test('enqueue keeps an expiry so a command nobody ever claims is still swept', () => {
  assert.ok(budgetRamp);
  const enqueue = redefine(budgetRamp, 'opera_enqueue');
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
  assert.ok(budgetRamp);
  const wait = redefine(budgetRamp, 'opera_claim_next_wait');
  assert.ok(wait, 'opera_claim_next_wait must be redefined too');
  assert.match(wait, /expires_at=clock_timestamp\(\)\+make_interval\(secs=>\(v_cmd\.timeout_ms\/1000\.0\)\+5\)/);
});

test('the claim predicate still excludes expired rows', () => {
  assert.ok(budgetRamp);
  for (const fn of ['opera_claim_next', 'opera_claim_next_wait']) {
    const body = redefine(budgetRamp, fn);
    assert.match(body, /status='queued' and expires_at>now\(\)/, `${fn} must still filter by expiry`);
  }
});

test('opera_watch_events_wait uses an adaptive ramp instead of a flat 5ms', () => {
  assert.ok(budgetRamp);
  const body = redefine(budgetRamp, 'opera_watch_events_wait');
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
  // The same transition section A records for the live inventory, measured
  // through the shared helper's parser instead of this file's own. Two
  // independent parsers of one ramp is a cross-check, not a second opinion:
  // if either stopped reading the SQL, both tests fail.
  assert.ok(budgetRamp);
  const ramp = readSqlRamp(redefine(budgetRamp, 'opera_watch_events_wait'));
  const after = countPolls(ramp, 32000);
  const before = countPolls([{ upto: Infinity, seconds: 0.005 }], 32000);
  assert.equal(before, 6400, 'the flat 5ms figure Phase A recorded');
  assert.equal(after, 648);
  assert.ok(before / after > 9, `expected a ~10x reduction, got ${(before / after).toFixed(1)}x`);
});

test('the first 100ms of a watch wait stays as fine as it was', () => {
  assert.ok(budgetRamp);
  const ramp = readSqlRamp(redefine(budgetRamp, 'opera_watch_events_wait'));
  assert.equal(countPolls(ramp, 100), 10);
  // A watch fires in response to start_watch, so the opening window is the one
  // that matters; the coarse tail is where the cost was.
  assert.equal(ramp[0].seconds, 0.005);
});

test('the watch wait still returns events immediately when one exists', () => {
  assert.ok(budgetRamp);
  const body = redefine(budgetRamp, 'opera_watch_events_wait');
  // The check must stay before the sleep, and the deadline check must stay.
  const checkAt = body.indexOf('jsonb_array_length(v_rows) > 0');
  const sleepAt = body.indexOf('perform pg_sleep');
  assert.ok(checkAt > 0 && sleepAt > checkAt, 'rows must be checked before sleeping');
  assert.match(body, /if clock_timestamp\(\) >= v_deadline then/);
});

test('created_at defaults to clock_timestamp, not now()', () => {
  assert.ok(budgetRamp);
  assert.match(budgetRamp, /alter\s+column\s+created_at\s+set\s+default\s+clock_timestamp\(\)/);
  assert.doesNotMatch(budgetRamp, /alter\s+column\s+created_at\s+set\s+default\s+now\(\)/);
});

test('the core migration still shows the historical now() default', () => {
  // History is not rewritten: the alter is additive and the old definition stays
  // on record so the change is auditable.
  assert.match(core, /created_at timestamptz not null default now\(\)/);
});

test('the queue index still serves the claim ordering', () => {
  assert.match(core, /opera_commands_queue_idx on public\.opera_commands\(device_id,status,created_at\)/);
});

// opera_run_fast was dropped on the reasoning that a dead, service_role-granted
// function is a trap. It was not a caller and nothing broke either way, so the
// drop was a preference rather than a requirement -- and removing pre-existing
// code that this work did not create is an owner decision, not an
// implementation detail. The drop was reverted in
// 20261004090000_opera_agent_restore_run_fast.sql; the function is documented as
// non-functional instead, which changes no behavior and keeps the warning
// without discarding someone else's artifact.

test('opera_run_fast is not dropped, and a later migration restores it', () => {
  const restore = fs.existsSync(restoreRunFastUrl) ? fs.readFileSync(restoreRunFastUrl, 'utf8') : null;
  assert.ok(restore, '20261004090000_opera_agent_restore_run_fast.sql must exist');
  assert.match(restore, /create or replace function public\.opera_run_fast\(/i);
  // It is granted again, because the grant is part of the pre-existing surface.
  assert.match(restore, /grant execute on function public\.opera_run_fast\(text,jsonb,integer,text,text\) to service_role;/);
  // And the defect that makes it non-functional is recorded rather than removed.
  assert.match(restore, /cannot work|not visible until|always times out/i);
});

test('the drop still exists in history, so the reversion is auditable', () => {
  assert.match(budgetRamp, /drop\s+function\s+(if\s+exists\s+)?public\.opera_run_fast\(/i);
  assert.doesNotMatch(budgetRamp, /grant execute on function public\.opera_run_fast/i);
});

test('the drop is reversible because the definition stays in history', () => {
  assert.ok(latest(etw, 'create or replace function public.opera_run_fast('));
  assert.match(etw, /grant execute on function public\.opera_run_fast\(text,jsonb,integer,text,text\) to service_role;/);
});

test('no migration drops a table', () => {
  assert.ok(budgetRamp);
  assert.doesNotMatch(budgetRamp, /drop\s+table/i);
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

// --- E. the burst ceiling ----------------------------------------------------
//
// `browser.burst` is the mechanism that removed the model round trip from
// find->click (CHANGELOG 1.x: "14.1s gap -> 161.6ms atomic burst"). It is the
// single biggest responsiveness win this project already has.
//
// This section measures its ceiling: which primitives a burst can express at
// all, and therefore how many model round trips a realistic task still needs.
// Constants are imported from the live module, so the numbers cannot drift.

// Constants verified in extension/content.js:1130-1144 --
// waitForPostActionSettle sleeps a fixed 50ms and needs 2 stable rounds.
const SETTLE_TICK_MS = 50;
const SETTLE_STABLE_ROUNDS = 2;
const SETTLE_FLOOR_MS = SETTLE_TICK_MS * SETTLE_STABLE_ROUNDS;

const primitives = Object.keys(METHOD_SPECS);
const burstTargets = new Set(Object.values(BURST_ACTION_METHODS));
const burstable = primitives.filter((m) => burstTargets.has(m));
const notBurstable = primitives.filter((m) => !burstTargets.has(m));

test('MEASURED: only 9 of 26 primitives can be expressed inside a burst', () => {
  // Computed from the live module above, so the numbers cannot drift from the
  // code: navigate joined the burst vocabulary (maps to the existing
  // tabs.navigate primitive, so the count stays 26).
  assert.equal(primitives.length, 26, 'primitive count changed; re-measure the burst ceiling');
  assert.equal(burstable.length, 9);
  assert.deepEqual(burstable.sort(), [
    'page.click',
    'page.fill',
    'page.find',
    'page.key',
    'page.pointer',
    'page.read',
    'page.scroll',
    'page.wait_for',
    'tabs.navigate'
  ]);
  assert.equal(notBurstable.length, 17);
});

test('MEASURED: every media.* operation is un-burstable; tabs.* all but navigate are', () => {
  // tabs.navigate is reachable from a burst now. The rest of tabs.* is not,
  // and media.* is untouched.
  const tabs = primitives.filter((m) => m.startsWith('tabs.'));
  const media = primitives.filter((m) => m.startsWith('media.'));
  assert.equal(tabs.length, 8, 'all 8 tabs.* primitives exist');
  assert.equal(media.length, 4, 'all 4 media.* primitives exist');
  for (const method of [...tabs.filter((m) => m !== 'tabs.navigate'), ...media]) {
    assert.ok(!burstTargets.has(method), `${method} must not be reachable from a burst`);
  }
  assert.ok(burstTargets.has('tabs.navigate'), 'navigate must be reachable from a burst');
  // Opening, activating and closing a tab each cost a full
  // blocking round trip, which is exactly what a human never has to wait for.
  for (const method of ['tabs.open', 'tabs.activate', 'tabs.close']) {
    assert.ok(!burstTargets.has(method));
  }
});

test('page.hover is a burst-only action and deliberately not a 27th primitive', () => {
  assert.ok(burstTargets.has('page.hover'), 'hover must remain reachable inside a burst');
  assert.ok(!primitives.includes('page.hover'), 'page.hover must stay out of METHOD_SPECS');
});

test('MEASURED: the burst budget is 8 steps in 12000ms, i.e. 1500ms per step', () => {
  assert.equal(BURST_MAX_STEPS, 8);
  assert.equal(BURST_MAX_TIMEOUT_MS, 12000);
  assert.equal(BURST_MAX_TIMEOUT_MS / BURST_MAX_STEPS, 1500);
});

test('MEASURED: an 8-step click/fill burst pays at least 800ms of settle alone', () => {
  assert.equal(SETTLE_FLOOR_MS, 100);
  const worstCaseSteps = 8;
  assert.equal(SETTLE_FLOOR_MS * worstCaseSteps, 800);
  // Settle is a floor, not a budget: it is inside the 12000ms window and
  // competes with page load and the debugger round trips.
  assert.ok(SETTLE_FLOOR_MS * worstCaseSteps < BURST_MAX_TIMEOUT_MS);
});

test('MEASURED reference task: 4 round trips, ~3320ms of queue wait before any work', () => {
  // "Search for a term, open the first result, read the page."
  // Grouped the way the current surface forces the model to group it.
  const plan = [
    { step: 'open_url', primitive: 'tabs.open', why: 'tabs.* is un-burstable' },
    { step: 'burst: find + fill + key', primitive: 'burstable', why: 'three page.* steps in one call' },
    { step: 'burst: wait + find + click', primitive: 'burstable', why: 'result list is burstable' },
    { step: 'read_page', primitive: 'page.read', why: 'burstable but stands alone here' }
  ];
  const roundTrips = plan.length;
  assert.equal(roundTrips, 4);
  assert.equal(plan[0].primitive, 'tabs.open', 'the task must start on an un-burstable primitive');

  // Each round trip independently pays the measured queue wait.
  const waitFloor = roundTrips * clientSideBaseline.p50;
  assert.equal(waitFloor, 3320, `expected 4 x ${clientSideBaseline.p50}ms = 3320ms`);
  assert.ok(waitFloor > 3000, `expected >3s of pure queue wait, got ${waitFloor}ms`);

  // CHANGELOG records the burst itself executing in 161.6ms. The measured
  // queue wait is therefore ~5x the cost of actually running the actions:
  // the device spends longer being noticed than working.
  const BURST_EXECUTION_MS = 161.6;
  const ratio = clientSideBaseline.p50 / BURST_EXECUTION_MS;
  assert.ok(
    ratio > 4,
    `one queue wait (${clientSideBaseline.p50}ms) should exceed one burst (~${BURST_EXECUTION_MS}ms)`
  );
  assert.ok(ratio < 8, `ratio ${ratio.toFixed(1)} drifted; re-record rather than widen the bound`);
});

test('the queue wait dominates one burst step, so cadence is the first lever', () => {
  // A burst step costs a few hundred ms of work; the command waits ~830ms for
  // a device to notice it. That ratio is why the cadence, not the step count,
  // is where the measured headroom is.
  assert.ok(clientSideBaseline.p50 > SETTLE_FLOOR_MS * 4, 'queue wait still dwarfs per-step settle cost');
  assert.ok(clientSideBaseline.p95 < BURST_MAX_TIMEOUT_MS, 'one command wait fits inside one burst budget');
});

test('capture_page and find_elements remain separate round trips by design', () => {
  // Screenshots and structured queries are deliberately outside the burst:
  // their payloads are large and the model needs to see them before deciding.
  const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.equal(notBurstable.includes('page.capture'), true);
  assert.equal(notBurstable.includes('page.query'), true);
  assert.match(background, /case 'page\.capture'/);
  assert.match(background, /case 'page\.query'/);
});
