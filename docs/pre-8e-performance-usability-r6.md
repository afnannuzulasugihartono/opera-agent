# Pre-8E repair R6 — navigation and residual transport

Date: 2026-09-19

Status: **IN PROGRESS — T030–T031 complete; T032–T033 pending.**

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

## Continuation boundary

Exact next: **T032 only** — quantify residual workflow/command queue and transport share after the accepted navigation optimization. Do not infer a Realtime transport need before that measurement. T033's conditional STOP remains binding: Realtime
transport cutover is not authorized here.
