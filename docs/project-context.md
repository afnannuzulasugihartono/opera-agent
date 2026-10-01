# Opera Agent project context

Last synchronized: 2026-09-30 (head `4e90d31`: R9 complete in source, CI green, not released)

## Enterprise Quality Fase 2 closed (2026-10-01, branch-only, code head `92d93c6`)
10/10 tasks on `chore/enterprise-standards-phase-1`: mcp quote-escape + explicit edge types + lint/await hygiene + gateway/ledger/vm/runner type fixes + shared extension logger + logged silent catches (background/popup/protocol/identity/content) + structured edge log helper; suite 599/599, check ok (26 primitives, 83 files, 1.6.13), browser exit 0 on the single headed rerun after one tab-drag flake.
CI on `92d93c6`: Vercel success, CircleCI `ci` failure at the deno gate ONLY (`opera-agent-mcp`, pre-existing SDK-1.30.0/Deno-2.1.4 `mcp.js.d.ts` wall; lint + 7/8 functions green); Sonar BLOCKED on access (main still C Reliability, Fase 2 fixes unevaluated until merge). Branch approved pending owner decision EXCEPT the deno-mcp wall keeps `main` closed until resolved (Deno upgrade or SDK/lockfile work — Fase 3 or standalone infra task).

## Enterprise standards Fase 1 closed (2026-09-30, branch-only)
Fase 1 compliance & security baseline on `chore/enterprise-standards-phase-1` (code head `e3221a7`): MIT LICENSE, SECURITY.md/SUPPORT.md, CODEOWNERS, .env.example, install.md 1.6.13, env-driven ops scripts, CircleCI gitleaks/audit/deno/SBOM gates.
Verified 2026-09-30: `npm test` 588/588, `npm run check` ok (26 primitives, 81 safety files, 1.6.13), browser suite exit 0 first run; Vercel success, CircleCI red at the deno gate only (pre-existing debt incl. mcp `index.ts:372` parse error — accepted outcome, Fase 2 greens it); Sonar red on C Reliability Rating on New Code (per-issue detail needs SonarCloud project access). No merge to `main`, no PR opened; Fase 2 punch list in the `e3221a7` trailer.

## R9 complete in source — head `4e90d31`, CI green, NOT released

Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

`main` = `feat/pre-8e-usability-repair-r8` = `4e90d31`. CircleCI `ci` success and
Vercel success on that exact SHA. `npm test` 573/573, `npm run check` ok — 26
primitives, 81 safety files, 1.6.13. `py tests/browser_extension_test.py` exits 0.

**Nothing is released or activated.** Production serves CRX **1.6.13**, which
predates every R9 change; `role-reconcile.js` and `hover-settle.js` ship with the
next release. R9-F remains **recommended for deferral**.

Track contents: R9-A at-dispatch foreground focus gate; R9-B keyboard chords and
bounded text entry, now publicly reachable; R9-C role reconciliation from markup
plus the accessibility tree; R9-D cheap stale-ref recovery with the 24px
geometry tolerance **unchanged**; R9-E `hover` burst step that can never click;
R9-G menu/dialog batching instructions.

### Two CI failures found and fixed at the end of the track

- **The 7C p95 gate was a flaky perf gate.** It failed CI while passing locally
  and reproduced at ~1 run in 3 (ratios to 1.282 vs a 1.15 budget). The budget
  was never wrong; the estimator was — it compared p95s of two *independently*
  measured series. It now asserts the **median of paired ratios** (stable
  1.025-1.044). Two alternatives were measured and rejected with numbers recorded
  in the evidence doc; a meta-test prevents a quiet revert.
- **R9-D broke the Chromium extension regression** — my regression. R9-D dropped
  `rect` from the geometry-rejection candidate payload, and
  `tests/browser_extension_test.py:836` asserts on that coordinate. Restored.
  **Lesson:** the local suite was 573/573 green while the extension was broken in
  a real browser. `npm test` does not cover the extension; run
  `py tests/browser_extension_test.py` before calling extension work done.

### Environment notes

- Python is not on `PATH` as `python`/`python3`, but `py` works (3.12.10) with
  Playwright and Chromium installed. Use `py tests/browser_extension_test.py`.
- Read CI with `gh api .../commits/<sha>/check-runs` **and** `.../status`. The
  combined status can read `success` while a check-run is still pending or red.

### Open: SonarCloud quality gate

`SonarCloud Code Analysis` reports **Quality Gate failed** on every R9 head,
including `024696b`, which I earlier reported as fully green — an error on my
part: I read the combined status before Sonar's check-run had settled. Per the
recorded gate scope, acceptance is CircleCI + Vercel and Sonar is the **PR**
gate, so this does not block acceptance — but it has been red for the whole
track and is **undiagnosed**: no `sonar-project.properties`, no `SONAR_*` env
var, and no Sonar step in `.circleci/config.yml`, so the analysis runs through
the Sonar GitHub integration and its findings are unreachable from here. Someone
with SonarCloud project access must read the actual findings.

### Still gated, and not on this line of work

1. **Independent audit** before promotion — R9 touches four named `AGENTS.md`
   audit triggers (public MCP surface, sensitive-input contract, ref-authority
   contract, foreground gate). The implementing agent cannot clear this gate.
2. **Live acceptance** in a real Opera profile against a real document editor.
3. **Owner-ordered release**: build, sign, audit, upload inactive, live
   acceptance, then the atomic activation flip (two-statement ordered flip —
   `opera_releases_one_active_per_identity_idx` is an immediate partial UNIQUE
   index).

## R9 complete (source) — A/B/C/D/E/G done; R9-F deferred (2026-09-30)

Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

**Nothing is released or activated.** Production serves CRX **1.6.13**, which
predates every R9 change; `role-reconcile.js` and `hover-settle.js` ship with
the next release. `npm test` 572/572, `npm run check` ok — 26 primitives, 81
safety files, 1.6.13.

- **R9-A** foreground focus gate re-samples at dispatch inside the debugger
  session and retries boundedly; a genuinely unfocused window still returns
  `FOREGROUND_REQUIRED` with the observed state.
- **R9-B** keyboard chords (modifier bitmask, 79-entry fixed key vocabulary) and
  bounded text entry (20,000 chars, chunked 4,000) behind the unchanged
  sensitive-field guard; **now publicly reachable** via `press_key` and the burst
  `key` step.
- **R9-C** roles derived from what the platform reports, not only the `role`
  attribute; the existing bounded text-poor AX walk additionally fills roles the
  markup lacks. Read-only, never downgrades an explicit role, never adopts an
  ambiguous name, never annotates a sensitive element.
- **R9-D** the 24px geometry tolerance is **unchanged and unbroadened**; a moved
  successor is still refused. Recovery was made cheap by returning fresh refs for
  already-validated candidates, not by relaxing the guard.
- **R9-E** `hover` burst step that moves the pointer and settles on the reveal.
  One pointer event, a move — it can never click. `page.hover` is burst-internal,
  **not** a 27th primitive.
- **R9-G** instructions teach menu/dialog `refFromStep` batching.

Two test-design gaps were found and closed: `run_browser_burst`'s `inputSchema`
is a reference to the shared `burstStepSchema` constant, so per-tool digests
could not see changes inside it (now also pinned by step name); and the
`7C ordinary transition p95 regression` test **flaked twice** under full-suite
parallel load (1.013-1.044 in isolation against a 15% budget). That is a
pre-existing timing sensitivity, recorded rather than papered over, and worth
fixing separately — a perf gate that cannot pass reliably under `npm test` will
teach the team to ignore it.

Release-readiness sweep: version consistency verified (manifest/package/protocol
all 1.6.13, and README's production line correctly still 1.6.13 because nothing
is released); secret scan over the R9 diff clean; CHANGELOG records the track
under Unreleased as source-only; README gained a Maturity section separating a
complete source checkpoint from being live.

### Gated, and not on me

1. **Independent audit before promotion** — R9 touches four named audit
   triggers: public MCP surface, sensitive-input contract, ref-authority
   contract, and the foreground gate. **I am the implementing agent and cannot
   clear this gate**; an independent audit must come from outside this line of
   work.
2. **Live acceptance** in a real Opera profile against a real document editor.
   Nothing here has been exercised against a live browser.
3. **Owner-ordered release**: build, sign, audit, upload inactive, live
   acceptance, then atomic activation flip.

**R9-F remains recommended for deferral** and was not started.

## R9-A/B/C closed — `main` fast-forwarded to `024696b` (2026-09-30)

CircleCI run 389 SUCCESS + Vercel SUCCESS on that exact SHA, combined commit
status `success`. Fast-forwarded from `5ffa75e` with `--ff-only` after confirming
`origin/main` was an ancestor. Commits: `136a11f` (assessment), `a123bb5` (R9-A
focus gate + R9-B keyboard chords), `06375a3` (R9-G instructions-only MCP
guidance), `024696b` (R9-C role reconciliation + repository tidy). The
branch-protection rule added this session did not block the fast-forward.

**This closes a source checkpoint only — nothing released or activated.**
Production still serves CRX **1.6.13**, which predates every R9 change; the new
`role-reconcile.js` content script ships with the next release. Release
promotion, activation, and Milestone 8E remain separate explicit owner
decisions, and a public-MCP-touching checkpoint needs an independent audit
before promotion.

**CI verification method in this environment.** The CircleCI MCP connector's
`list_runs` returns only a count with no run payload, so its documented
`list_runs -> get_run -> list_workflow_jobs` chain cannot be followed (the error
path works, so the connector itself is healthy). Use the GitHub check-runs API
instead, which is more precise because it binds the result to an exact SHA:
`gh api repos/<owner>/<repo>/commits/<sha>/check-runs` and `.../status`. Required
checks are `ci/circleci: test` and `Vercel`.

Also recorded: `git push` succeeded over **SSH** this session despite the
recorded SSH-agent/`insteadOf` breakage; the HTTPS workaround is kept in the
handoff git-history section as the reliable path.

## R9-C role reconciliation + repository tidy (2026-09-30)

Base `06375a3`. Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

### R9-C — the reported symptom pointed at accessibility; the defect was serialization

`serialize()` read `role: clean(el.getAttribute?.('role'), 80)`. A plain
`<button>Send</button>` was therefore reported as `role: ''`, so **any** control
an author did not annotate was invisible to a role-filtered `find_elements`. That
is why the Page numbers dialog exposed `Footer` and `Show on first page` as
readable text but never as a radio or checkbox role.

- **Layer 1 — implicit role from markup.** `serialize` now derives the role the
  platform would report from tag, input type, href, and contenteditable, with an
  explicit author role still winning.
- **Layer 2 — AX reconciliation.** The text-poor path's existing single bounded
  `Accessibility.getFullAXTree` call also builds a name→role index and fills in
  roles the markup lacks. **No second AX walk**; the poverty-gated cost profile
  is unchanged.
- **Safety:** an explicit DOM role is never downgraded; reconciliation is
  read-only and never mints, moves, or invalidates a ref; a name shared by two
  different AX roles is never adopted; sensitive elements are never annotated.
- **One role table, not two.** Content scripts are classic scripts and cannot
  `import`. `extension/role-reconcile.js` declares no `export` statements, so it
  is both a valid classic content script (manifest-loaded before `content.js`)
  and a valid ES module that `background.js` side-effect imports — the same
  pattern as `semantic-identity.js`. Asserted by test so it cannot drift.
- **Deliberately unchanged:** `stableElementIdentity` keeps the raw role
  attribute, because deriving one there would change **every stableKey in the
  product**. Region classification and `scrollTargetBy` likewise. All three are
  now pinned by test so nobody "fixes" them by accident.

`npm test` **553/553 pass** (was 538); `npm run check` ok — 26 primitives, 80
safety files, 1.6.13. No public MCP change, so no contract rebaseline was needed;
`boundary-locks.mjs` digests for `content.js`, `background.js`, and
`manifest.json` were updated per its recorded convention. The shipped 1.6.13
CRX is unaffected — it is a separate artifact and already lagged the repository.

### Repository tidy

- **Fixed a regression:** the GitHub `homepage` had been reset to
  `https://oauth-consent-three.vercel.app`, an OAuth consent **development** URL,
  after the handoff recorded it cleared on 2026-09-29. Cleared again.
- **Branch protection on `main`:** linear history required, force-push and
  deletion blocked, enforced on admins, unresolved conversations blocked.
  Required status checks deliberately left **null** so the `AGENTS.md`
  checkpoint fast-forward workflow still works.
