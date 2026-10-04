// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: deadline-race — race — Deadline race for command execution.
// @context: MV3 runtime library, shared with the Node suite.
// @state: module headers say what a module is, not which task added it.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

// Deadline race for command execution.
//
// `executeCommand` used to race its dispatch against a `setTimeout` rejection
// and never cleared that timer, so every command left a live timer behind that
// fired later and rejected an already-settled promise. In a Manifest V3 service
// worker a pending timer is also one of the things that keeps the worker alive,
// so these leaked timers had a real cost.
//
// This is kept as a standalone pure module so both directions are testable:
// the work resolving must clear the timer, and the work rejecting must clear it
// too. Neither behaviour is observable from outside a browser otherwise.

const DEFAULT_ERROR_MESSAGE = 'Deadline exceeded.';

/**
 * Run `work()` against a deadline, clearing the timer whichever way it settles.
 *
 * `makeError` is called only when the deadline actually wins, so a caller can
 * build a rich error without paying for it on the fast path.
 *
 * Throwing synchronously from `work()` propagates to the caller exactly as it
 * did before this helper existed, so error semantics are unchanged.
 */

export async function raceWithTimeout(work, timeoutMs, makeError) {
  const build = typeof makeError === 'function' ? makeError : () => new Error(DEFAULT_ERROR_MESSAGE);
  let timer;
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(build()), Math.max(1, timeoutMs));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}