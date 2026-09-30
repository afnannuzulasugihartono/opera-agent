# Pre-8E performance/usability R9 — complex-application control track

Date: 2026-09-30

Status: **R9-A and R9-B IMPLEMENTED AND VERIFIED in the extension + protocol
layer. The public MCP surface half is deliberately NOT done and is handed back
as an owner decision.** Implementation record and the reasoning:
`docs/pre-8e-performance-usability-r9-evidence.md`.

Sections 1-5 below are the original assessment and proposed plan, written before
implementation. Where the plan and the delivered work differ, the evidence record
is authoritative.

Scope of the assessment: a live operator test of Opera Agent against Google
Docs (long-document editing, `Insert > Page elements > Page numbers > More
options`, the Page numbers dialog) on 2026-09-30, compared against the operator's
own Playwright usage. Ordinary browsing (Stanford HAI, MDPI, UNESCO, NIST),
tab management, reading, and simple click/form flows were reported as smooth.
The friction was concentrated in canvas-class editors, hover-revealed submenus,
custom dialog controls, and focus stability.

## 1. What the operator reported, mapped to code

Each row is an operator observation plus the code path that produced it. Line
references are the state at head `5ffa75e` (release 1.6.13).

| Operator observation | Code path today | Nature of the limit |
| --- | --- | --- |
| `FOREGROUND_REQUIRED` returned even though the tab had just been activated and reported `active: true` | `extension/background.js:637-648` `trustedPointer()` | Focus is sampled once, before the input is dispatched, and never re-checked. Foreground mode deliberately runs **without** `Emulation.setFocusEmulationEnabled` (only background mode enables it, `background.js:446-461`), so a window that loses focus between the check and the dispatch fails with no recovery. There is no `Page.bringToFront`, no re-sample, no bounded retry. |
| A ref valid at find time died with `TARGET_NOT_READY` when the menu re-rendered | `extension/content.js:216-257` `resolveActionRef()` | Rebind exists but fails closed on two independent conditions: the replacement pool must be **exactly one** candidate, and the candidate must sit within `GEOMETRY_DRIFT_TOLERANCE_PX = 24` of the mint-time rectangle (`content.js:118`). A menu that re-renders at a new scroll/anchor position produces a unique-but-moved successor, which is refused by design. The model must then re-find. |
| Submenu required a manual hover burst (`Insert` -> hover `Page elements` -> wait `Page numbers` -> hover -> wait `More options`) | `extension/background.js:637-712` `trustedPointer()`, `extension/lib/protocol.js:25` burst `pointer`/`wait` steps | `page.pointer` supports `move`, and `page.wait_for` supports text, so a burst can express the chain. What is missing is any primitive that models *hover-then-settle* as one step: no dwell, no `aria-expanded`/submenu-aware wait, and `pointerTarget` (`content.js:1251-1280`) hard-rejects coordinates outside the viewport. |
| Dialog text was readable (`Position`, `Header`, `Footer`, `Show on first page`, `Start at`, `Apply`) but `find_elements` did not return the radio/checkbox with the right role | `extension/content.js:546-550` `INTERACTIVE_SELECTOR`, `content.js:514` `role: clean(el.getAttribute('role'), 80)` | Discovery is **DOM-role based only**. A control that the accessibility tree reports as a radio but which carries no `role` attribute is invisible to role-filtered `find_elements`; the model fell back to coordinate probing. There is no implicit-role computation and no AX-derived role reconciliation. `axSummary` (`extension/lib/ax-summary.js`) is deliberately read-only and non-clickable, so it cannot close this gap either. |
| Canvas document body could not be filled with tens of thousands of characters | `extension/content.js:491-500` `assertEditableSafe()`, `content.js:958-971` `nativeSetValue()`, `extension/background.js:608-635` `trustedFill()` | `assertEditableSafe` accepts only `input`, `textarea`, and `isContentEditable`. The synthetic `nativeSetValue` path writes `textContent` into a contenteditable, which is wrong for a rich-text surface. The correct primitive exists — `trustedFill` uses CDP `Input.insertText` (`background.js:618`) — but it is gated behind resolving a ref to an accepted editable element first, and is capped at 20 000 characters. Canvas-class editors that expose their surface only through a non-standard editable host are not reachable. |
| Keyboard control felt far weaker than Playwright | `extension/background.js:698-711` `KEY_MAP` | `KEY_MAP` contains 12 unmodified keys. There is **no modifier support at all**: no `Ctrl`/`Shift`/`Alt`/`Meta` bitmask on `Input.dispatchKeyEvent`, no `Ctrl+A`, no `Ctrl+V`, no `Shift+Enter`, no `rawKeyDown`, no auto-repeat, and no arbitrary text entry outside `fill`. Every chord an editor needs is unavailable. |
| `canceling statement due to statement timeout` during heavy read/find | `supabase/functions/opera-agent-gateway/index.ts:27-28,72,105` | This is **Postgres-side**, in the `opera_await_adaptive` RPC wait path, not in the extension. The extension's own budgets are `page.read` 10 s, `page.find` 8 s, `page.wait_for` 15 s (`extension/lib/protocol.js:28-55`). |
| `read_page` output was very noisy and occasionally truncated | `extension/content.js:757-810` `pageRead()`, `content.js:606-655` `semanticRegionObservation()`, `extension/background.js:1031-1038` `boundedResult()` | Already bounded: `MAX_ELEMENTS = 200`, compact projection, `axSummary` capped at 60 entries, and a hard 512 KB result ceiling that throws rather than truncating. The remaining noise is inherent to apps that keep hundreds of toolbar/menu nodes live. |

