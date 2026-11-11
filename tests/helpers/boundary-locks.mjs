// @last-edited: 2026-11-09 UTC+7.
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

// WHY the MCP function was re-pinned on 2026-11-11: the device contract moved, and it moved on purpose.
// The pin used to be honoured only while the pinned browser was live, and a sleeping pin was quietly replaced by whichever browser was freshest.
// Tab ids live inside one browser, so a chain of calls that started on the pinned browser and continued on another left the agent holding a tab id that existed on neither, and the failure read as a broken tool.
// Now the pin decides: a live pin answers every call, a sleeping pin is a named refusal that names the awake browsers and the header that reaches one, and X-Opera-Device: any opts into the old fallback on purpose.
// The tool schemas did not move, so tools.ts keeps its pin - except for the one line that names device.alternatives in the browser_status answer, which is the output fact the new refusal needs the agent to see.

// WHY the MCP function was re-pinned again on 2026-11-11: the device contract moved a second time, in the same direction.
// A device the owner revoked is not a device, so the resolver must never pick it and the query must never bring it in.
// The criterion did not change; it got stricter: the surface that names the browser to drive now also refuses the ones that were cut off.

// WHY CRLF does not cause false failures: a Windows checkout rewrites line endings, so the test normalizes CRLF to LF before hashing.
// Otherwise every developer on Windows would see all nine pins fail for a reason that is not a contract change.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'be462c9e32536137c94714185cdee227828538a1'],
  ['../extension/background.js', '556585d7a2d3e72c8f73af54523759da259527b6'],
  ['../extension/manifest.json', '3200e847b41fff50759fd72036a933401d03121f'],
  ['../supabase/functions/opera-agent-mcp/index.ts', '9e15b01fad9a3e48e18fc8671b30e8b7850df94b'],
  ['../supabase/functions/opera-agent-mcp/tools.ts', '2d58d8177c38bdf947af1a725058f60a04b70ff4'],
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
