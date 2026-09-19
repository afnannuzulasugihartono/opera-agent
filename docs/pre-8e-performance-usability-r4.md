# Pre-8E Performance Usability Repair — R4 Evidence

Status: **R4 ACCEPTED / CLOSED — T021–T025 COMPLETE; implementation/evidence head CircleCI #244 + Vercel SUCCESS; closeout head CircleCI #245 + Vercel SUCCESS**

Date: 2026-09-19

Branch: `feat/pre-8e-usability-repair-r3`

R3 accepted closeout evidence:
`docs/pre-8e-performance-usability-r3.md`

R4 tests-first head:
`7412404bdd50771ce55e7f0a523d0ababaa4abb5`

R4 runtime implementation head:
`6887663421882df099fc70d2a4ba12ae7e442f29`

R4 final implementation/evidence head:
`4c1e4cbbe0644b06bf51ce952be78edac8aa9182` — CircleCI #244 SUCCESS + Vercel SUCCESS

## Scope

R4 implements T021–T025 only: compact model-facing observation while preserving
the existing canonical semantic identity/state/delta machinery and trusted
full/reset recovery.

R4 does not change Protocol 1, the 26 allowlisted browser primitives, the 18
public MCP tool names, the public `read_page` input schema, transaction
authority, production database shape, VM enablement, signed release state, or
Milestone 8E.

## T021 — public compatibility freeze

The R4 compatibility test freezes:

- Protocol version **1**;
- **26** allowlisted browser primitives;
- **18** public MCP tools;
- the existing public `read_page` input schema with **no public `view` field**.

The MCP implementation may select compact projection internally, but caller-visible
tool inventory/input authority remains unchanged.

## T022 — tests-first evidence

Tests-first head:
`7412404bdd50771ce55e7f0a523d0ababaa4abb5`

CircleCI #241 failed as expected before T023 because compact reads did not yet expose
`compactView`. This established the red test for the required model-facing
projection.

Controlled R4 fixture:
`tests/fixtures/pre-8e-usability-r4.html`

It contains:

- one on-screen actionable `Skip ad` button;
- an input whose placeholder must survive projection;
- a mutable toggle target;
- an SPA route-change target;
- deterministic hidden/offscreen/below-viewport noise.

## T023 — compact model-facing projection

Runtime implementation head:
`6887663421882df099fc70d2a4ba12ae7e442f29`

The existing canonical observation still runs first. Compact mode then projects a
bounded set of changed/actionable/in-viewport non-sensitive elements and the
canonical semantic delta to the model.

Preserved behavior:

- default primitive `page.read` remains legacy/full for compatibility;
- explicit internal `view: "full"` remains a trusted recovery escape hatch;
- compact mode omits internal `semanticState` and `semanticViews` from the
  model-facing response but does not replace their internal state machinery;
- compact mode retains `semanticDelta`;
- public MCP `read_page` selects compact mode internally without adding a
  public input field.

## T024 — controlled payload and relevant-fact proof

CircleCI #244 Chromium output reports:

- `compactViewProjected = true`;
- **payloadReductionPercent = 96.54%**;
- `onScreenTargetRetained = true`;
- `noiseExcluded = true`;
- `changeEvidenceRetained = true`;
- `resetRecoverySurfaced = true`.

The acceptance assertion requires compact bytes to be at most 30% of the equivalent
legacy response, so the required >=70% reduction is enforced by the test rather
than inferred after the run.

Relevant information retained by the controlled test:

- the on-screen actionable `Skip ad` target;
- the search input placeholder;
- the changed toggle target after action;
- the canonical semantic change identifying that target;
- SPA-route RESET with `completeSnapshotRequired=true`.

Hidden dialog controls, offscreen links, and below-viewport recommendation noise do
not dominate the compact model-facing projection.

## T025 — full gate evidence

Exact implementation/evidence head:
`4c1e4cbbe0644b06bf51ce952be78edac8aa9182`

CircleCI #244: **SUCCESS**.

Unit/static output:

- tests: **426**;
- pass: **426**;
- fail: **0**;
- skipped: **0**;
- `npm run check`: **PASS**;
- check result: **26 allowlisted browser primitives, version 1.6.0**.

Browser gate:

- Playwright installation: PASS;
- Chromium extension regression: **PASS**;
- R4 compact acceptance block: all six booleans true;
- background-focus audit remains preserved in the full regression.

Vercel for the same exact head: **SUCCESS**.

## Evidence-first failure chains

R4 encountered only explained, deterministic compatibility-lock failures after the
runtime implementation:

1. **CircleCI #242 — 419/426 PASS, seven failures**
   - Evidence: four historical Git-blob MCP locks and three canonical MCP source
     locks still expected the pre-R4 MCP file.
   - Root cause: R4 intentionally changed internal `read_page` projection routing
     while preserving tool names/input schemas.
   - Regression proof: new R4 inventory/schema tests already passed while the old
     byte locks failed.
   - Minimal repair: rebaseline only the authorized MCP source locks; P2/P3 were
     tightened to require internal `view:"compact"` routing while rejecting a
     public Zod `view` field.
   - Repair head:
     `d3958d7823401822bc92a9280ec225d2b5e73c01`.

2. **CircleCI #243 — 423/426 PASS, three failures**
   - Evidence: the remaining failures were derived 6A/7A/8A contract values still
     embedding the pre-R4 MCP SHA-256/inventory digest.
   - Root cause: those fixtures derive their inventory digest from the MCP source
     digest and therefore became stale after the authorized internal MCP change.
   - Regression proof: exact actual values were reported by the canonical tests.
   - Minimal repair: update only the six derived fixture/test constants; no runtime,
     public schema, threshold, or safety assertion was weakened.
   - New MCP canonical SHA-256:
     `4cf462a3cd4683b20e17fe2679e8dc762706129088b33a1c339826c6b43e31fb`.
   - New derived inventory digest:
     `sha256:3f879c35ef89d30075d0ed9be08965f75f25f34f19a697f2b00fbe4b21a25137`.
   - Repair/evidence head:
     `4c1e4cbbe0644b06bf51ce952be78edac8aa9182`.

3. **CircleCI #244 — full verification**
   - 426/426 unit tests PASS;
   - static check PASS;
   - Chromium PASS;
   - compact payload reduction 96.54%;
   - Vercel SUCCESS.

No blind rerun or guess patch was used; each failure produced new evidence and a
bounded compatibility repair.

## Invariants

At the R4 implementation/evidence head:

- Protocol: **1**;
- browser primitives: **26**;
- public MCP tools: **18**;
- public `read_page` input schema: unchanged; no public `view` field;
- canonical semantic state/delta remains authoritative internally;
- trusted full/reset recovery remains available;
- background-first and sensitive/file-upload guards remain covered by the full
  regression;
- no production deploy/schema mutation;
- `milestone7_vm_enabled=false` remains outside R4 and unchanged;
- Milestone 8E remains paused/not started.

## Closeout

T021–T025 are complete. Implementation/evidence head
`4c1e4cbbe0644b06bf51ce952be78edac8aa9182` has CircleCI #244 + Vercel
SUCCESS. Documentation closeout head
`c2f2875686014439404b47518f9cc1789e202a7f` has CircleCI #245 + Vercel
SUCCESS. Under the standing CI-evidence authorization, R4 is ACCEPTED/CLOSED.
R5 may proceed sequentially; Milestone 8E remains paused/not started.
