// @last-edited: 2026-10-13 UTC+7.
// @title: boundary-locks — locks — Frozen public-boundary locks shared by the checkpoint tests.
// @state: nine pins over four stacks; each line says why the current pin exists, and nothing else.
// @dependencies: none.

// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose public
// contract is frozen. Changing one means the contract changed, which is a reviewed
// decision: update the SHA in the same commit and say what moved.
//
// WHY there is no re-pin history here. Every entry below states why its CURRENT pin
// exists, and `git log -p` on this file is the record of what it used to be. The file
// carried ~90 lines of dated re-pin narratives that said "nothing about the contract
// moved" over and over; each one was true when written and is noise now, and a reader
// checking whether a contract moved had to read all of them to learn that none had.
//
// WHY these files are pinned at all: a public contract can change without any test
// failing. content.js and background.js carry the primitives the MCP surface advertises,
// and the MCP function carries the tool schemas; if one moves and the other does not,
// the product advertises something the runtime no longer accepts. Pinning the bytes
// turns that silence into a red test.
//
// WHY background.js changes more often than anything else here: the worker split moved
// dispatch out of it while keeping the bytes, so its extraction tasks re-pin it in the
// same commit. That is expected, not a smell.
//
// WHY CRLF does not cause false failures: a Windows checkout rewrites line endings, so
// the test normalizes CRLF to LF before hashing. Otherwise every developer on Windows
// would see all nine pins fail for a reason that is not a contract change.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', '67a3f0aa0e3ebf73165b5fe078b8b842de261f60'],
  ['../extension/background.js', 'ff1811e8c7d5fce3ae5bb167a1f50db78c9be3ff'],
  ['../extension/manifest.json', '689cd3077a0c1383fd050830076b70c6b02b47a9'],
  ['../supabase/functions/opera-agent-mcp/index.ts', '35164d9217d060085159a36ecd6f1c7f3a51e3aa'],
  ['../supabase/functions/opera-agent-mcp/tools.ts', 'd3ee2ca5bd6b0acd05a2a49137d5ca419b556a0a'],
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', '1148cbbd02a647715a026a3b2094da203f031239'],
  ['../lib/reactive-vm-control-flow.js', '0b6064410c34449050eb72b2ef2827c3739a9ff2'],
  ['../lib/reactive-vm-collect.js', '852e48dcd3a15b6fb9092df6b00da93a110ad571'],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', 'fe7554b663fbd20d4ae3fed4d90d5efc99d28d9b'],
  ['../lib/delta-first-observation.js', '534a3bb22b1e661a5799c3798196fcffa4764ae9'],
]);