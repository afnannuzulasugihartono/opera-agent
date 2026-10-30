// @last-edited: 2026-10-04 19:08 UTC+7.
// @title: action-pipeline — adaptive poll delays and resolve classification for the action engine.
// @state: Pure Resolve-Wait-Heal-Verify policy; refusals carry the ref state.
// @dependencies: none.

// Action pipeline: pure policy engine for Resolve -> Wait -> Heal -> Verify.
// NO DOM and NO chrome dependency: the host supplies resolve snapshots and executes decisions, so the engine stays deterministic and testable in Node (pattern of lib/watch.js).

// Semantics locked by tests/action-pipeline.test.mjs:
// - poll ramp 25 -> 400 ms adaptive, last step repeating, clipped to budget
// - classification ready / not-found / not-actionable / ambiguous
// - TARGET_NOT_READY carries candidates only for ambiguity
// - resolved telemetry is a superset field; verified omitted when absent

export const ACTION_RAMP_MS = [
  25,
  50,
  100,
  200,
  400
];

/**
 * The adaptive poll ramp for the remaining budget: 25 -> 400 ms, the last step repeating, clipped to what is left.
 * @param {number} deadlineMs Total budget in milliseconds.
 * @param {number} [elapsedMs=0] Already spent.
 * @returns {number[]} The delays still worth waiting, in order.
 */

export function pollDelays(
  deadlineMs,
  elapsedMs = 0
) {
  const budget = deadlineMs - elapsedMs;
  const delays = [];
  let used = 0;
  for (let i = 0; ; i += 1) {
    const d = ACTION_RAMP_MS[Math.min(i, ACTION_RAMP_MS.length - 1)];
    if (used + d > budget) break;
    delays.push(d);
    used += d;
  }
  return delays;
}

/**
 * Classify a resolve snapshot into ready / not-found / not-actionable / ambiguous.
 * @param {{ present?: boolean, ambiguous?: boolean, masked?: boolean, actionable?: boolean }} [state] The snapshot.
 * @returns {string} The classification.
 */

export function classifyResolve(state) {
  if (!state || state.present !== true) return 'not-found';
  if (state.ambiguous === true) return 'ambiguous';
  if (state.masked === true) return 'ready';
  return state.actionable === true ? 'ready' : 'not-actionable';
}

/**
 * Build the TARGET_NOT_READY error a stalled resolve answers with.
 * Candidates ride along only for ambiguity, and refState only when the caller has one.
 * @param {string} reason Why the target was not ready.
 * @param {number} waitedMs How long the pipeline already waited.
 * @param {string} [hint] The next move to try.
 * @param {*} [candidates] Alternative refs, only meaningful when reason is 'ambiguous'.
 * @param {*} [refState] The ref's current state.
 * @returns {{ code: 'TARGET_NOT_READY', reason: string, waitedMs: number, hint?: string, candidates?: *, refState?: * }} The error object.
 */

export function makeNotReady(
  reason,
  waitedMs,
  hint,
  candidates,
  refState
) {
  const err = {
    code: 'TARGET_NOT_READY',
    reason,
    waitedMs,
    hint
  };
  if (reason === 'ambiguous' && candidates) err.candidates = candidates;

  if (refState) err.refState = refState;
  return err;
}

/**
 * Attach the resolution telemetry to an answer envelope; `verified` is omitted when absent.
 * @param {object} envelope The answer so far.
 * @param {{ attempts?: number, waitedMs?: number, healed?: boolean, verified?: boolean }} resolution The telemetry.
 * @returns {object} The envelope with a `resolved` field.
 */

export function attachResolution(
  envelope,
  {
    attempts,
    waitedMs,
    healed,
    verified
  }
) {
  const resolved = {
    attempts,
    waitedMs,
    healed
  };
  if (verified !== undefined) resolved.verified = verified;
  return {
    ...envelope,
    resolved
  };
}
