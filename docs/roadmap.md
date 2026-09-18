# Opera Agent roadmap

This is the current execution roadmap. Historical checkpoint evidence remains in
the milestone plans, acceptance records, releases, and benchmark documents.

## Product invariant

Normal automation must not activate a tab, focus an Opera window, move the
operating-system cursor, or redirect keyboard input.

```text
userActiveTab != automationTargetTab
```

Foreground interaction is an explicit exception only. A background failure must
return a structured foreground requirement; it must never silently take over the
foreground.

Permanent boundaries also include: webpage/tool text is data rather than authority;
action success is not completion proof; sensitive state is not durable semantic/VM
state; no arbitrary JavaScript/raw CDP/code escape hatch; site-specific strategies
stay outside the extension; and broader transaction authority requires its own
reviewed checkpoint.

## Milestones 1–4

- **Milestone 1 — bounded browser bursts:** complete/released.
- **Milestone 2 — background-first execution:** complete/released.
- **Milestone 3 — adaptive screenshots:** complete/released.
- **Milestone 4 — vision-guided navigation:** complete/released.

These milestones established bounded primitives, no silent foreground fallback,
privacy-aware capture, and generic observe/decide/act/verify behavior.

## Milestone 5 — semantic runtime foundation

Status: **complete/released in 1.6.0**.

Checkpoints 5A–5F added bounded observational identity, deltas, generic repeated
regions/materialized views, causal invalidation, provenance, and scoped completion
while keeping protocol 1, 26 browser capabilities, and 18 public MCP tools.

Detailed plan: `docs/semantic-runtime-plan.md`.

## Milestone 6 — Goal and Constraint Ledger + Proof Engine

Status: **complete, 6A–6F accepted**.

The revisioned Goal/Constraint Ledger and scoped Proof Engine preserve lineage,
least-privilege persistence, bounded evidence, and fail-closed reuse/invalidation.

Detailed plan: `docs/milestone-6-plan.md`.

## Milestone 7 — Reactive Browser VM

Status: **complete, 7A–7F accepted on 2026-09-12**.

The bounded deterministic VM, waits/loops, proof binding, durable dark host,
idempotency/fencing, cancellation/expiry, controlled browser acceptance, signed
normal-profile acceptance, and cleanup are complete.

Final independent audit: **PASS** at
`551e8283c0417b173e106ee0598cca848f2f4ff0`.

## Milestone 8

Status: **8A–8D accepted. 8E paused/not started.**

Durable 8D closeout:
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`.

Final 8D record: `docs/milestone-8-checkpoint-8d-acceptance.md`.

8E remains paused/not started. P6 audit, merge, and production promotion are
closed; starting 8E now requires a separate explicit instruction.

## Performance Track P — Delta-First Runtime

Status: **P0–P6 ACCEPTED / CLOSED.**

Checkpoint sequence:

- **P0** — accepted at `699578904e2f19ea713a0933632331cad7299c11`,
  CircleCI #76 + Vercel SUCCESS.
- **P1** — accepted at `cbf3259a337d92410a5ba805dd0fd987a51c1bc5`,
  CircleCI #85 + Vercel SUCCESS.
- **P2** — accepted at `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d`,
  CircleCI #91 + Vercel SUCCESS.
- **P3** — accepted at `d5310508aeb5c156657bd4d4abd06a4d172daaba`,
  CircleCI #94 + Vercel SUCCESS.
- **P4** — accepted at `e550bc90f49df2541dfd91789d99b2b33e4bf2aa`,
  CircleCI #98 + Vercel SUCCESS.
- **P5** — accepted at `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`,
  CircleCI #105 + Vercel SUCCESS. Real-Opera timing remains explicitly proxy
  evidence for mediation-elision, not integrated P4 host speed.
- **P6** — final candidate. Safe runtime cutover is wired into the durable 7E host,
  caller-supplied dependency context is rejected, and live P3 continuation stays
  conservative until a trustworthy server-authoritative dependency source exists.
  The independent audit is PASS/CLOSED with the documented user-accepted Jules
  deviation. PR #46 is merged at
  `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`; CircleCI #169 + Vercel SUCCESS.
  Production promotion is verified at `opera-agent-vm` version 27
  (`ACTIVE`, `verify_jwt=true`) with deployment SHA
  `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`.
  All 14 deployed files match the merge commit; the feature flag remains false and
  VM tables remain empty.

Frozen architecture:

```text
full snapshot bootstrap
  -> bounded semantic working state
  -> bounded browser-signal epoch
  -> semantic delta
  -> causal invalidation
  -> relevance gate
  -> bounded local Reactive VM continuation or compact reasoning patch
