// Frozen public-boundary locks shared by the P2/P3/P4/P5 checkpoint tests.
// Each entry is the git-blob SHA1 (LF-normalized) of a runtime source whose
// public contract is frozen: U-P1 (2026-09-24) authorizes the accessibility
// observation layer: shadow-piercing collection + computed accessible names in
// content.js, the poverty-triggered CDP axSummary in background.js, MCP
// guidance text, and the 1.6.13 version sweep. U-R (2026-09-28) then authorizes
// timeout/retry/popup parity: an unknown-outcome command timeout in
// background.js, expect-polling and fill retry parity in content.js, the
// popup/openedTabs log, MCP OAuth/openedTabs guidance, and the 1.6.13 version
// sweep. U-Sonar (2026-09-29) authorizes the new-code reliability sweep:
// explicit code-unit sort comparators (order byte-identical, frozen digests
// unchanged) and the ZWJ split in the content.js PUA strip class (same
// code-point set), while the byte-pinned 8D transaction bundle libs and the
// boundary-locked reactive-vm-7d then-field stay byte-identical (false-positive,
// resolved in Sonar). R9-A/R9-B (2026-09-30) then authorize complex-application
// control: the foreground focus gate moves from a single racing pre-flight
// sample to a bounded at-dispatch re-check inside the debugger session, and the
// trusted key path resolves modifier chords and bounded text instead of a flat
// 12-entry table. The content.js synthetic key path stays unmodified-key only
// and refuses chords explicitly rather than keeping a second, drifting copy of
// the allowlist. Both changes are additive and backward compatible. The MCP
// source stays byte-identical in this checkpoint: the public MCP contract
// (22 tools, the read_page schema, and the whole-file digest in
// mcp-contract-v1.json) is deliberately NOT changed here, so exposing the new
// keyboard surface publicly remains a separately reviewed decision. R9-G
// (2026-09-30) then authorizes an INSTRUCTIONS-ONLY MCP edit: menu and dialog
// work is batched into one burst via refFromStep, and the model is told to click
// an editor surface before sending a key and to verify the keystroke landed. No
// tool was added, removed, or renamed, and every per-tool inputSchema is
// byte-identical ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â proved by tests/mcp-surface.test.mjs section B, which
// pins each schema block individually because the whole-file digest alone
// cannot distinguish an instructions edit from a schema edit. The chords and
// bounded text entry built in R9-B remain runtime-only: press_key still
// validates against the 12-key navigationKeySchema and the burst key step is
// still .strict(), so the instructions explicitly tell the model those chords
// are not available yet rather than advertising calls the schema would reject.
// R9-C (2026-09-30) then authorizes role reconciliation: `serialize` now derives
// the role the platform reports from an element's own markup, because reading
// the literal `role` attribute meant an unannotated <button> was reported as
// role '' and invisible to a role-filtered find_elements; and the existing
// bounded text-poor AX round trip now also fills roles the markup does not
// carry, so a custom control the platform reports as a radio is discoverable.
// The shared helpers live in extension/role-reconcile.js, a classic content
// script that background.js side-effect imports, so there is one role table
// rather than two. Reconciliation is read-only: it never mints, moves, or
// invalidates a ref, an explicit DOM role always wins, an ambiguous AX name is
// never adopted, and sensitive elements are never annotated. stableElementIdentity
// deliberately keeps the raw attribute, because deriving a role there would
// change every stableKey in the product. R9-B public (2026-09-30) then
// authorizes the keyboard surface: press_key and the burst key step gain
// OPTIONAL `modifiers` and `text`, the key enum grows to a fixed 79-entry
// vocabulary, and the R9-G placeholder sentence is replaced with real chord
// guidance. This is the commit that makes the R9-B runtime capability reachable
// from a public tool instead of dormant behind the schema. Additive and
// backward compatible: every previously valid call still validates, the tool
// count and all 22 names are unchanged, and the sensitive-field guard is
// untouched. R9-E (2026-09-30) then authorizes hover as a burst step: a new
// `hover` step in burstStepSchema moves the trusted pointer onto a resolved ref
// and settles on the reveal, so a multi-level menu is one step per level instead
// of a hand-built hover/wait chain. `page.hover` is burst-internal and is NOT a
// 27th primitive. A hover never clicks, goes through the same foreground focus
// gate as every other pointer input, and its in-page settle returns a presence
// boolean rather than document text. R9-D (2026-09-30) then makes ref recovery
// cheap WITHOUT touching the safety guard: the mint-time 24px geometry
// tolerance is unchanged and still unbroadened, and a moved successor is still
// refused, but the refusal now hands back fresh refs for candidates that already
// passed uniqueness, intrinsic identity, actionability, and the non-sensitive
// check, so the model no longer needs a whole extra page.find just to obtain a
// usable ref. The instructions say to act on those directly and never to widen
// the tolerance. The candidate payload KEEPS its rectangle: the Chromium
// regression suite asserts on candidate coordinates, and dropping it broke that
// gate ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â recorded here because it is the one field in the payload that is
// load-bearing for a test rather than for the model. R9 hygiene then fixes three
// defects the R9 code itself introduced: page.read serialized its result twice
// (once to check the ceiling, once in the dispatcher) on the hottest
// observation path, now a per-command memoized single serialization; the
// foreground gate loop was a conditionless for(;;) and is now bounded by
// construction; and the runtimes published on globalThis are frozen.
// Note that Object.freeze does NOT make a Set immutable, so GENERIC_ROLES is
// published as a frozen array.
// Protocol 1, 26 primitives, 22 tools, and the read_page input schema remain
// frozen. Phase B Task 2 (2026-10-02) then authorizes the debugger/timer
// lifecycle repair in background.js: the watch-fired trusted click gains the
// release that runBurst already had, a `chrome.debugger.onDetach` listener
// invalidates a session Chrome ended on its own, and both `executeCommand`
// timeout races go through a helper that clears its timer. The protocol surface
// is untouched ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â same 26 primitives, same error branches, same refusal to
// switch tabs inside one shared session ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â so this re-freeze is a behavior fix
// within the existing contract rather than a contract change.
// Phase C (2026-10-02) then authorizes the MCP round-trip fixes: the command
// path moves onto the adaptive await ramp the gateway already used, the 4.5 KB
// AI-facing instructions finally name the three watch and workflow tools that
// exist to remove model round trips, and wait_events stops declaring both a
// schema and a timeoutMs it did not honour. The tool inventory is unchanged at
// 22: nothing added, removed or renamed, so this too is a behavior fix inside
// the existing contract.
// Phase D (2026-10-02) then authorizes per-step tab targeting in a burst: the
// active tab moves only when a step supplies one, the debugger session is
// released and re-keyed on attach instead of refused outright, every step
// reports the tab it ran on with switchedTab set when it differs from the burst
// tab, and a step that switches tab while holding a refFromStep is refused
// because a ref is a live handle into one document. The protocol surface is
// still 26 primitives with no new action, and navigate is still not one.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', 'a91edfebdeb5d4c00975ac68d09ad69e4503a825'], // pointer cursor: one reused marker, moves, clears after 2.5s idle
  ['../extension/background.js', '67bb3e43bcb7a241722d1c560415d41b99491774'], // tab mutations retry Chrome drag refusals; showCursor:true shows the cursor in background; page.read reports userState
  ['../extension/manifest.json', '9088703db3facf9ad69dd134d6b9b79b99020304'], // entry points, permissions, version
  ['../supabase/functions/opera-agent-mcp/index.ts', 'a53e618e70a2da5afe91837f3b9fd1c59be49d84'], // MCP tool surface and schemas
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  // Re-frozen 2026-10-03 (dead-export elimination): `replayReactiveVm` removed.
  // It was declared once and reached by nothing -- not the edge function, not
  // the tests, not the module itself -- so it was unreachable surface rather
  // than a contract. `REACTIVE_VM_7B_LIMITS` lost only its `export` keyword; it
  // is still used by three budget checks inside this file. No evaluator, digest,
  // status or error code changed; every remaining export is byte-identical.
  ['../lib/reactive-vm.js', 'ecc3559d2d0ae98d681ce0df6fc365123c646052'], // reactive VM core
  // Re-frozen 2026-10-03 (dead-export elimination): `replayReactiveVm7C`
  // removed. Declared once, reached by nothing, 11 lines of wrapper around
  // createReactiveVm7C/advanceReactiveVm7C that no caller ever used. No
  // evaluator, digest, status or error code changed.
  ['../lib/reactive-vm-7c.js', '212b324840fa347bf058cfaee8fad8cc9f80efc2'], // reactive VM phase C
  // Re-frozen 2026-10-03 (dead-export elimination): `replayReactiveVm7D` and
  // `canonicalCollectionDigest7D` removed, both declared once and reached by
  // nothing. Every other 7D export -- including the collection, dedup and
  // binding surface the P4/P5 stacks depend on -- is byte-identical.
  ['../lib/reactive-vm-7d.js', 'e0fb0e1119410c467bad89984fd894af2e29cb23'], // reactive VM phase D
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', '97ef64a69a1e77d1617c426cbb38407145b6327f'], // multi-signal relevance
  ['../lib/delta-first-observation-p2.js', '5335e1d09a8b8357a2fb20ecb30f1908c3c7d7e3'], // delta first observation
]);
