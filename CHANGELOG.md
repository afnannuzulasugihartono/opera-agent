# Changelog

All notable changes to Opera Agent are documented here. The project follows Semantic Versioning.

Releases `1.6.3`–`1.6.12` shipped through the private signed-update service
and are recorded per checkpoint in `docs/project-context.md` and
`docs/releases/`; the sections below keep the GitHub-facing history through
`1.6.2` plus the current release line.

## [1.6.15] - 2026-10-03 (candidate — signed, uploaded, and activated separately)

Latency and capability work on top of the 1.6.14 line, owner-ordered.
**Source only — nothing in this section is released or activated.**

- Burst `navigate` step: the tenth burst kind, mapped onto the existing
  `tabs.navigate` primitive (primitive count stays 26). Post-navigate refs are
  refused with `BURST_STALE_REF`; per-step `tabId` on all ten kinds makes
  cross-tab bursts reachable from `run_browser_burst`.
- Optimistic `contentCall`: the command goes out before any ensure step, so the
  normal case costs one sendMessage instead of tabs.get + ping + send. A
  page-bridge refusal (`ok:false`) is an answer, not a transport failure, and
  never triggers re-injection.
- Gateway offline-check folded into auth (4 trips to 3, behavior kept).
- Version 1.6.14 → 1.6.15 sweep across protocol/manifest/package/check.mjs and
  every version pin, per the recorded sweep convention. A same-version repack
  would never propagate (update checks compare version numbers), so the bump is
  required for the auto-update chain to deliver the work.

## [1.6.14] - 2026-10-03 (candidate — signed, uploaded, and activated separately)

Machine-audit repair of the 1.6.13 line, owner-ordered. **Source only — nothing
in this section is released or activated.**

- Burst cross-tab ref fence closed: `runBurst` refused a `refFromStep` only when
  the consuming step itself switched tabs, so a step staying on the
  already-active tab could consume a ref minted elsewhere. The check now
  compares the source step's recorded tab via pure helper `burstCrossTabRef`,
  pinned behaviorally in both directions. Same `BURST_CROSS_TAB_REF` code,
  same 26 primitives, no new action.
- MCP schema now accepts the per-step `tabId` the extension executes (all nine
  burst step kinds, strictness kept), so Phase D cross-tab bursts are reachable
  from `run_browser_burst`. Additive and backward compatible; 22 tools
  unchanged.
- Version 1.6.13 → 1.6.14 sweep across protocol/manifest/package/check.mjs and
  every version pin, per the recorded sweep convention. A same-version repack
  would never propagate (update checks compare version numbers), so the bump is
  required for the auto-update chain to deliver the fix.

## [1.6.13] - 2026-09-29

Signed, audited, and activated as the production release (owner-ordered).

- U-R delta for this version: timeout/retry/popup parity — expect-polling
  window, fill retry parity, coded `COMMAND_TIMEOUT` → `outcome:"unknown"`,
  bounded popup log + `openedTabs`, background-tab popup attribution fix.
  The binary also carries the cumulative line history: U-P1 (added at the
  1.6.11 source) and U-P3 (added at 1.6.12 source) — `1.6.12` itself was
  never packed as a signed CRX.
- U-Sonar: new-code reliability sweep (56 issues resolved, Quality Gate
  passed) plus DRY centralization (`lib/canonical-order.js`,
  `tests/helpers/boundary-locks.mjs`).
- Distribution: CRX3 60,188 bytes, SHA-256
  `8420872b2ce3bf7c1ce1cefcb66037eb453441bd73cde80c4fa1eeb1b2d263df`;
  `1.6.10`/`1.6.11` remain intact inactive rollback rows.
- Protocol 1, 26 browser primitives, and the 22-tool MCP inventory are
  unchanged across this line.

## [Unreleased]

Complex-application control track (R9), developed against a live Google Docs
session. **Source only — nothing in this section is released or activated.**
Production still serves CRX `1.6.13`. Record:
`docs/pre-8e-performance-usability-r9-evidence.md`.

### Added

