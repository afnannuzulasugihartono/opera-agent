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
- One active work branch: `test/phase-a-latency-measurement` at `0108f48`, local and
  remote identical. **Phases A, B, C and D are all complete.** Not merged; merging
  is owner-only.
- Gate evidence on `0108f48`: `npm test` **762/762**, `npm run check` ok (26 browser
  primitives, 92 runtime safety files, version 1.6.13), and **all 9 CircleCI check-runs
  plus Vercel green**, verified per check-run rather than from the roll-up. The
  browser harness was not run locally; `ci-browser` is green on the head, but
  Phase D touches real input and debugger attach, so live browser acceptance is
  still outstanding and matters more here than in the earlier phases.
- Baseline evidence on `5fe91aa`: 659/659, 8 CircleCI workflows plus Vercel green.

## Deployment hazard on this branch — read before deploying

**This branch carries TWO unapplied migrations, and CI applies none of them.**
Apply both, in this order, before deploying the bridge:

1. `20261002090000_opera_agent_claim_wait.sql`
2. `20261003110000_opera_agent_claim_budget_and_wait_ramp.sql`

`.circleci/config.yml` only runs `deno lint` and `deno check`, and
`docs/runbook.md` treats a migration as an environment change that is owner-only.

If the bridge is deployed before migration 1, `opera_claim_next_wait` does not
exist, `rpc()` throws, `pull` returns 500, and **the extension can no longer
receive any command at all.** That is a total loss of the control path, not a
degradation. There is deliberately no fallback to the single-shot
`opera_claim_next`, so the failure cannot be masked.

Migration 2 is additive but note it **drops `opera_run_fast`** and resets
`created_at`'s default. The drop is reversible by replaying
`20260922000000_opera_agent_ut_etw.sql`; the historical `default now()` stays in
the core migration, unrewritten.

## Do not touch

- **`stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D"**,
  on `feat/semantic-runtime-1.6.0`. Do **not** pop, apply, delete, or build from
  it. Inspect it only against canonical Milestone 8E scope if 8E ever resumes.
  8E is paused and must not start implicitly.
- `archive/*` tags, `docs/releases/`, and the existing sections of
  `docs/context-archive.md` are historical records; do not rewrite them.

## What happened most recently

All four phases are done. Arc, oldest first:

- **Goal:** make Opera Agent faster and easier for AI to drive. A full architecture
  pass mapped the AI-facing MCP surface, the gateway and SQL queue, and the
  in-browser execution path.
- **Phase A, `8e78b5c`** — measurement only, no runtime change. Queue wait p50
  **830ms** / p95 **1910ms**, the fast window only 400ms of 12000ms so ~97% of
  waits paid the idle rate, 14 claim calls per window. Burst ceiling: only **8 of
  26** primitives expressible; all 8 `tabs.*` and all 4 `media.*` un-burstable.
- **B1+B2, `016ed52`** — the pull wait moved from the bridge into Postgres. Queue
  wait **830→118ms (7.0x)** p50, **1910→238ms (8.0x)** p95, HTTP trips per window
  **14→1**, database load only **1.1x** (one index-served lookup per cycle).
- **B2 extension, `3740027`** — a watch-fired trusted click leaked its debugger
  session, leaving Chrome's "started debugging this browser" bar stuck on the tab;
  nothing listened for `onDetach`, so a cached `attached: true` outlived the
  debugger; both `executeCommand` timeout races leaked their timers.
- **B3 SQL, `f16b88a`** — the execution budget started at enqueue, so a command
  queued while the device was offline could be swept to `expired` mid-execution and
  its result silently discarded. Both claim paths now restart the clock from
  `timeout_ms`; `opera_watch_events_wait` went from 6400 to 648 iterations per 32s
  call; `created_at` defaults to `clock_timestamp()` so queue order is strict.
- **Phase C, `bb46af1`** — four defects on the AI-facing surface. The command path
  moved onto the `opera_await_adaptive` ramp the gateway already used (5 ms first
  response, same iteration count, identical envelope). `wait_events` began
  honouring the `timeoutMs` it had been ignoring, and its `outputSchema` was
  corrected: it advertised the command envelope while the SQL returns
  `{ok, events, cursor, count}`. The 4.5 KB instructions now name `start_watch`,
  `wait_events` and `run_workflow`, which exist to remove round trips but had never
  been mentioned. Twelve digest values recomputed across nine files.
- **Phase D, `0108f48`** — a burst step may carry an optional `tabId`, closing the
  structural gap Phase A measured: a real task needed a model round trip at every
  navigation because all 8 `tabs.*` and 4 `media.*` primitives were un-burstable.
  A step that switches tab while holding a `refFromStep` is refused with
  `BURST_CROSS_TAB_REF`, because a ref is a live handle into one document.
  `withDebugger` releases and re-keys the session instead of throwing. Still 26
  primitives, no new action, same 1-8 step and 12000ms budget, VM's `CROSS_TAB`
  fence untouched.
- **Declined:** renaming the 22 MCP tools to dotted form — see the blind-alley
  entry in `docs/project-context.md`.

## What remains

**All four phases are complete.** Nothing is in progress. None of these may start
without an explicit owner instruction:

- **An optimistic `ensureContent`.** `content.ping` per call is redundant in the
  normal case and costs 2 IPCs, two or three times per action. A behaviour change
  rather than a bug fix, so it needs its own before/after measurement.
- **The gateway's redundant `last_seen_at` re-read**: four HTTP round trips per
  command where three would do.
- **A navigation action inside a burst.** Phase D let a step *address* a tab but
  did not add `navigate` to the burst vocabulary, so a burst still cannot navigate
  on its own. A further capability change, with its own audit.
- **Unmeasured, and the largest unknown:** how many model round trips a real task
  actually costs. Every latency figure here is a deterministic model of the server
  and extension path, not an observation of the model loop.

Editing `opera-agent-mcp/index.ts` is not a one-line change: `sourceSha256` in
`tests/fixtures/mcp-contract-v1.json` is asserted by 7 test files, and
`reactive-vm-contract-v1.json` folds it into `inventory.digest`.
`extension/background.js` and `extension/content.js` are pinned by blob SHA in
`tests/helpers/boundary-locks.mjs`. Re-freezing is the designed workflow, but it
needs a recorded reason in the same commit.

## Still open, unchanged

Carried over from earlier sessions and untouched by the four phases:

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

**Await an owner decision.** Phases A through D are closed and green on `0108f48`.

Phase D is a capability change on real input and debugger attach, so it needs an
**independent audit and live browser acceptance** before any deployment; neither has
happened. Both migrations on this branch remain unapplied. Do not apply a migration,
merge, or deploy anything without an explicit owner instruction.

## Rules for the next session

- Before the first write, verify the tree is clean and `HEAD` equals the branch
  tip you are on. Resolve the branch with `git branch --show-current`.
- Do not merge, promote, or sign anything without an explicit owner instruction.
- A claim in a commit message or a test comment is not evidence. Make the lock
  fail before you repeat it.
- Relocate detail into `docs/context-archive.md` once it stops being actionable
  rather than appending it here; this file has a 150-line cap.
