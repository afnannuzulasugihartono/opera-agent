# TypeScript core - Stage 1 (`shared/`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `shared/` (14 modules) to TypeScript with a real `tsc` build, so the one pure core both roads read is type-checked, and every consumer keeps reading emitted `.js` exactly where it does today.

**Architecture:** `shared/*.ts` is the source; `tsc` emits `shared/*.js` beside it (untracked, gitignored). The local package and the extension keep importing `./lib/*.js` / `./x.js` specifiers — the same specifier now resolves to the emitted file. The edge functions keep importing `../../../shared/x.js`; the deploy workflow builds `shared/` before deploying, and `pretest` builds it before the suite so every existing test path keeps working.

**Tech Stack:** TypeScript (`tsc` only — no bundler), Node 22 (`node --test`), Deno (edge, already TypeScript), the repository's own gates (`npm test`, `npm run check`, `tests/tooling/architecture.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-13-typescript-core-design.md`

**Scope note:** this plan is Stage 1 of four. Stages 2 (`local/`, 54 files) and 3 (`extension/`, 58 files) apply the same mechanism to their folders and will get a short plan each; Stage 4 is PR #3 (one schema → types on both roads). Stage 1 deliberately makes the mechanism, the safety gates and the release wiring real, on the smallest folder, so the later stages are mechanical.

## Global Constraints

