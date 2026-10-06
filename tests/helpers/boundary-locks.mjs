// @last-edited: 2026-10-06 10:20 UTC+7.
// @title: boundary-locks — locks — Frozen public-boundary locks shared by the checkpoint tests.
// @state: three pins re-taken for blank lines between comment blocks; no code moved.
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

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'c0fd8dc5b04f6e895af2af5b552f0c8620fab9a1'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses; marks documentElement so a page can tell the extension is installed
  ['../extension/background.js', 'a985093c726dc2ee8b1b201ac05ffb85c6520269'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', '70ee51bc55415f4d8061981c14d3174b8dc75ec6'], // entry points, permissions, version; key is the CRX signing public key, so it changed with the rotation that made the published CRX installable
  ['../supabase/functions/opera-agent-mcp/index.ts', '62bf353235dd6fbe88cec7185a4ab4c5cb714c2c'], // MCP tool surface and schemas
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
