# Changelog

All notable changes to Opera Agent are documented here. The project follows Semantic Versioning.

## [Unreleased]

### Milestone 7 planning
- Froze Checkpoints 7A–7F for a bounded Reactive Browser VM with a strict JSON AST, deterministic sliced execution, tenant-bound durability, idempotency, typed suspension, proof separation, zero-focus acceptance, and no initial extension or public MCP change.

### Milestone 6 foundation
- Planned Checkpoints 6A–6F for the Goal and Constraint Ledger and scoped Proof Engine.
- Completed the contract-only 6A gate with versioned bounded schemas, canonical digest rules, a 15-scenario hostile replay corpus, quantitative thresholds, and five new tests without changing the extension, MCP surface, or production schema.
- Completed the pure 6B ledger core with immutable canonical ledgers, monotonic digest lineage, stale/fork/authority-broadening rejection, explicit terminal transitions, metadata-only inspection, a 10,000-step property sequence, and a reproducible benchmark without browser or production integration.
- Completed the pure 6C scoped Proof Engine with typed evidence trust and admissibility, freshness/scope/lineage/dependency enforcement, contradiction blocking, bounded canonical receipts, a zero-false-`PROVED` adversarial corpus, and a 500-evidence p95 below the frozen target without browser or production integration.
- Completed 6D live-revision reuse with metadata-only semantic dependency fingerprints, conservative narrowing/expansion rules, selective invalidation, bounded carry-forward receipts, and restart-safe minimal-head verification in temporary local SQLite databases without changing production.
- Completed 6E with an internal OAuth-authenticated ledger endpoint, AES-256-GCM opaque ledger tokens, a Vault-managed key, and service-role-only eight-column head persistence while retaining the existing 18 MCP tools.
- Completed 6F across 112 tests, controlled Chromium, isolated Opera, production queue/idempotency/timeout/tenant/cleanup probes, authenticated normal-profile Maps/YouTube/GitHub observation, zero focus takeover, and zero false `PROVED`; enabled the server feature without changing extension 1.6.0.
- Fixed a production transaction timestamp-order race in first head persistence through an additive migration using wall-clock-safe `updated_at` ordering.

## [1.6.0] - 2026-09-11

### Added
- Added document-scoped semantic identities, bounded semantic deltas, generic materialized region views, causal invalidation metadata, observation provenance, and scoped completion evidence to existing rich `page.read` results.

### Compatibility
- Prepared the 1.6.0 candidate without changing protocol 1, the 26 browser capabilities, the 18 MCP tools, their input schemas, or action targeting.
- Kept all semantic additions optional and observational; existing refs remain the only element action handles.

### Verified in production
- Updated the normal Opera profile in place under the unchanged extension ID and preserved pairing, protocol 1, and all 26 capabilities.
- Verified the private update XML and served 35,855-byte CRX against SHA-256 `cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`.
- Passed background rich-read acceptance on Google Maps, YouTube, and GitHub with no active-tab change and zero logical-identity mismatch for shared refs.

## [1.5.2] - 2026-09-11

### Fixed
- Prevented Opera's action popup from collapsing to a scrollbar-width sliver by replacing circular viewport-based intrinsic sizing with an explicit 352-pixel preferred width and a 148-pixel safety floor.
- Retained the compact narrow-panel layout when Opera constrains the popup below 240 pixels.

### Verified in production
- Updated the normal Opera profile in place from 1.5.1 to 1.5.2 under the unchanged extension ID and preserved pairing.
- Confirmed the installed popup renders at its full intended width with no horizontal clipping.
- Verified a fresh online heartbeat, protocol 1, all 26 capabilities, and a successful post-update `browser.ping` without changing any tab.

## [1.5.1] - 2026-09-11

### Changed
- Redesigned the extension popup with a professional status hierarchy, clearer connection/privacy states, compact timestamps, and consistent controls.
- Made the popup responsive down to Opera's narrow 148-pixel panel without horizontal clipping while retaining the normal 352-pixel toolbar layout and dark-mode support.
- Verified the paired popup at 352-pixel and 148-pixel viewports with no horizontal overflow.

