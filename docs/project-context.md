# Opera Agent project context

Last synchronized: 2026-09-17

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, accepted checkpoint records, and the currently selected execution plan.

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
- Durable 8D closeout head: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Active user-selected work: **Performance Track P — Delta-First Runtime**
- P0: **ACCEPTED** at `699578904e2f19ea713a0933632331cad7299c11` with CircleCI #76 + Vercel SUCCESS
- P1: **ACCEPTED** at `cbf3259a337d92410a5ba805dd0fd987a51c1bc5` with CircleCI #85 + Vercel SUCCESS
- P2: **ACCEPTED** at `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d` with CircleCI #91 + Vercel SUCCESS
- P3: **ACCEPTED** at `d5310508aeb5c156657bd4d4abd06a4d172daaba` with CircleCI #94 + Vercel SUCCESS
- P4: **FINAL CANDIDATE**; implementation head `460c3e7a1977792387c347762550aea554a07ebd` passed CircleCI #96 + Vercel; exact documentation-closeout head still requires green CircleCI + Vercel/status
- P5 has not started

## Performance Track P

Canonical plan: `docs/delta-first-performance-plan.md`.
Acceptance records:

- `docs/delta-first-performance-p0.md`
- `docs/delta-first-performance-p1.md`
- `docs/delta-first-performance-p2.md`
- `docs/delta-first-performance-p3.md`
- `docs/delta-first-performance-p4.md`

Frozen target architecture:

```text
full snapshot bootstrap
  -> bounded semantic working state
  -> browser signals/change epochs
  -> semantic delta
  -> causal invalidation
  -> relevance gate
  -> bounded local continuation or compact reasoning patch
```

Full snapshot remains the fail-closed recovery primitive whenever continuity is not
provable. Performance Track P does not grant new transaction authority and does not
change the frozen Milestone 8 contracts.

## P1 accepted foundation

P1 introduced `lib/semantic-working-state-p1.js`, a pure bounded process-memory
working-state layer keyed to tenant + device + tab + document generation + runtime
epoch. It retains sanitized semantic metadata, materialized views, dependency
fingerprints, current semantic revision, last source/result revision, and replay
digest.

Trusted RESET/full bootstrap and exact contiguous revision continuity are mandatory.
Exact replay is idempotent. Incompatible duplicate, old input, revision gap,
cross-scope identity, restart, ambiguity, overflow, expiry, eviction, semantic
mismatch, and materialized-view mismatch fail closed.

Raw page text, labels, href/private-query material, form values, and sensitive
entities are excluded from public working state. No durable persistence was added.

## P2 accepted delta-first layer

P2 introduced:

- `lib/delta-first-observation-p2.js`
- `tests/delta-first-observation-p2.test.mjs`

Trusted RESET/bootstrap emits `FULL_SNAPSHOT`. Proven contiguous changes emit a
bounded `COMPACT_PATCH` carrying revisions, changed entities/views, invalidation and
removal metadata, continuity/replay state, bounded provenance, verification metadata,
and byte accounting while retaining reconstructed canonical state internally.

Continuity loss, mismatch, ambiguity, overflow, expiry/eviction, or patch overflow
fails closed to reset-required full snapshot and discards stale continuity.

Controlled P2 evidence:

- median rich reasoning payload: **22,244 bytes**;
- median compact patch: **1,380 bytes**;
- median reduction: **93.80%**;
- fallback/reset during valid pairs: 0;
- stale-state continuation: 0;
- false completion: 0;
- foreground takeover: 0;
- relevant semantic information loss: 0.

## P3 accepted relevance layer

P3 introduced:

- `lib/multi-signal-relevance-p3.js`
- `tests/multi-signal-relevance-p3.test.mjs`

It wraps the accepted P2 pipeline rather than replacing P2 continuity or canonical
state reconstruction.

Accepted signal types:

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

Accepted relevance decisions:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

Relevance authority is accepted only from
`ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES` context containing bounded goal/ledger and
reason/continuation dependency information. Missing, malformed, untrusted, or
oversized context cannot suppress reasoning.

Epoch bounds include signal count, affected dependency-key count, and age.
Navigation/history, reconnect/reset, signal overflow, affected-key overflow, epoch
expiry, and any P2 reset-required/continuity failure force conservative
`REASON_REQUIRED`.

P3 controlled evidence:

- 10 irrelevant epochs × 128 signals = **1,280 irrelevant signals**;
- later relevant signal = **1**;
- total raw signals = **1,281**;
- irrelevant reasoning wakeups = **0**;
- total reasoning wakeups after relevant change = **1**;
- relevant change detected exactly = **1/1**;
- relevant-signal loss = **0**;
- false completion = **0**;
- foreground takeover = **0**.

P3 accepted final head:
`d5310508aeb5c156657bd4d4abd06a4d172daaba` with CircleCI #94 + Vercel SUCCESS.

