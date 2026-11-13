# @last-edited: 2026-11-13 UTC+7.
# @title: TypeScript as the core language - the real thing, not JSDoc comments over .js.
# @state: the design for converting shared/, local/ and extension/ to .ts with a real compile step; nothing implemented yet.
# @dependencies: `ARCHITECTURE.md`, `tests/tooling/architecture.test.mjs`, `scripts/pack/pack-mcp.mjs`, `.github/workflows/publish-crx.yml`, `local/package.json`.

# WHY THIS EXISTS

The owner's words, twice: "selalu ada yang drift" and "pake cara yang benar aja, tidak pakai jalan pintas".

The first restructure (PR #291) removed one class of drift — two hand-written copies of one module — and built the map that fails when the tree and the map disagree. What it did not remove is the class the owner feels daily: **the code is unchecked**. A path typed wrong, an envelope field renamed on one side, a function called with the wrong shape: all of it is discovered at runtime by a user, not by a compiler. The repository's own answer so far has been pins and gates, which catch drift *after* it is written. A type checker catches it *before it runs*.

This is the "correct way" the owner asked for: files are `.ts`, the types are real, and the compiler is the gate. No JSDoc-over-`.js` shortcut.

# THE PROBLEM, NAMED (so the fix matches it)

| Drift class | Example seen in this repo | Caught today by | Caught by TypeScript? |
|---|---|---|---|
| Shape drift inside one road | a tool reads `result.dump.text` when the dump has no `dump` | nothing until a live call | **yes** — the field does not exist on the type |
| Path drift across files | 15 broken `../` imports after `scripts/` moved one level deeper | the suite, after a full run | **yes** — an unresolved import is a compile error |
| Contract drift between roads | `search_bing`'s description differs between `local/tools.js` and `hosted/.../tools.ts` | nothing (only names and counts are pinned) | **no** — this is a duplication problem; it is PR #3's job (one schema source → types on both roads) |
| Duplicate implementation | `search_bing` implemented twice, once per road | architecture + parity tests (#289, #291) | **no** — a language cannot forbid a second copy |

So TypeScript is the right tool for classes 1 and 2, it is not the tool for 3, and it is not the tool for 4. This spec does 1 and 2; PR #3 does 3; #289/#291 did 4.

# THE TARGET STATE

One source per file, compiled to the artifact each runtime needs. Emitted files are never committed — the same rule the repository already applies to `local/lib/`.

| Folder | Source | Compiled to `.js` when | Consumed by |
|---|---|---|---|
| `shared/` (14 files) | `.ts` | at `pretest`/`prepack` for local, and before packing the CRX for the extension | Deno reads the `.ts` directly; Node and the browser read the emitted `.js` |
| `local/` (54 source files) | `.ts` | at `prepack` (the npm package ships `.js` only) | Node (the local MCP CLI) |
| `extension/` (58 files) | `.ts` | in `publish-crx.yml` before the CRX is packed | the browser (MV3 loads `.js` only) |
| `hosted/functions/` (16 files) | `.ts` | never — Deno runs TypeScript | the edge runtime, checked by `deno check` |
| `tests/` (202 `.test.mjs`) | `.mjs` | never | Node — they test the built artifact, which is what the repository already prefers |
| `scripts/` (21 `.mjs`) | `.mjs` | never | Node |

Why the browser is the hard part: MV3 loads plain files named in `manifest.json`; it cannot read `.ts`. So `extension/` gains one build step before packing — and that step is the price of "the correct way", paid once, guarded by a gate.

# WHAT `@types/chrome` ADDS (the extension's API surface becomes typed)

The extension calls the browser API in **189 places across 29 files**: `chrome.debugger` (attach, detach, sendCommand, onEvent), `tabs`, `scripting`, `storage`, `downloads`, `windows`, `alarms`, `runtime`. Today none of that is checked, and this is where a whole class of real bugs lives:

- a tab id passed as a string where the API wants a number (or the reverse),
- `chrome.debugger.sendCommand` resolved without its `{ result }` shape,
- a `tabs.query` filter that silently matches nothing,
- a storage read typed as `any`, so a renamed key is found by a user,
- `chrome.scripting.executeScript` file lists that no longer exist.

`@types/chrome` turns all of that into compile errors. It is one devDependency and part of S3, and it is the single cheapest protection this project can buy for the half of the product that talks to a browser — the half the suite can only exercise in CI, under xvfb, minutes after a mistake.

# HOW THE BUILD WORKS
```
shared/*.ts ──(compiled)──> shared/*.js ──┬──> local/lib/*.js   (existing pack step, now compiles)
                                          └──> extension/lib/*.js (new: build before CRX)
local/*.ts ──(compiled at prepack)──> local/*.js (shipped in the npm tarball)
extension/*.ts ──(compiled in publish-crx)──> extension/*.js (zipped into the CRX)
hosted/**/*.ts ──(never compiled)──> Deno runs it directly
```

- `tsc` is the only compiler. One `tsconfig.base.json` with `strict: true`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, `noImplicitOverride`.
- Per-surface configs extend the base: `tsconfig.shared.json`, `tsconfig.local.json`, `tsconfig.extension.json` (the extension needs `lib: ["DOM", "ES2022"]`, the local road needs `"Node"`, shared gets neither beyond what is pure).
- `"jsx"` is not needed anywhere; `"module"` is `esnext` and `"moduleResolution"` is `bundler`-free (explicit `.js` extensions in import paths, which the browsers and Node both accept).
- Emitted `.js` land **next to** the `.ts` source (same folder, same name), which means:
  - every existing import specifier that ends in `.js` keeps working unchanged (`./foo.js` resolves to the emitted file),
  - the tests that read `extension/lib/protocol.js` keep working unchanged,
  - the manifest's `background.js`, `content_scripts` and `web_accessible_resources` keep working unchanged,
  - `git rm --cached` + `.gitignore` the emitted files, exactly like `local/lib/`.
- The npm package's `files` list gains nothing (the `.js` files it already lists are the compiled output).
- **The dev loop stays one command.** "Load unpacked" in `chrome://extensions` must point at built files, so S3 adds `npm run build:extension` (and `build:extension:watch`), and `scripts/dev/extension-run.mjs` launches from the built output. The alternative Google's answer asks about — no build tools at all — is the shortcut this spec refuses, and its cost is exactly the 189 unchecked API call sites above.

# THE THREE SAFETY RULES (a half-migrated codebase is worse than a `.js` one)

1. **No `any`, no `@ts-expect-error`, no `as`-casts at a boundary without a written reason.** Any escape hatch must sit beside a comment that names why, in the same spirit as `CHROME_FREE_EXCEPTIONS`. A single `any` on a page object erases the protection for everything that reads it.
2. **The map equals the tree, for files too.** `tests/tooling/architecture.test.mjs` gains a rule: a `.js` file present in a folder marked `.ts` fails the gate (unless it is on the generated allowlist). This is the same pattern the restructure just built for folders.
3. **The release runs the build and cannot fall back.** `publish-crx.yml` compiles, verifies the emitted set is complete (every `.ts` has a fresh `.js`), and fails loudly if the compiler reports anything. There is no "ship the old build" path; a fallback is how a stale artifact reaches users silently — the exact failure `publish-crx` exists to prevent.

# THE STAGED PLAN (four PRs, each green before the next)

| Stage | Scope | Exit criteria |
|---|---|---|
| **S1** | `shared/` (14 files to `.ts`) + `tsconfig.base.json` + the emitted-file pipeline for both consumers + the no-`.js`-where-`.ts` gate rule + Sonar exclusion for generated output | `npm test`, `npm run check`, `tsc --noEmit` green; Deno check unchanged; the emitted `.js` byte-identical in *behaviour* (same exports, suite passes) |
| **S2** | `local/` (54 files to `.ts`) + compile at `prepack` + npm tarball smoke (`npm pack --dry-run` + load the packed CLI) | tarball carries only `.js`; the CLI boots from the tarball; suite green |
| **S3** | `extension/` (58 files to `.ts`) + compile in `publish-crx.yml` + CRX packing verification (no `.ts` inside the zip) | `py tests/browser_extension_test.py` green; a packed CRX loads; the manifest paths unchanged |
| **S4** | the contracts: one schema (Zod) in `shared/`, generating the tool surface types and the validators for both roads — this is PR #3, now landing on `.ts` instead of `.js` | the parity gate from PR #3; description drift impossible by construction |

Stages 1–3 change no behaviour at all: same modules, same exports, same protocol. Stage 4 is the only one that changes a contract, and it already has its own design.

# WHAT DOES NOT CHANGE

- `tests/` and `scripts/` stay `.mjs`; the three Python harnesses stay where they are and keep being called by `ci.yml`.
- `hosted/` is already TypeScript and already checked by `deno check`; nothing there moves.
- The wire protocol, the tool names, the 42-tool count, the envelopes, the CRX id and everything in `docs/` keep their current truth.
- No migration, no deploy change, no site change.

# RISKS AND MITIGATIONS

| Risk | Mitigation |
|---|---|
| Half-migrated forever (some `.ts`, some `.js`, `any` everywhere) | The three safety rules above, plus the no-`.js`-in-a-`.ts`-folder gate. A folder either converts fully or is not started. |
| A stale emitted `.js` shipped to users | Emitted files are gitignored and rebuilt by the release workflow; the workflow fails if the emitted set is incomplete. |
| Sonar counts the emitted `.js` as duplication of the `.ts` | Emitted files are gitignored, so the CI checkout (before the build) does not carry them; if any workflow builds before analysis, `.sonarcloud.properties` gains a generated-output exclusion with the written reason, exactly like `landing/` today. |
| The extension's release gains a step that can break | The step is one `tsc` invocation plus an emitted-set check, it runs before packing, and `publish-crx` already fails loudly when its inputs are wrong. |
| Slower iteration (compile time) | `tsc` in incremental mode for the dev loop; agents run `tsc --noEmit` for checks and the suite still runs on emitted files. Measured after S1, not assumed. |
| The suite's 202 `.mjs` tests import `.js` source that is now generated | They keep importing the same specifiers; the emitted file sits beside the source, so nothing in `tests/` changes in S1–S3. Verified by running the suite at each stage. |

# COSTS, HONESTLY

- **Files converted:** 14 (`shared/`) + 54 (`local/`) + 58 (`extension/`) = **126 source files**, plus the 4 generated files under `local/lib/` which stop being tracked sources and become pure outputs.
- **Config touched:** `tsconfig.base.json` + 3 per-surface configs, `package.json` scripts, `local/package.json` (`prepack`, `files`), `publish-crx.yml`, `.gitignore`, `.sonarcloud.properties`, `ARCHITECTURE.md`, `tests/tooling/architecture.test.mjs`, `gates.lock` (one re-pin).
- **New tooling dependency:** `typescript` as a devDependency, plus `@types/chrome` for the extension surface and `@types/node` for the local road (the only new dependencies; Deno is already installed and already checks `hosted/`).
- **Time:** S1 is a session; S2 and S3 are a session each with verification; S4 is PR #3. Four PRs, each independently reviewable and revertible.

# HOW WE VERIFY (per stage, in this order)

1. `tsc --noEmit` — zero errors, zero `any` introduced.
2. `npm test` — 202 files green, and the emitted `.js` is what the tests exercise.
3. `npm run check` — pins, primitive allowlist, runtime file census.
4. `tests/tooling/architecture.test.mjs` — map equals tree, plus the new "no `.js` in a `.ts` folder" rule.
5. Stage 2: `npm pack --dry-run` plus loading the CLI from the packed tarball.
6. Stage 3: `py tests/browser_extension_test.py` plus a real CRX pack that is verified to contain no `.ts`.
7. The owner's acceptance: the suite is a witness; the objective is that a wrong field or a wrong path can no longer reach a user unnoticed.

# EXPLICIT QUESTIONS FOR THE OWNER (answerable at review)

1. Emitted `.js`: gitignored and built in CI (this spec's proposal, matching `local/lib/`), or committed for the extension only so a CRX can be packed by hand without a build? The proposal is gitignored, because a committed artifact is the drift this whole effort is removing.
2. Do `tests/` and `scripts/` stay `.mjs` (proposal), or convert later to `.ts` with a Node loader? The proposal keeps them `.mjs`: they test the built artifact, and adding a loader to the test runner adds a runtime dependency for no drift reduction.
3. Does `noImplicitAny` land as a hard failure from S1, or as a warning for one stage with a written deadline? The proposal is hard failure — a warning that nobody reads is the "shortcut" this design exists to refuse.

# APPENDIX A - every file that converts

## `shared/` to `.ts` (14)
`ax-menu.js` `bing-serp.js` `canonical-order.js` `delta-first-observation.js` `digest.js` `multi-signal-relevance.js` `reactive-vm-collect.js` `reactive-vm-control-flow.js` `reactive-vm-core.js` `reactive-vm-host.js` `reactive-vm.js` `secret-pattern.js` `semantic-working-state.js` `tidy.js`

## `local/` to `.ts` (54 sources; the 4 files under `local/lib/` are generated output, never sources)
`action-strategy.js` `advice.js` `agent-guide.js` `bridge-ws.js` `bridge.js` `browsers.js` `burst.js` `canvas.js` `captcha-solver.js` `caret-guard.js` `cdp.js` `cloud.js` `decks.js` `dev-shim.js` `dialog.js` `doctor.js` `documents.js` `driver.js` `focus-guard.js` `gates.js` `input.js` `install.js` `leases.js` `mcp-server.js` `menu-tree.js` `oauth.js` `observe.js` `page-expressions.js` `pointer.js` `postinstall.js` `primitives-file.js` `primitives.js` `read-strategy.js` `registry.js` `reports.js` `sessions.js` `spreadsheets.js` `statements.js` `surface-profile.js` `tools.js` `transport.js` `waits.js` `wallet-client.js` `window-focus.js` `ws-server.js` `bin/opera-agent-mcp.js` `bin/opera-local-dev.js` `bin/opera-local.js` `office/docx.js` `office/palette.js` `office/pptx.js` `office/xlsx.js` `office/xml.js` `office/zip.js`

## `extension/` to `.ts` (58)
`background.js` `content.js` `hover-settle.js` `options.js` `popup.js` `role-reconcile.js` `semantic-identity.js` `semantic-views.js` `content/record-main.js` `content/record-scan.js` `lib/action-pipeline.js` `lib/agent-log.js` `lib/ax-summary.js` `lib/browser-id.js` `lib/deadline-race.js` `lib/debugger-session.js` `lib/endpoints.js` `lib/error-capture.js` `lib/error-messages.js` `lib/external-origins.js` `lib/focus-gate.js` `lib/goal-plan.js` `lib/i18n.js` `lib/keyboard.js` `lib/log.js` `lib/model-client.js` `lib/options-store.js` `lib/page-map.js` `lib/popup-events.js` `lib/protocol.js` `lib/self-update.js` `lib/serialize.js` `lib/socket-client.js` `lib/socket-protocol.js` `lib/statement-file.js` `lib/status-icons.js` `lib/watch.js` `lib/window-restore.js` `lib/zip-read.js` `worker/action-focus.js` `worker/bridge-link.js` `worker/burst.js` `worker/capture-page.js` `worker/capture.js` `worker/download-wait.js` `worker/dump-page.js` `worker/execute-pull.js` `worker/instance-id.js` `worker/listen.js` `worker/pair-cookie.js` `worker/private-tabs.js` `worker/record-session.js` `worker/scan-page.js` `worker/self-update.js` `worker/statement.js` `worker/tab-content.js` `worker/utils.js` `worker/watch-registry.js`

## Already TypeScript, untouched (16)
`hosted/functions/opera-agent-{auth,billing,gateway,listen,runner,update,vm}/index.ts` (7), `hosted/functions/opera-agent-bridge/{index,bridge-socket,plan-gate}.ts` (3), `hosted/functions/opera-agent-mcp/{index,device,plan-info,tools}.ts` (4), `hosted/functions/_shared/{command-stream,cut-stream}.ts` (2)

## Deliberately left as `.mjs` (233)
`tests/**` — 202 `.test.mjs` + 10 `tests/helpers/*.mjs` (fixtures are `.json`) · `scripts/**` — 21 `.mjs` (plus 2 `.py`)

# APPENDIX B - every config file touched

`tsconfig.base.json` (new) · `tsconfig.shared.json`, `tsconfig.local.json`, `tsconfig.extension.json` (new; the extension config carries `"types": ["chrome"]` and `lib: ["DOM", "ES2022"]`, the local one `"types": ["node"]`) · `@types/chrome`, `@types/node`, `typescript` (new devDependencies) · `package.json` (`type: module` stays; new `types` script; `pretest` builds shared+local; new `build:extension` / `build:extension:watch`) · `local/package.json` (`prepack` compiles; `files` unchanged because it already lists the emitted names) · `.github/workflows/publish-crx.yml` (compile step + emitted-set check before packing) · `.gitignore` (emitted `.js` patterns) · `.sonarcloud.properties` (generated-output exclusion, only if a workflow builds before analysis) · `ARCHITECTURE.md` (the target table from this spec) · `tests/tooling/architecture.test.mjs` (no-`.js`-in-a-`.ts`-folder rule) · `scripts/dev/extension-run.mjs` (launch from the built output) · `gates.lock` (one re-pin, reasons in the commit)