- `tsconfig.base.json` carries: `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `module: "nodenext"`, `moduleResolution: "nodenext"`, `target: "es2022"`, `declaration: false`, `sourceMap: false`, `isolatedModules: true`.
- Import specifiers keep their `.js` extension in the source (`import { x } from './digest.js'`), because Node, Deno and the browser all consume the emitted `.js`. `tsc` maps `./digest.js` to `./digest.ts` at compile time. No `.ts` specifier anywhere.
- No `any`, no `@ts-expect-error`, no `as` at a boundary, without a written reason in a comment beside it.
- Emitted `.js` are untracked: one `.gitignore` rule per converted folder, no exceptions.
- `tests/**` and `scripts/**` stay `.mjs`. The three Python harnesses stay at `tests/` root.
- No behaviour change: same exports, same runtime shape, same protocol. Stage 1 changes file extensions and adds a compile step, nothing else.
- `npm test` must be runnable from a clean checkout with one command (the build is part of it), and a missing build must fail loudly, never silently pass.
- Commit per task; each commit leaves the suite green.

## Review Focus

The five failure modes most likely to bite, each pinned by a test in its task below:

1. **A gate that scans by file extension silently stops seeing the code** (`scripts/verify/check.mjs`, `scripts/verify/scope.mjs`, `tests/tooling/structure-gates.test.mjs`, `tests/tooling/hygiene.test.mjs`). A gate that scans zero files passes. → Task 3 pins the census; Task 4 proves it with a deliberately bad file.
2. **A stale emitted `.js` from an earlier build masks a source edit or a deleted file.** → Task 3 makes the build clean before compiling, and pins that a removed source leaves no emitted file.
3. **The build is skipped** (someone runs `node --test` directly, or CI's SonarCloud job runs before the build) and tests read a stale or missing artifact. → Task 3 puts the build in `pretest` and in the workflows that need it.
4. **The edge deploy ships without the emitted files** the functions import (`../../../shared/x.js`), because nothing built `shared/` in that workflow. → Task 3 wires `deploy-functions.yml`.
5. **A test that reads a shared module as source text** (not as a module) keeps reading generated output, and its assertions become meaningless. → Task 2 re-points those tests at `.ts`.

---

### Task 1: The toolchain, proven by a real conversion

**Files:** (amended by ruling: the whole folder converts here, not one file)
- Create: `tsconfig.base.json`, `tsconfig.shared.json`
- Modify: `package.json` (new `types` and `build:shared` scripts; `typescript` devDependency), `.gitignore` (one rule), `tests/tooling/architecture.test.mjs` (new rule: an emitted `.js` must have a `.ts` sibling and must not be tracked)
- Rename: `shared/canonical-order.js` → `shared/canonical-order.ts`

**Interfaces:**
- Produces: `npm run build:shared` (cleans then compiles `shared/*.ts` → `shared/*.js`), `npm run types` (`tsc --noEmit` over every surface config; Stage 1 only has the shared one). Task 2 and Task 3 call both by name.

- [x] **Step 1: Write the failing test for the map rule** (done 2026-11-13; the rule is in the tree)

In `tests/tooling/architecture.test.mjs`, add:

```js
test('an emitted .js has a .ts sibling and is never tracked', () => {
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean));
  const GENERATED_ALLOW = [/^local\/lib\//];
  const offenders = [];
  for (const folder of ['shared', 'local', 'extension']) {
    const dir = path.join(repo, folder);
    if (!fs.existsSync(dir)) continue;
    const tsCount = walkFiles(dir).filter((f) => f.endsWith('.ts')).length;
    if (!tsCount) continue;
    for (const file of walkFiles(dir).filter((f) => f.endsWith('.js'))) {
      const rel = path.relative(repo, file).split(path.sep).join('/');
      if (GENERATED_ALLOW.some((re) => re.test(rel))) continue;
      if (tracked.has(rel)) { offenders.push(`${rel}: tracked .js in a folder that carries .ts`); continue; }
      if (!fs.existsSync(file.replace(/\.js$/, '.ts'))) offenders.push(`${rel}: emitted .js with no .ts source`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});
```

- [x] **Step 2: Run it and watch it pass for the wrong reason** (done 2026-11-13; recorded in the ledger)

Run: `node --test tests/tooling/architecture.test.mjs`
Expected: PASS — because no folder carries `.ts` yet, so the rule's body never runs. This is the trap the rule exists for; Task 1 removes the vacuity.

**Scope note (amended 2026-11-13, ruling recorded in the run ledger):** the spec's safety rule is "a folder either converts fully or is not started", so Task 1 converts **all 14** `shared/` modules with the toolchain, and Task 2 carries the follow-through (three source-text readers, five boundary pins, the hygiene staged map). The original split of one-file-then-thirteen broke the builder's clean, the map gate and Task 2's subject at once; the spec won.

- [x] **Step 3: Add the toolchain and convert every `shared/` module** (done 2026-11-13: all 14 as .ts; no .js source survives; `host.d.ts` carries the ambient declarations)

- `tsconfig.base.json` with the Global Constraints flags.
- `tsconfig.shared.json`: `{ "extends": "./tsconfig.base.json", "include": ["shared/**/*.ts"] }`.
- `package.json`: `"build:shared": "node scripts/pack/build-shared.mjs"`, `"types": "tsc --noEmit -p tsconfig.shared.json"`, devDependency `typescript`.
- `scripts/pack/build-shared.mjs`: delete every `shared/*.js` first (clean, so a deleted source cannot leave an artefact), then run `tsc -p tsconfig.shared.json`.
- `.gitignore`: `shared/*.js`.
- Rename the file and add the types the base flags demand: `codeUnitCompare(a: string, b: string): number`, `canonicalJson`/`digestCanonical` stay as they are but move their JSDoc into real signatures where they exist in this file.

- [x] **Step 4: Run the gate and the compile** (done 2026-11-13: `npm run types`, `npm run build:shared`, suite green)

Run: `npm run build:shared && node --test tests/tooling/architecture.test.mjs`
Expected: the emitted `shared/canonical-order.js` exists, is untracked, has its `.ts` sibling — and the map rule now actually executes.

- [x] **Step 5: Prove the rule catches the real thing** (done 2026-11-13, proven the orphan way: an untracked `shared/bogus-no-source.js` turns the suite red; `git add -f` is refused by .gitignore, so the tracked branch stays belt-and-suspenders)