## 2. Assessment against the stated bar

The operator's own scoring put Opera Agent at 7.5-8/10 overall versus Playwright
at 9/10, with the gap concentrated in exactly six areas. Reading the code, that
scoring is consistent and the causes are structural rather than tuning problems:

1. **Focus is sampled, not held.** The foreground path is a single pre-flight
   read of `tab.active` and `window.focused` with no re-verification. This is a
   race by construction, and it is the single highest-frequency failure reported.
2. **Refs are pins, not locators.** The descriptor is a snapshot with a
   geometry guard, deliberately fail-closed. That guard exists for a real
   production reason (the Street-View mis-click recorded at `content.js:113-117`)
   and **must not be weakened**. The gap is not the guard; it is the absence of a
   bounded, evidence-based re-acquisition step between "ref died" and "model must
   re-find from scratch".
3. **Semantics come from the DOM, not the accessibility tree.** Roles, names, and
   editability are read from attributes. Apps that are semantically rich in the AX
   tree but attribute-poor in the DOM — which is the normal case for large
   single-page editors — are systematically under-discovered.
4. **Keyboard is a toy.** No modifiers means no editor. This is a small, purely
   additive change with an outsized effect on the reported score.
5. **Canvas/rich editors are outside the trusted-fill contract.** The right CDP
   primitive is present but unreachable behind a DOM-shaped admission gate.
6. **Hover is not a first-class step.** Multi-level menus are the most common
   complex-app interaction and are currently only expressible as manual bursts.

Two capabilities the operator listed as Playwright advantages are **not** gaps to
close inside this track, and adding them would break frozen boundaries:

- **Arbitrary JavaScript / `Runtime.evaluate`.** `docs/roadmap.md` "Explicitly
  deferred" lists arbitrary JavaScript and raw CDP. There is deliberately no
  `Runtime.evaluate` anywhere in `extension/`. This must stay a separate,
  explicitly reviewed decision, not a default.
- **Network interception / CDP passthrough.** Same deferral.

## 3. Proposed checkpoints

Each is bounded, independently testable, and leaves Protocol 1, the 26 browser
primitives, and the 22 public MCP tool names untouched unless stated. Ordering is
by reported impact divided by blast radius.

### R9-A — Focus stability (highest impact, smallest blast radius)

Hypothesis: most `FOREGROUND_REQUIRED` reports are a sampling race, not a genuine
loss of user intent, because the check and the dispatch are separated by a
content-script round trip and a debugger attach.

Proposed change: re-sample tab/window focus immediately before dispatch inside
the debugger session, and on a lost sample perform a bounded re-check-and-retry
(2 attempts) rather than failing on the first observation. Record both the
pre-flight and the at-dispatch focus state in the action result so the failure is
diagnosable. Preserve the invariant absolutely: **never** activate a tab, focus a
window, or take the foreground implicitly. A genuine unfocused window still
returns the structured `FOREGROUND_REQUIRED` requirement.

Tests: deterministic focus-state sequences (focused-then-lost, lost-then-
recovered, persistently lost) against the pure decision function, plus a
regression asserting the structured requirement is still returned when focus
never returns, and that no activation call is ever issued.

### R9-B — Modifier and text keyboard support

Hypothesis: adding a modifier bitmask and explicit text entry to the existing
`trustedKey` path removes most of the "keyboard is weak" gap without any new
authority surface.

