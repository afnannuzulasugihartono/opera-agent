# Enterprise UI & Docs Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Options page, operator runbook, drift-proof API docs, and a single endpoint source per deploy unit with zero behavior breakage.

**Architecture:** Six sequential tasks on branch `chore/enterprise-ui-docs-phase5` (basis `0f0335e`): frozen endpoint constants with equality locks, a dependency-injected options store plus thin DOM page, narrative API docs pinned to the live spec object, a reviewer-read runbook plus permissions rationale, and a full-gate closeout.

**Tech Stack:** MV3 extension (module popup/options, classic-safe lib where needed), Node 22 native `node:test`, Deno 2.9.6 for edge verification.

**Spec:** `docs/superpowers/specs/2026-10-02-enterprise-ui-docs-phase5-design.md`

## Global Constraints

- Work only on branch `chore/enterprise-ui-docs-phase5`; never touch `main` or other tracks.
- One writer per checkout: `git status --porcelain` must be empty before the first write of the session.
- `npm test` (615/615+) and `npm run check` stay green after every task; Deno via `C:\Users\ASUS\AppData\Local\Temp\opencode\deno296\deno.exe` (pinned 2.9.6) only.
- No MCP contract/protocol/SQL change; no release/promotion; popup stays `en`, consent stays `id`; no external docs links; no device rename anywhere.
- Frozen-digest moves get reason comments in the same commit (precedent); full suite green before every commit.
- Never write any real secret; TDD with RED/GREEN evidence; frequent commits; no session ends dirty or diverged.

## Review Focus

- The Options page must never display deviceToken, pairing codes, or passwords — neither fields nor values: Task 3 pins an absence test on `options.html` + `options.js` source.
- An invalid bridge URL must be rejected and empty must reset to default (never stored as garbage): Task 2 pins both behaviors.
- A corrupt/invalid stored log level must leave the threshold unchanged without throwing out of `getConfig`: Task 3 pins this test.
- Every endpoint path in `docs/api.md` must exist in the gateway `openApiSpec` source, or the suite fails: Task 4 pins this test.
- The consent `configEndpoint` literal must equal the endpoints constant (separate deploys cannot share the module): Task 1 pins this equality test; `manifest.json update_url` stays static as the documented exception.

---

### Task 1: Single endpoint source + equality locks

**Files:**
- Create: `extension/lib/endpoints.js`
- Modify: `extension/background.js:25` (literal → import), `supabase/functions/opera-agent-update/index.ts:81` (derive from `SUPABASE_URL`)
- Create: `tests/endpoint-source.test.mjs`

**Interfaces:**
- Consumes: mcp `publicBaseUrl` idiom (`SUPABASE_URL.replace(/\/$/, "")` + path) for the update derivation.
- Produces: `SUPABASE_PROJECT_REF`, `DEFAULT_BRIDGE_URL`, `UPDATE_BASE_URL`, `CONSENT_CONFIG_URL` consumed by Task 3 (options defaults) and locked by tests here.

- [ ] **Step 1: Create the constants module (failing test first)**

Create `tests/endpoint-source.test.mjs` FIRST:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONSENT_CONFIG_URL, DEFAULT_BRIDGE_URL, SUPABASE_PROJECT_REF } from '../extension/lib/endpoints.js';

test('extension background has exactly one endpoint source', async () => {
  const bg = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(bg, /from '\.\/lib\/endpoints\.js'/);
  assert.equal((bg.match(/supabase\.co\/functions\/v1/g) || []).length, 0);
});

test('consent config endpoint equals the shared constant (separate deploys)', async () => {
  const html = await readFile(new URL('../oauth-consent/index.html', import.meta.url), 'utf8');
  const m = html.match(/const configEndpoint = '([^']+)'/);
  assert.ok(m, 'configEndpoint literal not found');
  assert.equal(m[1], CONSENT_CONFIG_URL);
});

