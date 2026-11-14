// @last-edited: 2026-11-05 UTC+7.
// @title: waits — the page's own settle, and the event-driven waits built on it.
// @state: settle and waitForIdle, then one mutation wait with text, row and stillness on top.
// @dependencies: ./page-expressions.js.

// WHY THE SETTLE LIVES HERE AND NOT WITH THE VERBS.
// Every wait in this file polls the same thing: has the page stopped changing.
// The settle is that question asked once, so the waits and the thing they wait on are answered by one module.

import {
  SETTLE_ARM_EXPRESSION,
  SETTLE_MAX_MS,
  SETTLE_POLL_MS,
  SETTLE_QUIET_MS,
  SETTLE_READ_EXPRESSION
} from './page-expressions.js';
import { MIN_DOM_TEXT, probeSurface } from './surface-profile.js';

// The factory's sleep answers whatever its caller returns; the waits only await it.

export interface WaitsDeps {
  cdp: { send(method: string, params?: Record<string, unknown>): Promise<{ result?: { value?: unknown } }> };
  sleep: (ms: number) => Promise<unknown>;
  readState: () => Promise<Record<string, unknown>>;
  readRows: (limit: number) => Promise<Array<Record<string, unknown>>>;
  read: () => Promise<Record<string, unknown>>;
  primitives: import('./types.js').JsonRecord;
  now?: () => number;
}

