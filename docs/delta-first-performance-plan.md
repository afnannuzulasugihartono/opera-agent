# Performance Track P — Delta-First Runtime

Status: **P0 ACCEPTED / P1 FINAL CANDIDATE — exact-head CI required; P2 not started.**

Date frozen: 2026-09-17
Baseline repository head before P0: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`

This track is inserted after accepted Checkpoint 8D and before Checkpoint 8E. It does
not redefine Milestone 8. Checkpoint 8E remains paused until this performance track
is explicitly completed or the user explicitly ends the pause.

The performance direction is:

> Keep canonical browser/semantic state inside the bounded runtime, process changes
> incrementally, and wake the reasoning layer only when a change requires a new
> decision. Full snapshot is a recovery primitive, not the desired steady-state
> observation path.

## Why this track exists

Accepted Opera Agent 1.6.0 evidence already includes stable semantic identity,
semantic deltas, materialized semantic views, causal invalidation, provenance, the
Goal/Constraint Ledger, the Proof Engine, and the Reactive Browser VM. The accepted
browser benchmark records a 19.83 ms median rich read with a 50,953-byte enriched
snapshot and a 6,087-byte single-update delta, approximately 12% of that snapshot.
Those measurements are inherited evidence from `docs/benchmarks.md`; P0 does not
pretend that they are fresh live measurements from the post-8D head.

The historical efficiency work also records that eliminating whole workflow/network
round trips is normally more valuable than shaving a few milliseconds from one DOM
operation. Performance Track P therefore optimizes the observation/reasoning
boundary before proposing new browser primitives.

## Frozen invariants

All checkpoints in this track inherit the accepted product and Milestone 8 safety
boundaries unless a later checkpoint explicitly stops for a separately reviewed
change:

- normal automation remains background-first with zero silent foreground takeover;
- protocol `1`, the accepted browser capability inventory, and the current public
  MCP tool names/input schemas remain unchanged through P0-P4;
- semantic `logicalId` remains observational unless a separately accepted milestone
  changes that boundary;
- webpage/model/tool text is data, never authority;
- action success alone is not completion proof;
- no arbitrary JavaScript, generated code, unrestricted raw CDP, shell, or SQL
  escape hatch;
- no site-specific selector/opcode logic in the extension;
- no password/PIN/OTP/2FA/CVV/payment-credential handling is introduced;
- Performance Track P does not grant consequential transaction authority and does
  not replace Checkpoint 8E;
- all caches, histories, observers, event buffers, deltas, state stores, loops,
  waits, and payloads remain explicitly bounded;
- every optimization must fail closed to a safe reset/full snapshot when continuity
  cannot be proven.

## Target architecture

The current conceptual loop is still often equivalent to:

```text
ACTION
  -> rich observation
  -> semantic snapshot + delta
  -> reasoning
  -> ACTION
```

The target is:

```text
BOOTSTRAP
  -> full snapshot
  -> bounded semantic working state

ACTION / PAGE CHANGE
  -> browser signals
  -> bounded change epoch
  -> semantic delta
  -> update working state
  -> causal invalidation
  -> relevance gate
       -> IGNORE_FOR_TASK
       -> APPLY_AND_CONTINUE
       -> REASON_REQUIRED

REASON_REQUIRED
  -> compact task-relevant patch
  -> reasoning

CONTINUITY FAILURE
  -> RESET
  -> full snapshot
  -> rebuild canonical working state
