# Opera Agent next-session handoff

Last synchronized: 2026-09-17.

Checkpoint 8D is fully closed. Performance Track P remains the user-selected active
track before 8E. P0, P1, and P2 are accepted. P3 is a **FINAL CANDIDATE** awaiting
exact-head CircleCI + Vercel/status checks on the documentation-closeout head. P4
has not started. Checkpoint 8E remains paused/not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable release: extension 1.6.0, protocol 1, 26 browser capabilities, 18 public MCP
tools, unchanged signing/pairing, signed rollback 1.5.2.

Durable 8D closeout head:
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`.

Accepted P0 head:
`699578904e2f19ea713a0933632331cad7299c11` with CircleCI #76 + Vercel SUCCESS.

Accepted P1 head:
`cbf3259a337d92410a5ba805dd0fd987a51c1bc5` with CircleCI #85 + Vercel SUCCESS.

Accepted P2 head:
`8621e2dc454f8e8f1e977c350522e6fb2b5dc51d` with CircleCI #91 + Vercel SUCCESS.

P3 implementation head:
`9309debd0db66993e99519f7015bf81a3c0804dd` with CircleCI #93 + Vercel SUCCESS.

Canonical performance plan:
`docs/delta-first-performance-plan.md`.

P3 acceptance candidate:
`docs/delta-first-performance-p3.md`.

## P3 implementation

P3 adds a bounded multi-signal coalescer and relevance gate only:

- `lib/multi-signal-relevance-p3.js`
- `tests/multi-signal-relevance-p3.test.mjs`

It wraps the accepted P2 delta-first observation pipeline. P2 remains the continuity
and canonical-state oracle.

Accepted decisions:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

Accepted signals:

```text
ACTION_RESULT
DOM_MUTATION
GEOMETRY_RESIZE
NAVIGATION_HISTORY
RECONNECT_RESET
SCROLL_VIEWPORT
SEMANTIC_MUTATION
WAIT_CONDITION
```

Each open epoch is isolated by tenant + device + tab + document generation + runtime
epoch and bounded by signal count, affected dependency-key count, and age.

Signals retain only bounded type/entity/view/wait metadata. Arbitrary raw signal
text, href, value, nested payloads, model/page relevance hints, and instructions are
ignored and cannot grant wake/suppress authority.

Task relevance authority is accepted only from
`ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES` context carrying a bounded goal ID, positive
ledger revision, canonical `sha256:` ledger digest, and explicit bounded reason/
continuation dependency groups.

Behavior:

- trusted RESET/bootstrap -> `REASON_REQUIRED` with P2 full snapshot;
- relevant accepted reason dependency -> `REASON_REQUIRED` with P2 compact patch;
- accepted continuation-only dependency -> `APPLY_AND_CONTINUE`, no reasoning wake;
- unrelated accepted-context change -> `IGNORE_FOR_TASK`, no reasoning wake;
- in both suppressed cases canonical P2/P1 state still advances;
- `REASON_REQUIRED` has precedence over continuation;
- missing/invalid/untrusted/oversized dependency context -> conservative reasoning;
- `NAVIGATION_HISTORY` / `RECONNECT_RESET` -> conservative reasoning;
- signal overflow / affected-key overflow / epoch expiry -> conservative reasoning;
- any P2 reset-required or lost continuity -> conservative full-snapshot reasoning;
- exact replay with no new relevant signal -> no duplicate wake.

## P3 evidence

Tests-first chain:

- `388df28d5795da2cb1fe72ece2ff25f46b7411d5` — frozen P3 contract tests; CircleCI #92 expected red because `lib/multi-signal-relevance-p3.js` was absent; Vercel SUCCESS
- `9309debd0db66993e99519f7015bf81a3c0804dd` — implementation; CircleCI #93 SUCCESS + Vercel SUCCESS

From accepted P2 head to P3 implementation head, only the P3 library and P3 test were
added. P3 tests freeze byte hashes for the P2 adapter, extension content/background/
manifest, public MCP `read_page` source, and Reactive VM 7B/7C/7D sources.

Controlled irrelevant-mutation-storm acceptance:

- 10 irrelevant epochs × 128 signals = 1,280 irrelevant signals;
- later relevant signal = 1;
- total raw signals = **1,281**;
- unnecessary reasoning wakeups during irrelevant epochs = **0**;
- total reasoning wakeups after later relevant update = **1**;
- later relevant update detected exactly = **1/1**;
- relevant-signal loss = **0**;
- false completion = **0**;
- foreground takeover = **0**.

This is controlled P3 evidence only. P4's >=60% repetitive reasoning/tool-round-trip
target and P5 real-Opera/end-to-end performance gates remain future work.

P3 does not add extension observer wiring, browser primitives, public MCP changes,
VM execution, Supabase production changes, signing/pairing changes, transaction
authority, or Checkpoint 8E.

## Exact P3 closeout gate

The exact P3 final candidate is the branch head containing the P3 tests,
implementation, acceptance record, synchronized performance plan, roadmap, project
context, and this handoff.

Before calling P3 accepted:

1. Fetch the current branch head and confirm it is still the final-candidate commit.
2. Require CircleCI and Vercel/status checks on that exact head to be SUCCESS.
3. Pending/queued/in-progress => **STOP**.
4. Failure => diagnose only the P3 failure.
5. If both checks are SUCCESS, P3 is accepted without a second status-only commit.
6. Stop after reporting P3 accepted.
7. Start **P4 — event-driven local Reactive VM execution** only after explicit user
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

Checkpoint order:

1. P0 — accepted;
2. P1 — accepted;
3. P2 — accepted;
4. P3 — current final candidate;
5. P4 — event-driven local Reactive VM execution;
6. P5 — paired controlled + real-Opera performance/correctness acceptance.

After P5 acceptance and the required independent track audit, return to frozen
Milestone 8 at 8E unless the user changes direction.

## Closed 8D state

The real hosted Edge concurrency probe passed exactly once on runtime head
`cf645799968458d55d5c2b391a5d354c369337b6`. Final read-only overall audit Jules
session `17943137394205042765` returned PASS. Durable 8D roadmap closeout finished
at `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab` with CircleCI #69 + Vercel SUCCESS.

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
