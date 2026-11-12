# npm auto-install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm i -g opera-agent-mcp` ships a machine that "just works", and `opera-agent-mcp uninstall` undoes all of it — the extension included, by the browser's own hand.

**Architecture:** A small set of new modules inside the published package (a platform-gated installer that probes installed browsers, writes per-user registry keys pointing at the public update manifest, drops a verified CRX backup and a README into `%LOCALAPPDATA%\OperaAgent\<Browser>\`, and a symmetrical uninstaller). A `postinstall` hook runs the installer silently and always exits 0. No browser profile is ever edited; the Secure Preferences are never touched.

**Tech Stack:** Node >= 20, ES modules, `child_process.execFileSync('reg', …)` for registry ops (behind a seam for tests), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-npm-auto-install-design.md`

## Global Constraints

- Windows only for registry writes; every other OS prints the Web Store answer and exits 0 with no side effects.
- Browsers are detected by path probe only — never by registry reads, never by version detection.
- Registry writes: HKCU, per-user, no elevation, idempotent.
- CRX download: read `x-opera-sha256` from the HEAD response of the CRX URL; verify magic bytes `Cr24` and the sha256 before saving; on any failure the folder is not created and the rest of the install still completes.
- `npm test` and `npm run check` must exit 0 after every task.
- The extension and update manifest stay at 1.6.44 until the next extension-bearing release; the npm package version moves to 1.6.46.

## Review Focus

1. **Browser present but registry write denied** (policy-managed desktop) — install logs the failed browser, writes the rest, exits 1 for `install` with the manual route named (the `.reg` path); `postinstall` exits 0 regardless. Test: `tests/install.test.mjs` case `denied write logs and completes, exit 1 reported, exit 0 in postinstall`.
2. **CRX download unreachable or corrupt** (offline/proxy) — no folder created, keys still written (they need no network), install still completes for the browsers whose keys were written; exit 0 in `postinstall`, exit 1 in `install` with the reason printed. Test: same file, case `download failure leaves no folder, reports reason`.
3. **Chrome blocks the re-add after an uninstall** (sticky removal observed earlier) — uninstall prints exactly: registry-installed copies are gone after the next browser start; a profile that ever removed the extension will not silently reinstall; manual unpacked copies remove once at `chrome://extensions`. Behaviour, not code — in the printout and in `docs/install.md`.
4. **Package installed as a dependency, not globally** — `postinstall` must not write anything. Test: `tests/postinstall.test.mjs` case `not global install exits 0 with no writes` with `npm_config_global` unset.
5. **Uninstall of a machine that never installed anything** — all removals report `nothing to remove`, process exits 0; no folder deletion is attempted when `%LOCALAPPDATA%\OperaAgent` is absent. Test: `tests/uninstall.test.mjs` case `clean machine reports nothing, exit 0`.

---

### Task 1: Browser detection module `local/detect-browsers.js`

**Files:**
- Create: `local/detect-browsers.js`
- Modify: `local/package.json` (add to `files`)
- Test: `tests/detect-browsers.test.mjs`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `export function probeBrowsers(existsAt) → Array<{ id: 'chrome' | 'brave' | 'edge', path: string }>` where `existsAt(p)` is a boolean probe injected for tests. `export const BROWSER_CANDIDATES` — the exact path table from the spec:
  - chrome: `<Program Files>\Google\Chrome\Application\chrome.exe`, `<Program Files(x86)>\Google\Chrome\Application\chrome.exe`, `<LocalAppData>\Google\Chrome\Application\chrome.exe`
  - brave: `<Program Files>\BraveSoftware\Brave-Browser\Application\brave.exe`, `<Program Files(x86)>\BraveSoftware\Brave-Browser\Application\brave.exe`
  - edge: `<Program Files(x86)>\Microsoft\Edge\Application\msedge.exe`, `<Program Files>\Microsoft\Edge\Application\msedge.exe`
  - chrome/brave/edge also probe the same `Application` segment under each root in lowercase? No — exactly these.

- [ ] **Step 1: Write the failing tests**

```js
import { probeBrowsers, BROWSER_CANDIDATES } from '../local/detect-browsers.js';

const tree = (paths) => { const set = new Set(paths); return (p) => set.has(p); };

test('finds chrome at Program Files', () => {
  const found = probeBrowsers(tree(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']));
  assert.deepEqual(found, [{ id: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }]);
});

test('finds nothing when nothing exists', () => assert.deepEqual(probeBrowsers(() => false), []));

test('finds all three when present, order chrome, brave, edge', () => {
  const all = new Set(BROWSER_CANDIDATES.map((b) => b.path));
  const found = probeBrowsers((p) => all.has(p));
  assert.deepEqual(found.map((f) => f.id), ['chrome', 'chrome', 'chrome', 'brave', 'brave', 'edge', 'edge'].filter((id, i, arr) => arr.indexOf(id) === i));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/detect-browsers.test.mjs`
Expected: FAIL — cannot resolve module `../local/detect-browsers.js`.

- [ ] **Step 3: Implement `local/detect-browsers.js`**

Export `BROWSER_CANDIDATES` (exact paths from the Interface block, built with `process.env['ProgramFiles']`, `process.env['ProgramFiles(x86)']`, `process.env['LOCALAPPDATA']` at call time, not import time) and `probeBrowsers(existsAt)`. Signature above. No side effects, no fs reads outside the probe.

- [ ] **Step 4: Add `detect-browsers.js` to `local/package.json` `files`**

- [ ] **Step 5: Run to verify they pass**

Expected: PASS.

- [ ] **Step 6: Commit**

`git add local/detect-browsers.js local/package.json tests/detect-browsers.test.mjs && git commit -m "feat(install): probe installed browsers by path"`

### Task 2: Registry seam `local/registry.js`

**Files:**
- Create: `local/registry.js`
- Modify: `local/package.json` (add to `files`)
- Test: `tests/registry.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `export const EXTENSION_ID = 'ofgemipoobcnbjkfanmofjbdonjapmgl'`, `export const UPDATE_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/update.xml?id=ofgemipoobcnbjkfanmofjbdonjapmgl'` (inline in the module; not imported elsewhere), `export function writeExtensionKey({ vendor, exec }) → { ok, error? }` and `export function deleteExtensionKey({ vendor, exec }) → { ok, error? }` where `exec(cmd, args)` defaults to `execFileSync(cmd, args, { encoding: 'utf8' })`. `vendor` is `'chrome' | 'brave' | 'edge'` and maps to `HKCU\Software\Google\Chrome\Extensions\<id>`, `HKCU\Software\BraveSoftware\Brave-Browser\Extensions\<id>`, `HKCU\Software\Microsoft\Edge\Extensions\<id>` respectively. Values: `update_url` → `UPDATE_URL`, type `REG_SZ`, via `reg add <key> /v update_url /t REG_SZ /d <url> /f`; delete via `reg delete <key> /f`.

- [ ] **Step 1: Write the failing tests**

```js
const KEYS = { chrome: 'HKCU\\Software\\Google\\Chrome\\Extensions\\ofgemipoobcnbjkfanmofjbdonjapmgl', brave: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\Extensions\\ofgemipoobcnbjkfanmofjbdonjapmgl', edge: 'HKCU\\Software\\Microsoft\\Edge\\Extensions\\ofgemipoobcnbjkfanmofjbdonjapmgl' };

test('writes each vendor key with update_url', () => {
  for (const [vendor, key] of Object.entries(KEYS)) {
    const calls = [];
    const r = writeExtensionKey({ vendor, exec: (cmd, args) => calls.push([cmd, ...args]) });
    assert.deepEqual(calls, [['reg', 'add', key, '/v', 'update_url', '/t', 'REG_SZ', '/d', UPDATE_URL, '/f']]);
    assert.equal(r.ok, true);
  }
});

test('returns ok:false on failure without throwing', () => {
  const r = writeExtensionKey({ vendor: 'chrome', exec: () => { throw new Error('access denied'); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /access denied/i);
});

test('deletes each vendor key', () => {
  for (const [vendor, key] of Object.entries(KEYS)) {
    const calls = [];
    deleteExtensionKey({ vendor, exec: (cmd, args) => calls.push([cmd, ...args]) });
    assert.deepEqual(calls, [['reg', 'delete', key, '/f']]);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `local/registry.js`**

`exec` seam: exactly three exported symbols above; `writeExtensionKey`/`deleteExtensionKey` wrap exec in try/catch and return `{ ok, error? }`. The `reg.exe` path on Windows is `reg` (on PATH). No other registry calls.

- [ ] **Step 4: Add `registry.js` to `local/package.json` `files`**

- [ ] **Step 5: Run to verify they pass**

- [ ] **Step 6: Commit**

`git add local/registry.js local/package.json tests/registry.test.mjs && git commit -m "feat(install): write and delete the pinned extension registry keys"`

### Task 3: Verified CRX download + local layout `local/install.js` (part of `install()`)

**Files:**
- Create: `local/install.js`
- Modify: `local/package.json` (add to `files`)
- Test: `tests/install.test.mjs`

**Interfaces:**
- Consumes: `probeBrowsers` (Task 1), `writeExtensionKey`, `deleteExtensionKey` (Task 2).
- Produces: `export async function fetchVerifiedCrx({ url, sha256Header, fetchImpl = globalThis.fetch, headThrows = false }) → Buffer` and `export function installCrxInto(root, browser, bytes, readme) → { folder, crx }`. `install()` orchestration (Task 4) consumes both. `fetchVerifiedCrx` reads the `x-opera-sha256` response header from the HEAD request to `url` (the same CRX URL the unduh page documents), then `GET`s it, verifies the bytes match the sha256 and start with the bytes `43 72 32 34` (`Cr24`), throws otherwise. `installCrxInto` creates `<root>\<browser>\` (`%LOCALAPPDATA%\OperaAgent` by default), writes `extension.crx` and `README.txt`, refuses (no folder) if bytes fail verification.

- [ ] **Step 1: Write the failing tests**

```js
// Local HTTP server in tests/install.test.mjs serves:
// GET /crx → 204 bytes of header 'Cr24' + filler, correct sha256 in response header on HEAD
// sha256 of those bytes must match the header the test computes.

test('fetchVerifiedCrx returns bytes when hash matches and magic is Cr24');
test('fetchVerifiedCrx throws when the sha256 header disagrees');
test('fetchVerifiedCrx throws when the payload is not Cr24');
test('installCrxInto creates <root>/<browser>/extension.crx and README.txt');
test('installCrxInto creates no folder on verification failure');
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the two functions exactly as specified above**

`README.txt` content is fixed:
```
Opera Agent for <browser>

This folder keeps a verified copy of the extension in case the browser
cannot install it from the registry. To install manually: chrome://extensions
(edge/brave equivalents) -> Developer mode -> Load unpacked -> this folder's
parent in this OperaAgent tree.

How the automatic install works: the browser reads HKCU\Software\...\Extensions\<id>,
fetches the update manifest, downloads the same CRX, and installs it. Deleting the
key removes the extension on next start.

Uninstall: run `opera-agent-mcp uninstall`, or double-click
store/extension-registry-uninstall.reg from the repository.
Pairing: open the extension -> Sign in with the Opera Agent dashboard, or run
`opera-agent-mcp auth`.
```

- [ ] **Step 4: Add `install.js` to `local/package.json` `files`**

- [ ] **Step 5: Run to verify they pass**

- [ ] **Step 6: Commit**

`git add local/install.js local/package.json tests/install.test.mjs && git commit -m "feat(install): download and verify the CRX, lay out the OperaAgent folder"`

### Task 4: Orchestrator `install()` in `local/install.js`

**Files:**
- Modify: `local/install.js`
- Test: `tests/install.test.mjs` (append)

**Interfaces:**
- Consumes: everything from Task 3, plus `update.xml`-derived constants: `CRX_URL = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/opera-agent-ofgemipoobcnbjkfanmofjbdonjapmgl-1.6.44.crx'`, `SHA256_HEADER = 'x-opera-sha256'`.
- Produces: `export async function install({ env = process.env, exec = defaultExec, fetchImpl = globalThis.fetch, print = console.error, root = process.env.LOCALAPPDATA + '\\OperaAgent' } = {}) → { ok: boolean, browsers: Array<{ id, keyWritten, crx: 'written' | 'failed' | 'skipped' }>, message: string }`. Non-Windows or zero browsers → `{ ok: false, browsers: [], message: <instructions> }` and no side effects.

- [ ] **Step 1: Write the failing tests**

```js
test('non-Windows platform returns instructions, no side effects');
test('zero browsers detected returns instructions, no side effects');
test('writes keys for each detected browser and reports success');
test('CRX failure leaves keys written, no folder, reports reason, exit-style ok:false');
test('partial failure: one denied key does not stop the others');
test('quiet mode (used by postinstall) produces no stdout/stderr of its own; caller prints the one line');
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `install()`**

Flow: `if (env.PLATFORM not win32)` — actually probe `process.platform` via options. Steps: detect; if empty → message + `{ ok:false, browsers: [], message }`. For each detected browser: `writeExtensionKey`; collect. For each browser whose key was written: `fetchVerifiedCrx` + `installCrxInto`. Compose the final message lines: which browsers registered, which CRX written/failed, and the one remaining human step ("Sign in with `opera-agent-mcp auth`, then open the extension and pair the device"). Return the report. Never throws; every error lands in the report.

- [ ] **Step 4: Add README/spec note** pointing at `docs/registry-install.md` — no code.

- [ ] **Step 5: Run to verify they pass**

- [ ] **Step 6: Commit**

`git add local/install.js tests/install.test.mjs && git commit -m "feat(install): install orchestrates probe, key write, verified CRX drop"`

### Task 5: `uninstall()` in `local/install.js` (append)

**Files:**
- Modify: `local/install.js`
- Test: `tests/uninstall.test.mjs`

**Interfaces:**
- Consumes: `deleteExtensionKey` (Task 2), same folder root logic as Task 3.
- Produces: `export async function uninstall({ keepPair = false, exec = defaultExec, spawn = defaultSpawn, root } = {}) → { ok: boolean, steps: Array<{ step: string, result: string }> }`. `spawn` is injectable; production implementation spawns `npm uninstall -g opera-agent-mcp` detached with `setsid`/`detached: true`, does not wait; output discards.

- [ ] **Step 1: Write the failing tests**

```js
test('clean machine reports nothing removed, exit ok');
test('deletes all three keys and reports each');
test('deletes the OperaAgent folder; keepPair keeps device file, everything else still deleted');
test('spawns npm uninstall -g with detached:true');
test('spawn failure is reported, process still exits ok');
test('prints browser Remove instructions for developer-mode copies');
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `uninstall()`**

Steps in order: delete the three keys; if `<root>` exists delete it, or with keepPair delete all except the device file; spawn detached npm uninstall; compose the browser-removal message listing the detected browsers (re-probe for the printout, no writes); return the step report. Never throws.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

`git add local/install.js tests/uninstall.test.mjs && git commit -m "feat(install): uninstall undoes everything it can, loudly about what it cannot"`

### Task 6: `postinstall.mjs` `local/postinstall.mjs`

**Files:**
- Create: `local/postinstall.mjs`
- Modify: `local/package.json` (`"scripts": { "prepack": "…", "postinstall": "node postinstall.mjs" }` and add to `files`)
- Test: `tests/postinstall.test.mjs`

**Interfaces:**
- Consumes: `install()` (Task 4).
- Produces: no exports; executable.

- [ ] **Step 1: Write the failing tests**

```js
test('not global install: exits 0, install not called');
test('CI=true: exits 0, install not called');
test('OPERA_AGENT_NO_INSTALL=1: exits 0, install not called');
test('global install, install resolves true: exits 0, one line printed');
test('global install, install throws: exits 0 (spawned env simulation)');
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `local/postinstall.mjs`**

```js
#!/usr/bin/env node
const isGlobal = process.env.npm_config_global === 'true' || process.env.npm_config_global_old === 'true';
if (process.env.CI === 'true' || process.env.OPERA_AGENT_NO_INSTALL === '1' || !isGlobal) process.exit(0);
try {
  const { install } = await import('./install.js');
  const report = await install({ print: () => {} });
  if (report.browsers.length) process.stdout.write(`opera-agent-mcp: extension registered in ${report.browsers.map((b) => b.id).join(', ')}. Run \`opera-agent-mcp install\` for the full report.\n`);
  else process.stdout.write('opera-agent-mcp: no Chrome/Brave/Edge found on this machine; see docs/registry-install.md for the Web Store path.\n');
} catch (error) {
  process.stdout.write('opera-agent-mcp: postinstall skipped (' + String(error?.message || error) + ')\n');
}
process.exit(0);
```

- [ ] **Step 4: Wire `postinstall` into `local/package.json` scripts + `files`**

- [ ] **Step 5: Run to verify they pass**

CI on the package does not run `npm install` of itself, so this test simulates via direct import with env manipulation and stubbed `process.exit`.

- [ ] **Step 6: Commit**

`git add local/postinstall.mjs local/package.json tests/postinstall.test.mjs && git commit -m "feat(install): postinstall registers the extension, silently and safely"`

### Task 7: Wire `install` and `uninstall` into `bin/opera-agent-mcp.js` + `local/package.json` files

**Files:**
- Modify: `local/bin/opera-agent-mcp.js`
- Modify: `local/package.json`
- Test: none (behaviour verified in Task 9)

- [ ] **Step 1: Update USAGE** to add

```
  install    detect browsers, register the extension, drop a verified CRX backup
  uninstall  remove the keys, the OperaAgent folder, the package itself; prints what it cannot remove
```

- [ ] **Step 2: Dispatch** by cloning the existing `doctor` branch shape: `install` → `import('../install.js').then(m => process.exitCode = await m.installFromCli())`; `uninstall` → same for `uninstallFromCli()`. `installFromCli`/`uninstallFromCli` are thin wrappers around `install()`/`uninstall()` that print the report and translate `report.ok` to exit codes (0 success, 1 any failure, never throws).

- [ ] **Step 3: Add the new module names to `files`** (`install.js`, `detect-browsers.js`, `registry.js`, `postinstall.mjs`).

- [ ] **Step 4: Run `npm test` + `npm run check`, expect exit 0**

- [ ] **Step 5: Commit**

`git add local/bin/opera-agent-mcp.js local/package.json && git commit -m "feat(install): install and uninstall are subcommands of the everyday command"`

### Task 8: Docs + handoff

**Files:**
- Create: `docs/install.md`
- Modify: `docs/registry-install.md` (link the command path alongside the `.reg`)
- Modify: `docs/handoff.md` (npm 1.6.46 install story + the uninstall promise + registry status)
- Modify: `README.md` (one line under the npm section: "`npx opera-agent-mcp install` registers the extension too")
- Test: none

`docs/install.md` content outline — verified measurements (Chrome 153.0.8010.36, Brave 157.1.99.56, Edge x86; isolated throwaway profiles; deletion removes the extension; Chrome sticky behaviour; the everyday profile is never edited); the command sequence (`npm i -g opera-agent-mcp`, restart browsers, `opera-agent-mcp auth`, done); uninstall (`opera-agent-mcp uninstall`, restart browsers, extension gone); the `.reg` fallback; the Windows-only honesty; the manual unpacked path for people whose policy-managed machine refuses.

- [ ] **Step 1: Write `docs/install.md`**
- [ ] **Step 2: Point `docs/registry-install.md` at it**
- [ ] **Step 3: Update handoff + README**
- [ ] **Step 4: Commit**

`git add -A && git commit -m "docs(install): the one-command path, measured and honest"`

### Task 9: Release 1.6.46

**Files:**
- Modify: `local/package.json` (1.6.45 → 1.6.46), `CHANGELOG.md`, `docs/handoff.md`, `docs/releases/1.6.46.md` (new, same shape as 1.6.45.md), `tests/...` if any pins 1.6.45 for the npm package (`tests/ci` … verify with `git grep 1.6.45`).
- Test: `npm test` / `npm run check` must stay exit 0.

- [ ] **Step 1: `git grep -n 1.6.45` → bump the npm-package references only**
- [ ] **Step 2: `docs/releases/1.6.46.md`** in the house style — install/uninstall flow, measured on this machine, no extension changes so CRX stays 1.6.44 and the manifest stays as-is.
- [ ] **Step 3: `npm test` + `npm run check`**
- [ ] **Step 4: Commit**

`git add -A && git commit -m "release: 1.6.46 - the command installs the extension, and uninstalls it"`

### Task 10: CI gate, merge, dispatch, verify on this machine

- [ ] **Step 1: push branch → watch PR #272 gates (unit, browser, secret-scan, SonarCloud)**
- [ ] **Step 2: squash-merge PR #272**
- [ ] **Step 3: dispatch `publish-npm.yml -f version=1.6.46`**
- [ ] **Step 4: In an isolated fresh profile on this machine: install via the published package path (`npm install -g` into a temp prefix), confirm the extension appears on first launch; then `opera-agent-mcp uninstall`, confirm the extension folder is gone and the registry keys are gone.**
- [ ] **Step 5: Update handoff with the outcome**
- [ ] **Step 6: cleanup worktrees (`node scripts/agent-worktree.mjs remove npm-auto-install`)**

---

## Plan self-review

- **Spec coverage:** Task 1 (probe) ✓, Task 2 (registry write/delete) ✓, Task 3 (CRX download + layout + README + x-opera-sha256 + Cr24 magic) ✓, Task 4 (install orchestrator: Windows gate, detection, keys, folders, doctor wrap-up; failures logged, never throws) ✓, Task 5 (uninstall: keys, folder, detached npm uninstall, browser-removal message) ✓, Task 6 (postinstall guards: global/CI/opt-out, never throws) ✓, Task 7 (bin wiring, files list) ✓, Task 8 (docs + handoff + README) ✓, Task 9 (release 1.6.46) ✓, Task 10 (merge, dispatch, live verify) ✓. Precision points from the spec carried: header name `x-opera-sha256`, magic bytes check, `OPERA_AGENT_NO_INSTALL`, `--keep-pair`, the Windows-only honesty, update manifest stays 1.6.44.
- **Proportion:** 10 tasks, mostly 1 file + 1 test each; Task 4 is the only orchestrator and stays thin by construction.
- **Names locked:** `probeBrowsers`, `BROWSER_CANDIDATES`, `writeExtensionKey`/`deleteExtensionKey`, `fetchVerifiedCrx`, `installCrxInto`, `install()`, `uninstall()`, `installFromCli`/`uninstallFromCli`. Exports and signatures match across Tasks 1–7.