Temporarily `git add -f shared/canonical-order.js`, run the gate, expect FAIL with `tracked .js in a folder that carries .ts`, then `git rm --cached` it and re-run to see PASS. Leave the tree clean.

- [x] **Step 6: Commit** (the deploy-functions commit landed first as its own; the census commit lands with this edit)

```bash
git add tsconfig.base.json tsconfig.shared.json package.json .gitignore tests/tooling/architecture.test.mjs shared/canonical-order.ts scripts/pack/build-shared.mjs
git commit -m "types(shared): the toolchain, proven on one real conversion - tsc with strict flags, one emitted-file rule the map gate enforces"
```

### Task 2: Convert the remaining 13 modules, and re-point what reads source text

**Files:**
- Rename: the other 13 `shared/*.js` → `shared/*.ts`
- Modify: `tests/search/bing-serp.test.mjs`, `tests/shared/{ax-menu,delta-first-observation,mcp-output-kr,mcp-output-tidy,reactive-vm-host,semantic-working-state}.test.mjs` (only where they read a shared module as source text), `tests/helpers/boundary-locks.mjs` (5 pins point at `.ts`; SHAs re-computed over the `.ts` bytes), `tests/tooling/hygiene.test.mjs` (the staged-module map key `shared/ax-menu.js` → `.ts`)

**Interfaces:**
- Consumes: `npm run build:shared` from Task 1.
- Produces: all 14 `shared/*.ts` sources; every existing `.js` specifier in `tests/`, `local/`, `hosted/` unchanged and still resolving to an emitted file.

- [ ] **Step 1: Re-point the three source-text readers first, and watch them fail** (executed after the conversion, not before; noted in the ledger)

`tests/shared/mcp-output-kr.test.mjs` and `mcp-output-tidy.test.mjs` read `shared/tidy.js` and strip types; `tests/shared/reactive-vm-host.test.mjs` scans `shared/reactive-vm-host.js` text. Change each URL to `.ts`, run all three:
Run: `node --test tests/shared/`
Expected: FAIL — `shared/tidy.ts` and `shared/reactive-vm-host.ts` do not exist yet.

- [x] **Step 2: Convert the 13 files** (done 2026-11-13; all 14 convert; unknown boundaries kept as unknown)

Rename and give real types to the exported surfaces. The types are the ones the call sites already assume — read the callers, do not invent: `parseBingSerp(input: { text?: string; links?: Array<{ href?: string; text?: string }> }, options?: { currentFirst?: number })`, `hostOf(href: string): string`, `tidyForAi(value: unknown): Record<string, unknown>`, `canonicalJson(value: unknown): string`, `digestCanonical(value: unknown): Promise<string>`, and the `reactive-vm*` family keeps its `unknown` boundaries (they validate untrusted input; `unknown` plus the existing guards is the correct type, not `any`).

- [x] **Step 3: Build and run the whole shared surface** (done 2026-11-13: types, build, suite green)

Run: `npm run types && npm run build:shared && node --test tests/shared tests/search tests/vm`
Expected: PASS.

- [x] **Step 4: Re-pin the five boundary locks to their sources** (done 2026-11-13: pins point at .ts; suite green)

`tests/helpers/boundary-locks.mjs` currently pins the git-blob SHA-256 of `../shared/*.js`. Point the five entries at `../shared/*.ts` and recompute each SHA over the `.ts` bytes (`git hash-object`-style: `sha256("blob <len>\0" + LF-normalised content)`), then:
Run: `node --test tests/tooling/boundary-locks.test.mjs`
Expected: PASS. A pin now freezes the source, where before it would have frozen a compiler artefact.

- [x] **Step 5: Fix the staged-module map** (done 2026-11-13, plus the reach census now maps an artifact reach to its source and ignores ambient .d.ts)

