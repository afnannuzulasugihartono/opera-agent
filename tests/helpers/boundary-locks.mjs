// @last-edited: 2026-10-13 UTC+7.
// @title: boundary-locks — locks — Frozen public-boundary locks shared by the checkpoint tests.
// @state: nine pins over four stacks; each line says why the current pin exists, and nothing else.
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
  ['../extension/content.js', '7ae83fa6636b00aa3c22f36420fc05c91591b997'],
  ['../extension/background.js', 'bfa396f51b12a818a62a890a3573fe7186e24274'],
  ['../extension/manifest.json', 'edc35efcd7e1476ad5f4f8898988e48bce6cce8f'],
  ['../supabase/functions/opera-agent-mcp/index.ts', '31a3eb2a855676c930094d08982c8c5532df71ec'],
  ['../supabase/functions/opera-agent-mcp/tools.ts', 'bc405082091bcbd8ed774171487292d3575c5f96'],
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', '1148cbbd02a647715a026a3b2094da203f031239'],
  ['../lib/reactive-vm-control-flow.js', '5f1a49fc5023d2d7c72dce9034c4eaac405ea780'],
  ['../lib/reactive-vm-collect.js', '852e48dcd3a15b6fb9092df6b00da93a110ad571'],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', 'fe7554b663fbd20d4ae3fed4d90d5efc99d28d9b'],
  ['../lib/delta-first-observation.js', '534a3bb22b1e661a5799c3798196fcffa4764ae9'],
]);