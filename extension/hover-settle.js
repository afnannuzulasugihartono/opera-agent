// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: hover-settle — settle — R9-E : hover settle policy, as a classic content script.
// @context: MV3 browser runtime.
// @state: fix(r9): hygiene pass on the R9 code itself.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

// R9-E (2026-09-30): hover settle policy, as a classic content script.
//
// Loaded by the manifest BEFORE content.js and published on globalThis, the same
// pattern as role-reconcile.js: content scripts are classic scripts and cannot
// import, and this keeps one copy for both contexts.
//
// Why this exists. Multi-level menus were the most fragile interaction in the
// live Google Docs test: the caller had to hand-build a burst of
// hover -> wait -> hover -> wait, because hovering and settling were separate
// unbounded steps. This module owns the decision of when a hover has "landed",
// so one hover per level can be a single step.
//
// Semantics locked by tests/r9-hover-settle.test.mjs:
// - a hover with an expected submenu name settles only when that name is
//   actually observed
// - otherwise it settles on DOM mutation stability for the required rounds
// - an `aria-expanded` flip is itself a settle signal
// - it always terminates: a timeout returns a reason, never an exception
// - it NEVER clicks; this module has no input capability at all
(() => {
  'use strict';
  if (globalThis.OperaAgentHoverSettle) return;

  // Published on globalThis, so it is frozen: a sibling content script must not
  // be able to change the default settle budget for every later hover.
  const DEFAULTS = Object.freeze({ timeoutMs: 1500, intervalMs: 50, stableRounds: 2 });

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
  }

  function normalize(options) {
    const input = options || {};
    return {
      timeoutMs: clamp(input.timeoutMs, 50, 8000, DEFAULTS.timeoutMs),
      intervalMs: clamp(input.intervalMs, 25, 1000, DEFAULTS.intervalMs),
      stableRounds: clamp(input.stableRounds, 1, 10, DEFAULTS.stableRounds),
      text: String(input.text == null ? '' : input.text).trim().toLowerCase()
    };
  }

  // Called once per poll. Returns whether the hover has landed and why, so the
  // in-page loop and the reported reason can never disagree.
  function plan(state) {
    const input = state || {};
    const wanted = String(input.text == null ? '' : input.text).trim().toLowerCase();
    // An explicit expectation is satisfied only by actually observing it.
    if (wanted) {
      const seen = String(input.observedText == null ? '' : input.observedText).toLowerCase();
      if (seen.includes(wanted)) {
        return { done: true, reason: 'text_appeared', expectedText: wanted };
      }
      if (Number(input.elapsedMs) >= Number(input.timeoutMs)) {
        return { done: true, reason: 'text_timeout', expectedText: wanted };
      }
      return { done: false, reason: 'awaiting_text' };
    }
    // A control that reports its own expansion flipping is a real signal.
    if (input.ariaExpanded != null && input.previousAriaExpanded != null
      && input.ariaExpanded !== input.previousAriaExpanded) {
      return { done: true, reason: 'aria_expanded_changed' };
    }
    if (input.mutationVersion === input.previousMutationVersion) {
      return { done: true, reason: 'dom_stable', stableRounds: input.stableRounds };
    }
    if (Number(input.elapsedMs) >= Number(input.timeoutMs)) {
      return { done: true, reason: 'timeout' };
    }
    return { done: false, reason: 'mutating' };
  }

  globalThis.OperaAgentHoverSettle = Object.freeze({ DEFAULTS, normalize, plan });
})();
