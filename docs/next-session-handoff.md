# Opera Agent next-session handoff

Last synchronized: 2026-09-17.

Checkpoint 8D is fully closed. Performance Track P remains the user-selected active
track before 8E. P0, P1, P2, and P3 are accepted. P4 is a **FINAL CANDIDATE** awaiting
exact-head CircleCI + Vercel/status checks on the documentation-closeout head. P5 has
not started. Checkpoint 8E remains paused/not started.

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

Accepted P3 head:
`d5310508aeb5c156657bd4d4abd06a4d172daaba` with CircleCI #94 + Vercel SUCCESS.

P4 implementation head:
`460c3e7a1977792387c347762550aea554a07ebd` with CircleCI #96 + Vercel SUCCESS.

Canonical performance plan:
`docs/delta-first-performance-plan.md`.

P4 acceptance candidate:
`docs/delta-first-performance-p4.md`.

## P4 implementation

P4 adds a pure bounded local execution host only:

- `lib/event-driven-local-execution-p4.js`
- `tests/event-driven-local-execution-p4.test.mjs`

It composes the accepted P3 relevance gate with accepted Reactive VM 7D. P4 does not
replace or modify the Reactive VM grammar/core and does not widen its accepted
read-only effect surface.

Accepted local outcomes:

```text
IDLE
LOCAL_EFFECT_REQUIRED
LOCAL_TERMINAL
REASON_REQUIRED
```

Accepted typed yield reasons:

```text
AMBIGUITY
BUDGET_EXHAUSTED
CANCELLED
DECISION_REQUIRED
EXPIRED
FAILURE
RESET_REQUIRED
STABLE_BOUNDARY
SUCCESS
```

Local execution begins only when a P3 result is structurally valid and exactly
`APPLY_AND_CONTINUE` with:

- no reasoning wake requested;
- canonical state present;
- accepted relevance context;
- at least one matched continuation dependency;
- no matched reason dependency;
- no safety reason.

Malformed/self-asserted continuation authority fails conservative to reasoning.
`IGNORE_FOR_TASK` leaves a registered run idle. A P3 `REASON_REQUIRED` result never
starts or advances local execution.

Each local run is isolated by tenant + device + tab + document generation + runtime
epoch. The returned browser effect must also carry matching trusted tenant/device/
tab/document provenance before local continuation.

P4 advances the accepted Reactive VM only up to a bounded local-step slice and stops
at the first host/reasoning boundary:

- accepted read-only VM effect request;
- successful VM return;
- ambiguity/model-required suspension;
- VM failure;
- VM limit or P4 slice budget;
- cancellation;
- expiry;
- reset-required P3/P2 state.

A reset-required gate drops the stale local run. Browser effects remain explicit and
counted; P4 removes model mediation from each safe effect rather than hiding effects.
A local `SUCCESS` does not synthesize proof authority or `PROVED`.

## P4 evidence

Tests-first chain:

- `3786d827d85c247367690825f62bad34ded63689` — frozen P4 contract tests; CircleCI #95 expected red because `lib/event-driven-local-execution-p4.js` was absent; Vercel SUCCESS
- `460c3e7a1977792387c347762550aea554a07ebd` — implementation; CircleCI #96 SUCCESS + Vercel SUCCESS

From accepted P3 head to P4 implementation head, only the P4 test and P4 library were
added. P4 tests freeze byte hashes for P3, P2, Reactive VM 7B/7C/7D, extension
content/background/manifest, and public MCP source.

Controlled repetitive-read acceptance:

- 8 accepted `page.read` VM effects;
- browser effects executed = **8/8**;
- hidden browser effects = **0**;
- local reasoning wakeups during run = **0**;
- baseline model-mediated round trips = **9**;
- P4 model-mediated round trips = **1**;
- reduction = **88.89%**;
- initial P4 target = **>=60%**;
- returned result = correct (`8`);
- synthesized `PROVED` = **0**;
- foreground takeover indicators = **0**.

Other coverage includes malformed continuation authority, real P3 integration,
reset-required cleanup, ambiguity, failure, local step-budget exhaustion,
cancellation, expiry, effect-result provenance failure, cross-identity isolation,
source byte locks, and clear/recovery behavior.

This is controlled P4 evidence only. P5 real-Opera/end-to-end gates have not started.

P4 does not add extension observers, browser primitives, public MCP changes, VM
write/action authority, Supabase production changes, signing/pairing changes,
transaction/approval authority, or Checkpoint 8E.

## Exact P4 closeout gate

The exact P4 final candidate is the branch head containing the P4 tests,
implementation, acceptance record, synchronized performance plan, roadmap, project
context, and this handoff.

Before calling P4 accepted:

1. Fetch current branch head and confirm it is still the final-candidate commit.
2. Require CircleCI and Vercel/status checks on that exact head to be SUCCESS.
3. Pending/queued/in-progress => STOP.
4. Failure => diagnose only the P4 failure.
5. If both checks are SUCCESS, P4 is accepted without a second status-only commit.
6. Stop after reporting P4 accepted.
7. Start **P5 — real-Opera performance acceptance** only after explicit user
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
  -> bounded local Reactive VM continuation or compact reasoning patch
```

Checkpoint order:

1. P0 — accepted;
2. P1 — accepted;
3. P2 — accepted;
4. P3 — accepted;
5. P4 — current final candidate;
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
not pop, apply, delete, or use that stash automatically. Performance Track P does not
use it. If 8E later resumes, inspect it against canonical 8E scope first.

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
