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

/** Pull constants are read from the bridge source so this model cannot silently
 *  drift away from the cadence the extension actually experiences. */
export function readCadenceConstants(bridgeSource) {
  const read = (name) => {
    const match = bridgeSource.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
    if (!match) throw new Error(`bridge source no longer declares ${name}`);
    return Number(match[1]);
  };
  // The long-poll window is not a named constant; it is the fallback argument
  // of clamp(body.waitMs, 0, 25000, 12000).
  const clampMatch = bridgeSource.match(/clamp\(\s*body\.waitMs\s*,\s*0\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
  if (!clampMatch) throw new Error('bridge source no longer clamps body.waitMs with a default window');
  return {
    fastPolls: read('FAST_PULL_POLLS'),
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