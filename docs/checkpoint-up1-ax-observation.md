# Checkpoint U-P1 — AX-Tree Observation (2026-09-24)

Related: [AGENTS.md](../AGENTS.md) - [delta-first-performance-plan.md](delta-first-performance-plan.md)

Implements the flagship P-class method from the 2026-09-20 research matrix
(`docs/research/perception-identity-verification-2026-09-20.md`, method P1),
under the user's 2026-09-24 "faster and easier for AI (ChatGPT web)" request.
Goal: the model can see and act on state that plain DOM text never carried —
shadow-DOM controls, icon-only controls, and canvas-class surfaces — with
zero new public tools.

## Scope

- **Layer A — pure-DOM accessibility layer (always on, no debugger).**
  `extension/content.js`:
  - `collectInteractiveNodes()` replaces the flat
    `document.querySelectorAll(INTERACTIVE_SELECTOR)` scans in
    `semanticRegionObservation`, `pageFind` (both the entry scan and the fuzzy
    rescan), `findVisibleTextCandidate`, and `page.wait_for`'s text polling.
    The walk pierces **open** shadow roots only, bounded by
    `MAX_SHADOW_ROOTS 120` / `MAX_COLLECTED_NODES 600`; closed roots stay
    invisible (fail closed).
  - `computeAccessibleName(el)`: the existing `getAssociatedLabel` accname
    subset (aria-label, aria-labelledby, label, title, placeholder) plus
    descendant `img[alt]` and `svg title` (bounded 5/10 parts) — the icon
    vocabulary that fixes the Maps-class glyph-label finding
    (`" 3 min"` buttons).
  - `serialize()` attaches `accessibleName` **only when it adds signal** the
    label/text fields do not already carry; `pageFind` matches it alongside
    label/text/placeholder; `page.wait_for` text polls include it;
    `compactElementProjection` projects it.
  - `hitTestReachable` accepts shadow-host hits through
    `composedHostChain`/`hitTestAcceptable` (probe evidence:
    `document.elementFromPoint` retargets at open shadow boundaries and
    returns the host, so without this acceptance shadow controls could never
    pass the clipping-escape hit test).
  - Rebind pools (`signatureRebindCandidates`, `revalidationCandidates`) are
    deliberately unchanged (flat light-DOM pools): stale-ref rebind authority
    for shadow-originated elements remains fail-closed. Recorded non-goal.
- **Layer B — poverty-triggered CDP accessibility snapshot (read-only).**
  `extension/lib/ax-summary.js` (pure, node-testable) +
  `extension/background.js`:
  - When `page.read` observes `totalTextChars <= 400`
    (`AX_SUMMARY_TEXT_POVERTY_CHARS`), background collects
    `Accessibility.getFullAXTree` once through the existing bounded
    `withDebugger` session, filters it with `buildAxSummary`, and attaches
    `page.axSummary = { source: 'cdp-ax', note, items: [{role, name}] }`.
  - Filter invariants (regression-locked): AX `value` fields are dropped
    unconditionally (CDP exposes unmasked input values); editable roles
    (textbox/searchbox/spinbutton/combobox/entry) and **all their descendants**
    are excluded via a memoized `parentId`-chain closure (CDP mirrors editable
    values as child StaticText names); `InlineTextBox` pseudo-nodes, ignored
    nodes, `RootWebArea`, and unnamed generic nodes are dropped; entries are
    deduped on `role|name`, names capped at 200 chars, list capped at 60.
  - Entries are read-only facts: no `backendDOMNodeId`, no geometry, no
    actionable refs. Every collection failure fails open (no `axSummary`,
    observation unchanged). Rich pages never pay the debugger round trip.
- **MCP guidance only** (`supabase/functions/opera-agent-mcp/index.ts`):
  `read_page` description + server instructions document `accessibleName`
  matching and the `axSummary` snapshot. **No new tool, no schema input
  change**: Protocol 1, 26 browser primitives, 22 public MCP tools, and the
  frozen `read_page` input schema are unchanged (locked by existing tests).
