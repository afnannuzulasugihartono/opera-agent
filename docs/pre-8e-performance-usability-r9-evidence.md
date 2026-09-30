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

## R9-C — role reconciliation (owner-directed: "perbaiki semua masalah")

### Root cause was broader than reported

`serialize()` read the role straight off the DOM attribute:

```js
role: clean(el.getAttribute?.('role'), 80)
```

So a plain `<button>Send</button>` was reported as `role: ''`, and **any**
control the author did not annotate was invisible to a role-filtered
`find_elements`. This is not a Google Docs quirk — it is most of the web, and
it is exactly why the Page numbers dialog exposed `Footer` and `Show on first
page` as readable text but never as a radio or a checkbox role. The reported
symptom pointed at accessibility; the defect was in serialization.

### Layer 1 — implicit role, from markup

`serialize` now derives the role the platform would report from the element's
own tag, input type, href, and contenteditable state, with an explicit author
role still winning. `<button>` → `button`, `<input type=checkbox>` → `checkbox`,
`<select>` → `combobox`, `<a href>` → `link`, `[contenteditable]` → `textbox`,
`<h3>` → `heading level-3`, and so on.

### Layer 2 — AX reconciliation, reusing the walk that already existed

The text-poor path already made one bounded `Accessibility.getFullAXTree` call
for `axSummary`. That same response now also builds a name→role index and fills
in roles the markup does not carry, so a custom widget the platform reports as
`RadioButton` is finally discoverable by role. **No second AX walk was added**,
so the poverty-gated cost profile is unchanged.

Safety properties, all locked by test:

- an explicit DOM role is never downgraded or overwritten — AX only fills a gap;
- reconciliation is **read-only**: it never mints, moves, or invalidates a ref,
  and never makes an element clickable;
- a name shared by two different AX roles is **never** adopted, because that
  would be a guess; agreement among several nodes on one role is fine;
- a sensitive element is never annotated at all.

### One role table, not two

Content scripts are classic scripts and cannot `import`, so a first attempt put
the helpers in `lib/` and failed the wiring. The repo already has the right
pattern — `semantic-identity.js` and `semantic-views.js` are classic scripts
loaded by the manifest and tested by import-for-side-effect. The same approach
is used: `extension/role-reconcile.js` declares **no** export statements, so it
is simultaneously a valid classic content script (loaded by the manifest before
`content.js`) and a valid ES module that `background.js` side-effect imports.
One table, both contexts, asserted by test — so it cannot drift.

### What deliberately did NOT change

`stableElementIdentity` still reads the raw `role` attribute. Deriving an
implicit role there would silently change **every stableKey in the product**,
which is a compatibility event, not a fix. Region classification and
`scrollTargetBy` also keep the raw attribute for the same reason. A test now
pins all three so a future reader cannot "fix" them by accident.

| Gate | Result |
| --- | --- |
| `node --test tests/r9-role-reconcile.test.mjs` | 15/15 pass |
| `npm test` (full suite) | **553/553 pass**, 0 fail (was 538) |
| `npm run check` | ok — 26 primitives, 80 safety files, 1.6.13 |
| `mcp-contract-v1.json` / MCP blob lock | untouched by R9-C |

No public MCP surface change, so no contract rebaseline was needed for R9-C.
`boundary-locks.mjs` digests for `content.js`, `background.js`, and
`manifest.json` were updated per that file's recorded convention, with the
reason and the safety properties written into the comment.

The shipped 1.6.13 CRX is unaffected: it is a separate artifact and already
lagged the repository. The new manifest entry ships with the next release.

## Repository tidy (2026-09-30, owner-directed)

- **Fixed a regression:** the GitHub `homepage` had been reset to
  `https://oauth-consent-three.vercel.app`, an OAuth consent **development**
  URL, after the handoff recorded it as cleared on 2026-09-29. Cleared again.
- **Added branch protection on `main`**: linear history required, force-push
  blocked, deletion blocked, enforced on admins, unresolved conversations
  blocked. Required status checks were deliberately left **null** so the
  checkpoint fast-forward workflow in `AGENTS.md` still works.
- **Verified, no action needed:**
  - branches are `main` + the single active work branch, which is the healthy
    state the governance rules require;
  - all 52 PRs are closed, no stale open PRs;
  - the `v1.6.0` release body already states it is superseded by the 1.6.13
    active line, and GitHub releases are archive pages only;
  - description and topics are accurate.
- **Two archive tags were re-examined and deliberately KEPT:**
  `archive/tmp/ignore` and
  `archive/feat/performance-runtime-cutover-p6-4571636311958769504` look like
  governance violations (`tmp` is a retired namespace, and the second has a
  tool-generated numeric suffix). They are not. `AGENTS.md` requires
  `archive/<original-branch-path>`, so preserving the original name is the
  archive mechanism working as designed. Both commits are also reachable from
  `main`, so nothing would be lost by deleting them — but deleting the
  preservation record is exactly what the rule forbids. An earlier read of
  these as violations was wrong.