- **Keyboard chords and bounded text entry on the trusted key path.** Modifier
  bitmask support (alt/control/meta/shift with common aliases), an expanded
  fixed 79-entry key vocabulary, and `Input.insertText`-based text entry up to
  20,000 characters, chunked at 4,000, behind the unchanged sensitive-field
  guard. Every previously allowlisted unmodified key resolves to a
  byte-identical CDP payload. Exposed publicly on `press_key` and the burst
  `key` step as optional fields, so the capability is reachable rather than
  dormant behind the schema.
- **Role reconciliation.** `serialize` now derives the role the platform would
  report from an element's own tag, input type, href, and contenteditable state
  instead of reading only the literal `role` attribute, so an unannotated
  `<button>` is no longer reported as `role: ''` and is visible to a
  role-filtered `find_elements`. The existing bounded text-poor accessibility
  walk additionally fills in roles the markup does not carry, so a custom
  control the platform reports as a radio becomes discoverable.
- **Hover as a first-class burst step.** A `hover` step moves the trusted
  pointer onto a resolved ref and settles on the reveal — an awaited submenu
  name, an `aria-expanded` flip, or DOM stability — so a multi-level menu is one
  step per level instead of a hand-built hover/wait chain.
- **At-dispatch foreground focus gate.** Foreground pointer, click, fill, and
  key input now re-sample tab/window focus from inside the debugger session
  immediately before dispatch and retry a bounded number of times, instead of
  sampling once before a content round trip and a debugger attach.

### Changed

- Model instructions now teach batching menu and dialog work into a single
  `run_browser_burst` via `refFromStep`, using the new hover step for
  multi-level menus, and acting directly on the `freshRefs` a moved-ref refusal
  carries.
- A stale-ref refusal after legitimate re-render now reports the measured drift
  and the tolerance, and hands back fresh refs for candidates that already
  passed uniqueness, intrinsic identity, actionability, and the non-sensitive
  check.

### Safety

- **The mint-time 24px geometry tolerance is unchanged and unbroadened**, and a
  moved successor is still refused. Recovery was made cheap by removing the
  extra `page.find` round trip, not by relaxing the guard.
- A hover dispatches exactly one pointer event and it is a move; it can never
  click, and it routes through the same foreground focus gate as every other
  pointer input.
- Role reconciliation never downgrades an explicit DOM role, never adopts an
  ambiguous accessibility name, never annotates a sensitive element, and never
  mints, moves, or invalidates a ref.
- No implicit tab activation, window focus, OS cursor movement, or keyboard
  redirection. `userActiveTab != automationTargetTab` still holds.
- No arbitrary JavaScript, `Runtime.evaluate`, raw CDP passthrough, or network
  interception. None exists in the extension and none was added.

### Unchanged

- Protocol 1, the 26 allowlisted browser primitives, and all 22 public MCP tool
  names. `page.hover` is burst-internal and is not a 27th primitive.
- `stableElementIdentity` keeps the raw `role` attribute, so no stableKey in the
  product changes.

### U-T event-triggered workflows (eliminates the model trip pattern)
- Device-local watch rules: the model arms a trigger ONCE (watch.start: selectorPresence/selectorGone/textMatch/urlChange/adState/mediaTime) and the extension reacts locally within ~50 ms of the page changing — no model round trip between trigger and action. Already-true-at-arm fires immediately (the T041 lesson); debounce, deadlineMs, maxEvents, 8/tab + 32 global caps, and stop/stop_all bound every rule; rules carry their own site selectors so the extension stays site-agnostic.
- Local actions run through proven executors: trusted page.click, runBurst, or the relay workflow runner; every firing produces an event envelope (rule, url/adState/mediaTime, action result) in opera_watch_events via the bridge watch_event ingest.
- wait_events MCP tool long-polls the event stream (opera_watch_events_wait, 5 ms SQL ramp) and returns the instant an event lands; stop_watch disarms; start_watch/wait_events/stop_watch join the public inventory (19→22, OBSERVATION class, contracts rebaselined).
- Universal fastpath: new opera-agent-gateway edge function — POST /command completes a browser action in ONE HTTP hop via opera_run_fast (enqueue + adaptive await in a single SQL call, ramp 5→30 ms then the proven 50 ms); token verified via opera_verify_device from a header or body.apiKey (GPT Actions cannot set custom headers); GET /openapi.json is GPT-Actions-ready.
- Version 1.6.6; node suite 471/472 (single fail = pre-existing local governance artifact); browser regression EXIT=0 (watcher clicked a control that appeared 1.2 s after arming, zero model trips).