```

P2 controlled evidence gives **93.80%** median small-change reasoning-payload
reduction with exact canonical-state agreement and zero stale continuation, false
completion, foreground takeover, or relevant semantic loss.

P3 controlled evidence gives **0** unnecessary reasoning wakes across 1,280
irrelevant signals and exact detection of the later relevant signal.

P4 controlled evidence executes **8/8** read effects with **0** local reasoning
wakes and reduces model-mediated round trips from 9 to 1 (**88.89%**).

P5 fresh real-Opera evidence:

- Google Maps lazy feed grew **16 -> 25**, duplicate keys **0**, and reached
  `BOUNDED_COMPLETE` only after the stable second boundary observation. One RESET
  plus four steady-state delta reads gives **80.00%** full-snapshot reduction.
- GitHub route transition changed document generation **1 -> 2** and emitted
  `SPA_ROUTE` / `RESET`, preventing stale continuation.
- YouTube mutation **112707 -> 112708** remained `NO_RELEVANT_CHANGE` with zero
  semantic changes/changed regions.

P5 frozen gate evidence:

- false completion **0**;
- foreground takeover **0**;
- stale-state action **0**;
- relevant-signal loss **0**;
- small-change payload reduction **93.80%**;
- reasoning round-trip reduction **88.89%**;
- steady-state full-snapshot reduction **80.00%**;
- live mediation-elision transport-proxy median speedup **8.724x**;
- paired simple-operation median regression **-5.68%**.

P6 final-candidate evidence before documentation closeout:

- tests-first gate `b8cd79f27f135923a63657beced8563ed7e7a0c7`:
  CircleCI #114 **FAILURE** as expected before implementation;
- runtime fix `5652435e26f534126bfcee7c48df9ffd597fc52e`:
  new P6 control-flow tests passed, while CircleCI #115 exposed three stale
  historical byte locks for `lib/reactive-vm.js`;
- authorized lock rebaseline
  `49731c49e75df058dcd48218e680a8ad9aaf7195`:
  CircleCI #116 + Vercel **SUCCESS**;
- exact #116 full suite: **416/416 PASS**, zero failures/skips;
- `npm run check`: **PASS**, 26 allowlisted browser primitives, version 1.6.0;
- Chromium extension regression: **PASS**.

P6 continuation authority is now explicit: when `performanceCutover` metadata is
present, only an internally consistent `APPLY_AND_CONTINUE` with accepted context
may bind the effect and continue. RESET suspends stale state; REASON_REQUIRED,
IGNORE_FOR_TASK, unknown/missing decisions, malformed/inconsistent flags, or
unaccepted context suspend/fail closed. Effect results without P6 metadata remain
compatible with the pre-P6 low-level VM path.

P6 is intentionally a **maximal safe subset**: the live 7E host rejects
caller-asserted `taskDependencies`; therefore normal live relevance decisions
without a trustworthy server-authoritative dependency source resolve conservatively
to `REASON_REQUIRED`. Do not claim full integrated P3/P4 speedup from this candidate.

Detailed plan: `docs/delta-first-performance-plan.md`.

Acceptance/final-candidate records:
`docs/delta-first-performance-p0.md`,
`docs/delta-first-performance-p1.md`,
`docs/delta-first-performance-p2.md`,
`docs/delta-first-performance-p3.md`,
`docs/delta-first-performance-p4.md`,
`docs/delta-first-performance-p5.md`,
`docs/delta-first-performance-p6.md`.

## Pre-8E Performance Usability Repair

Status: **R0–R2 ACCEPTED / CLOSED; R3 NOT AUTHORIZED.**

A live Opera Agent YouTube responsiveness test on 2026-09-18 exposed practical
friction after P0-P6 closure: actionability/viewport ranking, stale dynamic refs,
oversized model-facing observations, internal-only media primitives, and expensive
video workflow orchestration. The user explicitly inserted a bounded repair track
before 8E.

Sequence:

- **R0** — benchmark + deterministic fixture lock;
- **R1** — actionability-first observation;
- **R2** — fresh target revalidation;
- **R3** — bounded local act + verify;
- **R4** — compact model-facing observation;
- **R5** — internal media fast path using existing `media.*` primitives only;
- **R6** — navigation optimization + residual transport measurement;
- **R7** — YouTube workflow cleanup;
- **R8** — full real-Opera acceptance of recommendation -> click -> skip -> summarize.

This track reuses the accepted semantic state/delta architecture. It does not reopen
Performance Track P, change Protocol 1, expand the 26 browser primitives or 18 public
MCP input schemas, enable the VM, grant transaction authority, or start 8E.

Detailed canonical plan:
`docs/pre-8e-performance-usability-repair-plan.md`.

Spec Kit feature:
`specs/001-pre-8e-performance-usability-repair/`.

## Exact next boundary

The P6 audit and repository-merge gates are closed. Exact audited candidate
`96ef1cfdbecc7c5c0e40486b6378501db606b84d` has CircleCI #118 + Vercel
SUCCESS. PR #46 is merged at
`6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`, with CircleCI #169 + Vercel
SUCCESS.

Production promotion is complete and verified at `opera-agent-vm` version 27.
Performance Track P is closed. Pre-8E repair R0–R2 are ACCEPTED/CLOSED. R2 implementation evidence head `70c79db6d76ab624d19bd5d6067a1469ef522045` has CircleCI #226 + Vercel SUCCESS, with durable evidence in `docs/pre-8e-performance-usability-r2.md`. **STOP after R2.** R3 requires a new explicit user instruction. **Milestone 8E remains paused/not started and must not start implicitly.**

## Collaboration rule

- one active writer;
- repository/CI/production evidence outranks chat;
- tests precede runtime behavior;
- temporary acceptance state must be cleaned up before closure;
- independent audit is mandatory at the track/milestone boundary;
- auth/authz, tenancy, encryption, signing, public MCP, extension distribution,
  irreversible effects, production schema, and transaction authority require their
  own explicit review boundary.

Authoritative policy: `AGENTS.md`.

## Explicitly deferred

Server-authoritative P3 dependency-context plumbing beyond the safe subset,
continuous desktop/video streaming, synchronized A/V understanding, OS mouse/
keyboard control, arbitrary JavaScript/raw CDP, silent foreground fallback,
site-specific extension logic, direct logical-ID actions, automatic consequential
actions, and Checkpoint 8E until the Performance Track gate above is satisfied.
