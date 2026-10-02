# Opera Agent next-session handoff

> **Scope:** what just happened and what to do next. Nothing else.
> **Cap:** keep this file under roughly 150 lines. When a session's detail is no
> longer actionable, move it to `docs/context-archive.md` rather than appending
> here. This file grew to 67 sections and 135 KB before that rule existed, and
> both context files were read at the start of every task.
>
> Durable facts — the ones that must never be lost — live in
> `docs/project-context.md`. Historical detail lives in `docs/context-archive.md`.

## Current state (2026-10-02)

- `main` and `origin/main` are both at `5fe91aa`.
- One active work branch: `test/phase-a-latency-measurement` at `016ed52`, local and
  remote identical. Phases A and B1+B2 are on it. **Not merged; merging is owner-only.**
- Gate evidence on `016ed52`: `npm test` **701/701**, `npm run check` ok (26 browser
  primitives, 89 runtime safety files, version 1.6.13), and **all 9 CircleCI check-runs
  plus Vercel green**, verified per check-run rather than from the roll-up. The
  browser harness was not run locally; `ci-browser` is green on the head.
- Baseline evidence on `5fe91aa`: 659/659, 8 CircleCI workflows plus Vercel green.

## Deployment hazard on this branch — read before deploying

**Apply `supabase/migrations/20261002090000_opera_agent_claim_wait.sql` BEFORE
deploying the bridge.** CI does not apply migrations; `.circleci/config.yml` only
runs `deno lint` and `deno check`, and `docs/runbook.md` treats a migration as an
environment change that is owner-only.

If the order is reversed, `opera_claim_next_wait` does not exist, `rpc()` throws,
`pull` returns 500, and **the extension can no longer receive any command at all.**
That is a total loss of the control path, not a degradation. There is deliberately
no fallback to the single-shot `opera_claim_next`, so the failure cannot be masked.

## Do not touch

