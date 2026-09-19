# Research: Perception, Identity, Verification across hard websites

Date: 2026-09-20

Input: owner-run field tests of extension 1.6.0 across nine hard websites
(Figma, Google Maps, Miro, YouTube, Google Docs, X, Instagram, a 2048 browser
game, and Browserling remote browser), plus production latency measurements
from `opera_commands`/`opera_workflow_runs` (read-only, 30-day window).

## Research question (owner's framing)

> How can a browser agent keep understanding state and verifying action
> outcomes on pages that use canvas, virtualization, transient elements, async
> redraw, and remote-rendered interfaces, without relying only on plain DOM
> selectors?

## Taxonomy — nine sites, three question classes

The field report maps cleanly onto three questions:

1. **P — Can the agent see the real state?**
2. **I — Can the agent identify the correct target?**
3. **V — Can the agent verify the intended result happened?**

| Site | Observed symptom | Class |
| --- | --- | --- |
| Figma, Miro | screenshot succeeds but `read_page.text` empty; stale remnants (FAQ/cookie controls) still in semantic output | **P** (canvas invisible to DOM observer + stale semantic cache) |
| Instagram, 2048, Browserling | visual content / game board / remote-rendered app invisible to semantic observation while actions (keyboard) work | **P-visual** (vision is the only path) |
| Google Docs | document name visible in `read_page` but `find_elements` returns 0 | **I** (visible text ≠ actionable element) |
| YouTube | one watch page measured 199 entities / 88 ambiguity / 58 collision; `Skip` vs `Skip navigation`; transient ad controls; transcript mixed with page noise | **I + P** |
| X | virtualized feed → recurring/duplicate semantic state after scroll | **P** (pruning + dedup) |
| Google Maps | stale `Zoom in` ref reused after redraw → Street View opened elsewhere (unsafe); `click_element` ok:true without the panel opening; viewport-scoped results; `x = -344` with `inViewport = true` | **I + V** |
| Cross-site | `opera_await failed: canceling statement due to statement timeout` while the action had actually succeeded; `browser.burst` timeout discarding completed steps | **V** (timeout ≠ failure; must be reported as unknown) |

## Code-verified mechanisms (attachment points)

- `withDebugger` (extension/background.js:207-230) — existing bounded CDP
  session machinery; the natural host for an Accessibility-tree observation
  primitive.
- `capture_page` + adaptive screenshots + `capture_policy`
  (background.js:302-364, content.js:843-856) — existing vision pipeline with
  privacy gating.
- `semanticIdentity` revisions + region observation
  (extension/semantic-identity.js, content.js:505-531) — existing machinery for
  staleness detection.
- `postActionEvidence` (content.js:710-750) with before/postAction flow through
  `click_info` → `post_action` — existing attachment point for expected-state
  verification.
- `isInViewport` overlap test (content.js:215-233) — explains `x = -344` with
  `inViewport = true` (overlap, not containment).
- `pageFind` exact match compares the concatenated `label + text + placeholder`
  string (content.js:610-624) with no glyph/PUA or status-suffix normalization —
  explains exact-match brittleness.
- Refs stay valid across arbitrary mutations (only route change resets them);
  descriptors carry no geometry — explains the stale-ref-after-map-redraw
  hazard.
- MCP `instructions` is a static string (index.ts:258) — cheap guidance channel;
  **the public `read_page` tool already injects `view: "compact"` server-side**
  (index.ts:347) while the input schema stays frozen.

## Measured production context (30 days, read-only)

- Command queue p50 is healthy (~0.15–0.2 s across methods); the problem is the
  tail: p99 4–40 s, 3.1% of commands >5 s, bursty (one incident 09-09 with
  116/651 commands).
- Service-worker dormancy confirmed: 11.8% of claim-to-claim transitions >30 s,
  7.1% >60 s, max gap 1.7 days → the first command after wake pays full p99.
- Workflow transport tax: queue share 25–35% typical, 43% for
  `youtube.get_transcript`, up to 76% accumulated in a parallel run.

## Method matrix

