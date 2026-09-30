# R9-A / R9-B implementation evidence — focus stability and keyboard chords

Date: 2026-09-30

Status: **IMPLEMENTED AND VERIFIED in the extension + protocol layer. Not
promoted, not activated, not live-verified.** Branch
`feat/pre-8e-usability-repair-r8`; base `136a11f` (the R9 assessment commit).

Assessment and original plan: `docs/pre-8e-performance-usability-r9.md`.

## Scope of this checkpoint

Exactly two things, both authorized by the owner on 2026-09-30 after the
assessment was presented:

- **R9-A** — foreground focus stability. Move the foreground check from a single
  racing pre-flight sample to a bounded, at-dispatch re-check.
- **R9-B** — keyboard chords and bounded text entry on the trusted key path.

Plus the boundary-lock digest update that the repo's own convention requires for
an authorized change to locked runtime source.

## Explicit non-goals (held to)

- The **public MCP source stays byte-identical**. Verified with
  `git diff --quiet -- supabase/functions/opera-agent-mcp/index.ts`.
  No tool added, no tool removed, no schema change, no instructions change.
  The `mcp-contract-v1.json` whole-file digest is untouched, so 22 tools, the
  `read_page` schema, and the byte-for-byte public contract are all intact.
- No `Runtime.evaluate`, no raw CDP passthrough, no network interception.
- No weakening of `GEOMETRY_DRIFT_TOLERANCE_PX` or any ref-authority guard.
- No clickable AX nodes.
- No implicit tab activation, window focus, OS cursor movement, or keyboard
  redirection. `userActiveTab != automationTargetTab` still holds.
- No site-specific logic for Google Docs or any other host.
- Protocol 1 unchanged; 26 primitives unchanged; 22 MCP tools unchanged.
- R9-C, R9-D, R9-E, R9-F **not started**.

## Root cause and repair

### R9-A — the check raced the dispatch

Before: `trustedPointer` read `tab.active` and `window.focused` **once**, before a
content-script round trip and a debugger attach, and never re-checked. Foreground
mode deliberately runs without `Emulation.setFocusEmulationEnabled` (only
background mode enables it), so a window that lost focus anywhere in that window
produced `FOREGROUND_REQUIRED` even though the user had just activated the tab.
A race by construction, and the most frequently reported failure.

After: `withForegroundFocusGate` re-samples at dispatch time from **inside** the
debugger session, immediately before the input is dispatched, and retries a
bounded number of times before refusing. All four trusted executors
(`trustedClick`, `trustedFill`, `trustedPointer`, `trustedKey`) route through it.

The gate never activates a tab, never focuses a window, and never moves the OS
cursor. A window that is genuinely unfocused still returns the structured
`FOREGROUND_REQUIRED` requirement, now carrying `attempts`, `tabActive`,
`windowFocused`, and `windowId` so the failure is diagnosable instead of
guesswork. A satisfied sample dispatches on the first attempt with zero added
latency, so the common case is not slowed.

### R9-B — the key table had no modifiers at all

Before: `KEY_MAP` was 12 unmodified keys. No `Ctrl`/`Shift`/`Alt`/`Meta`
bitmask, so `Ctrl+A`, `Ctrl+V`, and `Shift+Enter` were all unavailable — which is
why complex editors scored as "weak keyboard" against Playwright.

After: `resolveKeyInput` in `lib/keyboard.js` resolves a declarative
`{ key, modifiers }` chord or a bounded `{ text }` request to an exact CDP
payload. Modifiers OR into the CDP bitmask (alt 1, control 2, meta 4, shift 8)
and accept common aliases (`ctrl`, `cmd`, `option`, `win`). An uppercase letter
carries an implicit Shift so the platform does not drop it. Text entry is a
separate bounded path (20 000 characters, chunked at 4 000) built on
`Input.insertText`, the same primitive `trustedFill` already used, and it runs
behind the **unchanged** sensitive-field guard.

Every previously allowlisted unmodified key resolves to a byte-identical CDP
payload, so no existing caller or contract changes behaviour. This is asserted
exhaustively, not assumed.

### The synthetic key path stays unmodified-key only — on purpose

`content.js` is a classic content script and **cannot** import
`lib/keyboard.js`. Allowing chords there would mean a second, drifting copy of
the allowlist — exactly the "two sources of truth" problem the shared resolver
was created to remove. Instead the synthetic path refuses chords and text
explicitly, pointing at the trusted path, which is what every public tool
actually uses. The `NAV_KEYS` sensitive-field guard is untouched.

