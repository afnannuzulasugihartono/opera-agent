// @last-edited: 2026-10-06 10:20 UTC+7.
// @title: boundary-locks — locks — Frozen public-boundary locks shared by the checkpoint tests.
// @state: remove the unused activeTab permission from the manifest.
// @dependencies: none.

// Frozen public-boundary locks shared by the checkpoint tests.
//
// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose public
// contract is frozen. Changing one means the contract changed, which is a reviewed
// decision: update the SHA in the same commit and say what moved. Each line states
// why the current pin exists; git keeps the history of what it used to be.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'e0cc1f1450e85d21c6eaffbae880078762d67e7d'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses; marks documentElement so a page can tell the extension is installed
  ['../extension/background.js', '52b48a75387ff7829b21461f42236f94252d1cb9'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', '70ee51bc55415f4d8061981c14d3174b8dc75ec6'], // entry points, permissions, version; key is the CRX signing public key, so it changed with the rotation that made the published CRX installable
  ['../supabase/functions/opera-agent-mcp/index.ts', '706b49b755312cf10ce10f202bb99900b48afd01'], // MCP tool surface and schemas
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
