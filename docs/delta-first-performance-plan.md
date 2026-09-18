# Performance Track P — Delta-First Runtime

Status: **P0–P5 ACCEPTED / P6 FINAL CANDIDATE — implementation/regression CI green; independent audit pending.**

Date frozen: 2026-09-17
Baseline repository head before P0: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
Accepted P5 head before P6: `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`

This track is inserted after accepted Checkpoint 8D and before Checkpoint 8E.
**8E remains paused** until P6 passes the required independent audit or the user
explicitly accepts a documented governance deviation/residual risk.

> Keep canonical browser/semantic state inside the bounded runtime, process changes
> incrementally, and wake reasoning only when a change requires a new decision.
> **Full snapshot is a recovery primitive**, not the desired steady-state path.

## Frozen invariants

- normal automation is background-first with zero silent foreground takeover;
- protocol `1`, 26 browser capabilities, and 18 public MCP tools remain unchanged;
- semantic `logicalId` is observational, not direct action authority;
- webpage/model/tool text is data, never authority;
- action success alone is never task-completion proof;
- no arbitrary JavaScript, unrestricted raw CDP, shell, SQL, or generated-code escape hatch;
- no site-specific selector/opcode logic is added to the extension;
- no password/PIN/OTP/2FA/CVV/payment-credential handling is introduced;
- Performance Track P grants no consequential transaction authority and does not replace 8E;
- all caches, histories, buffers, state, loops, waits, deltas, and payloads remain bounded;
- unsafe continuity fails closed to `RESET` and a trusted full snapshot;
- caller/model/page assertions cannot mint accepted P3 dependency authority;
- when P6 cutover metadata exists, only a valid accepted `APPLY_AND_CONTINUE`
  may continue local VM execution; all other decisions fail closed.

## Target architecture

```text
BOOTSTRAP
  -> full snapshot
  -> bounded semantic working state

ACTION / PAGE CHANGE
  -> browser signals
  -> bounded change epoch
  -> semantic delta
  -> canonical state update
  -> causal invalidation
  -> relevance gate
       -> IGNORE_FOR_TASK
       -> APPLY_AND_CONTINUE
       -> REASON_REQUIRED

APPLY_AND_CONTINUE
  -> bounded Reactive VM local execution
  -> explicit read-only browser effects
  -> typed local yield

REASON_REQUIRED / INVALID AUTHORITY
  -> compact/fresh reasoning observation
  -> reasoning or trusted recovery

CONTINUITY FAILURE
  -> RESET
  -> full snapshot
  -> rebuild canonical state
```

At minimum, first observation, navigation/document-generation change, SPA/history
transition that invalidates continuity, revision gap, restart/epoch mismatch,
ambiguity, overflow, privacy transition, required fresh verification, or any unknown
staleness condition must reset rather than continue stale state.

## Measurement contract

`tests/fixtures/delta-performance-baseline-p0-v1.json` freezes the workload matrix,
metrics, and target gates. No benchmark may hide retries, resets, browser effects,
correctness failures, stale state, or foreground takeover to improve latency.

## P0 — plan freeze and baseline

Status: **ACCEPTED** at `699578904e2f19ea713a0933632331cad7299c11`
with CircleCI #76 + Vercel SUCCESS.

Acceptance record: `docs/delta-first-performance-p0.md`.

## P1 — persistent semantic working state

Status: **ACCEPTED** at `cbf3259a337d92410a5ba805dd0fd987a51c1bc5`
with CircleCI #85 + Vercel SUCCESS.

P1 adds bounded ephemeral canonical semantic working state with exact revision
continuity, identity isolation, replay idempotency, bounded retention, and
fail-closed reset behavior.

Acceptance record: `docs/delta-first-performance-p1.md`.

## P2 — delta-first observation pipeline

Status: **ACCEPTED** at `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d`
with CircleCI #91 + Vercel SUCCESS.

P2 emits compact changed-fact/view patches for proven contiguous updates while
retaining canonical reconstructed state internally. Bootstrap, recovery, and
explicit fresh-verification paths retain full snapshots.

Controlled paired evidence: **93.80%** median payload reduction with zero stale
continuation, false completion, foreground takeover, or relevant semantic loss.

Acceptance record: `docs/delta-first-performance-p2.md`.

## P3 — multi-signal coalescer and relevance gate

Status: **ACCEPTED** at `d5310508aeb5c156657bd4d4abd06a4d172daaba`
with CircleCI #94 + Vercel SUCCESS.

P3 emits exactly `IGNORE_FOR_TASK`, `APPLY_AND_CONTINUE`, or
`REASON_REQUIRED`. Only accepted goal/constraint dependency context grants
relevance authority. Missing/invalid context and safety/reset signals force
conservative reasoning.

