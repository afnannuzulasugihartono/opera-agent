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

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', '7e6bb737b0baa01643167fc6515f14110d83ec7c'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses; marks documentElement so a page can tell the extension is installed, even before documentElement exists; forwards MAIN-world state-bridge events to the background
  ['../extension/background.js', '718241f258a2c13c51663a47cd61e1f1a18410b6'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs; sense-act loop engine (loop.start/read/stop) with persistent debugger attach; region-clip capture, suspend floor, stillness and track sensors; per-tick sensor activity, values, and phase timings in the trace; native-resolution sense frames; front-edge tracking immune to ground texture
  ['../extension/manifest.json', '271fe509b05c3f0fafd31965c0a4e1ee5ccfb176'], // entry points, permissions, version; key is the CRX signing public key, so it changed with the rotation that made the published CRX installable; version line 1.6.18 → 1.6.19 for sense-act loops; 1.6.19 → 1.6.20 for state loops
  ['../supabase/functions/opera-agent-mcp/index.ts', '9746e426941715d62f9c3a9fbd670180c2ca51f2'], // MCP tool surface and schemas; an empty allowlist admits nobody, since every caller drives the one device; re-pinned for loop_start/loop_read/loop_stop (sense-act loops); loop sensors stillness, track; state tools loop_state_start/read/stop
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
