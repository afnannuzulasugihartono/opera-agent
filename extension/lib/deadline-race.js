// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: deadline-race — the deadline one command execution races against.
// @state: module headers say what a module is, not which task added it.
// @dependencies: none.

// `executeCommand` used to race its dispatch against a `setTimeout` rejection and never cleared that timer, so every command left a live timer behind that fired later and rejected an already-settled promise.
// In a Manifest V3 service worker a pending timer is also one of the things that keeps the worker alive, so these leaked timers had a real cost.

// This is kept as a standalone pure module so both directions are testable: the work resolving must clear the timer, and the work rejecting must clear it too.
// Neither behaviour is observable from outside a browser otherwise.

const DEFAULT_ERROR_MESSAGE = 'Deadline exceeded.';

/**
 * Race work against a deadline, clearing the timer in both directions so a settled promise is never rejected later by a leaked timeout (which also kept the MV3 worker alive).
 * @param {() => Promise<*>} work The work to race.
 * @param {number} timeoutMs The deadline in milliseconds.
 * @param {() => Error} [makeError] Builds the rejection error; defaults to a plain Error.
 * @returns {Promise<*>} Whatever work resolves with, or rejects with when the deadline wins.
 */

export async function raceWithTimeout(
  work,
  timeoutMs,
  makeError
) {
  const build = typeof makeError === 'function' ? makeError : () => new Error(DEFAULT_ERROR_MESSAGE);
  let timer;
  try {
    return await Promise.race([
      work(),
      new Promise((
        _,
        reject
      ) => {
        timer = setTimeout(() => reject(build()), Math.max(1, timeoutMs));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
