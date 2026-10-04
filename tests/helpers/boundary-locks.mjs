// Last edited: 2026-10-04 17:52. Title: boundary-locks — Frozen public-boundary locks shared by the checkpoint tests. Now: remove the unused activeTab permission from the manifest.

// Frozen public-boundary locks shared by the checkpoint tests.
//
// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose public
// contract is frozen. Changing one means the contract changed, which is a reviewed
// decision: update the SHA in the same commit and say what moved. Each line states
// why the current pin exists; git keeps the history of what it used to be.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', '2bad64c040604c337ef1bd616ad3075f0eb9ba95'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses
  ['../extension/background.js', 'f60f1065a50cf5d5a938d905c231eb744989907d'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs
  ['../extension/manifest.json', 'a0781f778c694b308944770cd85fbe3d538f0d46'], // entry points, permissions, version
  ['../supabase/functions/opera-agent-mcp/index.ts', '67635df4ba47fd705717fa862a551e38990e7652'], // MCP tool surface and schemas
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', '185ec6697ae4b8e02349e1e053874451fc1f8f85'], // reactive VM core
  ['../lib/reactive-vm-7c.js', '71e9330d3986cac071d1ed4431f05e74d92bec12'], // reactive VM phase C
  ['../lib/reactive-vm-7d.js', 'e70c240aef00c11be64c51efa898441a9dcd32e9'], // reactive VM phase D
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', 'eeaf370d357911331d28ec023b4468e4f7bf5bd6'], // multi-signal relevance
  ['../lib/delta-first-observation-p2.js', '53ac208ae8bf59807f595d75a6847a30392b6f46'], // delta first observation
]);
