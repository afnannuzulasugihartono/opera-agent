// @last-edited: 2026-10-13 UTC+7.
// @title: boundary-locks — the frozen locks on the public boundary, shared by the checkpoint tests.
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
  ['../extension/content.js', 'be462c9e32536137c94714185cdee227828538a1'],
  ['../extension/background.js', '556585d7a2d3e72c8f73af54523759da259527b6'],
  ['../extension/manifest.json', 'ec8c31c0c2a1a8d7b365aa2c82b072e5a0dec894'],
  ['../supabase/functions/opera-agent-mcp/index.ts', 'b2041f647f60ec58811e8b34f491db70414bdf62'],
  ['../supabase/functions/opera-agent-mcp/tools.ts', '00be73e4faa064ea8ce0ddf6a6b4209efd873309'],
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'adb646c71fd033593bdbef264179b9877d569371'],
  ['../lib/reactive-vm-control-flow.js', '266dbfb47714b8cdc913410ac94402482def5dfe'],
  ['../lib/reactive-vm-collect.js', 'f687f4cd3088788b02291c64a12860d0fa5742e1'],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', 'a1bf0e5f1702d50a41340fa553d3b5255f2876a1'],
  ['../lib/delta-first-observation.js', '847cdf88ad9d6c410984f3b4c427370796ef84f1'],
]);