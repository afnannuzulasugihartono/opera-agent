# AX-tree observation

Simplify first. State what is true now, never its history.

Related: [AGENTS.md](../AGENTS.md) - [delta-first-performance-plan.md](delta-first-performance-plan.md) - [extension/README.md](../extension/README.md)

Lets the model see and act on state plain DOM text never carried: shadow-DOM controls,
icon-only controls, and canvas-class surfaces. No new public tool.

## Layer A: pure DOM, always on

In `[extension/content.js](../extension/content.js)`. No debugger, bounded, runs on every read.

- `collectInteractiveNodes()` replaces the flat `querySelectorAll` scans in the region
  observation, `pageFind`, `findVisibleTextCandidate`, and `page.wait_for` polling.
- It pierces **open** shadow roots only, bounded by `MAX_SHADOW_ROOTS 120` and
  `MAX_COLLECTED_NODES 600`. Closed roots stay invisible: fail closed.
- `computeAccessibleName(el)` adds descendant `img[alt]` and `svg title` to the label
  subset. That is what makes a Maps glyph button reading `" 3 min"` findable.
- `serialize()` attaches `accessibleName` only when it adds signal the label and text
  do not already carry. `pageFind` and `page.wait_for` match on it.
- `hitTestReachable` accepts shadow-host hits, because `document.elementFromPoint`
  retargets at an open shadow boundary and returns the host.
- Rebind pools stay flat and light-DOM only. Stale-ref rebind authority for
  shadow-originated elements remains fail-closed.

## Layer B: poverty-triggered CDP snapshot, read-only

`[extension/lib/ax-summary.js](../extension/lib/ax-summary.js)`, called from `[extension/background.js](../extension/background.js)`.

- Fires only when `page.read` sees `totalTextChars <= 400`, or the elements carry no
  real role. A text-rich page never pays the debugger round trip.
- Collects `Accessibility.getFullAXTree` once through the bounded session and attaches
  `page.axSummary = { source, note, items: [{ role, name }] }`.
- **A named `generic` node is kept.** Maps and YouTube label their controls `generic`,
  and skipping the role outright discarded the only named thing those pages expose.
  Measured after the fix: Maps went from 89 characters and no named controls to 60
  named nodes including `Hasil untuk rest`; YouTube from nothing to 24 including
  `link:Home`. Unnamed generics still drop out at the empty-name check.

### Filter invariants

- AX `value` fields are dropped unconditionally; CDP exposes unmasked input values.
- Editable roles and **all their descendants** are excluded via a memoized
  `parentId` closure, because CDP mirrors editable values as child StaticText names.
- `InlineTextBox` pseudo-nodes, ignored nodes, `RootWebArea`, and unnamed nodes drop.
- Entries dedupe on `role|name`; names cap at 200 characters, the list at 60.
- Entries are read-only facts: no `backendDOMNodeId`, no geometry, no refs. They
  cannot be clicked. Actions still need a real serialized element.
- Every collection failure fails open: no `axSummary`, observation unchanged.

## MCP guidance

`read_page` description and the server instructions document `accessibleName` matching
and the snapshot. No new tool and no schema change: Protocol 1, 26 primitives, 22 MCP
tools.

## Non-goals

- No AX-entry to DOM-handle resolution.
- No geometry on AX entries; CDP AX nodes carry none without per-node DOM queries.
- No shadow-DOM rebind pools, no media MCP exposure.

## Evidence

- `[tests/ax-observation.test.mjs](../tests/ax-observation.test.mjs)` locks the invariants above: 9/9, executable
  assertions rather than regex.
- Browser regression exercises a shadow control found by label and clicked through its
  ref, an icon-only control found by `accessibleName`, a poor-page read carrying an
  `axSummary`, an editable field's typed value and password absent from the entire
  serialized result, and a text-rich read attaching no `axSummary` at all.
