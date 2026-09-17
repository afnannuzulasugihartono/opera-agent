# Opera Agent next-session handoff

Last synchronized: 2026-09-17.

Checkpoint 8D is fully closed. Performance Track P remains the user-selected active
track before 8E. P0 is accepted. P1 is a **FINAL CANDIDATE** awaiting exact-head
CircleCI + Vercel/status checks. P2 has not started. Checkpoint 8E remains
paused/not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable release: extension 1.6.0, protocol 1, 26 browser capabilities, 18 public MCP
tools, unchanged signing/pairing, signed rollback 1.5.2.

Durable 8D closeout head:
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`.

Accepted P0 head:
`699578904e2f19ea713a0933632331cad7299c11` with CircleCI #76 and Vercel SUCCESS.

Canonical performance plan:
`docs/delta-first-performance-plan.md`.

P1 acceptance candidate:
`docs/delta-first-performance-p1.md`.

## P1 implementation

P1 adds a pure bounded ephemeral semantic working-state layer only:

- `lib/semantic-working-state-p1.js`
- `tests/semantic-working-state-p1.test.mjs`
- `tests/semantic-working-state-p1-adversarial.test.mjs`

The state is bound to tenant, device, tab, document generation, and runtime epoch.
It retains sanitized semantic entity metadata, materialized view state, dependency
fingerprints, semantic revision, last source/result revision, and replay digest.

Continuity behavior:

- bootstrap requires trusted RESET/full observation;
- exact contiguous revisions only;
- exact duplicate replay is idempotent;
- incompatible duplicate, older input, revision gap, cross-scope/restart,
  ambiguity, overflow, expiry, and eviction fail closed;
- RESET/full-snapshot-required input is never merged into existing continuity;
- the still-present full rich observation is used as a P1 correctness oracle, so a
  semantic or view change missing from the asserted delta is rejected before state
  mutation.

The working state excludes raw page text, raw labels, href/private query material,
form values, and sensitive entities. It is process memory only and adds no durable
storage.

**Important:** P1 does not yet make delta the reasoning payload. Full rich
observation delivery remains unchanged. P2 owns delta-first reasoning delivery.

## P1 evidence

Tests-first chain:

- `644b4b9e48c12dc5f65b08e3176c4cca77c8be62` — P1 contract tests
- `f6c95ab7f0b37e28d038a832d411ee4f4da19cc5` — implementation
- `8f450d6c911628e234b19bcd641c37c5b60cc7eb` — duplicate/out-of-order contract correction
- `27e683af29de562d91ca2303d5eb8e74606e2700` — adversarial INSERT/MOVE/REMOVE and mismatch tests

Pre-closeout automated evidence:

- `8f450d...`: CircleCI #79 SUCCESS + Vercel SUCCESS
- `27e683...`: CircleCI #80 SUCCESS + Vercel SUCCESS

CircleCI runs the full Node suite, `npm run check`, and controlled Chromium
extension regression. No extension/browser code was changed by P1.

## Exact P1 closeout gate

The exact P1 final candidate is the current branch head after this handoff commit.
Before calling P1 accepted:

1. Fetch the current branch head and confirm no later commit replaced this handoff.
2. Require CircleCI and Vercel/status checks on that exact head to be SUCCESS.
3. Pending/queued/in-progress => STOP.
4. Failure => diagnose only the P1 failure.
5. If both checks are SUCCESS, P1 is accepted without a second status-only commit.
6. Stop after reporting P1 accepted.
7. Start **P2 — delta-first observation pipeline** only after explicit user
   continuation.
8. Do not start 8E while Performance Track P remains active.

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

1. P0 — accepted;
2. P1 — current final candidate;
3. P2 — delta-first observation pipeline;
4. P3 — multi-signal coalescer and relevance gate;
5. P4 — event-driven local Reactive VM execution;
6. P5 — paired controlled + real-Opera performance/correctness acceptance.

After P5 acceptance and the required independent track audit, return to frozen
Milestone 8 at 8E unless the user changes direction.

## Closed 8D state

The real hosted Edge concurrency probe passed exactly once on runtime head
`cf645799968458d55d5c2b391a5d354c369337b6`. Final read-only overall audit Jules
session `17943137394205042765` returned PASS. Durable 8D roadmap closeout finished
at `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab` with CircleCI #69 and Vercel
SUCCESS, and audit PR #43 was closed without merge.

Do not rerun `RUN_8D_EDGE_CONCURRENCY.cmd`; its one-run authorization was consumed.

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
