// Phase A latency measurement (2026-10-02): a deterministic, clock-injected
// model of the bridge claim-polling cadence in
// supabase/functions/opera-agent-bridge/index.ts.
//
// Purpose: measure, do not assert from reading constants. The device is
// modelled as permanently idle and always parked on a fresh long-poll window,
// which is the steady state for interactive use. No real timers, no network:
// the same inputs always produce the same distribution, so the numbers below
// are reproducible evidence rather than a flaky timing assertion.
//
// This helper is deliberately measurement-only. It changes no runtime behavior.

/**
 * The bridge's client-side pull cadence as it stood from 2026-09-24 until
 * 2026-10-02, when `pull` was changed to delegate the wait to
 * `opera_claim_next_wait`. Pinned here so the Phase A "before" figures stay
 * reproducible after the constants were removed from the bridge.
 *
 * Measured by tests/latency-surface.test.mjs section B when it was recorded:
 * 14 claim calls per 12s window, p50 queue wait 830ms, p95 1910ms.
 */
export const RECORDED_BRIDGE_CADENCE = Object.freeze({
  fastPolls: 8,
  fastIntervalMs: 50,
  idleIntervalMs: 2000,
  windowMs: 12000
});

/** Pull constants are read from the bridge source so this model cannot silently
 *  drift away from the cadence the extension actually experiences. Returns null
 *  when the bridge no longer declares a client-side cadence, which is the state
 *  after 2026-10-02. */
