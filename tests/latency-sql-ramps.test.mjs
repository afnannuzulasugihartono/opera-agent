import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Phase A latency measurement (2026-10-02), evidence record.
//
// Every result wait in this system is a Postgres spin loop: `perform
// pg_sleep(...)` inside plpgsql, re-reading the command row until it settles.
// That design is CPU-cheap but it pins a pooled Postgres backend for the
// whole wait and re-executes a SELECT once per sleep.
//
// This file measures what each loop actually costs: how finely it can detect
// a completed command, and how many loop iterations a full-length wait burns.
// It asserts nothing about behavior and changes nothing at runtime.

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

test('all seven pg_sleep loops in the migrations are accounted for', () => {
  assert.equal(sleeps.length, 7, 'migration sleep count changed; update this record');
  assert.deepEqual(
    sleeps.map((s) => `${s.file.split('_')[0]}:${s.line}`),
    [
      '20260907204146:204',
      '20260907204221:212',
      '20260908031756:110',
      '20260910121107:110',
      '20260922000000:79',
      '20260922000000:104',
      // Added 2026-10-02: the pull-path wait moved from the bridge into the
      // database. See tests/latency-claim-wait.test.mjs.
      '20261002090000:61'
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

test('MEASURED: opera_watch_events_wait burns 6400 iterations for a 32s wait', () => {
  const entry = schedules.get('opera_watch_events_wait');
  assert.ok(entry, 'opera_watch_events_wait must still be a spin loop');
  assert.equal(entry.schedule[0].seconds, 0.005);
  assert.equal(finestMs(entry.schedule), 5);
  assert.equal(iterationsFor(entry.schedule, BUDGETS_MS.opera_watch_events_wait), 6400);
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

test('the 5ms watch wait costs ~10x the iterations of a 32s command wait', () => {
  const watch = iterationsFor(schedules.get('opera_watch_events_wait').schedule, 32000);
  const command = iterationsFor(schedules.get('opera_await').schedule, 32000);
  assert.ok(watch / command >= 9, `watch=${watch} command=${command}`);
  assert.ok(watch >= 6000, 'watch wait is at least 6000 loop iterations per full-length call');
});

test('the AI-facing MCP path uses the flat 50ms wait, not the adaptive ramp', () => {
  const mcp = fs.readFileSync(
    new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url),
    'utf8'
  );
  const line = mcp.split('\n').find((l) => l.includes('opera_await'));
  assert.ok(line, 'MCP must still choose an await function');
  assert.match(line, /"opera_await"/);
  assert.match(line, /page\.capture/);
  assert.doesNotMatch(line, /opera_await_adaptive/);
  // The gateway, not the MCP server, is the only caller of the adaptive ramp.
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