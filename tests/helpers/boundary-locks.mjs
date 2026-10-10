// @last-edited: 2026-10-10 UTC+7.
// @title: boundary-locks — locks — Frozen public-boundary locks shared by the checkpoint tests.
// @state: pins re-taken through the 1.6.22 bump: manifest moved on the version line, every other contract unmoved.
// @dependencies: none.

// Frozen public-boundary locks shared by the checkpoint tests.
//
// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose public
// contract is frozen. Changing one means the contract changed, which is a reviewed
// decision: update the SHA in the same commit and say what moved. Each line states
// why the current pin exists; git keeps the history of what it used to be.
//
// Re-pinned 2026-10-06 for whitespace only. The comment-spacing rule had never
// inspected indented comments, so three of these files carried comment blocks
// glued to the statement above them. Separating those blocks moved the bytes and
// nothing else: `git diff --ignore-blank-lines` across the three paths is empty,
// and no symbol, signature or contract the reasons below describe has changed.
// The pins are re-taken rather than exempted, so the spacing rule keeps covering
// the files that matter most instead of skipping them.
//
// Re-pinned 2026-10-07 for 1.6.16. content.js moved because the install marker is
// now written (and re-written on DOMContentLoaded) before any runtime below it can
// throw — same dataset attribute, same value, earlier and fallback-guarded. The
// manifest moved on the version line only (1.6.15 → 1.6.16); the signing key,
// permissions and entry points are untouched, so the extension id is stable.
//
// Re-pinned 2026-10-08 for the Wave B bug batch. No public contract moved: the
// primitives, schemas, permissions and entry points are untouched. content.js
// moved on one line (the state-event forward now swallows the worker-sleep
// rejection via ?.catch). background.js moved on the Wave B hardening only
// (burst fill value, empty tabId, SCREENSHOT_TOO_SMALL, awaited finishLoop,
// full-list ensureContent, external key-clear refusal).
//
// Re-pinned 2026-10-08 for the Wave C batch. No public contract moved: the
// primitives, schemas, permissions and entry points are untouched.
// background.js moved on the Wave C hardening only (facts reply carries
// engine state, arm-time deadlineMs default, boolean tabId refused, dead
// set-bridge-url popup action deleted).
//
// Re-pinned 2026-10-08 for the Wave C review minors. No public contract
// moved: the primitives, schemas, permissions and entry points are
// untouched. background.js moved on the four review minors only (null
// deadlineMs normalizes to the 60s default at arm, missing deadline prunes
// as expired, no-entries facts reply carries empty state, boolean loop
// budgets are rejected in lib/loop.js).
//
// Re-pinned 2026-10-08 for the Wave E isolation batch. No tool, schema,
// primitive, permission or entry point moved: resolveDeviceName no longer
// echoes an unowned X-Opera-Device header (or the fixed DEVICE_NAME) when the
// owner query misses — a caller with no owned device gets 401 — and
// wait_events filters to the caller-owned device. The only digest changes are
// wait_events (the filter) and media_listen_read (its block runs to EOF, so it
// observes the serve-level 401).

// Re-pinned 2026-10-09 for the official-site config grant (owner decision
// OPSI A). manifest.json gains https://opera-agent.pages.dev/* in
// externally_connectable; background.js replaces the inline localhost prefix
// list with originAllowed from lib/external-origins.js (exact-or-slash match
// for the site, prefix match kept for localhost ports). No primitive, schema,
// permission or entry point moved.

// Re-pinned 2026-10-09 for the background.js split spec. No contract moved:
// the observation and relevance stacks had never been asserted — nothing
// imported their two arrays — and four of their five pins had gone stale
// unnoticed. This test now checks all nine entries, so a drift fails here.
// Hashes are git blob SHA1 over LF bytes; a CRLF checkout normalizes first.

// Re-pinned 2026-10-09 for the background.js split. No public contract moved:
// dispatch keeps byte-identical content in background.js — only the code around
// it moves into worker/ and lib/ modules. Every extraction task re-pins the
// background.js hash below in the same commit, so the value tracks the file's
// current bytes; this comment stays as the single record of why it keeps
// changing. content.js, manifest.json and the MCP function are untouched by
// the split and are not re-pinned.

