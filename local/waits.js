// @last-edited: 2026-10-23 UTC+7.
// @title: waits — event-driven waits built on the page mutation settle.
// @state: one mutation wait, then text, row and stillness built on it.
// @dependencies: none.

export function createWaits({ readState, readRows, isDocsDocument, read, primitives, now = Date.now }) {
  async function waitForMutation(read, predicate, { timeoutMs = 10000, now: clock = now } = {}) {
    const deadline = clock() + timeoutMs;
    for (;;) {
      const state = await read();
      if (predicate(state)) return state;
      if (clock() >= deadline) return state;
      await primitives.settle();
    }
  }

  async function waitForText(text, { timeoutMs = 10000, intervalMs = 100, absent = false, now: clock = now } = {}) {
    return waitForMutation(
      async () => {
        const probe = await readState();
        return isDocsDocument(probe.url) ? await read() : probe;
      },
      (state) => state.text.includes(text) !== absent,
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

  return { waitForMutation, waitForText, waitForRow, waitForStill };
}