```

Full snapshot is a recovery primitive. It remains mandatory when the runtime cannot
prove safe incremental continuity.

## Reset/full-snapshot conditions

At minimum, later implementation checkpoints must fail closed to `RESET` and a full
snapshot when any applicable condition occurs:

- first observation / no prior state;
- full navigation or document-generation change;
- SPA/history transition that invalidates the current document/state contract;
- missing, duplicate-incompatible, out-of-order, or gapped semantic revision;
- revision gap after eviction or missed history;
- semantic identity ambiguity that matters to the task;
- delta/output overflow;
- extension/runtime restart or epoch mismatch;
- privacy/incognito/sensitive-boundary transition;
- visual-only state that cannot be represented with sufficient semantic certainty;
- explicit proof/verification path requiring a fresh observation;
- any unknown condition where stale continuation cannot be ruled out.

## Measurement contract

`tests/fixtures/delta-performance-baseline-p0-v1.json` is the machine-readable P0
measurement contract. Every paired performance run must distinguish measurement
from acceptance assertion and record, when available:

- wall-clock time;
- reasoning/tool round trips;
- browser command count;
- `page.read` count;
- full snapshot count;
- delta count;
- browser-to-server bytes;
- reasoning-layer payload bytes;
- semantic entities processed;
- reset count;
- retry/fallback count;
- foreground takeover count;
- task correctness;
- false completion count;
- stale-state action count.

No benchmark may hide retries, resets, or correctness failures to improve latency.

## Workload matrix

The frozen P0 workload set is:

1. static content;
2. dynamic SPA;
3. infinite/lazy list;
4. virtualized list;
5. irrelevant mutation storm;
6. relevant single update;
7. navigation/reset;
8. long repetitive collection;
9. real Google Maps bounded results feed;
10. real GitHub structured/repeated content;
11. real YouTube dynamic/media-oriented content.

Synthetic workloads provide deterministic correctness/replay coverage. Real-site
workloads are acceptance shapes, not site-specific runtime architecture.

---

## P0 — plan freeze and baseline

Status: **ACCEPTED** on exact head
`699578904e2f19ea713a0933632331cad7299c11` with CircleCI #76 and Vercel SUCCESS.

Scope:

- freeze this plan and the machine-readable baseline/target contract;
- pin the pre-P0 accepted head;
- record inherited accepted 1.6.0 measurements without relabeling them as fresh P0
  exact-head live evidence;
- freeze the workload matrix, metrics, safety gates, reset rules, and checkpoint
  boundaries;
- add deterministic tests that prevent accidental widening or optimistic benchmark
  claims;
- update roadmap/context/handoff so P0 is the exact current gate.

Explicit non-goals:

- no runtime behavior change;
- no extension/CRX/signing/pairing change;
- no public MCP/runtime/schema change;
- no browser dispatch or real-site acceptance run;
- no Supabase database/Edge/OAuth/production change;
- no transaction authority or 8E implementation;
- no claim that P5 speed targets are already achieved.

Acceptance:

- P0 contract tests and full Node suite pass;
- `npm run check` passes;
- branch exact-head CircleCI and Vercel/status checks are SUCCESS;
- only tests/fixtures/docs/context/roadmap/handoff change;
- P1 has not started.

The accepted record is `docs/delta-first-performance-p0.md`.

---

## P1 — persistent semantic working state

Status: **FINAL CANDIDATE**. Implementation/test head
`27e683af29de562d91ca2303d5eb8e74606e2700` passed CircleCI #80 and Vercel; the
exact documentation-closeout head still requires green CI/status before P1 is
accepted. P2 has not started.

Objective: introduce a bounded ephemeral working-state layer keyed by trusted
runtime identity such as tenant/device/tab/document generation, without changing
browser-side behavior or the public MCP surface.

Required state includes at least:

```text
documentGeneration
semanticRevision
bounded entities/materialized views
causal dependencies
continuity metadata
last accepted source/result revision
```

Required correctness properties:

- exact contiguous deltas reproduce the same semantic state as recomputation from a
  trusted full snapshot;
- duplicate exact replay is idempotent;
- incompatible duplicate, out-of-order input, revision gap, cross-tab,
  cross-document, restart, ambiguity, overflow, and expiry fail closed;
- raw private page text or sensitive values are not made durable merely to support
  performance;
- bounded eviction cannot silently become continuity.

P1 does **not** yet suppress the full snapshot delivered to the existing reasoning
path. It proves the working-state foundation first.

Acceptance record: `docs/delta-first-performance-p1.md`.

---

## P2 — delta-first observation pipeline

Objective: when continuity is proven, make a compact delta/affected-view patch the
default reasoning-layer observation while retaining the canonical reconstructed
working state internally.

Required behavior:

- first observation uses a full snapshot;
- valid contiguous observations apply only incremental state changes;
- reasoning receives bounded changed facts/views plus required provenance and
  decision context, not an unnecessary complete rich snapshot;
- every reset condition returns to a fresh full snapshot before continuing;
- verification paths may request a fresh observation when correctness requires it.

Initial target gate for controlled small-change cases:

- at least 75% median reduction in reasoning payload versus the paired full-rich
  snapshot path;
- exact state reconstruction agreement;
- zero stale-state continuation;
- zero false completion;
- zero foreground takeover.

Target numbers are acceptance goals, not claims of achieved performance.

---

## P3 — multi-signal coalescer and relevance gate

Objective: avoid converting many low-level browser events into many reasoning turns.

Signals may include bounded versions of:

- semantic/DOM mutation;
- scroll and viewport change;
- geometry/resize change;
- navigation/history transition;
- browser/action result;
- wait-condition transition;
- reconnect/restart/reset events.

Signals must be coalesced into bounded change epochs before semantic reconciliation.
Mutation count is not reasoning-turn count.

The relevance gate has three outcomes:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

Task relevance is derived from accepted goal/constraint and dependency information;
page/model text cannot grant relevance authority. `IGNORE_FOR_TASK` means the task
reasoner need not wake, not that canonical browser state may be corrupted or lost.

Acceptance includes an irrelevant-mutation-storm case with zero unnecessary
reasoning wakeups while a later relevant change is still detected exactly.

---

## P4 — event-driven local reactive execution

Objective: use the accepted bounded Reactive Browser VM and existing safe primitives
to execute repetitive observation/filter/collect/wait work locally until a typed
yield condition requires reasoning.

Typical pattern:

```text
reason once
  -> bounded observe/filter/collect/scroll/wait loop
  -> yield on success, stable boundary, ambiguity, failure, reset, budget, or a
     decision that cannot be resolved locally
  -> reason again only when necessary
