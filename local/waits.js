// @last-edited: 2026-10-23 UTC+7.
// @title: waits — the page's own settle, and the event-driven waits built on it.
// @state: settle and waitForIdle, then one mutation wait with text, row and stillness on top.
// @dependencies: ./page-expressions.js.

// WHY THE SETTLE LIVES HERE AND NOT WITH THE VERBS.
// Every wait in this file polls the same thing: has the page stopped changing.
// The settle is that question asked once, so the waits and the thing they wait on are answered by one module.

import {
  SETTLE_ARM_EXPRESSION,
  SETTLE_DISARM_EXPRESSION,
  SETTLE_MAX_MS,
  SETTLE_POLL_MS,
  SETTLE_QUIET_MS,
  SETTLE_READ_EXPRESSION
} from './page-expressions.js';
import { MIN_DOM_TEXT, probeSurface } from './surface-profile.js';

export function createWaits({ cdp, sleep, readState, readRows, read, primitives, now = Date.now }) {
  // WHY SETTLE IS A PRIMITIVE AND NOT A TOOL.
  // Every action needs the same short look before the page is read, so the wait belongs beside the actions, not in the surface where a caller has to remember it.
  // The page expression resolves with what it saw, which makes the cost inspectable instead of a blind sleep: quiet means the last change was at least 32ms ago, deadline means the page was still moving when the 120ms cap arrived.
  async function settle() {
    const started = Date.now();
    let armed = false;
    let last = null;
    try {
      await cdp.send('Runtime.evaluate', { expression: SETTLE_ARM_EXPRESSION, returnByValue: true });
      armed = true;
      const polls = Math.ceil(SETTLE_MAX_MS / SETTLE_POLL_MS);
      for (let poll = 0; poll < polls; poll += 1) {
        await sleep(SETTLE_POLL_MS);
        const { result } = await cdp.send('Runtime.evaluate', { expression: SETTLE_READ_EXPRESSION, returnByValue: true });
        const state = result?.value;
        if (!state || state.missing) {
          return { waitedMs: Date.now() - started, quietMs: 0, maxMs: SETTLE_MAX_MS, changes: 0, why: 'failed', detail: 'the page lost the settle watcher' };
        }
        last = state;
        if (state.quietMs >= SETTLE_QUIET_MS) {
          return {
            waitedMs: Date.now() - started,
            quietMs: state.quietMs,
            maxMs: SETTLE_MAX_MS,
            changes: state.changes,
            why: 'quiet',
            visibility: state.visibility
          };
        }
      }
      return {
        waitedMs: Date.now() - started,
        quietMs: last?.quietMs ?? 0,
        maxMs: SETTLE_MAX_MS,
        changes: last?.changes ?? 0,
        why: 'deadline',
        visibility: last?.visibility ?? null
      };
    } catch (error) {
      return { waitedMs: Date.now() - started, quietMs: 0, maxMs: SETTLE_MAX_MS, changes: 0, why: 'failed', detail: error?.message || String(error) };
    } finally {
      if (armed) await cdp.send('Runtime.evaluate', { expression: SETTLE_DISARM_EXPRESSION, returnByValue: true }).catch(() => null);
    }
  }

  async function waitForIdle({ timeoutMs = 10000, intervalMs = 100, readyState = 'complete' } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await primitives.evaluate('document.readyState');
      if (state === readyState) return state;
      if (Date.now() >= deadline) return state;
      await sleep(intervalMs);
    }
  }

  async function waitForMutation(read, predicate, { timeoutMs = 10000, now: clock = now } = {}) {
    const deadline = clock() + timeoutMs;
    for (;;) {
      const state = await read();
      if (predicate(state)) return state;
      if (clock() >= deadline) return state;
      await primitives.settle();
    }
  }

  // WHY THE WAIT ASKS THE PAGE WHAT IT IS BEFORE IT TRUSTS ITS TEXT.
  // This used to ask the url whether the page was a document editor and then read the document for it, which is the site recognition the drive no longer carries.
  // A length bar is not the decision either: measured on a real Google Doc, the chrome around the canvas holds 1,312 characters of its own, so a wait that only measures length polls the toolbar forever and reports found:false for text that is right there in the document.
  // So the probe decides once: a page with no canvas takes the cheap DOM answer, and a canvas page is read through the ladder, which reaches past the chrome.
  async function waitForText(text, { timeoutMs = 10000, intervalMs = 100, absent = false, now: clock = now } = {}) {
    const surface = await probeSurface({ evaluate: primitives.evaluate });
    const domLeads = surface.canvas.value !== true;
    return waitForMutation(
      async () => {
        if (domLeads) {
          const state = await readState();
          if ((state.text || '').trim().length >= MIN_DOM_TEXT) return state;
        }
        return read();
      },
      (state) => String(state.text ?? '').includes(text) !== absent,
      { timeoutMs, now: clock }
    );
  }

  async function waitForRow({ role, name, timeoutMs = 10000, intervalMs = 150, absent = false, now: clock = now } = {}) {
    const want = String(name ?? '').toLowerCase();
    const seen = [];
    const state = await waitForMutation(
      async () => {
        const rows = await readRows(120);
        const hit = rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase() === want)
          ?? rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase().includes(want));
        seen.push(hit?.name ?? null);
        return { role, name, row: hit ?? null, present: Boolean(hit), checks: seen.length };
      },
      (state) => state.present !== absent,
      { timeoutMs, now: clock }
    );
    return {
      found: absent ? state.present === false : state.present,
      role,
      name,
      row: state.row ?? null,
      checks: state.checks
    };
  }

  async function waitForStill({ timeoutMs = 8000, quietMs = 120, intervalMs = 60, limit = 120, now: clock = now } = {}) {
    const started = clock();
    let previous = null;
    let unchangedSince = started;
    let checks = 0;
    const out = await waitForMutation(
      async () => {
        const rows = await readRows(limit);
        const shape = JSON.stringify(rows.map(({ role, name, x, y }) => [role, name, x, y]));
        checks += 1;
        const stable = shape === previous && clock() - unchangedSince >= quietMs;
        if (shape !== previous) {
          previous = shape;
          unchangedSince = clock();
        }
        return { still: stable, ms: clock() - started, checks };
      },
      (state) => state.still,
      { timeoutMs, now: clock }
    );
    return { still: out.still, ms: out.ms, checks: out.checks, settled: out.checks > 1 };
  }

  return { settle, waitForIdle, waitForMutation, waitForText, waitForRow, waitForStill };
}