- **Verified, no action:** branches are `main` + one active work branch (the
  healthy state); all 52 PRs closed; the `v1.6.0` body already states it is
  superseded by the 1.6.13 line; description and topics accurate.
- **Two archive tags re-examined and KEPT.** `archive/tmp/ignore` and
  `archive/feat/performance-runtime-cutover-p6-4571636311958769504` look like
  governance violations but are not: `AGENTS.md` requires
  `archive/<original-branch-path>`, so preserving the original name is the
  archive mechanism working. Both commits are also reachable from `main`. An
  earlier read of them as violations was wrong.

**Still pending:** `press_key` optional `modifiers`/`text` (1) and the burst
`key` step optional `modifiers`/`text` (2). Both need the contract rebaseline
R9-G already performed, so bundling is cheaper now. When they land, the "chords
not available yet" instruction must change AND the frozen schema map in
`tests/r9-public-surface-unchanged.test.mjs` must be rebaselined **in the same
commit**.

R9-D (bounded ref re-acquisition, geometry guard preserved) and R9-E (hover as a
first-class step) unstarted. **R9-F still recommended for deferral.**

## R9-G — instructions-only MCP guidance (2026-09-30, owner-selected)

Base `a123bb5`. Record: `docs/pre-8e-performance-usability-r9-evidence.md`.

MCP instructions now extend the existing `refFromStep` habit to **menus and
dialogs**, which re-render their own DOM on every open: open the menu, then find
and click the entry by `refFromStep` inside one burst; chain one find/click per
level inside a single burst with a `wait` step between levels, instead of
hovering by coordinate across separate calls. This is the direct fix for the
"ref valid when found, dead by the time I click it" friction in the place it
actually occurred. In a rich editor or canvas surface the model is told to click
the surface so it takes focus, send an allowlisted key, then re-read the page to
confirm the keystroke landed.

**The chord guidance was deliberately NOT added — a correction to the option as
it was presented to the owner.** `press_key.key` is still validated against the
12-key `navigationKeySchema` and the burst `key` step is still `.strict()`, so
documenting `Ctrl+A` or text entry would make the model emit calls the frozen
schema rejects. The instructions say plainly that control chords are not
available on this surface yet. The R9-B runtime capability stays dormant behind
the public schema.

**Cost correction.** Option 1 was described as the "smallest delta"; that was
wrong. The MCP source digest is frozen in `mcp-contract-v1.json` and **derived
into four more contract fixtures** plus two tests that hardcode it, so even an
instructions-only edit required a full rebaseline: `mcp-contract-v1.json`,
`goal-ledger-thresholds-v1.json`, `reactive-vm-contract-v1.json`,
`reactive-vm-thresholds-v1.json`, `transaction-contract-v1.json`,
`transaction-thresholds-v1.json`, `tests/helpers/boundary-locks.mjs`, and
`tests/reactive-vm-7f.test.mjs`. Each fixture edit is a **single line** (the
fixtures are minified JSON and values were replaced surgically; a pretty-printed
attempt produced a 1 000-line diff and was reverted). The derived digests are
recomputed by the contract tests from canonical JSON, so they are proven
consistent rather than hand-written. No historical `checkpointBoundary` record
was falsified; only the "currently accepted public surface" digest moved, the
same rebaseline U-T performed when the tool count went 18 -> 22.

**Proof it is genuinely instructions-only.** New
`tests/r9-public-surface-unchanged.test.mjs` pins each of the 22 `inputSchema`
blocks individually by digest — something the whole-file digest cannot do, since
it cannot distinguish an instructions edit from a schema edit. It also asserts
`press_key` still exposes only `key: navigationKeySchema` (no `modifiers`, no
`text`), the 12-key enum is unchanged, the burst key step is still `.strict()`,
and the instructions never advertise chords the schema would reject. Verified
independently against `HEAD` by extracting and comparing all 22 schema blocks:
**no drift**.

| Gate | Result |
| --- | --- |
| `node --test tests/r9-public-surface-unchanged.test.mjs` | 4/4 pass |
| `npm test` | **538/538 pass** (was 534) |
| `npm run check` | ok — 26 primitives, 79 safety files, 1.6.13 |
| per-tool schema diff vs `a123bb5` | no drift, 22/22 identical |

22 public tools and their names unchanged; Protocol 1 and the 26 primitives
unchanged; no production mutation, release, activation, CRX, or deploy.

**Still pending:** (1) `press_key` optional `modifiers`/`text`; (2) burst `key`
step optional `modifiers`/`text`. Both need the same rebaseline, now already
performed, so bundling them is cheaper than it was. When they land, the "chords
not available yet" sentence must be replaced in the same commit and the frozen
schema map in `tests/r9-public-surface-unchanged.test.mjs` rebaselined in that
same commit.

**R9-C (AX-reconciled discovery) is the next substantive engineering item and
touches none of the above.** R9-D, R9-E, R9-F not started; R9-F still recommended
for deferral.

## R9-A / R9-B implemented — focus stability and keyboard chords (2026-09-30)

Owner-authorized after the R9 assessment. Full record:
`docs/pre-8e-performance-usability-r9-evidence.md`. Assessment and original plan:
`docs/pre-8e-performance-usability-r9.md`.

**Implemented in the extension + protocol layer. Not promoted, not activated, not
live-verified.** Base `136a11f`, branch `feat/pre-8e-usability-repair-r8`.

- **R9-A — the foreground check raced the dispatch.** `trustedPointer` sampled
  `tab.active` / `window.focused` once, before a content round trip and a
  debugger attach, and never re-checked; foreground mode runs without
  `Emulation.setFocusEmulationEnabled`, so any focus loss in that window returned
  `FOREGROUND_REQUIRED`. Now `withForegroundFocusGate` re-samples at dispatch
  time **from inside the debugger session** and retries a bounded number of
  times. All four trusted executors (`trustedClick`, `trustedFill`,
  `trustedPointer`, `trustedKey`) route through it. The gate never activates a
  tab or focuses a window; a genuinely unfocused window still returns the
  structured requirement, now carrying `attempts`/`tabActive`/`windowFocused`.
  A satisfied sample dispatches on the first attempt, so latency is unchanged.
- **R9-B — the key table had no modifiers at all.** `KEY_MAP` was 12 unmodified
  keys with no `Ctrl`/`Shift`/`Alt`/`Meta` bitmask, so no `Ctrl+A`, `Ctrl+V`, or
  `Shift+Enter`. `lib/keyboard.js` now resolves a declarative `{key, modifiers}`
  chord or a bounded `{text}` request to an exact CDP payload, with an implicit
  Shift for uppercase letters and text chunked at 4 000 characters behind the
  **unchanged** sensitive-field guard. Every previously allowlisted unmodified
  key resolves byte-identically, asserted exhaustively.
- **The synthetic key path stays unmodified-key only, deliberately.**
  `content.js` is a classic script and cannot import `lib/keyboard.js`; allowing
  chords there would create a second, drifting copy of the allowlist. It refuses
  chords and text explicitly, pointing at the trusted path.
- **New policy module:** `extension/lib/focus-gate.js` (pure, no chrome/DOM).
- **Evidence:** 17 new deterministic tests in
  `tests/r9-focus-and-keyboard.test.mjs`, written red before implementation.
  `npm test` **534/534 pass** (was 517), `npm run check` ok — 26 primitives, 79
  safety files, version 1.6.13.

**The public MCP source is byte-identical and unchanged.** No tool, schema, or
instruction change. `mcp-contract-v1.json` untouched, so 22 tools, the
`read_page` schema, and the byte-for-byte public contract all hold. Protocol 1
and the 26 primitives are unchanged. No production mutation, release, CRX, or
deploy.

`tests/helpers/boundary-locks.mjs` digests for `content.js`/`background.js` were
updated, following that file's own documented convention (U-P1, U-R, and
U-Sonar each appended a recorded line and updated the digests). No assertion was
removed or relaxed and no lock was narrowed.

**Handed back as an owner decision.** The remaining half of R9-B and the
menu/dialog `refFromStep` instruction win both live in
`supabase/functions/opera-agent-mcp/index.ts`, which is frozen byte-for-byte by
`tests/fixtures/mcp-contract-v1.json` and consumed by seven test files.
`AGENTS.md` places public MCP schema changes behind their own explicit review
boundary, and that was not disclosed when R9-B was authorized, so the digest was
**not** rebaselined unilaterally. Pending, in order of value per contract risk:
(1) instructions-only menu/dialog `refFromStep` + chord guidance, zero schema
change; (2) `press_key` optional `modifiers`/`text`; (3) burst `key` step
optional `modifiers`/`text`; (4) rebaseline `mcp-contract-v1.json`
`sourceSha256` and the MCP boundary-lock entry with a recorded reason, per the
existing U-T precedent. Until then the runtime supports chords but no public
tool can request them.

R9-C (AX-reconciled discovery) is the next substantive engineering item and does
not touch the public MCP surface. R9-D, R9-E, R9-F not started. R9-F remains
recommended for deferral.

## R9 complex-application control assessment (2026-09-30)

A live operator test of Opera Agent against Google Docs (long-document editing,
`Insert > Page elements > Page numbers > More options`, the Page numbers dialog)
exposed friction that ordinary browsing did not. Ordinary browsing, tab
management, reading, and simple click/form flows were reported smooth; the
difficulty was concentrated in canvas-class editors, hover-revealed submenus,
custom dialog controls, and focus stability. Full assessment, code-path mapping,
and proposed checkpoints: `docs/pre-8e-performance-usability-r9.md`.

**No runtime behavior changed.** Documentation only. Verified at head `5ffa75e`
with `npm test` 517/517 passing.

Findings, each traced to code at head `5ffa75e`:

- **Focus is sampled, not held.** `extension/background.js:637-648` reads
  `tab.active` / `window.focused` once before dispatch and never re-verifies;
  foreground mode deliberately runs without `Emulation.setFocusEmulationEnabled`
  (background mode enables it, `background.js:446-461`). A window that loses
  focus between the check and the dispatch fails with no recovery. This is the
  highest-frequency reported failure and is a race by construction.
- **Refs are pins, not locators.** `extension/content.js:216-257` fails closed
  unless the successor pool is exactly one candidate *and* it sits within
  `GEOMETRY_DRIFT_TOLERANCE_PX = 24` (`content.js:118`) of the mint rectangle.
  The guard is deliberate and exists to prevent the recorded Street-View
  mis-click (`content.js:113-117`); the gap is the missing bounded
  re-acquisition step, not the guard.
- **Semantics come from the DOM, not the accessibility tree.** Roles and
  editability are read from attributes (`content.js:514`,
  `content.js:546-550`). Controls that are rich in the AX tree but
  attribute-poor in the DOM are under-discovered. `axSummary`
  (`extension/lib/ax-summary.js`) is deliberately read-only and non-clickable.
- **Keyboard is a toy.** `KEY_MAP` (`background.js:698-711`) has 12 unmodified
  keys and **no modifier support at all**: no `Ctrl`/`Shift`/`Alt`/`Meta`
  bitmask on `Input.dispatchKeyEvent`, no chords, no arbitrary text entry
  outside `fill`.
- **Canvas/rich editors sit outside the trusted-fill contract.** The right
  primitive exists — `trustedFill` uses CDP `Input.insertText`
  (`background.js:618`) — but `assertEditableSafe` (`content.js:491-500`)
  admits only `input`, `textarea`, and `isContentEditable`, and the synthetic
  `nativeSetValue` path (`content.js:958-971`) writes `textContent`, which is
  wrong for a rich-text surface. Fill is also capped at 20 000 characters.
- **Hover is not a first-class step.** `page.pointer` supports `move` and
  `page.wait_for` supports text, so a menu chain is only expressible as a
  hand-built burst. No dwell, no submenu/`aria-expanded`-aware settle.
- **The statement timeouts were not in the extension.** They are Postgres-side
  in the gateway `opera_await_adaptive` wait path
  (`supabase/functions/opera-agent-gateway/index.ts:27-28,72,105`). Extension
  budgets are `page.read` 10 s, `page.find` 8 s, `page.wait_for` 15 s
  (`extension/lib/protocol.js:28-55`).
- **`read_page` is already bounded** — `MAX_ELEMENTS = 200`, compact projection,
  `axSummary` capped at 60 entries, hard 512 KB ceiling that throws rather than
  truncating (`content.js:757-810`, `background.js:1031-1038`). Remaining noise
  is inherent to apps that keep hundreds of toolbar/menu nodes live.

