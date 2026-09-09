# Changelog

All notable changes to Opera Agent are documented here. The project follows Semantic Versioning.

## [Unreleased]

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
