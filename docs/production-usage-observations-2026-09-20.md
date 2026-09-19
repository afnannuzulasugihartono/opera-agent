# Production usage observations — 2026-09-20

Source: end-to-end tests run by the owner through the production path
(ChatGPT + Opera Agent extension 1.6.0 + Supabase), reported directly on
2026-09-20. These are field observations, recorded verbatim-in-substance as
repair-track evidence. They are the first real-usage distribution data since
the R0 frozen findings.

## Test 1 — YouTube (3Blue1Brown, "But what is a neural network?", ~18:40)

Playback control worked end to end: the player was driven to 18:39/18:39 via
`media.seek` over the internal Supabase path; opening pages, retaining
`tabId`, reading chapters, and basic navigation were stable. Two other
recommendation videos were abandoned over caption-access problems.

Findings (owner's table, condensed):

1. **Ad skip not reliable** — 17 s, 1:47, and 21 s ads appeared; `Skip` text was
   seen but element search often matched `Skip navigation` or the button
   disappeared before the click. Ads played out; no deterministic skip is
   claimed. Race condition: YouTube state changes faster than the
   read → find → click cycle, so fresh refs go stale within hundreds of ms.
2. **Media API exists but is not exposed over MCP** — extension 1.6.0 supports
   `media.state/play/pause/seek`; the public MCP does not expose them, forcing
   the internal Supabase path (frozen finding F5; deferred by design in this
   track).
3. **Queue tail latency** — one `media.state` took ~14.3 s with ~14.0 s of pure
   queue wait; a `media.seek` attempt timed out; the next attempt was <1 s.
   Time-sensitive actions (Skip Ad) are impractical under this condition.
4. **Caption detector unreliable** — the 3Blue1Brown video (which has
   subtitles) was reported as "Subtitles/closed captions unavailable".
5. **`youtube.get_transcript` v4 failed twice — `wait_for` timeouts at ~16.5 s
   and ~14.0 s** — and afterwards `Show transcript` was found manually once the
   description was expanded. The transcript exists; the workflow's
   expand/find/wait sequence does not match the current YouTube UI state.
6. **`page.read` too noisy** — one read returned description, chapters,
   comments, recommendations, sponsored shelf, merch store, etc.
7. **Semantic state vs real UI mismatch** — `Show transcript` visible in
   `page.read`, then `find_elements("Show transcript")` returned 0.
8. **No audio** — the agent controls the `<video>` element but has no audio
   stream; "watching" remains DOM/caption/chapter/state-based.

## Test 2 — Google Maps (food search near UII, reviews, directions)

Worked well overall: search results with ratings/review counts/price ranges
were read (six venues listed); venue detail (rating 4.5/1,915 reviews, address,
hours, price range, site, phone, menu, dine-in/takeaway/delivery, popular
times, review summary, individual reviews) was read; review sorting to
"Newest" + container-scoped lazy-load worked and returned genuinely new
reviews; directions were read after replacing "Your location" with a public
origin (UII): ~850 m / 11 min for the selected mode, ~3 min for the two
motorcycle modes.

Findings (owner's findings, condensed):

1. **`browser.burst` timeout ≠ action failed (critical)** — a
   fill → Enter → wait → read burst timed out at the transport, yet the query
   was filled and the results page had opened. An agent will retry actions
   that already succeeded.
2. **`click_element` false positive** — clicking the Yamie Panda result
   returned `ok: true` but the detail page did not open; navigation required
   the semantic `href` instead. Click success is not state-transition success.
   Owner's suggested shape: `act → verify expected state → retry/re-resolve if
   unchanged`, plus automatic `href` fallback for results that expose one.
3. **Geometry inconsistency** — result cards reported `x = -344` with
   `inViewport = true` (Maps panel transform/virtualized layout).
4. **Exact text matching brittle** — `Yamie Panda Chapter UII` with
   `exact:true` matched nothing while fuzzy `Yamie Panda` matched; `Sort`
   labels contain glyphs (` Sort`).
5. **`wheel_at` praised** — correct scroll container plus telemetry
   (`moved`, `contentChanged`, `reachedBoundary`, `scrollTop`,
   `maxScrollTop`) made review lazy-loading work; validated R-track work.
6. **Stale semantic residue** — after entering Directions, the previous
   panel's sorted-reviews text still appeared in observations.
7. **Transport modes lack semantic names** — buttons read as ` 3 min`,
   ` 3 min`, ` 11 min`; icons are not conveyed to the LLM.

## Mapping to the repair track and backlog

| Observation | Track mapping |
| --- | --- |
| Transcript v4 failures 14.0 s / 16.5 s | Exactly the two failed v4 runs in the R7 baseline (14.049 s / 16.474 s). Confirms the R7 recorded residual bottleneck. Top post-R7 fix candidate: the description-expand → Show-transcript path (v5 fixes output scope, not this path). |
| Caption detector unreliable | New backlog item (detector contract needs a transcript-presence check independent of the panel). |
| Queue 14.3 s spike | Tail latency beyond the R6/T032 median analysis; record distribution in R8 (T040). |
| Media primitives not on MCP | Frozen finding F5; deferred by design — 8E decision list. |
| `page.read` noise | Addressed structurally by R4 compact view; adoption is workflow-side (R7 used it for transcripts; read_page callers next). |
| Semantic/UI mismatch, stale residue | Backlog: observation freshness and panel-scoped semantics (post-R8 repair round). |
| burst timeout ≠ failed (critical) | New top-priority correctness item: transport timeouts must not imply action failure; idempotency/verification contract needed. |
| click ok ≠ state transition | Extends R3's postAction direction: verify expected state transition, retry/re-resolve, `href` fallback. New top-priority backlog item with the line above. |
| `x = -344` with `inViewport = true` | Backlog: geometry truth for transformed/virtualized panels. |
| Exact-match brittleness / glyph labels | Backlog: matching semantics (trim glyphs, document exact behavior). |
| Transport glyph naming | Backlog: accessible names for icon-only controls (may need aria conventions or vision fallback). |
| `wheel_at` telemetry | Validated; keep as the model for other lazy-load primitives. |

## Disposition

- These observations stand as **R8 supporting evidence** (they already exercise
  the original YouTube prompt path) and as the seed backlog for the post-R8
  repair round and the Milestone 8E decision list.
- R7's recorded residual bottleneck is confirmed by field data; the
  description-expand fix candidate is queued as the first post-R8 item.