Deliberately **not** in scope, because they are frozen boundaries in
`docs/roadmap.md` "Explicitly deferred": arbitrary JavaScript / `Runtime.evaluate`
(none exists in `extension/` today), raw CDP passthrough, and network
interception. Adding them is a separate explicitly reviewed decision, never a
default.

Proposed checkpoint order, awaiting owner authorization: R9-A focus stability,
R9-B modifier/text keyboard, R9-C AX-reconciled discovery, R9-D bounded ref
re-acquisition with the geometry guard preserved, R9-E hover as a first-class
step, R9-F canvas/rich-editor fill contract **last** (widens what may receive
typed text; needs its own review and a Codex audit). R9-B, R9-D, and R9-F touch
the sensitive-input or ref-authority contracts and require an independent audit
before promotion.

## Repository tidy round (2026-09-29, owner-ordered)

Public-facing docs rebuilt to the verified contract: `README.md` now leads
with a current-release table (1.6.13 active, Protocol 1, 26 primitives,
22 MCP tools, CI stack) and capability groups; the stale "What 1.0.x
includes"/23-primitive text is gone. `CHANGELOG.md` gained a `[1.6.13]`
section and an attribution note (1.6.3–1.6.12 records live here and in
`docs/releases/`). `docs/releases/README.md` indexes the full activation
sequence verified against this document and the handoff history: 1.6.5
(2026-09-22) → 1.6.6 → 1.6.7 (09-23) → 1.6.9 → 1.6.10 (09-24) → **1.6.13
(09-29, current)**; 1.6.4/1.6.8/1.6.11 were uploaded but never activated;
1.6.12 was never packed. `CONTRIBUTING.md` branch patterns were aligned to
the binding governance. GitHub page: dev-URL homepage cleared, v1.6.0
release body corrected to cite the 1.6.13 line. Naming governance audit:
clean (allowlist green, remote refs compliant). Docs heads `ab5e7f0`/
`da7d52d`/`8b6e083`/`43e8e65`/`716c9a1`, all CI green; `main` = r8 tip.

## CRX 1.6.13 ACTIVATED (2026-09-29, owner-ordered)

Owner ordered activation of the audited 1.6.13 candidate. Executed and
live-verified; this is now the production release for the signed identity:

- Flip: transactional two-statement update (deactivate current active row,
  then activate 1.6.13) because `opera_releases_one_active_per_identity_idx`
  is an immediate partial UNIQUE index on `extension_id WHERE active`, which a
  single multi-row `UPDATE ... set active = (version='1.6.13')` cannot satisfy
  deterministically (row-order-dependent 23505). Record this ordering for any
  future flip/rollback.
- Post-state verified: exactly one active row = 1.6.13 (SHA-256
  `8420872b...263df`); live `update.xml?id=` serves `version="1.6.13"` with the
  1.6.13 CRX codebase URL; the served CRX returns HTTP 200, 60,188 bytes, and
  its SHA-256 equals the recorded/disk/DB hash (DB = disk = served); the
  previously-active 1.6.10 CRX path now returns 404 (inactive).
- 1.6.10 row remains intact and inactive; rollback is the same ordered flip
  re-activating 1.6.10.
- Installed devices self-update on their next browser-scheduled update check;
  adoption is observable in `opera_devices.extension_version`.
- Note: the owner ordered activation directly; the live Opera acceptance gate
  was not separately recorded as performed before this activation (owner
  decision on 2026-09-29).

## CRX 1.6.13 signed, audited, uploaded inactive (2026-09-29)

Continuation of the interrupted 2026-09-29 signing session. The signed artifact
already existed from that session; this session completed the audit and the
upload-inactive step of the frozen release workflow (activation remains an
explicit owner decision and has NOT been performed).

- Artifact: `D:\Opera\opera-agent-1.6.13.crx` — 60,188 bytes, SHA-256
  `8420872b2ce3bf7c1ce1cefcb66037eb453441bd73cde80c4fa1eeb1b2d263df`, packed
  from a clean detached worktree of release head `83be509` (manifest
  `version` 1.6.13). Signing gate satisfied before packing: CircleCI `ci`,
  Vercel, and SonarCloud all SUCCESS on exact head `83be509`.
- Offline audit PASS:
  - CRX3 header parses; `crx_id` derived from the proof public key equals the
  established identity `ohbbpamcljckmjhcpkcmefdobkoeaick`; the proof public key
  equals the owner signing PEM (`D:\Opera\signing-private\opera-agent-new-
  identity.pem`); the RSA-SHA256 proof is VALID over the exact Chromium blob
  `CRX3 SignedData\0` + u32le(|SignedData|) + SignedData + archive; all 14
  archive entries are byte-identical to the audited worktree source.
  - **Validator correction (recorded root cause)**: the prior session's
  `%TEMP%\kilo\verify-crx.mjs` only attempted RSA-PSS verification and printed
  `INVALID` for every artifact — including production-served, accepted 1.6.10
  and 1.6.8 — a false negative. Recovering the digest by raw RSA public-op
  exponentiation of each artifact's signature proved the signature padding is
  **PKCS#1 v1.5**, and the recovered SHA-256 equals the Chromium-exact blob
  digest for 1.6.0/1.6.10/1.6.11/1.6.13. Live Opera installs of these served
  releases are the corroborating acceptance evidence.
- Upload-inactive executed via Supabase Management API SQL on project
  `nenmkmtvjremqphfqnfw`: new `opera_releases` row
  (`version=1.6.13`, correct `extension_id`, `active=false`). Verified: DB
  base64 decodes to 60,188 bytes whose in-DB SHA-256 digest equals the
  recorded/disk hash (DB = disk).
- Post-upload serving state verified live and unchanged: `update.xml` still
  serves 1.6.10 (the single active row) and the 1.6.13 CRX path returns 404
  while inactive — exactly the pre-acceptance posture required by the release
  workflow. 1.6.11 remains uploaded inactive; 1.6.12 source still awaits its
  own signed CRX.
- Next actions, both owner-gated and NOT performed here: owner live Opera
  acceptance of 1.6.13, then the owner-ordered atomic activation flip
  (1.6.13 active / 1.6.10 inactive). Rollback remains the same flip re-
  activating 1.6.10 (row intact).

## U-Sonar new-code reliability sweep (2026-09-29, PR #52)

Owner-ordered SonarCloud Quality Gate cleanup. The r8 push heads carried
`new_reliability_rating=D` with **56 open new-code BUGs** (inspected live with
an owner-supplied Sonar token; token revoked after use). Resolution split, all
verified `npm test` 517/517 + `npm run check` + Edge-headless regression:

- **44 code fixes**: S2871 sorts switched to explicit code-unit comparators
  (byte-identical order for ASCII key sets — digests unchanged), later
  centralized as `lib/canonical-order.js` `codeUnitCompare` after inline
  21-token comparator strings tripped the PR duplication gate; 8D cloud
  controller/operator S1143 throws removed from `finally` blocks with
  flag/captured-error equivalents preserving semantics; runner S3923 identical
  ternary collapsed; content.js PUA regex ZWJ split out of the character class
  (same code-point set); 11 fixtures got `lang="en"`, r4 input got
  `aria-label` (placeholder preserved); policy probe UPDATE scoped
  `where singleton=true`; repowise r6_validate switched to async subprocess.
- **12 false-positive transitions (byte-pinned files, untouched)**: the 5
  `lib/transaction-*-8d.js` bundle sources (compiled into the deployed,
  `EXPECTED_TRANSACTION_BUNDLE_SHA_8D`-pinned edge bundle) and the 4
  token-identical `exact=` helper lines + 2 CLI-config validation lines whose
  default sort is provably code-unit identical; plus the frozen serialized-AST
  `then` field in boundary-locked `lib/reactive-vm-7d.js`. Recorded in the
  single-source `tests/helpers/boundary-locks.mjs` authorization note (U-Sonar
  paragraph) alongside the U-P1/U-R history.
- Boundary lock digests updated once for `content.js` (`f4d15ef5…`) and
  `multi-signal-relevance-p3.js` (`97ef64a6…` via helper); the P2/P3/P4/P5 test
  locks were refactored into `tests/helpers/boundary-locks.mjs` to remove the
  duplicated authorization-comment/Map blocks flagged by the duplication gate.
- **Result**: PR #52 SonarCloud Quality Gate PASSED (0 new issues, 0
  duplication), CircleCI + Vercel green on the exact PR head, merged
  fast-forward to `main`.
- No public contract, MCP schema, capability list, or deployed-bundle bytes
  changed; at the U-Sonar close 1.6.13 was the unsigned candidate and 1.6.10
  the active release (1.6.13 has since been signed and uploaded inactive —
  see the CRX 1.6.13 section above).

## GitHub repository cleanup (2026-09-28, owner-ordered)

Owner requested tidying the remote repository. Executed and verified:

- **Branches**: deleted the obsolete merged tips after creating archive tags
  first — `archive/feat/pre-8e-usability-repair-r3` (r3 tip `7ac21fe`),
  `archive/release/1.3.0`, `archive/release/1.3.1`. Remote now holds only
  `main` and the active line `feat/pre-8e-usability-repair-r8` (both
  `05202ba`), per the branch-lifecycle rule.
- **README status block was governance-drifted**: it still claimed 1.6.2 as
  production-active with the 18-tool inventory. Verified live against the
  production `update.xml` (serving 1.6.10 for ID
  `ohbbpamcljckmjhcpkcmefdobkoeaick`) and rewrote the status block to the
  true current contract (1.6.10 active, 26 capabilities, 22-tool MCP
  inventory, U-* checkpoint line on r8). Committed as `05202ba`
  (`docs(readme): ...`) after `npm test` 517/517 and CI green; `main`
  fast-forwarded.
- **GitHub Releases**: tag `v1.6.0` existed without a release page. Created
  release **v1.6.0** with assets: `Opera-Agent-1.6.0.crx` (local copy
  byte-verified against the recorded production SHA-256 `cd50933e...`,
  35,855 bytes), extension ZIP and full-source ZIP built via
  `git archive v1.6.0`, and a `SHA256SUMS`. Note: versions above 1.6.0 are
  distributed through the private Supabase update service only — the GitHub
  release page is an archive, not the installation channel.
- **Issue tracker**: the stale 1.0.1-era acceptance issue #1 was closed with a
  comment recording why it is superseded (signing identity, passive-update
  chain, Phase 2 features all replaced by the 1.2→1.6.x line). Open issues
  and PRs now zero.
- **Repo metadata**: description updated (local-browser bridge / MCP /
  Supabase / signed CRX); topics added
  (`browser-automation`, `opera-extension`, `model-context-protocol`,
  `mcp-server`, `supabase`, `edge-functions`, `ai-agents`,
  `chromium-extension`); the old `oauth-consent-three.vercel.app` homepage
  was cleared (internal OAuth page, not a public product URL — the repo is
  private). No LICENSE file was added: choosing a license is an owner/legal
  decision, not housekeeping.
- **Checks on the r8 push heads**: CircleCI + Vercel green. SonarCloud reports
  a Quality Gate failure ("Reliability Rating on New Code" < A). Per the
  recorded gate scope, SonarCloud is the PR static-quality gate, not an
  acceptance gate, and no PR exists on r8 — informational here; the next PR
  author should resolve the new-code reliability findings before opening it.
- No production/database/release-activation state was changed by this cleanup.

## U-R timeout/retry/popup parity implemented on r8 (2026-09-28, takes precedence)

Checkpoint **U-R** — from the owner field-testing verdict (7/10 usability:
timeouts unretried, OAuth popups invisible, SPA-slow redirects verified too
early and re-clicked) — implemented on `feat/pre-8e-usability-repair-r8`:

- `extension/lib/popup-events.js` (new, pure/no-chrome): `recordPopup` /
  `popupsSince` / `resolvePopupOpener` / `POPUP_LOG_LIMIT = 8`. Bounded
  per-opener log of tab creations filtered by time.