```

P4 must not add consequential transaction authority. It does not replace 8E.
State-changing work remains within the authority boundaries already accepted before
this track.

Initial repetitive-workload target:

- at least 60% median reduction in reasoning/tool round trips;
- same task correctness as the paired baseline;
- zero new false completion;
- zero foreground takeover;
- bounded cancellation, loops, waits, outputs, and deadlines.

---

## P5 — real-Opera performance acceptance

Objective: decide whether the track actually improves user-visible performance.
Synthetic success alone is insufficient.

Required application shapes:

- Google Maps: bounded lazy-feed collection, deduplication, and stable-boundary
  verification;
- GitHub: repeated structured entities plus SPA/navigation state;
- YouTube: dynamic/media page with substantial irrelevant churn.

The final paired comparison must use equivalent goals and safety/correctness gates.
P5 target gates frozen by P0 are:

- false completion: 0;
- foreground takeover: 0;
- stale-state action: 0;
- relevant-signal loss: 0;
- small-change reasoning-payload reduction: >= 75% median;
- repetitive reasoning-round-trip reduction: >= 60% median;
- steady-state full-snapshot reduction: >= 80%;
- long repetitive task speedup: >= 2.0x median;
- simple-operation median regression: <= 15%.

If correctness is not equivalent, a latency win does not count.

## Track-wide stop conditions

Stop and review instead of optimizing through the failure when:

- reconstructed incremental state differs from trusted full recomputation;
- a relevant mutation/signal is lost;
- stale state can drive an action;
- reset cannot re-establish continuity;
- reasoning suppression materially reduces task correctness;
- foreground takeover occurs;
- ordinary/simple median latency regresses by more than the frozen bound without an
  explicitly reviewed reason;
- safe implementation requires arbitrary JS, unrestricted raw CDP, site-specific
  extension logic, or wider authority;
- work collides with Milestone 8 transaction/approval boundaries;
- an extension-byte change appears before a separately reviewed release/signing
  subplan.

## Rollback and feature gating

P1-P4 should remain additive and default-off until accepted. A failure must be able
to return to the accepted 1.6.0 observation path without changing transaction
policy. P1 is a pure in-memory library and is not wired into browser behavior; its
rollback is simply to stop consuming the library. P2 or later may introduce the
first runtime integration only within its own accepted scope.

## Research basis

The track is informed by, but not dependent on trusting, the following external
ideas:

- browser mutation/visibility/resize/navigation event APIs for asynchronous change
  detection rather than unconditional polling;
- incremental view maintenance and self-adjusting/dataflow computation for updating
  only dependent materialized results;
- signal-driven web-agent observation that decouples action count from full
  observation count;
- task-relevant observation/context compression, while retaining recoverable
  canonical state instead of irreversible lossy pruning.

External research motivates hypotheses. Repository benchmarks, exact replay,
controlled browser tests, real Opera evidence, and CI remain acceptance authority.

## Track completion and return to Milestone 8

After P5 acceptance and an independent proportionate performance/correctness audit,
return to the frozen Milestone 8 sequence at **8E — controlled single-action
transaction executor**. No P checkpoint silently changes 8E, 8F, or later milestone
contracts.
