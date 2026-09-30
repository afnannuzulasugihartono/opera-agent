# Opera Agent next-session handoff

## Head `8e05b3e` — R9 complete in source WITH live browser acceptance; not released

`main` = `feat/pre-8e-usability-repair-r8` = **`8e05b3e`**. CircleCI `ci`
**success** — that check includes the Chromium extension regression step.
Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

Live browser acceptance now exists for all four R9 capabilities
(`tests/fixtures/pre-8e-usability-r9.html` plus cases in
`tests/browser_extension_test.py`): implicit role discovery, a real `Ctrl+A`
chord and bounded text into a contenteditable editor, sensitive-field refusal
for both chord and text, a two-level hover menu driven by **one** burst, and
stale-ref refusal with a usable `freshRef`.

**It immediately paid for itself.** The burst validator only accepted a literal
`ref` for a hover, not the `refFromStep` form that `click` and `fill` allow — so
the documented multi-level menu pattern was impossible and **R9-E shipped broken
for its primary use case**. No unit test caught it because the unit test used a
literal ref. Fixed in `extension/lib/protocol.js` with a test.

Two harness facts to keep: sensitive fields are **not actionable**, so the key
guard must be exercised via `page.focus` rather than a click (a first attempt
passed `selector` to `page.find`, which has no such parameter, so the guard was
silently never tested — an explicit `activeElement` assertion caught it); and a
**connected** element always resolves, so the geometry guard only applies to a
real DOM replacement, not a CSS transform.

**Nothing is released or activated.** Production serves CRX **1.6.13**, which
predates every R9 change; `role-reconcile.js` and `hover-settle.js` ship with the
next release. R9-F (canvas/rich-editor fill) remains **recommended for
deferral**.

### Environment notes for this machine

- Python is not on `PATH` as `python`/`python3`, but `py` works (3.12.10) with
  Playwright and Chromium installed. Use `py tests/browser_extension_test.py`.
- Read CI with `gh api .../commits/<sha>/check-runs` **and** `.../status`. The
  combined status can read `success` while a check-run is still pending or red.
- The CircleCI MCP connector's `list_runs` returns only a count with no run
  payload, so its `list_runs -> get_run -> list_workflow_jobs` chain cannot be
  followed. Use the GitHub API.

### Open: SonarCloud quality gate

`SonarCloud Code Analysis` reports **Quality Gate failed** on every R9 head.
Acceptance is CircleCI + Vercel and Sonar is the **PR** gate, so it does not
block acceptance — but it is red for the whole track and **undiagnosed**: no
`sonar-project.properties`, no `SONAR_*` env var, and no Sonar step in
`.circleci/config.yml`, so it runs through the Sonar GitHub integration and its
findings are unreachable from here. **Needs SonarCloud project access to read
the actual findings.** Do not guess.

### Still gated, and not on this line of work

1. **Independent audit** before promotion. R9 touches four named `AGENTS.md`
   audit triggers: public MCP surface (R9-B, R9-G), sensitive-input contract
   (R9-B), ref-authority contract (R9-D), foreground gate (R9-A). The
   implementing agent cannot clear this gate.
2. **Live acceptance against a real third-party editor.** The R9 capabilities
   are now verified in a real browser, but the motivating case is Google Docs
   with a real account, which was not exercised.
3. **Owner-ordered release**: build, sign, audit, upload inactive, live
   acceptance, then the atomic activation flip. `opera_releases_one_active_per_
   identity_idx` is an immediate partial UNIQUE index, so use the two-statement
   ordered flip, not one multi-row UPDATE.

## R9-A/B/C closed — main fast-forwarded to `024696b` (CI green 2026-09-30)

`main` = `feat/pre-8e-usability-repair-r8` = **`4e90d31`**. CircleCI `ci`
**success** and Vercel **success** on that exact SHA. Record:
`docs/pre-8e-performance-usability-r9-evidence.md`.

**Nothing is released or activated.** Production serves CRX **1.6.13**, which
predates every R9 change; `role-reconcile.js` and `hover-settle.js` ship with the
next release. R9-F (canvas/rich-editor fill) remains **recommended for
deferral**.

### Two CI failures found and fixed at the end of the track

1. **The 7C p95 gate was a flaky perf gate.** It failed CI on `3355404` while
   passing locally, and reproduced at ~1 run in 3 locally (ratios to 1.282 vs a
   1.15 budget). The budget was never the problem; the estimator was. It now
   asserts the **median of paired ratios** — stable at 1.025-1.044. Two
   alternative estimators were measured and rejected with numbers recorded in the
   evidence doc; a meta-test prevents a quiet revert.
2. **R9-D broke the Chromium extension regression** — my regression, not the
   flake. R9-D dropped `rect` from the geometry-rejection candidate payload and
   `tests/browser_extension_test.py:836` asserts on that coordinate. Restored.

   **Carry this lesson:** the local suite was 573/573 green while the extension
   was broken in a real browser. `npm test` does not cover the extension. Run
   `py tests/browser_extension_test.py` before calling extension work done.

### Environment notes for this machine

- Python is **not on `PATH`** as `python`/`python3`, but the launcher works:
  `py --version` is 3.12.10 and Playwright plus Chromium are already installed.
  Use `py tests/browser_extension_test.py`, not `npm run test:browser`.
- CI state is read via `gh api repos/<owner>/<repo>/commits/<sha>/check-runs`
  and `.../status`. **Check `check-runs`, not just `status`** — the combined
  status can read `success` while a check-run such as SonarCloud is still
  pending or red.
- The CircleCI MCP connector's `list_runs` returns only a count with no run
  payload, so its `list_runs -> get_run -> list_workflow_jobs` chain cannot be
  followed. Use the GitHub API as above.

### Open quality gate: SonarCloud

`SonarCloud Code Analysis` reports **Quality Gate failed** on every R9 head
including `024696b`. Per the recorded gate scope, acceptance is CircleCI +
Vercel and Sonar is the **PR** gate, so this does not block acceptance — but it
has been red for the whole track and **is undiagnosed**. There is no
`sonar-project.properties`, no `SONAR_*` env var, and no Sonar step in
`.circleci/config.yml`, so the analysis runs through the Sonar GitHub
integration and its findings are unreachable from this environment. **Someone
with SonarCloud project access must read the actual findings.** Do not guess.

### Still gated, and not on this line of work

1. **Independent audit** before promotion. R9 touches four named `AGENTS.md`
   audit triggers: public MCP surface (R9-B, R9-G), sensitive-input contract
   (R9-B), ref-authority contract (R9-D), foreground gate (R9-A). **The
   implementing agent cannot clear this gate.**
2. **Live acceptance** in a real Opera profile against a real document editor.
3. **Owner-ordered release**: build, sign, audit, upload inactive, live
   acceptance, then the atomic activation flip. The recorded flip mechanic:
   `opera_releases_one_active_per_identity_idx` is an immediate partial UNIQUE
   index, so use the two-statement ordered flip, not one multi-row UPDATE.

## R9-A/B/C closed — main fast-forwarded to `024696b` (CI green 2026-09-30)

Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

**Nothing is released or activated.** Production serves CRX **1.6.13**, which
predates every R9 change; `role-reconcile.js` and `hover-settle.js` ship with the
next release. `npm test` 572/572, `npm run check` ok — 26 primitives, 81 safety
files, 1.6.13. Secret scan over the R9 diff clean; version consistency verified.

- **R9-A** focus gate re-samples at dispatch inside the debugger session,
  retries boundedly, never takes the foreground itself.
- **R9-B** chords + bounded text, **now publicly reachable** (`press_key`, burst
  `key` step) behind the unchanged sensitive-field guard.
- **R9-C** roles derived from the platform, not only the `role` attribute; the
  existing bounded AX walk fills roles the markup lacks. Read-only.
- **R9-D** the 24px tolerance is **unchanged and unbroadened**; recovery is
  cheap because the refusal returns fresh refs for already-validated candidates.
- **R9-E** `hover` burst step: one pointer event, a move, so it can never click.
  `page.hover` is burst-internal, not a 27th primitive.
- **R9-G** instructions teach menu/dialog `refFromStep` batching.

### Two test gaps found and closed

- `run_browser_burst`'s `inputSchema` is a *reference* to the shared
  `burstStepSchema` constant, so the per-tool digest could not observe a change
  inside it. The burst vocabulary is now also pinned by step name.
- The `7C ordinary transition p95 regression` test **flaked twice** under
  full-suite parallel load (ratio 1.013-1.044 in isolation vs a 15% budget).
  Pre-existing timing sensitivity, not an R9 regression. Worth fixing
  separately: a perf gate that cannot pass reliably under `npm test` will
  eventually be ignored.

### Gated, and NOT on this line of work

1. **Independent audit before promotion.** R9 touches four named `AGENTS.md`
   audit triggers: public MCP surface (R9-B, R9-G), sensitive-input contract
   (R9-B), ref-authority contract (R9-D), foreground gate (R9-A). **The
   implementing agent cannot clear this gate** — an independent audit has to
   come from outside this work.
2. **Live acceptance** in a real Opera profile against a real document editor.
   Nothing here has run against a live browser; the Google Docs session that
   motivated R9 is the acceptance case.
3. **Owner-ordered release**: build, sign, audit, upload inactive, live
   acceptance, then the atomic activation flip. Note the recorded flip
   mechanic: `opera_releases_one_active_per_identity_idx` is an immediate
   partial UNIQUE index, so use the two-statement ordered flip, not one
   multi-row UPDATE.

**R9-F (canvas/rich-editor fill) remains recommended for deferral** — it widens
what may receive typed text, and the motivating case already has a better path
via the Google Docs API.

## R9-A/B/C closed — main fast-forwarded to `024696b` (CI green 2026-09-30)

**Canonical head: `024696b` on `main` and `feat/pre-8e-usability-repair-r8`
(identical).** CircleCI run 389 SUCCESS + Vercel SUCCESS on that exact SHA,
combined commit status `success`. Fast-forwarded from `5ffa75e` with `--ff-only`
after confirming `origin/main` was an ancestor. The branch-protection rule added
this session (linear history, no force-push, no deletion, enforced on admins,
no required status checks) did not block it.

Four commits closed together: `136a11f` (R9 assessment), `a123bb5` (R9-A focus
gate + R9-B keyboard chords), `06375a3` (R9-G instructions-only MCP guidance),
`024696b` (R9-C role reconciliation + repository tidy).

**This closes a source checkpoint only. Nothing is released or activated.**
Production still serves CRX **1.6.13**, which predates every R9 change — the
new `role-reconcile.js` content script ships with the next release. Per
`AGENTS.md`, release promotion, activation, and Milestone 8E remain separate
explicit owner decisions, and a public-MCP-touching checkpoint needs an
independent audit before promotion.

### Verifying CI in this environment

`circleci_list_runs` on the CircleCI MCP connector returns only a count
(`"Found 1 run(s)"`) with no run payload, so the documented
`list_runs -> get_run -> list_workflow_jobs` chain cannot be followed. The error
path works (`get_run` with a bad UUID returns `Run not found.`), so the connector
is healthy; only the list payload is not surfaced.

Use the GitHub check-runs API instead — it is *more* precise because it binds the
result to an exact SHA, which is what the acceptance rule in `AGENTS.md` requires:

```powershell
gh api repos/afnannuzulasugihartono/opera-agent/commits/<sha>/check-runs `
  --jq '[.check_runs[] | {name: .name, status: .status, conclusion: .conclusion}]'
gh api repos/afnannuzulasugihartono/opera-agent/commits/<sha>/status --jq .state
```

Required checks: `ci/circleci: test` (CircleCI) and `Vercel`.

Note: `git push` to GitHub **worked over SSH** this session despite the recorded
`url.ssh://...insteadOf=https` SSH-agent breakage; the recorded HTTPS workaround
remains the reliable path and is kept in the git history section below.

## R9-C role reconciliation + repository tidy (2026-09-30)

Base `06375a3`. Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

**The reported symptom pointed at accessibility; the defect was serialization.**
`serialize()` read `role: clean(el.getAttribute?.('role'), 80)`, so a plain
`<button>Send</button>` was reported as `role: ''` and **any** unannotated control
was invisible to a role-filtered `find_elements`. That is exactly why the Page
numbers dialog showed `Footer` / `Show on first page` as text but never as a
radio or checkbox.

- **Layer 1 — implicit role from markup** (tag, input type, href, contenteditable);
  an explicit author role still wins.
- **Layer 2 — AX reconciliation** reusing the *existing* single bounded
  `getFullAXTree` call on the text-poor path. No second AX walk, so the
  poverty-gated cost profile is unchanged.
- **Safety:** explicit DOM roles are never downgraded; reconciliation is
  read-only and never mints/moves/invalidates a ref; a name shared by two AX
  roles is never adopted; sensitive elements are never annotated.
- **One role table, not two.** Content scripts are classic scripts and cannot
  `import`, so `extension/role-reconcile.js` has no `export` statements and is
  both a valid manifest-loaded content script and a valid ES module that
  `background.js` side-effect imports. Test-pinned against drift.
- **Deliberately unchanged and now test-pinned:** `stableElementIdentity` (an
  implicit role there would change every stableKey in the product), region
  classification, and `scrollTargetBy`.

`npm test` **553/553 pass** (was 538); `npm run check` ok — 26 primitives, 80
safety files, 1.6.13. No public MCP change, so no contract rebaseline needed.
The shipped 1.6.13 CRX is unaffected; the new manifest entry ships with the next
release.

### Repository tidy

- **Fixed a regression:** the GitHub `homepage` had been reset to
  `https://oauth-consent-three.vercel.app` (an OAuth consent **dev** URL) after
  the handoff recorded it cleared on 2026-09-29. Cleared again.
- **Branch protection on `main`:** linear history, no force-push, no deletion,
  enforced on admins, conversations must resolve. Required status checks left
  **null** on purpose so the `AGENTS.md` fast-forward workflow still works.
