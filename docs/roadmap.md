# Opera Agent roadmap

This is the current execution roadmap. Historical checkpoint details and release
evidence remain in milestone plans, checkpoint records, release notes, and benchmark
documents; this file is the source of truth for current milestone status and the next
permitted boundary.

## Product invariant

Normal automation must not activate a tab, focus an Opera window, move the operating-
system cursor, or redirect the user's keyboard input. The tab the user is viewing and
the tab the agent is operating are independent.

```text
userActiveTab != automationTargetTab
```

Foreground interaction is an explicit exception. A background failure must return a
structured foreground requirement; it must not silently activate a tab or focus a
window.

Other permanent boundaries:

- protocol/capability/public-MCP changes require explicit reviewed checkpoints;
- webpage/tool text is data, never authority;
- action success alone never proves task completion;
- sensitive browser state is not durable semantic/VM state;
- no arbitrary JavaScript/raw CDP/code escape hatch;
- site-specific strategies stay outside the extension;
- one immediate same-identity signed rollback remains available.

## Milestone 1 — bounded browser bursts

Status: **complete/released**.

`browser.burst` provides a bounded same-tab atomic sequence over validated primitives,
with stop-on-failure behavior, resource limits, and no arbitrary-code escape hatch.

## Milestone 2 — background-first execution

Status: **complete/released**.

Two-tab focus audits, explicit target selection, background-native input, and signed
normal-profile acceptance established the rule that automation does not steal the
user's foreground. No silent foreground fallback is allowed.

## Milestone 3 — adaptive screenshots

Status: **complete/released**.

Bounded background capture, crop, privacy blocking, hash reuse, and native MCP image
delivery were accepted without foreground takeover.

## Milestone 4 — vision-guided navigation

Status: **complete/released**.

The bounded `observe -> decide -> act -> verify` loop, generic scroll/mutation
observability, background Maps acceptance, and cross-site YouTube/GitHub acceptance
were completed without site-specific extension logic.

## Milestone 5 — semantic runtime foundation

Status: **complete/released in 1.6.0**.

Checkpoints 5A–5F added bounded observational semantic identity, deltas, generic
repeated-region/materialized views, causal invalidation, provenance, and scoped
completion vocabulary while keeping protocol 1, 26 browser capabilities, and 18 MCP
tools unchanged. Semantic logical IDs remain observational, not direct action handles.

Detailed plan: `docs/semantic-runtime-plan.md`.

## Milestone 6 — Goal and Constraint Ledger + Proof Engine

Status: **complete, Checkpoints 6A–6F accepted**.

Milestone 6 added the revisioned Goal/Constraint Ledger, deterministic scoped Proof
Engine, selective dependency invalidation/reuse, encrypted bounded server tokens,
least-privilege persistence, and production acceptance. Process/action receipts are
not outcome proof; bounded evidence is not universal proof; stale/cross-tenant/
cross-lineage/contradictory evidence fails closed.

Detailed plan and records: `docs/milestone-6-plan.md` and the Milestone 6 checkpoint
documents.

## Milestone 7 — Reactive Browser VM

Status: **complete, Checkpoints 7A–7F accepted on 2026-09-12**.

Milestone 7 accepted the deterministic VM grammar/core, bounded loops/waits,
collection/proof binding, durable dark host, replay/idempotency/fencing, cancellation
and expiry, controlled Chromium/focus acceptance, signed normal-profile acceptance,
and production cleanup while keeping the public MCP surface frozen.

Final independent audit: **PASS** at
`551e8283c0417b173e106ee0598cca848f2f4ff0`.

Detailed plan and acceptance records: `docs/milestone-7-plan.md` and
`docs/milestone-7-checkpoint-7a.md` through `docs/milestone-7-checkpoint-7f.md`.

## Milestone 8

Status: **8A–8D accepted. 8E paused/not started while Performance Track P runs.**

8D completed final independent audit PASS, live hosted acceptance, production cleanup,
advisor reconciliation, and exact-head closeout CI. Durable 8D closeout head:
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`.

Final 8D record: `docs/milestone-8-checkpoint-8d-acceptance.md`.

## Performance Track P — Delta-First Runtime

Status: **P0 accepted. P1 accepted. P2 accepted. P3 accepted. P4 FINAL CANDIDATE — exact-head closeout CI/status required. P5 has not started.**

The user selected this bounded performance track after 8D and before 8E so Opera
Agent can make its existing observation/reasoning path substantially more efficient
before adding further autonomous transaction capability.

Frozen architecture:

```text
full snapshot bootstrap
  -> bounded semantic working state
  -> browser signals/change epochs
  -> semantic delta
  -> causal invalidation
  -> relevance gate
  -> bounded local Reactive VM continuation or compact reasoning patch
