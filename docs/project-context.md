# Opera Agent project context

Last synchronized: 2026-09-17

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, accepted checkpoint records, and the currently selected execution
plan.

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
- P3: **FINAL CANDIDATE**; implementation head `9309debd0db66993e99519f7015bf81a3c0804dd` passed CircleCI #93 + Vercel; documentation-closeout exact head still requires green CircleCI + Vercel/status
- P4 has not started

## Performance Track P

Canonical plan: `docs/delta-first-performance-plan.md`.
Acceptance records:

- `docs/delta-first-performance-p0.md`
- `docs/delta-first-performance-p1.md`
- `docs/delta-first-performance-p2.md`
- `docs/delta-first-performance-p3.md`

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
and byte accounting while retaining the reconstructed canonical state internally.

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

## P3 implementation state

P3 adds only a pure bounded consumer/runtime coalescer and relevance gate:

- `lib/multi-signal-relevance-p3.js`
- `tests/multi-signal-relevance-p3.test.mjs`

It wraps the accepted P2 pipeline rather than replacing P2 continuity or canonical
state reconstruction.

Accepted signal types:

- `ACTION_RESULT`
- `DOM_MUTATION`
- `GEOMETRY_RESIZE`
- `NAVIGATION_HISTORY`
- `RECONNECT_RESET`
- `SCROLL_VIEWPORT`
- `SEMANTIC_MUTATION`
- `WAIT_CONDITION`

Signals contribute bounded metadata only: type, logical IDs, region IDs, and
wait-condition IDs. Arbitrary page/model/signal text is ignored.

Relevance decisions are exactly:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

Relevance authority is accepted only from
`ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES` context containing a goal ID, positive
ledger revision, canonical `sha256:` ledger digest, and bounded reason/continuation
dependency sets. Missing, malformed, untrusted, or oversized context cannot suppress
reasoning.

`IGNORE_FOR_TASK` suppresses only reasoning; canonical P2/P1 state still advances.
`APPLY_AND_CONTINUE` is available only for accepted continuation dependencies.
`REASON_REQUIRED` has precedence.

Epoch bounds include signal count, affected dependency-key count, and age.
`NAVIGATION_HISTORY`, `RECONNECT_RESET`, signal overflow, affected-key overflow,
epoch expiry, and any P2 reset-required/continuity failure force conservative
`REASON_REQUIRED`.

Exact replay with no new relevant signal does not create a duplicate reasoning wake.

## P3 tests-first / automated evidence

- `388df28d5795da2cb1fe72ece2ff25f46b7411d5` — P3 contract test head; CircleCI #92 expected red because P3 implementation module did not yet exist; Vercel SUCCESS
- `9309debd0db66993e99519f7015bf81a3c0804dd` — P3 implementation; CircleCI #93 SUCCESS + Vercel SUCCESS

From accepted P2 head to P3 implementation head, the net diff contains only the new
P3 library and P3 test. Tests freeze P2, extension, public MCP, and Reactive VM
source hashes byte-for-byte.

Controlled irrelevant-mutation-storm evidence:

- 10 irrelevant epochs × 128 signals = **1,280 irrelevant signals**;
- later relevant signal = **1**;
- total raw signals = **1,281**;
- irrelevant reasoning wakeups = **0**;
- total reasoning wakeups after relevant change = **1**;
- relevant change detected exactly = **1/1**;
- relevant-signal loss = **0**;
- false completion = **0**;
- foreground takeover = **0**.

P3 does **not** implement P4 VM execution, extension observer wiring, new browser
primitives, public MCP changes, Supabase production changes, signing/pairing changes,
transaction authority, or 8E.

## Frozen P5 targets

P0 froze these future acceptance targets; P3 does not claim them all achieved:

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
Those are historical reference measurements, not fresh P3 real-browser claims.

## Closed 8D state

Checkpoint 8D remains fully closed. The successful hosted Edge concurrency probe ran
exactly once on runtime head `cf645799968458d55d5c2b391a5d354c369337b6`.
Final independent overall audit Jules session `17943137394205042765` returned PASS.
Durable 8D roadmap closeout finished at
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab` with CircleCI #69 + Vercel SUCCESS.
Do not rerun `RUN_8D_EDGE_CONCURRENCY.cmd`; its one-run authorization was consumed.

## Exact next gate

1. Treat the branch head containing P3 tests, implementation, acceptance record,
   synchronized performance plan, roadmap, project context, and handoff as the exact
   P3 final candidate.
2. Require CircleCI and Vercel/status on that exact head to be SUCCESS.
3. Pending/queued/in-progress => **STOP**.
4. Failure => diagnose only that P3 failure.
5. If both checks are green, P3 is accepted without another status-only commit.
6. Stop after P3. Start **P4 — event-driven local Reactive VM execution** only after
   explicit user continuation.
7. Do not start 8E while Performance Track P remains active.

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
If 8E later resumes, inspect it against the canonical 8E scope first.
