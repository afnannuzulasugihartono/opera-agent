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
- One active work branch: `test/phase-a-latency-measurement` at `bb46af1`, local and
  remote identical. Phases A, B and C are on it. **Not merged; merging is owner-only.**
- Gate evidence on `bb46af1`: `npm test` **746/746**, `npm run check` ok (26 browser
  primitives, 92 runtime safety files, version 1.6.13), and **all 9 CircleCI check-runs
  plus Vercel green**, verified per check-run rather than from the roll-up. The
  browser harness was not run locally; `ci-browser` is green on the head.
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

Phase A and all of Phase B are done. The measured arc, oldest first:

- **Goal:** make Opera Agent faster and easier for AI to drive, closer to
  controlling a browser directly. A full architecture pass mapped the AI-facing
  MCP surface, the gateway and SQL queue, and the in-browser execution path.
- **Phase A, `8e78b5c`** — measurement only, no runtime change. 14
  `opera_claim_next` calls per 12s window, queue wait p50 **830ms** / p95
  **1910ms**, the fast window only 400ms of 12000ms so ~97% of waits paid the
  idle rate. Burst ceiling: only **8 of 26** primitives are expressible; all 8
  `tabs.*` and all 4 `media.*` are un-burstable.
- **B1+B2, `016ed52`** — the pull wait moved from the bridge into Postgres.
  Queue wait **830→118ms (7.0x)** p50, **1910→238ms (8.0x)** p95, HTTP trips per
  window **14→1**, database load only **1.1x** because the cycle body is one
  index-served lookup.
- **B2 extension lifecycle, `3740027`** — a watch-fired trusted click leaked its
  debugger session, leaving Chrome's "started debugging this browser" bar stuck on
  the tab; nothing listened for `onDetach`, so a cached `attached: true` could
  outlive the debugger; and both `executeCommand` timeout races leaked their
  timer. All three fixed, no protocol change.
- **B3 SQL, `f16b88a`** — the execution budget started at enqueue, so a command
  queued while the device was offline could be swept to `expired` mid-execution
  and its result silently discarded. Both claim paths now restart the clock from
  `timeout_ms`; `opera_watch_events_wait` went from 6400 to 648 iterations per
  32s call; `created_at` defaults to `clock_timestamp()` so queue order is strict.
- **Phase C, `bb46af1`** — four defects on the AI-facing surface. The command path
  moved onto the `opera_await_adaptive` ramp the gateway already used (5 ms first
  response, same iteration count, identical envelope). `wait_events` began
  honouring the `timeoutMs` it had been ignoring, and its `outputSchema` was
  corrected: it advertised the command envelope while the SQL returns
  `{ok, events, cursor, count}`. The 4.5 KB instructions now name `start_watch`,
  `wait_events` and `run_workflow`, which exist to remove round trips but had
  never been mentioned. Twelve digest values recomputed across nine files.
- **Declined:** renaming the 22 MCP tools to dotted form — see the blind-alley
  entry in `docs/project-context.md`.

## The plan these measurements feed

- **Phase D is the only work left, and it needs an independent audit before
  deployment, not before implementation.** Let a burst navigate and switch tabs.
  `runBurst` resolves `tabId` once and `withDebugger` throws
  `"Burst debugger cannot switch tabs."`, so no navigation can be batched and every
  real browsing task still costs several model round trips. This is where the
  literature's 2x latency and 11.8x cost reduction live (ActionEngine, arXiv
  2602.20502), whose target is one LLM call per task rather than one per step.
- **Held back deliberately:** an optimistic `ensureContent`. The manifest already
  declares `content_scripts` at `document_start`, so the per-call ping is
  redundant in the normal case, but it is a behaviour change rather than a bug
  fix and needs its own before/after measurement.
- **Also untouched:** the gateway's redundant `last_seen_at` re-read, which
  `opera_verify_device` already fetched. Cheap, but off the AI's path, and not
  bundled into a commit whose measurements mattered.

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

**Phases A, B and C are closed and green on `bb46af1`.** Await an owner decision
on Phase D, the only work left: letting a burst navigate and switch tabs, which is
where the measured 2x latency and 11.8x cost reduction from the literature lives.

Phase C changed the public MCP surface, so an **independent audit is required
before deployment** — not before the commit, which is why Phase C proceeded once
approved. Both migrations on this branch remain unapplied.

Do not apply either migration, do not merge, and do not deploy anything without an
explicit owner instruction.

## Rules for the next session

- Before the first write, verify the tree is clean and that `HEAD` equals the
  branch tip you are on. Do not assume `main` is the baseline; resolve the current
  branch with `git branch --show-current` and its tip with `git log -1`.
- Do not merge, promote, or sign anything without an explicit owner instruction.
- A claim in a commit message or a test comment is not evidence. If it says
  something is locked, make the lock fail before you repeat it.
- This file has a 150-line cap. When a session's detail stops being actionable,
  relocate it into `docs/context-archive.md` rather than appending here.
