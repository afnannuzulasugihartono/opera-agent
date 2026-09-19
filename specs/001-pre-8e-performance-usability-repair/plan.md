# Implementation Plan: Pre-8E Performance Usability Repair

**Branch**: `feat/pre-8e-usability-repair-r3` (R3 only) | **Date**: 2026-09-18 | **Spec**: `specs/001-pre-8e-performance-usability-repair/spec.md`

**Input**: Live YouTube responsiveness findings plus canonical Opera Agent governance.

## Summary

Insert a bounded findings-driven repair track between closed Performance Track P0-P6
and paused Milestone 8E. The repair first makes model-facing observations
actionability-first, then safely revalidates fast-changing refs near action time,
returns bounded post-action change evidence, compacts model-facing observations,
uses existing internal media primitives, and finally optimizes workflow/transport
only where measurements justify it.

The track MUST reuse the existing semantic state/delta system; it must not build a
second browser-state system or expand transaction authority.

All checkpoints also use the repository's evidence-first bug repair loop. An
unexpected error/regression interrupts normal execution: capture exact evidence,
reproduce/localize, research the root cause, protect it with deterministic
regression evidence, apply the smallest generic repair, then rerun focused and
required full gates before normal checkpoint work resumes.

## Technical Context

**Language/Version**: JavaScript ES modules for extension/tests; TypeScript/Deno for Supabase Edge functions/workflows where applicable.

**Primary Dependencies**: Opera/Chromium Manifest V3 APIs, `chrome.debugger`/CDP, current semantic identity/views/delta runtime, Supabase command/workflow layer.

**Storage**: Existing bounded semantic runtime + existing Supabase structures only. No production schema change is authorized by this plan.

**Testing**: Node test suite, static `npm run check`, controlled Chromium/Opera acceptance, exact YouTube Skip benchmark, workflow timing evidence.

**Target Platform**: Opera desktop with Opera Agent extension 1.6.0; current Supabase production architecture.

**Project Type**: Browser extension + MCP/Edge control plane.

**Performance Goals**:
- remove model-mediated refind/filter from the normal Skip path;
- at least 70% compact model-view payload reduction on controlled equivalent facts;
- ready-media internal seek p50 <=1s;
- at least 50% reduction from the frozen ~20.514s transcript workflow baseline, or evidence-backed residual explanation.

**Constraints**:
- Protocol 1;
- 26 browser primitives;
- 18 public MCP tool names and input schemas;
- background-first;
- zero stale-state action / false completion / foreground takeover / relevant-change loss;
- 8E and transaction authority remain out of scope.

**Scale/Scope**: R0-R8 only; YouTube is the primary empirical acceptance scenario with generic fixtures proving site-agnostic behavior.

## Constitution Check

**PASS for R3 start. R3 only is authorized; R4 is not authorized.**

- Repository authority remains above Spec Kit.
- 8E remains paused/not started.
- R0 changed tests/fixtures/documentation only; no behavior-changing runtime implementation occurred.
- Tests-first is mandatory before R1/R2/R3/R4/R5/R6/R7 behavior changes.
- Public MCP/auth/signing/schema/transaction boundaries are not expanded.
- One active writer rule remains in force.
- The required read-only `$speckit-analyze` consistency gate was completed before R0 implementation.
- R1 tests-first implementation and exact-head closeout are complete.
- The required read-only consistency analysis was re-run before R2 and found no conflict with the frozen R2 contract.
- R2 tests-first implementation and exact-head closeout are complete.
- The required read-only consistency analysis was re-run before R3 and found no conflict with the frozen R3 contract.
- The user explicitly authorized R3 only; R4 and later checkpoints still require separate explicit instruction.
- R3 is bounded to post-action settle/change evidence using existing semantic state/delta machinery and must not claim goal completion or add public surface.
- The evidence-first bug repair loop in `AGENTS.md` is binding for this feature: failures must be evidenced, localized/reproduced, researched, regression-protected, minimally repaired, and verified before checkpoint execution continues.
- Platform/browser/library/protocol uncertainty requires primary upstream evidence; a fully proven repository-local defect may use local evidence alone when the reasoning is recorded.
- Blind reruns, guess-patching, safety-assertion deletion, and threshold weakening are not valid repair strategies. A third same failure without materially new evidence becomes BLOCKED + diagnostics/early audit.

Re-check the constitution gate and run the required analysis again before any R4 implementation.

## Project Structure

### Documentation (this feature)

```text
specs/001-pre-8e-performance-usability-repair/
├── spec.md
├── plan.md
├── research.md
└── tasks.md

docs/
└── pre-8e-performance-usability-repair-plan.md
```

### Expected source/test touch points after implementation authorization

```text
extension/
├── content.js
├── background.js
└── lib/protocol.js              # preserve 26 methods / Protocol 1

supabase/functions/
├── opera-agent-mcp/index.ts      # model-facing shaping only if compatibility allows
└── opera-agent-runner/index.ts   # only if workflow optimization needs it

supabase/migrations/
└── existing workflow definitions # no new production schema authorized

tests/
├── controlled-browser.mjs
├── mcp.test.mjs
├── efficiency.test.mjs
└── fixtures/
    └── pre-8e-usability-baseline-r0-v1.json
```