- **Verified, no action:** `main` + one active work branch; all 52 PRs closed;
  `v1.6.0` body already notes it is superseded by 1.6.13; description/topics
  accurate.
- **`archive/tmp/ignore` and `archive/feat/performance-runtime-cutover-p6-4571636311958769504`
  were re-examined and KEPT.** They look like governance violations but are not:
  `AGENTS.md` mandates `archive/<original-branch-path>`, so preserving the
  original name is the archive mechanism working. Both commits are also
  reachable from `main`. An earlier read of them as violations was wrong.

### Still pending
1. `press_key` optional `modifiers` and `text`.
2. Burst `key` step optional `modifiers` and `text`.

Both need the contract rebaseline R9-G already performed, so bundling is cheaper
now. When they land, replace the "chords not available yet" instruction AND
rebaseline the frozen schema map in
`tests/r9-public-surface-unchanged.test.mjs` **in the same commit** — that test
fails loudly if the schema moves without the instructions moving with it.

R9-D (bounded ref re-acquisition, geometry guard preserved) and R9-E (hover as a
first-class step) unstarted. **R9-F still recommended for deferral.**

## R9-G — instructions-only MCP guidance (2026-09-30, owner-selected option 1)

Base `a123bb5`. Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

MCP instructions now extend `refFromStep` to **menus and dialogs** (open menu,
then find + click by `refFromStep` in one burst; chain one find/click per level
with a `wait` step between levels) and tell the model to click an editor surface
before sending a key and verify the keystroke landed. This directly targets the
reported stale-ref-in-menus friction.

**Chord guidance deliberately NOT added.** `press_key.key` is still validated
against the 12-key `navigationKeySchema` and the burst `key` step is still
`.strict()`, so documenting `Ctrl+A`/text would make the model emit calls the
frozen schema rejects. The instructions state that chords are not available yet.
R9-B's runtime capability stays dormant behind the public schema.

**Cost, corrected.** Option 1 was called the "smallest delta" — wrong. The MCP
source digest is frozen in `mcp-contract-v1.json` and **derived into four more
contract fixtures** plus two tests that hardcode it, so an instructions-only
edit still required a full rebaseline across six minified fixtures (one line
each), `tests/helpers/boundary-locks.mjs`, and `tests/reactive-vm-7f.test.mjs`.
Derived digests are recomputed by the contract tests from canonical JSON, so they
are proven, not hand-written. No historical `checkpointBoundary` record was
falsified; only the accepted public-surface digest moved, as U-T also did.

**Proof it is instructions-only.** New `tests/r9-public-surface-unchanged.test.mjs`
pins all 22 `inputSchema` blocks individually (the whole-file digest cannot tell
an instructions edit from a schema edit) and asserts `press_key` still exposes
only `key: navigationKeySchema`, the 12-key enum is unchanged, the burst key step
is still `.strict()`, and the instructions never promise chords. Verified against
`HEAD` by comparing all 22 extracted schema blocks: **no drift**.

`npm test` **538/538 pass** (was 534); `npm run check` ok — 26 primitives, 79
safety files, 1.6.13. 22 tools and their names unchanged; Protocol 1 and the 26
primitives unchanged; no production mutation, release, activation, CRX, or deploy.

### Still pending
1. `press_key` optional `modifiers` and `text`.
2. Burst `key` step optional `modifiers` and `text`.

Both need the same rebaseline, now already performed, so bundling is cheaper than
it was. When they land: replace the "chords not available yet" sentence AND
rebaseline the frozen schema map in `tests/r9-public-surface-unchanged.test.mjs`
**in the same commit** — that test is designed to fail loudly if the schema moves
without the instructions moving with it.

**R9-C (AX-reconciled discovery) is the next substantive engineering item** and
touches none of the above. R9-D, R9-E, R9-F not started; **R9-F still recommended
for deferral**.

## R9-A / R9-B implemented — focus stability + keyboard chords (2026-09-30)

Owner-authorized after the R9 assessment. **Implemented and verified in the
extension + protocol layer. NOT promoted, NOT activated, NOT live-verified.**
Full record: `docs/pre-8e-performance-usability-r9-evidence.md`. Base `136a11f`,
branch `feat/pre-8e-usability-repair-r8`.

Evidence: 17 new deterministic tests in `tests/r9-focus-and-keyboard.test.mjs`
(written red before implementation); `npm test` **534/534 pass** (was 517);
`npm run check` ok — 26 primitives, 79 safety files, version 1.6.13.

**R9-A (focus).** The old check sampled `tab.active`/`window.focused` once,
before a content round trip and a debugger attach, and never re-checked;
foreground mode runs *without* `Emulation.setFocusEmulationEnabled`, so any focus
loss in that window returned `FOREGROUND_REQUIRED` — a race by construction, and
the most frequent reported failure. `withForegroundFocusGate` now re-samples at
dispatch time **inside the debugger session** and retries a bounded number of
times. All four trusted executors route through it. It never activates a tab or
focuses a window, and a genuinely unfocused window still returns the structured
requirement with `attempts`/`tabActive`/`windowFocused` attached.

**R9-B (keyboard).** `KEY_MAP` was 12 unmodified keys with no modifier bitmask,
so no `Ctrl+A`/`Ctrl+V`/`Shift+Enter`. `extension/lib/keyboard.js` (new, pure)
resolves a `{key, modifiers}` chord or a bounded `{text}` request to an exact CDP
payload, implicit Shift for uppercase, text chunked at 4 000 chars, behind the
**unchanged** sensitive-field guard. Every previously allowlisted unmodified key
resolves byte-identically.

**Deliberate limitation.** `content.js` is a classic content script and cannot
import `lib/keyboard.js`. Rather than keep a second, drifting copy of the
allowlist, the synthetic key path stays unmodified-key only and refuses chords
and text explicitly, pointing at the trusted path.

**Public MCP surface is byte-identical and unchanged.** No tool, schema, or
instruction change; `tests/fixtures/mcp-contract-v1.json` untouched, so 22 tools,
the `read_page` schema, and the whole-file public contract all hold. Protocol 1
and the 26 primitives unchanged. No production mutation, release, CRX, or deploy.

`tests/helpers/boundary-locks.mjs` digests for `content.js`/`background.js` were
updated per that file's own documented convention (U-P1, U-R, U-Sonar each
appended a recorded line and updated digests). No assertion was removed or
relaxed; no lock narrowed.

### Decision the owner still owes — do not rebaseline this unilaterally

The other half of R9-B, plus the menu/dialog `refFromStep` instruction win, both
live in `supabase/functions/opera-agent-mcp/index.ts`, frozen byte-for-byte by
`tests/fixtures/mcp-contract-v1.json` and consumed by **seven** test files
(`semantic-release-gate`, `mcp-inventory-compat-r4`, `goal-ledger-contract`,
`ledger-server`, `reactive-vm-contract`, `transaction-contract-8a`,
`transaction-prepare-8b`). `AGENTS.md` puts public MCP schema changes behind
their own explicit review boundary, and that was not disclosed when R9-B was
authorized, so the digest was deliberately left alone.

Pending, best value per contract risk:
1. **Instructions only** — menu/dialog `refFromStep` + chord guidance. Zero
   schema change, highest value, smallest delta. Recommended first.
2. `press_key` optional `modifiers` and `text`.
3. Burst `key` step optional `modifiers` and `text`.
4. Rebaseline `mcp-contract-v1.json` `sourceSha256` and the MCP boundary-lock
   entry with a recorded reason, per the existing U-T precedent.

Until 2-4 land, the extension supports chords and text but no public tool can
request them. The runtime work is done, verified, and dormant rather than absent.

**Next substantive engineering item: R9-C (AX-reconciled discovery)**, which does
*not* touch the public MCP surface. R9-D, R9-E, R9-F not started; **R9-F remains
recommended for deferral** — it widens what may receive typed text, and the
Google Docs scenario that motivated it already has a better path via the Docs
API.

## R9 complex-application control assessment (2026-09-30) — PROPOSED, awaiting authorization

A live operator test of Opera Agent against **Google Docs** (long-document
editing, `Insert > Page elements > Page numbers > More options`, the Page
numbers dialog) exposed the product's real weakness. Ordinary browsing
(Stanford HAI, MDPI, UNESCO, NIST), tab switching, reading, and simple
click/form flows were smooth; the friction was concentrated in canvas-class
editors, hover-revealed submenus, custom dialog controls, and focus stability.
The operator's own scoring was Opera Agent 7.5–8/10 vs Playwright 9/10, and the
code agrees with that scoring.

Full assessment with per-observation code mapping and proposed checkpoints:
**`docs/pre-8e-performance-usability-r9.md`**. Findings are also summarized in
`docs/project-context.md` under the same heading.

**This was documentation only. No runtime behavior changed.** Verified at head
`5ffa75e` with `npm test` 517/517 passing. Nothing is authorized to start yet —
per `AGENTS.md` each checkpoint needs owner authorization, deterministic failing
tests first, and CI evidence on its exact head.

Root causes, in descending reported impact:

1. **Focus is sampled, not held** — `extension/background.js:637-648` reads
   `tab.active`/`window.focused` once, then dispatches after a content round
   trip and a debugger attach. Foreground mode deliberately runs *without*
   `Emulation.setFocusEmulationEnabled` (only background enables it,
   `background.js:446-461`). A window that loses focus in that window fails with
   no retry. This is a race by construction and was the most frequent failure.
2. **Keyboard has no modifiers** — `KEY_MAP` (`background.js:698-711`) is 12
   unmodified keys. No `Ctrl`/`Shift`/`Alt`/`Meta` bitmask, no chords, no
   `Ctrl+A`/`Ctrl+V`, no arbitrary text entry outside `fill`. Cheapest fix in
   the track with an outsized effect.
3. **Discovery is DOM-role based** — `content.js:514`, `content.js:546-550`.
   Controls rich in the AX tree but attribute-poor in the DOM are
   under-discovered. Enabling screen-reader support made them legible to the AX
   tree immediately, which is the direct evidence for this cause.
4. **Refs are pins, not locators** — `content.js:216-257` fails closed unless
   the successor is unique *and* within `GEOMETRY_DRIFT_TOLERANCE_PX = 24`
   (`content.js:118`) of the mint rect. The guard is deliberate (Street-View
   mis-click, `content.js:113-117`) and **must not be weakened**; what is
   missing is a bounded re-acquisition step.
5. **Canvas/rich editors are outside the fill contract** — `Input.insertText`
   exists (`background.js:618`) but `assertEditableSafe` (`content.js:491-500`)
   admits only `input`/`textarea`/`isContentEditable`, and the synthetic path
   writes `textContent` (`content.js:958-971`), which is wrong for rich text.
6. **Hover is not first-class** — menu chains are only expressible as manual
   bursts; no dwell, no submenu/`aria-expanded` settle.

**Not gaps to close:** arbitrary JavaScript/`Runtime.evaluate` (none exists in
`extension/`), raw CDP passthrough, network interception. All three are frozen
in `docs/roadmap.md` "Explicitly deferred" and require a separate explicitly
reviewed decision.

**The `statement timeout` errors were not the extension's.** They are
Postgres-side in the gateway `opera_await_adaptive` wait path
(`supabase/functions/opera-agent-gateway/index.ts:27-28,72,105`).

Proposed order if authorized: **R9-A** focus stability → **R9-B** modifier/text
keyboard → **R9-C** AX-reconciled discovery → **R9-D** bounded ref
re-acquisition (guard preserved) → **R9-E** hover as a first-class step →
**R9-F** canvas/rich-editor fill contract **last** (widens what may receive
typed text). R9-B, R9-D, and R9-F touch sensitive-input or ref-authority
contracts and need an independent Codex audit before promotion.

## Repository tidying round 2: front page + naming audit (2026-09-29)

Owner-ordered professionalization pass. All commits docs-only; head `43e8e65`
on r8 = `main` (CircleCI + Vercel green, tree clean):

- **README rebuilt** to the verified contract: current-release table,
  capability groups, architecture, repo layout, dev commands; removed stale
  "What 1.0.x includes" and the 23-primitive claim (source of truth: 26 via
  `ALLOWED_METHODS.length`, 22 tools via fixture + `mcp-inventory-compat-r4`
  locks). `ab5e7f0`.
- **CHANGELOG**: added `[1.6.13]` section with U-R delta + cumulative
  attribution (U-P1@1.6.11 source, U-P3@1.6.12 source; 1.6.12 never packed);
  note that 1.6.3–1.6.12 records live in context/docs/releases. `da7d52d`.
- **Release archive index** (`docs/releases/README.md`) completed through
  1.6.13: verified activation sequence 1.6.5 -> 1.6.6 -> 1.6.7 -> 1.6.9 ->
  1.6.10 -> 1.6.13; 1.6.4/1.6.8/1.6.11 uploaded-never-active; 1.6.12 never
  packed. `8b6e083`, corrected `43e8e65`.
- **CONTRIBUTING**: branch patterns aligned to binding governance
  (`feature/*` was invalid vs `feat|fix|chore|docs|test|perf|refactor/*`).
  `8b6e083`.
- **GitHub page**: homepage field cleared (was the OAuth dev Vercel URL);
  v1.6.0 release body corrected to "current 1.6.13 active release line".
