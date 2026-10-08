// @last-edited: 2026-10-07 02:45 UTC+7.
// @title: boundary-locks — locks — Frozen public-boundary locks shared by the checkpoint tests.
// @state: pins re-taken for the 1.6.16 sweep: content.js early-marker fix and manifest version bump; no contract moved.
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

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', '22be5ef8f1798df1327b4ed226748fd5496614c4'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses; marks documentElement so a page can tell the extension is installed, even before documentElement exists; forwards MAIN-world state-bridge events to the background, swallowing the worker-sleep rejection via ?.catch
  ['../extension/background.js', '7c93ad45960121348babbb5b21a754be9b55c622'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs; sense-act loop engine (loop.start/read/stop) with persistent debugger attach; region-clip capture, suspend floor, stillness and track sensors; per-tick sensor activity, values, and phase timings in the trace; native-resolution sense frames; front-edge tracking immune to ground texture; Wave B hardening only — burst fill value regardless of refFromStep, empty tabId refused, SCREENSHOT_TOO_SMALL split out, finishLoop awaits the debugger release, ensureContent re-injects the full manifest script list, external model-key clear refused
  ['../extension/manifest.json', '054c2733cc69b0d0e317636554096a948fab5286'], // entry points, permissions, version; key is the CRX signing public key, so it changed with the rotation that made the published CRX installable; version line 1.6.18 → 1.6.19 for sense-act loops; 1.6.19 → 1.6.20 for state loops
  ['../supabase/functions/opera-agent-mcp/index.ts', '7281599b47c3620136199da5d67dbfba77a6e6cc'], // MCP tool surface and schemas; an empty allowlist admits nobody, since every caller drives the one device; re-pinned for loop_start/loop_read/loop_stop (sense-act loops); loop sensors stillness, track; state tools loop_state_start/read/stop; run_adhoc (one-off writes as ephemeral workflows)
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'b7b0705156063384561b6184ac816c75a17737c9'], // reactive VM core without its unwired entry points; createReactiveVm and advanceReactiveVm had no importer and left with the dead-surface cleanup that unblocked the deploy gate
  ['../lib/reactive-vm-control-flow.js', 'c5c8933f733c0217e3f0e33513d5efda3893b99d'], // reactive VM phase C
  ['../lib/reactive-vm-collect.js', 'd5f748ec74e5af0355d2b638a495765269f3a575'], // reactive VM phase D without bindCollectionEvidence; unexported helpers stay module-private until the phase is wired
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', '713cdf15960760d81f16dee9e20b2ed23bb4ff97'], // multi-signal relevance without the unreferenced P3 decision table
  ['../lib/delta-first-observation.js', '534a3bb22b1e661a5799c3798196fcffa4764ae9'], // delta first observation
]);
