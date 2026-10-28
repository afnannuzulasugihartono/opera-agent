// @last-edited: 2026-10-28 UTC+7.
// @title: focus-gate — the retry-then-refuse policy for foreground dispatch.
// @state: pure decision over a focus sample — no chrome, no DOM; three attempts, a satisfied sample dispatches first try, the final refusal carries the last sample.
// @dependencies: none.

// Pure focus policy — no chrome, no DOM, so the decision is deterministic and testable in Node.

// WHY RE-SAMPLE AT DISPATCH.
// The foreground path used to read `tab.active` and `window.focused` once, before a content-script round trip and a debugger attach, then never re-checked.
// A window that lost focus in that gap failed with FOREGROUND_REQUIRED right after the user activated the tab.

// Locked by tests/focus-and-keyboard.test.mjs: background always dispatches first try; a satisfied foreground sample adds no latency; lost-then-restored dispatches with recovered; an unsatisfied sample refuses on the final attempt carrying the last state.
// The gate NEVER activates a tab or focuses a window — that authority stays with the tabs.activate primitive.

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
