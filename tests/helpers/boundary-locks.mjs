// @last-edited: 2026-10-04 18:25 UTC+7.
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
  ['../extension/content.js', '013022f46a00f85c3ac51fdf71618c52078c404b'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses
  ['../extension/background.js', '5ce0264c59293dea839bad64f93ea6ed737e7dd7'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', 'a0781f778c694b308944770cd85fbe3d538f0d46'], // entry points, permissions, version
  ['../supabase/functions/opera-agent-mcp/index.ts', '2556cf554683d80f33fb1974dd1d1b85993f8c9d'], // MCP tool surface and schemas
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'a27f34103488fe14d38140c31095675fbb17d1ae'], // reactive VM core
  ['../lib/reactive-vm-7c.js', '033791d34f623aba4816011fc296d501339240bb'], // reactive VM phase C
  ['../lib/reactive-vm-7d.js', 'eb8565ad6268070c9a072ea8709ed13f9ec0b281'], // reactive VM phase D
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', '96e7b3fa993ae7fd8801437da1346dab059e9b27'], // multi-signal relevance
  ['../lib/delta-first-observation-p2.js', 'bb9e82536137a0fbe176234238915bc83671ceff'], // delta first observation
]);