### U-S burst atomic actions (observation→action gap, journal-grounded)
- Burst `click`/`fill` steps accept `refFromStep`/`refIndex` to consume a ref minted by an earlier `find`/`query` step inside the same burst, eliminating the model round trip that let YouTube destroy freshly-found controls between find and click (live: 14.1 s gap → 161.6 ms atomic burst, ~87× faster). Forward/self references fail closed at validation; step results carry `resolvedFrom:"step:N"` provenance.
- New `run_workflow` MCP tool (public inventory 18→19, contracts rebaselined) runs versioned site workflows end-to-end via the audited `opera_start_workflow` pg_net path and `opera_get_workflow_run` polling — inserting a run row alone never executes anything.
- New versioned `youtube.skip_ads` workflow: bounded re-query-every-iteration skip-click loop with the `.ad-showing` post-condition, following the locator-style freshness pattern for late-appearing (countdown-gated) controls.
- MCP instructions now teach the atomic pattern: for dynamic UIs run find+click+wait inside one `run_browser_burst` via `refFromStep` instead of separate round trips.

### I4 signature rebind (live T041 stale-ref repair)
- When a keyed action-ref target is recreated without its key (YouTube rebuilds the ad Skip control without its id between find and click), rebind now falls back to a unique intrinsic-signature successor: normalized visible text/label + tag + explicit descriptor fields, still actionable and non-sensitive; uniqueness is still required and the mint-time geometry guard remains the final authority.
- Verified against the live 07:47:45Z T041 failure captured in `opera_commands`; controlled-browser regression passes with a dedicated no-id successor scenario.

### U-I identity hardening (ChatGPT-web usability)
- Added geometry-aware action-ref rebind rejection: descriptors record mint-time document-coordinate geometry and mutation version; a stale ref refuses to rebind when its candidate moved more than 24 px since mint and the refusal names the current plausible candidates (addresses the production stale-`Zoom in` mis-click hazard).
- `page.find` now annotates multi-candidate results with `candidateRank` and a disambiguation `hint` including the explicit `index:` selection instruction.
- On a zero exact-field match, `page.find` projects one bounded fuzzy candidate (`fuzzy: true` plus a fallback hint) or, when only visible text exists, the closest actionable element to that text, replacing capture/re-read recovery loops with one round trip.
- Protocol 1, 26 browser primitives, and the 18-tool MCP inventory remain unchanged; additions are extension-internal result fields.

### R8 repair candidate 1.6.3
- Preserve explicit diagnostic `items` while selecting the unique exact-actionable `item`, even when callers supply a limit.
- Correct false overflow-ancestor clipping only when bounded browser hit testing proves the target reachable; genuine clipping remains fail-closed.

## [1.6.2] - 2026-09-20

### Audited forward rollback
- Activated the same-identity signed 1.6.2 rollback after 1.6.1 failed the R8 live Skip-path acceptance gate.
- Restored accepted 1.6.0 extension behavior while preserving pairing, Protocol 1, 26 capabilities, and the 18-tool MCP inventory.

## [1.6.1] - 2026-09-20

### R8 usability update
- Published the same-identity `1.6.1` extension with generic unique exact-actionable `page.find` projection for omitted-limit calls.
- Preserved explicit multi-result diagnostics, equal actionable ambiguity, combined-field fuzzy/exact matching, sensitive/offscreen exclusion, Protocol 1, 26 browser capabilities, and the 18-tool MCP schema.
- Stored signed `1.6.2` inactive as a verified higher-version rollback to accepted 1.6.0 behavior.
- Live R8 acceptance later failed because Skip required candidate filtering, two stale-ref failures, and coordinate fallback; 1.6.1 was deactivated in favor of 1.6.2.