`tests/tooling/hygiene.test.mjs` lists `['shared/ax-menu.js', 'Task 9 of ...']`; after conversion the reachability walk sees `shared/ax-menu.ts`. Change the key, then:
Run: `node --test tests/tooling/hygiene.test.mjs`
Expected: PASS — and if the key were left stale, this test fails with "reached by the product now, so the staged list must drop them", which is the guard working.

- [ ] **Step 6: Commit**

```bash
git add -A shared tests
git commit -m "types(shared): all 14 modules are TypeScript - the pins freeze the source now, not a compiler artefact"
```

### Task 3: Wire the build into every path that needs it

**Files:**
- Modify: `package.json` (`pretest` builds first), `scripts/pack/pack-mcp.mjs` (copies the emitted `shared/*.js`, unchanged in shape), `scripts/verify/check.mjs` (collect `.ts` for extension/shared/local; drop the stale `supabase` condition), `scripts/verify/scope.mjs` (`*.ts` in the `git ls-files` patterns), `tests/tooling/structure-gates.test.mjs` (scan `.ts`, rename the two allowlist entries), `.sonarcloud.properties` (generated-output exclusion with its reason), `.github/workflows/deploy-functions.yml` (build before deploy)

**Interfaces:**
- Consumes: `npm run build:shared`, `npm run types`.
- Produces: `npm test` green from a clean checkout; a census that counts the TypeScript sources; a deploy that carries the emitted files.

- [x] **Step 1: Write the failing test for the census** (done 2026-11-13: tests/tooling/types-census.test.mjs; check.mjs `--list` prints the census; the red run failed at the gate layer, see the ledger)

In `tests/tooling/professional.test.mjs` (it already reads the check output) or a new `tests/tooling/types-census.test.mjs`, assert that `npm run check`'s runtime-file count is taken over files **including `.ts`**, by asserting the census lists at least one `shared/*.ts` path:

```js
test('the runtime census sees TypeScript sources, not only .js', () => {
  const listed = execFileSync(process.execPath, ['scripts/verify/check.mjs', '--list'], { cwd: repo, encoding: 'utf8' });
  assert.match(listed, /^shared\/canonical-order\.ts$/m);
});
```

(Add the `--list` flag to `check.mjs` in Step 3 — it prints the census it already computes and exits.)

- [x] **Step 2: Run it and watch it fail** (done 2026-11-13; red confirmed: gates drift stopped check.mjs from even listing until its pin moved, then it passed)

Run: `node --test tests/tooling/types-census.test.mjs`
Expected: FAIL — no `--list` flag, and the census does not carry `.ts`.

- [x] **Step 3: Implement the wiring** (done 2026-11-13: check.mjs collects .js+.ts and gained `--list`; scope.mjs already carried `**/*.ts`; pack-mcp unchanged; pretest builds; deploy-functions builds; structure-gates scans both; sonarcloud excludes the uncommitted twins with the written reason; the stale `supabase` condition is gone; extension exceptions stay .js, the retarget to .ts is stage 3)

- `check.mjs`: `collectRuntimeFiles('extension', new Set(['.js', '.ts']))`, same for `shared` and `local`; keep `node --check` on `.js` only (the compile is the parse check for `.ts`); delete the dead `file.startsWith('supabase')` condition; add `--list`.
- `scope.mjs`: `git ls-files` patterns gain `**/*.ts`.
- `structure-gates.test.mjs`: `n.endsWith('.js')` → `/\.(js|ts)$/`, and the two allowlist names become `debugger-session.ts` / `burst.ts`.
- `pack-mcp.mjs`: unchanged logic, now copying the emitted `shared/*.js`.
- `package.json`: `"pretest": "npm run build:shared && node scripts/pack/pack-mcp.mjs"`.
- `deploy-functions.yml`: a step `npm ci && npm run build:shared` before the deploy step (the functions import `../../../shared/*.js`).
- `.sonarcloud.properties`: exclusion for generated output (`shared/**/*.js` and, in later stages, `local/**/*.js`, `extension/**/*.js`) with the written reason: the compiled copy is the source's duplicate by construction.