## P4 implementation state

P4 adds only a pure event-driven local execution host:

- `lib/event-driven-local-execution-p4.js`
- `tests/event-driven-local-execution-p4.test.mjs`

It composes accepted P3 relevance output with accepted Reactive VM 7D. It does not
modify Reactive VM 7B/7C/7D source or widen the accepted read-only VM effect surface.

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

Local execution starts only from a structurally valid P3 `APPLY_AND_CONTINUE`
decision with accepted continuation dependency, no reasoning wake, canonical state
present, no matched reason dependency, and no safety reason.

Malformed/self-asserted continuation authority fails conservative to reasoning.
`IGNORE_FOR_TASK` leaves a registered run idle. `REASON_REQUIRED` does not advance
local execution.

Each run is isolated by tenant + device + tab + document generation + runtime epoch.
Returned effect provenance must also match trusted tenant/device/tab/document
identity before the local run can continue.

The host advances the accepted VM up to a bounded local-step slice and stops on:

- accepted read-only VM effect request;
- successful VM return;
- ambiguity/model-required suspension;
- failure;
- VM limit or local slice budget;
- cancellation;
- expiry;
- reset-required P3/P2 state.

Reset-required state drops stale local continuation. Local success does not synthesize
`PROVED`; it is only the bounded VM return status.

## P4 tests-first / automated evidence

- `3786d827d85c247367690825f62bad34ded63689` — P4 contract tests only; CircleCI #95 expected red because the P4 implementation module did not yet exist; Vercel SUCCESS
- `460c3e7a1977792387c347762550aea554a07ebd` — P4 implementation; CircleCI #96 SUCCESS + Vercel SUCCESS

From accepted P3 head to P4 implementation head, the net code diff contains only the
new P4 test and P4 library. P4 tests freeze byte hashes for P3, P2, Reactive VM
7B/7C/7D, extension content/background/manifest, and public MCP source.

Controlled P4 repetitive-read evidence:

- accepted read-only browser effects executed: **8/8**;
- hidden browser effects: **0**;
- local reasoning wakeups during run: **0**;
- baseline model-mediated round trips: **9**;
- P4 model-mediated round trips: **1**;
- reduction: **88.89%**;
- frozen initial P4 target: **>=60%**;
- returned result: correct;
- synthesized `PROVED`: **0**;
- foreground takeover indicators: **0**.

P4 also tests reset cleanup, ambiguity, failure, step-budget exhaustion,
cancellation/expiry, effect-provenance mismatch, identity isolation, and clear/recovery.

P4 does **not** add extension observer wiring, new browser primitives, public MCP
changes, Supabase production changes, signing/pairing changes, transaction authority,
or 8E work.

## Frozen P5 targets

P0 froze these future acceptance targets; controlled P2/P3/P4 evidence does not by
itself claim all are achieved in real Opera:

- false completion = 0;
- foreground takeover = 0;
- stale-state action = 0;
- relevant-signal loss = 0;
- small-change reasoning payload reduction >=75% median;
- repetitive reasoning/tool round-trip reduction >=60% median;
- steady-state full-snapshot reduction >=80%;
- long repetitive task median speedup >=2.0x;
- simple-operation median regression <=15%.

Inherited accepted 1.6.0 reference evidence remains rich-read median 19.83 ms, p95
20.65 ms, 50,953-byte enriched snapshot median, and 6,087-byte single-update delta.
Those are historical reference measurements, not fresh P4 real-browser claims.

## Closed 8D state

Checkpoint 8D remains fully closed. The successful hosted Edge concurrency probe ran
exactly once on runtime head `cf645799968458d55d5c2b391a5d354c369337b6`.
Final independent overall audit Jules session `17943137394205042765` returned PASS.
Durable 8D roadmap closeout finished at
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab` with CircleCI #69 + Vercel SUCCESS.
Do not rerun `RUN_8D_EDGE_CONCURRENCY.cmd`; its one-run authorization was consumed.

## Exact next gate

1. Treat the branch head containing P4 tests, implementation, acceptance record,
   synchronized performance plan, roadmap, project context, and handoff as the exact
   P4 final candidate.
2. Require CircleCI and Vercel/status on that exact head to be SUCCESS.
3. Pending/queued/in-progress => **STOP**.
4. Failure => diagnose only that P4 failure.
5. If both checks are green, P4 is accepted without another status-only commit.
6. Stop after P4.
7. Start **P5 — real-Opera performance acceptance** only after explicit user
   continuation.
8. Do not start 8E while Performance Track P remains active.

## Invariants and user-local state

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

Two accidental untracked 8E files remain preserved in a Git stash named roughly
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash automatically. Performance Track P does not use it.
If 8E later resumes, inspect it against canonical 8E scope first.
