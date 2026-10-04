// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: boundary-locks — locks — Frozen public-boundary locks shared by the checkpoint tests.
// @context: Test helper.
// @state: remove the unused activeTab permission from the manifest.
// @updated: every file carries Last edited, Title, Purpose and Now
// @dependencies: none.

// Frozen public-boundary locks shared by the checkpoint tests.
//
// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose public
// contract is frozen. Changing one means the contract changed, which is a reviewed
// decision: update the SHA in the same commit and say what moved. Each line states
// why the current pin exists; git keeps the history of what it used to be.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'f023238bd1cef7efa9051f56188e8ae18b3e4a1d'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses
  ['../extension/background.js', '67c6acfcda524fbd776a00383d0697231531b605'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', 'a0781f778c694b308944770cd85fbe3d538f0d46'], // entry points, permissions, version
  ['../supabase/functions/opera-agent-mcp/index.ts', '2ccb47470d44c624c2addc72fc45f4a430b19923'], // MCP tool surface and schemas
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'e6c1fa08a852af4885422063d11b37f87c7721c8'], // reactive VM core
  ['../lib/reactive-vm-7c.js', '67194b8a1881179d1dbe58c8ae077bec78b40942'], // reactive VM phase C
  ['../lib/reactive-vm-7d.js', 'f56326f3b4001159138b2da31bf81966f567f324'], // reactive VM phase D
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', '24fc1134678fd647634b4a1410b11679f691c792'], // multi-signal relevance
  ['../lib/delta-first-observation-p2.js', 'bc49348273aed86890b0dddc407cc1e5b15bc980'], // delta first observation
]);
