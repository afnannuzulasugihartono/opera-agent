# @last-edited: 2026-11-13 UTC+7.
# @title: Repo architecture - one product, two roads, one enforced map.
# @state: the design for the full restructure; two pull requests; nothing implemented yet.
# @dependencies: `docs/naming.md`, `docs/anti-drift.md`, `tests/helpers/boundary-locks.mjs`, `gates.lock`, `.github/CODEOWNERS`.

# WHAT THIS FIXES

Three complaints from the owner, in the owner's words, each answered by a rule this design adds:

1. "Semua file clutter di satu folder" - `local/`, `tests/`, `scripts/` are flat; nothing tells an agent (or the owner) where a file belongs.
2. "Grombol, lompat-lompat - misalnya transport, aku tidak tahu di mana tempatnya" - paths carry no meaning; three unrelated folders are all called `lib`.
3. "Mesin pembuat kode seperti .mjs dan unit tests, aku tidak pernah tahu" - the release/pack/verify engines and the gate suite are invisible in the tree; there is no index, only tribal knowledge in `docs/handoff.md`.

And one requirement, also the owner's: the architecture must be **native for agents** - agents "suka sembarang menulis file di folder manapun", so the rules about where things go must be enforced by a gate, not by a page of prose nobody fails for disobeying.

# THE PRODUCT, IN ONE LINE

Opera Agent is one product, delivered two ways, with one browser half in common:

```
  HOSTED ROAD (Supabase)                LOCAL ROAD (npm)
  MCP client (ChatGPT, OpenCode, ...)   MCP client (any stdio harness)
        |  HTTP / SSE                          |  stdio
        v                                       v
  hosted/functions/                      local/bin/opera-local.js
  opera-agent-mcp (42 tools)             local/mcp-server.js (42 tools)
  opera-agent-bridge (relay)             local/bridge(.js|-ws).js -> extension (bridge, active:false)
  + 8 more edge functions                     OR local/transport.js -> CDP /json/new (foreground)
        |                                       |
        v                                       v
  Postgres (opera_* via hosted/migrations/, 127 migrations)
  and extension/ - the browser half BOTH roads terminate in (MV3 worker, content, popup, protocol.js)

        shared/ - pure modules, no I/O, imported by both roads (edge directly; local via pack-generated copies)
        landing/ - the public site (Cloudflare Pages); netral, both roads
```

The invariant that makes it two roads and not two products: **the tool surface is the same 42 tools on both roads, and any module both roads need lives once in `shared/`, never copied by hand.**

# TARGET TREE

Root, after the restructure. Every entry is dispositioned; nothing is unaccounted for.

| Entry | What it is | Contract pinning its path | In this design |
|---|---|---|---|
| `ARCHITECTURE.md` | THE map: roads diagram, import matrix, where-everything-lives, file-creation rules | gated by `tests/architecture.test.mjs` | NEW |
| `extension/` | The browser half; MV3 CRX; wire truth lives in `extension/lib/protocol.js` | `publish-crx.yml`, `release.yml` (manifest), boundary pins | unchanged in shape |
| `local/` | The local road: npm package `opera-agent-mcp`, stdio server | `local/package.json` `files`, bin path, npm provenance | unchanged in shape; `local/lib/` becomes 100% generated |
| `hosted/` | The hosted road: the Supabase project | supabase CLI (`working-directory: hosted`), `deploy-functions.yml` | renamed from `supabase/` |
| `shared/` | Pure modules both roads import; no I/O | import matrix gate | renamed from `lib/` |
| `landing/` | The public site; one page per door | `deploy-site.yml`, `wrangler pages` | unchanged |
| `scripts/` | The machines: release, pack, verify, dev, bench, proof | package.json scripts, ci.yml, CODEOWNERS | grouped into 6 verb-folders |
| `tests/` | The gates: 201 `.test.mjs`, grouped by subject + `fixtures/`, `helpers/`, 3 py gates | `npm test` glob, boundary pins, CODEOWNERS (`tests/` wildcard) | grouped into 12 subjects |
| `docs/` | Documentation; `proof/` and `store/` fold in; `agent-map.md` deleted | CODEOWNERS? no; handoff + AGENTS reference | two moves, one deletion, one index |
| `.github/` | CI workflows + CODEOWNERS | `gates.lock` (`ci.yml`) | 3 files edited (paths) |
| root files | unchanged; dispositioned in Appendix D | `gates.lock` (some) | listed, untouched |

Root after the change, zero unexplained entries:

```
AGENTS.md  ARCHITECTURE.md  CHANGELOG.md  CONTRIBUTING.md  LICENSE  README.md  SECURITY.md  opencode.json
.editorconfig  .env.example  .gitattributes  .gitignore  .gitleaks.toml  .sonarcloud.properties  gates.lock
extension/  local/  hosted/  shared/  landing/  scripts/  tests/  docs/  .github/
```

## `extension/` - unchanged