### Milestone 8 — Decision-Causal Transactions and Provenance Enforcement
- Added an isolated local 8D admission candidate with trusted-adapter-only identity/ledger/target/provenance resolution contracts, exact argument coverage, immutable digest-only results, and no browser/production integration; 8D remains in progress.
- Froze and independently reviewed the milestone plan after closing same-agent legacy-mutation bypass, limiting V1 to one state-changing action, and correcting MCP 2026 stateless approval binding.
- Accepted contract-only Checkpoint 8A with closed transaction/provenance/approval schemas, a complete 18-tool enforcement matrix, exact approval binding, four deterministic digest vectors, 74 hostile replay cases, and unchanged 1.6.0 runtime/production/public inventory.
- Accepted pure Checkpoint 8B with immutable single-action preparation, canonical digest validation, conservative effect classification, typed dependency fingerprints, selective/fail-closed predicate revalidation, bounded previews, and enforcement decisions without browser, network, database, or public-surface integration.
- Accepted pure Checkpoint 8C with exact-target provenance validation, anti-authority-laundering rules, exact-bound OAuth-user approval challenges, modern one-round requestState/inputResponses verification, TTL and consumed-nonce rejection, and deterministic consumption claims without transport, persistence, browser, or production integration.
- Repaired local 8D prerequisites: shared creation/import approval interval validation and enforcement of narrower declared prepare/total/approval lifetime budgets; six new regression tests, with no host or production integration.

### Milestone 7 — Reactive Browser VM
- Passed the independent Codex milestone-boundary audit at final head `551e8283c0417b173e106ee0598cca848f2f4ff0`; local tests, exact-head CI, browser harness, Edge bundle, contract boundaries, GitHub cleanup, and production Supabase dark state were independently reconciled.
- Completed Checkpoints 7A–7F for a bounded Reactive Browser VM with a closed JSON AST, deterministic sliced execution, tenant-bound durability, exact-redelivery idempotency, typed suspension, bounded collection/deduplication, proof separation, cancellation/expiry/reclaim, and default-off production hosting.
- Preserved extension `1.6.0`, protocol `1`, all `26` browser capabilities, the existing `18` MCP tools/input schemas, signing identity, pairing, and background-first focus behavior; no new CRX was produced.
- Completed 7F production acceptance with focused 6/6, full 171/171 Node tests on Ubuntu and actual Windows, static validation, controlled Chromium, a 55-command zero-focus audit, burst 20/20, deterministic replay agreement 100%, zero false `PROVED`, signed normal-profile Maps/YouTube/GitHub checks, and dark Supabase replay/idempotency/worker-death/cancel/expiry/cross-tenant probes.
- Measured the final paired same-runner semantic-read regression at 13.851%, below the frozen 15% limit.
- Kept `milestone7_vm_enabled=false` after acceptance and verified zero `vm_runs`, `vm_effects`, `vm_rate_windows`, and temporary `m7-7f-*` command rows.

### Cross-platform contract hashing
- Fixed three Windows-only MCP source-hash gate failures caused by CRLF checkout bytes by canonicalizing CRLF/lone-CR bytes explicitly to LF before SHA-256.
- Kept the frozen canonical LF MCP source hash `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`, the 7A inventory digest, MCP source, and public contract unchanged.
- Added an actual `windows-latest` acceptance job that passed 171/171 plus `npm run check` after the repair.

### Collaboration policy
- Added checkpoint ownership/closeout rules to `AGENTS.md` and the reusable `docs/prompts/chatgpt-web-checkpoint.md` prompt.
- ChatGPT Web may implement/accept one checkpoint at a time with one active milestone-branch writer; Codex independently audits the complete milestone before the next milestone starts.
- The independent Milestone 7 audit passed; Milestone 8 remains not started, with planning now permitted.

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
- Added local capture blocking for internal pages, incognito contexts, visible credential/OTP/payment fields in the main document or embedded frames, and tabs the user marks private in the extension popup.
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
