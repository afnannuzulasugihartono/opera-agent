// @last-edited: 2026-10-29 UTC+7.
// @title: boundary-locks — the frozen locks on the public boundary, shared by the checkpoint tests.
// @state: one pin per frozen runtime file across three lock arrays; each line says why the current pin exists, and nothing else.
// @dependencies: none.

// WHY THIS PIN SET MOVED ONCE, TOGETHER.
// The tree was reformatted repo-wide to K&R with one item per line, and every file below kept its token stream exactly: the same names, the same order, the same strings.
// What moved is where the delimiters stand and how deep each line sits, so the criterion each pin enforces — the public contract — did not move at all.
// That is what a re-pin for formatting looks like: one sweep, one commit, and a note saying the contract held.

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
  [
    '../extension/content.js',
    'b5b3e40afaec1bc8e496cad2126887ae210874d7'
  ],
  [
    '../extension/page-kit.js',
    'afa5bc3f7916ba1b9f49a39fa1cc78d16015813d'
  ],
  [
    '../extension/background.js',
    '654c163e3ecdaf40d2ab08b62b28bc838469b26e'
  ],
  [
    '../extension/manifest.json',
    '39d65cb3c5b1c2262b58dc5d8bab57c673f15650'
  ],
  [
    '../supabase/functions/opera-agent-mcp/index.ts',
    'd08f20cc6412350fd501d44cf9c53105be0c26c2'
  ],
  [
    '../supabase/functions/opera-agent-mcp/tools.ts',
    'e8f37c84dcd711bf137fd895ab7bc9396791ba9d'
  ],
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  [
    '../lib/reactive-vm.js',
    '24ab1dc047fa122d360e15fe56e22449989bd06f'
  ],
  [
    '../lib/reactive-vm-control-flow.js',
    'a01be9e086892a566232274e15b0f10e78195784'
  ],
  [
    '../lib/reactive-vm-collect.js',
    'bcd50f4a2179401ca039b0504a2c000cfa36873e'
  ],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  [
    '../lib/multi-signal-relevance.js',
    'c57be57fc28b6e27c8b5c86e3f25e527436b12b7'
  ],
  [
    '../lib/delta-first-observation.js',
    'c47748b49778b751ae9480c1242174cbb8fdd29e'
  ],
]);