export function readCadenceConstants(bridgeSource) {
  const read = (name) => {
    const match = bridgeSource.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
    return match ? Number(match[1]) : null;
  };
  // The long-poll window is not a named constant; it is the fallback argument
  // of clamp(body.waitMs, 0, 25000, 12000).
  const clampMatch = bridgeSource.match(/clamp\(\s*body\.waitMs\s*,\s*0\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
  if (!clampMatch) return null;
  const fastPolls = read('FAST_PULL_POLLS');
  if (fastPolls === null) return null;
  return {
    fastPolls,
    fastIntervalMs: read('FAST_PULL_INTERVAL_MS'),
    idleIntervalMs: read('IDLE_PULL_INTERVAL_MS'),
    windowMs: Number(clampMatch[1])
  };
}

/**
 * Issue times of the claim RPCs inside one long-poll window, in milliseconds.
 *
 * Mirrors the bridge loop exactly:
 *   do { await rpc(); if (command) return; if (past deadline) return;
 *        interval = emptyPolls < FAST ? FAST_MS : IDLE_MS;
 *        emptyPolls += 1; await sleep(interval); } while (true)
 *
 * `rpcMs` is the round-trip cost of one `opera_claim_next` call, which the
 * bridge spends *before* choosing its sleep interval.
 */
export function pollIssueTimes({ fastPolls, fastIntervalMs, idleIntervalMs, windowMs, rpcMs }) {
  const issued = [];
  let now = 0;
  let emptyPolls = 0;
  while (now <= windowMs) {
    issued.push(now);
    now += rpcMs; // the RPC itself
    if (now >= windowMs) break;
    const interval = emptyPolls < fastPolls ? fastIntervalMs : idleIntervalMs;
    emptyPolls += 1;
    now += interval;
  }
  return issued;
}

/**
 * Wait a device experiences for a command committed at `commandAtMs`.
 *
 * A command enqueued at time T is visible to the first poll *issued* at or
 * after T, and that poll's response lands `rpcMs` later. So the wait is
 * (nextIssueTime + rpcMs) - T.
 */
export function claimWaitMs(issued, commandAtMs, rpcMs) {
  const next = issued.find((t) => t >= commandAtMs);
  if (next === undefined) {
    // Arrived after the last in-window poll: the device returns an empty
    // window and immediately re-polls, so the wait is bounded by the
    // rpc plus the restart gap, not by the cadence.
    return rpcMs;
  }
  return next + rpcMs - commandAtMs;
}

export function percentile(values, p) {
  if (values.length === 0) throw new Error('percentile needs at least one sample');
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/**
 * Full steady-state report for one idle device. `samples` arrival times are
 * spread evenly across the window so the result is the distribution a real
 * interactive user experiences, not a single lucky case.
 */
/** Loop iterations needed to cover `budgetMs` of waiting at this schedule. */
export function countPolls(schedule, budgetMs) {
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

export function measureCadence(cadence, { rpcMs = 20, samples = 1200 } = {}) {
  const issued = pollIssueTimes({ ...cadence, rpcMs });
  const waits = [];
  for (let i = 0; i < samples; i += 1) {
    const commandAtMs = (i / samples) * cadence.windowMs;
    waits.push(claimWaitMs(issued, commandAtMs, rpcMs));
  }
  const windowCalls = issued.length;
  return {
    rpcMs,
    windowMs: cadence.windowMs,
    windowCalls,
    callsPerSecond: (windowCalls / cadence.windowMs) * 1000,
    callsPerHourPerIdleDevice: (windowCalls / cadence.windowMs) * 1000 * 3600,
    fastWindowMs: cadence.fastPolls * cadence.fastIntervalMs,
    p50: percentile(waits, 50),
    p95: percentile(waits, 95),
    p99: percentile(waits, 99),
    max: Math.max(...waits)
  };
}

/**
 * Read the `pg_sleep(case when v_polls<=N then S ... else S end)` ramp out of a
 * migration. Returns `null` when the function does not use a ramp, so a caller
 * can tell "flat sleep" apart from "no loop".
 */
export function readSqlRamp(migrationSource) {
  const cases = [...migrationSource.matchAll(/v_polls\s*<=\s*(\d+)\s*then\s*([0-9.]+)/gi)].map(
    (m) => ({ upto: Number(m[1]), seconds: Number(m[2]) })
  );
  const tail = migrationSource.match(/else\s+([0-9.]+)\s+end/i);
  if (!cases.length || !tail) return null;
  return [...cases, { upto: Infinity, seconds: Number(tail[1]) }];
}

/** Sleep length, in ms, for the poll with 1-based index `poll`. */
export function sqlSleepMs(ramp, poll) {
  const step = ramp.find((s) => poll <= s.upto) || ramp[ramp.length - 1];
  return step.seconds * 1000;
}

/**
 * Steady-state report for a command-discovery loop that runs *inside* Postgres,
 * which is what `opera_claim_next_wait` does: one HTTP round trip per window
 * instead of one per poll.
 *
 * A command committed at time T is seen by the first internal poll issued at or
 * after T, so the wait is that poll's response time minus T.
 */
export function measureSqlCadence(ramp, { windowMs = 12000, samples = 1200, pollMs = 1 } = {}) {
  const waits = [];
  let polls = 0;
  let elapsed = 0;
  const issued = [];
  while (elapsed < windowMs) {
    issued.push(elapsed);
    polls += 1;
    elapsed += sqlSleepMs(ramp, polls) + pollMs;
  }

  for (let i = 0; i < samples; i += 1) {
    const commandAtMs = (i / samples) * windowMs;
    const next = issued.find((t) => t >= commandAtMs);
    waits.push((next === undefined ? elapsed : next + pollMs) - commandAtMs);
  }

  // Elapsed time spent inside the fine stages, i.e. before the loop reaches
  // the ramp's tail interval. This is the window in which an interactive
  // follow-up command is likely to arrive.
  const fineWindowMs = ramp
    .filter((s) => s.upto !== Infinity)
    .reduce((acc, s, i) => {
      const previous = i === 0 ? 0 : ramp[i - 1].upto;
      return acc + (s.upto - previous) * s.seconds * 1000;
    }, 0);

  return {
    windowMs,
    internalPolls: polls,
    queriesPerSecond: (polls / windowMs) * 1000,
    queriesPerHourPerIdleDevice: (polls / windowMs) * 1000 * 3600,
    fineWindowMs,
    tailMs: sqlSleepMs(ramp, ramp.length + 1),
    p50: percentile(waits, 50),
    p95: percentile(waits, 95),
    p99: percentile(waits, 99),
    max: Math.max(...waits)
  };
}