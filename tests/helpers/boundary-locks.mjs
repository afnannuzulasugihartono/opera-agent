// @last-edited: 2026-10-06 00:52 UTC+7.
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
  ['../extension/content.js', '4fb789e329095ec78572809d322ffb9f9ae0e1cd'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses
  ['../extension/background.js', '52b48a75387ff7829b21461f42236f94252d1cb9'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', '70ee51bc55415f4d8061981c14d3174b8dc75ec6'], // entry points, permissions, version; key is the CRX signing public key, so it changed with the rotation that made the published CRX installable
  ['../supabase/functions/opera-agent-mcp/index.ts', '706b49b755312cf10ce10f202bb99900b48afd01'], // MCP tool surface and schemas
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', '3a36f9b664660b0257f871dd183a53b281fda4a2'], // reactive VM core
  ['../lib/reactive-vm-control-flow.js', 'c5c8933f733c0217e3f0e33513d5efda3893b99d'], // reactive VM phase C
  ['../lib/reactive-vm-collect.js', 'b9b060b63cff42ae74ec0a6b1a63992e9603e726'], // reactive VM phase D
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', 'f23ee99c8f647720ff20f1da01c3d529bd2d5b40'], // multi-signal relevance
  ['../lib/delta-first-observation.js', '534a3bb22b1e661a5799c3798196fcffa4764ae9'], // delta first observation
]);