- Version bumped to **1.6.11** (manifest, PRODUCT_VERSION, package.json,
  check.mjs, 7 test version pins, 2 Python harness asserts).

## Probe evidence (Chromium/Edge CDP, 2026-09-24, recorded in-session)

- `Accessibility.getFullAXTree` node shape: `role.value`, `name.value`,
  `ignored`, `backendDOMNodeId`; **no bounds**; `value` present on editable
  nodes (unmasked for non-password inputs, bullets for passwords); text in
  visually-hidden clip containers appears as `StaticText`; `InlineTextBox`
  pseudo-nodes duplicate text without DOM backing.
- `document.elementFromPoint` inside an open shadow root returns the **host**
  element; shadow-descendant text never appears in `document.body.innerText`.

## Evidence

- Tests-first: `tests/ax-observation.test.mjs` written red first
  (module/contract failures), then green: 9/9. Fixture node shapes are the
  probe-recorded CDP output; value-leak, password, dedupe, cap, and
  role/name-only assertions are executable, not regex.
- Node suite: **499/499 PASS** (0 fail, 0 skipped).
- `npm run check`: PASS — 26 allowlisted primitives, 75 runtime safety files,
  version 1.6.11 (the new `extension/lib/ax-summary.js` is auto-discovered).
- Browser regression (Edge headless, real relay path): **EXIT 0** — the six
  new `up1.*` benchmarks executed and passed: shadow control found by label
  and clicked through its ref (`SavedByShadow` verified in page text),
  icon-only control found by `accessibleName`
  (`Motorcycle, 3 minutes`), poor-page read attaches
  `axSummary` containing `('StaticText', 'Canvas layer Cat uploaded')`,
  `('button', 'Shadow save control')`, `('application', 'Design board')`,
  the editable-field value (`typed secret text`) and password content
  (`hunter2`) absent from the entire serialized result, and the text-rich
  main page read attaches **no** `axSummary` (fast path unchanged).
- Rebaselines with recorded reason (U-P1 comment in each lock test):
  delta P2/P3/P4/P5 blob locks → content.js `0ea3094…`, background.js
  `bdeac6af…`, manifest.json `757191f0…`, MCP index.ts `5fc059f2…`
  (git blob hashes, `git hash-object`). Derived MCP digest chain updated:
  `mcp-contract-v1.json` sourceSha256
  `5da5f3cef258b7b2b9da905351e233af56466bb85832f77ef6460bb7fec3cf1c`;
  inventory digest
  `sha256:f672f8ddbaeeefd3abe1a8ff855a7d07d795119379a72cb31e24d4e23705ad4c`
  across reactive-vm-contract/thresholds, transaction-contract/thresholds,
  goal-ledger-thresholds, and the reactive-vm-7f literal.

## Non-goals (recorded)

- No AX-entry → DOM-handle resolution: `axSummary` entries are not
  actionable/clickable refs (actions still require a real serialized element
  with a ref, including shadow-descended ones found by Layer A).
- No geometry/bounds on AX entries (CDP AX nodes carry none without per-node
  DOM queries; read-only state is the v1 value).
- No U-P2 vision sampling, no U-P3 stale pruning (separate proposed
  checkpoints), no shadow-DOM rebind pools, no media MCP exposure (F5/8E
  decision), no public schema/protocol/primitive change.
- No production deploy of the MCP edge function, no CRX build/upload/
  activation — the owner gates release steps.

## Fast/easy impact (measured or structural)

- One-command icon-control targeting: `page.find "Motorcycle"` now resolves
  what previously returned zero (field evidence: Maps glyph buttons) —
  removes the capture/re-read fallback loop.
- Shadow-DOM controls (modern component stacks) enter the same
  find/read/wait observation the model already uses; no new tool vocabulary.
- Canvas-class pages (Figma/Miro/Docs-style hidden mirrors) return readable
  state in the same `read_page` call — removes the blind
  "screenshot succeeds but read_page.text is empty" state.
- Zero cost on rich pages: the CDP path fires only under text poverty, and
  the always-on Layer A is pure DOM with bounds proportional to the existing
  observation walk.