// Re-pinned 2026-10-10 for the S2819 state-bridge origin fix. No public
// contract moved: the listener accepts the same events from the same bridge
// and forwards the same detail. content.js now checks each message's origin
// against this document's own, and admits only the seven type literals
// state-bridge.js can emit, where it previously accepted any string at all.
// background.js, manifest.json and the MCP function are untouched.

// Re-pinned 2026-10-10 for the 1.6.22 release bump. No public contract
// moved: permissions, entry points, the signing key and
// externally_connectable are untouched, so the extension id is stable.
// manifest.json moved on the version line only (1.6.21 → 1.6.22); the
// split worker keeps background.js as the service-worker entry.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', '70619bc3d79be424b79c7afb092bcf52e4fab0e5'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses; marks documentElement so a page can tell the extension is installed, even before documentElement exists; forwards MAIN-world state-bridge events to the background only after matching this document's origin and admitting the seven type literals the bridge emits, swallowing the worker-sleep rejection via ?.catch
  ['../extension/background.js', '59342664c31afbc2d4613b4ebbc4cd3e7101277a'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs; sense-act loop engine (loop.start/read/stop) with persistent debugger attach; region-clip capture, suspend floor, stillness and track sensors; per-tick sensor activity, values, and phase timings in the trace; native-resolution sense frames; front-edge tracking immune to ground texture; Wave B hardening only — burst fill value regardless of refFromStep, empty tabId refused, SCREENSHOT_TOO_SMALL split out, finishLoop awaits the debugger release, ensureContent re-injects the full manifest script list, external model-key clear refused; Wave C hardening only — facts reply carries engine state, arm-time deadlineMs default, boolean tabId refused, dead set-bridge-url popup action deleted; Wave C review minors — null deadlineMs normalizes at arm, missing deadline prunes as expired, no-entries reply carries empty state; official-site config grant — origin check moved to lib/external-origins.js (strict site match, localhost prefix kept)
  ['../extension/manifest.json', 'a94f3abdd9642df293874a1ebe93f232549b729e'], // entry points, permissions, version; key is the CRX signing public key, so it changed with the rotation that made the published CRX installable; version line 1.6.18 → 1.6.19 for sense-act loops; 1.6.19 → 1.6.20 for state loops; externally_connectable gains the official site; version line 1.6.21 → 1.6.22 for the modular worker release
  ['../supabase/functions/opera-agent-mcp/index.ts', '908ae83e2d0a5fa52badd5316b80bfd24f4534d7'], // MCP tool surface and schemas; an empty allowlist admits nobody, since every caller drives the one device; re-pinned for loop_start/loop_read/loop_stop (sense-act loops); loop sensors stillness, track; state tools loop_state_start/read/stop; run_adhoc (one-off writes as ephemeral workflows); Wave E isolation — unowned device names refused with 401, wait_events filtered to the owned device; Wave E fix round 1 — wait_events preserves a falsy RPC envelope instead of forcing ok:true; skill_save/skill_recall (manual save/recall over the shared skill memory, no device queue)
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'aaa6caf1369e3358fcf14a35520754d6fc9c1731'], // reactive VM core without its unwired entry points; createReactiveVm and advanceReactiveVm had no importer and left with the dead-surface cleanup that unblocked the deploy gate
  ['../lib/reactive-vm-control-flow.js', '52cc8027c9128f2038a80ffd77c191328e0787cc'], // reactive VM phase C
  ['../lib/reactive-vm-collect.js', '2e9446633f82435123f41971d766df351f8e0266'], // reactive VM phase D without bindCollectionEvidence; unexported helpers stay module-private until the phase is wired
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', 'fe7554b663fbd20d4ae3fed4d90d5efc99d28d9b'], // multi-signal relevance without the unreferenced P3 decision table
  ['../lib/delta-first-observation.js', '534a3bb22b1e661a5799c3798196fcffa4764ae9'], // delta first observation
]);
