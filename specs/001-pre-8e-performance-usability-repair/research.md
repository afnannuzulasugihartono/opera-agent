# Research: Pre-8E Performance Usability Repair

**Date**: 2026-09-18  
**Status**: Empirical findings frozen for planning; no runtime implementation authorized.

## Live test

Prompt exercised through the production Opera Agent/Supabase path:

> find a good recommended YouTube video, click it, skip the ad, and summarize it; use this as a responsiveness/ease-of-use test.

Observed video: `Uncensored AI Costs $5 to Make. Nobody Can Stop It.` by Devsplainers.

## Frozen empirical timings

| Operation | Total | Queue |
| --- | ---: | ---: |
| browser.ping | ~562 ms | ~226 ms |
| tabs.list | ~407 ms | ~101 ms |
| navigate existing tab to YouTube Home | ~5,224 ms | ~131 ms |
| page.read YouTube Home | ~652 ms | ~168 ms |
| page.find recommendation | ~947 ms | ~311 ms |
| page.click recommendation | ~497 ms | ~96 ms |
| page.read watch page | ~992 ms | ~99 ms |
| page.find "Skip" | ~663 ms | ~212 ms |
| media.state | ~514 ms | ~20 ms |
| youtube.get_transcript v4 | ~20,514 ms | workflow start/queue ~4,123 ms |

These are one live run, not distributional performance claims.

## Finding F1 — target resolution is the primary usability friction

The watch page text already contained `Skip`. A subsequent `page.find("Skip")`
returned two candidates:

1. `Skip navigation`: CSS-visible but geometry at approximately y=-1000 and offscreen.
2. `Skip`: the real ad button, on-screen around x=833..918 and y=482..518.

The model therefore had to filter candidates after it already knew the desired
control existed.

## Finding F2 — viewport/actionability evidence needs correction

The real ad button had on-screen geometry, while returned viewport/actionability
metadata did not make it reliably dominant. The repair must test geometry-based
viewport truth explicitly instead of treating CSS visibility as sufficient.

## Finding F3 — dynamic refs can expire inside one cloud-mediated action chain

The correct Skip ref became stale before `page.click` executed:

`Element not found or reference is stale.`

A coordinate fallback issued afterward hit the video because the ad had already
ended and the page state had changed. This proves that dynamic-target freshness
must be checked close to action time and that stale coordinates must not be guessed.

## Finding F4 — observation is fast but model-facing output is noisy

Home `page.read` completed in ~652 ms and contained only ~686 page-text characters,
but its model-facing result included about 119 semantic entities plus state/views
and was large enough for tool output truncation.

The watch page read completed in ~992 ms with ~3,331 page-text characters and about
139 entities, again producing a very large/truncated result. Hidden dialogs,
offscreen controls, player controls, recommendations and unrelated regions dominate
token cost even when the immediate task is only to act on a small control.

## Finding F5 — existing media primitives are fast but not public MCP tools

The extension already supports:
- `media.state`
- `media.play`
- `media.pause`
- `media.seek`

`media.state` completed in ~514 ms and identified the main video duration/current
time without navigation. The 18 public MCP tools do not expose these directly.
This repair may use them internally through approved workflows, but public MCP
surface expansion is deferred.

## Finding F6 — navigation/page loading dominates simple transport in the tested path

YouTube Home navigation took ~5.2 seconds while queue time was ~131 ms. Therefore
Realtime wake alone cannot explain or remove most navigation latency. First
optimize unnecessary navigation, local targeting, local verification and media
seek. Realtime transport changes should be evidence-triggered later.

## Finding F7 — transcript workflow is robust but expensive

`youtube.get_transcript v4` succeeded but took ~20.5 seconds and returned a broad
page-text stream containing description, comments, recommendations, sponsored
content and transcript. The workflow performs multiple find/query/click/wait/read
steps and may activate the tab for rendering.

The repair should prefer transcript-specific evidence and eliminate redundant
wait/read/activation work where safe.

## Decisions

1. Fix actionability/viewport prioritization before transport work.
2. Add safe same-document fresh-target revalidation; never guess on ambiguity.
3. Couple simple actions with bounded post-action change evidence.
4. Keep canonical semantic state/delta; compact only the model-facing view.
5. Use existing media primitives internally; do not expand public MCP in this track.
6. Optimize reuse/SPA/media behavior before any Realtime wake migration.
7. Treat YouTube as an acceptance scenario, never extension-specific architecture.
8. Keep 8E paused and keep `milestone7_vm_enabled=false`.

## Deferred

- Public media-control MCP tool(s).
- General iframe/OOPIF/shadow-root expansion.
- General canvas/vision routing work planned for broader multi-sensor work.
- Realtime transport migration unless later evidence and explicit authorization justify it.
- Any transaction/approval work from Milestone 8E.