- `extension/background.js`: bounded `popupLog` fed by `tabs.onCreated` /
  `tabs.onRemoved`; `page.click`/`page.fill` results carry `openedTabs` when a
  popup opened during the action. Live diagnosis 2026-09-28 found Chromium
  attributes `window.open` from a BACKGROUND acted-on tab to the window's
  *active* tab, so `openerTabId` alone misses automation popups; while a page
  action is in flight (`withActionPopupTracking`), new tabs are claimed for the
  acted-on tab (`resolvePopupOpener`), otherwise the real `openerTabId` applies.
  Command timeouts now reject with coded `COMMAND_TIMEOUT` mapped to
  `outcome:'unknown'` + verify-before-repeating guidance (parity with the
  BURST_TIMEOUT/GATEWAY_ERROR unknown-outcome family) on both watch and main
  race branches. `page.fill` dispatch reads `expect`/`retry.attempts`; resolved
  verified telemetry covers fill; `trustedFill` runs the in-page post-action
  check with the expect spec.
- `extension/content.js`: `EXPECT_VERIFY_WINDOW_MS = 2000` polling loop
  (`waitForExpectVerification`) so a slow SPA/OAuth redirect inside the window
  verifies on attempt 1 instead of declaring failure and re-clicking;
  `postActionEvidence` polls until verified; `fill` is async with the same
  retry/expect parity as click (1..3 attempts, 150 ms pause); `fillInfo`
  returns `postActionBefore` for the trusted path.
- `supabase/functions/opera-agent-mcp/index.ts`: `AWAIT_TIMEOUT` maps to the
  `AWAIT_OUTCOME_UNKNOWN` envelope with `outcome:"unknown"`; `toolError`
  surfaces top-level `outcome:"unknown"` for details that carry it (the frozen
  `code: error.code, message: error.message` literal is preserved); the
  instructions text now covers OAuth/`openedTabs` follow-through and
  expect-based verification. Tool names, count (22), and input schemas are
  byte-unchanged; only source bytes moved, so the MCP `sourceSha256` in
  `tests/fixtures/mcp-contract-v1.json` (and the copies in the
  goal-ledger/reactive-vm/transaction contract+threshold fixtures) and the
  inventory digest were rebaselined with recorded reasons — the schema
  projection itself is unchanged.
- Boundary locks rebaselined in the same commit with U-R authorization notes
  (`delta-first-observation-p2`, `delta-performance-p5`,
  `event-driven-local-execution-p4`, `multi-signal-relevance-p3`,
  `reactive-vm-7f`): SHA1 blob locks for content.js/background.js/
  manifest.json/MCP index.ts and the MCP SHA256 contract fixtures. Protocol 1,
  26 primitives, 22 tools unchanged.
- Version 1.6.13 sweep across protocol/manifest/package/check.mjs + 12
  version-lock test files.
- `scripts/check.mjs` now parses every runtime `.js` file standalone
  (`node --check`) — recorded reason: a `trustedFill` parenthesis break in
  background.js shipped green through the regex-only `npm test` and the old
  check gate; only the live service worker surfaced it.
- Tests: `tests/timeout-retry-popup-parity.test.mjs` (11: popup-events
  behavior incl. background-tab attribution + source contracts for the coded
  timeout, expect polling, fill parity, trusted-fill post-action, MCP
  AWAIT_TIMEOUT envelope, OAuth instructions, release version). Live browser
  acceptance `ur.*` in `tests/browser_extension_test.py` against
  `tests/fixtures/pre-8e-usability-ur.html`: slow-redirect click verifies
  `resolved.verified=true` with `resolved.attempts==1` (no re-click); fill
  verifies via characterData delta and reports an honest `verified:false` for
  an impossible delta; trusted popup click returns `openedTabs` with the
  popup `tabId` and `tabs.get` confirms `?popup=1`.
- Gates: `npm test` 517/517; `npm run check` PASS (26 primitives, 76 runtime
  files, 1.6.13); Edge-headless `tests/browser_extension_test.py` exit 0
  (`urAcceptance` all true: slowRedirectVerifiedWithoutReclick, fillVerified,
  fillHonestFailure, popupFollowThrough).
- Working-tree hygiene found this session: a prior interrupted writer had
  re-encoded many files with UTF-8 BOM and double-encoded em-dashes
  (`—` → mojibake) in `browser_extension_test.py`,
  `goal-ledger-contract.test.mjs`, and `mcp-inventory-compat-r4.test.mjs`;
  all were restored from HEAD and re-applied cleanly. Two stray owner JSON
  dumps at repo root (`ma-perkara-response.json`, `spi-2024-response.json`)
  failed naming governance; they were moved to `%TEMP%\kilo` (not deleted).
- Non-goals: no MCP tool/schema change, no new public params on the MCP layer,
  no refind mechanism, no production deploy, no CRX build/upload/activation.
  1.6.10 remains the single active release; 1.6.11/1.6.12 sources await their
  own signed CRX when the owner orders a release; 1.6.13 is a candidate.

## U-P3 stale semantic pruning implemented on r8 (2026-09-28)

Checkpoint **U-P3** (research P3, the second proposed follow-up after U-P1)
was implemented on `feat/pre-8e-usability-repair-r8`; the working tree carried
the implementation from an interrupted writer and all gates were re-verified
green before commit:

- `extension/semantic-identity.js`: new `invisibleGraceObservations` option
  (default 2, clamped 1..3). Each entity tracks an `invisibleStreak` of
  consecutive present-but-invisible observations; at the grace the
  model-facing item carries `stale: true` (advisory only — canonical state
  keeps the entity with identity and revision intact). The mark clears on the
  next visible observation. Entities emitted as REMOVE after the existing
  removal grace enter a bounded `returnedAfterGrace` set: a later
  re-observation reports `UPDATE … RETURNED_AFTER_ABSENCE` instead of
  `INSERT … NEW_ENTITY`, so virtualized feeds stop surfacing returning
  content as new state. `forget()` and `reset()` clear the set.
- `extension/content.js`: the compact-observation selection drops `stale`
  items alongside sensitive ones, so dismissed panels/controls stop reaching
  the model in compact reads while remaining in the rich snapshot.
- Version 1.6.12 across `extension/lib/protocol.js`, `extension/manifest.json`,
  `package.json`, `scripts/check.mjs`, and the version-lock assertions in the
  test suite. Protocol 1, 26 primitives, 22 MCP tools, and all public schemas
  unchanged.
- Live acceptance steps added to `tests/browser_extension_test.py` (`up3.*`:
  dismiss → first read `visible:false` without stale → second read
  `stale:true` → compact read drops the item) against a new dismissible panel
  in `tests/fixtures/pre-8e-usability-ax.html`; the live Opera run is NOT
  executed yet (owner-gated).
- Gates: focused `tests/stale-semantic-pruning.test.mjs` 7/7; full `npm test`
  506/506; `npm run check` PASS (26 primitives, 75 runtime files, 1.6.12).
- Non-goals: no U-P2 (vision sampling), no production deploy, no CRX
  build/upload/activation. 1.6.10 remains the single active release; 1.6.11
  remains the uploaded-inactive candidate; 1.6.12 source awaits its own
  signed CRX when the owner orders a release.

## 1.6.10 ACTIVATED and 1.6.11 uploaded inactive (2026-09-24, owner-ordered)

The owner ordered 1.6.10 activation and continuation of the 1.6.11 release
train. Both were executed and verified against live production:

- **1.6.10 activation**: atomic single-statement identity-scoped flip via MCP
  `execute_sql` (`set active = (version = '1.6.10')`), superseding the
  acceptance-first ordering on the recorded owner order; rollback exists via
  the same flip re-activating 1.6.9 (row intact, inactive). Pre-state was
  verified first (exactly one active row = 1.6.9; update.xml served 1.6.9;
  1.6.10 CRX path 404; disk artifact `D:\Opera\opera-agent-1.6.10.crx`
  53,950 bytes SHA-256 `7b3b9226…` = DB). Post-state verified: exactly one
  active row = 1.6.10; `update.xml?id=` serves `version="1.6.10"` with the
  1.6.10 codebase; the 1.6.10 CRX path returns 200 with 53,950 bytes whose
  SHA-256 equals DB and disk; the 1.6.9 CRX path 404s.
- **1.6.11 release train continued** (source = U-P1 head; CircleCI + Vercel
  SUCCESS on the exact release head `d13a4b9` before signing, per the frozen
  signing gate): CRX packed from a clean detached worktree of `d13a4b9` with
  the established private key kept outside the repository. Artifact
  `D:\Opera\opera-agent-1.6.11.crx` — **57,264 bytes**, SHA-256
  `1f6a1968030a2e994734d7f943dc582e996df1b9d5bcf7966c670a6afda9a462`.
  Offline verification (CRX3 protobuf-header verifier, calibrated against
  the production-served 1.6.10 artifact — byte/SHA-exact agreement):
  two-way ID from manifest key, proof key, and crx_id field all equal
  `ohbbpamcljckmjhcpkcmefdobkoeaick`; RSA-SHA256 CRX3 proof VALID over the
  Chromium-exact `CRX3 SignedData\x00` + u32le(SignedData) + SignedData +
  archive construction; deterministic resign matches and rebuilds a
  byte-identical CRX; all 13 packaged files match the worktree source
  byte-for-byte. Uploaded `1.6.11 / active=false` through the Management
  API path (documented read-only lift + database-query insert; payload built
  from the CRX on disk, temp payload file deleted). Post-upload verified:
  DB-decoded bytes 57,264 and SHA-256 equal the disk artifact; exactly one
  active row remains 1.6.10; `update.xml?id=` still serves 1.6.10; the
  1.6.11 CRX path 404s while inactive.
- Remaining owner decisions: live acceptance of 1.6.11 (U-P1 + U-V paths in
  real Opera after devices update to 1.6.10), then explicit activation of
  1.6.11 via the same atomic flip.

## U-P1 AX-tree observation implemented on r8 (2026-09-24, takes precedence)

Under the user's "faster and easier for AI like ChatGPT web" request, checkpoint
**U-P1** (research P1 flagship, `docs/checkpoint-up1-ax-observation.md`) was
implemented tests-first on `feat/pre-8e-usability-repair-r8`:

- Layer A (always on, pure DOM, no debugger): `collectInteractiveNodes()`
  pierces open shadow roots (bounded 120 roots / 600 nodes) across
  `semanticRegionObservation`, `pageFind`, `findVisibleTextCandidate`, and
  `page.wait_for` polling; `computeAccessibleName(el)` resolves the accname
  subset plus descendant `img[alt]`/`svg title`; `serialize()` attaches
  `accessibleName` only when it adds signal and `pageFind` matches it; the
  clipping hit-test accepts shadow-host hits via `composedHostChain`.
  Rebind pools stay flat light-DOM (fail-closed for shadow-originated refs).
- Layer B (poverty-triggered, CDP, read-only): `page.read` with
  `totalTextChars <= 400` attaches `page.axSummary` built by the pure
  `extension/lib/ax-summary.js` from one `Accessibility.getFullAXTree`
  collect via `withDebugger`. AX `value` fields and editable-role subtrees
  (memoized parentId closure) are excluded unconditionally; InlineTextBox,
  ignored, RootWebArea, and unnamed nodes dropped; deduped, 60-entry cap.
  Failures fail open (no axSummary). Rich pages keep the unchanged fast path.
- MCP guidance only (read_page description + instructions); **Protocol 1,
  26 primitives, 22 tools, frozen read_page input schema unchanged**.
- Version 1.6.11. Gates: node suite 499/499; `npm run check` PASS
  (26 primitives, 75 runtime files, 1.6.11); Edge-headless browser
  regression EXIT 0 with six new `up1.*` benchmarks (shadow find/click,
  accessibleName find, axSummary content + value-leak guards, rich-page
  no-trigger). P2/P3/P4/P5 blob locks and the derived MCP digest chain
  rebaselined with the recorded U-P1 reason.
- Non-goals: no AX→DOM actionable mapping, no AX geometry, no U-P2/U-P3,
  no production deploy, no CRX build/upload/activation (owner-gated).
  The 1.6.10 CRX remains the pending inactive release row awaiting the
  owner's activation decision; U-P1 rides 1.6.11 source for a future release.


## Repository-production sync (2026-09-22)

Gateway repair committed and pushed: HEAD `715031d` on
`feat/pre-8e-usability-repair-r8`, fast-forwarded to `main`. CI on the exact
head: CircleCI `ci` SUCCESS and Vercel SUCCESS; the SonarCloud failure is the
PR static gate with no PR open. The earlier "push remains on explicit owner
request" note is superseded. The sync commits (`f45b04d`, `44fa4cf`,
`c9b0c74` — migration renames, test path updates, ledger/docs sync) are also
CI green and `main` is fast-forwarded to `c9b0c74` (2026-09-23).

Migration drift found and repaired:

- Ten local migration files carried version IDs that differ from the
  production `schema_migrations` records (names matched). Renamed to the
  production IDs via `git mv` (`20260908021039`, `20260908031756`,
  `20260908035531`, `20260908074202`, `20260910121107`, `20260911162525`,
  `20260911162819`, `20260911231331`, `20260912061541`, `20260912061656`)
  with test path updates in `tests/ledger-server.test.mjs`,
  `tests/reactive-vm-host-7e.test.mjs`,
  `tests/reactive-vm-host-7e-boundaries.test.mjs`, and
  `tests/postgres/transaction-journal-8d.test.mjs`. Focused suites pass
  15/15 (ledger + 7E); `npm run check` PASS at 1.6.6. The postgres fixture
  test cannot run locally (`OPERA_PG_BIN` unset, no native PostgreSQL
  installed); CI verifies it on push.
- The production ledger was missing records for two verified-applied
  migrations. Verified applied first — workflow `youtube.skip_ads` v1
  enabled (`updated_at` 2026-09-21 23:28 UTC) and the `opera_watch_events`
  table plus all six ETW RPCs live — then recorded `20260921163000`
  `opera_agent_youtube_skip_ads_workflow` and `20260922000000`
  `opera_agent_ut_etw` in `schema_migrations` (41 rows) with pointer
  statements; exact SQL fidelity lives in the tracked repo files.
- Three migrations in the accepted line were never applied to production:
  `20260919171500` `pre_8e_r5_media_fast_path` (workflow `media.sample_at`
  absent), `20260919213000` `pre_8e_r6_navigation_fast_path` (production
  `youtube.play_recommendation` still v2 with the pre-R6 body), and
  `20260920090000` `pre_8e_r7_transcript_cleanup` (production
  `youtube.get_transcript` still v4 with 16 steps vs the R7 14-step v5
  body). They remain unrecorded; applying their content to production is a
  separate explicit owner decision (U-T may supersede the R5/R6 fast-path
  intent).

Kilo tooling state: the GitHub MCP server moved to global config
(`~/.config/kilo/kilo.jsonc`) as the remote `api.githubcopilot.com/mcp/`
server with a read-only header; the PAT was verified live (28 tools,
`get_me` OK), the broken Docker-based project config was removed, and
`.kilo/.gitignore` now ignores project `kilo.jsonc`. Supabase project
`nenmkmtvjremqphfqnfw` is ACTIVE_HEALTHY with `opera-agent-gateway` v2
ACTIVE.

## 1.6.6 ACTIVATED 2026-09-23 (owner-ordered)

The owner explicitly ordered activation, superseding the frozen
release-workflow ordering ("upload inactive, then acceptance before
activation") with a recorded reason: devices on 1.6.5 lack the ETW watch
engine required for live acceptance, so acceptance mechanically needs 1.6.6
served first. Rollback exists via the same atomic flip.

Executed and verified: atomic flip (`1.6.5` inactive, `1.6.6` active; exactly
one active release for `ohbbpamcljckmjhcpkcmefdobkoeaick`, sha256
`a33e5f36e805a240c2399415656373fad1461b9630299f2abf4f2d5b4de58e9b`); live
`update.xml` serves `version="1.6.6"` for the signed identity (the bare path
intentionally falls back to the legacy identity); the `1.6.6` CRX path
returns HTTP 200 with 50,049 bytes whose SHA-256 equals the DB row.
Remaining: live acceptance (watcher skips a real ad, zero analysis trips),
then the independent audit re-review.

## Gateway transaction repair + hosted deploy (2026-09-22)

The authorized local repair is based on `58264c5f2ffafe8e94ca8c51d2cae43019f5f768`
on `feat/pre-8e-usability-repair-r8`. The owner confirmed no other writer and
explicitly exempted existing untracked `.kilo/` and `graphify-out/` from the
clean-tree prerequisite; both remain untouched. Push remains on explicit owner
request.

The U-T `opera_run_fast` wrapper enqueues and waits within one SQL transaction,
so a separate device transaction cannot see the newly queued command before
the wait returns and commits. Local gateway source now verifies the token,
reads the non-disabled device's heartbeat to preserve the pairing/offline guard,
awaits `opera_enqueue`, then calls `opera_await_adaptive` with its command ID.
The caller still makes one HTTP request. Request-ID deduplication remains in
the existing enqueue RPC; no retries, public schema or SQL changes were added.
Existing enqueue failures, structured device results, 401/502 handling and
504 unknown-outcome warning are retained. The offline cutoff now uses the
gateway clock rather than the database clock; hosted clock/permission behavior
has not been exercised in this repair.

Tests-first evidence: the new executable gateway regression suite initially
failed 4/6 tests, including rejection of the combined RPC. After repair, the
gateway plus ETW suite passed 14/14; `npm run check` passed (72 runtime files,
26 primitives, 1.6.6). Full `npm test`: 477/478 passed, with only the existing
root-directory governance failure listing `.kilo`, `.opera-agent-8d-state`,
`deno.lock`, `graphify-out`, and `node_modules`. No assertion was weakened to
hide it. The old source assertion requiring the defective combined RPC was
replaced by executable request-ordering coverage.

Validation uses the real gateway handler with a mocked Supabase client; it is
not a live PostgreSQL/device acceptance test. The owner supplied an independent
audit finding P2: an await RPC/transport failure after committed enqueue lost
command identity and uncertainty in a generic 502. A new behavioral regression
failed first (6/7 passed; missing commandId), then passed after a bounded catch
around only the await RPC. That response retains HTTP 502 / GATEWAY_ERROR,
includes commandId and outcome="unknown", and instructs callers to verify page
state before repeating because the action may still have succeeded. No retry
is attempted. Both returned RPC errors and thrown transport errors are covered
without a caller requestId. Final focused suite: 15/15; static checks PASS.
The full-suite 477/478 result above predates this audit fix; it was not rerun.
The SQL wrapper remains unchanged and unsafe for new commands if called by
other clients. Review the local diff and obtain independent audit plus clean
CI/live acceptance under separate authorization before promotion. Earlier
deployment-readiness and single-SQL-call claims are superseded by this section.

Hosted deploy (2026-09-22, direct Supabase connection, owner-authorized without
DPAPI): `opera-agent-gateway` deployed to `nenmkmtvjremqphfqnfw` as version 2,
`ACTIVE`. The Management deploy tool exposes no `verify_jwt` parameter and the
first deploy landed with platform JWT enforcement, so `/health` and
`/openapi.json` returned 401 `UNAUTHORIZED_NO_AUTH_HEADER`; the owner disabled
"Verify JWT with legacy secret" in the dashboard. A redeploy reset the toggle
(401 recurred), the owner disabled it again, and with no further deploy it held.
Also found and fixed on the first hosted smoke: the hosted proxy rewrites the
request URL (strips `/functions/v1`, downgrades scheme), so the openapi
`servers[0].url` computed from `url.origin` was wrong
(`http://…/opera-agent-gateway`); the base path now comes from `SUPABASE_URL`
with a behavioral regression test (focused suite 16/16, `npm run check` PASS).
Final smoke (2026-09-22 11:28 UTC): `GET /health` 200 `ok:true, version 1.0.1`;
`GET /openapi.json` 200 with `servers[0].url` exactly
`https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway`;
`POST /command` without token 401 `UNAUTHORIZED` (gateway envelope, not a
platform error). Hosted source verified byte-exact against the working tree
(SHA-256 `1ad14896680b6c3525d4cb31b495aae8e03c53791d51a887333398502fe921f1`,
9508 bytes, `EXACT EQUAL: True`) and hosted config `verify_jwt: false`.
No other function, table `opera_releases`, or legacy identity was touched.

## U-I implemented on the R8 branch (takes precedence)

On 2026-09-21 the user requested a change that makes the agent "faster and
easier for ChatGPT web to use", and U-I (identity hardening; methods I1, I2,
I3 from the perception/identity/verification research) was implemented
**tests-first on `feat/pre-8e-usability-repair-r8`** by a separate writer:
action-ref descriptors record mint-time document-coordinate geometry
(`rectAtMint`) and `mutationVersionAtMint`; rebind through the R2 path now
fails closed with a 24 px document-coordinate tolerance and names current
plausible candidates when the target moved (production Maps hazard);
`page.find` annotates multi-candidate results with `candidateRank` +
disambiguation `hint`, and projects one bounded `fuzzy` candidate (exact-text
or closest-actionable-to-visible-text, I3) on a zero exact match instead of a
bare zero. No public MCP schema, protocol, or primitive changed. Local gates:
Node suite 453/454 (single failure = pre-existing local-only governance
test), `npm run check` PASS, controlled-browser regression (Edge headless=new)
exit 0 including three new U-I scenarios; P2/P3/P4/P5 content.js blob locks
rebaselined `9872dd3e…` → `0340d471…` (recorded reason: U-I runtime change).
Evidence record: `docs/checkpoint-ui-identity-hardening.md`. The R8 signed
release gate section below still governs 1.6.3 activation and 8E; U-I is
versioned inside the 1.6.3 candidate source until a newer signed version is
explicitly prepared.

## R8 signed-update continuation (takes precedence)

**Latest outcome: R8 T041 FAILED and the audited forward rollback completed.**
The original real-Opera prompt completed usefully, but the normal Skip path
returned offscreen `Skip navigation` plus the real Skip under explicit
`limit:20`, required model candidate filtering, suffered two stale-ref click
failures, and used coordinate fallback. Evidence:
`docs/pre-8e-performance-usability-r8.md`. Production now serves signed `1.6.2`
with accepted 1.6.0 behavior. Opera installed `1.6.2_0`; post-rollback ping was
408 ms with pairing preserved, Protocol 1, and 26 capabilities. R8 is blocked;
do not continue speculative repair, merge 1.6.1 to main, tag it accepted, or
start 8E.

The user subsequently authorized bounded repair tasks T046-T052. Tests-first
implementation now fixes explicit-limit dominant-item selection and over-broad
manual overflow clipping using conservative browser hit-test proof. Controlled
browser, static checks, and the 444-test canonical local Node subset pass;
exact-head CI and a signed version newer than production 1.6.2 remain pending.
Production is unchanged on 1.6.2 and this repair is not yet accepted.

