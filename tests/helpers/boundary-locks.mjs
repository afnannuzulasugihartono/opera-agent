// Frozen public-boundary locks shared by the checkpoint tests.
//
// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose public
// contract is frozen. Changing one means the contract changed, which is a reviewed
// decision: update the SHA in the same commit and say what moved. Each line states
// why the current pin exists; git keeps the history of what it used to be.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'ba4bcac72efb062749fb21da3cee05927e02cd39'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses
  ['../extension/background.js', '323ba5e01cc166915b32634356fdfce69c835c49'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', 'a0781f778c694b308944770cd85fbe3d538f0d46'], // entry points, permissions, version
  ['../supabase/functions/opera-agent-mcp/index.ts', 'aa579131b99fce6994a6f99779e8fbadcfca948e'], // MCP tool surface and schemas
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'ecc3559d2d0ae98d681ce0df6fc365123c646052'], // reactive VM core
  ['../lib/reactive-vm-7c.js', '212b324840fa347bf058cfaee8fad8cc9f80efc2'], // reactive VM phase C
  ['../lib/reactive-vm-7d.js', 'e0fb0e1119410c467bad89984fd894af2e29cb23'], // reactive VM phase D
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', '97ef64a69a1e77d1617c426cbb38407145b6327f'], // multi-signal relevance
  ['../lib/delta-first-observation-p2.js', '5335e1d09a8b8357a2fb20ecb30f1908c3c7d7e3'], // delta first observation
]);