## Evidence

Deterministic tests first, confirmed red before implementation: 17 tests in
`tests/r9-focus-and-keyboard.test.mjs`, of which the two wiring assertions failed
against the old runtime and the rest locked the new policy.

The pure policy modules are asserted as **behavior**, not source text. Two
narrow structural assertions are used, and only for frozen safety invariants that
have no behavioral seam:

- the trusted executors contain no `chrome.tabs.update({active:true})` and no
  `chrome.windows.update({focused:true})` — the product invariant
  `userActiveTab != automationTargetTab`;
- the executors contain no `foregroundRequired(` call and no
  `chrome.windows.get(`, both of which live only in the shared gate, so no
  executor can re-introduce a racing pre-flight check of its own.

Precedent for structural assertion of a safety contract:
`tests/event-driven-local-execution-p4.test.mjs`.

| Gate | Result |
| --- | --- |
| `node --test tests/r9-focus-and-keyboard.test.mjs` | 17/17 pass |
| `npm test` (full suite) | **534/534 pass**, 0 fail (was 517 before this checkpoint) |
| `npm run check` | ok — 26 primitives, 79 safety files, version 1.6.13 |
| `git diff --quiet -- supabase/functions/opera-agent-mcp/index.ts` | unchanged, byte-identical |

No production mutation, no release, no activation, no CRX, no signing, no deploy.
The public MCP surface, the served release, and production are all untouched.

## Boundary-lock update, and why

`tests/helpers/boundary-locks.mjs` pins `extension/content.js` and
`extension/background.js` by git-blob SHA1. That file documents its own
convention in its header comment: each authorized change (U-P1, U-R, U-Sonar)
appends a line recording what it authorized and updates the digests. This
checkpoint follows that convention, and the appended entry states explicitly
that the MCP source is intentionally unchanged here.

Without this update the four P2/P3/P4/P5 boundary tests fail. That is the gate
working as designed, not a gate to be weakened: no assertion was removed or
relaxed, and no lock was narrowed.

## The one decision handed back to the owner

The remaining half of R9-B, and the zero-code instruction win, both live in
`supabase/functions/opera-agent-mcp/index.ts`, which is **frozen byte-for-byte**
by `tests/fixtures/mcp-contract-v1.json` and consumed by six test files
(`semantic-release-gate`, `mcp-inventory-compat-r4`, `goal-ledger-contract`,
`ledger-server`, `reactive-vm-contract`, `transaction-contract-8a`,
`transaction-prepare-8b`).

Making the new keyboard capability publicly reachable, and teaching the model the
menu/dialog `refFromStep` habit, requires changing that file. `AGENTS.md` places
public MCP schema changes behind **their own explicit review boundary**, and this
was not disclosed when R9-B was authorized. Rebaselining a frozen public contract
on that basis alone would be the wrong call, so it was not done unilaterally.

Concretely, still pending:

1. `press_key` gains optional `modifiers` and `text` (schema change).
2. The burst `key` step gains optional `modifiers` and `text` (schema change).
3. MCP instructions gain menu/dialog `refFromStep` guidance and chord guidance
   (instructions only, no schema change) — this is the highest-value, lowest-risk
   item of the three.
4. `mcp-contract-v1.json` `sourceSha256` and the MCP entry in
   `boundary-locks.mjs` are rebaselined, with the reason recorded in the same
   commit, per the existing U-T precedent.

Until then the extension supports chords and text correctly but no public tool
can request them, and the model is not yet told to batch menu work into a burst.
The runtime work is done, verified, and dormant rather than absent.

## R9-G — instructions-only MCP guidance (owner-selected)

Owner selected option 1 of the four pending items. Base `a123bb5`.

**Delivered in the MCP instructions:**

- The existing `refFromStep` habit is extended to **menus and dialogs**, which
  re-render their own DOM on every open: open the menu, then find and click the
  entry by `refFromStep` inside one burst; chain one find/click per level inside
  a single burst with a `wait` step between levels, instead of hovering by
  coordinate across separate calls. This is the direct fix for the reported
  "a ref is valid when found, dead by the time I click it" friction in exactly
  the place it occurred.
- In a rich editor or canvas surface: click the editing surface so it takes
  focus, send an allowlisted key, then re-read the page to confirm the keystroke
  landed rather than assuming it did.

