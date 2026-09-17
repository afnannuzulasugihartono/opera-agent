# Opera Agent project context

Last synchronized: 2026-09-17

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, accepted checkpoint records, and the selected execution plan.

## Current boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Signed rollback: `1.5.2`
- Milestone 8: 8A–8D **ACCEPTED**; 8E paused/not started
- Durable 8D closeout: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Active work: **Performance Track P — Delta-First Runtime**
- P0 accepted: `699578904e2f19ea713a0933632331cad7299c11`, CircleCI #76 + Vercel
- P1 accepted: `cbf3259a337d92410a5ba805dd0fd987a51c1bc5`, CircleCI #85 + Vercel
- P2 accepted: `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d`, CircleCI #91 + Vercel
- P3 accepted: `d5310508aeb5c156657bd4d4abd06a4d172daaba`, CircleCI #94 + Vercel
- P4 accepted: `e550bc90f49df2541dfd91789d99b2b33e4bf2aa`, CircleCI #98 + Vercel
- P5: **FINAL CANDIDATE** after fresh real-Opera acceptance; exact-head CI still required
- Independent complete-track audit: not started
- 8E remains paused until P5 acceptance plus independent audit PASS

Canonical plan: `docs/delta-first-performance-plan.md`.

Acceptance records:
- `docs/delta-first-performance-p0.md`
- `docs/delta-first-performance-p1.md`
- `docs/delta-first-performance-p2.md`
- `docs/delta-first-performance-p3.md`
- `docs/delta-first-performance-p4.md`
- `docs/delta-first-performance-p5.md`

## Accepted runtime layers

P1 provides bounded ephemeral semantic working state with exact continuity,
identity isolation, replay idempotency, bounded retention, and fail-closed reset.

P2 provides the delta-first reasoning adapter. Proven contiguous changes emit
`COMPACT_PATCH`; bootstrap/recovery/fresh-verification use full snapshots. Controlled
P2 evidence is **93.80%** median reasoning-payload reduction with zero stale
continuation, false completion, foreground takeover, and relevant semantic loss.

P3 provides bounded signal coalescing and relevance decisions:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

Only accepted goal/constraint dependency context grants relevance authority.
Controlled P3 evidence records 1,280 irrelevant signals with zero unnecessary
reasoning wakes and one later relevant signal detected exactly 1/1.

P4 provides bounded event-driven local execution over accepted Reactive VM 7D.
It starts only from valid `APPLY_AND_CONTINUE`, exposes explicit read-only effects,
verifies effect provenance, and yields conservatively on reset, ambiguity, failure,
budget, expiry, cancellation, or decision boundaries. Controlled P4 evidence is
8/8 read effects, zero local reasoning wakes, and **88.89%** model-mediated
round-trip reduction.

No P1–P4 accepted runtime layer changes extension bytes, public MCP schemas, accepted
Reactive VM source, signing/pairing, production transaction authority, or Milestone
8 contracts.

## P5 fresh real-Opera evidence

The accepted Opera Agent relay reported the `opera` device online on extension
1.6.0 / protocol 1 / 26 capabilities. P5 used only the existing accepted command
path and did not deploy or mutate schema/functions/Edge/OAuth/signing/transaction
policy.

### Google Maps

- repeated feed initial loaded entities: **16**
- final loaded entities after lazy load: **25**
- duplicate keys: **0**
- first bottom completion: **PARTIAL**
- stable boundary observations required: **2**
- final classification: `NO_RELEVANT_CHANGE`
- final completion: **BOUNDED_COMPLETE**
- five accepted reads: RESET, MOVE, MIXED, MOVE, NO_RELEVANT_CHANGE
- one full bootstrap + four steady-state delta reads
- steady-state full-snapshot reduction: **80.00%**

### GitHub

- semantic regions: **11**
- repeated list loaded entities: **10**, duplicate keys **0**
- target tab remained background
- same-tab route transition to Issues caused document generation **1 -> 2**
- reset reason: `SPA_ROUTE`
- classification: `RESET`
- stale route continuity was not reused

### YouTube

On the live media tab:
- mutation version **112707 -> 112708**
- second observation: `NO_RELEVANT_CHANGE`
- semantic change count: **0**
- changed semantic region count: **0**

This is fresh irrelevant-churn evidence. P3 deterministic tests remain the authority
for proving a later relevant signal is not lost.

## P5 performance gates

Frozen P5 targets and current evidence:

- false completion = **0**
- foreground takeover = **0**
- stale-state action = **0**
- relevant-signal loss = **0**
- small-change payload reduction = **93.80%** (target >=75%)
- repetitive reasoning round-trip reduction = **88.89%** (target >=60%)
- steady-state full-snapshot reduction = **80.00%** (target >=80%)
- long repetitive task median speedup = **8.724x** (target >=2x)
- simple-operation median regression = **-5.68%** (ceiling <=15%)

The long-task live timing uses the same eight small `page.read` effects per arm.
The comparison arm removes model/tool mediation by bulk-enqueuing the same independent
effects. It is recorded as a **mediation-elision transport proxy**, not as direct
external execution by the P4 JS host. Actual P4 host semantics are locked by the P4
deterministic suite.

Live three-run speed results:

- run 1: 40,010.506 ms -> 4,894.013 ms = 8.175x
- run 2: 43,704.939 ms -> 5,009.552 ms = 8.724x
- run 3: 53,733.039 ms -> 4,976.989 ms = 10.796x
- median: **8.724x**

Simple paired live effect-execution medians:

- baseline, n=24: **309.192 ms**
- mediation-elided, n=24: **291.628 ms**
- regression: **-5.68%**

## P5 safety and cleanup

- P5 `tabs.activate` commands: **0**
- pointer commands: **0**
- fill/key commands: **0**
- dedicated P5 test tabs remaining after cleanup: **0**
- one transient tab-close error resolved on one retry
- one stale-tab preflight read failure was excluded from acceptance measurements and
  explicitly recorded rather than hidden

P5 is acceptance-only. Runtime byte locks cover P4, P3, P2, Reactive VM 7B/7C/7D,
extension content/background/manifest, and public MCP source.

## Exact next gate

1. The branch head containing P5 evidence fixture, gate test, acceptance record,
   synchronized plan, roadmap, context, and handoff is the P5 final candidate.
2. Require CircleCI + Vercel/status SUCCESS on that exact head.
3. Pending/queued/in-progress => **STOP**.
4. Failure => diagnose only that P5 failure.
5. If both are green, P5 is accepted without a status-only commit.
6. **Do not start 8E.**
7. After P5 acceptance, run an independent proportionate performance/correctness
   audit of the complete Performance Track P.
8. Only audit PASS permits returning to 8E unless the user explicitly accepts
   documented residual risk.

## Closed 8D and user-local state

Checkpoint 8D remains fully closed. The one-run hosted Edge concurrency authorization
was consumed; do not rerun `RUN_8D_EDGE_CONCURRENCY.cmd`.

Two accidental untracked 8E files remain preserved in a Git stash named roughly
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash automatically. If 8E later resumes, inspect it against
canonical 8E scope first.

## Permanent invariants

- one active writer;
- tests before runtime behavior;
- repository/CI/production evidence outranks chat;
- background-first browser operation;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print credentials or sensitive page values;
- action success is not completion proof;
- performance gains never justify stale-state action, false completion, missed
  relevant changes, or foreground takeover.