Release candidate source is versioned 1.6.3. Repair head `78e038b` has
CircleCI #301 + Vercel SUCCESS. Exact release head `f1458c3` has CircleCI #302 +
Vercel SUCCESS (verified via the GitHub commit status API on 2026-09-21), and the
1.6.3 controlled browser/version/static gates pass locally. The signed 1.6.3 CRX3
(`D:\Opera\opera-agent-1.6.3.crx`, 40,690 bytes, SHA-256
`60bab5e1aae66f6f3ac34f56e2f75644da9c86e1731a294fb4098c0fd2a93897`) was packed
from a clean detached checkout of `f1458c3`; its RSA-SHA256 proof verifies per
the CRX3 specification, manifest key and proof key both derive the established
extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`, and all 10 packaged files match
the source byte-for-byte. The independent Codex audit on head `2ae2016` returned **PASS** with no blocking
findings, and the 1.6.3 registry row was uploaded inactive through the audited
Management write path (DPAPI-encrypted credential, value never exposed;
database-decoded bytes match the recorded 40,690-byte artifact and SHA-256
exactly, 1.6.2 remains the sole active row for the identity, identity-specific
health/XML still serve 1.6.2, and the identity-specific 1.6.3 CRX path returns
404 while inactive). Remaining: bounded live R8 acceptance in real Opera
(side-loaded 1.6.3; manual rollback = re-installing the 1.6.2 CRX), then explicit
user activation.

The user authorized a same-identity signed `1.6.1` update for R8 and requested
the production update path rather than an unpacked extension. The R8 candidate
head `f38eddef508b96ec4df641af56377c611030ddf5` has CircleCI #295 + Vercel
SUCCESS. Its offline CRX3 is 40,441 bytes, SHA-256
`8c980dbe37cbccf2f272e45e8045fd7d6e91ad0d666dd289bc65eccaa6d49b1e`,
and both manifest/proof keys derive the established extension ID
`ohbbpamcljckmjhcpkcmefdobkoeaick`.

Two earlier pre-production audits returned **CONDITIONAL PASS**. The final
independent audit on exact evidence head
`248d73ec05713a2f2b7682a3fb43fc3805279cef` returned **PASS** after verifying
both artifacts and the forward-rollback plan. The earlier release-safety issue
was that reactivating signed `1.6.0` in the
registry cannot downgrade a browser that already installed `1.6.1`. An offline
forward rollback `1.6.2` has therefore been prepared from accepted tag `v1.6.0`
(`96ef1cfdbecc7c5c0e40486b6378501db606b84d`): all extension behavior bytes
match that tag and only `manifest.json`, `lib/protocol.js`, and `popup.html`
change their packaged version to `1.6.2`. The signed CRX3 is 35,631 bytes,
SHA-256 `bca7d9d5199f0075ac41fcc929e260943acd8c4e1e076fc26cf9294c408a085a`;
its manifest/proof identity matches the established ID and all 10 packaged files
match the prepared source byte-for-byte. The accepted 1.6.0 controlled-browser
harness passes with version-only expectations updated to 1.6.2, including 20/20
burst stability and 55-command focus preservation.

Production stores both artifacts with database-decoded hashes and sizes matching
local evidence. After the failed gate, the audited atomic rollback made signed
`1.6.2` the sole active row; 1.6.0 and 1.6.1 are inactive. Identity-specific
health/XML and the downloaded 35,631-byte CRX match its recorded SHA-256. The
pre-existing root `deno.lock` was confirmed as untracked, history-free, partial
local Deno CLI resolver state rather than a repository dependency contract; it
is now ignored explicitly as `/deno.lock` without deleting the local file.
Exact next action requires a separately authorized evidence-first repair of the
explicit-limit projection and live viewport/actionability discrepancy. T041–T045
remain open. Milestone 8E remains paused.

## Latest repair continuation (takes precedence over historical entries below)

User explicitly requested R5 through R8 sequentially. R5–R7 are **ACCEPTED /
CLOSED**; R6 closed **without transport migration** (T032: residual queue share
2–8% on navigation paths, ≤ ~250 ms absolute on primitives; T033: Realtime wake
not justified). Evidence: `docs/pre-8e-performance-usability-r6.md`. T031's
repair head `3d21ecc58cfece6e55f40433525a7a6c1db27800` passed CircleCI #258 +
Vercel SUCCESS. R7 (T034–T038) YouTube workflow cleanup is closed. R8
real-Opera acceptance now waits on the audited signed-update procedure described
above, not on Opera installation. On 2026-09-19
the user additionally ordered repository consolidation (merge the closed repair
line into `main`, archive-tag and prune stale branches) and stricter
anti-mistake rules for future AI sessions; the consolidation supersedes the
earlier "do not merge to main" caution because R6 is closed. Production
deployments, signed promotion, Realtime transport cutover and 8E remain outside
scope. The live paired extension reports 1.6.0 / Protocol 1 / 26 capabilities;
that does not prove the unpromoted repair candidate is installed.

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, accepted checkpoint records, and the selected execution plan.

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
  track into `main` merely to reduce branch count. (Superseded 2026-09-20 by the
  consolidation note above: R6 is closed, `main` is fast-forwarded to the
  accepted head, and merging closed checkpoints into `main` is required.)

This hardening changes no extension/runtime/public MCP contract, production
deployment, signing identity, or Milestone 8E authorization. The exact next product
work is **R7 T034–T038 YouTube workflow cleanup**, authorized under the standing
CI-evidence authorization.

## Current boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Accepted P5 / canonical P6 base: `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- P6 candidate branch: `feat/performance-runtime-cutover-p6-4571636311958769504`
- P6 exact final-candidate head:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- P6 exact candidate CI: CircleCI #118 + Vercel **SUCCESS**
- P6 independent audit: **PASS / CLOSED WITH USER-ACCEPTED REVIEWER DEVIATION**
- PR #46: **MERGED** at `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`
- P6 merge CI: CircleCI #169 + Vercel **SUCCESS**
- Repowise integration branch: `chore/repowise-integration`
- Repowise R1 compatibility: **PASS**
- Repowise R2 repo setup head:
  `706001747aefb9b629d4e301a30d814f5e9754e3`
- Repowise R2 CI: CircleCI #119 + Vercel **SUCCESS**
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Signed rollback: `1.5.2`
- Milestone 8: 8A–8D **ACCEPTED**; 8E paused/not started
- Durable 8D closeout: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Performance Track: P0–P6 **ACCEPTED / CLOSED**
- P6 production promotion/deploy: **DONE / VERIFIED**
- Production `opera-agent-vm`: version **27**, `ACTIVE`, `verify_jwt=true`
- Production deployment bundle SHA-256:
  `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`
- Production source verification: all 14 deployed source/import files match merge
  commit `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac` byte-for-byte
- Safety state after promotion: `milestone7_vm_enabled=false`; VM run/effect/rate
  tables remain 0/0/0

Canonical plan: `docs/delta-first-performance-plan.md`.
P6 record: `docs/delta-first-performance-p6.md`.

## P6 accepted — durable runtime cutover, maximal safe subset

1. **Durable consuming path**
   - `supabase/functions/opera-agent-vm/index.ts` invokes
     `reconcileVmEffectObservation7E` after successful `opera_await`.
   - DB-backed 7E lease/checkpoint/effect-reservation/idempotency remains
     authoritative; the in-memory P4 host does not replace durable state.

2. **Cold-start / continuity safety**
   - missing P1/P2/P3 continuity fails closed to `RESET_REQUIRED` and
     `FULL_SNAPSHOT`; stale continuation is not permitted.

3. **Dependency authority boundary**
   - caller-asserted `taskDependencies` are rejected.
   - live task context therefore remains `MISSING` until a trustworthy
     server-authoritative dependency source exists.
   - ordinary live relevance updates conservatively yield `REASON_REQUIRED`;
     **full integrated P3/P4 speedup is not yet enabled by this safe subset**.

4. **Continuation allowlist**
   - if `performanceCutover` metadata is present, only a valid accepted
     `APPLY_AND_CONTINUE` with `reasoningWakeRequired=false`,
     `reasoningObservation=null`, and `contextStatus=ACCEPTED` may continue.
   - reset-required -> `SUSPENDED / STALE_TARGET`.
   - REASON_REQUIRED, IGNORE_FOR_TASK, unknown/missing decision, malformed or
     inconsistent flags/context -> `SUSPENDED / NEEDS_MODEL`.
   - effect results without P6 metadata retain pre-P6 compatibility.

5. **Preserved surface**
   - full page text/snapshot recovery retained;
   - `opera_enqueue` / `opera_await` and required browser primitives retained;
   - Protocol 1, 26 browser capabilities, 18 public MCP tools retained;
   - no production deploy, DB migration, OAuth/signing/pairing change, public schema
     expansion, transaction authority, or 8E implementation.

## Exact implementation/regression evidence

- tests-first `b8cd79f27f135923a63657beced8563ed7e7a0c7`:
  CircleCI #114 FAILURE as expected.
- implementation `5652435e26f534126bfcee7c48df9ffd597fc52e`:
  new P6 allowlist/fail-closed tests PASS; CircleCI #115 exposed only stale historical
  P3/P4/P5 byte locks for intentionally changed `lib/reactive-vm.js`.
- authorized lock rebaseline
  `49731c49e75df058dcd48218e680a8ad9aaf7195`:
  CircleCI #116 + Vercel SUCCESS.
- #116 `npm test`: **416/416 PASS**, 0 fail, 0 skipped.
- #116 `npm run check`: PASS; 26 allowlisted primitives, version 1.6.0.
- #116 Chromium extension regression: PASS.

