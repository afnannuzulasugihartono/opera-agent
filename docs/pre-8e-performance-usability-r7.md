# Pre-8E repair R7 — YouTube transcript workflow cleanup

Date: 2026-09-20

Status: **R7 IMPLEMENTED / GATES GREEN — ACCEPTED ON CI EVIDENCE (standing authorization). R8 NOT STARTED (requires a real-Opera environment).**

Branch: `feat/pre-8e-usability-repair-r3`

## Production baseline (read-only, 2026-09-20)

`public.opera_workflow_runs` for `youtube.get_transcript`:

| version | status | n | p50 exec | p50 total | max total |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | completed | 1 | 9.666 s | 9.950 s | 9.950 s |
| 2 | completed | 1 | 9.640 s | 9.932 s | 9.932 s |
| 3 | completed | 2 | 4.061 s | 4.622 s | 13.368 s |
| 4 | completed | 1 | 16.391 s | **20.514 s** | 20.514 s |
| 4 | failed | 2 | 13.695 s | 14.049 s | 16.474 s |

The frozen R0 baseline (20.514 s) is exactly the single completed v4 run. The
v3↔v4 definition diff is a single parameter (`includeElements: false`), yet
their observed totals differ by 4.4x across tiny samples — runtime variance is
scenario-driven (video/transcript length, panel-open path), and every version
sample here is non-distributional.

## T034 — output-shape and structure tests

`tests/pre-8e-usability-r7.test.mjs` parses the registered v5 definition from
the migration and locks: the output key set
(`tab, segments, segmentCount, openMethod, panelWasOpen, activatedForRender`),
the segment query contract (`ytd-transcript-segment-renderer`, `limit: 100`,
`visibleOnly: false`, `continueOnError`), single-guarded placement of the
chunked reader (fallback `else` only), ownership of `prevActive` by the
activation branch, restore via `vars.prevActiveId`, and the deterministic
structural cost assertions below.

## T035 — redundant round-trip reduction

- The unconditional `previousActive` `tabs.get` moved into the activation
  fallback branch (it is only needed to restore the previously active tab when
  the bounded background-render activation fires): one command saved on every
  run.
- The chunked full-page read loop no longer executes on the primary path: it
  is preserved verbatim as the bounded fallback when the segment query returns
  nothing (DOM variants), so v4 behavior is retained safely.

## T036 — clean primary output

Primary output now carries transcript segments only
(`ytd-transcript-segment-renderer` items, `visibleOnly: false`, bounded to
100). Full-page text (which includes description, comments, recommendations,
and sponsored content) is never read on the primary path; `text`, `hasMore`,
and `nextOffset` exist only inside the fallback branch.

## T037 — honest closure: structural reduction + recorded residual bottleneck

Deterministic structural assertions (test-enforced):

- primary cold path executes exactly **12 commands**; the v4-equivalent grows
  with chunk rounds (13 + R), so at R >= 12 rounds v4 costs >= 2x v5;
- worst case (30-round cap): v4 = 42 commands vs v5 = 12 (−71%);
- payload: 10-round scenario reads 120,000 chars of full-page text vs at most
  30,000 chars of segment text (>= 70% reduction, zero comment/recommendation
  bytes).

The >= 50% total-latency claim against the frozen 20.514 s figure is **not**
made: that figure is a single completed run, and the evidence above shows
scenario variance dominates it. Recorded residual bottleneck: the panel-open
and render path (`waittranscript` 5 s budget, `segmentFast` 1.2 s + activation
+ `segmentReady` 6 s budget) — improving it requires production distribution
data (R8 real-Opera runs) or a panel-open redesign beyond the bounded R7
scope. This closes T037 via its evidence-backed residual-bottleneck clause.

## Gates

- Local full Node suite: **437/437 PASS** (was 434; +3 new R7 assertions net of
  renames), `npm run check` PASS (26 primitives, 68 runtime safety files — the
  new migration is picked up by the dynamic safety scan and is clean).
- CI: CircleCI + Vercel SUCCESS on the R7 evidence head (see handoff for the
  exact SHA). The browser gate runs in CI as established in R0–R6.

## Boundary

No public MCP tool/schema, protocol, primitive count, extension runtime,
production schema table, VM, signing, auth, or transport change. The change is
one versioned workflow registration plus its tests. **T038 STOP: R7 closed on
CI evidence; R8 (real-Opera acceptance, T039–T041) requires an Opera
environment this workstation lacks.**