### Verified in production
- Updated the normal Opera profile in place under extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`; pairing, protocol 1, and all 26 capabilities were preserved.
- Verified the private update XML, health response, database payload, served CRX length, and SHA-256 all resolve consistently to 1.5.1.
- Completed a post-update `browser.ping` without opening, activating, or modifying a browser tab.

## [1.5.0] - 2026-09-11

### Added
- Added stable element keys, separate `visible`/`inViewport` state, document mutation counters, and viewport/zoom metadata to existing page-reading results.
- Added generic before/after scroll-container metrics, movement detection, DOM-change detection, bounded settling, and directional boundary detection to existing scroll and wheel results.
- Added a deterministic DOM scroll fallback when a background CDP wheel event cannot move an available container, while preserving debugger input as the primary path and reporting the path used.
- Added a lazy-loaded nested-scroll regression fixture that proves two-pass collection, stable-key deduplication, true viewport state, and active-tab/window preservation in controlled Chromium and isolated real Opera.
- Published a verified same-identity signed candidate through the private update channel while retaining 1.4.0 as the immediate rollback.

### Compatibility
- Protocol remains 1 with the same 26 allowlisted capabilities and the same 18 MCP tool names; no new tool discovery is required.
- Google Maps-specific collection remains outside the extension. The new signals are generic inputs for bounded site workflows and model-side `observe → decide → act → verify` loops.

### Verified in production
- Updated the normal Opera profile in place with the established extension identity and preserved pairing, OAuth, protocol 1, 26 capabilities, and the existing ChatGPT connection.
- Completed bounded background acceptance on Google Maps, YouTube, and GitHub with zero foreground takeovers, stable element identities, measured scrolling, lazy-load/boundary evidence, and duplicate screenshot suppression.
- Passed all 40 Node tests, static validation, controlled Chromium, isolated real Opera, Supabase `system.self_test`, a fresh normal-profile ping, MCP health/auth checks, and identity-aware update download verification.
- Verified that the signed 25,462-byte served CRX and local release artifact share SHA-256 `7f23c265b78ea3b9e09ce5e07cb9e77ab0d33c85f9e5dfe7288178a5d7f21c44`.

## [1.4.0] - 2026-09-10

### Added
- Added `page.capture` and MCP `capture_page` for bounded background JPEG viewport/crop capture through CDP without activating the target tab.
- Added SHA-256 change detection, a 750 ms per-tab cache window, adaptive quality/scale reduction, a 220 KiB encoded-image ceiling, blank-frame rejection, and atomic read-and-scrub delivery through Supabase.
- Added local capture blocking for internal pages, incognito tabs, visible credential/OTP/payment fields in the main document or embedded frames, and tabs the user marks private in the extension popup.
- Added native MCP image content while excluding duplicate base64 from structured metadata, plus deterministic background-focus, crop, cache, canvas, blank-frame, embedded-frame, and privacy tests.

### Verified in production
- ChatGPT discovered and invoked `capture_page` after reconnecting its cached plugin session, received a real background Google Maps JPEG, and correctly distinguished canvas-only labels from DOM output.
- Reusing the first SHA-256 through `previousHash` returned `unchanged:true` without retransmitting duplicate image content.
- Google Maps remained inactive while ChatGPT remained active before and after both captures.
- Supabase retained only scrubbed hash/size metadata after one-time image delivery.

## [1.3.1] - 2026-09-10

### Fixed
- Temporarily emulate page focus only around background CDP input dispatch, then always restore the normal focus state without activating the browser tab or window.
- Address the production Google Maps case where CDP accepted mouse/key events on an inactive tab but the page ignored them while reporting itself unfocused.
- Verified the signed same-identity update in installed Opera: pairing remained intact, a seven-step background Google Maps burst and coordinate result click succeeded while the target stayed inactive, and MCP version 10 passed its public authentication checks.

### Changed — 1.3.0 release candidate
- Added invisible coordinate mouse input for explicitly targeted background tabs through Chrome DevTools Protocol, while keeping the visible pointer limited to an active foreground tab.
- Routed trusted text entry through `Input.insertText`, including normal inputs and contenteditable elements, with a final sensitive-target and active-element safety check immediately before dispatch.
- Added structured `FOREGROUND_REQUIRED` failures when a visible foreground pointer is requested for an inactive tab instead of silently activating or switching tabs.
- Expanded the two-tab focus audit to cover background fill, key, coordinate click, canvas interaction, burst execution, sensitive-field blocking, and foreground-pointer rejection without changing the user's active tab.
- Verified the deterministic suite in real Opera and the adaptive background-input path against live Google Maps in isolated Chromium. Prepared the same-identity signed `1.3.0` rollout while retaining `1.2.0` as the active rollback until production acceptance.

### Added — 1.2.0
- Added `browser.burst`, a strict 1-8 step same-tab sequence over eight existing page-action types.
- Added stop-on-first-failure results, per-step timings, a 12-second total timeout, a 256 KiB result cap, and lazy debugger-session reuse inside each burst.
- Added the focused MCP tool `run_browser_burst` with a discriminated action schema; no raw command, JavaScript, loop, branch, nesting, or tab-navigation escape hatch is exposed.
- Added a production method-registry migration while keeping the historical `browser.plan` experiment quarantined.
- Verified the source build in real Opera, including a five-action burst and 20/20 two-step stability runs.

### Added — MCP
- Added an authenticated stateless Streamable HTTP MCP server with 16 focused browser tools and model-facing instructions that make Opera Agent discoverable without mentioning Supabase.
- Added static Bearer authentication for controlled testing plus allowlisted Supabase Auth JWT support for OAuth clients.
- Added MCP schema, authentication, canonical discovery URL, Deno type-check, Inspector strict, and real-Opera acceptance coverage.

### Added — 1.1.1
- Added the generic `page.pointer` primitive for viewport-bounded move, click, drag, and wheel input on dynamic and canvas-based interfaces.
- Added an optional temporary pointer indicator, active/focused-tab enforcement, coordinate validation, and sensitive-target blocking.
- Registered the 24th protocol-1 primitive in the production backend and published a same-identity signed CRX update.

### Added — 1.1.0 source candidate
- Added `page.read.includeElements=false` for bounded text-only reads without interactive-element serialization; existing callers retain element-rich reads by default.
- Replaced the semantic `page.read` content-bridge probe with an internal zero-payload `content.ping` message that is not exposed as a public primitive.
- Added generic no-op fast paths for activating an already-active tab and navigating to an already-current URL.
- Added bounded metadata-only workflow telemetry for queue time, execution time, command count and timings, response bytes, retries, and intentional fixed waits.
- Added versioned workflow revisions that opt full-text and transcript workflows into text-only reads while preserving rollback history.
- Advanced the source release version to `1.1.0` while keeping protocol 1 and all 23 public primitives. Because the legacy private signing key is unavailable, the explicitly authorized candidate uses a separate signing identity and requires fresh pairing.

### Fixed
- Made the static validation script resolve repository paths correctly on Windows.
- Made browser regression tests use an available dynamic port and support explicit real-Opera execution without touching the user's browser profile.

### Changed — server-side efficiency
- Added a short fast-start polling window to `opera-agent-bridge`: six 50 ms polls at the start of a pull, then the existing 250 ms conservative idle interval.
- Updated `opera-agent-runner` to await command completion through one separate `opera_await` RPC instead of repeatedly fetching `opera_commands` over Edge-to-database HTTP.
- Kept retries bounded to read-only/idempotent primitives and recognized transient browser-message failures.
- Added bounded parallel `foreach` execution with a maximum concurrency of four for explicitly parallel-safe workflows.
- Added `research.read_current_full` and `research.read_url_full` for bounded adaptive 12,000-character continuation reads.
- Updated `research.read_url` to use a 12,000-character / one-element efficient default while retaining caller overrides.
- Updated `research.crawl_urls` to reuse one background tab instead of repeatedly opening and closing temporary tabs.
- Added `research.crawl_urls_parallel` as an explicit bounded parallel alternative for independent URLs.
- Updated `youtube.search` to use the existing YouTube search box without forcing a redundant Home navigation.
- Updated `youtube.captions_on` to verify state with `page.wait_for` instead of a fixed 200 ms post-click delay.
- Updated `youtube.play_recommendation` so ad polling starts only when an ad is detected and uses a shorter bounded wait while the ad remains present.
- Added and iterated `youtube.get_transcript` so transcript opening and long-text collection are orchestrated inside one server workflow. Real Opera testing added an already-open fast path, normal-click preference, trusted fallback, actual transcript-row readiness checks, temporary activation for background-render throttling, and restoration of the previously active tab.

### Verified on real Opera — server-side efficiency
- Runner v4 and the existing Opera Agent 1.0.1 browser build completed live workflow smoke tests with protocol 1 and all 23 capabilities unchanged.
- `youtube.get_transcript` v3 collected roughly 20.5k characters from a 20-minute NASA video in two adaptive page-read chunks when already rendered.
- A cold inactive-tab transcript run detected YouTube's delayed transcript-row rendering, temporarily activated the tab, collected roughly 20.4k characters, and restored the previously active tab.
- Benchmark results, including noisy runs that did not show an end-to-end speedup, are retained in `docs/efficiency.md` rather than being omitted.

### Documentation / history
- Added an explicit efficiency architecture and benchmark plan.
- Formalized release notes and legacy Final 1/Final 2 documents as historical records rather than mutable descriptions of current behavior.
- Kept the installed extension version at `1.0.1`; no unsigned or differently signed browser build is treated as a new stable release.

## [1.0.1] - 2026-09-08

### Fixed
- Persist command-completion payloads locally until the Supabase bridge acknowledges them, with bounded retry/backoff across transient network failures.
- Replace the transactionally unsafe synchronous `opera_run()` pattern with a two-phase command API: enqueue first, then await in a separate transaction.
- Route server-side workflows through the asynchronous `opera-agent-runner`, so workflow commands are committed before the local browser can claim them.
- Preserve compatibility names (`opera_run`, `opera_run_workflow`) while returning deferred command/run IDs for the separate await step.

### Verified on real Opera
- Production `browser.ping` and the 23-capability handshake.
- Live tab listing/open/activate/close operations.
- 6,000-character semantic chunks with continuation to offset 12,000 on a 247,964-character page.
- Structured ARIA state including YouTube closed captions reporting `ariaPressed="true"`.
- Real YouTube media-state extraction.
- Browser restart reconnect with pairing preserved.
- Signed self-hosted CRX update `1.0.0 → 1.0.1` with the stable extension ID and pairing preserved.

### Distribution note
- Manual update checking from Opera's Extensions page is verified.
- Passive background auto-update without pressing Opera's Update button remains unverified and is deferred to a later patch test.

## [1.0.0] - 2026-09-08

### Added
- Clean rebuild under the name **Opera Agent**.
- Thin MV3 browser bridge architecture.
- 23 generic browser primitives.
- Stable protocol version `1`.
- Stable CRX signing identity / extension ID `pagjlnohdemoohcncicjmaejedcmcocm`.
- Supabase device registry, pairing codes, command queue, audit log, workflow registry, and workflow history.
- Direct database `opera_run()` / `opera_await()` command path that avoids the legacy outbound HTTP helper timeout design.
- Versioned declarative workflow DSL with rollback.
- Supabase Edge Function `opera-agent-bridge` for pairing, heartbeat, command delivery, and completion.
- Bounded semantic page reading up to 12,000 characters per chunk.
- Rich ARIA/interactive state serialization.
- Trusted debugger/CDP clicking and keys.
- Network reconnect and browser restart recovery.
- Browser and cloud regression suites.
- Supabase Edge Function `opera-agent-update` and private signed release registry.
- Verified managed Chromium self-hosted CRX update path (`0.9.0 → 0.9.1`).
- Seed workflows: `system.self_test`, `browser.status`, `research.read_url`, `research.crawl_urls`, `youtube.search`, `youtube.play_recommendation`, and `youtube.captions_on`.

### Fixed by design
- Removed the legacy ~2,400-character semantic hard cap from explicit reads.
- Removed dependence on the legacy ~5-second synchronous outbound HTTP gateway helper.
- Added `aria-pressed`/related state needed to verify controls such as closed captions.
- Removed site-specific YouTube logic from the extension itself.
- Fixed a reconnect race found during 1.0.0 Chromium testing where a storage-triggered loop restart could stop command consumption after the first command.

### Security
- No `eval` or remote executable JavaScript.
- Server workflow commands are validated against the method allowlist.
- Sensitive credential/payment verification fields are blocked from automated filling/typing.
- File upload interaction is blocked.
- Device tokens are stored in the database only as SHA-256 hashes.

### Distribution note
- The initial installation/pair is a one-time browser trust step.
- Signed CRX3 update delivery and self-hosted updates are verified in managed Chromium; actual Opera/Windows off-store policy behavior remains an environment-specific acceptance check.

---

## Legacy history

The previous Local Opera Agent v3 builds are preserved as historical references only:

- [Legacy Final 1](docs/releases/legacy-final1.md)
- [Legacy Final 2](docs/releases/legacy-final2.md)