**The chord guidance was deliberately NOT added, and this is a correction to the
option as it was presented.** `press_key.key` is still validated against the
12-key `navigationKeySchema` and the burst `key` step is still `.strict()`.
Documenting `Ctrl+A` or text entry would make the model emit calls the frozen
schema rejects, so the instructions instead say plainly that control chords such
 as select-all and paste are not available on this surface yet. The R9-B runtime
capability stays dormant behind the public schema until options 2 and 3 land.

**What the change actually cost — correcting the earlier claim.** Option 1 was
described as the "smallest delta". That was wrong. The MCP source is frozen
byte-for-byte by `mcp-contract-v1.json` and that digest is *derived into four
more contract fixtures* plus two tests that hardcode it, so an
instructions-only edit still required a full rebaseline:

| File | What moved |
| --- | --- |
| `supabase/functions/opera-agent-mcp/index.ts` | the `instructions` string, 1 line |
| `tests/fixtures/mcp-contract-v1.json` | `sourceSha256` |
| `tests/fixtures/goal-ledger-thresholds-v1.json` | `publicSurfaceBaseline.mcpSourceSha256` + its derived `digest` |
| `tests/fixtures/reactive-vm-contract-v1.json` | `sourceSha256`, `inventory.value.mcpSourceSha256`, derived `inventory.digest` |
| `tests/fixtures/reactive-vm-thresholds-v1.json` | `inventoryDigest` |
| `tests/fixtures/transaction-contract-v1.json` | `inventory.mcpSourceSha256`, `inventory.milestone7InventoryDigest` |
| `tests/fixtures/transaction-thresholds-v1.json` | `milestone7InventoryDigest` |
| `tests/helpers/boundary-locks.mjs` | MCP blob digest + recorded reason |
| `tests/reactive-vm-7f.test.mjs` | hardcoded `EXPECTED_MCP_SHA256` and `inventory.digest` + recorded reason |

Six fixture files, but each is a **single-line** edit: the fixtures are minified
JSON and the values were replaced surgically rather than re-serialised, so the
diff shows the digest that moved and nothing else. An earlier attempt rewrote
them pretty-printed and produced a 1 000-line diff; that was reverted.

The derived digests are not hand-written. `tests/reactive-vm-contract.test.mjs`
recomputes `digest(value)` from the canonical JSON of the inventory object and
compares it to the recorded value, so a digest moved without its derivation
being recomputed would fail the suite. Passing means the chain is consistent.

No historical checkpoint record was falsified. The `checkpointBoundary` blocks in
the contract fixtures still assert what 6A/7A/7F/8A did at their own time; only
the "currently accepted public surface" digest moved, which is the same
rebaseline the repo already performed for U-T when the watch tools took the tool
count from 18 to 22.

### Proof that this is genuinely instructions-only

`tests/r9-public-surface-unchanged.test.mjs` (new, 4 tests) pins each of the 22
`inputSchema` blocks **individually** by digest. The whole-file digest cannot
distinguish an instructions edit from a schema edit; this can. It also asserts
that `press_key` still exposes only `key: navigationKeySchema` with no
`modifiers` and no `text`, that the 12-key enum is unchanged, that the burst key
step is still `.strict()` and free of `modifiers`/`text`, and that the
instructions do not advertise chords the schema would reject.

Verified independently against `HEAD` by extracting all 22 schema blocks from
both revisions and comparing: **no schema drift**, all 22 identical.

| Gate | Result |
| --- | --- |
| `node --test tests/r9-public-surface-unchanged.test.mjs` | 4/4 pass |
| `npm test` (full suite) | **538/538 pass**, 0 fail (was 534) |
| `npm run check` | ok — 26 primitives, 79 safety files, version 1.6.13 |
| per-tool schema diff vs `a123bb5` | no drift, 22/22 identical |

Still no production mutation, no release, no activation, no CRX, no deploy. The
22 public tools and their names are unchanged. Protocol 1 and the 26 primitives
are unchanged.

## Still pending

1. `press_key` optional `modifiers` and `text`.
2. Burst `key` step optional `modifiers` and `text`.

Items 1 and 2 need the same rebaseline, which has now been performed and its cost
is known, so bundling them is cheaper than it was. They widen what the public
contract accepts, which is the part that genuinely needs review. Once they land,
the "chords are not available yet" sentence in the instructions must be replaced
in the same commit, and `tests/r9-public-surface-unchanged.test.mjs` must have its
frozen schema map rebaselined in that same commit — it is designed to fail
loudly if the schema moves without the instructions moving with it.

**R9-C (AX-reconciled discovery) is the next substantive engineering item and
touches none of the above.**