The exact audited P6 candidate head is
`96ef1cfdbecc7c5c0e40486b6378501db606b84d`; CircleCI #118 and Vercel are
SUCCESS. The independent audit is PASS/CLOSED with the documented user-accepted
Jules reviewer deviation. PR #46 was explicitly merged as
`6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`; CircleCI #169 and Vercel are
SUCCESS on that merge commit. Production promotion is complete: `opera-agent-vm`
version 27 is ACTIVE with `verify_jwt=true`, deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`,
and all 14 deployed files match the merge commit byte-for-byte. The VM feature flag
remains false and VM tables remain empty.


## Repowise integration track

Scope is limited to local/private codebase intelligence and supporting
documentation/utility. It does not change Opera Agent runtime behavior, production
Supabase, OAuth/signing/pairing, protocol, browser capabilities, or public MCP tools.

- R1 compatibility research passed for Repowise 0.51.0.
- R2 created an isolated local Python setup on
  `chore/repowise-integration` at
  `706001747aefb9b629d4e301a30d814f5e9754e3`.
- Added `tools/repowise/requirements.txt` pinned to `repowise==0.51.0` and
  `tools/repowise/bootstrap.py`, which creates `.repowise-venv/`, disables
  Repowise telemetry during bootstrap, installs the pinned version, and verifies
  the installed version.
- `.repowise/` and `.repowise-venv/` are gitignored and must remain local.
- CircleCI #119 + Vercel are SUCCESS for the R2 setup head.
- This ChatGPT sandbox has Python 3.13.5, Git 2.47.3, pip 25.1.1, and uv 0.10.0,
  but DNS/network egress to GitHub/PyPI is unavailable. The Repowise wheel could
  therefore not be installed or indexed in this sandbox.
- No Repowise index/database/cache has been committed or uploaded.
- R3 initial indexing is **PASS**. Full-history evidence head:
  `3a83bbed0177a67ce882237965bc6d3706335b4c`; CircleCI #134, normal
  regression #133, and Vercel are SUCCESS.
- R4 local MCP integration is **PASS**. Offline evidence head:
  `abaf20e28fb93fe2488be4ce9f9cbe0721225992`; CircleCI #141, normal
  regression #140, and Vercel are SUCCESS.
- R5 AI codebase-context documentation is **PASS**. Documentation head:
  `e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`; CircleCI #143 and
  Vercel are SUCCESS.
- R6 validation evidence is **PASS with documented limitations** at
  `7fae3a095e7096cec6945b7c4ea274764881b609`; CircleCI #147 validation,
  #148 normal regression, and Vercel are SUCCESS.
- R6 exact closeout head
  `6c1f06a2e7d11c62dc8ebfb0a0a13cb31e28140d`: CircleCI #149 + Vercel
  SUCCESS.
- R7 final Repowise closeout is **PASS / CLOSED**. Final-candidate head
  `0338f83c198ff38d0bbc4e864692c01c9a34d327`: CircleCI #150 + Vercel
  SUCCESS; canonical test/check/Chromium regression passed.


## Repowise R3 initial-index status

R3 is **PASS**.

Exact full-history evidence head:
`3a83bbed0177a67ce882237965bc6d3706335b4c`.

Verified evidence:

- Repowise version: `0.51.0`.
- CircleCI #134 `repowise_r3_full`: **SUCCESS**.
- CircleCI #133 normal regression: **SUCCESS**.
- Vercel: **SUCCESS**.
- Initial-index elapsed time: **34.984 seconds**.
- Local Repowise index size: **18,730,491 bytes** (~**17.86 MiB**).
- Git-tracked files at the evidence head: **312**.
- Repowise graph-indexed file nodes: **301**.
- Symbols indexed: **1,429**.
- Generated deterministic/index-only wiki pages: **74**.
- Parse errors: **0**; parse-error file list is empty.
- Git-history indexing: **available**, covering **348/348 commits** with
  **121** persisted `git_metadata` rows.
- Indexed head exactly matches the evidence SHA above.
- Working tree was clean before and after indexing with no unexpected project-file
  side effects.
- All seven required R3 files were graph-indexed with no parse error:
  - `lib/reactive-vm.js`
  - `lib/reactive-vm-host-7e.js`
  - `lib/multi-signal-relevance-p3.js`
  - `supabase/functions/opera-agent-vm/index.ts`
  - `tests/performance-runtime-cutover-p6.test.mjs`
  - `AGENTS.md`
  - `docs/delta-first-performance-plan.md`

Privacy/isolation remained intact: telemetry disabled, no LLM/provider key exposed,
provider keys removed from the child environment, prose generation disabled,
editor setup disabled, key persistence disabled, and the mock embedder used.
No `.repowise/` database/cache/index was committed or uploaded.

Diagnostic history worth preserving:

- The first successful structural index at `48f5943...` exposed a CircleCI
  blobless partial clone (`remote.origin.promisor=true`, filter `blob:none`).
  Repowise correctly skipped Git history in that environment, yielding zero
  `git_metadata` rows.
- The R3 validator initially also required every important file to have a generated
  wiki page. That was too strict for Markdown/test files in deterministic/index-only
  mode; the correct R3 requirement is graph-indexed + no parse error.
- The final R3 job hydrated the checkout to a complete Git object set, removed
  partial-clone/promisor config, verified no missing objects, then required both
  complete Git-history coverage and the seven-file graph checks before PASS.
- CircleCI #131 failed only because of a shell quoting defect in the temporary
  full-history guard after object hydration had succeeded; the quoting defect was
  corrected at `3a83bbe...`.

Temporary R3-specific CircleCI jobs are removed at closeout; normal CI remains the
canonical pipeline. `tools/repowise/r3_probe.py` and
`tools/repowise/r3_assert.py` remain bounded local/CI diagnostic utilities.

## Repowise R4 local MCP status

R4 is **PASS**.

Exact offline evidence head:
`abaf20e28fb93fe2488be4ce9f9cbe0721225992`.

Implementation/evidence chain:

- tests-first `9f7ee9dcfee2ec79e85999940559ff30e244aeb5`:
  - CircleCI #136 `repowise_r4_mcp`: expected **FAILURE** because the launcher
    did not yet exist;
  - CircleCI #137 normal regression: **SUCCESS**;
  - Vercel: **SUCCESS**.
- initial implementation `555044f68513096a6705b77e32ce1deba0018954`:
  - CircleCI #139 MCP acceptance: **SUCCESS**;
  - CircleCI #138 normal regression: **SUCCESS**;
  - Vercel: **SUCCESS**;
  - the acceptance log exposed one outbound PyPI release-version GET at MCP
    startup. It did not upload source or use a provider, but it violated the R4
    offline boundary and was not accepted as final.
- offline hardening `abaf20e28fb93fe2488be4ce9f9cbe0721225992`:
  - CircleCI #141 MCP acceptance: **SUCCESS**;
  - CircleCI #140 normal regression including Chromium extension regression:
    **SUCCESS**;
  - Vercel: **SUCCESS**;
  - the final MCP smoke output contains no PyPI/HTTP request and reports:
    `transport=stdio`, `tool_count=10`, and `overview_call=ok`.

Committed R4 integration:

- `tools/repowise/mcp_stdio.py` — cross-platform repo-local launcher.
- `tools/repowise/mcp_smoke.py` — MCP initialize/list-tools/call acceptance test.
- `tools/repowise/MCP_CONFIG_TEMPLATES.md` — manual client templates; no user or
  editor config is overwritten.

The launcher uses only MCP **stdio** and does not bind an HTTP/SSE/public port.
It forces single-repository mode and exposes exactly these ten local tools:

1. `get_overview`
2. `get_context`
3. `get_symbol`
4. `search_codebase`
5. `get_risk`
6. `get_change_risk`
7. `get_why`
8. `get_dead_code`
9. `get_health`
10. `get_dependency_path`

The R4 runtime is deliberately provider-free/offline:

- provider and embedder are forced to `mock`;
- common provider-key environment variables are blanked for the child runtime;
- the launcher calls Repowise MCP directly rather than the CLI path that loads
  project-local `.repowise/.env`;
- Repowise's advisory PyPI release poll is replaced by an offline local result;
- DNS plus TCP/UDP socket egress is denied for the MCP process, while local
  `AF_UNIX` IPC is preserved;
- telemetry, editor setup, and key persistence remain disabled.

Manual templates cover Claude/generic `mcpServers` clients, Codex TOML, and the
Repowise-compatible generic shape for Gemini CLI. R4 does not write those configs.
ChatGPT is not given a public endpoint or local-stdio bridge; any secure tunnel or
remote-MCP bridge would change the connectivity boundary and remains outside R4.

No Opera Agent runtime behavior, production Supabase state, OAuth/signing/pairing,
Protocol 1, 26 browser capabilities, or 18 public Opera Agent MCP tools changed.
No Repowise database/index/cache was committed or uploaded.

Temporary R4-specific CircleCI jobs are removed at closeout; normal CI remains the
canonical pipeline.

## Repowise R5 AI codebase-context documentation

R5 is **PASS**.

Exact documentation head:
`e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`.

Evidence:

- `docs/ai-codebase-context.md` added as the durable operational entry point for
  AI-assisted codebase context.
- CircleCI #143: **SUCCESS**.
- Vercel: **SUCCESS**.
- no Opera Agent runtime, production Supabase, OAuth/signing/pairing, Protocol 1,
  browser capability, or public MCP surface changed.

The document records:

- Repowise 0.51.0 bootstrap and isolated local install;
- privacy-hardened initial/rebuild indexing;
- `repowise status` freshness checks;
- provider-free incremental refresh with
  `repowise update . --index-only --no-workspace`;
- CLI query examples for context/search/symbol/why/risk;
- the R4 local stdio MCP launcher and exact ten-tool allowlist;
- the repository/source-of-truth hierarchy;
- stale-index, static-analysis, partial-clone, mock-embedder, and
  provider-free/index-only limitations;
- an explicit rule that Repowise is a derived context layer, not runtime,
  governance, CI, release, or architectural authority.

No npm script was added in R5 because the committed cross-platform Python tooling
already provides the required entry points without adding shell portability
assumptions to `package.json`.

## Repowise R6 validation

R6 validation evidence is **PASS with documented limitations**.

Exact evidence head:
`7fae3a095e7096cec6945b7c4ea274764881b609`.

Evidence:

- CircleCI #147 `repowise_r6_validation`: SUCCESS.
- CircleCI #148 normal test/check/Chromium regression: SUCCESS.
- Vercel: SUCCESS.
- ten Repowise MCP calls across the five frozen A-E questions;
- zero nonexistent path mentions;
- five baseline `git grep` calls produced 84 candidate-file hits in aggregate
  and 51 unique candidate files;
- Repowise surfaced 47 paths in aggregate.

Question findings:

- A: exact two-branch runtime structure recovered:
  `index.ts -> reactive-vm-7d.js -> reactive-vm.js` and
  `index.ts -> reactive-vm-host-7e.js -> multi-signal-relevance-p3.js`.
- B: `advanceReactiveVm` callers/dependents and relevant P6/reactive tests were
  surfaced correctly; risk data reported five direct dependents and ten
  transitive affected paths.
- C: durable-state discovery correctly led to the DB-backed reactive-host
  migration/RPCs and the Edge VM host; in-memory P4 is not authoritative.
- D: Repowise correctly surfaced the unauthoritative-`taskDependencies` history
  and P3/P4 gate context, but `get_why` had no decision record and reported no
  file-specific history for the performance plan. The plan/source remains
  authoritative.
- E: target file `supabase/functions/opera-agent-mcp/index.ts` and
  `createServer()` were identified, but exact literal `server.registerTool`
  inventory is better served by grep; Repowise explicitly warned its result was
  fuzzy.

The first R6 job #146 failed only because the CircleCI image lacked `rg`; all
ten MCP calls had already completed. The baseline was switched to repository-native
`git grep` and #147 passed. This is a harness portability fix, not a Repowise
behavior fix.

Detailed record: `docs/repowise-r6-validation.md`.
Reproducible harness: `tools/repowise/r6_validate.py`.
Temporary R6 CircleCI instrumentation is removed at closeout.

R6 establishes a hybrid policy: use Repowise for orientation/structure/impact/
history, then verify consequential claims against exact source and CI. Prefer
normal repository grep for exhaustive literal inventory.

The Repowise integration track is closed after R7. No later Repowise checkpoint
or scope expansion is authorized implicitly. Any remote/public MCP, external
provider, cloud upload, editor auto-configuration, or runtime coupling requires a
new explicitly scoped review.

## Pre-8E Performance Usability Repair — R0–R2 accepted; R3 implemented

On 2026-09-18 the user approved inserting a findings-driven repair track before
Milestone 8E after a live production-path YouTube test.

Canonical plan:
`docs/pre-8e-performance-usability-repair-plan.md`.

Spec Kit feature:
`specs/001-pre-8e-performance-usability-repair/`.

Status: **R0–R3 ACCEPTED / CLOSED (R3 accepted on CI evidence); R4 AUTHORIZED / IN PROGRESS under the 2026-09-19 standing CI-evidence authorization**.

Frozen findings include:
- on-screen ad `Skip` competing with offscreen `Skip navigation`;
- the correct dynamic Skip ref becoming stale before click;
- Home/watch `page.read` model-facing results becoming very large despite only
  ~686/~3,331 text characters and ~119/~139 observed entities;
- `media.state` working in ~514ms while media primitives remain internal;
- YouTube Home navigation ~5.224s with only ~131ms queue;
- `youtube.get_transcript v4` ~20.514s total.

The repair sequence is R0 benchmark lock -> R1 actionability -> R2 fresh target
revalidation -> R3 local act+verify -> R4 compact observation -> R5 internal media
fast path -> R6 navigation/residual transport -> R7 workflow cleanup -> R8 full
real-Opera acceptance.

R1 changed only generic observation/actionability behavior in `extension/content.js` plus tests/docs: viewport truth and actionability are exposed, actionable controls are ranked before bounded truncation, and equal-rank ordering remains stable.

R2 adds bounded action-time fresh-target revalidation in `extension/content.js`: a stale ref may rebind only to one same-document/same-route equivalent current target that matches frozen descriptor identity/metadata and is actionable/non-sensitive. Ambiguity, route reset, sensitivity change, weak evidence, or disappearance fail closed. Caller-provided observational `logicalId`/coordinates are not action authority. No production deployment/schema mutation, VM enablement, public MCP expansion, transaction authority, or 8E work was performed.

R3 is accepted/closed. Its bounded post-action verification uses
`semanticIdentity.inspect()` after actions so mutation/target evidence is returned
without consuming canonical UPDATE/RESET delivery required by the next full
`page.read`. SPA/runtime action refs stay monotonic; connected refs still require
descriptor/document/route continuity; explicit file-upload rejection remains
fail-closed without sensitive stale rebind.

R4 is authorized/in progress. T021 froze Protocol 1 / 26 browser primitives /
18 public MCP tools and the existing `read_page` input schema. T022 added expected-
red controlled compact-observation tests. T023 now projects compact model-facing
elements from the existing canonical observation: canonical semantic identity/delta
and semantic-view state still advance internally, while compact output retains
bounded delta evidence and a small set of changed/actionable/in-viewport non-
sensitive elements. Legacy/default primitive `page.read` and explicit
`view=full` remain full; public MCP `read_page` selects compact mode internally
without adding a public input field.

R4 implementation head `6887663421882df099fc70d2a4ba12ae7e442f29`
reached CircleCI #242, where 419/426 unit tests passed and all seven failures were
historical MCP source/byte locks: four Git-blob SHA-1 locks still expected the
pre-R4 MCP file, while 6E/7F/semantic-release still expected the pre-R4 canonical
SHA-256. The new R4 compatibility tests themselves passed: Protocol 1, 26 browser
primitives, 18 public MCP tools, and the frozen `read_page` input schema remained
unchanged. The repair rebaselines only those authorized internal-source locks to
Git blob `74a82bdc182698f11e2ccbe955f39ebb2e2ed86a` and canonical SHA-256
`4cf462a3cd4683b20e17fe2679e8dc762706129088b33a1c339826c6b43e31fb`; P2/P3 additionally assert that compact selection is internal and
that no public Zod `view` input exists.

CircleCI #243 on the first lock-rebaseline head improved the unit/static gate from
419/426 to 423/426 PASS. The three remaining failures were fully derived contract
values, not runtime regressions: the 6A and 8A baseline fixtures still embedded the
pre-R4 MCP SHA-256, and the Milestone 7 inventory digest still embedded that old
MCP source digest. The exact recomputed inventory digest reported by the canonical
7A test is `sha256:3f879c35ef89d30075d0ed9be08965f75f25f34f19a697f2b00fbe4b21a25137`. The follow-up rebaseline updates only those derived
fixture/test constants; Protocol 1, 26 primitives, 18 tools, `read_page` schema,
runtime code, production state, and safety assertions remain unchanged.

R4 T021–T025 is complete on implementation/evidence head
`4c1e4cbbe0644b06bf51ce952be78edac8aa9182`. CircleCI #244 + Vercel
are SUCCESS. Exact gate evidence: 426/426 unit tests PASS, `npm run check`
PASS, Chromium extension regression PASS, and controlled compact observation
reduces the equivalent model-facing payload by **96.54%** while retaining the
on-screen actionable target, fresh changed-target evidence, and SPA RESET
recovery. Durable evidence is in
`docs/pre-8e-performance-usability-r4.md`.

R4 is now a closeout candidate only; final ACCEPTED/CLOSED status requires
CircleCI + Vercel SUCCESS on the exact documentation closeout head. R5 is not
started in this session.

R4 is now ACCEPTED/CLOSED. Closeout head
`c2f2875686014439404b47518f9cc1789e202a7f` has CircleCI #245 + Vercel
SUCCESS.

R5 is authorized/in progress. Before T026, repository search plus read-only
production registry/history inspection proved there is no existing URL timestamp
or reload-based media seek workflow to rewrite. Existing YouTube
`tabs.navigate` calls change pages/videos and must remain navigation. T026
therefore locks the smallest safe design: a new internal workflow
`media.sample_at` must use existing `media.state`, `media.pause`,
`media.seek`, and `media.play`, preserve prior playback state, forbid
`tabs.navigate`/`tabs.reload` and timestamp-URL seeking inside that workflow,
and remain absent from the 18-tool public MCP surface.

R5 T026 tests-first head `e4baf6274623a301bacc37745cba2eca7a6d60ef`
produced the expected CircleCI #246 red gate: 427/429 tests PASS and the only
two failures state that the R5 media fast-path migration does not yet exist.
No unrelated regression was observed. T027 adds only the versioned server
workflow migration `media.sample_at`; it uses `media.state`, conditionally
`media.pause`, `media.seek`, conditionally `media.play`, then final
`media.state`. It never uses `tabs.navigate`/`tabs.reload` or timestamp
URLs, and it does not add a public MCP tool.

R5 T027 implementation head `bafddea8168d0f1933b18c0f394703ba453e0c83`
has CircleCI #247 + Vercel SUCCESS. T028 candidate adds a deterministic
ready-media browser benchmark: a local 2-second WAV fixture is loaded in a
background tab, readiness/duration are verified, nine `media.seek` commands
are measured through the normal extension command path, each resulting
`currentTime` is checked, p50 must be <=1000ms, and the measured window must
contain no `tabs.navigate` or `tabs.reload`. Background-focus preservation
is audited on every seek.

The first T028 candidate `3384757f3e1249be0ed0fbfd222b601a8b55d12a`
failed CircleCI #248 in the Chromium extension regression before any measured
`media.seek`: the new benchmark referenced the legacy `focus_audit` local before
that variable is initialized later in the harness. Repository-local source fully
explains the failure, so no upstream research is required. The repair uses a
dedicated `r5_focus_audit`, asserts the R5 media tab is not active, and derives
background-focus preservation from all nine seek audits. It does not change the
1-second threshold, runtime behavior, public MCP contract, or production state.

The repaired candidate `0bb99e6d14251b2b9e0e40dcb39c9cd254338297` then
failed CircleCI #249 only in the Chromium extension regression. Exact step-output
evidence shows the second measured seek (target 0.25s) returned `currentTime: 0`
while the fixture was only `readyState: 1` / HAVE_METADATA. WHATWG HTML defines
HAVE_METADATA as metadata-only with no media data available at the immediate
playback position, and defines `seekable` as the ranges the user agent can seek
to; it also notes full-resource seekability when the server supports HTTP Range.
The deterministic fixture therefore must not treat HAVE_METADATA as ready-media.
The repair adds bounded single-range byte serving for the local WAV, requires
HAVE_CURRENT_DATA-or-better (`readyState >= 2`) before measurement, and tightens
the seek-position tolerance from 150ms to 50ms. This is test/fixture hardening
only; the runtime media primitive, p50 <=1000ms threshold, public MCP surface,
and production state remain unchanged.

## Governance / next boundary

- one active writer;
- tests before runtime behavior;
- pending required CI = STOP;
- permanent evidence-first bug repair loop is authoritative in `AGENTS.md` and is
  now projected into the active Spec Kit feature (`spec.md`, `plan.md`,
  `tasks.md`, and `research.md`) using the repository's official Spec Kit
  template structure: every unexpected error/bug/CI regression must be captured
  and researched before repair, must have deterministic regression evidence
  before runtime changes, and must use the smallest generic fix followed by
  focused + required full gates; platform/library/browser/protocol uncertainty
  requires primary external/upstream evidence, while fully proven local defects
  may use repository research alone; blind retries/guess-patching are prohibited
  and a third same failure without new evidence becomes blocked +
  diagnostics/early audit;
- the P6 independent audit gate is **PASS / CLOSED WITH USER-ACCEPTED REVIEWER
  DEVIATION**;
- exact audited range:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77..96ef1cfdbecc7c5c0e40486b6378501db606b84d`;
- Jules returned **PASS** as the independent read-only reviewer because Codex
  quota was exhausted; the user explicitly authorized continuation after the
  reviewer-deviation/residual-risk condition was disclosed;