- [x] **Step 4: Prove the build is honest about removals** (done 2026-11-13, stricter than drawn: a stale `shared/zzz-temp.js` with no source REFUSES the build and names itself instead of being deleted silently, and the hygiene gate refuses it too - nothing is destroyed without a human; the twin was removed by hand and the build went green)

`touch shared/zzz-temp.ts` with `export const x: number = 1;`, `npm run build:shared`, confirm `shared/zzz-temp.js` exists; `rm shared/zzz-temp.ts`, `npm run build:shared`, confirm `shared/zzz-temp.js` is gone. This is the clean-before-compile rule doing its job.

- [x] **Step 5: Run the gates** (done 2026-11-13: npm run types, npm test, npm run check all green)

Run: `npm test && npm run check && npm run types`
Expected: all green; the census prints the `.ts` sources.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "types(shared): every path that needs the build gets it - pretest, the pack step, the census, the deploy workflow; the census stops being blind to .ts"
```

### Task 4: Prove the gate is real (the acceptance step)

**Files:**
- Modify: none (this task only proves; if it finds a hole, that hole is a bug in Task 1–3)

- [x] **Step 1: Break a type on purpose** (done 2026-11-13: `const nope: number = 'nope'` in shared/canonical-order.ts)

Change `shared/canonical-order.ts` to call a function with the wrong argument count (or add `const x: number = 'nope';`).

- [x] **Step 2: Watch both gates refuse** (done 2026-11-13: `npm run types` exits 2 at shared/canonical-order.ts(14,7) TS2322; `npm test` exits 1 at pretest with the same error - nothing reached the suite)

Run: `npm run types`
Expected: FAIL with the exact file and line.
Run: `npm test`
Expected: FAIL at `pretest` (the build refuses before the suite runs). This is the property the owner asked for: a wrong field or a wrong path cannot reach a user unnoticed.

- [x] **Step 3: Restore and confirm green** (done 2026-11-13: git checkout; types, test, check green)

`git checkout -- shared/canonical-order.ts`, run `npm test && npm run check && npm run types`, expect all green.

- [ ] **Step 4: Write the honest line in the handoff**

Add to `docs/handoff.md` State: "`shared/` is TypeScript, compiled at pretest/prepack into untracked `.js`; the source is what the pins freeze." Then commit:

```bash
git add docs/handoff.md
git commit -m "docs(handoff): shared/ is TypeScript; the source is what the pins freeze"
```

---

## Self-Review

**Spec coverage:** Stage 1 of the spec = this plan. The spec's "three safety rules" are Task 1 (map rule), Task 3 (build in pretest, release cannot fall back), and the Global Constraints (`any` banned). The spec's `@types/chrome` and `@types/node` belong to Stages 3 and 2 and are named there. The spec's risk table rows (stale artefact, gate blind to `.ts`, Sonar duplication, extension release step, compile time) each have a task here except the extension release step (Stage 3). No spec requirement for Stage 1 is left without a task.

**Step scan:** every step names one action with a checkable result. The only place a body appears is the map-rule test (Task 1 Step 1) and the census test (Task 3 Step 1), because the test *is* the decision.

**Type consistency:** `build:shared`, `types`, `--list` are named identically in Tasks 1, 3, 4. The signature list in Task 2 Step 2 matches the existing callers checked in this session (`parseBingSerp`, `hostOf`, `tidyForAi`, `digestCanonical`).

**Review Focus:** the five failure modes each have a pinning test (Tasks 1, 2, 3), and two of them are proven by deliberately breaking the tree (Task 1 Step 5, Task 4 Step 2).

**Proportion:** the plan is shorter than the spec it implements, and it names four tasks for one folder; Stages 2 and 3 reuse the mechanism without re-deciding it.
