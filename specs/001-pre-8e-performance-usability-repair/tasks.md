# Tasks: Pre-8E Performance Usability Repair

**Input**: `spec.md`, `plan.md`, `research.md`

**Status**: R0–R3 ACCEPTED / CLOSED. R4 T021–T025 COMPLETE with implementation/evidence gates PASS at CircleCI #244 + Vercel SUCCESS; R4 closeout acceptance awaits exact-head closeout CI. R5 is NOT STARTED.

**Execution rule**: Run `$speckit-analyze` and obtain explicit implementation instruction before T001. Complete checkpoints sequentially; STOP after each checkpoint acceptance.

**Failure branch (mandatory for every task/checkpoint)**: Any unexpected error, bug, CI regression, browser mismatch, or failing acceptance gate immediately pauses normal task execution. Capture exact evidence, reproduce/localize, research the root cause, add or identify deterministic regression evidence, apply the smallest generic fix, and run the focused regression before required full gates. Use primary official/upstream sources when browser/platform/library/protocol behavior is relevant or the local cause is not proven; record when local repository evidence is sufficient. Do not blind-rerun, guess-patch, delete safety/compatibility assertions, weaken thresholds, or widen scope/surface to make CI pass. A new failure restarts this branch. Three repetitions of the same failure without materially new evidence => BLOCKED + diagnostics + early independent audit request.

## Phase R0 — Baseline and deterministic fixtures

- [x] T001 Create `tests/fixtures/pre-8e-usability-baseline-r0-v1.json` with the frozen empirical timing/payload facts and clearly mark single-run measurements as non-distributional.
- [x] T002 Add a controlled-browser fixture with offscreen `Skip navigation` and on-screen `Skip`, dynamic re-render, irrelevant mutation churn, and media element.
- [x] T003 Add failing tests proving current target ordering/viewport evidence does not satisfy R1 acceptance.
- [x] T004 Add failing tests proving a benign dynamic re-render currently yields stale-target failure before R2.
- [x] T005 Add payload measurement for legacy model-facing `page.read` equivalent facts.
- [x] T006 Record R0 evidence and STOP for checkpoint review.

## Phase R1 — Actionability-first observation

- [x] T007 [US1] Implement geometry-correct viewport truth in `extension/content.js`.
- [x] T008 [US1] Implement generic actionability ranking before bounded model-facing truncation in `extension/content.js`.
- [x] T009 [US1] Prove hidden/offscreen/disabled/sensitive controls cannot outrank the unique on-screen actionable target.
- [x] T010 [US1] Run focused tests + full `npm test` + `npm run check`; verify Protocol 1 / 26 primitives / 18 public MCP tools remain unchanged.
- [x] T011 Record R1 evidence and STOP for acceptance.

## Phase R2 — Fresh target revalidation

- [x] T012 [US2] Add failing tests for same-document unique replacement, ambiguous replacement, route reset, sensitive change and disappearing target.
- [x] T013 [US2] Implement bounded fresh-target descriptor/revalidation using current trusted browser evidence close to action time.
- [x] T014 [US2] Ensure `logicalId` alone cannot authorize action and coordinate guessing is never used as stale-ref recovery.
- [x] T015 [US2] Prove stale-state action count is zero in focused + controlled-browser tests.
- [x] T016 Record R2 evidence and STOP for acceptance.

## Phase R3 — Local action verification

- [x] T017 [US3] Add failing tests for bounded post-action revision/change evidence.
- [x] T018 [US3] Implement post-action settle/verification using existing state/delta machinery without declaring task completion.
- [x] T019 [US3] Prove click that removes/changes a target returns fresh evidence without a mandatory full reread.
- [x] T020 Run focused/full/static/browser gates; for every failure encountered during R3, record the Evidence -> Research -> Regression Proof -> Minimal Repair -> Verification chain; then STOP for R3 acceptance.

## Phase R4 — Compact model-facing observation

- [x] T021 [US3] Freeze a compatibility test for the current MCP inventory/input schemas.
- [x] T022 [US3] Add failing payload/relevant-fact tests for compact model-facing output.
- [x] T023 [US3] Implement compact model-facing projection while retaining canonical internal state and trusted reset/full-snapshot recovery.
- [x] T024 [US3] Demonstrate >=70% controlled payload reduction with zero relevant target/change loss. Controlled Chromium evidence: 96.54% reduction; on-screen target/change/reset evidence retained.
- [x] T025 Run compatibility/full/static/browser gates and STOP for R4 acceptance. CircleCI #244: 426/426 unit tests PASS, `npm run check` PASS, Chromium extension regression PASS; Vercel SUCCESS.

## Phase R5 — Internal media fast path

- [ ] T026 [US4] Add workflow tests that use existing `media.state/play/pause/seek` without public MCP expansion.
- [ ] T027 [US4] Replace safe URL-time navigation/reload with internal `media.seek` in approved video workflow paths.
- [ ] T028 [US4] Measure controlled ready-media seek p50 and verify no navigation/reload.
- [ ] T029 Verify public MCP tool count/input schemas remain unchanged and STOP for R5 acceptance.

## Phase R6 — Navigation and residual transport

- [ ] T030 Measure avoidable vs unavoidable navigation latency after R1-R5.
- [ ] T031 Prefer tab reuse/SPA/local action paths where behavior-equivalent and tested.
- [ ] T032 Quantify residual queue/transport share.
- [ ] T033 If Realtime wake is still justified, STOP and request a separately reviewed production-transport scope before implementation; otherwise close R6 without transport migration.

## Phase R7 — YouTube workflow cleanup

- [ ] T034 [US4] Add output-shape/timing tests for `youtube.get_transcript`.
- [ ] T035 [US4] Reduce redundant query/wait/activation operations while preserving background-first fallback behavior.
- [ ] T036 [US4] Make primary transcript/content output exclude unrelated comments/recommendations/sponsored content where safely possible.
- [ ] T037 [US4] Demonstrate >=50% improvement from ~20.514s frozen baseline or record evidence-backed residual bottleneck.
- [ ] T038 STOP for R7 acceptance before full end-to-end test.

## Phase R8 — Full acceptance and closeout

- [ ] T039 Run the original YouTube recommendation/click/skip/summarize prompt in real Opera.
- [ ] T040 Record total latency, per-step latency, model/tool round trips, stale-ref recovery, payload, foreground audit and relevant-state-loss audit.
- [ ] T041 Verify target path is `observe -> action/revalidate+verify -> compact delta` with no model-mediated refind in the normal Skip case.
- [ ] T042 Run full required CI/security/browser gates.
- [ ] T043 Run `$speckit-converge`; remove/defer unrequested work.
- [ ] T044 Update `docs/project-context.md`, `docs/next-session-handoff.md` and acceptance record only after exact required evidence is green.
- [ ] T045 STOP. Do not start 8E automatically; return to an explicit Milestone 8E start decision.

## Dependencies & Execution Order

`R0 -> R1 -> R2 -> R3 -> R4 -> R5 -> R6 -> R7 -> R8 -> explicit 8E decision`

No later repair checkpoint is implicitly authorized by completion of an earlier one.