- **Governance audit clean**: naming test green; root entries all
  allowlisted/tracked-or-ignored; remote holds only `main` + r8 +
  archive/*/v* tags.
- **Push auth (this machine)**: the SSH agent's github key is gone
  (`~/.ssh` only holds the read-only CircleCI deploy key) and the global
  `url.ssh://github.com.insteadOf=https` rewrite breaks SSH transport.
  Push via: `git -c credential.helper="!gh auth git-credential" -c
  "url.https://github.com/.insteadOf=https://github.com/" -c
  "url.https://github.com/.insteadOf=ssh://git@github.com/" push
  https://github.com/afnannuzulasugihartono/opera-agent.git <ref>` (gh CLI
  PAT authenticates HTTPS).

Previous sections remain accurate below (1.6.10-active lines are superseded
by the 1.6.13 activation section at the top of this file's predecessor).

## 1.6.13 ACTIVATED as production release (2026-09-29, owner-ordered, takes precedence)

- Active release is now **1.6.13** (single active row; SHA-256
  `8420872b2ce3bf7c1ce1cefcb66037eb453441bd73cde80c4fa1eeb1b2d263df`, 60,188
  bytes, release head `83be509`). Verified live: `update.xml?id=` serves
  1.6.13, served CRX bytes/SHA = DB = disk, 1.6.10 CRX path now 404.
- 1.6.10 row intact inactive = rollback target (same ordered flip).
  1.6.11 remains uploaded inactive; 1.6.12 source still awaits its own signed
  CRX (activation of superseded intermediate builds is not planned).
- **Flip mechanics gotcha (recorded)**: `opera_releases_one_active_per_identity_idx`
  is an immediate partial UNIQUE index; a single multi-row UPDATE trips 23505
  depending on row order. Use the two-statement ordered flip
  (deactivate-active, then activate-target) inside one transaction.
- Devices self-update on the next browser-scheduled check; watch adoption via
  `opera_devices.extension_version`. If a later DB write hits
  `transaction_read_only`, lift via Management API `/readonly/temporary-disable`.
- Next implementation work (unchanged, owner-gated): U-P2 (vision sampling);
  U-V live acceptance on a served release can now be exercised on 1.6.13.

## CRX 1.6.13 signed, audited, uploaded inactive (2026-09-29)

Owner-ordered continuation of the interrupted 2026-09-29 signing session.
Full record in `docs/project-context.md` §CRX 1.6.13. Key facts:

- Signed `D:\Opera\opera-agent-1.6.13.crx` (60,188 bytes, SHA-256 `8420872b...
  263df`) from clean worktree at release head `83be509` (CI/Vercel/Sonar green
  on that exact head). Offline audit PASS: identity + owner-PEM match, RSA
  proof valid over the Chromium-exact blob (signature padding is PKCS#1 v1.5 —
  the old `%TEMP%\kilo\verify-crx.mjs` PSS-only check false-flagged every
  artifact, including served 1.6.10), all 14 archive entries byte-identical
  to source.
- Uploaded to `opera_releases` as `active=false` via the Supabase Management
  API (project `nenmkmtvjremqphfqnfw`). Verified DB bytes/SHA = disk; live
  `update.xml` still serves 1.6.10 and the 1.6.13 CRX path 404s while
  inactive.
- **Exact next actions (both owner-gated, NOT performed)**: owner live Opera
  acceptance of 1.6.13, then the owner-ordered atomic activation flip
  (1.6.13 active / 1.6.10 inactive). Rollback = same flip re-activating 1.6.10.
- This head is docs-only; code state is unchanged from `83be509`.

## U-Sonar new-code reliability sweep merged (2026-09-29)

Owner ordered the SonarCloud Quality Gate green. Full record in
`docs/project-context.md` §U-Sonar. Key facts for the next session:

- PR #52 (`fix/sonar-new-code-reliability`) resolved all 56 new-code reliability
  bugs: 44 code fixes + 12 false-positive transitions on byte-pinned deployed
  artifacts (`lib/transaction-*-8d.js` bundle set, token-identical `exact=`
  helper lines, frozen-AST `then` in boundary-locked `reactive-vm-7d.js`).
- Two DRY refactors landed because SonarJS counts inline duplication:
  `lib/canonical-order.js` (`codeUnitCompare` exported helper) and
  `tests/helpers/boundary-locks.mjs` (single-source P2/P3/P4/P5 lock arrays
  with the U-P1/U-R/U-Sonar authorization history). Behavior and digests are
  byte-identical; every sort still yields code-unit order.
- New runtime file count is 77 (`npm run check` discovers it automatically).
- PR #52 gates: Sonar Quality Gate **passed**, CircleCI `ci` + Vercel success
  on `4ceb838`; `main` fast-forwarded to `4ceb838`.
- Owner's Sonar token was used transiently for inspection/transitions and
  should be revoked in the SonarCloud account (never stored in the repo).
- 1.6.10 remains the active production release; 1.6.11/1.6.12/1.6.13 remain
  owner-gated (CRX signing/activation unchanged). Next implementation work:
  U-P2 (vision sampling) only when the owner orders it.

## GitHub repo cleanup completed — 2026-09-28

Owner-ordered repository tidying on top of U-R (see §U-R below):

- Remote branches are now only `main` and `feat/pre-8e-usability-repair-r8`.
  README evidence head `05202ba` (CI green, `main` fast-forwarded); this
  cleanup-records head is `8c7d42a` on r8.
- README status block corrected to the verified production state: 1.6.10
  active (live-checked against `update.xml`), Protocol 1 / 26 capabilities /
  22-tool MCP inventory, U-* checkpoint line on r8.
- GitHub Release **v1.6.0** published with assets (`Opera-Agent-1.6.0.crx`
  byte-verified vs recorded production SHA-256 `cd50933e...`, extension +
  source zips from `git archive v1.6.0`, `SHA256SUMS`). Versions above 1.6.0
  ship only through the private Supabase update service — GitHub releases are
  archive pages, not install channels.
- Stale 1.0.1-era issue #1 closed as superseded (comment records the
  replacements). Open issues/PRs: zero.
- Repo metadata: description + 8 topics set; internal OAuth homepage cleared;
  no LICENSE added (owner/legal decision, left to the owner).
- Full record: `docs/project-context.md` §GitHub repository cleanup.
- Next exact action: unchanged U-R follow-ups — owner live acceptance of
  1.6.13, owner-gated CRX signing/activation chain, then U-P2 (vision
  sampling) as the last proposed research checkpoint.

## U-R timeout/retry/popup parity implemented (1.6.13 candidate) — 2026-09-28 (read first)

Continuation session on `feat/pre-8e-usability-repair-r8` (start head
`dc70404` = origin tip; verified clean at session start).

**Tree recovery first**: a prior interrupted writer had re-saved most
working-tree files through a CP1252 round-trip: UTF-8 BOM added to ~15 files
and em-dash mojibake in `browser_extension_test.py` (also corrupting a
functional `é` assertion in `goal-ledger-contract.test.mjs` and a comment in
`mcp-inventory-compat-r4.test.mjs`). All were restored from HEAD and the
intended edits re-applied byte-clean; the whole tree was re-verified BOM/CRLF/
mojibake-free before commit. Two owner JSON dumps (`ma-perkara-response.json`,
`spi-2024-response.json`) at repo root failed naming governance; moved (not
deleted) to `%TEMP%\kilo\`.

**Root-caused live bug**: the prior session's U-R draft carried a broken
parenthesis in `trustedFill` (`});` vs `}));`) — the service worker never
started, which is why Edge-headless pairing timed out. Neither `npm test`
(regex source contracts) nor the old `npm run check` parses runtime JS, so it
shipped green locally. `scripts/check.mjs` now runs `node --check` over every
discovered runtime `.js` file (recorded reason inline).

**Live popup attribution discovery** (Edge headless, `ur.*` scenarios):
Chromium attributes `window.open` fired during a background-tab CDP click to
the window's ACTIVE tab, not the clicked tab — `openerTabId`-only logging
misses exactly the automation case U-R targets. Fix: `resolvePopupOpener` in
`extension/lib/popup-events.js` + `withActionPopupTracking` in background.js
— while a `page.click`/`page.fill` is in flight, new tabs are claimed for the
acted-on tab; otherwise the real `openerTabId` is used. Covered by a behavior
test in `tests/timeout-retry-popup-parity.test.mjs`.

Shipped U-R (full detail in `docs/project-context.md` §U-R): expect-polling
window in content.js (slow SPA/OAuth redirect verifies without re-click),
fill retry/expect parity (synthetic + trusted post-action), coded
`COMMAND_TIMEOUT` → `outcome:'unknown'` parity (extension + MCP
`AWAIT_OUTCOME_UNKNOWN`), bounded popup log + `openedTabs` on click/fill
results, MCP instructions OAuth/expect guidance. Version 1.6.12 → 1.6.13 sweep.
Boundary locks rebaselined with U-R authorization notes (4×P2/P3/P4/P5 SHA1
maps, MCP SHA256 fixtures + inventory digests) — tool names/count/schemas are
byte-unchanged; only file digests moved.

Gates: `npm test` **517/517**; `npm run check` PASS (26 primitives, 76 runtime
files, 1.6.13, parse gate live); Edge-headless `tests/browser_extension_test.py`
**exit 0** with `urAcceptance` all-true:
`OA_BROWSER_HEADLESS=1 OA_BROWSER_EXECUTABLE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" python tests/browser_extension_test.py`
(Chrome/Edge: bundled Playwright Chromium does not start the MV3 worker; note
regular Chrome ≥137 also rejects `--load-extension`).

U-R implementation head: `00835f7` (pushed to origin
`feat/pre-8e-usability-repair-r8`; this SHA-recording docs commit follows on
top — verify the remote tip before the next write). Non-goals held: no MCP
schema/tool change, no refind, no production deploy, no CRX. Live
Opera-owner acceptance of 1.6.13 remains owner-gated, as do 1.6.11/1.6.12
CRX signing.

Remaining in this line: U-P2 (vision sampling) is the last proposed checkpoint
from the 2026-09-20 research; U-V live acceptance on a served release remains
open (owner-gated).

## U-P3 stale semantic pruning implemented (1.6.12 candidate) — 2026-09-28

Continuation session: the working tree carried an uncommitted U-P3
implementation from an interrupted writer (WIP file mtimes 2026-09-27
23:00–23:33 +07). Tree/mtimes were stable across the session and all gates
were re-verified green before commit.

Shipped on `feat/pre-8e-usability-repair-r8`: (A)
`extension/semantic-identity.js` — `invisibleGraceObservations` (default 2,
clamp 1..3): entities present-but-invisible for N consecutive observations
are marked `stale:true` on the model-facing item (advisory; canonical state
keeps them with identity/revision intact; the mark clears when visible
again); entities returning after the removal grace now report
`UPDATE … RETURNED_AFTER_ABSENCE` instead of `INSERT … NEW_ENTITY` (bounded
`returnedAfterGrace` set, cleared by `forget()`/`reset()`); (B)
`extension/content.js` — compact reads drop `stale` items so dismissed
panels/controls stop reaching the model. Version 1.6.12 sweep across
protocol/manifest/package/check + version-lock tests rebaselined. Protocol 1,
26 primitives, 22 MCP tools, schemas unchanged.

Gates: `tests/stale-semantic-pruning.test.mjs` 7/7; `npm test` 506/506;
`npm run check` PASS (26 primitives, 75 runtime files, 1.6.12). Live
acceptance steps were added to `tests/browser_extension_test.py` (`up3.*`
scenarios + dismissible panel in `tests/fixtures/pre-8e-usability-ax.html`)
but the live Opera run is NOT executed (owner-gated; the Edge-headless
command in the U-P1 section covers it when run).

U-P3 implementation head: `b45e8bf` (pushed to origin
`feat/pre-8e-usability-repair-r8`; this handoff update follows on top —
verify the remote tip before the next write).

Remaining in this line: U-P2 (vision sampling) is the last proposed
checkpoint from the 2026-09-20 research; U-V live acceptance on a served
release remains open (owner-gated); 1.6.11 (U-P1) and 1.6.12 (U-P3) sources
each need their own signed CRX when the owner orders a release; 1.6.10
remains the single active release.

## 1.6.10 ACTIVATED + 1.6.11 uploaded inactive 2026-09-24 (read first)

Owner ordered both. Executed and live-verified:

- **1.6.10 is the single active release.** Atomic flip via MCP `execute_sql`
  (single statement: `update opera_releases set active = (version = '1.6.10')
  where extension_id = 'ohbb…'`). Verified: one active row; `update.xml?id=`
  serves `version="1.6.10"`; 1.6.10 CRX 200 with 53,950 bytes SHA-256
  `7b3b9226…` (DB = disk = served); 1.6.9 CRX now 404. Rollback = same flip
  re-activating 1.6.9. Devices self-update on their next browser-scheduled
  update check (`opera_devices.extension_version` shows adoption).
- **1.6.11 (U-P1) is uploaded INACTIVE** — packed from a clean detached
  worktree of release head `d13a4b9` (CircleCI + Vercel SUCCESS verified on
  that exact head BEFORE signing, per the frozen gate). Artifact:
  `D:\Opera\opera-agent-1.6.11.crx` — **57,264 bytes**, SHA-256
  `1f6a1968030a2e994734d7f943dc582e996df1b9d5bcf7966c670a6afda9a462`.
  Offline-verified (verifier calibrated byte-exact against the production
  1.6.10 artifact): two-way ID `ohbbpamcljckmjhcpkcmefdobkoeaick` (manifest
  key + proof key + crx_id field), CRX3 RSA-SHA256 proof VALID, deterministic
  resign → byte-identical rebuild, all 13 packaged files match source.
  Management-API upload: DB bytes/SHA = disk; 1.6.11 CRX path 404 while
  inactive; single active row still 1.6.10.
- **NEXT (owner-gated)**: live acceptance of 1.6.11 in real Opera once a
  device runs 1.6.10 (watcher/skip + U-P1 shadow/axSummary + `resolved`
  telemetry), then explicit activation via the same atomic flip. U-V live
  acceptance remains open. Read-only lift window (15 min) from the upload
  auto-expires; if a later write hits `transaction_read_only`, lift via
  Management API `/readonly/temporary-disable` first.

## U-P1 AX-tree observation shipped 2026-09-24 (read first)

Implemented under the user's "faster and easier for AI (ChatGPT web)" order
(research → plan → execute). Evidence: `docs/checkpoint-up1-ax-observation.md`.
Version is now **1.6.11**. Branch head after this session is the U-P1 commit
on `feat/pre-8e-usability-repair-r8` (verify exact SHA via `git log -1`).

Shipped: (A) open-shadow-root piercing element collection + computed
`accessibleName` (img alt / svg title) matched by `page.find`/`page.wait_for`
and projected in compact reads — icon-only glyph controls (" 3 min") and
shadow-DOM controls are now findable/clickable through normal refs; (B)
`page.read` on text-poor pages (≤400 chars) attaches a read-only, value-free
`axSummary` from one CDP `Accessibility.getFullAXTree` collect (pure filter
in `extension/lib/ax-summary.js`; editable subtrees and AX values excluded,
fail-open). MCP guidance documents both; no new tools/schemas.

U-P1 implementation head: `0df9110875076eb550ba795f8baf179cd7e7fe48`
(pushed to origin `feat/pre-8e-usability-repair-r8`; this handoff update
follows on top — verify the remote tip before the next write).

Gates: node 499/499, `npm run check` PASS at 1.6.11, Edge-headless browser
regression EXIT 0 (six new `up1.*` scenarios, incl. shadow click end-to-end
and value-leak guards). Locks rebaselined with recorded reason: P2/P3/P4/P5
blob locks (content `0ea3094…`, background `bdeac6af…`, manifest `757191f0…`,
MCP index `5fc059f2…`), MCP sourceSha256
`5da5f3cef258b7b2b9da905351e233af56466bb85832f77ef6460bb7fec3cf1c`, inventory
digest `sha256:f672f8dd…` across the 7A/8A/6A/7F fixture chain.

Remaining in this line: U-P3 (stale semantic pruning) is now implemented as
the 1.6.12 candidate — see the top section; U-P2 (vision sampling) is the
last proposed checkpoint from the 2026-09-20 research; U-V live acceptance on
a served release remains open (owner-gated); the 1.6.10 CRX popup redesign
still awaits the owner's activation decision, and the 1.6.11 and 1.6.12
sources each need their own signed CRX when the owner orders a release.
Local browser regression command:
`OA_BROWSER_HEADLESS=1 OA_BROWSER_EXECUTABLE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" python tests/browser_extension_test.py`
(bundled Playwright Chromium does not start the MV3 service worker).

## 1.6.10 candidate uploaded inactive 2026-09-24 (v8 Warm redesign + Cursor logo)

Owner-driven design cycle (brainstorming skill, local previews at
`C:\Users\ASUS\freebuff-workspace\popup-tone-preview.html` + `popup-logo-lab.html`,
served by Python312 `http.server` on port 8478 from that folder — the old
8477 server dies on Freebuff restart; inline CSS into the preview to avoid
proxy fetch flakiness). Research: Vercel Geist DESIGN.md, Pencil & Paper
dashboard UX, Rams #10, 2026 UI trends (Liquid Glass/calm-tech). Owner ACC-ed the "v8 Warm Command" direction + the Cursor logo mark.

Shipped in `d7509bf`: full palette swap (warm charcoal `#16161a` dark /
`#fbfbfa` light, gradient teal tile `#2dd4bf→#0f766e`, soft-shadow floating
cards, badge tinted rounded-square, ghost danger button, 32px controls);
`popup.html` brand-mark replaced by inline-SVG **Cursor** (drives-the-browser
pointer); `popup.js:39` version string drops the "v" prefix
(`1.6.10 · Protocol 1`). Version sweep 1.6.10 across 17 files INCLUDING
`tests/efficiency.test.mjs` bridge cadence pins (now 8x50ms fast / 2000ms idle
— these were missed during the 2026-09-24 egress deploy, keep them in the
sweep list) and the 4 P2/P3/P4/P5 manifest hash-locks (re-derived via
`git hash-object`, new lock `56d142679e08bb95…`). Suite 490/490; browser
regression EXIT 0 (two timing-sensitive assertions flaked once across four
runs — `tabs.activate reused`, `etw_verified` — both pass on rerun,
untouched paths).

CRX packed from clean worktree at `d7509bf`: 53,950 bytes, SHA-256
`7b3b9226e481700c99af511039ea99a7e61cd27fe809a15964469af86aab13e4`,
two-way ID + signature + deterministic resign valid
(`D:\Opera\opera-agent-1.6.10.crx`). Uploaded `1.6.10 / active=false` via
Management API with the read-only lift; payload built programmatically from
the CRX on disk (temp payload files deleted after use). Post-upload state:
1.6.9 still the single active row, update.xml serves 1.6.9, 1.6.10 CRX 404s.
NEXT: owner decides activation (atomic flip 1.6.9 off / 1.6.10 on via MCP
`execute_sql`, same procedure as the 1.6.9 activation above).

## 1.6.9 ACTIVATED 2026-09-24 (owner-ordered)

Owner ordered activation of the popup second-pass build. Atomic flip executed
via MCP `execute_sql` (no PAT needed, no read-only lift required):
`update ... set active=false` for 1.6.7 then `active=true` for 1.6.9 — one
active row confirmed. Post-flip verification: `update.xml?id=` serves
version 1.6.9; CRX `opera-agent-ohbbpamcljckmjhcpkcmefdobkoeaick-1.6.9.crx`
returns 200 with 53,804 bytes, SHA-256
`6182119941dfd6f0b00b26c71090524fd49f117cb0a346f76fa54e0b25f499a1`
(DB = disk = served); 1.6.7 CRX path now 404s. Rollback = same atomic flip
with 1.6.7 (or 1.6.8). Note: the installed extension picks the new CRX up on
its next update check (update.xml is served `no-store`, browser checks are
browser-scheduled).

## Egress fix live: bridge claim-loop cadence 2026-09-24 (read first)

Owner asked how to cut org egress (dashboard 4.64/5 GB FREE, per-org across
both projects, resets each billing cycle). ClickHouse evidence over
`logs` (edge_logs, 24h): `/rest/v1/rpc/opera_claim_next` = 222,873 reqs —
95%+ of ALL platform traffic, flat ~13k/hour 24/7 from ONE paired device.
Root cause: bridge `pull()` long-poll ran `opera_claim_next` every 250ms after
6x50ms fast-polls (~52 claims per 12s pull). Both `opera_heartbeat` (2/min,
alarm 0.5min) and `update.xml` polling are negligible; BarangPas project is
close to idle. Note: a separate node-on-AWS caller hits
`relay_device_heartbeat` ~1k/hour under a `sb_publishable_jAbS_` key — not
from this repo; harmless bytes-wise but worth identifying later.

Fix deployed 2026-09-24T23:35Z: bridge v31 `FAST_PULL_POLLS 8` +
`IDLE_PULL_INTERVAL_MS 2000` (was 6/250ms) — deployed via MCP
`deploy_edge_function` (entrypoint index.ts, import_map_path deno.json).
Measured per-minute claim rate: ~215 before → ~66 steady-state after
(14 claims per 12s pull), −69%; worst-case idle latency for a new command
rises 250ms→2s, first ~400ms fast path unchanged. No 5xx on bridge after
deploy; update.xml still 200 serving 1.6.7. Suite 490/490 + browser EXIT 0
before deploy. Commit: see `git log` — "perf(bridge): cut idle claim-loop...".
If the 2s idle worst-case ever feels slow for real bursts, drop
IDLE_PULL_INTERVAL_MS to 1000 (−53% traffic vs old, 1s worst case).

Last synchronized: 2026-09-23 (repository-production sync session).
Session content head: `c9b0c74f0d7bc904ecb3e3c0a10a8fee0dcfc795` on
`feat/pre-8e-usability-repair-r8` (CI green: CircleCI `ci` + Vercel;
`main` fast-forwarded to it on 2026-09-23). Later handoff-only commits may
follow; verify the actual tip via `git log -1` and the remote before the
first write.

## U-V Action Pipeline + CRX 1.6.7 candidate — 2026-09-23 (read first)

U-V shipped on r8 `ee3c661`: one pure engine
(`extension/lib/action-pipeline.js`) wraps every action route (MCP, burst,
workflow, ETW) with Resolve→Wait→Heal→Execute→Verify. Success envelopes carry
`resolved{attempts,waitedMs,healed,verified}`; dead targets return structured
`TARGET_NOT_READY` (message preserved verbatim for legacy consumers) instead of
the stale dead-end string; sensitive targets hand off to their executor guards
(masked) instead of stalling the deadline. Full details + evidence:
`docs/checkpoint-uv-action-pipeline.md`. Suite 489/490 (pre-existing #268);
browser regression EXIT 0; version 1.6.7.

CRX 1.6.7 built from a clean worktree at `ee3c661`, offline-verified
(53,583 bytes, SHA-256 `6485f74de0213d5fbec9bb43398bd113e15c40dfaef7a3926d14dd8a58248496`,
two-way ID `ohbbpamcljckmjhcpkcmefdobkoeaick`, signature + deterministic resign
valid). **Uploaded INACTIVE 2026-09-23 evening** after the owner supplied a
fresh PAT (the old DPAPI `management-token.dpapi` from 2026-09-16 is 401-stale
— rotate or re-save it; do not rely on it): the Supabase project was in
read-only mode (`transaction_read_only=on`), lifted via the documented
`/readonly/temporary-disable` (15-minute window) with the new PAT, then the
`opera_releases` row was inserted `1.6.7 / active=false` (base64 71,444 chars =
53,583 bytes; DB SHA-256 equals the disk SHA). Verified post-upload:
exactly one active row (1.6.6), `update.xml?id=` still serves 1.6.6, and the
1.6.7 CRX path returns 404 while inactive.

## 1.6.9 candidate uploaded inactive 2026-09-24 (popup second pass)

Owner feedback on 1.6.8: "masih sama" — at the ~200px width the popup actually
renders at, 1.6.8 still looked bushy (wrapping local-only chip, looming
label/value stacks, block-filled buttons). Second pass `c1d60b4`: 12px base,
9px uppercase section labels, ONE accent (primary; danger is ghost red),
hairline secondary buttons, compact rows, nowrap status chip, uppercase
micro-label rows in the narrow layout. Version sweep 1.6.9 (suite 490/490,
browser exit 0). CRX offline-verified: 53,804 bytes, SHA-256
`6182119941dfd6f0b00b26c71090524fd49f117cb0a346f76fa54e0b25f499a1`; uploaded
`1.6.9 / active=false` (DB SHA = disk); single active row remains 1.6.7;
update.xml serves 1.6.7; 1.6.9 CRX path 404s while inactive. Artifact:
`D:\Opera\opera-agent-1.6.9.crx`. 1.6.8 remains available inactive as the
first-pass alternative.

## 1.6.8 candidate uploaded inactive 2026-09-24 (popup redesign)

Popup visual language reworked to a polished-enterprise style (type scale,
tabular numerals, calm palette, focus rings, stable hovers) — `87c7bdc` — then
version sweep to 1.6.8 `b574e50` (suite 490/490, browser regression exit 0).
CRX packed from a clean worktree at `b574e50`, offline-verified: 53,908 bytes,
SHA-256 `aecf0c104c9c7f4a89b1db002769f119172163dc794934b98c50dc5f2e77ff75`,
two-way ID + signature + deterministic resign all valid. Uploaded
`1.6.8 / active=false` (DB SHA = disk); verified post-upload: single active row
is still 1.6.7, `update.xml?id=` serves 1.6.7, and the 1.6.8 CRX path 404s
while inactive. Artifact: `D:\Opera\opera-agent-1.6.8.crx`. Next: owner
side-load, eyeball the new popup, then decide activation (rollback = 1.6.7 row
stays intact).

## 1.6.7 ACTIVATED 2026-09-23 (owner-ordered, supersedes acceptance-first ordering)

Owner explicitly ordered activation before live acceptance (recorded reason:
release-train timing; rollback exists by re-activating 1.6.6 via the same
atomic flip). Executed and verified against live production:

- Read-only mode lifted again via `/readonly/temporary-disable` (window had
  expired), then **atomic flip in one transaction**: `1.6.6` -> `active = false`,
  `1.6.7` -> `active = true`. Verified: exactly one active row for
  `ohbbpamcljckmjhcpkcmefdobkoeaick`, and it is `1.6.7`
  (sha256 `6485f74de0213d5fbec9bb43398bd113e15c40dfaef7a3926d14dd8a58248496`).
- Live serving chain: `update.xml?id=` now serves `version="1.6.7"` with the
  correct codebase; the `1.6.7` CRX path returns HTTP 200 with 53,583 bytes
  whose SHA-256 equals the DB row AND the offline-verified disk SHA
  (`SHA_MATCH_DISK: YES`).
- Rollback path: `1.6.6` row intact (inactive); its CRX path 404s while
  inactive. Roll forward-back = one atomic flip re-activating 1.6.6.
- Devices self-update via the update service; the local Opera device may need
  a restart or manual update check to pick up 1.6.7 (check
  `opera_devices.extension_version`). U-V live acceptance (YouTube skip in one
  command, `resolved` telemetry) remains open and should now be run on 1.6.7.

## Repository-production sync executed 2026-09-22 — read first

Owner asked to check GitHub, Supabase, and local state and synchronize, then
continue unfinished work. Findings and actions (all verified against live
state):

- Local `feat/pre-8e-usability-repair-r8` HEAD `c9b0c74` equals `origin/main`;
  the gateway repair and this sync were committed and pushed. CI green on both
  evidence heads (`715031d` and `c9b0c74`: CircleCI `ci` SUCCESS + Vercel
  SUCCESS; SonarCloud failure is the PR static gate and no PR is open).
  `main` fast-forwarded to `c9b0c74` on 2026-09-23.
- Ten local migration files carried version IDs differing from production
  `schema_migrations` records (names matched). Renamed via `git mv` to the
  production IDs (`20260908021039`, `20260908031756`, `20260908035531`,
  `20260908074202`, `20260910121107`, `20260911162525`, `20260911162819`,
  `20260911231331`, `20260912061541`, `20260912061656`) with test path updates
  in `tests/ledger-server.test.mjs`, `tests/reactive-vm-host-7e.test.mjs`,
  `tests/reactive-vm-host-7e-boundaries.test.mjs`, and
  `tests/postgres/transaction-journal-8d.test.mjs`. Focused suites pass
  (15/15 and 15/15); `npm run check` PASS at 1.6.6. The postgres fixture test
  cannot run locally (`OPERA_PG_BIN` unset, no native PostgreSQL); CI covers it.
- Production ledger was missing records for two verified-applied migrations:
  `20260921163000` `opera_agent_youtube_skip_ads_workflow` and `20260922000000`
  `opera_agent_ut_etw`. Both recorded in `schema_migrations` (41 rows now)
  with pointer statements; exact SQL lives in the tracked repo files, not the
  ledger.
- Three migrations in the accepted line were NEVER applied to production:
  `20260919171500` `pre_8e_r5_media_fast_path` (workflow `media.sample_at`
  absent), `20260919213000` `pre_8e_r6_navigation_fast_path` (production
  `youtube.play_recommendation` still v2 with the pre-R6 body, `updated_at`
  2026-09-08), and `20260920090000` `pre_8e_r7_transcript_cleanup`
  (production `youtube.get_transcript` still v4 with 16 steps vs the R7
  14-step v5 body). They are deliberately NOT recorded in the ledger.
  Applying their content to production is a separate explicit owner decision;
  U-T event-triggered workflows may supersede the R5/R6 fast-path intent.
- Remaining unfinished: independent audit re-review of the gateway repair
  (owner-gated), and live acceptance — now UNBLOCKED by the 1.6.6 activation
  below.

## 1.6.6 ACTIVATED 2026-09-23 (owner-ordered, supersedes acceptance-first ordering)

The owner explicitly ordered activation (the AGENTS.md separate explicit user
decision). This inverts the frozen release-workflow ordering ("upload
inactive, then acceptance before activation") with a recorded reason: devices
on 1.6.5 lack the ETW watch engine required for live acceptance, so
acceptance mechanically needs 1.6.6 served first; rollback exists (re-activate
1.6.5 via the same atomic flip).

Executed and verified against live production:

- Atomic flip in one transaction: `1.6.5` -> `active = false`, `1.6.6` ->
  `active = true`. Verified: exactly one active release for
  `ohbbpamcljckmjhcpkcmefdobkoeaick`, and it is `1.6.6`
  (sha256 `a33e5f36e805a240c2399415656373fad1461b9630299f2abf4f2d5b4de58e9b`).
- Live serving chain: `update.xml` with the signed identity (`?id=` query
  param; the bare path intentionally falls back to the legacy identity per
  `requestedExtensionId`) now serves `version="1.6.6"` with the correct
  codebase; the `1.6.6` CRX path returns HTTP 200 with 50,049 bytes whose
  SHA-256 equals the DB row and the offline-verified disk SHA.
- Devices self-update via the update service; the local Opera device may need
  a restart or manual update check to pick up 1.6.6.

Next: live acceptance in a tool-capable client via the OAuth Opera Agent
connector (watcher skips a real ad, zero analysis trips), then the
independent audit re-review.

## Gateway transaction repair: COMMITTED and DEPLOYED (supersedes awaiting-review state)

The repair was committed at `715031d` on `feat/pre-8e-usability-repair-r8`,
pushed, and `main` was fast-forwarded to it. CI on the exact head is green
(CircleCI + Vercel; SonarCloud is the PR static gate with no open PR). The
gateway is deployed and byte-exact verified (version 2, `ACTIVE`, `verify_jwt:
false`; see the U-T section below). The earlier awaiting-review/uncommitted
state and the "push remains on explicit owner request" note are historical.

Historical baseline: `58264c5f2ffafe8e94ca8c51d2cae43019f5f768` on
`feat/pre-8e-usability-repair-r8`. The owner explicitly confirmed no other
writer and allowed edits despite untracked `.kilo/` and `graphify-out/`;

Local changes: gateway now uses authenticated device preflight followed by
separately awaited `opera_enqueue` and `opera_await_adaptive` requests, retaining
one external HTTP request. This fixes queue invisibility caused by the old
wrapper waiting before its enqueue transaction commits. Pairing/offline guards,
enqueue rejection, request-ID passthrough/reuse, structured 200 results and
401/502/504 behavior remain covered. The heartbeat guard uses gateway time
instead of SQL time; verify hosted behavior before rollout. No SQL or other
Edge Function was changed; direct callers of `opera_run_fast` remain affected.

Evidence: new `tests/gateway-transactions.test.mjs` initially failed 4/6 before
runtime edits, specifically detecting the combined transaction path. After
repair, `node --test tests/gateway-transactions.test.mjs tests/etw-watch-engine.test.mjs`
passed 14/14. `npm run check` passed (72 files, 26 primitives, version 1.6.6).
`npm test` passed 477/478; the sole failure is the root allowlist check on
existing `.kilo`, `.opera-agent-8d-state`, `deno.lock`, `graphify-out`, and
`node_modules`. The defective one-SQL-call source assertion was replaced by
executable ordering coverage, not by relaxing safety checks.

Audit follow-up: the owner supplied an independent P2 finding that a failed
await RPC after enqueue commits returned generic 502 without command identity
or an uncertain-outcome warning. Added a tests-first regression (6/7 passed,
new test failed on missing commandId), then caught only post-enqueue await
errors. HTTP 502 / GATEWAY_ERROR remain; the response adds commandId,
outcome="unknown", and an explicit verify-before-repeating warning. No retries.
The regression covers returned RPC errors and thrown transport errors with no
requestId, asserting exactly one enqueue and one await call. Focused suite now
passes 15/15; static checks pass. The full-suite evidence above predates this
follow-up and was not rerun. The owner reports the audit otherwise confirmed
auth, signatures, grants and the prior 14/14 focused result.

Remaining: independent audit re-review of this fix and live acceptance under
separate explicit authorization. CI evidence is green on `715031d` and the
hosted deploy is complete (version 2, byte-exact). Tests execute the gateway
handler with mocked Supabase transactions, not a live DB or device. The
earlier no-deploy/no-commit statements are historical: the deploy, commit,
and push were completed on 2026-09-22. The prior deploy-ready instructions
below are historical: do not deploy the baseline gateway or call the combined
RPC as a workaround. This section supersedes older exact-next steps.

## U-T Event-Triggered Workflows implemented (1.6.6 candidate) — read first

2026-09-22. Owner reframed the target: the remaining latency is the model
trip pattern itself (request snapshot → analyze seconds → act). Checkpoint
**U-T** eliminates the pattern per the approved plan: the model compiles
intent into device-local watch rules ONCE (`watch.start` primitive family:
`watch.start/stop/stop_all/list`, internal — protocol stays frozen at 26),
the extension evaluates them continuously (`extension/lib/watch.js` pure
engine: presence/gone/text/url/adState/mediaTime, already-true-at-arm fires
immediately, debounce/deadline/maxEvents bounded, 8/tab + 32 global caps,
site-agnostic — ad selectors live in the rule, not the extension) and fires
LOCAL actions through the proven paths (page.click trusted, runBurst,
relay workflow). Events reach the model via `wait_events` (MCP tool →
`opera_watch_events_wait` long-poll over `opera_watch_events`) with action
evidence attached; `stop_watch` disarms. Universal fastpath: new
`opera-agent-gateway` edge function — POST /command = ONE HTTP hop via
`opera_run_fast` (enqueue + `opera_await_adaptive` ramp 5→30 ms then 50 ms in
one SQL call), token verified first via `opera_verify_device` (header or
body.apiKey — GPT Actions cannot set headers), GET /openapi.json is
GPT-Actions-ready. Bridge gained `watch_event` ingest + `start_workflow`
device path. Gates: node suite 471/472 (single fail = pre-existing local
governance artifact #250), check PASS at 1.6.6, browser regression EXIT=0
(Edge headless): the fixture control appearing 1.2 s AFTER arming was clicked
locally with zero model trips. MCP inventory 19→22 (start_watch, wait_events,
stop_watch — OBSERVATION class); contracts/thresholds/hash-locks rebaselined
with this reason. See `docs/checkpoint-ut-etw.md`. CRX 1.6.6 signed,
verified offline (50,049 bytes, SHA-256 `a33e5f36…`, CRX3 signature + two-way
ID + deterministic resign proven via the calibrated verifier) and uploaded
inactive — disk SHA equals the DB row SHA, `update.xml` still serves 1.6.5
and the 1.6.6 CRX path 404s while inactive. The ETW migration is DEPLOYED to
hosted and verified live (`opera_watch_events` table;
`opera_watch_event_ingest`, `opera_watch_events_wait`, `opera_await_adaptive`,
`opera_run_fast` RPCs; `youtube.skip_ads` enabled; devices still on 1.6.5).
Remaining before activation: live acceptance (watcher skips a real ad,
zero analysis trips). The `opera-agent-gateway` edge function is now
**DEPLOYED to hosted and verified (2026-09-22, direct Supabase connection,
owner-authorized without DPAPI):** version 2, `ACTIVE`, `verify_jwt: false`
(owner disabled "Verify JWT with legacy secret" in the dashboard after the
Management deploy tool landed the function with platform JWT enforcement and
a redeploy reset the toggle; with no further deploy it held). Final smoke
(11:28 UTC): `GET /health` 200 `ok:true, version 1.0.1`; `GET /openapi.json`
200 with `servers[0].url` exactly
`https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway`;
`POST /command` without token 401 `UNAUTHORIZED` (gateway envelope). Hosted
source verified byte-exact against the working tree (SHA-256 `1ad1489668…`,
9508 bytes, `EXACT EQUAL: True`). The hosted proxy rewrites the request URL
(strips `/functions/v1`), so the openapi base path now comes from
`SUPABASE_URL` instead of `url.origin` (regression-tested, focused suite
16/16, `npm run check` PASS). The gateway itself was also repaired locally:
separate awaited `opera_enqueue` / `opera_await_adaptive` RPC transactions in
one caller HTTP request (the former `opera_run_fast` wrapper hid the queued
command until timeout inside one SQL transaction); post-enqueue wait failures
keep HTTP 502 `GATEWAY_ERROR` with `commandId`, `outcome: "unknown"` and a
verify-before-repeating warning; no retries. Gateway/ETW focused suite 16/16;
full `npm test` 477/478 (single fail = pre-existing local root-governance
artifact); `npm run check` PASS. Everything else is READY:
`deno.json` added (mirror of bridge's), gateway hardened (spec
`servers` now carries the full `/functions/v1/opera-agent-gateway` base path
so GPT Actions hit the right URL; 504 described; structured device failures
returned as 200 so AI callers can read the envelope) —
then live acceptance (watcher skips a real ad,
zero analysis trips) in a tool-capable client via the OAuth Opera Agent
connector (no Opera/MCP tools were exposed in this session; Edge-headless
fixture results are not live acceptance).

## U-S burst atomic actions shipped, 1.6.5 ACTIVATED — superseded by U-T above

2026-09-21. The live T041 rerun on 1.6.4 (15:29 UTC) proved target selection is
fixed but the model round trip kills dynamic controls: find at 15:29:36.329Z
selected the real Skip control perfectly; the click 14.1 s later hit "Element
not found or reference is stale" — the node was destroyed with no successor, so
even I4 rebind could not help. Grounded in the JIT-Planner (ICML 2026) and
Efficient GUI Agents (arXiv 2609.02309) literature, checkpoint **U-S** shipped:
(1) **burst ref passthrough** — burst click/fill steps take `refFromStep`/
`refIndex` from an earlier find/query step in the same burst (forward refs
rejected at validation; results annotated `resolvedFrom:"step:N"`), so
find→click→verify now runs in ONE command: measured **161.6 ms** vs the
14,100 ms live round trip in `us.burst.find-click-wait` (Edge headless,
exit 0); (2) **`run_workflow` MCP tool** (inventory 18→19, contracts
rebaselined with recorded reason) calling the audited `opera_start_workflow`
pg_net path + polling `opera_get_workflow_run` — closing the "insert row does
not execute anything" gap; (3) versioned **`youtube.skip_ads`** workflow
migration: bounded re-query-every-iteration skip loop with ad-state
post-condition. Version 1.6.5; node suite 463/464 (single fail = pre-existing
local governance artifact); `check` PASS; see
`docs/checkpoint-us-burst-atomic-actions.md`. Live T041 acceptance PASSED and
production activation is DONE — see the 1.6.5 release section below.

## 1.6.5 ACTIVATED in production — the U-S release

2026-09-22. Artifact `D:\Opera\opera-agent-1.6.5.crx` — 43,634 bytes,
SHA-256 `584a200517c7b7bd7e3c90a3cbb88cd7dbe477cda3311a1d3f129b7e051ead6d`,
packed from a clean worktree of build head `12b2c88` (CircleCI + Vercel
SUCCESS) and signed offline with the established identity key
(`D:\Opera\signing-private\opera-agent-new-identity.pem`). Offline proof:
extension ID derived from the AsymmetricKeyProof public key =
`ohbbpamcljckmjhcpkcmefdobkoeaick` AND present as the CRX3 crx_id field —
two independent derivations agree; RSA-SHA256 CRX3 SignedData proof VALID via
the Chromium-exact construction (`CRX3 SignedData\x00` + u32le(size) +
`SignedData{crx_id}` + archive), calibrated against the production 1.6.3 and
1.6.4 artifacts (both also VALID). Registry row `1.6.5 / active=false`
uploaded through the audited DPAPI Management write path; DB byte length and
SHA-256 match the artifact exactly. **Live acceptance on the side-loaded 1.6.5
PASSED (2026-09-22):** organic T041 (find → synthetic click ignored by player
→ fresh-ref trusted/debugger click → ad gone, main video playing) and the
single-burst T041 (`find("Skip") → click(refFromStep:0)`, `ok:true`,
`resolvedFrom:"step:0"`, 645.7 ms total / 43 ms find + 601.9 ms click, zero
stale errors) both skipped real YouTube ads. The `youtube.skip_ads` workflow
registration migration was applied to the hosted database (owner-initiated
`opera_run_workflow` had returned WORKFLOW_NOT_FOUND because only the repo
file existed); `opera_register_workflow` returned `ok:true, version:1` and the
workflow is verified alongside the other `youtube.*` entries. Zero production impact was verified pre-activation:
`update.xml?id=ohbb…` still served 1.6.2 and the identity CRX path for 1.6.5
was 404 while inactive. **ACTIVATED 2026-09-21 23:37 UTC** through the audited
DPAPI write path: one atomic identity-scoped update set `1.6.5 / active=true`
and every other opera-agent row (1.6.2–1.6.4 included) `active=false` —
exactly one active row (verified `active_count=1`); the unrelated legacy
identity `pagjlnoh…` (1.0.1 active) was left untouched. Public release path
verified post-activation: `update.xml?id=ohbbpamcljckmjhcpkcmefdobkoeaick`
advertises 1.6.5 and its codebase URL returned HTTP 200 with 43,634 bytes,
SHA-256 `584a200517c7b7bd7e3c90a3cbb88cd7dbe477cda3311a1d3f129b7e051ead6d`
identical across the DB row, the disk artifact, and a fresh download.
Rollback: rows 1.6.2/1.6.3/1.6.4 remain present (inactive) and
`D:\Opera\opera-agent-1.6.2.crx` is on disk for re-install.

## Signed 1.6.4 candidate built and uploaded inactive — superseded by U-S above

2026-09-21 evening. The 1.6.4 candidate (U-I + I4) is built, signed, verified,
and uploaded **inactive**. Exact build head `3f947d3` (version sweep commit,
contains U-I `d230451` + I4 `6e9ddd7`) passed CircleCI + Vercel before packing.
Artifact: `D:\Opera\opera-agent-1.6.4.crx` — 42,908 bytes, SHA-256
`0a9fe577e7493e4c4046bddf89000821045a02788ecd71ffe5f2e8a21782d5f3` — packed
from a clean detached worktree with `--pack-extension-key` against the
established private key; offline verification reproduced the established
extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick` from the proof public key and
the RSA-SHA256 CRX3 SignedData proof verified VALID (verifier calibrated
against the production 1.6.3 artifact; SignedData = `CRX3 SignedData\x00` +
uint32le(shd.size) + shd + archive, no archive-size field). Registry: one
`opera_releases` row `1.6.4 / active=false` uploaded through the audited
DPAPI-encrypted Management-token write path; decoded bytes and SHA-256 match
exactly; update.xml still serves active 1.6.2; identity CRX path for 1.6.4
returns 404 while inactive.

Next: owner side-loads `D:\Opera\opera-agent-1.6.4.crx` in real Opera (same
identity, replaces 1.6.3 in place) and repeats the T041 Skip-path live
acceptance — with I4, the find→click Skip path should survive YouTube's no-id
control re-render. Record evidence either way; on failure roll back by
re-installing `D:\Opera\opera-agent-1.6.2.crx`. Production activation of 1.6.4
remains prohibited until that live acceptance passes.

## I4 signature rebind + live T041 evidence — read before anything else

Same day, later: the installed 1.6.3 candidate (pre-U-I) **failed its live T041
rerun** the same way 1.6.2 did — `page.find "Skip"` now returns the correct
dominant item (R8 find repair verified live, 07:47:38Z), but the click 6.8 s
later died with `Element not found or reference is stale` because YouTube
recreates the Skip control without its id and the keyed rebind pool emptied.
Full evidence in `docs/checkpoint-ui-identity-hardening.md` (I4 section).
A bounded **signature rebind fallback (I4)** was implemented tests-first on
r8: when a keyed successor disappears, a unique intrinsic-signature
replacement (visible text/label + tag + explicit fields, actionable,
non-sensitive) may rebind — uniqueness still required, mint-time geometry
still the last guard. Local gates green again (454/455 node; check PASS;
browser regression **exit 0** Edge headless incl. the new I4 scenario);
content.js locks rebaselined `0340d471…` → `2ee26615…`. Exact-head CI on the
pushed I4 head is the remaining acceptance step. **A new signed version is
required for the fix to reach real Opera** — the installed 1.6.3 predates both
U-I and I4; do not activate any candidate before its live T041 passes.

## U-I identity hardening implemented on r8 — read first

After the R8/1.6.3 state below was recorded, the user asked for a change that
makes the agent "faster and easier for ChatGPT web to use". U-I (research
methods I1/I2/I3) was implemented **tests-first on this same branch by a
separate writer**; see `docs/checkpoint-ui-identity-hardening.md` for the
full contract and evidence. Short form: geometry-aware rebind rejection
(24 px document-coordinate tolerance; refusal names current candidates),
`page.find` ambiguity `candidateRank`+`hint` annotations, bounded `fuzzy`
projection on zero exact matches, and a visible-text → closest-actionable
fallback (I3). Public MCP inventory, schemas, protocol, and primitives
unchanged. Local gates green (453/454 node — one pre-existing local-only
governance failure; check PASS; controlled-browser Edge headless=new exit 0
with three new U-I scenarios); content.js blob locks rebaselined
`9872dd3e…` → `0340d471…` with the reason recorded. The one-writer rule was
respected: this writer did not touch the working tree before verifying it
matched the handoff head. Exact-head CI (CircleCI + Vercel) on the pushed U-I
head is the remaining acceptance step under the standing authorization. The
signed 1.6.3 gate section below still governs production activation; U-I
rides the 1.6.3 candidate source until a newer signed version is explicitly
prepared.

## R8 signed release gate — read first

**Latest outcome: R8 T041 FAILED and production safely rolled forward to signed
1.6.2.** The original prompt completed, but `find("Skip")` used explicit
`limit:20`, exposed two candidates led by offscreen `Skip navigation`, suffered
two stale ref clicks, and required coordinate fallback. See
`docs/pre-8e-performance-usability-r8.md`. Opera installed `1.6.2_0`; ping
completed in 408 ms with pairing, Protocol 1, and 26 capabilities intact. Stop:
do not start a new repair, merge 1.6.1 to main, tag it accepted, or start 8E
without explicit authorization.

The user then explicitly authorized the bounded T046-T052 repair. Tests-first
source now selects a unique exact-actionable `item` even when callers request an
explicit diagnostic limit, while retaining all `items`, equal ambiguity, and
explicit index authority. A bounded browser hit-test override corrects false
ancestor-clipping negatives without promoting genuinely clipped controls.
Controlled browser, static checks, and 444 canonical local Node tests pass.
Exact-head CI, version >1.6.2 signing, audit, and repeat live T041 are still
required. Production remains on 1.6.2; do not activate a candidate yet.

Candidate source is versioned 1.6.3. Repair head `78e038b` has CircleCI #301 +
Vercel SUCCESS. The versioned release head `f1458c3` has CircleCI #302 + Vercel
SUCCESS, verified through the GitHub commit status API on 2026-09-21. Local
1.6.3 static, controlled-browser (55/55 background-focus, 20/20 burst stability,
all R8 find gates), and version-contract gates pass; the local Node suite shows
448/449 with the single governance failure explained by ignored local root state
that is absent on clean CI checkouts.

The signed 1.6.3 artifact is built and verified offline: CRX3 at
`D:\Opera\opera-agent-1.6.3.crx`, 40,690 bytes, SHA-256
`60bab5e1aae66f6f3ac34f56e2f75644da9c86e1731a294fb4098c0fd2a93897`, packed from a
clean detached checkout of `f1458c3` with the private signing key kept outside
the repository. The RSA-SHA256 proof verifies against the CRX3 specification
over `CRX3 SignedData\x00` + signed_header_size + signed_header_data + archive
with the manifest public key; manifest key and proof key both derive the
established extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`, and all 10 packaged
files match the source byte-for-byte.

The independent Codex audit on head `2ae2016` returned **PASS** with no blocking
findings. After the audit, the 1.6.3 registry row was uploaded inactive through
the audited Management write path (DPAPI-encrypted credential, value never
exposed): the database-decoded bytes reproduce the recorded 40,690-byte artifact
and SHA-256 exactly, 1.6.2 remains the sole active row for the identity,
identity-specific health/XML still serve 1.6.2, and the identity-specific 1.6.3
CRX path returns 404 while the row is inactive.

Next: bounded live R8 acceptance in the owner's real Opera — side-load the
signed 1.6.3 CRX (same identity, replaces 1.6.2 in place), repeat the T041
Skip-path acceptance, and record evidence. If it fails, roll back by manually
re-installing `D:\Opera\opera-agent-1.6.2.crx`. Production activation remains
prohibited until that live acceptance passes.

The user explicitly authorized a same-identity signed `1.6.1` update through the
production update service. Implementation/release head
`f38eddef508b96ec4df641af56377c611030ddf5` has CircleCI #295 + Vercel
SUCCESS. Offline signed artifacts are:

- `1.6.1`: 40,441 bytes, SHA-256
  `8c980dbe37cbccf2f272e45e8045fd7d6e91ad0d666dd289bc65eccaa6d49b1e`;
- forward rollback `1.6.2`: 35,631 bytes, SHA-256
  `bca7d9d5199f0075ac41fcc929e260943acd8c4e1e076fc26cf9294c408a085a`.

Both manifest and CRX proof keys derive established ID
`ohbbpamcljckmjhcpkcmefdobkoeaick`; neither artifact nor private key is in Git.
The 1.6.2 behavior source is exactly accepted tag `v1.6.0` commit
`96ef1cfdbecc7c5c0e40486b6378501db606b84d`, with only the three packaged
version surfaces changed to 1.6.2. Its 10 packaged files match prepared source,
and the accepted 1.6.0 browser harness passes with 20/20 burst stability and
55-command focus preservation.

Production stores both signed artifacts. Database-decoded hashes/sizes match the
local evidence; after the failed gate the audited atomic rollback made 1.6.2 the
sole active row, with 1.6.0 and 1.6.1 inactive. Identity-specific health/XML and
the public download match 1.6.2 exactly. Two earlier audits
returned CONDITIONAL PASS because registry pointer rollback alone cannot
downgrade a browser that installed 1.6.1. The final independent audit on exact
head `248d73ec05713a2f2b7682a3fb43fc3805279cef` returned **PASS** after
verifying both CRX artifacts, identities, packaged bytes, exact-head CI, and the
forward-rollback procedure. That rollback has now completed. T039-T040 are done;
T041 failed and T042-T045 remain open. Milestone 8E remains paused.

The locally DPAPI-encrypted Management credential supplied the audited write
authority without exposing its value. The pre-existing root `deno.lock` was
verified as history-free partial local Deno
CLI resolver state and is ignored explicitly as `/deno.lock`; its local contents
were not deleted or committed.

## U-V1 closed — 2026-09-20 (read first)

**U-V1 (self-verifying actions) is ACCEPTED / CLOSED on CI evidence.** Actions
now verify themselves in-page: `page.click` accepts internal `expect`
(`urlChanged/urlContains/selectorAppears/selectorGone/textGone/minMutationDelta`)
evaluated inside postAction evidence (`verified`, per-check `expectations`) at
zero extra round trips, `retry:{attempts}` bounded 1–3 drives re-execution on
verification failure, anchors expose `fallbackHref` when unverified, and
`page.wait_for` gains `absent:true`. Burst timeouts preserve the successful
prefix (`timedOut:true`, `BURST_TIMEOUT`, "completed steps may have taken
effect") matching the V2 unknown-outcome contract. MCP inventory stays frozen
(18 tools, unchanged schemas — internal params follow the R4 precedent).
Evidence: `docs/checkpoint-u-v1-self-verifying-actions.md` (controlled-browser
acceptance all green). Remaining proposed checkpoints: **U-I** (identity
hardening), **U-P1** (CDP AX-tree observation), **U-P3**, **U-P2**. The older
R8 environment blocker is superseded by the signed release gate above.

## Research + quick wins — 2026-09-20 (perception / identity / verification)

Owner field tests across nine hard websites (Figma, Maps, Miro, YouTube, Docs,
X, Instagram, 2048, Browserling) were turned into a method matrix in
`docs/research/perception-identity-verification-2026-09-20.md` (classes P/I/V,
code-verified attachment points, measured production tail data). Implemented in
this session (gates green, hash locks rebaselined with recorded reasons):
(1) statement timeouts now report `outcome:"unknown"` / `AWAIT_OUTCOME_UNKNOWN`
in the workflow runner and MCP `toolError` instead of a raw failure — verify
state before retrying; (2) `page.read`/`query` items gain `fullyInViewport` and
`viewportClipped` (overlap vs containment truth; explains Maps `x=-344`);
(3) model-facing label/text/name/placeholder strips private-use glyphs and
`Visited link` suffixes (fixes exact-match brittleness); (4) MCP instructions
add guidance: canvas/visual surfaces → `capture_page`; find-0-with-visible-text
→ ancestor clickable or capture; Maps results are viewport-scoped; verify state
before repeating after timeouts. Proposed checkpoints awaiting authorization:
U-V1 (expect param + burst partial results), U-P1 (CDP accessibility-tree
observation — flagship for canvas/shadow/virtualized), U-I (geometry-aware ref
validation + ambiguity-ranked find), U-P3 (stale semantic pruning), U-P2
(vision sampling). MCP/runner changes are code-only — **deploying the Edge
Functions to production remains a separate explicit decision**.

## R7 closeout — 2026-09-20 (read first)

R7 (T034–T038) is **IMPLEMENTED / CLOSED on CI evidence** under the standing
authorization. `youtube.get_transcript` v5 (migration
`20260920090000_pre_8e_r7_transcript_cleanup.sql`) collects transcript segments
directly (`ytd-transcript-segment-renderer`, limit 100, visibleOnly false) as
the primary path with the v4 chunked full-text reader preserved verbatim as the
bounded fallback; the unconditional `previousActive` read moved into the
activation branch; primary output carries segments only (no full-page text
noise). T037 closed via its evidence-backed residual-bottleneck clause: the
frozen 20.514s baseline is a single non-distributional run (v3 measured 4.6s
p50 with a one-parameter diff), and the recorded residual is the panel-open/
render wait path — needing R8 real-Opera distribution data or a redesign beyond
R7 scope. Evidence: `docs/pre-8e-performance-usability-r7.md`. Production DB
access is available read-only via `SUPABASE_ACCESS_TOKEN` (user env var; token
`opera-agent-zcode`, Read-only preset, project-scoped, expires 2026-12-19).
**Superseded:** Opera is now installed and the signed 1.6.1/1.6.2 release path
has final audit PASS. Exact next is the authorized inactive-upload and bounded
activation procedure described at the top of this handoff. Milestone 8E remains
paused.

## Production usage observations — 2026-09-20 (backlog seed)

The owner ran production E2E tests (ChatGPT + 1.6.0 extension + Supabase):
YouTube (3Blue1Brown, played to 18:39/18:39 via internal media.seek) and Google
Maps (search/reviews/directions near UII). Full report + repair-track mapping:
`docs/production-usage-observations-2026-09-20.md`. Confirmed the R7 residual
bottleneck with field data (the two v4 failures 14.0 s/16.5 s = the recorded
failed runs). New backlog, top first: (1) transport timeout ≠ action failure —
`browser.burst` timeout with the action already applied (critical correctness);
(2) click ok ≠ state transition — verify expected state + automatic `href`
fallback; (3) description-expand → Show-transcript path fix; (4) caption
detector unreliability; (5) queue tail latency (14.3 s spike) to be measured in
R8/T040; (6) semantic/UI mismatch + stale panel residue; (7) geometry truth for
transformed panels (`x = -344` with `inViewport = true`); (8) exact-match
brittleness with glyph labels; (9) media primitives MCP exposure — 8E decision
(F5). SonarCloud quality gate fails on New-Code reliability; the known
check.mjs sort issue is already fixed at f3051a8 — re-check the next analysis
or inspect with a SONAR_TOKEN.

## Consolidation authorization — 2026-09-19 (supersedes the main-merge caution below)

The user reviewed the repository survey (32 remote branches, four divergent
lines, stale `main` at the 1.5.2 era while the update service actively serves
1.6.0) and explicitly ordered: fix everything now, tidy the repository, and add
strict rules preventing the next AI session from repeating the same mistakes.
Because R6 is now ACCEPTED/CLOSED (no longer an in-progress track), the earlier
"Do not merge the in-progress R6 track into `main`" caution no longer applies:
merging the closed repair line into `main` is user-authorized consolidation,
not branch-count cosmetics. The parallel local session's unpushed R6 work was
preserved at `archive/local-session-r6-wip` before alignment. Branch cleanup
proceeds by immutable archive tags (`archive/<branch>`) so every deleted ref
remains recoverable.

Consolidation executed on 2026-09-19/20: `main` fast-forwarded to the accepted
head `608f76c` (R0–R6 closed + binding AGENTS.md rules + consolidation records).
Thirty remote branches
were archive-tagged at `archive/<name>` and deleted. Divergent-line decisions:
`chore/drift-proof-governance` (separate state-checker authority approach
already rejected in PR #51; its anti-drift intent is superseded by the binding
AGENTS.md session/branch rules), `perf/efficient-flexible-agent` (superseded by
the accepted performance track P0–P6), `fix/chat-control-fallback` (superseded
by 8D + hardening closeouts), `next/opera-agent-v2` (quarantined experiment,
kept out of 1.x by design), `autodev/m5-chatgpt-legal-loop` (stale AutoDev
state), `ops/p6-production-bundle` (P6 bundle long promoted), and
`chore/sync-production-migration-ids` / `release/new-signing-identity` /
small `feat/*`+`fix/*`+`docs/*` branches (content fully contained in or
superseded by the accepted line). Remaining remote branches: `main`,
`feat/pre-8e-usability-repair-r3` (active), `release/1.3.0`, `release/1.3.1`.

## Latest repair continuation — read before historical instructions below

Continue the user's explicit R6–R8 request sequentially, not Milestone 8E.
R6 is **ACCEPTED / CLOSED without transport migration**: T030–T031 (navigation
measurement + local SPA-click repair, CircleCI #258 + Vercel SUCCESS), T032
(residual queue/transport share 2–8% on navigation paths, ≤ ~250 ms absolute on
primitives), and T033 (Realtime wake not justified — evidence in
`docs/pre-8e-performance-usability-r6.md`). **R7 (T034–T038) YouTube workflow
cleanup is AUTHORIZED / NOT STARTED** under the standing CI-evidence
authorization. R8 real-Opera acceptance (T039–T041) requires the audited signed
1.6.1 update. Opera is installed on this workstation; the remaining blocker is
authorized production registry write tooling, not the browser environment. No
Realtime cutover or 8E permission was added.
Worktree location is `C:/Users/ASUS/.zcode/workspace/default/opera-agent`.
Use `SPECIFY_FEATURE_DIRECTORY` (not `SPECIFY_FEATURE`) for Spec Kit prerequisites.

## Repository hardening closeout — 2026-09-19

The user requested a small, strict guardrail set that makes AI coding errors harder
without adding another governance framework.

- Tests-first head `81969607fd99adb41fed78fd478f7bbb07de2863` produced
  expected CircleCI #266 FAILURE: **430/431 PASS** and only the new dynamic
  static-check coverage regression failed because the old checker returned exit 0
  for a newly added runtime file containing `eval()`.
- Hardening head `e6fa6d2d5e5304c55d0e12a68dc1422e4f640526` has
  **CircleCI #267 SUCCESS + Vercel SUCCESS**.
- `scripts/check.mjs` now discovers runtime JS/TS/SQL recursively under
  `extension/`, `lib/`, `supabase/functions/`, and
  `supabase/migrations/`; new runtime files cannot silently fall outside the
  generic `eval` / `new Function` safety scan.
- The R6 recommendation regression now parses the workflow JSON and asserts its
  structure instead of locking raw source text with brittle regex escaping.
- Duplicate everyday GitHub Actions CI was removed. CircleCI is the canonical
  code/test gate; Vercel remains the preview/deployment check; the GitHub
  `release.yml` workflow remains release-only.
- `AGENTS.md` now carries the minimal repository-discipline rules: verify the
  active branch SHA, do not treat stale `main` as the execution baseline, prefer
  behavior/structured tests, clean temporary validation state, and synchronize
  accepted state before continuing.
- No separate `PROJECT_STATE.json` authority was adopted. Draft PR #51 was
  closed unmerged because it duplicated governance, diverged from the active
  hardening branch, and contained stale CI evidence.
- Obsolete draft PRs #17 and #48 were also closed unmerged.
- Proven temporary branches `test/pre-8e-usability-repair-r0`,
  `feat/pre-8e-usability-repair-r1`,
  `feat/pre-8e-usability-repair-r2`, and `sonar/r6-baseline-r5` were deleted
  after confirming each was fully behind the active R6 branch and had no open PR.
- Historical issues #4 and #5 were closed with supersession notes so old
  1.0.1/23-capability instructions do not masquerade as current state. Issue #1
  remains open because its signing/passive-update follow-up is not fully obsolete.
- `main` remains intentionally behind the active repair branch and must not be
  used as the current implementation baseline. Do not merge the in-progress R6
  track into `main` merely to reduce branch count.

This hardening changes no extension/runtime/public MCP contract, production
deployment, signing identity, or Milestone 8E authorization. The exact next product
work remains **R6 T032 residual queue/transport measurement only**.

Checkpoint 8D remains closed. Performance Track P0–P6 is **ACCEPTED / CLOSED**.
The audited P6 candidate `96ef1cfdbecc7c5c0e40486b6378501db606b84d` has
CircleCI #118 + Vercel SUCCESS. PR #46 merged as
`6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`, with CircleCI #169 + Vercel
SUCCESS. Production promotion is verified at `opera-agent-vm` version 27
(`ACTIVE`, `verify_jwt=true`, deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`).
All 14 deployed source/import files match the merge commit byte-for-byte.
`milestone7_vm_enabled` remains `false`, VM tables remain empty, and Milestone
8E remains paused/not started until separately instructed.

## Authoritative boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Accepted P5 / canonical P6 base:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- Candidate source branch:
  `feat/performance-runtime-cutover-p6-4571636311958769504`
- Exact P6 audited-candidate head:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- Exact audited-candidate CI: CircleCI #118 + Vercel SUCCESS
- Merge target branch: `feat/performance-runtime-cutover-p6`
- PR #46 merge commit:
  `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`
- Merge-commit CI: CircleCI #169 + Vercel SUCCESS
- Stable extension: 1.6.0
- Protocol: 1
- Browser capabilities: 26
- Public MCP tools: 18
- Signed rollback: 1.5.2
- 8E: paused/not started
- P6 production deploy/promotion: **DONE / VERIFIED**
- Production VM host: `opera-agent-vm` version 27, ACTIVE, `verify_jwt=true`
- Production deployment SHA:
  `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`
- Post-promotion safety state: feature flag false; VM tables 0/0/0

## P6 candidate facts

- Durable 7E host consumes P1/P2/P3 reconciliation after `opera_await`; DB lease,
  checkpoint, effect reservation/idempotency, and host tokens remain authoritative.
- Caller `taskDependencies` are rejected. Without a trustworthy
  server-authoritative dependency source, live context is MISSING and relevance
  conservatively yields REASON_REQUIRED. Do **not** claim full integrated P3/P4
  speedup yet.
- Cold start/lost continuity -> RESET_REQUIRED + FULL_SNAPSHOT.
- With P6 metadata, only a valid accepted APPLY_AND_CONTINUE may continue VM
  execution. IGNORE_FOR_TASK, REASON_REQUIRED, unknown/missing/malformed or
  inconsistent decisions fail closed; reset suspends STALE_TARGET.
- Effect results without P6 metadata retain pre-P6 compatibility.
- Low-level `opera_enqueue` / `opera_await`, full page text/snapshot recovery,
  18 MCP tools, Protocol 1, and 26 capabilities remain intact.
- The candidate implementation itself introduced no schema migration,
  OAuth/signing/pairing/public-schema expansion, transaction authority, or 8E work.
  A later explicit production-promotion step deployed only the exact P6 VM-host
  source to `opera-agent-vm` version 27; it did not enable the VM feature flag.

## Evidence

- `b8cd79f27f135923a63657beced8563ed7e7a0c7` — tests-first;
  CircleCI #114 expected red.
- `5652435e26f534126bfcee7c48df9ffd597fc52e` — control-flow allowlist
  implementation; P6 tests green, historical byte locks exposed as stale.
- `49731c49e75df058dcd48218e680a8ad9aaf7195` — authorized lock rebaseline;
  CircleCI #116 + Vercel SUCCESS.
- #116 full suite: **416/416 PASS**, 0 fail, 0 skipped.
- `npm run check`: PASS, 26 primitives, version 1.6.0.
- Chromium extension regression: PASS.


## Repowise integration state

- Branch: `chore/repowise-integration`
- R1: **PASS** — Repowise 0.51.0 compatibility/privacy/local-MCP research complete.
- R2 repo setup head:
  `706001747aefb9b629d4e301a30d814f5e9754e3`
- R2 CI: CircleCI #119 + Vercel **SUCCESS**.
- Repo changes are limited to:
  - `.gitignore`: local `.repowise/` and `.repowise-venv/`;
  - `tools/repowise/requirements.txt`: `repowise==0.51.0`;
  - `tools/repowise/bootstrap.py`: isolated repo-local installer/version check with
    telemetry disabled.
- No Node dependency was added; no unrelated dependency was upgraded.
- No editor/user MCP config, AGENTS.md managed section, provider key, Repowise
  database/index, or generated cache was committed.
- Runtime installation could not be executed in the ChatGPT sandbox because DNS
  egress to GitHub/PyPI is unavailable. The sandbox otherwise satisfies the runtime
  floor (Python 3.13.5, Git 2.47.3).
- R3: **PASS** at full-history evidence head
  `3a83bbed0177a67ce882237965bc6d3706335b4c`.
- R4 local MCP: **PASS** at offline evidence head
  `abaf20e28fb93fe2488be4ce9f9cbe0721225992`.
- R5 AI codebase-context documentation: **PASS** at
  `e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`; CircleCI #143 + Vercel
  SUCCESS.
- R6 validation evidence: **PASS with documented limitations** at
  `7fae3a095e7096cec6945b7c4ea274764881b609`; CircleCI #147 + #148 +
  Vercel SUCCESS.
- R6 closeout head
  `6c1f06a2e7d11c62dc8ebfb0a0a13cb31e28140d`: CircleCI #149 + Vercel
  SUCCESS.
- R7 final closeout: **PASS / CLOSED** at final-candidate
  `0338f83c198ff38d0bbc4e864692c01c9a34d327`; CircleCI #150 + Vercel
  SUCCESS.


## Repowise R3 initial-index gate

R3 is **PASS**.

Exact full-history evidence head:
`3a83bbed0177a67ce882237965bc6d3706335b4c`.

Evidence:

- CircleCI #134 `repowise_r3_full`: SUCCESS.
- CircleCI #133 normal regression: SUCCESS.
- Vercel: SUCCESS.
- Repowise 0.51.0.
- Initial indexing: 34.984s.
- Index size: 18,730,491 bytes (~17.86 MiB).
- 301 graph-indexed files from 312 Git-tracked files.
- 1,429 symbols; 74 deterministic/index-only wiki pages.
- 0 parse errors.
- Git history available: 348/348 commits; 121 `git_metadata` rows.
- 7/7 required files graph-indexed with no parse errors.
- working tree clean before/after; no unexpected project side effects.
- telemetry/editor setup/key persistence/prose generation disabled; mock embedder;
  no provider keys passed to Repowise.
- no Repowise DB/index/cache committed or uploaded.

Important diagnostic lesson: CircleCI checkout is blobless partial-clone by default,
so a plain checkout caused Repowise to skip Git history. The final R3 evidence job
hydrated the full Git object set and removed promisor/partial-clone config before
indexing. The validator was also corrected not to require a generated wiki page for
Markdown/test files; R3 verifies graph indexing + parse health, while separately
requiring Git-history coverage.

Temporary R3-specific CircleCI jobs are removed at closeout. The bounded
`tools/repowise/r3_probe.py` and `tools/repowise/r3_assert.py` utilities remain.

## Repowise R4 local MCP gate

R4 is **PASS**.

Exact offline evidence head:
`abaf20e28fb93fe2488be4ce9f9cbe0721225992`.

Evidence:

- tests-first `9f7ee9d...`: CircleCI #136 expected red; normal #137 + Vercel
  SUCCESS.
- initial MCP implementation `555044f...`: #139 MCP acceptance SUCCESS,
  normal #138 + Vercel SUCCESS, but its log revealed Repowise's advisory PyPI
  release check and therefore did not satisfy the offline boundary.
- offline hardening `abaf20e...`: CircleCI #141 MCP acceptance SUCCESS,
  normal #140 SUCCESS, Vercel SUCCESS.
- final smoke: stdio transport, exactly 10 tools, `get_overview` call OK, and no
  PyPI/HTTP request in the MCP step output.

R4 files retained:

- `tools/repowise/mcp_stdio.py`
- `tools/repowise/mcp_smoke.py`
- `tools/repowise/MCP_CONFIG_TEMPLATES.md`

The launcher is single-repo, stdio-only, provider/embedder `mock`, does not load
project-local provider secrets, disables the release poll, and denies DNS/TCP/UDP
egress. It exposes only:
`get_overview`, `get_context`, `get_symbol`, `search_codebase`,
`get_risk`, `get_change_risk`, `get_why`, `get_dead_code`, `get_health`,
and `get_dependency_path`.

Client configuration remains manual. No Claude/Codex/Gemini/user/editor config was
overwritten, no public MCP endpoint was created, and no ChatGPT tunnel/remote bridge
was configured. No Opera Agent runtime/prod/public-MCP surface changed.

Temporary R4 CircleCI instrumentation is removed at closeout.

## Repowise R5 documentation gate

R5 is **PASS**.

Exact documentation head:
`e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`.

Evidence:

- `docs/ai-codebase-context.md` is the durable Repowise operating guide.
- CircleCI #143: SUCCESS.
- Vercel: SUCCESS.
- scope stayed documentation-only; no Opera Agent runtime/prod/public-MCP
  behavior changed.

The guide covers bootstrap, index/rebuild, status, provider-free incremental
updates, CLI queries, local MCP usage, source-of-truth precedence, privacy,
freshness, partial-clone/history caveats, mock-embedder limitations, and the rule
that Repowise is derived context rather than governance/runtime authority.

No npm helper scripts were added because the existing Python entry points are
already cross-platform and avoid shell-specific assumptions.

## Repowise R6 validation gate

R6 validation evidence is **PASS with documented limitations**.

Exact evidence head:
`7fae3a095e7096cec6945b7c4ea274764881b609`.

- #147 Repowise validation: SUCCESS.
- #148 normal regression including Chromium: SUCCESS.
- Vercel: SUCCESS.
- zero nonexistent paths from ten MCP calls.
- A/B/C are strong structural/impact/state cases.
- D is useful for archaeology but decision/history output must be verified against
  the authoritative plan.
- E proves exact literal inventory remains a grep-first task.
- baseline: 5 `git grep` calls, 84 per-question candidate hits, 51 unique files.
- Repowise: 10 MCP calls, 47 per-question surfaced paths.
- first #146 failure was only missing `rg` in the CI image; fixed by using
  `git grep`.

Detailed evidence is in `docs/repowise-r6-validation.md`. The reusable validation
harness remains at `tools/repowise/r6_validate.py`. Temporary R6 CI wiring is
removed.

R7 is closed. The final record is `docs/repowise-integration-closeout.md`.
There is no implicit R8 or automatic Repowise scope expansion after closure.
The P6 independent audit, repository merge, and production-promotion gates are
closed. A planned Pre-8E Performance Usability Repair now precedes 8E. Do not start
8E without R8 acceptance plus a separate explicit instruction.

## Pre-8E repair track inserted

User-approved planning on 2026-09-18 adds
`docs/pre-8e-performance-usability-repair-plan.md` and Spec Kit feature
`specs/001-pre-8e-performance-usability-repair/`.

Status: **R0–R4 ACCEPTED / CLOSED; R4 closeout head CircleCI #245 + Vercel SUCCESS; R5 AUTHORIZED / IN PROGRESS.**

Do not jump to 8E. R0–R3 are ACCEPTED/CLOSED. R3 (T017–T020) closed with durable evidence in `docs/pre-8e-performance-usability-r3.md`: runtime evidence head `285374f20ef1592d16246fe1e53ab4c9d8b8da81`, governance head `5b5ed172770e5b1ce6bc428c84902d48762ce8bf`, and closeout head `3f765cf` have CircleCI SUCCESS + Vercel SUCCESS, local full gates 423/423 PASS + `npm run check` PASS, and every R3 failure chain recorded. On 2026-09-19 the user accepted R3 on the CI basis and granted a standing authorization to proceed sequentially through the repair checkpoints without per-checkpoint manual sign-off, with CircleCI + Vercel SUCCESS on each checkpoint's evidence head as the acceptance criterion and computer-use assistance allowed. Safety rails remain: no production deployment or signed-release promotion without a separate explicit instruction; R6 T033's conditional transport stop stays binding; 8E start stays a separate explicit decision.

A permanent **Evidence-First Bug Repair Loop** lives in `AGENTS.md`, the reusable
ChatGPT Web checkpoint prompt, and the active Spec Kit feature artifacts
(`spec.md`, `plan.md`, `tasks.md`, `research.md`) using the repository's
official Spec Kit template structure. For every unexpected error/bug/CI/browser
regression: capture exact evidence, reproduce/localize, research the root cause
(repository evidence first; primary external docs/upstream sources when relevant),
add or identify a deterministic regression, apply the smallest generic fix, and
rerun focused + required full gates. No blind retries or guess-patching. Three
repetitions of the same failure without new evidence means blocked + diagnostics
and early audit.

## Exact next gate

The P6 independent audit gate is now **PASS / CLOSED WITH USER-ACCEPTED REVIEWER
DEVIATION**.

- audited P5:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- audited exact P6 candidate:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- reviewer: Jules, used because Codex quota was exhausted;
- reviewer deviation/residual risk: explicitly accepted by the user after
  disclosure;
- Jules verdict: **PASS**;
- canonical exact-head CI: CircleCI **#118 SUCCESS** + Vercel **SUCCESS**;
- durable record: `docs/p6-independent-audit-closeout.md`.

PR #46 is merged at `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`, and
CircleCI #169 + Vercel are SUCCESS on that merge commit. Production promotion is
verified at `opera-agent-vm` version 27 with
`verify_jwt=true` and deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`.
All deployed files match the merge commit, the VM feature flag remains false, and
the VM tables remain empty. P6 is **ACCEPTED / CLOSED**.

**Exact next product action for any coding agent (including Z Code):** R0–R6 are ACCEPTED/CLOSED and the consolidated `main` head is `608f76c` (CI SUCCESS). Execute **R7 / T034–T038** (YouTube workflow cleanup) on `feat/pre-8e-usability-repair-r3`: add output-shape/timing tests for `youtube.get_transcript` (T034), reduce redundant query/wait/activation while preserving background-first fallback (T035), exclude unrelated comments/recommendations/sponsored content from primary transcript output where safely possible (T036), demonstrate >=50% improvement from the ~20.514 s frozen baseline or record an evidence-backed residual bottleneck (T037), then STOP for R7 acceptance on the standing CI-evidence basis (T038). Milestone 8E remains paused/not started.

## Browser-gate flakiness record — 2026-09-20

CircleCI #276 failed on `e22bc9e` (a docs-only diff touching
`next-session-handoff.md` and `project-context.md`; no runtime/test change).
Local evidence gathered instead of a blind rerun: Node suite **431/431 PASS**,
`npm run check` PASS, and the full Playwright/Chromium extension regression
completed cleanly (exit 0) in headed Windows mode, captured end to end. An
evidence-backed rerun commit then passed CircleCI + Vercel on identical runtime
content. A later local rerun exited 1 with output discarded, and the following
captured run exited 0 — confirming environment-sensitive flakiness (suspects:
the live Google Maps network test, port binding races, or service-worker
startup timing), not a repository defect.

Policy: a single browser-gate failure on a runtime-unchanged head is treated as
suspected flake; reproduce locally (headed on Windows), and rerun once with the
evidence recorded in the commit message. Two consecutive failures on the same
runtime content are NOT flakes: stop and follow the full Evidence → Research →
Regression Proof → Minimal Repair → Verification branch with the CI log
captured first.

## Preserved rollback / stash warning

- Accepted P5 remains the clean rollback baseline for this candidate.
- Signed rollback 1.5.2 remains available.
- Two accidental untracked 8E files remain preserved in the git stash named
  **"preserve accidental 8E files before completing checkpoint 8D"**.
  Never pop/apply/delete/build from that stash automatically.


## Spec Kit governance adoption gate

Branch: `chore/spec-kit-governance`.

The adoption vendors the official Spec Kit 1.0.8 Codex/PowerShell core, adds a
repository constitution derived from existing governance, and adds a regression
test preventing loss of the P6/8E scope lock.

Acceptance evidence head:
`f8e860df9803805704ac70c894800b47b6bf3dc4`.

- CircleCI #163: **SUCCESS**.
- Vercel: **SUCCESS**.
- Spec Kit governance adoption: **PASS / CLOSED**.

Do not use the Spec Kit tooling change itself to merge/promote P6 or start 8E.
The separate P6 audit gate is now closed by
`docs/p6-independent-audit-closeout.md`. There is no implicit next Spec Kit
checkpoint.

## Enterprise standards track (2026-09-30, read-only planning + spec)

- Reconciliation: handoff head `8e05b3e` is an ancestor of `a99978d`;
  origin `main` = origin `feat/pre-8e-usability-repair-r8` = `a99978d`.
  No divergence; handoff was stale. Working tree was clean.
- New track branch `chore/enterprise-standards-phase-1` from `a99978d`
  (separate from the milestone line; one writer: this session).
- Owner approved phased approach A; Fase 1 = compliance & security baseline.
- Spec: `docs/superpowers/specs/2026-09-30-enterprise-standards-phase1-design.md`
  (approved sections; awaiting owner spec review, then `writing-plans`).
- Open decision before plan execution: LICENSE copyright holder/year
  (proposed: `afnannuzulasugihartono`, 2026).
- No runtime/test changes in this session; `npm test` / `npm run check`
  not rerun (no code touched).

## Enterprise standards Fase 1 closed (2026-09-30, branch-only, deno gate red)

Branch `chore/enterprise-standards-phase-1`, code head
`e3221a72607daa1ea83acd6681916b44a0cdec51` (this closeout docs commit sits on
top; resolve the tip via `git log`). Per-task commits: `a7bda2e` (MIT
LICENSE), `dfeacd5` (SECURITY.md/SUPPORT.md), `9e72fe6` (CODEOWNERS),
`84be166` (.env.example), `129df92` (install.md 1.6.13), `b00949c`
(env-driven ops scripts), `c694298` + `e3221a7` (CI gates: gitleaks, audit,
deno, SBOM); Task 8 Sonar diagnosis (no-change investigation), Task 9
closeout (this entry). Full per-task evidence:
`.superpowers/sdd/2026-09-30-enterprise-standards-phase1/` (gitignored).

Gates rerun by Task 9 on code head `e3221a7` (2026-09-30): `npm test`
588/588 PASS, `npm run check` exit 0 (26 primitives, 81 safety files,
1.6.13), `py tests/browser_extension_test.py` exit 0 on the first run (no
flake, no rerun needed). Exact-head CI: Vercel Preview Comments success,
CircleCI `ci` FAILURE, combined status `failure` — red at the deno gate only
(5m50s run reaching the deno step; local Deno 2.1.4 repro: 72 lint problems
+ 5 type errors + a genuine parse error at
`supabase/functions/opera-agent-mcp/index.ts:372`, pre-existing debt). This
is the accepted Fase 1 outcome per controller ruling (recorded in the SDD
ledger); greening it is Fase 2 scope — do not touch runtime source to chase
it. Gitleaks, audit, SBOM, and Vercel gates are green. Sonar (Task 8, basis
head `a99978d`): Quality Gate failed on the single condition C Reliability
Rating on New Code; per-issue detail is blocked on SonarCloud project access
(private project — anonymous API calls 404). `gh` auth is fine.

No merge to `main`, no PR opened (branch-only default). PR link if the owner
asks:
`https://github.com/afnannuzulasugihartono/opera-agent/pull/new/chore/enterprise-standards-phase-1`.
Exact-next: Fase 2 — deno debt (punch list with codes/locations in the
`e3221a7` trailer + task-7-report), Sonar per-issue read with project
access, then the owner decides promotion.
