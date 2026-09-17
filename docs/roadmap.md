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

8E remains paused while Performance Track P is not yet independently audited.

## Performance Track P — Delta-First Runtime

Status: **P0 accepted. P1 accepted. P2 accepted. P3 accepted. P4 accepted. P5 FINAL CANDIDATE — exact-head CI required. Independent track audit not started.**

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
- **P5** — current final candidate, paired controlled + fresh real-Opera
  performance/correctness acceptance.

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

P5 fresh real-Opera evidence covers all three required application shapes:

- Google Maps lazy feed grew **16 -> 25** with duplicate keys `0`, did not complete
  at the first bottom, and reached `BOUNDED_COMPLETE` only after a stable second
  boundary observation. One RESET plus four steady-state delta reads gives
  **80.00%** full-snapshot reduction.
- GitHub route transition changed document generation **1 -> 2** and emitted
  `SPA_ROUTE` / `RESET`, preventing stale continuation.
- YouTube live DOM mutation **112707 -> 112708** remained
  `NO_RELEVANT_CHANGE` with zero semantic changes/changed regions.

P5 frozen gate evidence:

- false completion **0**;
- foreground takeover **0**;
- stale-state action **0**;
- relevant-signal loss **0**;
- small-change payload reduction **93.80%** (target >=75%);
- reasoning round-trip reduction **88.89%** (target >=60%);
- steady-state full-snapshot reduction **80.00%** (target >=80%);
- three-run live mediation-elision median speedup **8.724x** (target >=2x);
- paired simple-operation median regression **-5.68%** (ceiling <=15%).

The live speed comparison is a mediation-elision transport proxy over the same eight
read effects per arm; actual P4 host semantics remain proven by deterministic P4
tests. P5 makes no runtime, extension, MCP, schema/function, signing, pairing, OAuth,
or transaction-authority mutation.

Detailed plan: `docs/delta-first-performance-plan.md`.

Acceptance records:
`docs/delta-first-performance-p0.md`,
`docs/delta-first-performance-p1.md`,
`docs/delta-first-performance-p2.md`,
`docs/delta-first-performance-p3.md`,
`docs/delta-first-performance-p4.md`,
`docs/delta-first-performance-p5.md`.

## Exact next boundary

P5 becomes accepted only after CircleCI and Vercel are SUCCESS on its exact
final-candidate head. Pending required CI means STOP; failure means diagnose P5 only.

After P5 acceptance, the next boundary is an **independent proportionate
performance/correctness audit of the complete Performance Track P**. Per `AGENTS.md`,
only audit `PASS` permits returning to Milestone 8 at 8E unless the user explicitly
accepts documented residual risk. **Do not start 8E during P5 closeout.**

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

Continuous desktop/video streaming, synchronized A/V understanding, OS mouse/
keyboard control, arbitrary JavaScript/raw CDP, silent foreground fallback,
site-specific extension logic, direct logical-ID actions, automatic consequential
actions, and Checkpoint 8E until Performance Track P audit PASS.