Proposed change: extend `KEY_MAP` into a chord spec (key plus optional modifier
mask) and pass `modifiers` on `Input.dispatchKeyEvent`. Add an explicit
type-text path built on `Input.insertText` (already used by `trustedFill`) that
does **not** require a pre-resolved editable ref, because a canvas editor's
surface is reached by focus, not by DOM lookup. Keep every existing sensitive
field guard; keep the existing `NAV_KEYS` allowlist for the synthetic path.

Tests: chord table is pure and exhaustively asserted; sensitive-surface
rejection is preserved for every chord; long-text entry is chunked and bounded.

### R9-C — AX-reconciled discovery

Hypothesis: the reported radio/checkbox discovery failures are a DOM-role versus
AX-role mismatch, and the operator's own observation confirms it — enabling screen
reader support made the controls legible to the AX tree immediately.

Proposed change: when `page.read` already collects an `axSummary` (text-poor
surfaces only), reconcile AX `role`/`name` facts onto matching DOM nodes and
expose the reconciled role on serialized elements, so `find_elements` role
filters match. Entries stay read-only; no AX node becomes a clickable ref, and
the existing value-dropping and editable-closure exclusions in
`extension/lib/ax-summary.js` are untouched.

Tests: pure reconciliation over a fixture AX tree; proof that no value ever
crosses the boundary; proof that AX facts never create action authority.

### R9-D — Bounded ref re-acquisition (guard preserved)

Hypothesis: the operator's re-find cost is a round trip, not a safety problem. A
single bounded re-acquisition attempt can be added **without** relaxing the
geometry guard that prevented the Street-View mis-click.

Proposed change: when `resolveActionRef` refuses for the documented
geometry-drift reason, and only then, run one bounded re-find using the
descriptor's own label/tag/role signature; accept a successor only if it is
unique, actionable, non-sensitive, and inside a widened-but-explicit tolerance
that is itself reported in the result. Any ambiguity, sensitivity change, or
multiple candidate still fails closed with candidates listed. The mint-time
geometry guard keeps deciding every other path.

Tests: the existing geometry-guard refusal test must stay green and must still
refuse when re-acquisition is unavailable; added fixtures cover
unique-and-moved (recovered), moved-and-ambiguous (refused), moved-and-sensitive
(refused), and unavailable (refused).

### R9-E — Hover as a first-class step

Hypothesis: multi-level menus fail because hover and settle are separate
unbounded steps, not because hovering is unsupported.

Proposed change: add a hover variant that moves the pointer and then waits for a
bounded settle signal (submenu present, `aria-expanded` flipped, or mutation
stability) before returning, so a menu chain is one step per level instead of a
hand-built burst. Reuse the existing scroll/mutation settle machinery rather than
inventing a new wait.

Tests: settle succeeds on submenu appearance, on `aria-expanded`, and on
mutation stability; times out cleanly; never clicks.

### R9-F — Canvas / rich-editor fill contract

Hypothesis: canvas editors fail at the admission gate, not the input primitive.

Proposed change: define and document an explicit editor-surface admission rule
that recognizes a focus-reachable rich editing surface without pretending it is a
form field, and route it to CDP `Input.insertText` in bounded chunks. This is the
most security-sensitive item in the track because it widens what may receive
typed text; it should be reviewed on its own and should land **last**, after
R9-A through R9-E, and after a Codex audit.

## 4. Explicit non-goals

- No `Runtime.evaluate`, no raw CDP passthrough, no network interception.
- No weakening or removal of `GEOMETRY_DRIFT_TOLERANCE_PX`.
- No clickable AX nodes.
- No implicit tab activation, window focus, OS cursor movement, or keyboard
  redirection. `userActiveTab != automationTargetTab` holds for normal automation.
- No site-specific selectors or strategies for Google Docs or any other host.
- No change to Protocol 1, and no change to the 26 primitives or 22 public MCP
  tool names unless a checkpoint is separately authorized to rebaseline them.
- No transaction authority, no VM enablement, no Milestone 8E start.

## 5. Verification required before any checkpoint is accepted

Per `AGENTS.md`: deterministic failing tests first, then the smallest generic
mechanism, then focused tests, full suite, `npm run check`, and CircleCI +
Vercel SUCCESS on the exact evidence head, then a durable evidence record.
Checkpoints touching the sensitive-input contract (R9-B, R9-F) and the ref
authority contract (R9-D) require an independent Codex audit before promotion.