**Structure Decision**: Use existing extension/server/test layout; do not add a new runtime layer.

## Failure Handling Workflow

This workflow applies to every R0-R8 checkpoint and interrupts the normal
checkpoint sequence whenever an unexpected error, bug, CI regression, browser
mismatch, or failing acceptance gate appears.

1. **Evidence capture** — record exact branch/head SHA, failing gate/job/command,
   assertion/error text, reproduction inputs, and last known-good evidence.
2. **Reproduce/localize** — use authoritative source, tests, Git history, CI
   artifacts, browser/runtime observations, and project docs to identify the
   smallest failing boundary before editing.
3. **Research** — form a falsifiable root-cause hypothesis. Use repository
   evidence first; when the behavior depends on browser/platform/library/protocol
   semantics or remains uncertain, consult primary official/upstream sources.
   Record why external research is unnecessary when the defect is fully explained
   locally.
4. **Regression proof** — add or identify a deterministic test/assertion that
   fails for the defect before runtime repair. Preserve existing safety and
   compatibility assertions.
5. **Minimal repair** — implement the smallest generic fix. Do not widen public
   authority/surface, weaken thresholds, delete assertions, or introduce
   site-specific exceptions just to make a gate pass.
6. **Verification** — run the focused regression first, then all full/static/
   browser/cloud/security gates required by the active checkpoint.
7. **Loop or block** — any new failure restarts this workflow as new evidence.
   Three repetitions of the same failure without materially new evidence mark the
   work BLOCKED and require diagnostics plus an early independent audit request.

Normal checkpoint work resumes only after the active failure is explained and its
required verification gates pass.

## Repair Checkpoints

### R0 — benchmark/fixture lock

Freeze the empirical YouTube measurements and build deterministic fixtures for:
- offscreen `Skip navigation` vs on-screen `Skip`;
- dynamic re-render/stale ref;
- irrelevant mutation noise;
- model-facing payload baseline;
- ready-media seek;
- transcript workflow timing/output shape.

No runtime behavior change.

### R1 — actionability-first observation

Tests first, then:
- make viewport truth geometry-correct;
- rank visible + in-viewport + enabled + non-sensitive actionable controls first;
- apply ranking before model-facing element cap;
- keep generic/site-agnostic semantics;
- preserve canonical semantic identity/delta.

Stop and accept R1 before R2.

### R2 — fresh target revalidation

Tests first, then add bounded same-document revalidation close to action time:
- use current trusted ref/descriptor evidence;
- allow only unique equivalent replacement;
- reject route/document reset, ambiguity, sensitivity change or weak evidence;
- never use `logicalId` alone as action authority;
- zero guessed coordinate fallback.

Stop and accept R2 before R3.

### R3 — local act + verify

Tests first, then return bounded fresh post-action evidence:
- action result;
- revision/mutation/semantic change evidence;
- target presence/absence when safely observable;
- no completion claim.

Prefer composing with existing burst/state machinery rather than a new workflow VM.

### R4 — compact model-facing observation

Tests first:
- separate internal canonical state from model-facing task view;
- prioritize actionable controls, important text and relevant deltas;
- retain trusted full snapshot/reset recovery;
- prove >=70% payload reduction on controlled equivalent facts with zero relevant loss.

Compatibility must be proven before changing default MCP output shaping.

### R5 — internal media fast path

Use existing `media.state/play/pause/seek` inside approved server workflows where it
eliminates navigation/reload. Do not add public MCP tools or inputs.

### R6 — navigation/transport efficiency

First remove unnecessary navigation:
- reuse existing tab/state;
- prefer site SPA action when already loaded;
- prefer media seek over URL-time navigation.

Only after R1-R5 benchmarks, quantify residual queue/transport share. Realtime wake
remains a separately approved optional sub-step, not an automatic implementation task.

### R7 — YouTube workflow cleanup

Optimize `youtube.get_transcript`/related workflow behavior:
- transcript-specific reads where possible;
- remove redundant queries/waits;
- avoid foreground activation unless rendering proves it necessary;
- exclude comments/recommendations/sponsored text from the primary transcript output;
- preserve safe fallback.

### R8 — full real-Opera acceptance

Run the same user prompt end to end and record:
- tool/model-mediated round trips;
- total/task-segment latency;
- target-resolution success;
- stale-ref count/recovery;
- payload sizes;
- foreground takeover;
- relevant-state loss;
- transcript workflow timing.

Only after R8 PASS may the repository return to an explicit 8E start decision.

## Complexity Tracking

No constitution violation is authorized. If an implementation requires:
- a 19th public MCP tool,
- public input-schema change,
- production schema change,
- Realtime transport cutover,
- VM enablement,
- transaction authority,
it must STOP and create a separate reviewed scope.