## R9-D — cheap ref recovery, guard untouched (owner-directed continuation)

The design decision is deliberately a **negative** one, and it is the point of
the checkpoint.

### What was NOT done

The 24px mint-time geometry tolerance is **not** relaxed. It exists because a
same-place successor can be a *different* control — the recorded Street-View
mis-click at `content.js:113-117` is the evidence. A moved successor is still
refused and the stale ref is still never revived. Widening the tolerance would
have been easy, would have made the reported symptom disappear, and would have
reintroduced a real failure mode. It was rejected.

### What was actually broken

The cost of *recovery*. After a legitimate re-render moved a control, the model
had to run a whole new `page.find` purely to obtain a usable ref. That round
trip — not the refusal — was the friction.

### The fix

The refusal now hands back fresh refs for candidates that have **already**
passed uniqueness, intrinsic identity, actionability, and the non-sensitive
check. Minting a ref for such a candidate grants exactly what a `page.find`
would have granted, so this is not a widening of authority. The message also
reports the measured drift and the tolerance, making the failure diagnosable
instead of guesswork, and the instructions tell the model to act on those refs
directly rather than re-running `find_elements` or widening the tolerance.

Sensitive descriptors still short-circuit before any candidate pool is built, so
a re-acquisition can never touch one.

`tests/r9-ref-reacquire.test.mjs` locks the negatives as hard as the positives:
the tolerance is pinned at 24, the guard must still be the deciding test before
any rebind assignment, short-circuit and force-rebind escape hatches are
rejected, and the candidate offer is capped at 3.

## R9-B public, R9-E hover, and the release-readiness sweep

- **R9-B made public.** `press_key` and the burst `key` step gained optional
  `modifiers` and `text`; the key enum grew to a fixed 79-entry vocabulary.
  The R9-G placeholder sentence was replaced in the same commit, so the schema
  and the guidance cannot diverge. The dormant runtime is now reachable.
- **R9-E hover.** A `hover` burst step moves the trusted pointer onto a resolved
  ref and settles on the reveal (awaited submenu name, `aria-expanded` flip, or
  DOM stability). It dispatches exactly one pointer event and it is a move — a
  hover can never click. It routes through the same foreground focus gate as
  every other pointer input, and its in-page settle returns a presence boolean,
  never document text. `page.hover` is burst-internal, **not** a 27th primitive.
- **A test gap was found and closed.** `run_browser_burst`'s `inputSchema` is a
  *reference* to the shared `burstStepSchema` constant, so the per-tool digest
  could not observe a change inside it. The public burst vocabulary is now also
  pinned by step name, and the step union is asserted `.strict()` throughout.
- **Release-readiness sweep:** version consistency verified (manifest, package,
  and protocol all 1.6.13; README's production line still 1.6.13, which is
  correct because nothing is released); secret scan over the full R9 diff
  returned no secrets — the only matches were the literal words "password" and
  "OTP" inside safety instruction text; CHANGELOG records the track under
  Unreleased, explicitly source-only; README gained a Maturity section
  separating a complete source checkpoint from being live.

## Known limitation found during verification

The `7C ordinary transition p95 regression` test flaked **twice** under
full-suite parallel load and passes in isolation at ratio 1.013-1.044 against a
15% budget. This is a pre-existing timing sensitivity in that test — a latency
gate competing for CPU with 500+ other tests — not a regression from R9. It is
recorded rather than papered over, and is worth fixing separately: a
performance gate that cannot pass reliably under `npm test` will eventually
teach the team to ignore it.

## Verification

| Gate | Result |
| --- | --- |
| `npm test` (full suite) | **572/572 pass** |
| `npm run check` | ok — 26 primitives, 81 safety files, version 1.6.13 |
| naming governance | pass (5/5) |
| secret scan over the R9 diff | clean |
| version consistency | manifest / package / protocol all 1.6.13 |

## What is still gated, and on whom

**Nothing here is released or activated.** Production serves CRX `1.6.13`,
which predates every R9 change; the new `role-reconcile.js` and
`hover-settle.js` content scripts ship with the next release. Per `AGENTS.md`,
promotion requires, in order:

1. **An independent audit** before promotion, not merely green CI. R9 touches
   the public MCP surface (twice), the sensitive-input contract (R9-B), the ref
   authority contract (R9-D), and the foreground gate (R9-A) — four of the
   named audit triggers. **I cannot satisfy this**: I am the implementing agent,
   and an independent audit by definition has to be someone else. This is the
   single hardest gate and it is not mine to clear.
2. **Live acceptance** in a real Opera profile with a real document editor.
   The Google Docs session that motivated this track is the acceptance case, and
   nothing in this work has been exercised against a live browser.
3. **Owner-ordered release**: build, sign, audit, upload inactive, live
   acceptance, then atomic activation flip.

R9-F (canvas/rich-editor fill widening what may receive typed text) remains
**recommended for deferral** and was not started.

