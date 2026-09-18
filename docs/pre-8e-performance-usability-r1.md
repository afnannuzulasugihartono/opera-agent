# Pre-8E Performance Usability Repair — R1 Evidence

Status: **R1 ACCEPTED / CLOSED — R2 NOT AUTHORIZED**

Date: 2026-09-18

Branch: `feat/pre-8e-usability-repair-r1`

R0 accepted base:
`a8281edba35b0d74bc2395a46504d8c519da8a18`

R1 implementation evidence head:
`b0ff03cd0f3ecbf4498b8392760d9492fb44ff77`

## Scope

R1 implements only actionability-first observation from
`specs/001-pre-8e-performance-usability-repair/tasks.md` T007–T011.

R2 fresh-target revalidation is not implemented. Protocol 1, the 26 browser
primitives, the 18 public MCP tool names/input schemas, background-first behavior,
canonical semantic identity/delta authority, VM enablement, transaction authority,
production schema/deployment, Milestone 8E, and the preserved accidental 8E stash
remain outside this checkpoint.

## T007/T008 — viewport truth and actionability-first ranking

`extension/content.js` now derives bounded actionability state from CSS visibility,
actual viewport geometry, enabled/disabled/read-only/ARIA-disabled state,
sensitive-target classification, and pointer-events availability.

An element is actionable only when it is visible, in the viewport, enabled,
non-sensitive, and pointer-enabled. Generic actionability ranking is applied before
bounded truncation in model-facing observation/query paths. Equal-rank items preserve
original DOM order. No YouTube-specific selector or opcode was added.

## T009 — adversarial controlled acceptance

Added `tests/fixtures/pre-8e-usability-r1.html` with CSS-visible offscreen
`Skip navigation`, hidden/disabled/sensitive Skip variants, one on-screen enabled
non-sensitive `Skip`, and bounded-truncation noise.

Controlled Chromium assertions prove the on-screen `Skip` ranks first, the
offscreen control remains `inViewport=false`, disabled/sensitive alternatives
cannot outrank the safe target, hidden controls are excluded from visible-only find,
and `limit: 1` still returns the actionable target.

The legacy R0 fixture remains a cross-check: after R1 its on-screen Skip ranks ahead
of the offscreen navigation link, while stale refs are still rejected. R2 recovery
was therefore not implemented accidentally.

## Semantic-delta compatibility diagnostics

R1 makes bounded observation membership viewport-sensitive. The controlled semantic
identity regression was aligned to isolate identity continuity from viewport movement
and respect the existing `removalGraceObservations=1` contract.

The test still requires stable logical identity across benign same-document rerender,
a fresh ref after DOM replacement, rejection of the old stale ref, and no R2-style
automatic stale-target rebind.

## Historical frozen-lock rebaseline

R1 intentionally changed `extension/content.js`, whose SHA-1 became
`a34da8a70f8e48a858c281e403d16a244e78f72c`.

Four historical P2/P3/P4/P5 byte-lock tests still expected
`e4363c6f016eba499eca6e6b1c2e8a1f8eac5669`. After verifying the runtime diff
was entirely inside authorized R1 scope, only those four content-file locks were
rebaselined. Background, manifest, MCP and prior runtime locks were not changed.

## T010 — verification evidence

Exact implementation evidence head
`b0ff03cd0f3ecbf4498b8392760d9492fb44ff77`:

- CircleCI **#219 SUCCESS**;
- Vercel **SUCCESS**.

The required CircleCI path covers full `npm test`, `npm run check`, Playwright
setup, and controlled Chromium extension regression via
`python tests/browser_extension_test.py`.

The R0-to-R1 net runtime/public-surface diff does not modify
`extension/background.js`, `extension/manifest.json`,
`extension/lib/protocol.js`, or
`supabase/functions/opera-agent-mcp/index.ts`. Protocol remains 1, the browser
primitive inventory remains 26, and the public MCP inventory/input schemas remain
18/unchanged.

Red CI runs during R1 produced new diagnostic evidence rather than blind retries:
stale historical content locks, viewport-sensitive bounded semantic membership,
removal-grace timing, obsolete R0 ordering expectations, and one stale test-summary
variable. Each was corrected at its actual layer. The final exact implementation
head is green.

## T011 — cleanup and closeout

Temporary `.github/workflows/r1-diagnostic.yml` instrumentation is removed in the
R1 closeout. Spec/plan/tasks, roadmap, project context, and handoff are converged on
the same boundary:

- R0–R1 ACCEPTED / CLOSED;
- R2 NOT AUTHORIZED / NOT STARTED;
- Milestone 8E paused/not started;
- no implicit advancement.

STOP after R1. Do not start R2 or Milestone 8E without a new explicit user instruction.
