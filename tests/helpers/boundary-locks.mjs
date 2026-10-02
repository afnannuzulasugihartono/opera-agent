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
// byte-identical â€” proved by tests/r9-public-surface-unchanged.test.mjs, which
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
// gate â€” recorded here because it is the one field in the payload that is
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
// is untouched â€” same 26 primitives, same error branches, same refusal to
// switch tabs inside one shared session â€” so this re-freeze is a behavior fix
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
  ['../extension/content.js', '1cc7b5efeaabaca456a1a1829e87f6aa7b9a8610'], // Re-frozen 2026-10-01: Enterprise Phase 2 Task 7 converts silent catches to logged catches (log.debug for tested fallbacks, log.warn for pure swallows and thrown validation, fallback/throw semantics byte-identical). Additive only; MCP/tool/schema surface unchanged.
  ['../extension/background.js', '655f001e8eadabec821d5d5489decc81c8eca3be'], // Re-frozen 2026-10-01: Enterprise Phase 2 Task 6 converts silent catches to logged catches (log.debug/log.warn, fallback semantics byte-identical). Additive only; MCP/tool/schema surface unchanged. Re-frozen 2026-10-02: Enterprise Phase 5 Task 1 moves DEFAULT_BRIDGE_URL to extension/lib/endpoints.js (single endpoint source per deploy unit; import plus literal removal only), served behavior unchanged. Re-frozen 2026-10-02: Enterprise Phase 5 Task 3 wires the stored log level through getConfig (STORAGE_KEYS gains logLevel; guarded OperaAgentLog.configure with a safe 'warn' fallback that never throws) and extends the onChanged restart condition. Additive only; MCP/tool/schema surface unchanged. Re-frozen 2026-10-02: comment-only correction in getConfig. The stored log level always falls back to the literal 'warn' (the default level), never to a previously applied threshold; the preceding comment said 'the current threshold', which misdescribed the code. Zero executable-byte change: the guarded configure statement, the returned logLevel, and every call site are untouched, so this is not a behavior change. Re-frozen 2026-10-02 (Phase B Task 2): repairs three lifecycle defects with no protocol change. (1) The watch-fired trusted click built a shared `debuggerSession` but had no release, so one ad-overlay click left the debugger attached and Chrome's 'started debugging this browser' bar stuck on that tab; it now releases in a finally, the same way runBurst already did, through one shared helper. (2) Nothing listened to `chrome.debugger.onDetach`, so a cached `attached: true` outlived the debugger whenever the user opened DevTools on the tab or the tab closed, and every later CDP call in that session failed against a dead debugger; a listener now invalidates the session through a module-level registry. (3) Both `Promise.race` timeout sites in `executeCommand` leaked their timer, and a pending timer is one of the things that keeps an MV3 service worker alive; they now go through `raceWithTimeout`, which clears in a finally. Public surface unchanged: METHOD_SPECS still lists 26 primitives, no MCP source or manifest change, the command error branches (TARGET_NOT_READY, COMMAND_TIMEOUT with outcome 'unknown') are untouched, commandTimeoutError is still what rejects, and withDebugger still refuses to switch tabs inside one shared session. Re-frozen 2026-10-03 (audit repair): runBurst now refuses a refFromStep consumed on any tab other than the source step's recorded tab, not only when the consuming step itself switches (the old `switched &&` gate missed consume-on-already-active-tab). New pure helper burstCrossTabRef in protocol.js, pinned behaviorally in both directions; same BURST_CROSS_TAB_REF code and message, same 26 primitives, no new action. Re-frozen 2026-10-03 (short-window pull): pullOnce sends waitMs 5000 with a 10000ms fetch timeout instead of 12000/15000. Boundary-probed from the client network: 5s waits succeed (~5.9s total) while 12s waits die at ~8.7-9.8s with the rpc throwing (bridge 500), although the same 12s wait runs 12.4s clean via direct SQL -- so an ~8s kill lives on the edge-to-DB path (pooler/query timeout layer; `authenticated` carries statement_timeout=8s, exact layer unconfirmed from here). Every idle 12s pull died while busy pulls returned early, which is exactly a permanently yellow badge with working commands. Idle cost rises to one trip per 5s; worst-case claim latency falls to ~5s. Re-frozen 2026-10-03 (optimistic contentCall): the command goes out first (1 IPC instead of tabs.get + ping + send); ensureContent runs only on transport failure, and a page-bridge refusal still throws without re-injection. Missing-script path costs one extra send; chrome:// guard message unchanged. Re-frozen 2026-10-03 (navigate step): runBurst refuses BURST_STALE_REF when a ref is consumed after a navigate on the same tab, via pure helper burstStaleRef pinned both ways; still 26 primitives (navigate composes the existing tabs.navigate, it is a new burst action, not a new primitive).
  ['../extension/manifest.json', '10fdf5fb4e6588812795456ca30681f02b3a2ac8'], // Re-frozen 2026-10-01: Enterprise Phase 2 Task 5 prepends lib/agent-log.js to content_scripts js (manifest-first load for classic content scripts). No permission or surface change. Re-frozen 2026-10-02: Enterprise Phase 5 Task 3 registers options_page (options.html) beside the action block. No permission or surface change. Re-frozen 2026-10-03 (1.6.14 sweep): manifest version 1.6.13->1.6.14 only; key, permissions, and entry points untouched.
  ['../supabase/functions/opera-agent-mcp/index.ts', 'a53e618e70a2da5afe91837f3b9fd1c59be49d84'], // Re-frozen 2026-10-02: Enterprise Phase 4 Task 2 wires fail-closed CORS (per-request ACAO via the shared resolver; Allow-Headers/Methods/Expose-Headers/Cache-Control unchanged), served MCP contract unchanged. Re-frozen 2026-10-02 (Phase C): three defects on the AI-facing surface. (1) The command path waited on `opera_await`, whose flat 50ms sleep was the coarser of the two available waits, while the gateway already used `opera_await_adaptive`; the two share a signature and a response envelope including the same timing fields, so this is a latency swap with no contract change. page.capture still uses `opera_await_capture`, which scrubs the stored screenshot. (2) `wait_events` declared a `timeoutMs` its handler never destructured, so a model setting it saw no effect; it is now honoured and takes precedence over the retained `waitMs` alias. (3) `wait_events` declared the command envelope {ok, commandId, status, result, timing} while `opera_watch_events_wait` returns {ok, events, cursor, count}; the schema now matches the SQL, with the event shape pinned to the five columns the function selects. The 4.5 KB instructions now name start_watch, wait_events and run_workflow, which existed to remove model round trips but were never mentioned, while three emphatic passages went to burst instead. Tool count stays 22 and no tool was added, removed or renamed. Re-frozen 2026-10-03 (audit repair): every burstStepSchema object gains optional tabId, because the extension executes per-step tabId while the .strict() schema rejected it, making Phase D cross-tab unreachable from the public tool. Additive and backward compatible: every previously valid call still validates. The run_browser_burst description now states per-step tabs and the ref tab scope. Re-frozen 2026-10-03 (navigate step): burstStepSchema gains the navigate kind (strict, optional tabId, http/https url); description drops navigate from the cannot-list and states the ref-invalidation rule.
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
