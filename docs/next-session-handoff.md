# Opera Agent next-session handoff

Last synchronized: 2026-09-17.

Checkpoint 8D is fully closed. Performance Track P is now the user-selected active
track before 8E. Checkpoint P0 is a **FINAL CANDIDATE** awaiting exact-head CI/status
checks. P1 has not started. Checkpoint 8E remains paused/not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable release: extension 1.6.0, protocol 1, 26 browser capabilities, 18 public MCP
tools, unchanged signing/pairing, signed rollback 1.5.2.

Accepted pre-P0 baseline / durable 8D closeout head:
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`.

P0 plan and acceptance artifacts:

- `docs/delta-first-performance-plan.md`
- `docs/delta-first-performance-p0.md`
- `tests/fixtures/delta-performance-baseline-p0-v1.json`
- `tests/delta-performance-p0.test.mjs`

P0 is contract/baseline/docs/tests only. It makes no runtime, extension, public MCP,
browser, database, Edge, OAuth, production, signing/pairing, or transaction-authority
change.

## Delta-First direction

Frozen target architecture:

```text
full snapshot bootstrap
  -> bounded semantic working state
  -> browser signals/change epochs
  -> semantic delta
  -> causal invalidation
  -> relevance gate
  -> local continuation or compact reasoning patch
```

Full snapshot remains the fail-closed recovery primitive after navigation,
revision gap/history loss, restart, ambiguity, overflow, privacy transition,
visual-only uncertainty, or another loss of provable continuity.

Checkpoint order:

1. P0 — plan freeze and baseline;
2. P1 — persistent semantic working state;
3. P2 — delta-first observation pipeline;
4. P3 — multi-signal coalescer and relevance gate;
5. P4 — event-driven local Reactive VM execution;
6. P5 — paired controlled + real-Opera performance/correctness acceptance.

After P5 acceptance and the required independent track audit, return to frozen
Milestone 8 at 8E unless the user changes direction.

## P0 evidence contract

Inherited accepted 1.6.0 browser evidence from `docs/benchmarks.md` is reference
baseline only:

- rich read median 19.83 ms;
- rich read p95 20.65 ms;
- enriched snapshot median 50,953 bytes;
- single-update delta 6,087 bytes;
- delta/snapshot ratio 12%;
- zero accepted focus changes and zero persisted sensitive values in that accepted
  browser baseline.

Do not call these fresh exact-head P0 live measurements. P0 intentionally performs
no real-site live acceptance.

Frozen P5 targets are:

- false completion = 0;
- foreground takeover = 0;
- stale-state action = 0;
- relevant-signal loss = 0;
- small-change reasoning payload reduction >= 75% median;
- repetitive reasoning/tool round-trip reduction >= 60% median;
- steady-state full-snapshot reduction >= 80%;
- long repetitive task median speedup >= 2.0x;
- simple-operation median regression <= 15%.

These are target gates, not achievements.

## Exact P0 acceptance gate

The exact final P0 candidate is the branch head containing the P0 artifacts plus
roadmap, project-context, and this handoff synchronization.

Before starting P1:

1. Fetch the current branch head and ensure it is still the P0 candidate head.
2. Require CircleCI and Vercel/status checks on that exact head to be SUCCESS.
3. CircleCI runs `npm test`, `npm run check`, and controlled Chromium regression;
   use that exact-head result as the automated P0 gate.
4. Pending/queued/in-progress => STOP.
5. Failure => diagnose only the P0 failure; do not start P1.
6. If required checks are SUCCESS, P0 is accepted without a second status-only
   commit.
7. Stop after reporting P0 accepted. Start P1 only after explicit user continuation.

## Closed 8D state

The real hosted Edge concurrency probe passed exactly once on runtime head
`cf645799968458d55d5c2b391a5d354c369337b6`. Final read-only overall audit Jules
session `17943137394205042765` returned PASS. Durable 8D roadmap closeout finished
at `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab` with CircleCI #69 and Vercel
SUCCESS, and audit PR #43 was closed without merge.

Post-probe production state remained policy OFF, legacy_gated false,
agent_commit_enabled false, DB host gate false, operator owner/namespace/lease null,
host false, and all synthetic 8D tables/goal-head rows zero. Do not rerun
`RUN_8D_EDGE_CONCURRENCY.cmd`; its one-run authorization was consumed.

## User-local state

Two accidental untracked 8E files remain preserved in a Git stash named
approximately `preserve accidental 8E files before completing checkpoint 8D`. Do
not pop, apply, delete, or use that stash automatically. Performance Track P does
not use it. If 8E later resumes, inspect it against the canonical 8E scope first.

## Permanent invariants

- one active writer;
- tests before behavior;
- repository/CI/production evidence outranks chat summaries;
- background-first browser operation;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print credentials or sensitive page values;
- action success is not task-completion proof;
- performance gains never justify stale-state action, false completion, missed
  relevant changes, or foreground takeover.
