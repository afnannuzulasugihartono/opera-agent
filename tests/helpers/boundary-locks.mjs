// @last-edited: 2026-11-13 UTC+7.
// @title: boundary-locks - the frozen locks on the public boundary, shared by the checkpoint tests.
// @state: ten pins over four stacks; each line says why the current pin exists, and nothing else.
// @dependencies: none.

// Each entry is the git-blob SHA-256 (LF-normalized) of a runtime source whose public contract is frozen.
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
// The icon is the site icon, drawn by scripts/dev/draw-icon.py from the same path the website uses; nothing else in the manifest moved.

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

// WHY these two were re-pinned on 2026-11-12: the 1.6.47 alignment and tool merge.
// The version constants moved (manifest.json `version`, index.ts `SERVER_VERSION`), and tools.ts carries the merged read_page (view: brief|map) in place of read_page + read_page_map; nothing about the public contract moved except the numbers and the tool count.

// WHY these two were re-pinned on 2026-11-12: the 1.6.46 alignment.
// The version constants moved (manifest.json `version` and index.ts `SERVER_VERSION`); nothing about the public contract moved.
// Any other diff in either file would have broken this before it got this far.

// WHY tools.ts was re-pinned on 2026-11-13 a second time: the dump_page executor forgot one parameter.
// The dump_page tool's handler called execute("page.dump", { offset, limit }) without tabId, so the relay silently dispatched the read to the tab the extension was currently active on instead of the requested tab.
// The pin moves with the reviewed one-line fix; the artifact hash moves before the reader sees a tab the user never asked for.
// dump_page reads a whole page as one structured object; save_page is the silent rename of scan_page, writing straight to Downloads without any user confirmation dialog.
// The surface review moved with the tools by design.

// WHY these four were re-pinned on 2026-11-12: the surface gained the two tools that go beyond stills, on purpose.
// The device now mirrors a page into one self-contained html file in Downloads (page.scan, for reading or rebuilding a site offline instead of hand-transcribing it), and it records the tab to a webm in Downloads while the page smooth-scrolls from the top to the bottom (page.record, the honest way to see features and animations a screenshot cannot).
// The dispatch cases, the tool schemas, the executors that shape the two results, and the content script list the manifest injects are the reviewed changes; content.js did not move, and the recording lives in its own content module with its own scope, not in the pinned file.

// WHY these four moved again on 2026-11-12: the recording is now an arm/stop session, not one fixed scroll.
// The agent asked for the recording to capture whatever happens between arm and stop - clicks, fills, scrolls, bursts - so the surface carries page.record_start and page.record_stop instead of page.record; the tools.ts schemas, the index.ts executors and the dispatch switch moved with it, on purpose.

// WHY these two were re-pinned on 2026-11-13: the agent gained one more read-only primitive.
// background.js imports dump-page.js and dispatches page.dump so the agent can read a whole page as one structured object instead of one viewport; the public contract gained exactly that method and nothing else moved.

// WHY these three were re-pinned on 2026-11-12: the 1.6.48 provider pins and the version constants.
// The relay gained per-provider routing (`resolveDeviceFresh` reads `opera_provider_pins` when no X-Opera-Device header names a browser; index.ts) and the switch_device tool (tools.ts), so a multi-harness account can bind opencode to one browser and claude to another without editing client configs.
// The refusal for a sleeping provider pin names switch_device; the browser_status device object reports pinSource.
// manifest.json and index.ts also carry the version bump to 1.6.48; the contract moved, so the pin moves with it - content.js and background.js did not.

// WHY these ten moved on 2026-11-12 a fourth time: the hash is now SHA-256.
// The pinning protocol used a weak hash (git-blob SHA1); the finding is a critical vulnerability for any consumer of the convention, and the answer is a stronger digest, not a waiver.
// The contract criterion did not change; the digest got stronger, so every pin below was recomputed in the same act.

// WHY these three were re-pinned on 2026-11-12: the 1.6.49 release rode them.
// The version constants moved (manifest.json version, index.ts SERVER_VERSION); nothing about the public contract moved with them.

// WHY these three were re-pinned on 2026-11-12: the 1.6.50 release rode them.
// The version constants moved (manifest.json version, index.ts SERVER_VERSION); nothing about the public contract moved with them.

// WHY these two were re-pinned on 2026-11-13: the surface gained search_bing, and it gained it as a workflow over the primitives, not as a new one.
// The relay opens one background tab on the Bing SERP, reads up to three result pages with page.dump following Bing's own pagination links, zips the external anchors into rank, title, url, site and the snippet each card renders, dedupes across pages and closes the tab.
// The extension gained nothing: tabs.open, tabs.navigate, page.dump and tabs.close are the whole road, so the 36-method protocol and its pins above did not move.
// The local stdio road carries the same tool over its own tab broker, reading the one parser (shared/bing-serp.js), generated into the package by scripts/pack/pack-mcp.mjs and never committed.
// The evaluator that walks the SERP lives in local/page-expressions.js; the tools.ts schema and the tools.ts registration moved with it.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'fd75fc8ba524c201294b4919603fb478400865039f46d5a00730b0f1b937ecb3'],
  ['../extension/background.js', 'c222723151c856e0051b67ac8b489d97096ed6605da080fff1c8bb859a05fe01'],
  ['../extension/manifest.json', 'aaad334ded5c8febe60127a01b8ccfeddb5e0f191f42800a1567b1c9ec6fc84e'],
  ['../hosted/functions/opera-agent-mcp/index.ts', '1bc26ba242eae2bca8ddaed4ee9f574e0274b44046aa770f7ae4fe0539e5e0a6'],
  ['../hosted/functions/opera-agent-mcp/tools.ts', '7581260b1d9c89d556566e3fefe5105e8e6f57187548c6679708478725b8396d'],
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../shared/reactive-vm.ts', '7d15b2764ef9eb8f9929d0e6095d6f8fa1442898678b563d00852f7dc3b74d06'],
  ['../shared/reactive-vm-control-flow.ts', 'a24a0d2e0574b9f8105c1085b66d92a17ede5e2e26d8ad76266364045695d708'],
  ['../shared/reactive-vm-collect.ts', '57a3687f9ed630cf95bb60856647eb4f97207bcca92161bd77c48da9cb7d6da8'],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../shared/multi-signal-relevance.ts', '05c95a51a4d6f9d7fafc877977a0bec7de518dc8eabf63591ddbe2d13260e85c'],
  ['../shared/delta-first-observation.ts', '3d053f319619fee9839981dc14228d775ff528390030cb1b3804f5fc74bcdc2a'],
]);
