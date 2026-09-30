// R9-A focus gate (2026-09-30): pure policy for when a foreground input may be
// dispatched. NO chrome dependency and NO DOM, so the decision is deterministic
// and testable in Node (pattern of lib/action-pipeline.js, lib/watch.js).
//
// Why this exists: the foreground path used to sample `tab.active` and
// `window.focused` once, before a content-script round trip and a debugger
// attach, and never re-checked. A window that lost focus in that window failed
// with FOREGROUND_REQUIRED even though the user had just activated the tab. This
// module owns the re-sampling decision so that re-check happens AT dispatch
// time, inside the debugger session.
//
// Semantics locked by tests/r9-focus-and-keyboard.test.mjs:
// - background mode always dispatches on the first attempt, whatever the sample
// - a satisfied foreground sample dispatches immediately (no added latency)
// - a lost-then-restored sample dispatches with recovered: true
// - a sample that never satisfies refuses on the final attempt, carrying the
//   last observed state so the failure is diagnosable
// - the gate NEVER decides to activate a tab or focus a window; that authority
//   stays with the explicit tabs.activate primitive and nothing here

export const FOCUS_GATE_ATTEMPTS = 3;
export const FOCUS_GATE_SETTLE_MS = 100;

export function focusSampleSatisfied(mode, sample) {
  if (mode !== 'foreground') return true;
  return sample?.tabActive === true && sample?.windowFocused === true;
}

export function decideFocusGate({ mode, sample, attempt = 1, maxAttempts = FOCUS_GATE_ATTEMPTS } = {}) {
  const at = Math.max(1, Math.floor(Number(attempt) || 1));
  const max = Math.max(1, Math.floor(Number(maxAttempts) || FOCUS_GATE_ATTEMPTS));
  if (focusSampleSatisfied(mode, sample)) {
    return { outcome: 'dispatch', attempt: at, recovered: at > 1, sample };
  }
  if (at >= max) return { outcome: 'refuse', attempt: at, sample };
  return { outcome: 'retry', attempt: at, sample };
}