| ID | Method | Answers | Field findings eliminated | Anchor |
| --- | --- | --- | --- | --- |
| P1 | Accessibility-tree observation via CDP (`Accessibility.getFullAXTree`) merged with the DOM serializer | P for canvas apps (Figma/Miro expose partial a11y), shadow DOM, Docs-list structures | canvas invisibility, Docs visible-text gap | withDebugger |
| P2 | Vision-first sampling: detect "semantically poor" surfaces (low-information text with a successful screenshot) and steer the model to `capture_page`; extend `capture_policy` to tag visual surfaces | P-visual (Instagram grid, 2048 board, Browserling inner app) | silent perception failure | capture_page/capture_policy |
| P3 | Stale semantic pruning: entities unobserved for N observations inside a mutated region are marked stale/hidden in the model-facing view (canonical state keeps them) | Miro remnants, X duplicates | stale residue | semanticIdentity revisions |
| I1 | Geometry- and mutation-aware ref validation: store mint-time rect; require re-find when the rect drifts beyond tolerance or a mutation burst fired since mint; never re-resolve across a mutation burst without descriptor+geometry match | unsafe stale-ref reuse (Street View mis-click) | dangerous mis-clicks | actionRefDescriptors/resolveActionRef |
| I2 | Ambiguity-ranked find: when several candidates match, return ranked candidates with disambiguation hints (viewport presence, actionability) instead of risking the first match; per-field exact matching with glyph/status-suffix normalization | Skip vs Skip navigation; exact-match failures; glyph labels | wrong-target clicks | pageFind/serialize |
| I3 | Visible-text → actionable fallback: when `find_elements` returns 0 but the text exists on the page, probe ancestor/parent clickables and report them as candidates | Google Docs gap | unreachable visible targets | pageFind |
| I4 | `fullyInViewport` + `viewportClipped` flags alongside the existing overlap-based `inViewport` | x=-344 inViewport=true | geometry confusion | isInViewport |
| V1 | Expected-state verification on actions: `expect` param (`urlChanged`, `urlContains`, `selectorAppears`, `selectorGone`, `textGone`, `minMutationDelta`) evaluated in-page inside `postActionEvidence` → `verified: true/false` with bounded `retry {reResolve, attempts}`; `href` fallback guidance for anchors; `wait_for` gains `absent: true` (wait for disappearance) | skip success known without re-read; click-without-transition | verification re-reads, false positives | postActionEvidence |
| V2 | Unknown-outcome contract: `statement timeout` / await cancellations are reported as `outcome: "unknown"` (not failed) by the runner and MCP layer | "opera_await failed" while the action had succeeded | double-action retries | runner/MCP error paths |
| V3 | Burst partial-result preservation: a burst timeout returns `{ok:false, timedOut:true, completedSteps, failedAt, results}` instead of discarding completed steps | Maps burst timeout with the action applied | lost evidence | runBurst |
| G1 | Guidance: MCP instructions gain — visual surfaces (canvas/games/remote) → use `capture_page`; Docs-like surfaces → if find returns 0 while text is visible, use capture or ancestor candidates; Maps results are viewport-scoped (re-search/pan after moving); verify transitions before repeating actions | viewport dependence, silent perception failure | agent confusion | index.ts:258 |

## Hard boundaries (stated honestly)

- Browserling-style remote-rendered UIs: the inner application is pixels, not
  DOM. Only P2 (vision) applies; structured semantic reading is out of reach by
  design.
- Full canvas understanding (Figma/Miro object graphs) is bounded by what the
  applications expose to the accessibility tree; P1 improves coverage but
  cannot invent semantics that are not exposed.
- Viewport-scoped results (Maps) are the site's own semantics; the fix is agent
  guidance and workflow patterns, not a code change.

## Disposition

- Implemented now (quick wins, test-first where feasible): V2 unknown-outcome
  labeling; I4 viewport flags + label normalization; G1 guidance additions
  (code only — production deploy of the Edge Function stays a separate explicit
  decision).
- Proposed as authorized checkpoints, ordered by value: **U-V1** (expect +
  burst partial), **U-P1** (AX-tree observation — flagship), **U-I** (identity
  hardening), **U-P3** (stale pruning), **U-P2** (vision sampling).
- Runtime hash locks rebaselined per protocol for the quick-win runtime edits.
