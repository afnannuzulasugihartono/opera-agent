// @last-edited: 2026-11-11 UTC+7.
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

// WHY the public surface was re-pinned a third time on 2026-11-11: the device itself can now be asked to pull the newest build.
// The extension answers extension.update by writing the served build over its own folder and restarting, and the hosted surface carries the two tools the reader and the agent have: check_update and apply_update.
// The dispatch case, the tool schemas and the update-status helper are the reviewed changes; content.js and manifest.json did not move.

// WHY manifest.json was re-pinned on 2026-11-11: it now names its icons.
// The action carried a popup and no icon, so the toolbar showed the browser's generic extension glyph - the product had no face in the one place every reader sees.
// The icon is the site icon, drawn by scripts/draw-icon.py from the same path the website uses; nothing else in the manifest moved.

// WHY manifest.json was re-pinned a second time on 2026-11-11: the release bump.
// 1.6.40 to 1.6.41; nothing else in the manifest moved.

// WHY index.ts was re-pinned on 2026-11-11: the release bump rode in it.
// The server version constant moved 1.6.40 to 1.6.41; the surface did not move with it.

// WHY index.ts was re-pinned on 2026-11-11 a third time: the hosted answer stopped being a stream.
// The transport answers one JSON body now, because a client that waits for an SSE stream to close waited ten seconds for work the device had done in four hundred milliseconds.

// WHY index.ts was re-pinned on 2026-11-11 a fourth time: the wait no longer parks a connection.
// The edge function reaches the database through PostgREST, so a wait that held a connection for the whole command filled PostgREST's pool and every later call queued behind it - ten seconds for work the device did in four hundred milliseconds.
// The adaptive wait is now asked in short slices; the capture wait is still asked once, because it consumes its result.

// WHY manifest.json and index.ts were re-pinned on 2026-11-11 a fifth time: the 1.6.43 release bump.
// 1.6.42 to 1.6.43; the icons, the dispatch case and the wait slices are the reviewed parts.

// WHY manifest.json and index.ts were re-pinned a second time on 2026-11-11: the release bump again.
// 1.6.41 to 1.6.42; the icons and the update-dispatch case are the reviewed parts, nothing else moved.

// WHY CRLF does not cause false failures: a Windows checkout rewrites line endings, so the test normalizes CRLF to LF before hashing.
// Otherwise every developer on Windows would see all nine pins fail for a reason that is not a contract change.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'be462c9e32536137c94714185cdee227828538a1'],
  ['../extension/background.js', '8a0ed718b4820f6f2b19907232a667f4ede3d67d'],
  ['../extension/manifest.json', 'c17f1d00e3a4948b81e0515db0f0d42653ae9889'],
  ['../supabase/functions/opera-agent-mcp/index.ts', '256be7a05d150a48660a108354748c7dea1faf36'],
  ['../supabase/functions/opera-agent-mcp/tools.ts', 'a3336416664f49af19507c3e18a45e9871c64087'],
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
