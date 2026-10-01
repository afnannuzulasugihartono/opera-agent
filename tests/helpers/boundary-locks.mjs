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
// byte-identical — proved by tests/r9-public-surface-unchanged.test.mjs, which
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
// gate — recorded here because it is the one field in the payload that is
// load-bearing for a test rather than for the model. R9 hygiene then fixes three
// defects the R9 code itself introduced: page.read serialized its result twice
// (once to check the ceiling, once in the dispatcher) on the hottest
// observation path, now a per-command memoized single serialization; the
// foreground gate loop was a conditionless for(;;) and is now bounded by
// construction; and the runtimes published on globalThis are frozen.
// Note that Object.freeze does NOT make a Set immutable, so GENERIC_ROLES is
// published as a frozen array.
// Protocol 1, 26 primitives, 22 tools, and the read_page input schema remain
// frozen.

export const PUBLIC_SURFACE_LOCKS = Object.freeze([
  ['../extension/content.js', '1cc7b5efeaabaca456a1a1829e87f6aa7b9a8610'], // Re-frozen 2026-10-01: Enterprise Phase 2 Task 7 converts silent catches to logged catches (log.debug for tested fallbacks, log.warn for pure swallows and thrown validation, fallback/throw semantics byte-identical). Additive only; MCP/tool/schema surface unchanged.
  ['../extension/background.js', 'cbf7cc22115f47227df026472a67c802082a1697'], // Re-frozen 2026-10-01: Enterprise Phase 2 Task 6 converts silent catches to logged catches (log.debug/log.warn, fallback semantics byte-identical). Additive only; MCP/tool/schema surface unchanged.
  ['../extension/manifest.json', 'cd7c1e67af1bc9d791ef3b6eb4b118cfc4169798'], // Re-frozen 2026-10-01: Enterprise Phase 2 Task 5 prepends lib/agent-log.js to content_scripts js (manifest-first load for classic content scripts). No permission or surface change.
  ['../supabase/functions/opera-agent-mcp/index.ts', 'ccddcd457b4a89d1b4d9e2871d7539e1c6605d3a'], // Re-frozen 2026-10-02: pinned jsr edge-runtime import version (line 1 only), served contract unchanged.
]);

export const OBSERVATION_STACK_LOCKS = Object.freeze([
  ['../lib/reactive-vm.js', 'e035d282b642c7fb0dfe687e034ec200072da991'],
  ['../lib/reactive-vm-7c.js', '2e5f63f2c5d7c0ee2341c5a88a407783ae4523f4'],
  ['../lib/reactive-vm-7d.js', 'f08445f142d001aeb45b40a4d1a77fd6d2c7b6c8'],
]);

export const RELEVANCE_STACK_LOCKS = Object.freeze([
  ['../lib/multi-signal-relevance-p3.js', '97ef64a69a1e77d1617c426cbb38407145b6327f'],
  ['../lib/delta-first-observation-p2.js', '5335e1d09a8b8357a2fb20ecb30f1908c3c7d7e3'],
]);