export function createWaits({ cdp, sleep, readState, readRows, read, primitives, now = Date.now }: WaitsDeps) {
  // WHY THE SETTLE IS A PRIMITIVE AND NOT A TOOL.
  // Every action needs the same short look before the page is read, so the wait belongs beside the actions, not in the surface where a caller has to remember it.
  // The page expression resolves with what it saw, which makes the cost inspectable instead of a blind sleep: quiet means the last change was at least 32ms ago, deadline means the page was still moving when the 120ms cap arrived.

  // WHY THE WATCHER IS INSTALLED ONCE AND KEPT.
  // Measured on 2026-11-05: every settle re-armed its observer, and a fresh observer starts its quiet clock at zero, so a page that had been still for ten seconds still paid 32ms of quiet and four round trips before a word was read.
  // So the watcher stays on the page, the settle reads how long the page has been still, and a page that is still answers in one round trip.
  // A page that navigates loses the watcher with its document, so the settle asks for it again when the page says it is missing.
  let watched = false;
  let baseline = 0;

  async function settle() {
    const started = Date.now();
    let from = baseline;
    const answer = (why: string, state: Record<string, unknown> | null, detail?: string) => ({
      waitedMs: Date.now() - started,
      quietMs: Number(state?.quietMs) || 0,
      maxMs: SETTLE_MAX_MS,
      changes: Math.max(0, (Number(state?.changes) || 0) - from),
      why,
      visibility: state?.visibility ?? null,
      ...(detail ? { detail } : {})
    });

    const ask = async (expression: string): Promise<Record<string, unknown> | null> => {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true
      });
      return (result?.value ?? null) as Record<string, unknown> | null;
    };

    const watch = async () => {
      await ask(SETTLE_ARM_EXPRESSION);
      watched = true;
      baseline = 0;
      from = 0;
    };

    try {
      if (!watched) await watch();
      let state: Record<string, unknown> | null = null;
      const polls = Math.ceil(SETTLE_MAX_MS / SETTLE_POLL_MS);
      for (let poll = 0; poll <= polls; poll += 1) {
        if (poll > 0) await sleep(SETTLE_POLL_MS);
        state = await ask(SETTLE_READ_EXPRESSION);
        if (!state || state.missing) {
          await watch();
          state = await ask(SETTLE_READ_EXPRESSION);
          if (!state || state.missing) return answer('failed', null, 'the page lost the settle watcher');
        }
        if (Number(state.quietMs) >= SETTLE_QUIET_MS) {
          baseline = Number(state.changes) || 0;
          return answer('quiet', state);
        }
      }
      baseline = Number(state?.changes) || baseline;
      return answer('deadline', state);
    } catch (error: unknown) {
      return answer('failed', null, String((error as Error)?.message ?? error));
    }
  }

  async function waitForIdle({ timeoutMs = 10000, intervalMs = 100, readyState = 'complete' }: { timeoutMs?: number; intervalMs?: number; readyState?: string } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await primitives.evaluate('document.readyState');
      if (state === readyState) return state;
      if (Date.now() >= deadline) return state;
      await sleep(intervalMs);
    }
  }

  // WHY A QUIET PAGE STILL PACES THE WAIT.
  // The settle used to cost 41 ms on every check, so the wait never asked twice in a breath.
  // A page that is already quiet costs the settle nothing, so the wait would ask again as fast as the page can answer.
  // So a check that found nothing waits one settle beat before the next one: the page is watched, not hammered.
  async function waitForMutation<T>(read: () => Promise<T>, predicate: (state: T) => boolean, { timeoutMs = 10000, now: clock = now }: { timeoutMs?: number; now?: () => number } = {}): Promise<T> {
    const deadline = clock() + timeoutMs;
    for (;;) {
      const state = await read();
      if (predicate(state)) return state;
      if (clock() >= deadline) return state;
      const settled = await primitives.settle();
      if (Number(settled?.waitedMs) < SETTLE_POLL_MS) await sleep(SETTLE_POLL_MS);
    }
  }

  // WHY THE WAIT ASKS THE PAGE WHAT IT IS BEFORE IT TRUSTS ITS TEXT.
  // This used to ask the url whether the page was a document editor and then read the document for it, which is the site recognition the drive no longer carries.
  // A length bar is not the decision either: measured on a real Google Doc, the chrome around the canvas holds 1,312 characters of its own, so a wait that only measures length polls the toolbar forever and reports found:false for text that is right there in the document.
  // So the probe decides once: a page with no canvas takes the cheap DOM answer, and a canvas page is read through the ladder, which reaches past the chrome.
  async function waitForText(text: string, { timeoutMs = 10000, intervalMs: _intervalMs = 100, absent = false, now: clock = now }: { timeoutMs?: number; intervalMs?: number; absent?: boolean; now?: () => number } = {}) {
    const surface = await probeSurface({ evaluate: primitives.evaluate });
    const domLeads = surface.canvas.value !== true;
    return waitForMutation(
      async () => {
        if (domLeads) {
          const state = await readState();
          if (String(state.text ?? '').trim().length >= MIN_DOM_TEXT) return state;
        }
        return read();
      },
      (state: Record<string, unknown>) => String(state.text ?? '').includes(text) !== absent,
      { timeoutMs, now: clock }
    );
  }

  async function waitForRow({ role, name, timeoutMs = 10000, intervalMs: _intervalMs = 150, absent = false, now: clock = now }: { role: string; name: string; timeoutMs?: number; intervalMs?: number; absent?: boolean; now?: () => number }) {
    const want = String(name ?? '').toLowerCase();
    const seen: Array<string | null> = [];
    const state = await waitForMutation(
      async () => {
        const rows = await readRows(120);
        const hit = rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase() === want)
          ?? rows.find((r) => r.role === role && String(r.name ?? '').toLowerCase().includes(want));
        seen.push(typeof hit?.name === 'string' ? hit.name : null);
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

  // WHY ONLY A STILL PAGE IS REPORTED AS SETTLED.
  // A wait that ran out of budget on a page that never stopped moving has not watched anything settle, and the look after it has to settle for itself.
  async function waitForStill({ timeoutMs = 8000, quietMs = 120, intervalMs: _intervalMs = 60, limit = 120, now: clock = now }: { timeoutMs?: number; quietMs?: number; intervalMs?: number; limit?: number; now?: () => number } = {}) {
    const started = clock();
    let previous: string | null = null;
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
    return { still: out.still, ms: out.ms, checks: out.checks, settled: out.still === true && out.checks > 1 };
  }

  // WHY A URL WAIT IS A PRIMITIVE AND NOT A POLL AT THE CALL SITE.
  // A post-login redirect or a SPA route change is readable only when the page's own url is read again - a text wait cannot see it, a still wait answers on the wrong page.
  // The poll lives here beside the other waits so one answer envelope covers every way a page can be given time to move.
  async function waitForUrl({ contains, matches, timeoutMs = 10000, now: clock = now }: { contains?: string | null; matches?: string | null; timeoutMs?: number; now?: () => number } = {}) {
    const want = String(contains ?? '').trim();
    const pattern = String(matches ?? '').trim();
    if (!want && !pattern) throw new Error('wait_for_url needs contains (substring) or matches (regular expression)');
    let regex: RegExp | null = null;
    if (pattern) {
      try {
        regex = new RegExp(pattern);
      } catch {
        throw new Error(`wait_for_url: matches is not a valid regular expression: ${pattern}`);
      }
    }
    const urlOf = (state: Record<string, unknown>): string => String(state.url ?? '');
    const hit = (url: string): boolean => (want !== '' && url.includes(want)) || (regex !== null && regex.test(url));
    const state = await waitForMutation(
      readState,
      (settled: Record<string, unknown>) => hit(urlOf(settled)),
      { timeoutMs, now: clock }
    );
    const url = urlOf(state);
    return { found: hit(url), url, timeoutMs };
  }

  return { settle, waitForIdle, waitForMutation, waitForText, waitForRow, waitForStill, waitForUrl };
}