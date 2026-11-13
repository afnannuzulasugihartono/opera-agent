// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: deadline-race — the deadline one command execution races against.
// @state: module headers say what a module is, not which task added it.
// @dependencies: none.

// `executeCommand` used to race its dispatch against a `setTimeout` rejection and never cleared that timer, so every command left a live timer behind that fired later and rejected an already-settled promise.
// In a Manifest V3 service worker a pending timer is also one of the things that keeps the worker alive, so these leaked timers had a real cost.

// This is kept as a standalone pure module so both directions are testable: the work resolving must clear the timer, and the work rejecting must clear it too.
// Neither behaviour is observable from outside a browser otherwise.

// `makeError` builds the deadline error; a rejection reason must always be an Error (deadline-race callers pass codedError, which is one).
// Neither behaviour is observable from outside a browser otherwise.

const DEFAULT_ERROR_MESSAGE = 'Deadline exceeded.';

export async function raceWithTimeout<T>(work: () => Promise<T>, timeoutMs: number, makeError?: () => Error): Promise<T> {
  const build: () => Error = makeError ?? (() => new Error(DEFAULT_ERROR_MESSAGE));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(build()), Math.max(1, timeoutMs));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}