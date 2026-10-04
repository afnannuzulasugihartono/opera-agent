// @last-edited: 2026-10-04 11:10 UTC.
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
  ['../extension/content.js', '26a65f6b6e5a4a92220ba72da76a82f5d256f177'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses
  ['../extension/background.js', 'd466151e728ef0487fe5ffdfb6368f5955ff84d3'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', 'a0781f778c694b308944770cd85fbe3d538f0d46'], // entry points, permissions, version
  ['../supabase/functions/opera-agent-mcp/index.ts', '17c25d521126768954b449093c0d3ae0d1effd12'], // MCP tool surface and schemas
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'b97ac0280036255ca18a615071999a5bad45065c'], // reactive VM core
  ['../lib/reactive-vm-7c.js', 'f09a8c1292b959d3a9b5a17fa6ad748b973b15ee'], // reactive VM phase C
  ['../lib/reactive-vm-7d.js', '74853f1dbe7ff765e05078677e463bca9537a83a'], // reactive VM phase D
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', '103b62793b3c31c4af2c6dda1e464ecd5b384c7a'], // multi-signal relevance
  ['../lib/delta-first-observation-p2.js', '2360fc1daff6a5fa60887b574a13a26581b93c12'], // delta first observation
]);