- exact P6 candidate repository evidence is CircleCI **#118 SUCCESS** + Vercel
  **SUCCESS**. The Jules report's #116 reference is historical and not the
  final-candidate CI identifier;
- durable audit record: `docs/p6-independent-audit-closeout.md`;
- PR #46 is merged at `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`;
  CircleCI #169 + Vercel are SUCCESS on the merge commit;
- production promotion is complete and verified at `opera-agent-vm` version 27;
- P6 is **ACCEPTED / CLOSED**;
- Pre-8E repair R0 is **ACCEPTED / CLOSED** with durable evidence in `docs/pre-8e-performance-usability-r0.md`;
- R1 implementation evidence head `b0ff03cd0f3ecbf4498b8392760d9492fb44ff77` has CircleCI #219 + Vercel SUCCESS; durable evidence: `docs/pre-8e-performance-usability-r1.md`;
- R1 is **ACCEPTED / CLOSED** after actionability-first observation, bounded-ranking acceptance, historical hash-lock rebaseline, and controlled Chromium regression;
- R2 implementation evidence head `70c79db6d76ab624d19bd5d6067a1469ef522045` has CircleCI #226 + Vercel SUCCESS; durable evidence: `docs/pre-8e-performance-usability-r2.md`;
- R2 is **ACCEPTED / CLOSED** after unique same-document recovery, unsafe-case fail-closed coverage, authorized content hash-lock rebaseline, and controlled Chromium regression;
- the user explicitly authorized **R3 only**; R3 implementation evidence head `285374f20ef1592d16246fe1e53ab4c9d8b8da81` and governance head `5b5ed172770e5b1ce6bc428c84902d48762ce8bf` have CircleCI SUCCESS + Vercel SUCCESS; durable evidence: `docs/pre-8e-performance-usability-r3.md`;
- R3 is **ACCEPTED / CLOSED** on the user's 2026-09-19 CI-evidence acceptance (CircleCI + Vercel SUCCESS at `285374f`, `5b5ed17`, and closeout `3f765cf`; local gates 423/423 PASS + `npm run check` PASS) after bounded post-action verification, recorded failure-repair chains (route-reset revival, reset evidence, semantic delta authority, read compatibility, file-upload guard) and a local Windows CRLF hash-lock mechanism repair;
- the user granted a standing 2026-09-19 authorization: repair checkpoints proceed sequentially without per-checkpoint manual sign-off, with CircleCI + Vercel SUCCESS on each checkpoint's evidence head as the acceptance criterion; production deployment/signed-release promotion, R6 T033's conditional transport stop, and the 8E start decision remain outside this standing authorization;
- 8E remains paused/not started and cannot begin until the repair track reaches R8
  acceptance and the user separately authorizes 8E.

## Rollback / preserved state

- accepted P5 `a215dd0ddb4d7be9b0c0276862ced3ea26439c77` remains the clean candidate
  rollback baseline until P6 is accepted.
- signed rollback 1.5.2 remains available.
- two accidental untracked 8E files were previously preserved in the git stash
  named **"preserve accidental 8E files before completing checkpoint 8D"**.
  Do not pop/apply/delete/build from that stash automatically; inspect only against
  canonical 8E scope if 8E later resumes.

## Permanent invariants

- repository/CI/production evidence outranks chat;
- background-first browser operation; no silent foreground takeover;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit/print credentials or sensitive page values;
- action success is not completion proof;
- performance gains never justify stale-state action, false completion, missed
  relevant changes, or foreground takeover.


## Spec Kit governance adoption

A bounded Spec Kit governance adoption is active on
`chore/spec-kit-governance`, based on Repowise closeout
`3620716e27cae595167216fd7ac011ce9a4871d3`.

- pinned Spec Kit: `specify-cli==1.0.8`;
- official v1.0.8 Codex skills + PowerShell shared scaffold are repository-persistent;
- constitution projects existing `AGENTS.md`/`SECURITY.md` rules rather than replacing them;
- optional/community extensions and runtime events are disabled/not adopted;
- regression coverage: `tests/spec-kit-governance.test.mjs`;
- acceptance evidence head: `f8e860df9803805704ac70c894800b47b6bf3dc4`;
- CircleCI #163: **SUCCESS**;
- Vercel: **SUCCESS**;
- status: **PASS / CLOSED**.

This adoption itself did not satisfy the P6 independent audit. That later audit
gate is now closed separately by `docs/p6-independent-audit-closeout.md` with a
user-accepted reviewer deviation. P6 is **ACCEPTED / CLOSED** after PR #46 merge
and verified production promotion to `opera-agent-vm` version 27. 8E remains
paused/not started until separately instructed. No later Spec Kit scope is
authorized implicitly.

## Enterprise standards track (2026-09-30)

Planning-only session: approved phased approach A. Fase 1 spec at
`docs/superpowers/specs/2026-09-30-enterprise-standards-phase1-design.md`
on branch `chore/enterprise-standards-phase-1` (basis `a99978d`).
No runtime, test, or infrastructure changes yet.

## Enterprise UI & docs track (2026-10-02, Fase 5 closed branch-only)

Fase 5 (spec `docs/superpowers/specs/2026-10-02-enterprise-ui-docs-phase5-design.md`,
plan `docs/superpowers/plans/2026-10-02-enterprise-ui-docs-phase5.md`) executed
5/5 build tasks on `chore/enterprise-ui-docs-phase5` (basis `a97f9ff`), each with
a fresh implementer, a fresh reviewer, and a fix round where review returned
Needs fixes. Shipped: `extension/lib/endpoints.js` as the single endpoint source
per deploy unit (consent locked equal, update function derives from
`SUPABASE_URL`, manifest `update_url` the documented static exception);
`extension/lib/options-store.js` plus an options page for bridge URL and log
level with secrets never surfaced; `docs/api.md` as the narrative gateway
reference under a source-extracting drift pin; `docs/runbook.md` (incidents,
owner-adjustable proposed SLOs, honest retention table, accessibility appendix);
and a per-permission rationale in `extension/README.md`.

Head `1f91078`, final tip `41a2ae7`. `npm test` 631/631, `npm run check` ok
(26 primitives, 88 safety files, 1.6.13), pinned Deno 2.9.6 lint clean + 9/9
per-function checks, browser harness green, and all 9 check-runs plus combined
status `success` on that exact head. **Merged to `main` by owner decision** as
`eef35e5..41a2ae7` (17 commits, `--ff-only`, 0 merge commits); the merged `main`
was re-verified green at `41a2ae7`. Track branch archived as
`archive/chore/enterprise-ui-docs-phase5` and deleted from remote; a stale
`feat/pre-8e-usability-repair-r8` branch fully contained in `main` was archived
and deleted in the same pass. Documentation-only findings reported and
deliberately left unfixed: `activeTab` declared but unused, `tabs`
near-convenience, popup Unpair not revoking the server token, no writer for the
`offline` device status, and no scheduler or caller for the cleanup/expire RPCs.

## Enterprise security track (2026-10-02, Fase 4 closed branch-only)

Fase 4 (plan `docs/superpowers/plans/2026-10-02-enterprise-security-phase4.md`)
executed 7/7 tasks on `chore/enterprise-security-phase4` (basis `3546ac0`).
Code head `0a5bbf3`: shared fail-closed CORS resolver
(`supabase/functions/_shared/cors.js`) wired into gateway/mcp/update;
token-hygiene regression locks + `SECURITY.md` Token transport note;
mapped popup/consent user-facing errors (no raw internals); publishable
key env-first in the 2 ps1 scripts. Suite 615/615, `npm run check` ok
(26 primitives, 85 safety files, 1.6.13), Deno 2.9.6 lint + 9/9
function checks green, full CI green on the code head (9/9 check-runs +
combined status success). No merge to `main`, no PR - merge is an
explicit owner decision. Parked for later: `vm:636` + update log calls
outside the hygiene scope; consent SDK-bump fragility; `cors.js`
stale lint-rule comment (zero runtime effect).
