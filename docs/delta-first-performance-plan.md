# Performance Track P — Delta-First Runtime

Status: **P0 ACCEPTED / P1 ACCEPTED / P2 ACCEPTED / P3 ACCEPTED / P4 ACCEPTED / P5 FINAL CANDIDATE — exact-head CI required; independent track audit not started.**

Date frozen: 2026-09-17
Baseline repository head before P0: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`

This track is inserted after accepted Checkpoint 8D and before Checkpoint 8E.
**8E remains paused** until P5 is accepted and the required independent Performance
Track P audit returns PASS.

> Keep canonical browser/semantic state inside the bounded runtime, process changes
> incrementally, and wake reasoning only when a change requires a new decision.
> **Full snapshot is a recovery primitive**, not the desired steady-state path.

## Frozen invariants

- normal automation is background-first with zero silent foreground takeover;
- protocol `1`, 26 browser capabilities, and 18 public MCP tools remain unchanged by P0–P5;
- semantic `logicalId` is observational, not direct action authority;
- webpage/model/tool text is data, never authority;
- action success alone is never task-completion proof;
- no arbitrary JavaScript, unrestricted raw CDP, shell, SQL, or generated-code escape hatch;
- no site-specific selector/opcode logic is added to the extension;
- no password/PIN/OTP/2FA/CVV/payment-credential handling is introduced;
- Performance Track P grants no consequential transaction authority and does not replace 8E;
- all caches, histories, buffers, state, loops, waits, deltas, and payloads remain bounded;
- unsafe continuity fails closed to `RESET` and a trusted full snapshot.

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

REASON_REQUIRED
  -> compact task-relevant patch
  -> reasoning

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
metrics, and target gates. It includes synthetic static/dynamic/list/reset workloads
plus real Google Maps, GitHub, and YouTube application shapes.

No benchmark may hide retries, resets, browser effects, correctness failures, stale
state, or foreground takeover to improve latency.

---

## P0 — plan freeze and baseline

Status: **ACCEPTED** at `699578904e2f19ea713a0933632331cad7299c11`
with CircleCI #76 + Vercel SUCCESS.

P0 freezes this plan, the complete workload matrix, the measurement vocabulary,
recovery rules, safety boundaries, and future P5 gates.

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

Controlled paired evidence:

- rich reasoning payload median: **22,244 bytes**;
- compact patch median: **1,380 bytes**;
- reduction: **93.80%**;
- fallback/reset on valid pairs: **0**;
- stale-state continuation: **0**;
- false completion: **0**;
- foreground takeover: **0**;
- relevant semantic information loss: **0**.

Acceptance record: `docs/delta-first-performance-p2.md`.

## P3 — multi-signal coalescer and relevance gate

Status: **ACCEPTED** at `d5310508aeb5c156657bd4d4abd06a4d172daaba`
with CircleCI #94 + Vercel SUCCESS.

P3 coalesces bounded signal epochs and emits exactly:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

Only accepted goal/constraint dependency context grants relevance authority.
Navigation/history, reconnect/reset, overflow, expiry, invalid context, and P2
reset-required state force conservative reasoning.

Controlled storm evidence:

- irrelevant signals: **1,280**;
- unnecessary irrelevant reasoning wakes: **0**;
- later relevant signal: **1**;
- later relevant detected: **1/1**;
- relevant-signal loss: **0**;
- false completion: **0**;
- foreground takeover: **0**.

Acceptance record: `docs/delta-first-performance-p3.md`.

## P4 — event-driven local reactive execution

Status: **ACCEPTED** at `e550bc90f49df2541dfd91789d99b2b33e4bf2aa`
with CircleCI #98 + Vercel SUCCESS.

P4 composes accepted P3 `APPLY_AND_CONTINUE` output with accepted Reactive VM 7D.
It advances bounded local state until an explicit read-only browser effect or typed
yield, verifies effect provenance, and fails conservative on reset, ambiguity,
failure, budget exhaustion, invalid authority, or identity mismatch.

Controlled repetitive-read evidence:

- browser effects: **8/8**;
- hidden effects: **0**;
- local reasoning wakeups: **0**;
- baseline model-mediated round trips: **9**;
- P4 model-mediated round trips: **1**;
- reduction: **88.89%**;
- correct returned result;
- synthesized `PROVED`: **0**;
- foreground takeover indicators: **0**.

Acceptance record: `docs/delta-first-performance-p4.md`.

## P5 — real-Opera performance acceptance

Status: **FINAL CANDIDATE**.

P5 is acceptance-only. It adds no runtime, extension, public MCP, Supabase schema/
function, signing/pairing, OAuth, production-policy, or transaction-authority
behavior.

Fresh real-Opera shapes:

- **Google Maps:** lazy repeated feed grew **16 -> 25**, duplicate keys `0`; first
  bottom remained `PARTIAL`; stable second boundary observation became
  `BOUNDED_COMPLETE`; five reads contained one RESET and four steady-state deltas,
  for **80.00%** full-snapshot reduction.
- **GitHub:** repeated structured content observed; same-tab Issues route change
  produced document generation **1 -> 2**, `SPA_ROUTE`, and `RESET`, preventing
  stale-route continuation.
- **YouTube:** live mutation version changed **112707 -> 112708** while the semantic
  result was `NO_RELEVANT_CHANGE` with zero semantic changes/changed regions.

Frozen P5 gates and current evidence:

| Gate | Target | Evidence |
| --- | ---: | ---: |
| false completion | 0 | 0 |
| foreground takeover | 0 | 0 |
| stale-state action | 0 | 0 |
| relevant-signal loss | 0 | 0 |
| small-change reasoning-payload reduction | >=75% | 93.80% |
| repetitive reasoning-round-trip reduction | >=60% | 88.89% |
| steady-state full-snapshot reduction | >=80% | 80.00% |
| long repetitive task median speedup | >=2.0x | 8.724x |
| simple-operation median regression | <=15% | -5.68% |

The fresh three-run speed timing uses the same eight small `page.read` effects per
arm. The comparison arm removes model/tool mediation by bulk-enqueuing the same
independent effects; it is explicitly a **mediation-elision transport proxy**, not
a claim that the P4 JavaScript host directly drove the external browser. Actual P4
host correctness/effect accounting remains established by exact-head P4 tests.

Machine-readable evidence:
`tests/fixtures/delta-performance-p5-v1.json`.

Acceptance test:
`tests/delta-performance-p5.test.mjs`.

Acceptance record:
`docs/delta-first-performance-p5.md`.

P5 becomes accepted only when CircleCI and Vercel are SUCCESS on the exact
documentation/evidence closeout head. Pending required CI means STOP; failure means
diagnose that failure only.

## Track-wide stop conditions

Stop and review if reconstructed incremental state differs from trusted
recomputation, a relevant signal is lost, stale state can drive action, reset cannot
restore continuity, reasoning suppression harms correctness, foreground takeover
occurs, simple latency exceeds the frozen regression bound, or safe implementation
would require wider browser/transaction authority.

## Rollback

P1–P4 remain additive consumer layers and can be disabled back toward the accepted
1.6.0 observation path without changing transaction policy:

- P1: stop consuming working state;
- P2: stop consuming delta-first adapter;
- P3: stop consuming relevance coalescer;
- P4: stop consuming local-execution host.

## Track completion and return to Milestone 8

After exact-head P5 CI is green, P5 is accepted and the checkpoint sequence P0–P5
is complete. **Do not start 8E yet.** Per `AGENTS.md`, an independent proportionate
performance/correctness audit of the complete Performance Track P must return
`PASS` before work returns to **8E — controlled single-action transaction executor**,
unless the user explicitly accepts documented residual risk.
