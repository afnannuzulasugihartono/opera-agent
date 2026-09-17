# Performance Track P — Delta-First Runtime

Status: **P0 ACCEPTED / P1 ACCEPTED / P2 ACCEPTED / P3 ACCEPTED / P4 FINAL CANDIDATE — exact-head CI required; P5 not started.**

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

APPLY_AND_CONTINUE
  -> bounded Reactive VM local execution
  -> read-only browser effects
  -> typed local yield
       -> success / stable boundary
       -> ambiguity / failure / budget / reset
       -> reasoning only when required

REASON_REQUIRED
  -> compact task-relevant patch
  -> reasoning

CONTINUITY FAILURE
  -> RESET
  -> full snapshot
  -> rebuild canonical working state
```

Full snapshot remains the fail-closed recovery primitive whenever continuity is not
provable.

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
measurement contract. Paired performance work records, when applicable:

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

P0 froze the plan, baseline/target contract, workload matrix, metrics, safety gates,
reset rules, checkpoint boundaries, and future P5 performance targets without
changing runtime behavior.

Acceptance record: `docs/delta-first-performance-p0.md`.

---

## P1 — persistent semantic working state

Status: **ACCEPTED** on exact head
`cbf3259a337d92410a5ba805dd0fd987a51c1bc5` with CircleCI #85 and Vercel SUCCESS.

P1 introduced a bounded process-memory working-state layer keyed by trusted runtime
identity and required exact contiguous semantic revisions. Exact replay is
idempotent; incompatible duplicate, out-of-order, gap, cross-scope identity,
restart, ambiguity, overflow, expiry, eviction, semantic mismatch, and view mismatch
fail closed.

P1 does not suppress the rich observation delivered to reasoning.

Acceptance record: `docs/delta-first-performance-p1.md`.

---

## P2 — delta-first observation pipeline

Status: **ACCEPTED** on exact head
`8621e2dc454f8e8f1e977c350522e6fb2b5dc51d` with CircleCI #91 and Vercel SUCCESS.

Tests-first contract head:
`0f1b856b27776a813cbe818a0677344e991c9c3c`.

Implementation head:
`5f0477441ab0b05335a87c6a7e69a5415dc8b5ce` with CircleCI #87 and Vercel SUCCESS.

P2 makes a bounded changed-facts/affected-view `COMPACT_PATCH` the reasoning-layer
observation for proven contiguous changes while retaining the canonical reconstructed
state internally. Bootstrap/reset and explicit verification paths retain full
snapshot behavior. Continuity failure discards stale state and fails closed.

Controlled nine-update evidence:

- median rich reasoning payload: **22,244 bytes**;
- median compact reasoning patch: **1,380 bytes**;
- median reduction: **93.80%**;
- frozen minimum: **>=75%**;
- fallback/reset during valid pairs: **0**;
- stale-state continuation: **0**;
- false completion: **0**;
- foreground takeover: **0**;
- relevant semantic information loss: **0**.

Acceptance record: `docs/delta-first-performance-p2.md`.

---

## P3 — multi-signal coalescer and relevance gate

Status: **ACCEPTED** on exact head
`d5310508aeb5c156657bd4d4abd06a4d172daaba` with CircleCI #94 and Vercel SUCCESS.

Tests-first contract head:
`388df28d5795da2cb1fe72ece2ff25f46b7411d5` produced expected red CircleCI #92.

Implementation head:
`9309debd0db66993e99519f7015bf81a3c0804dd` with CircleCI #93 and Vercel SUCCESS.

P3 prevents low-level browser-event volume from becoming reasoning-turn volume. It
coalesces accepted bounded signals into a change epoch, advances canonical state via
P2/P1, and emits exactly one of:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

Task relevance derives only from accepted goal/constraint dependency context.
Missing, malformed, untrusted, or oversized context cannot suppress reasoning.
Navigation/history, reconnect/reset, signal/affected-key overflow, epoch expiry, and
P2 reset-required/continuity failure force `REASON_REQUIRED`.

Controlled irrelevant-mutation-storm evidence:

- raw irrelevant signals: **1,280** across 10 epochs;
- later relevant signal: **1**;
- total raw signals: **1,281**;
- unnecessary reasoning wakeups during irrelevant epochs: **0**;
- total reasoning wakeups after later relevant change: **1**;
- relevant update detected exactly: **1/1**;
- relevant-signal loss: **0**;
- false completion: **0**;
- foreground takeover: **0**.

P3 changes no extension bytes, public MCP surface, Reactive VM source, production
state, signing/pairing, transaction authority, or 8E boundary.

Acceptance record: `docs/delta-first-performance-p3.md`.

---

## P4 — event-driven local reactive execution

Status: **FINAL CANDIDATE**. Tests-first contract head
`3786d827d85c247367690825f62bad34ded63689` established the expected red boundary
(CircleCI #95) before the P4 library existed. Implementation head
`460c3e7a1977792387c347762550aea554a07ebd` passed CircleCI #96 and Vercel.
The exact documentation-closeout head still requires green CircleCI + Vercel/status
before P4 is accepted. P5 has not started.

Objective: use the accepted bounded Reactive Browser VM and existing read-only safe
primitives to execute repetitive observation/filter/collect/wait work locally until
a typed yield condition requires reasoning.

P4 adds a pure local execution host over Reactive VM 7D. Local execution starts only
from a structurally valid P3 `APPLY_AND_CONTINUE` result with accepted continuation
dependencies, no reason dependency, no safety reason, canonical state present, and
no reasoning wake requested.

Closed P4 outcomes:

```text
IDLE
LOCAL_EFFECT_REQUIRED
LOCAL_TERMINAL
REASON_REQUIRED
```

Closed P4 yield reasons:

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

Runs are isolated by tenant + device + tab + document generation + runtime epoch.
Effect results must also match trusted tenant/device/tab/document provenance before
continuation. Reset-required P3/P2 state drops the stale local run.

P4 keeps the accepted VM effect surface unchanged. Browser effects are still
explicitly surfaced to the host as read-only effect requests; the optimization is
that they do not each require a model/reasoning turn.

Controlled repetitive-read evidence uses 8 `page.read` effects and one final return:

- browser effects executed: **8/8**;
- hidden browser effects: **0**;
- local reasoning wakeups during the run: **0**;
- baseline model-mediated round trips: **9**;
- P4 model-mediated round trips: **1**;
- model-mediated round-trip reduction: **88.89%**;
- initial P4 target: **>=60%**;
- returned result: correct;
- synthesized `PROVED`: **0**;
- foreground takeover indicators: **0**.

P4 tests also cover malformed continuation authority, reset recovery, ambiguity,
failure, slice budget, cancellation, expiry, untrusted effect provenance, identity
isolation, source byte locks, and clear/recovery behavior.

P4 does not change Reactive VM 7B/7C/7D source, extension bytes, public MCP source or
schema, browser primitives, production state, signing/pairing, transaction authority,
or Milestone 8 contracts.

Acceptance record: `docs/delta-first-performance-p4.md`.

---

## P5 — real-Opera performance acceptance

Status: **NOT STARTED**.

Objective: decide whether the track actually improves user-visible performance.
Synthetic success alone is insufficient.

Required application shapes:

- Google Maps: bounded lazy-feed collection, deduplication, and stable-boundary
  verification;
- GitHub: repeated structured entities plus SPA/navigation state;
- YouTube: dynamic/media page with substantial irrelevant churn.

Frozen P5 target gates:

- false completion: 0;
- foreground takeover: 0;
- stale-state action: 0;
- relevant-signal loss: 0;
- small-change reasoning-payload reduction: >=75% median;
- repetitive reasoning-round-trip reduction: >=60% median;
- steady-state full-snapshot reduction: >=80%;
- long repetitive task speedup: >=2.0x median;
- simple-operation median regression: <=15%.

If correctness is not equivalent, a latency win does not count.

## Track-wide stop conditions

Stop and review instead of optimizing through the failure when:

- reconstructed incremental state differs from trusted full recomputation;
- a relevant mutation/signal is lost;
- stale state can drive an action;
- reset cannot re-establish continuity;
- reasoning suppression materially reduces task correctness;
- foreground takeover occurs;
- ordinary/simple median latency regresses beyond the frozen bound without an
  explicitly reviewed reason;
- safe implementation requires arbitrary JS, unrestricted raw CDP, site-specific
  extension logic, or wider authority;
- work collides with Milestone 8 transaction/approval boundaries;
- an extension-byte change appears before a separately reviewed release/signing
  subplan.

## Rollback and feature gating

P1-P4 remain additive/default-off until their checkpoints are accepted. A failure
must be able to return to the accepted 1.6.0 observation path without changing
transaction policy.

- P1 rollback: stop consuming the in-memory state library.
- P2 rollback: stop consuming the delta-first reasoning adapter.
- P3 rollback: stop consuming the signal coalescer/relevance gate and continue the
  P2 observation path.
- P4 rollback: stop consuming the local-execution host and route accepted continuation
  work back through the P3/P2 reasoning path.

## Track completion and return to Milestone 8

After P5 acceptance and an independent proportionate performance/correctness audit,
return to the frozen Milestone 8 sequence at **8E — controlled single-action
transaction executor**. No P checkpoint silently changes 8E, 8F, or later milestone
contracts.
