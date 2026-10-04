// @last-edited: 2026-10-04 19:08 UTC+7.
// @title: action-pipeline — MV3 runtime library, shared with the Node suite..
// @context: MV3 runtime library, shared with the Node suite.
// @state: Pure Resolve-Wait-Heal-Verify policy; refusals carry the ref state.
// @updated: refState on TARGET_NOT_READY.
// @dependencies: none.

// Action pipeline: pure policy engine for Resolve -> Wait -> Heal -> Verify. NO DOM and NO chrome dependency: the host supplies resolve
// snapshots and executes decisions, so the engine stays deterministic and
// testable in Node (pattern of lib/watch.js).
//
// Semantics locked by tests/action-pipeline.test.mjs:
// - poll ramp 25 -> 400 ms adaptive, last step repeating, clipped to budget
// - classification ready / not-found / not-actionable / ambiguous
// - TARGET_NOT_READY carries candidates only for ambiguity
// - resolved telemetry is a superset field; verified omitted when absent

export const ACTION_RAMP_MS = [25, 50, 100, 200, 400];

export function pollDelays(deadlineMs, elapsedMs = 0) {
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

export function classifyResolve(state) {
  if (!state || state.present !== true) return 'not-found';
  if (state.ambiguous === true) return 'ambiguous';
  if (state.masked === true) return 'ready'; // executor-owned guard (e.g. sensitive fields)
  return state.actionable === true ? 'ready' : 'not-actionable';
}

export function makeNotReady(reason, waitedMs, hint, candidates, refState) {
  const err = { code: 'TARGET_NOT_READY', reason, waitedMs, hint };
  if (reason === 'ambiguous' && candidates) err.candidates = candidates;
  // WHY carried: "not-found" alone cannot be acted on. A ref whose node left the
  // DOM and a ref that cannot resolve on this document need different advice,
  // and the caller decides the advice from this field rather than guessing.
  if (refState) err.refState = refState;
  return err;
}

export function attachResolution(envelope, { attempts, waitedMs, healed, verified }) {
  const resolved = { attempts, waitedMs, healed };
  if (verified !== undefined) resolved.verified = verified;
  return { ...envelope, resolved };
}
