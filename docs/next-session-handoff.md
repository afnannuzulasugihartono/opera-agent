# Opera Agent next-session handoff

Last synchronized: 2026-09-17.

Checkpoint 8D is fully closed. Performance Track P remains the selected work before
8E. P0–P4 are accepted. P5 is a **FINAL CANDIDATE** with fresh real-Opera evidence
and all frozen metric gates met; exact-head CircleCI + Vercel/status are still
required. The independent complete-track audit has not started. 8E remains
paused/not started.

## Authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable extension: 1.6.0
Protocol: 1
Browser capabilities: 26
Public MCP tools: 18
Signed rollback: 1.5.2

Accepted heads:

- P0 `699578904e2f19ea713a0933632331cad7299c11` — CircleCI #76 + Vercel
- P1 `cbf3259a337d92410a5ba805dd0fd987a51c1bc5` — CircleCI #85 + Vercel
- P2 `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d` — CircleCI #91 + Vercel
- P3 `d5310508aeb5c156657bd4d4abd06a4d172daaba` — CircleCI #94 + Vercel
- P4 `e550bc90f49df2541dfd91789d99b2b33e4bf2aa` — CircleCI #98 + Vercel

Durable 8D closeout:
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`.

Canonical plan:
`docs/delta-first-performance-plan.md`.

Current P5 acceptance candidate:
`docs/delta-first-performance-p5.md`.

Machine-readable evidence:
`tests/fixtures/delta-performance-p5-v1.json`.

Gate test:
`tests/delta-performance-p5.test.mjs`.

## What P5 did

P5 is acceptance-only. It made no runtime, extension, public MCP, Supabase schema/
function, Edge, OAuth, signing/pairing, production transaction-policy, or 8E
implementation change.

The paired Opera Agent device was online on extension 1.6.0, protocol 1, 26
capabilities. Fresh acceptance used the existing accepted command path.

### Google Maps

Background restaurant-search feed evidence:

- initial loaded entities: 16
- final loaded entities: 25
- duplicate keys: 0
- first bottom: PARTIAL
- boundary stable observations: 2
- final classification: NO_RELEVANT_CHANGE
- final completion: BOUNDED_COMPLETE
- five read classifications: RESET, MOVE, MIXED, MOVE, NO_RELEVANT_CHANGE
- full bootstrap reads: 1/5
- steady-state delta reads: 4/5
- full-snapshot reduction: 80.00%

Important correctness point: completion was not emitted on the first bottom reach;
it required a stable second boundary observation.

### GitHub

Background structured-content/SPA evidence:

- semantic regions: 11
- repeated-list loaded entities: 10
- repeated-list duplicate keys: 0
- target tab remained active=false
- Issues route transition changed document generation 1 -> 2
- reset reason: SPA_ROUTE
- classification: RESET

Do not weaken this reset boundary; it is the fresh stale-state safety evidence.

### YouTube

Live dynamic/media evidence:

- mutation version 112707 -> 112708
- second classification NO_RELEVANT_CHANGE
- semantic changes 0
- changed semantic regions 0

P3's deterministic 1,280-signal storm test remains the authority for showing that
irrelevant churn suppression does not hide a later relevant signal.

## Frozen P5 gates and evidence

- false completion: 0
- foreground takeover: 0
- stale-state action: 0
- relevant-signal loss: 0
- small-change payload reduction: 93.80% >= 75%
- repetitive reasoning-round-trip reduction: 88.89% >= 60%
- steady-state full-snapshot reduction: 80.00% >= 80%
- long repetitive median speedup: 8.724x >= 2.0x
- simple-operation median regression: -5.68% <= 15%

The 93.80% payload gate comes from the accepted/byte-locked P2 paired controlled
benchmark. The 88.89% round-trip gate comes from the accepted/byte-locked P4
controlled host workload.

## Live timing methodology

Long-task timing used three paired real Opera relay runs. Each arm contains the same
eight small `page.read` effects.

Baseline:
- issue each effect only after the previous effect completed and the model/tool
  boundary returned.

Comparison:
- bulk-enqueue the same independent effects to remove model/tool mediation.

Results:

- run 1: 40,010.506 ms -> 4,894.013 ms = 8.175x
- run 2: 43,704.939 ms -> 5,009.552 ms = 8.724x
- run 3: 53,733.039 ms -> 4,976.989 ms = 10.796x
- median = 8.724x

This is a **MEDIATION_ELISION_TRANSPORT_PROXY**, not a claim that the P4 JS host
directly executed the external browser run. Actual P4 local-host correctness is
locked by deterministic P4 tests.

Paired small-read `claimed_at -> completed_at` medians:

- baseline n=24: 309.192 ms
- comparison n=24: 291.628 ms
- regression: -5.68%

Do not compare those live relay values directly to the historical isolated-browser
19.83 ms measurement; the environments differ.

## Safety and cleanup

P5 command audit:

- tabs.activate = 0
- page.pointer = 0
- page.fill/page.key = 0
- remaining dedicated P5 test tabs = 0

One GitHub tab close initially failed with a transient “tab may be dragging” error
and passed on one retry. One stale-tab page.read preflight failed with `No tab with
id`; it is explicitly recorded and excluded from acceptance metrics. Do not hide or
relabel either event.

## Runtime byte locks required by P5

P5 gate tests freeze:

- `lib/event-driven-local-execution-p4.js`
- `lib/multi-signal-relevance-p3.js`
- `lib/delta-first-observation-p2.js`
- `lib/reactive-vm.js`
- `lib/reactive-vm-7c.js`
- `lib/reactive-vm-7d.js`
- `extension/content.js`
- `extension/background.js`
- `extension/manifest.json`
- `supabase/functions/opera-agent-mcp/index.ts`

No P5 closeout commit should modify any of these files.

## Exact next gate

1. Confirm current branch head is the P5 final-candidate commit.
2. Require CircleCI and Vercel/status SUCCESS on that exact head.
3. Pending/queued/in-progress => STOP.
4. Failure => diagnose only the P5 failure.
5. If both checks are green, P5 is accepted without a status-only commit.
6. **Do not start 8E.**
7. Next user-authorized work is an independent proportionate performance/correctness
   audit of the complete Performance Track P.
8. Only audit PASS permits return to 8E unless the user explicitly accepts documented
   residual risk.

## Closed 8D / user-local state

The one-run hosted 8D Edge concurrency authorization was consumed. Do not rerun
`RUN_8D_EDGE_CONCURRENCY.cmd`.

Two accidental untracked 8E files remain in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash automatically. Inspect it against canonical 8E scope only
if/when 8E resumes after the Performance Track audit.

## Permanent invariants

- one active writer
- tests before runtime behavior
- repository/CI/production evidence outranks chat
- background-first browser operation
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch
- preserve signing identity/pairing and immediate signed rollback
- never commit or print credentials or sensitive page values
- action success is not task-completion proof
- performance gains never justify stale-state action, false completion, missed
  relevant changes, or foreground takeover
