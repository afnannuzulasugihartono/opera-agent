// @last-edited: 2026-10-29 UTC+7.
// @title: boundary-locks — the frozen locks on the public boundary, shared by the checkpoint tests.
// @state: one pin per frozen runtime file across three lock arrays; each line says why the current pin exists, and nothing else.
// @dependencies: none.

// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose public contract is frozen.
// Changing one means the contract changed, which is a reviewed decision: update the SHA in the same commit and say what moved.

// WHY there is no re-pin history here.
// Every entry below states why its CURRENT pin exists, and `git log -p` on this file is the record of what it used to be.
// The file carried ~90 lines of dated re-pin narratives that said "nothing about the contract moved" over and over; each one was true when written and is noise now, and a reader checking whether a contract moved had to read all of them to learn that none had.

// WHY these files are pinned at all: a public contract can change without any test failing.
// content.js and background.js carry the primitives the MCP surface advertises, and the MCP function carries the tool schemas; if one moves and the other does not, the product advertises something the runtime no longer accepts.
// Pinning the bytes turns that silence into a red test.

// WHY background.js changes more often than anything else here: the worker split moved dispatch out of it while keeping the bytes, so its extraction tasks re-pin it in the same commit.
// That is expected, not a smell.

// WHY CRLF does not cause false failures: a Windows checkout rewrites line endings, so the test normalizes CRLF to LF before hashing.
// Otherwise every developer on Windows would see all nine pins fail for a reason that is not a contract change.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'dfba81adb9994856ffa073171f3961a24db5c15e'],
  ['../extension/page-kit.js', 'afa5bc3f7916ba1b9f49a39fa1cc78d16015813d'],
  ['../extension/background.js', 'da44f1ed773c985cb6ad74c62d5e732d2fe2afee'],
  ['../extension/manifest.json', '39d65cb3c5b1c2262b58dc5d8bab57c673f15650'],
  ['../supabase/functions/opera-agent-mcp/index.ts', '69b1b38e7679a5ded86e3cdcfff0df0d4428f340'],
  ['../supabase/functions/opera-agent-mcp/tools.ts', '3e6c05dc9a610752b481951303f998e045c55baf'],
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'adb646c71fd033593bdbef264179b9877d569371'],
  ['../lib/reactive-vm-control-flow.js', '5014d8d7338c23f51fd8ae39c54ffea8ce24599b'],
  ['../lib/reactive-vm-collect.js', 'f687f4cd3088788b02291c64a12860d0fa5742e1'],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', 'a1bf0e5f1702d50a41340fa553d3b5255f2876a1'],
  ['../lib/delta-first-observation.js', '847cdf88ad9d6c410984f3b4c427370796ef84f1'],
]);