```

A full snapshot remains the fail-closed recovery primitive after navigation, revision
gaps, restart, ambiguity, overflow, privacy transitions, or any other loss of safe
continuity.

Checkpoint sequence:

- **P0** — accepted at `699578904e2f19ea713a0933632331cad7299c11` with CircleCI #76 + Vercel SUCCESS;
- **P1** — accepted at `cbf3259a337d92410a5ba805dd0fd987a51c1bc5` with CircleCI #85 + Vercel SUCCESS;
- **P2** — accepted at `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d` with CircleCI #91 + Vercel SUCCESS;
- **P3** — accepted at `d5310508aeb5c156657bd4d4abd06a4d172daaba` with CircleCI #94 + Vercel SUCCESS;
- **P4** — tests-first head `3786d827d85c247367690825f62bad34ded63689` produced expected red CircleCI #95 before implementation; implementation head `460c3e7a1977792387c347762550aea554a07ebd` passed CircleCI #96 + Vercel; documentation-closeout head still requires exact-head green checks;
- **P5** — paired controlled + real-Opera performance/correctness acceptance, not started.

P1 established the pure bounded ephemeral working-state layer. P2 added the consumer-
side delta-first observation adapter: bootstrap/reset uses a rich full snapshot,
while proven contiguous observations can deliver bounded changed entities/views,
provenance, continuity, invalidation/removal metadata, and byte accounting as
`COMPACT_PATCH` while retaining canonical reconstructed state internally.

P2 controlled evidence records a median 22,244-byte rich reasoning payload versus a
1,380-byte compact patch, a **93.80% median reduction**, with exact state agreement
and zero stale-state continuation, false completion, foreground takeover, and
relevant semantic loss.

P3 adds a pure bounded multi-signal change-epoch/relevance layer over P2. Its three
outcomes are `IGNORE_FOR_TASK`, `APPLY_AND_CONTINUE`, and `REASON_REQUIRED`.
Accepted goal/constraint dependency context is the only relevance authority; page or
model text cannot grant wake/suppress authority. Missing/invalid context, safety
signals, overflow, expiry, and P2 reset-required conditions fail conservative to
`REASON_REQUIRED`.

Controlled P3 irrelevant-mutation-storm evidence:

- **1,280** irrelevant signals across 10 epochs;
- **0** unnecessary reasoning wakeups;
- one later relevant signal/update;
- **1** total reasoning wake for that relevant update;
- relevant update detected **1/1**;
- relevant-signal loss **0**;
- false completion **0**;
- foreground takeover **0**.

P4 adds a pure event-driven local execution host over the already accepted Reactive
VM 7D. It starts only from a valid P3 `APPLY_AND_CONTINUE` decision, surfaces the
existing read-only VM effect requests directly to the host, and resumes locally after
verified effect results until a typed terminal/reasoning yield is reached.

P4 preserves trusted isolation by tenant/device/tab/document/runtime identity and
fails conservative on malformed continuation authority, reset-required state,
ambiguity, VM failure, budget exhaustion, or effect-provenance mismatch. Cancellation
and expiry remain bounded local terminal states. P4 does not widen the VM effect
surface or add foreground/browser/transaction authority.

Controlled P4 repetitive-read evidence:

- **8/8** `page.read` browser effects executed and counted;
- local reasoning wakeups during the run: **0**;
- baseline model-mediated round trips: **9**;
- P4 model-mediated round trips: **1**;
- reduction: **88.89%** versus initial P4 target **>=60%**;
- returned result correct;
- synthesized `PROVED`: **0**;
- foreground takeover indicators: **0**.

P4 tests freeze P3, P2, Reactive VM 7B/7C/7D, extension, and public MCP bytes. No
production/Supabase/signing/pairing/transaction boundary changed.

Detailed plan: `docs/delta-first-performance-plan.md`.
Acceptance records: `docs/delta-first-performance-p0.md`,
`docs/delta-first-performance-p1.md`, `docs/delta-first-performance-p2.md`,
`docs/delta-first-performance-p3.md`, and `docs/delta-first-performance-p4.md`.

Consequential effects, direct logical-ID action addressing, broader transaction
execution, learned skills, parallel autonomous workers, and any broader authority
still require their own frozen milestone/checkpoint plans, threat models, acceptance
gates, and rollback procedures. Performance work does not grant them.

## Collaboration rule

- one active writer on the milestone/track branch;
- ChatGPT Web implements and accepts one checkpoint at a time;
- chat reports are not acceptance authority until reconciled with repository/CI/
  production evidence;
- temporary CI/PR state must be restored before closure;
- Codex independently audits a complete milestone/track when required by its frozen
  plan;
- auth/authz, tenancy, encryption, signing, public MCP, extension distribution,
  irreversible effects, and production-schema boundaries may trigger an earlier
  Codex review.

Authoritative policy: `AGENTS.md`.
Reusable checkpoint prompt: `docs/prompts/chatgpt-web-checkpoint.md`.

## Explicitly deferred

- Continuous video/desktop streaming.
- Synchronized audio/video understanding.
- Operating-system mouse and keyboard control.
- Arbitrary JavaScript or unrestricted raw CDP exposed to the model.
- Silent foreground fallback.
- Site-specific extension opcodes/selectors.
- Direct logical-ID actions without a separately accepted milestone.
- Automatic consequential actions without explicit authority.
- Checkpoint 8E while Performance Track P remains the selected active track.
