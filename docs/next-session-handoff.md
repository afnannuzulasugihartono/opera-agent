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
- One active work branch: `test/phase-a-latency-measurement` at `8e78b5c`, local and
  remote identical. Phase A only; **not merged, and merging is owner-only**.
- Gate evidence on `8e78b5c`: `npm test` **686/686** (was 659), `npm run check` ok
  (26 browser primitives, 88 runtime safety files, version 1.6.13). Browser and
  cloud gates were **not** run because no runtime code changed. CircleCI and
  Vercel on this head are **not yet read** — do not treat this as accepted.
- Baseline evidence on `5fe91aa`: 659/659, 8 CircleCI workflows plus Vercel green.

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

## The plan these measurements feed

- **Phase B, cheap and reversible, no audit needed:** a SQL-side
  `opera_claim_next_wait` loop, `expires_at` moved from enqueue to claim, an
  adaptive ramp for `opera_watch_events_wait`, `created_at` to `clock_timestamp()`,
  removal of the dead `opera_run_fast`, an optimistic `ensureContent`, the debugger
  leak at `background.js:1330`, a `chrome.debugger.onDetach` listener, clearing the
  never-cleared `Promise.race` timers, `wait_events` honouring its declared
  `timeoutMs`, and dropping the gateway's redundant `last_seen_at` re-read.
- **Phase C, needs an audit:** move the MCP path from flat `opera_await` to the
  adaptive ramp, and fix the instructions, which never mention `start_watch`,
  `wait_events`, or `run_workflow` even though all three exist to remove round
  trips.
- **Phase D, needs an audit, largest win:** let a burst navigate and switch tabs.
  `background.js:865` resolves `tabId` once and `withDebugger` throws
  `"Burst debugger cannot switch tabs."`, so no navigation can be batched.

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

Read CircleCI and Vercel on `8e78b5c`. Then report the measured numbers to the
owner and let them choose whether Phase B is still worth it now that the queue
wait is known to be p50 830ms rather than an estimate. If Phase B proceeds, start
with the SQL migration because it is the only item that touches the measured
2000ms floor. Do not begin Phase C or D without an explicit owner instruction.

## Rules for the next session

- Before the first write, verify the tree is clean and that `HEAD` equals the
  branch tip you are on. Do not assume `main` is the baseline; resolve the current
  branch with `git branch --show-current` and its tip with `git log -1`.
- Do not merge, promote, or sign anything without an explicit owner instruction.
- A claim in a commit message or a test comment is not evidence. If it says
  something is locked, make the lock fail before you repeat it.
- This file has a 150-line cap. When a session's detail stops being actionable,
  relocate it into `docs/context-archive.md` rather than appending here.
