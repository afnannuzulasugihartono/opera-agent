// @last-edited: 2026-10-10 UTC+7.
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
  ['../extension/content.js', '8758adffef45c9aef4ac697dda8554cd31a6cec2'], // pointer cursor: one marker that moves, dims when idle, never intercepts a click; page.read reports userInput; media.play names the foreground path when the autoplay policy refuses; marks documentElement so a page can tell the extension is installed, even before documentElement exists; forwards MAIN-world state-bridge events to the background only after matching this document's origin and admitting the seven type literals the bridge emits, swallowing the worker-sleep rejection via ?.catch; the queued watch check carries the same catch hull so a future edit inside it cannot become an unhandled rejection
  ['../extension/background.js', '59342664c31afbc2d4613b4ebbc4cd3e7101277a'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState with lastInputMs; sense-act loop engine (loop.start/read/stop) with persistent debugger attach; region-clip capture, suspend floor, stillness and track sensors; per-tick sensor activity, values, and phase timings in the trace; native-resolution sense frames; front-edge tracking immune to ground texture; burst hardening — burst fill value regardless of refFromStep, empty tabId refused, SCREENSHOT_TOO_SMALL split out, finishLoop awaits the debugger release, ensureContent re-injects the full manifest script list, external model-key clear refused; facts reply carries engine state, arm-time deadlineMs default, dead set-bridge-url popup action deleted; null deadlineMs normalizes at arm, missing deadline prunes as expired, no-entries reply carries empty state; origin check moved to lib/external-origins.js (strict site match, localhost prefix kept)
  ['../extension/manifest.json', 'a94f3abdd9642df293874a1ebe93f232549b729e'], // entry points, permissions and version. The key is the CRX signing public half, so it changed with the rotation that made the published CRX installable and decides the extension id; externally_connectable gained the official site; the version line moves on every release, which is the one change expected here on its own
  ['../supabase/functions/opera-agent-mcp/index.ts', '5bcb803bb8d041b3942bf3f88024683e88295181'], // the MCP tool surface and schemas: 39 tools, plus the isolation rules that are part of the contract rather than an implementation detail — an empty allowlist admits nobody, since every caller drives the one device, and an unowned X-Opera-Device name is refused with 401 instead of echoed
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'b41529e106a42be6740ed9a37715efb4158b4910'], // reactive VM core; createReactiveVm and advanceReactiveVm had no importer and left with the dead-surface cleanup that unblocked the deploy gate
  ['../lib/reactive-vm-control-flow.js', '7bd3fd275583762f26c2f0adec4263be5503ffa0'], // reactive VM phase C
  ['../lib/reactive-vm-collect.js', '736ccc68acfc9c8e67b642005cdecebe7c3069dd'], // reactive VM phase D without bindCollectionEvidence; unexported helpers stay module-private until the phase is wired
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance.js', 'fe7554b663fbd20d4ae3fed4d90d5efc99d28d9b'], // multi-signal relevance without the unreferenced P3 decision table
  ['../lib/delta-first-observation.js', '534a3bb22b1e661a5799c3798196fcffa4764ae9'], // delta first observation
]);