test('update function derives base from SUPABASE_URL, no literal ref', async () => {
  const src = await readFile(new URL('../supabase/functions/opera-agent-update/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /nenmkmtvjremqphfqnfw/);
});
```

(This is a deliberate source-form lock with reason: one literal per deploy unit. Background currently holds the literal and update holds its own, so all three tests FAIL now — record the three failures as RED evidence.)

Run: `node --test tests/endpoint-source.test.mjs`
Expected: FAIL (module missing + literals present).

- [ ] **Step 2: Implement `extension/lib/endpoints.js`**

ESM exports (module-only consumers: background, node tests — content scripts do not need it):

```js
// Single source of deployment endpoint truth for the extension deploy
// unit. oauth-consent/ deploys separately and keeps its own literal,
// locked equal by tests/endpoint-source.test.mjs. manifest.json
// update_url is static by platform rule (documented exception), as are
// applied migrations (never rewritten), release.yml, and historical docs.
export const SUPABASE_PROJECT_REF = 'nenmkmtvjremqphfqnfw';
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const DEFAULT_BRIDGE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-bridge`;
export const UPDATE_BASE_URL = `${SUPABASE_URL}/functions/v1/opera-agent-update`;
export const CONSENT_CONFIG_URL = `${SUPABASE_URL}/functions/v1/opera-agent-auth/config`;
```

In `extension/background.js`: replace line 25 literal with `import { DEFAULT_BRIDGE_URL } from './lib/endpoints.js';` + `const DEFAULT_BRIDGE_URL_LOCAL = DEFAULT_BRIDGE_URL;`? No — simpler: delete line 25, add the import beside the other lib imports (after line 15), and replace usages `DEFAULT_BRIDGE_URL` (same identifier — zero usage-site churn; verify with grep that no other literal remains).

In `supabase/functions/opera-agent-update/index.ts:81`: replace with `` const base = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/opera-agent-update`; `` (mcp `publicBaseUrl` idiom).

- [ ] **Step 3: Verify**

Run: `node --test tests/endpoint-source.test.mjs tests/repo-naming-governance.test.mjs`
Expected: PASS.

Run: `deno check --no-lock index.ts` from `supabase/functions/opera-agent-update/` (pinned 2.9.6)
Expected: exit 0.

Run FULL `npm test`
Expected: green; digest moves (background.js blob, mcp untouched here) re-frozen with reason comments in the same commit (precedent).

Run: `npm run check`
Expected: exit 0 (new lib file auto-discovered).

- [ ] **Step 4: Commit**

```bash
git add extension/lib/endpoints.js extension/background.js supabase/functions/opera-agent-update/index.ts tests/endpoint-source.test.mjs
```

Plus any refrozen test files (same commit). Commit message:

```bash
git commit -m "refactor: single endpoint source per deploy unit

Enterprise Phase 5 Task 1. Extension imports constants; consent
locked equal; update derives from env. Digests re-frozen with reason."
```

---

### Task 2: Options store module (DI-tested logic)

**Files:**
- Create: `extension/lib/options-store.js`
- Create: `tests/options-store.test.mjs`

**Interfaces:**
- Consumes: logger level names (`debug`/`warn`/`error`), storage keys (`bridgeUrl`, `logLevel`), `DEFAULT_BRIDGE_URL` from Task 1.
- Produces: `loadOptions(storage)`, `saveBridgeUrl(storage, value)`, `saveLogLevel(storage, value)` consumed by Task 3's page wiring.

- [ ] **Step 1: Failing tests**

Create `tests/options-store.test.mjs` (fake storage object `{ data: {}, get(), set() }` — no chrome API):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOptions, saveBridgeUrl, saveLogLevel } from '../extension/lib/options-store.js';

const fake = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    async get(keys) { const out = {}; for (const k of keys) out[k] = data[k]; return out; },
    async set(patch) { Object.assign(data, patch); }
  };
};

test('loadOptions returns defaults for empty storage', async () => {
  const loaded = await loadOptions(fake());
  assert.match(loaded.bridgeUrl, /^https:\/\//);
  assert.equal(loaded.logLevel, 'warn');
});

test('saveBridgeUrl rejects non-https, empty resets to default', async () => {
  const s = fake();
  await assert.rejects(saveBridgeUrl(s, 'http://evil.example/hook'), /https/);
  await assert.rejects(saveBridgeUrl(s, 'not a url'), /https/);
  await saveBridgeUrl(s, '');
  assert.match(s.data.bridgeUrl, /^https:\/\//);
  await saveBridgeUrl(s, 'https://my-bridge.example/hook');
  assert.equal(s.data.bridgeUrl, 'https://my-bridge.example/hook');
});

test('saveLogLevel accepts only the three levels', async () => {
  const s = fake();
  await saveLogLevel(s, 'debug');
  assert.equal(s.data.logLevel, 'debug');
  await assert.rejects(saveLogLevel(s, 'verbose'), /level/i);
  await assert.rejects(saveLogLevel(s, ''), /level/i);
});

test('stored values round-trip verbatim', async () => {
  const s = fake({ bridgeUrl: 'https://x.example/', logLevel: 'error' });
  const loaded = await loadOptions(s);
  assert.equal(loaded.bridgeUrl, 'https://x.example/');
  assert.equal(loaded.logLevel, 'error');
});
```

Run: `node --test tests/options-store.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `extension/lib/options-store.js`**

Dependency-injected storage (diagnostics-helper precedent — no chrome import, works in node tests and classic contexts):

```js
import { DEFAULT_BRIDGE_URL } from './endpoints.js';

const LEVELS = ['debug', 'warn', 'error'];
const DEFAULT_LEVEL = 'warn';

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function loadOptions(storage) {
  const cfg = await storage.get(['bridgeUrl', 'logLevel']);
  const bridgeUrl = typeof cfg.bridgeUrl === 'string' && cfg.bridgeUrl ? cfg.bridgeUrl : DEFAULT_BRIDGE_URL;
  const logLevel = LEVELS.includes(cfg.logLevel) ? cfg.logLevel : DEFAULT_LEVEL;
  return { bridgeUrl, logLevel };
}

export async function saveBridgeUrl(storage, value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    await storage.set({ bridgeUrl: DEFAULT_BRIDGE_URL });
    return DEFAULT_BRIDGE_URL;
  }
  if (!isHttpUrl(trimmed)) throw new Error('Enter an https:// URL or leave empty to reset.');
  await storage.set({ bridgeUrl: trimmed });
  return trimmed;
}

export async function saveLogLevel(storage, value) {
  if (!LEVELS.includes(value)) throw new Error('Log level must be debug, warn, or error.');
  await storage.set({ logLevel: value });
  return value;
}
```

Note: `import` is fine here — consumers are the module options page and node tests (content scripts never load this file).

- [ ] **Step 3: Verify**

Run: `node --test tests/options-store.test.mjs tests/repo-naming-governance.test.mjs`
Expected: PASS.

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add extension/lib/options-store.js tests/options-store.test.mjs
git commit -m "feat: options store with validation and defaults

Enterprise Phase 5 Task 2. DI-tested; https-only URLs; empty
resets; three log levels."
```

---

### Task 3: Options page + background log-level wiring

**Files:**
- Create: `extension/options.html`, `extension/options.js`
- Modify: `extension/manifest.json` (add `"options_page": "options.html"`)
- Modify: `extension/background.js` (log-level application in `getConfig` + `onChanged`)
- Test: Task 2 suites (logic) + new absence test below + full suite

**Interfaces:**
- Consumes: Task 2 store + Task 1 endpoints + `userErrorMessage` (Fase 4) + logger `configure`.
- Produces: the only UI surface for settings; background honors `logLevel`.

- [ ] **Step 1: Page + wiring**

`extension/options.html`: form with `bridgeUrl` text input + reset semantics (empty = default), `logLevel` select (debug/warn/error), version line (`<span id="version">`), troubleshooting list (5 bullets: install, pairing, bridge override, log level, self-test pointer), save-status line. NO password/token/code fields anywhere.

`extension/options.js` (module): import store fns, endpoints default, `userErrorMessage`, `PROTOCOL_VERSION` from `./lib/protocol.js`; wire load/save on DOMContentLoaded; display `chrome.runtime.getManifest().version` + protocol; map save errors through `userErrorMessage`.

`extension/manifest.json`: add `"options_page": "options.html"` beside the `action` block.

`extension/background.js`: (a) add `'logLevel'` to the storage read in `getConfig` (return it alongside, default `'warn'`); (b) after building cfg, apply `try { globalThis.OperaAgentLog?.configure?.({ level: ['debug','warn','error'].includes(cfg.logLevel) ? cfg.logLevel : 'warn' }); } catch {}` — invalid stored values fall back silently to the current threshold, never throw out; (c) extend the `onChanged` condition at `:1682` with `|| changes.logLevel` (restart path re-reads and applies immediately).

- [ ] **Step 2: Absence + fallback tests**

Append to `tests/options-store.test.mjs` is the WRONG file (unit scope) — create `tests/options-page.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('options page never references secrets', async () => {
  const html = await readFile(new URL('../extension/options.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../extension/options.js', import.meta.url), 'utf8');
  for (const [name, src] of [['options.html', html], ['options.js', js]]) {
    assert.doesNotMatch(src, /deviceToken|pairCode|password|apiKey|ghp_/i, name);
    assert.doesNotMatch(src, /type\s*=\s*["']password["']/i, name);
  }
});

test('options page is registered in the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.options_page, 'options.html');
});
```

(This is a deliberate source-form lock with reason: settings must never grow secret fields unnoticed.)

Run: `node --test tests/options-page.test.mjs tests/options-store.test.mjs tests/repo-naming-governance.test.mjs`
Expected: PASS.

Run FULL `npm test`
Expected: green; background.js + manifest.json digest moves re-frozen with reason (precedent).

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 3: Manual pass checklist (record results in report)**

Load unpacked extension in Chromium/Opera, open Options from `chrome://extensions`, verify: fields prefill from storage; invalid URL rejected with mapped message; empty resets to default bridge; level select persists and `chrome.storage.local` shows `logLevel`; version line shows `1.6.13 · Protocol 1`-equivalent. Record pass/fail per item — any fail is a fix loop, not a waiver.

- [ ] **Step 4: Commit**

```bash
git add extension/options.html extension/options.js extension/manifest.json extension/background.js tests/options-page.test.mjs
```

Plus refrozen files (same commit). Message:

```bash
git commit -m "feat: options page with bridge URL and log level settings

Enterprise Phase 5 Task 3. Storage-backed; secrets never shown;
log level applied via getConfig with safe fallback."
```

---

### Task 4: Narrative API docs with drift pin

**Files:**
- Create: `docs/api.md`
- Create: `tests/api-docs.test.mjs`

**Interfaces:**
- Consumes: gateway `openApiSpec` source (`/command` POST; routes for `/openapi.json`, `/health`).
- Produces: the operator-facing API reference; drift pin.

- [ ] **Step 1: Write `docs/api.md`**

Sections: base URLs (project functions root + gateway path), auth (header-first `x-opera-agent-token`/`Authorization: Bearer`, `body.apiKey` for GPT Actions with platform-limitation note, query confined to read-only), endpoint table (`POST /command`, `GET /openapi.json`, `GET /health` with purpose + auth requirement each), error-code table (UNAUTHORIZED, INVALID_METHOD, INVALID_JSON, METHOD_NOT_ALLOWED, TOO_LARGE, NOT_FOUND, DEVICE_NOT_PAIRED, AWAIT_TIMEOUT, GATEWAY_ERROR — verify each exists in gateway source before writing; drop any not found), two curl examples (tabs.list via header; openapi.json), pointer: machine source of truth is live `GET /openapi.json`.
> **SUPERSEDED PHRASE — "query confined to read-only" is FALSE, and this brief
> caused the error.** The controller supplied it as a verified fact without
> checking whether any route reads the query string; none does. A task review
> caught it; `docs/api.md`, `SECURITY.md` and the gateway's own header comment were
> corrected, and `tests/api-docs.test.mjs` now pins both halves — the gateway reads
> no query-string token, and the document says so. Preserved unedited as the plan
> record.

- [ ] **Step 2: Drift pin test**

Create `tests/api-docs.test.mjs` (frozen-contract idiom with reason comment):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Frozen contract: docs/api.md must name exactly the served endpoints.
// The live machine source of truth is GET /openapi.json; this test pins
// the doc against the gateway source so drift fails loudly.
test('api.md documents every served endpoint', async () => {
  const gateway = await readFile(new URL('../supabase/functions/opera-agent-gateway/index.ts', import.meta.url), 'utf8');
  const doc = await readFile(new URL('../docs/api.md', import.meta.url), 'utf8');
  for (const path of ['/command', '/openapi.json', '/health']) {
    assert.ok(gateway.includes(`"${path}"`) || gateway.includes(`'${path}'`) || gateway.includes(path), `gateway serves ${path}`);
    assert.ok(doc.includes(`\`${path}\``), `docs/api.md documents ${path}`);
  }
});
```

(Verify the gateway source assertions match reality first — adjust the match form to what the source actually contains, e.g. `endsWith("/health")` style; the test must pass on the CURRENT tree before the doc is even read.)

Run: `node --test tests/api-docs.test.mjs`
Expected: PASS (doc written to match).

- [ ] **Step 3: Commit**

```bash
git add docs/api.md tests/api-docs.test.mjs
git commit -m "docs: gateway API reference with drift pin test

Enterprise Phase 5 Task 4. Live /openapi.json stays machine truth;
test fails on doc/spec drift."
```

---

### Task 5: Runbook + extension README rationale

**Files:**
- Create: `docs/runbook.md`
- Modify: `extension/README.md` (append permissions rationale)

**Interfaces:**
- Consumes: install/pairing/smoke flows (`docs/install.md:45-61`), error codes (gateway), troubleshooting bullets (Task 3 options page — mirror the same five).
- Produces: operator runbook; review-ready permissions doc.

- [ ] **Step 1: Write `docs/runbook.md`**

Sections: (1) Incidents — bridge unreachable (symptoms → `getConfig`/bridgeUrl checks → `opera_run('browser.ping',...)` smoke → escalate), pairing code rejected (clock/code reuse/pairing-state checks), update stuck on legacy channel (update.xml `?id=` diagnostic per install.md:21, identity check), MCP 401s (token scope/allowlist checks). Each incident: symptoms, exact diagnostic commands, when to escalate. (2) Proposed SLOs, marked owner-adjustable: pairing success ≥99%/7d, command p95 ≤30s (matches 55000ms ceiling family), update propagation ≤24h, with how each is measured. (3) Data-retention table: commands history, telemetry events, pairing-code hashes, edge logs — retention per class + purge mechanism (or `manual-supabase-sql` where no automation exists — state honestly). (4) Accessibility appendix: popup semantics as shipped (aria-live badge/status, labelled inputs, keyboard-operable buttons, no pointer-only flows).

- [ ] **Step 2: Extend `extension/README.md`**

Append a `## Permissions rationale (for review)` section mapping each manifest entry to its need: `debugger` (trusted CDP input), `tabs`+`activeTab` (tab targeting), `scripting` (content injection), `storage` (pairing/config), `alarms` (wake/heartbeat), `<all_urls>` + host permissions (content scripts run on user pages by design; data stays local per SECURITY.md). No other changes to the file.

- [ ] **Step 3: Reviewer-read bar + commit**

Self-check: a fresh operator follows ONE incident end-to-end using only the runbook (implementer walks it mentally against the repo and notes gaps fixed inline). Then:

```bash
git add docs/runbook.md extension/README.md
git commit -m "docs: operator runbook plus extension permissions rationale

Enterprise Phase 5 Task 5. Proposed SLOs marked adjustable; retention
stated honestly including manual steps."
```

---

### Task 6: Final gate, push, closeout

**Files:**
- Modify: `docs/next-session-handoff.md`, `docs/project-context.md`

**Interfaces:**
- Consumes: Tasks 1–5 evidence.
- Produces: clean pushed branch; merge readiness (merge stays explicit owner decision).

- [ ] **Step 1: Full gates**

`npm test` (615/615+), `npm run check` ok, `py tests/browser_extension_test.py` once (flake policy: one headed rerun max, then halt-and-record). Deno 2.9.6: `deno lint` + per-function `deno check --no-lock` green.

- [ ] **Step 2: Push + per-workflow CI signals**

`git push origin chore/enterprise-ui-docs-phase5`, read check-runs AND status for the head SHA (raw JSON + `ConvertFrom-Json`). Expected: every workflow green. Any red: fix forward (never amend pushed) or record honest blocker and halt.

- [ ] **Step 3: Handoff + context + final commit**

Append Fase 5 entries, verify only the two docs dirty, commit with honest subject, push, confirm in-sync.