Acceptance record: `docs/delta-first-performance-p3.md`.

## P4 — event-driven local reactive execution

Status: **ACCEPTED** at `e550bc90f49df2541dfd91789d99b2b33e4bf2aa`
with CircleCI #98 + Vercel SUCCESS.

P4 composes accepted P3 `APPLY_AND_CONTINUE` output with accepted Reactive VM 7D.
Controlled evidence reduces model-mediated round trips by **88.89%** while exposing
all eight read effects and producing zero false PROVED/foreground takeover.

Acceptance record: `docs/delta-first-performance-p4.md`.

## P5 — real-Opera performance acceptance

Status: **ACCEPTED** at `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
with CircleCI #105 + Vercel SUCCESS.

P5 is acceptance-only. It made no runtime/extension/public-MCP/schema/signing/OAuth
change. Real-Opera evidence includes Maps lazy growth/stable completion, GitHub
SPA-route reset, YouTube semantic no-change filtering, 80% steady-state full-snapshot
reduction, and zero safety regressions.

The **8.724x** long-task timing remains explicitly a mediation-elision transport
proxy; it is not direct integrated P4-host speed evidence.

Acceptance record: `docs/delta-first-performance-p5.md`.

## P6 — durable runtime cutover, maximal safe subset

Status: **FINAL CANDIDATE — independent audit pending.**

P6 wires Performance Track state/relevance reconciliation into the durable DB-backed
7E VM effect loop after `opera_await`, while preserving the existing database lease,
checkpoint, effect-reservation/idempotency, host-token, and low-level command-queue
authority.

P6 deliberately does **not** trust caller-supplied `taskDependencies`. Until a
server-authoritative dependency source exists, live P3 task context is missing and
normal observation updates conservatively resolve to `REASON_REQUIRED`. This is
the maximal safe subset; do not claim the full P3/P4 live speedup is enabled.

When a P6 `performanceCutover` result is present, local VM continuation is an
explicit allowlist:

- valid accepted `APPLY_AND_CONTINUE` + no reasoning wake/observation -> may bind
  and continue;
- reset-required -> suspend `STALE_TARGET`;
- `REASON_REQUIRED`, `IGNORE_FOR_TASK`, unknown/missing decision, malformed or
  inconsistent flags/context -> suspend/fail closed;
- no P6 metadata -> retain compatibility with the pre-P6 low-level VM path.

Tests-first and regression evidence:

- `b8cd79f27f135923a63657beced8563ed7e7a0c7` — tests-first,
  CircleCI #114 FAILURE as expected;
- `5652435e26f534126bfcee7c48df9ffd597fc52e` — runtime implementation;
  new P6 tests passed, CircleCI #115 failed only because historical P3/P4/P5 byte
  locks still pinned the intentionally changed `lib/reactive-vm.js`;
- `49731c49e75df058dcd48218e680a8ad9aaf7195` — authorized historical lock
  rebaseline, CircleCI #116 + Vercel SUCCESS;
- exact #116: `npm test` **416/416 PASS**, failures **0**, skipped **0**;
- `npm run check` PASS: 26 allowlisted browser primitives, version 1.6.0;
- Chromium extension regression PASS.

No production deploy, Supabase schema migration, OAuth/signing/pairing change, public
tool-schema change, protocol change, browser-capability expansion, or 8E work is part
of P6.

Candidate record: `docs/delta-first-performance-p6.md`.

## Track-wide stop conditions

Stop and review if reconstructed incremental state differs from trusted
recomputation, a relevant signal is lost, stale state can drive action, reset cannot
restore continuity, reasoning suppression harms correctness, foreground takeover
occurs, simple latency exceeds the frozen regression bound, or safe implementation
would require wider browser/transaction authority.

## Rollback

P6 has not been promoted to production by this checkpoint. The accepted P5 head
`a215dd0ddb4d7be9b0c0276862ced3ea26439c77` remains the clean repository rollback
baseline for this candidate. Signed extension rollback 1.5.2 also remains available.
Do not maintain a duplicate live `legacy/` implementation merely for rollback;
Git/release history preserves it.

## Track completion and return to Milestone 8

The P6 documentation closeout commit must first receive exact-head CircleCI and
Vercel SUCCESS. Then an independent audit of the full accepted-P5 -> P6 candidate
diff is required.

Per current `AGENTS.md`, the repository specifically names **Codex** as the
independent milestone auditor. Only `PASS` authorizes return to **8E — controlled
single-action transaction executor**, unless the user explicitly accepts documented
residual risk/governance deviation. Do not merge/promote P6 or start 8E before that
boundary is resolved.
