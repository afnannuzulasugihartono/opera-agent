# Pre-8E repair R6 — navigation and residual transport

Date: 2026-09-19

Status: **R6 ACCEPTED / CLOSED (CI-evidence acceptance) — closed without transport migration.**

Entry gate: R5 is ACCEPTED/CLOSED. Canonical R5 synchronization head
`d0782dd39806bd2a659c632d805d2592d07c4836` has CircleCI #252 + Vercel
SUCCESS. The required read-only Spec Kit consistency/constitution analysis was
re-run before R6 work and found no conflict among `AGENTS.md`, `SECURITY.md`,
the canonical repair plan, and the active feature spec/plan/tasks.

## T030 — navigation latency measurement

Source: read-only query of `public.opera_commands` in the active Opera Agent
Supabase project. Window: 2026-09-11 00:00:00Z through 2026-09-19 00:00:00Z.
Only completed `tabs.navigate` commands were measured. Queue time is
`claimed_at - created_at`; total time is `completed_at - created_at`;
execution time is total minus queue.

This is historical production-path evidence. The live paired extension is still
1.6.0 and the R1–R5 candidate has not been promoted, so these measurements MUST
NOT be presented as integrated post-R5 production speed. They quantify the
navigation cost that R6 is allowed to remove or preserve after R1–R5 acceptance.

### Avoidable legacy navigation

Legacy YouTube timestamp seeking is classified as a completed
`tabs.navigate` to a watch URL containing `t=<seconds>s`. R5 now has an
approved internal `media.seek` path for ready media, so timestamp-only page
navigation is avoidable where media continuity is available.

- non-reused timestamp seeks: **78** across **4** distinct video IDs;
- p50 total: **3045.3 ms**;
- p50 queue: **154.2 ms**;
- p50 execution/load: **2882.0 ms**;
- average total: **3326.5 ms**;
- range: **1791.3–6883.1 ms**;
- median per-command queue share: **4.81%**;
- one exact-URL reused timestamp command completed in **394.2 ms**
  (15.2 ms queue, 379.0 ms execution).

### Actual page navigation that remains necessary

- YouTube Home navigation: **n=2**, p50 total **3896.5 ms**, p50 queue
  **82.8 ms**, p50 execution **3813.7 ms**.
- YouTube watch-page navigation without timestamp seek: **n=1**, total
  **2353.5 ms**, queue **51.6 ms**, execution **2301.8 ms**.
- Other completed non-reused navigation in the same window: **n=30**, p50 total
  **1593.3 ms**, p50 queue **130.9 ms**, p50 execution **1561.4 ms**.

## T030 conclusion

The dominant cost of real navigation is browser/page execution and loading, not
command queueing. For legacy YouTube timestamp seeking, the p50 queue share is
only 4.81%, while the non-reused navigation p50 is 3.045 s. This supports the
frozen R6 ordering: remove behavior-equivalent navigation/reload first, then
measure residual transport.

T030 does not claim a numeric live `media.seek` production p50 because there are
no completed production `media.seek` commands in the measured window and R5 was
not production-promoted. Controlled R5 acceptance separately proves the <=1000 ms
ready-media gate without navigation/reload.

## T031 tests-first and implementation candidate

Tests-first head `0f3f883254e2b30f4406842f01b8013832a04d5a` produced the
expected CircleCI #254 red gate. The only new failing test is
`R6 YouTube recommendation prefers local SPA click with bounded navigation fallback`;
the current latest `youtube.play_recommendation` workflow still opens the freshly
queried recommendation with direct `tabs.navigate`.

Repository source fully explains the defect, so no upstream/platform research is
needed. The minimal versioned repair leaves historical migrations untouched and:
1. uses the fresh `steps.rec.result.item.ref` with trusted local `page.click`;
2. waits at most 2500 ms for `ytd-watch-flexy` to establish the SPA transition;
3. falls back to `tabs.navigate` to the already-observed href only when that local
   transition does not materialize or a fresh ref is unavailable;
4. preserves the existing final watch/video waits and ad/media handling.

No public surface, protocol, browser primitive, production schema, VM, auth/signing,
or transport change is included. Implementation head `1b20d3346129ddc32438ef3d1d20ac1d2c5c2067` exposed only an over-escaped test matcher in CircleCI #255. Test-only repair head `3d21ecc58cfece6e55f40433525a7a6c1db27800` then passed CircleCI #258 + Vercel SUCCESS. T031 is complete.

## T032 — residual queue/transport share

Derived from the T030 production measurements (same window, same source; no new
production queries were required):

| Path | p50 total | p50 queue | residual queue share |
| --- | ---: | ---: | ---: |
| Legacy YouTube timestamp seeks (n=78) | 3045.3 ms | 154.2 ms | **5.1%** |
| YouTube Home navigation (n=2) | 3896.5 ms | 82.8 ms | **2.1%** |
| Watch-page navigation without seek (n=1) | 2353.5 ms | 51.6 ms | **2.2%** |
| Other non-reused navigation (n=30) | 1593.3 ms | 130.9 ms | **8.2%** |

Small primitive commands (frozen R0 findings) keep absolute queue times near
100–250 ms. The bridge's fast-start polling window (6×50 ms, then conservative
idle polling) already covers active command chains.

Conclusion: after R1–R5 and the T031 navigation optimization, the residual
queue/transport share on the paths that matter is single-digit percent, and the
absolute residual is bounded by roughly 50–250 ms. Page execution and loading —
not command transport — dominate every measured path.

## T033 — Realtime wake decision

Realtime transport migration is **not justified by the evidence** and R6 is
closed without transport migration, exactly as the task's conditional branch
requires:

1. T030/T032 prove the residual transport share is 2–8% on navigation paths and
   ≤ ~250 ms absolute on primitives; even a perfect zero-queue transport cannot
   materially move navigation-dominated total latency.
2. The existing fast-start polling window already returns ~50 ms first-poll
   latency for active chains, so the marginal win of a push channel is smaller
   than the measured queue residual itself.
3. A transport cutover would touch production VM, schema, and reconnection
   semantics for a benefit the data does not support — precisely the scope the
   frozen repair plan defers behind separate reviewed authorization.

## R6 closeout

- T030–T033 complete; R6 closed **without** transport migration.
- No public surface, protocol, primitive count, production schema, VM, or
  auth/signing change was made in R6; the T031 repair is a versioned workflow
  change plus tests only.
- Next checkpoint: **R7 (T034–T038) YouTube workflow cleanup — AUTHORIZED /
  NOT STARTED**, under the 2026-09-19 standing CI-evidence authorization.
  Milestone 8E remains paused; the R8 real-Opera acceptance (T039–T041)
  requires an Opera environment with the candidate extension installed.