No file moves. The complete tree is listed here so nothing is missed by implication:

```
extension/background.js      extension/content.js        extension/hover-settle.js
extension/manifest.json      extension/options.html      extension/options.js
extension/popup.html         extension/popup.js         extension/role-reconcile.js
extension/semantic-identity.js  extension/semantic-views.js  extension/styles.css
extension/update.html
extension/content/           extension/icons/          extension/lib/   extension/worker/
```

`extension/lib/` (28 files, the wire protocol and the browser-side core) is the contract both roads read: `protocol.js` (METHOD_SPECS, single source), `socket-protocol.js` + `endpoints.js` (consumed by `local/` via pack copies), everything else extension-private. No `shared/` imports allowed; the CRX must never reach outside `extension/`.

## `local/` - unchanged in shape; `local/lib/` cleaned

No source file moves (the npm artifact's paths stay stable). Two changes:

1. `local/lib/` becomes 100% generated. `socket-protocol.js` and `endpoints.js` lose their tracked copies (they are pack-generated from `extension/lib/`); `.gitignore` carries ONE line: `local/lib/`. No per-file ignore entries, no exception comment.
2. `local/README.md` gains a **role map**: every file named once, grouped into 6 roles (install / surface / driver / transport / office / dev). Table in Appendix B. The flat wall of ~60 files becomes one readable page.

Full file inventory, by role, is Appendix B. Entry contract (`bin/opera-local.js` via `local/package.json` `bin`) is untouched.

## `hosted/` - renamed from `supabase/`

```
hosted/config.toml                 (was supabase/config.toml; supabase CLI runs with hosted as cwd)
hosted/migrations/                 (127 files, unchanged contents; path only)
hosted/functions/
  opera-agent-auth                  opera-agent-billing            opera-agent-bridge
  opera-agent-gateway               opera-agent-listen             opera-agent-mcp
  opera-agent-runner                opera-agent-update             opera-agent-vm
  _shared/                          (20 files: adhoc-compile.js, billing.js, bing-serp.js -> MOVED to shared/ in PR #1,
                                     command-result.js, command-stream.ts, cors.js, cut-stream.ts, docs-ui-map.js,
                                     edge-log.js, goal-ledger.js, invoice-page.js, plans.js, proof-engine.js,
                                     qris-detector.js, qris.js, seal-vm-program.js, vm-token.js,
                                     wallet-api.js, wallet.js)
hosted/README.md                   (NEW: the hosted road in one page - dataflow, deploy commands, live checks)
```

`_shared/` rule, stated in both `ARCHITECTURE.md` and `hosted/README.md`: **edge-runtime modules only.** Anything both roads need lives in `shared/` (the parser and the normalizer do); keeping those here would drift, and drift is what put SonarCloud red twice.

## `shared/` - renamed from `lib/`, two files added

`lib/` is renamed `shared/` (three `lib/`s was one confusion too many: `shared/`, `extension/lib/`, `local/lib/`). The 11 existing modules move by `git mv` and import paths rewrite:

| `lib/` today | `shared/` after | imported by |
|---|---|---|
| `ax-menu.js` | `shared/ax-menu.js` | tests (`tests/shared/ax-menu.test.mjs`) |
| `canonical-order.js` | `shared/canonical-order.js` | `shared/delta-first-observation.js`, `shared/semantic-working-state.js`, `hosted/functions/_shared/proof-engine.js`, `_shared/goal-ledger.js` |
| `delta-first-observation.js` | `shared/delta-first-observation.js` | tests/shared |
| `multi-signal-relevance.js` | `shared/multi-signal-relevance.js` | (consumers read it; see boundary pin) |
| `reactive-vm.js` | `shared/reactive-vm.js` | `hosted/functions/opera-agent-vm/index.ts` |
| `reactive-vm-collect.js` | `shared/reactive-vm-collect.js` | `opera-agent-vm/index.ts`, `shared/reactive-vm-host.js` |
| `reactive-vm-control-flow.js` | `shared/reactive-vm-control-flow.js` | `opera-agent-vm/index.ts` |
| `reactive-vm-host.js` | `shared/reactive-vm-host.js` | tests/shared |
| `secret-pattern.js` | `shared/secret-pattern.js` | `shared/reactive-vm*.js`, `hosted/functions/_shared/{goal-ledger,proof-engine}.js` |
| `semantic-working-state.js` | `shared/semantic-working-state.js` | tests/shared |

And two modules arrive (these are the "one source, two roads" pair, moved in PR #1):

| module | was | why shared |
|---|---|---|
| `shared/bing-serp.js` | `supabase/functions/_shared/bing-serp.js` | the one SERP parser; hosted imports directly, local carries a pack copy; byte-pinned by `tests/search/bing-serp.test.mjs` |
| `shared/tidy.js` | `supabase/functions/opera-agent-mcp/tidy.ts` | the one answer normalizer; TypeScript stripped for good - it ships as the JS it always effectively was |

`shared/README.md` (NEW): one line per module - what it is, who imports it, why it lives here. One source per module, stated once, for the reader and the gate.

## `landing/` - unchanged

All ~40 pages, `_headers`, `site.css`, `features.css`, `*.js` pages scripts, `unduh.html`, `dashboard/` (console), stay exactly where they are. The Sonar duplication exclusion stays as is (`.sonarcloud.properties` unchanged). Only references in docs change if they mention moved paths.

## `scripts/` - grouped by verb

23 files into 6 groups. Nothing is renamed; only their directories move.

```
scripts/release/  bump-version.mjs  bump-version-lib.mjs  apply-migrations.mjs  build-store-package.py
scripts/pack/     pack-mcp.mjs                                        (byte-copy only; the strip-types path is deleted in PR #1)
scripts/verify/   check.mjs  gates.mjs  scope-check.mjs  scope.mjs  semantic-baseline.mjs  hosted-mcp-check.mjs
scripts/dev/      agent-worktree.mjs  format-comments.mjs  extension-run.mjs  landingserve.mjs
                  start-bridge.mjs  draw-icon.py  mcp-connection-diagnostics.mjs
scripts/bench/    latency-benchmark.mjs  goal-ledger-benchmark.mjs  proof-engine-benchmark.mjs
scripts/proof/    proof-run.mjs  sample-artifacts.mjs
```

Reference updates: `package.json` + `local/package.json` script paths, `.github/CODEOWNERS` (`/scripts/gates.mjs` -> `/scripts/verify/gates.mjs`), `release-bump.yml` (`node scripts/release/bump-version.mjs`), workflow comments, docs that name these paths. `npm test`, `npm run check`, `gates:refresh`, `scope`, `benchmark:latency`, `bridge` - same names, new paths.

## `tests/` - grouped by subject (201 files, every one accounted for)

The glob changes from `tests/*.test.mjs` to `tests/**/*.test.mjs`. `tests/fixtures/` and `tests/helpers/` stay at `tests/` root (not subject-bound). The three Python harnesses (`browser_extension_test.py`, `paper_e2e.py`, `real_site_smoke.py`) stay at `tests/` root because `AGENTS.md`, `docs/handoff.md`, and `ci.yml` call them by those paths - renaming them breaks callers for zero benefit. `tests/helpers/boundary-locks.mjs` stays put.

| Group | Files | What it gates |
|---|---|---|
| `tests/local/` | 37 | the local road: MCP server, CDP driver, bridge, install |
| `tests/landing/` | 17 | the site pages and claims |
| `tests/docs/` | 15 | docs/prose gates: readme, comments, api, agent-guide |
| `tests/hosted/` | 24 | the hosted road: edge functions, relay, device, plans |
| `tests/vm/` | 21 | the VM/workflow engine: program intake, seal, streams, DSLs |
| `tests/extension/` | 40 | the browser half + the wire boundary (protocol, bridge sockets) |
| `tests/shared/` | 6 | the shared core (ax-menu, delta-first, semantic-state, mcp-output-*, reactive-vm-host) |
| `tests/billing/` | 14 | money: qris, wallet, invoice, plans, gateway |
| `tests/release/` | 11 | the npm artifact and the release machinery |
| `tests/tooling/` | 12 | the repo watching itself: gates, hygiene, standard, task-bar |
| `tests/surface/` | 3 | the surface-drive ladder (local driver vs fake CDP) |
| `tests/search/` | 1 | the Bing SERP parser (pinned to the fixture) |
| `tests/fixtures/` | unchanged | `bing-serp-page1.json` (redacted: `sid=`, `FPIG=` removed in PR #1) and friends |
| `tests/helpers/` | unchanged | fakes and the boundary pins |

**Every file is listed explicitly in Appendix A.** Moving a test one level deep means every relative import gains one `../` segment (`../lib/x.js` -> `../../shared/x.js`, `../supabase/...` -> `../../hosted/...`, `../extension/...` -> `../../extension/...`, `new URL('./fixtures/...')` -> `'../fixtures/...'`). This is mechanical, and it is the riskiest stage; it is verified by the full suite, which must still report 201 tests.

## `docs/` - two folds in, one deletion, one index

- `proof/` -> `docs/proof/` (evidence: `run.jsonl`, `run.md`, `extension-run.*`, screenshots). `.gitignore` keeps `proof/out/` / `proof/downloads/` ignore entries, re-pathed. `docs/agent-call.md` and `docs/superpowers/plans/2026-11-06-agent-call-path.md` (historical; historical plans keep saying `proof/` - they record what was true then) get path updates only in the living doc.
- `store/` -> `docs/store/` (`store-manifest.json`, `icon128.png`, `extension-registry-install.reg`, `extension-registry-uninstall.reg`). `README.md`, `docs/install.md`, `docs/registry-install.md`, `docs/state-machines.json` prose updated; `.gitignore` store zip entry re-pathed; `scripts/release/build-store-package.py` path references updated.
- `paper-all-menus.json` -> `docs/jobs/paper-all-menus.json` (all jobs aside, nothing is lost).
- `docs/agent-map.md` -> DELETED. Its role is absorbed by `ARCHITECTURE.md`; two maps that must be kept in sync is one map too many. References in `README.md`, `AGENTS.md`? (AGENTS.md references agent-worktree, not agent-map - verified), `docs/handoff.md` updated to point at `ARCHITECTURE.md`.
- `docs/README.md` NEW: one line per doc in `docs/` root, so the folder is also a map; plus the index of `docs/jobs/`, `docs/product/`, `docs/releases/`, `docs/research/`, `docs/superpowers/` (unchanged).
- Everything else in `docs/` stays. `docs/releases/`, `docs/superpowers/` (historical), `docs/naming.md`, `docs/anti-drift.md`, `docs/security.md` - untouched.

# CONTENT OF `ARCHITECTURE.md` (the new root file)

The file is a condensed rendering of this spec: it carries the same diagram as `# THE PRODUCT, IN ONE LINE` in this document, the same root table as the root dispositions table, and the same import matrix below. It is deliberately short (~80 lines). Its sections:

1. **The two roads** - the diagram from `# THE PRODUCT, IN ONE LINE`, plus: 42 tools on both roads; shared core in `shared/`; edge-runtime-only in `hosted/functions/_shared/`.
2. **Where everything lives** - the root table, one line per entry, nothing more.
3. **What may import what (enforced)** - the import matrix, copied from the `tests/architecture.test.mjs` rules; the reader learns it from the gate, not from prose.
4. **Where a new file goes** - the six rules, verbatim:
   1. Needed by both roads, no I/O          -> shared/  (+ one line in shared/README.md)
   2. Edge-runtime only                      -> hosted/functions/_shared/
   3. A new wire method                      -> extension/lib/protocol.js and nowhere else
   4. A new test                             -> the subject folder matching its area; never tests/ root
   5. A new script                           -> the verb group it belongs to; npm run gets a script entry
   6. Anything new at repository root        -> refused. ARCHITECTURE.md + this gate fail the build.
5. **The loads this map cannot carry** - one paragraph: how the restructure preserves history (`git mv`), one `gates.lock` re-pin at the end, and the permanent rule-fix-the-map-never-the-test.

Every backtick path in the file must resolve (check 2 below), so the file cannot drift from the tree without a red build.

`tests/architecture.test.mjs` (NEW, ~150 lines) enforces, and it is itself pinned in `gates.lock` once green:

1. Every root entry listed in `ARCHITECTURE.md` exists on disk.
2. Every backtick path in `ARCHITECTURE.md` resolves (file or directory).
3. No top-level file or directory exists that `ARCHITECTURE.md` does not name.
4. Import matrix, by prefix, over `extension/`, `local/`, `hosted/`, `shared/`, `scripts/`, `tests/`: allowed/forbidden specifiers (see table below).
5. `local/` never imports outside itself, except `./lib/*` (generated). `extension/` never imports `../` outside `extension/`. `shared/` imports only `shared/` or builtins. `hosted/` imports only `hosted/`, `../../../shared/*`, or builtins.
6. `tests/` carries no `.test.mjs` at root other than the three whitelisted py files' counterparts (there are none), and `scripts/` only the six known groups.

## The import matrix

| Folder | May import | May not import |
|---|---|---|
| `extension/` | `extension/...`, builtins | `../shared`, `../hosted`, `../local`, `../lib` |
| `local/` | `local/...`, `./lib/*` | any `../` reaching outside `local/` |
| `hosted/functions/**` | `hosted/...`, `../../../shared/*`, `_shared` siblings, builtins | `../local`, `../extension` |
| `shared/` | `shared/...`, builtins | anything else |
| `tests/`, `scripts/` | anything | - |

## The protocol truth

`extension/lib/protocol.js` remains the one wire contract. `METHOD_SPECS` lives there and nowhere else; `tests/extension/protocol.test.mjs` and `tests/hosted/relay-method-contract.test.mjs` pin it. This design does not touch it.

# AGENTS.md - THE SECTION ADDED (verbatim draft, owner-visible)

Inserted before "## Goals":

> ## The product in one line, and the map
> Opera Agent is one product with two delivery roads and one browser half: the hosted road (MCP client ⇄ HTTP/SSE ⇄ `hosted/functions/` ⇄ Postgres ⇄ relay ⇄ `extension/`) and the local road (MCP client ⇄ stdio ⇄ `local/` ⇄ CDP, or `local/` ⇄ bridge ⇄ `extension/`). Shared pure modules live in `shared/` - and only there as source: `extension/` and `local/` carry pack-generated copies, never hand-written ones. `ARCHITECTURE.md` at the root is the map: it names where everything lives and what may import what, and `tests/architecture.test.mjs` fails the build when the map and the tree disagree - so read the map first, and fix the map, never the test. Where a new file goes is decided there; if you are about to create a file at a path the map does not bless, stop and ask why.

And one line appended to "## Always":

> - Where a file lives is decided by `ARCHITECTURE.md`; create nothing at a path the map does not bless.

Everything else in AGENTS.md stays as it is. The owner reviews this diff in the spec; nothing is edited before approval.

# WHAT THIS DESIGN DELIBERATELY DOES NOT CHANGE

- No behavior change anywhere. Every move is `git mv` (blob unchanged) or a path-string rewrite. Tests remain byte-identical except import lines that must deepen one segment.
- No protocol change; no tool surface change; `SERVER_VERSION`, tool names and shapes untouched.
- No deploy contract moves, except `supabase/` -> `hosted/`, which is a rename only. The supabase CLI is invoked with `working-directory: hosted` in `deploy-functions.yml`; `release-bump.yml`, `release.yml`, `deploy-site.yml`, `publish-npm.yml`, `ci.yml` need path updates only where they reference the renamed paths or moved scripts.
- `tests/browser_extension_test.py`, `tests/paper_e2e.py`, `tests/real_site_smoke.py` keep their paths.
- Historical docs (`docs/releases/`, `docs/superpowers/`) are not rewritten to the new paths; they record what was true when written.
- The four pinned acceptance files that gain a path change (`boundary-locks.mjs` pins `index.ts` and the shared modules) are re-pinned once at the end, with the reasons written in the commit that re-pins them.

# EXECUTION PLAN - TWO PULL REQUESTS

**PR #1 (#289, now) - the two roads, made one.** Already approved for branch `agent/search-bing/search-bing`:

1. `lib/` -> `shared/` (10 modules, `git mv`); every import rewritten (`../../../lib/` -> `../../../shared/` in edge functions, `../lib/` -> `../shared/` in tests, `check.mjs` secret-pattern exception re-pathed).
2. The one-source-two-roads consolidation: `tidy.ts` -> `shared/tidy.js` (plain JS); `scripts/pack-mcp.mjs` (`scripts/pack/`) becomes byte-copy only; `local/lib/socket-protocol.js` and `local/lib/endpoints.js` untracked; `.gitignore` becomes the one rule `local/lib/`; `local/lib/` regenerated and verified in the tests.
3. Parser fixes from review (all in `shared/bing-serp.js`): unwrap Bing `/ck/a` redirect wrappers with re-validation; `DISPLAYISH` narrowed so titles containing URLs survive; duplicate-title snippet boundary fixed with a multiset. The fixture loses its session identifiers (`sid=`, `FPIG=`).
4. Hosted fixes (`hosted/functions/opera-agent-mcp/index.ts` after PR #2; `supabase/...` on PR #1's branch): missing `result.dump` -> `SEARCH_DUMP_MALFORMED`; Bing consent/429 markers with no external cards -> `SEARCH_REFUSED`; `tabs.close` failure surfaced in the answer.
5. Local fixes (`local/mcp-server.js`): `fallback.open` inside the try; `withDeadline` timer cleared; close failure surfaced. `tabId` dropped from the local answer for contract parity (spec example updated). Descriptions corrected (background tab only when bridged; CDP foreground; untrusted-fields line).
6. `SERP_EXPRESSION` in `local/page-expressions.js`: `anchor.href` (absolutized), and the text cap + `textTruncated`, matching `page.dump`.
7. CI green, reviewer dispositioned, merge.

**PR #2 - the restructure.** Branched from `main` after #289 merges. Staged commits, every stage green before the next:

| Stage | What happens | Gate |
|---|---|---|
| S4 | `proof/` -> `docs/proof/`, `store/` -> `docs/store/`, paths in living docs, `.gitignore`, `build-store-package.py`, `CODEOWNERS` | npm test, npm run check |
| S5 | `scripts/` grouped into `{release,pack,verify,dev,bench,proof}/`; `package.json` and `local/package.json` paths; `release-bump.yml`, `ci.yml` (if it names scripts) | npm run check, npm run gates:refresh dry-run |
| S6 | `tests/` grouped by Appendix A; `npm test` glob `tests/**/*.test.mjs`; every moved test's relative imports deepened one segment; count read back: 201 | npm test (must equal 201), npm run check |
| S7 | `supabase/` -> `hosted/`; `hosted/README.md`; `deploy-functions.yml` (`working-directory: hosted`, path greps); living docs path sweep (~33 files; historical specs untouched); `CODEOWNERS` (`/hosted/migrations/`, `/shared/`, `/scripts/verify/gates.mjs`) | npm test, npm run check |
| S8 | `ARCHITECTURE.md` + `tests/architecture.test.mjs` + `shared/README.md` + `docs/README.md` + delete `docs/agent-map.md` + `AGENTS.md` section + `README.md` tree + `docs/handoff.md` bullet (this bullet lands after merge) + `docs/state-machines.json` prose (`tidy.ts` -> `shared/tidy.js`) | the new gate passes; whole suite green; one `gates:refresh` with reasons in the commit |
| S9 | Full CI (unit, browser, secret-scan, SonarCloud) on the PR; merge | CI matrix all green |
| S10 | Release 1.6.51 as usual: release-bump -> prose -> merge -> publish-crx -> tag -> release.yml -> deploy-functions -> publish-npm -> deploy-site -> live `search_bing` call -> handoff bullet | the live call answers 42 tools and a real Bing SERP |

# RISKS AND MITIGATIONS

- **S6 depth rewrite is where a subtle break hides.** Mitigations: the rewrite is one sed-like pattern per prefix; the suite reads the paths twice (imports + the py harness); 201 tests must pass; `npm pack --dry-run` smoke for the local package; tarball load check (the #289 proof) re-run.
- **S7 CLI workdir.** If `working-directory: hosted` is wrong, the deploy fails loudly at dispatch (grep of SERVER_VERSION happens before deploy and would print the right paths). The health curl after deploy is the proof.
- **gates.lock churn.** Several historically pinned files gain new paths (`boundary-locks.mjs` pins `index.ts`, `check.mjs` gains the shared re-path). One re-pin commit at S8 with the reason written, per the anti-drift rule - never silent.
- **SonarCloud re-analysis.** Expected clean (pure moves; no new duplication; the CPD exclusion covers landing only). The PR shows the before/after metric; a regression blocks merge, not a re-roll.
- **Fixture redaction may ripple** into parser test expectations. The fixture is data only; the assertions read parsed output. If FPIG/sid removal changes a snapshot assertion, the assertion is regenerated against the redacted fixture, with the change noted in the commit.
- **Owner visibility.** `AGENTS.md`, `README.md`, `docs/handoff.md` all change wording in S8; the owner sees the exact diffs in the PR description before merging.

# DECISION LOG (owner rulings so far, verbatim intent)

- Classified architectural by the agent; the owner chose the heavier path (bedah total) when offered.
- "local hosted gak ada" -> v2 folders added: `hosted/` exists as a first-class road folder; "two roads" is now structure, not prose.
- "Native bagi agent; agents tulis file di mana pun" -> v2 rules that bite: ARCHITECTURE.md + `tests/architecture.test.mjs` + the 6 file-creation rules + the import matrix; not a documentation-only answer.
- "Buat dalam bentuk folder full, tidak boleh miss satu file dan satu folder pun, plan arsitektur dulu wajib" -> this document; appendices A-D enumerate every file; the py harnesses are named, not waved at; the gate invents no directories.
- `local/` stays flat (npm artifact stability) with a README role map (Appendix B); `agent-map.md` deleted; PR split kept: #289 ships the two-roads consolidation, #2 ships the restructure.
- Implementation starts with PR #1: two-roads consolidation + parser fixes, then this plan as PR #2.

# EXPLICIT QUESTIONS STILL OPEN (for the owner, answerable at spec review)

1. The `ARCHITECTURE.md` root page is the single map; `README.md` keeps only the four contract numbers and a two-line "read ARCHITECTURE.md" - or do you want the README to inline a compact tree (keeping both short and letting the test gate both)?
2. `docs/state-machines.json` prose says "tidy.ts". It is updated in S8 with the path change only; if the register itself should gain an entry for the new "two roads" invariant (a new implicit state machine), say so at review.
3. `local/` role map in Appendix B is proposed wording; correct the roles you disagree with before it is written into `local/README.md`.

# APPENDIX A - tests/, every file, by group (201)

## tests/local/ (37)
action-strategy.test.mjs, advice.test.mjs, caret-guard.test.mjs, dialog.test.mjs, document-job.test.mjs, geometry.test.mjs, local-bridge-plan.test.mjs, local-bridge.test.mjs, local-browsers.test.mjs, local-burst.test.mjs, local-canvas.test.mjs, local-cdp.test.mjs, local-cloud.test.mjs, local-dev-shim.test.mjs, local-file.test.mjs, local-gates.test.mjs, local-input.test.mjs, local-leases.test.mjs, local-mcp-server.test.mjs, local-multi-device.test.mjs, local-observe.test.mjs, local-package.test.mjs, local-pointer.test.mjs, local-primitives.test.mjs, local-sessions.test.mjs, local-statements.test.mjs, local-surfaces.test.mjs, local-transport-target.test.mjs, local-transport.test.mjs, local-waits.test.mjs, local-wallet-tools.test.mjs, menu-tree.test.mjs, office-mockup.test.mjs, open-menu.test.mjs, read-strategy.test.mjs, report-job.test.mjs, window-focus.test.mjs

## tests/landing/ (17)
landing-auth.test.mjs, landing-claims.test.mjs, landing-company.test.mjs, landing-consent.test.mjs, landing-dashboard.test.mjs, landing-docs.test.mjs, landing-download.test.mjs, landing-execution.test.mjs, landing-hosting.test.mjs, landing-i18n.test.mjs, landing-not-found.test.mjs, landing-page.test.mjs, landing-profile.test.mjs, landing-sample.test.mjs, landing-unduh-hub.test.mjs, landing-visual.test.mjs, site-standard.test.mjs

## tests/docs/ (15)
agent-call-docs.test.mjs, agent-guide.test.mjs, agent-log-errors.test.mjs, api-docs.test.mjs, comment-claims.test.mjs, comment-format.test.mjs, comment-placement.test.mjs, docs-chrome.test.mjs, docs-menu-walk-v2.test.mjs, docs-menu-walk.test.mjs, docs-read-workflows.test.mjs, docs-structure.test.mjs, docs-ui-map.test.mjs, docs-workflows.test.mjs, readme.test.mjs

## tests/hosted/ (24)
chatgpt-plugin.test.mjs, claim-clock.test.mjs, device-instance.test.mjs, device-revoke-state.test.mjs, device-socket-client.test.mjs, device-socket-protocol.test.mjs, edge-cors.test.mjs, edge-syntax.test.mjs, edge-token-hygiene.test.mjs, gateway-transactions.test.mjs, hosted-device-resolution.test.mjs, hosted-mcp.test.mjs, hosted-plan-gate.test.mjs, konsol-tables.test.mjs, listen-transcribe.test.mjs, mcp-stream-cut.test.mjs, mcp-surface.test.mjs, migration-ledger-map.test.mjs, relay-method-contract.test.mjs, session-usage.test.mjs, skills-rpc.test.mjs, skills-workflows.test.mjs, statement-device.test.mjs, statement-proof.test.mjs

## tests/vm/ (21)
adhoc-compile.test.mjs, browse-workflows.test.mjs, burst-ref-integrity.test.mjs, command-event-stream.test.mjs, command-stream-plumbing.test.mjs, command-stream-pump.test.mjs, ephemeral-workflows.test.mjs, goal-plan-request.test.mjs, goal-plan.test.mjs, maps-workflows.test.mjs, recon-workflows.test.mjs, runner-command-result.test.mjs, semantic-engine.test.mjs, usability-media-sampling.test.mjs, usability-transcript.test.mjs, vm-program-intake.test.mjs, vm-program-rpc.test.mjs, vm-program-seal.test.mjs, vm-program-status.test.mjs, workflow-dsl.test.mjs, youtube-workflows.test.mjs

## tests/extension/ (40)
action-pipeline.test.mjs, attach-heal-on-send.test.mjs, background-load.test.mjs, bridge-body-cap.test.mjs, bridge-frames.test.mjs, bridge-link.test.mjs, bridge-plan-gate.test.mjs, bridge-socket.test.mjs, bridge-ws.test.mjs, browser-identity.test.mjs, burst-atomic-actions.test.mjs, burst-tab-switching.test.mjs, debugger-session-lifecycle.test.mjs, efficiency.test.mjs, endpoint-source.test.mjs, etw-watch-engine.test.mjs, extension-onboarding.test.mjs, extension-run.test.mjs, extension-source.test.mjs, focus-and-keyboard.test.mjs, hover-settle.test.mjs, key-text-events.test.mjs, keyboard-vocabulary-parity.test.mjs, model-client.test.mjs, options-store.test.mjs, page-map.test.mjs, pair-identity.test.mjs, popup-update-hint.test.mjs, protocol.test.mjs, ref-reacquire.test.mjs, role-reconcile.test.mjs, serialize-budget.test.mjs, socket-drain-safety.test.mjs, socket-execute-bound.test.mjs, timeout-retry-popup-parity.test.mjs, ui-surface.test.mjs, window-restore.test.mjs, worker-error-capture.test.mjs, ws-server.test.mjs, ax-observation.test.mjs

## tests/shared/ (6)
ax-menu.test.mjs, delta-first-observation.test.mjs, mcp-output-kr.test.mjs, mcp-output-tidy.test.mjs, reactive-vm-host.test.mjs, semantic-working-state.test.mjs

## tests/billing/ (14)
billing.test.mjs, invoice-page.test.mjs, invoice-worker.test.mjs, plans.test.mjs, qris-billing-guard.test.mjs, qris-cron-schema.test.mjs, qris-detector.test.mjs, qris-wiring.test.mjs, qris.test.mjs, wallet-api.test.mjs, wallet-client.test.mjs, wallet-quote.test.mjs, wallet-schema.test.mjs, wallet-wiring.test.mjs

## tests/release/ (11)
bump-version.test.mjs, detect-browsers.test.mjs, install-orch.test.mjs, install.test.mjs, manifest-pins.test.mjs, mcp-package.test.mjs, postinstall.test.mjs, registry.test.mjs, release-workflow.test.mjs, self-update.test.mjs, uninstall.test.mjs

## tests/tooling/ (12)
boundary-locks.test.mjs, clean-code.test.mjs, code-standard.test.mjs, hygiene.test.mjs, implicit-state-machines.test.mjs, no-site-code.test.mjs, professional.test.mjs, proof-run.test.mjs, scope-check.test.mjs, structure-gates.test.mjs, task-bar.test.mjs, tidy-output.test.mjs

## tests/surface/ (3)
surface-drive-browser.test.mjs, surface-drive.test.mjs, surface-profile.test.mjs

## tests/search/ (1)
bing-serp.test.mjs

Unchanged at `tests/` root: `browser_extension_test.py`, `paper_e2e.py`, `real_site_smoke.py`, `fixtures/`, `helpers/`.

37 + 17 + 15 + 24 + 21 + 40 + 6 + 14 + 11 + 12 + 3 + 1 = 201.

# APPENDIX B - local/, every file, by role (60 files, for `local/README.md`)

**bin/** (2) - `bin/opera-local.js` (the driver entry: bridge-first, CDP fallback), `bin/opera-agent-mcp.js` (the npm bin: CLI surface, doctor)

**surface/** (5) - what the model reads: `mcp-server.js` (dispatch, tool call/response), `tools.js` (the 42 tools, descriptions, schemas), `agent-guide.js` (per-tool usage notes), `advice.js` (failure -> what to do), `gates.js` (the plan gate)

**driver/** (24) - what a verb does: `primitives.js`, `primitives-file.js`, `input.js`, `pointer.js`, `observe.js`, `waits.js`, `canvas.js`, `menu-tree.js`, `window-focus.js`, `focus-guard.js`, `caret-guard.js`, `dialog.js`, `page-expressions.js`, `surface-profile.js`, `action-strategy.js`, `read-strategy.js`, `burst.js`, `captcha-solver.js`, `cdp.js`, `driver.js`, `decks.js`, `spreadsheets.js`, `documents.js`, `statements.js`, `reports.js`

**office/** (6) - the office job engine: `office/docx.js`, `office/palette.js`, `office/pptx.js`, `office/xlsx.js`, `office/xml.js`, `office/zip.js`

**transport/** (8) - how local reaches the browser: `bridge.js` (bridge lifecycle + claim table), `bridge-ws.js` (the WS client on the bridge path), `transport.js` (CDP `/json/new`, `/json/list`, websockets), `ws-server.js` (the local WS endpoint), `cloud.js` (the hosted bridge companion), `leases.js`, `sessions.js`, `wallet-client.js`

**install/** (7) - npm install/uninstall and doctor: `install.js`, `postinstall.js`, `doctor.js`, `registry.js`, `browsers.js`, `oauth.js`, `bin/opera-chrome.cmd`

**build/** (2) - development entry only: `dev-shim.js`, `bin/opera-local-dev.js`

**root** (2) - `package.json`, `README.md` (rewritten to carry this map)

**generated** (4) - `lib/socket-protocol.js`, `lib/endpoints.js`, `lib/tidy.js`, `lib/bing-serp.js` - written by `scripts/pack/pack-mcp.mjs` at pretest/prepack, never committed, `.gitignore` = one rule

Count check: 2 + 5 + 24 + 6 + 8 + 7 + 2 + 2 + 4 = 60. Every path in the tree above is accounted for; none is missing.

# APPENDIX C - scripts/, every file, by group (23)

```
scripts/release/   bump-version.mjs  bump-version-lib.mjs  apply-migrations.mjs  build-store-package.py
scripts/pack/      pack-mcp.mjs
scripts/verify/    check.mjs  gates.mjs  scope-check.mjs  scope.mjs  semantic-baseline.mjs  hosted-mcp-check.mjs
scripts/dev/       agent-worktree.mjs  format-comments.mjs  extension-run.mjs  landingserve.mjs
                   start-bridge.mjs  draw-icon.py  mcp-connection-diagnostics.mjs
scripts/bench/     latency-benchmark.mjs  goal-ledger-benchmark.mjs  proof-engine-benchmark.mjs
scripts/proof/     proof-run.mjs  sample-artifacts.mjs
```

# APPENDIX D - root files, dispositions (all 16)

`.editorconfig` keep · `.env.example` keep · `.gitattributes` keep · `.gitignore` edit (one rule for `local/lib/`; re-pathed `proof/` and `store/` entries) · `.gitleaks.toml` keep · `.sonarcloud.properties` keep · `AGENTS.md` edit (one section + one line, see verbatim draft) · `CHANGELOG.md` keep · `CONTRIBUTING.md` keep · `gates.lock` re-pin once at S8 · `LICENSE` keep · `opencode.json` keep · `package.json` + `package-lock.json` path updates in scripts · `README.md` edit (tree diagram, "read ARCHITECTURE.md", store/ links) · `SECURITY.md` keep