- **`stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D"**,
  on `feat/semantic-runtime-1.6.0`. Do **not** pop, apply, delete, or build from
  it. Inspect it only against canonical Milestone 8E scope if 8E ever resumes.
  8E is paused and must not start implicitly.
- `archive/*` tags, `docs/releases/`, and the existing sections of
  `docs/context-archive.md` are historical records; do not rewrite them.

## What happened most recently

1. **Owner goal restated: make Opera Agent faster and easier for AI to drive**,
   specifically closer to controlling a browser directly. A full architecture pass
   mapped the AI-facing MCP surface, the gateway and SQL queue, and the in-browser
   execution path, and produced a ranked gap list.
2. **Phase A delivered as `8e78b5c` on `test/phase-a-latency-measurement`** —
   measurement only, no runtime behavior changed. Four new files:
   `tests/helpers/pull-cadence-sim.mjs` plus `latency-bridge-cadence`,
   `latency-sql-ramps`, and `latency-burst-budget` tests.
3. **Measured, not estimated:** 14 `opera_claim_next` calls per 12s window, 4200
   claim calls/hour/device, queue wait p50 **830ms** and p95 **1910ms**; the
   fast window is only 400ms of 12000ms so ~97% of waits are idle-rate. A
   four-round-trip reference task pays ~3320ms of queue wait before any work
   starts — about 5x the 161.6ms a burst itself takes to execute.
4. **Burst ceiling measured:** only 8 of 26 primitives are expressible in a burst.
   All 8 `tabs.*` and all 4 `media.*` are un-burstable. This is the structural
   reason a real task still needs several model round trips.
5. **MCP tool renaming was investigated and declined** — see the blind-alley entry
   in `docs/project-context.md`.
6. **Phase B1+B2 delivered as `016ed52`.** `opera_claim_next_wait` moves the pull wait
   from the bridge into Postgres; `pull` now makes one call per window and the
   `FAST_PULL_*` / `IDLE_PULL_*` constants are gone. Measured before/after on the
   same model: queue wait **p50 830→118ms (7.0x)**, **p95 1910→238ms (8.0x)**,
   max **2030→251ms**; HTTP trips per window **14→1**, per hour **4200→300**.
   Database load rises only **1.1x** (21000→23100 queries/hour) because the cycle
   body is a single index-served lookup; running the whole `opera_claim_next` body
   per iteration would have been roughly 18x.

## The plan these measurements feed

- **Phase B, remaining items — cheap and reversible, no audit needed:** `expires_at`
  moved from enqueue to claim, an adaptive ramp for `opera_watch_events_wait`,
  `created_at` to `clock_timestamp()`, removal of the dead `opera_run_fast`, an
  optimistic `ensureContent`, the debugger leak at `background.js:1330`, a
  `chrome.debugger.onDetach` listener, clearing the never-cleared `Promise.race`
  timers, `wait_events` honouring its declared `timeoutMs`, and dropping the
  gateway's redundant `last_seen_at` re-read. The bug fixes were deliberately held
  out of B1+B2 so the before/after measurement would not be ambiguous.
- **Phase C, needs an audit:** move the MCP path from flat `opera_await` to the
  adaptive ramp, and fix the instructions, which never mention `start_watch`,
  `wait_events`, or `run_workflow` even though all three exist to remove round
  trips.
- **Phase D, needs an audit, largest win:** let a burst navigate and switch tabs.
  `background.js:865` resolves `tabId` once and `withDebugger` throws
  `"Burst debugger cannot switch tabs."`, so no navigation can be batched.

Locks that had to be replaced because B1+B2 removed the behavior they asserted:
`tests/efficiency.test.mjs` and the bridge block in `scripts/check.mjs`. Both now
assert the *absence* of the old cadence constants. Phase A's own tests then failed,
which is why the "before" baseline is pinned as `RECORDED_BRIDGE_CADENCE` in
`tests/helpers/pull-cadence-sim.mjs` rather than read from live source.

Editing `opera-agent-mcp/index.ts` is not a one-line change: `sourceSha256` in
`tests/fixtures/mcp-contract-v1.json` is asserted by 7 test files, and
`reactive-vm-contract-v1.json` folds it into `inventory.digest`.
`extension/background.js` and `extension/content.js` are pinned by blob SHA in
`tests/helpers/boundary-locks.mjs`. Re-freezing is the designed workflow, but it
needs a recorded reason in the same commit.

## Still open, unchanged

1. **Release so the shipped CRX contains the Options page.** The manifest in
   `main` registers `options_page`, but the installed CRX predates it. Requires the
   private signing key.
2. **Remove the unused `activeTab` manifest permission.** Verified unused; held
   out of scope because it touches the extension's declared surface.
3. **Commission the audit** that `docs/audit-request-device-revoke-and-retention.md`
   asks for.
4. **SonarCloud project access** — the pre-existing C Reliability wall on New Code
   cannot be investigated without it.
5. **Publishable-key rotation** — a production secret, deliberately untouched.

## Exact next action

Phase A and B1+B2 are both closed and green on `016ed52`. Report the measured
7.0x median improvement and ask whether to continue with the remaining Phase B
items — the bug fixes first, since the debugger leak at `background.js:1330` leaves
a "debugging this browser" banner stuck on the user's tab until it is closed.

Do not apply the migration or deploy anything without an explicit owner
instruction; see the deployment hazard above. Do not begin Phase C or D without one
either — both change the public MCP surface.

## Rules for the next session

- Before the first write, verify the tree is clean and that `HEAD` equals the
  branch tip you are on. Do not assume `main` is the baseline; resolve the current
  branch with `git branch --show-current` and its tip with `git log -1`.
- Do not merge, promote, or sign anything without an explicit owner instruction.
- A claim in a commit message or a test comment is not evidence. If it says
  something is locked, make the lock fail before you repeat it.
- This file has a 150-line cap. When a session's detail stops being actionable,
  relocate it into `docs/context-archive.md` rather than appending here.
