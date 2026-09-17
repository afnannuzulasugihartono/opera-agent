# Opera Agent next-session handoff

Last synchronized: 2026-09-17.

Checkpoint 8D is fully closed. Performance Track P remains the user-selected active
track before 8E. P0 and P1 are accepted. P2 is a **FINAL CANDIDATE** awaiting
exact-head CircleCI + Vercel/status checks on the documentation-closeout head. P3
has not started. Checkpoint 8E remains paused/not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable release: extension 1.6.0, protocol 1, 26 browser capabilities, 18 public MCP
tools, unchanged signing/pairing, signed rollback 1.5.2.

Durable 8D closeout head:
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`.

Accepted P0 head:
`699578904e2f19ea713a0933632331cad7299c11` with CircleCI #76 and Vercel SUCCESS.

Accepted P1 head:
`cbf3259a337d92410a5ba805dd0fd987a51c1bc5` with CircleCI #85 and Vercel SUCCESS.

P2 implementation head:
`5f0477441ab0b05335a87c6a7e69a5415dc8b5ce` with CircleCI #87 and Vercel SUCCESS.

Canonical performance plan:
`docs/delta-first-performance-plan.md`.

P2 acceptance candidate:
`docs/delta-first-performance-p2.md`.

## P2 implementation

P2 adds a bounded consumer-side delta-first reasoning observation adapter only:

- `lib/delta-first-observation-p2.js`
- `tests/delta-first-observation-p2.test.mjs`

It builds on accepted P1 working state rather than replacing it.

Behavior:

- trusted RESET/bootstrap emits `FULL_SNAPSHOT` and reconstructs canonical P1 state;
- valid contiguous observations emit `COMPACT_PATCH` with source/result revision,
  classification, inserted/updated/moved/removed semantic entities,
  changed/invalidated/removed semantic views, continuity/replay metadata, bounded
  provenance, verification metadata, and payload accounting;
- exact replay is idempotent and does not resend changed facts;
- raw page text, raw labels, href/private-query material, raw values, sensitive
  entities, raw provenance notes, raw invalidation notes, and raw completion scope
  are excluded from compact reasoning patches;
- semantic `logicalId` remains observational and is not a direct action handle;
- missing continuity, incompatible duplicate, gap/out-of-order, cross-tab/document/
  runtime epoch, ambiguity, overflow, expiry/eviction, semantic/view mismatch, and
  patch overflow fail closed to full snapshot/reset-required;
- stale state is discarded on continuity failure and compact delivery cannot resume
  until trusted RESET/rebootstrap;
- explicit verification can request a fresh full observation while preserving an
  otherwise valid canonical chain.

P2 does not implement P3 signal coalescing/relevance gating, P4 local VM
continuation, new browser primitives, extension/CRX changes, public MCP changes,
Supabase production changes, transaction authority, or Checkpoint 8E.

## P2 evidence

Tests-first chain:

- `0f1b856b27776a813cbe818a0677344e991c9c3c` — frozen P2 contract tests before implementation; CircleCI #86 expected red boundary
- `5f0477441ab0b05335a87c6a7e69a5415dc8b5ce` — implementation; CircleCI #87 SUCCESS + Vercel SUCCESS

The normal CircleCI job runs the full Node test suite, `npm run check`, and
controlled Chromium extension regression. P2 did not modify extension/browser
sources; Chromium is compatibility evidence.

Controlled nine-update small-change benchmark:

- median rich reasoning payload: 22,244 bytes;
- median compact patch: 1,380 bytes;
- median reduction: 93.80% (frozen P2 minimum >=75%);
- fallback count: 0;
- reset count on valid pairs: 0;
- stale-state continuation: 0;
- false completion: 0;
- foreground takeover: 0;
- relevant semantic information loss: 0.

This is controlled P2 evidence, not P5 real-Opera/end-to-end acceptance.

## Exact P2 closeout gate

The exact P2 final candidate is the branch head containing the P2 tests,
implementation, acceptance record, synchronized performance plan, roadmap, project
context, and this handoff.

Before calling P2 accepted:

1. Fetch the current branch head and confirm it is still the final-candidate commit.
2. Require CircleCI and Vercel/status checks on that exact head to be SUCCESS.
3. Pending/queued/in-progress => STOP.
4. Failure => diagnose only the P2 failure.
5. If both checks are SUCCESS, P2 is accepted without a second status-only commit.
6. Stop after reporting P2 accepted.
7. Start **P3 — multi-signal coalescer and relevance gate** only after explicit user
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
2. P1 — accepted;
3. P2 — current final candidate;
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
