# Enterprise Security Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden auth transport, CORS, and error surfaces to enterprise review standard with zero breakage for existing clients.

**Architecture:** Seven sequential tasks on branch `chore/enterprise-security-phase4` (basis `6e0f349`): a shared dependency-free CORS origin resolver consumed by three edge functions, token-hygiene proofs (behavioral where a harness exists, static where it does not), a popup error mapper with safe fallback, env-first publishable defaults in two scripts, a verify-first hygiene sweep, and a full-gate closeout.

**Tech Stack:** Deno 2.9.6 (CI-pinned), Node 22 native `node:test`, MV3 extension (module popup, classic-safe shared code where needed).

**Spec:** `docs/superpowers/specs/2026-10-02-enterprise-security-phase4-design.md`

## Global Constraints

- Work only on branch `chore/enterprise-security-phase4`; never touch `main` or other tracks.
- One writer per checkout: `git status --porcelain` must be empty before the first write of the session.
- `npm test` (599/599+) and `npm run check` stay green after every task; Deno 2.9.6 for edge verification (no shared-state mutation: never `deno upgrade`, never delete the machine-local v5 root lockfile).
- `body.apiKey` transport STAYS (GPT Actions cannot set custom headers — removing it breaks an advertised integration locked by `tests/etw-watch-engine.test.mjs:123`).
- Never weaken a test assertion type; frozen-digest moves get reason comments in the same commit (established precedent).
- Never write any real secret; English messages in popup (matches `popup.html` lang), Indonesian in consent page (matches its lang) — controller ruling, no language switcher in scope.
- TDD with RED/GREEN evidence; frequent commits; no session ends dirty or diverged.

## Review Focus

- CORS origin check must be EXACT match — `https://oauth-consent-three.vercel.app.evil.com` must be rejected while the exact consent origin passes: Task 1 pins this test.
- Server-to-server/curl calls send no Origin header and must keep working (no ACAO header, request proceeds): Task 1 pins this test.
- Unknown, garbage, and token-shaped error inputs must all render the generic message, never raw text: Task 4 pins these tests.
- New `_shared/cors.js` import must use the existing relative style per consuming function (edge-log precedent): Task 2 pins resolution via `deno check`.
- Publishable fallback must keep the identical literal default so unset-env behavior is byte-identical: Task 5 pins this via existing runner suites plus PS parse.

---

### Task 1: Shared CORS resolver + unit tests

**Files:**
- Create: `supabase/functions/_shared/cors.js`
- Create: `tests/edge-cors.test.mjs`

**Interfaces:**
- Consumes: nothing (standalone, zero imports).
- Produces: `resolveAllowedOrigin(req, defaults)` and `CORS_DEFAULT_ORIGINS` consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `tests/edge-cors.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORS_DEFAULT_ORIGINS, resolveAllowedOrigin } from '../supabase/functions/_shared/cors.js';

const req = (origin) => ({ headers: { get: (name) => (name.toLowerCase() === 'origin' ? origin : null) } });

test('default origins are exactly the extension and consent page', () => {
  assert.deepEqual(CORS_DEFAULT_ORIGINS, [
    'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
    'https://oauth-consent-three.vercel.app'
  ]);
});

test('exact allowlisted origin is echoed', () => {
  assert.equal(resolveAllowedOrigin(req('chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick')), 'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick');
});

test('lookalike evil origin is rejected', () => {
  assert.equal(resolveAllowedOrigin(req('https://oauth-consent-three.vercel.app.evil.com')), null);
  assert.equal(resolveAllowedOrigin(req('https://evil.com')), null);
});

test('missing origin proceeds without ACAO header value', () => {
  assert.equal(resolveAllowedOrigin(req(null)), null);
  assert.equal(resolveAllowedOrigin(req('')), null);
});

test('env list overrides defaults', () => {
  process.env.CORS_ALLOWED_ORIGINS = 'https://a.example, https://b.example ';
  assert.equal(resolveAllowedOrigin(req('https://b.example')), 'https://b.example');
  assert.equal(resolveAllowedOrigin(req('chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick')), null);
  delete process.env.CORS_ALLOWED_ORIGINS;
});
```

Run: `node --test tests/edge-cors.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `supabase/functions/_shared/cors.js`**

Zero imports, ESM exports, plain-const style (matches `_shared/goal-ledger.js`):

```js
const FALLBACK_ORIGINS = Object.freeze([
  'chrome-extension://ohbbpamcljckmjhcpkcmefdobkoeaick',
  'https://oauth-consent-three.vercel.app'
]);

export const CORS_DEFAULT_ORIGINS = FALLBACK_ORIGINS;

export function resolveAllowedOrigin(req, defaults) {
  const list = Array.isArray(defaults) && defaults.length > 0 ? defaults : FALLBACK_ORIGINS;
  const raw = typeof Deno !== 'undefined' && Deno.env
    ? Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
    : (typeof process !== 'undefined' && process.env ? process.env.CORS_ALLOWED_ORIGINS || '' : '');
  const configured = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(configured.length > 0 ? configured : list);
  const origin = req && req.headers && typeof req.headers.get === 'function'
    ? String(req.headers.get('origin') || '')
    : '';
  if (!origin) return null;
  return allowed.has(origin) ? origin : null;
}
```

Note the Deno/process dual-env read: Deno edge runtime has no `process`, node tests have no `Deno` — the guards keep both green. `typeof Deno !== 'undefined'` is lint-safe (no-undef does not flag typeof guards).

- [ ] **Step 3: Verify**

Run: `node --test tests/edge-cors.test.mjs`
Expected: PASS (5/5).

Run: `deno lint supabase/functions/_shared/cors.js` (pinned 2.9.6boys, prefix `$env:DENO_NO_PACKAGE_JSON=1` only if the machine-local v5 lockfile interferes)
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/cors.js tests/edge-cors.test.mjs
git commit -m "feat: shared CORS origin resolver with fail-closed defaults

Enterprise Phase 4 Task 1. Exact-match only; env override;
no-Origin requests proceed headerless."
```

---

### Task 2: Wire CORS into gateway/mcp/update + .env.example

**Files:**
- Modify: `supabase/functions/opera-agent-gateway/index.ts:16-21` (CORS const), `:43-48` (extractToken untouched), plus preflight/OPTIONS path if present (verify at runtime)
- Modify: `supabase/functions/opera-agent-mcp/index.ts:28-34` (corsHeaders)
- Modify: `supabase/functions/opera-agent-update/index.ts:13-22` (response() headers)
- Modify: `.env.example` (append `CORS_ALLOWED_ORIGINS`)
- Test: existing suites + `npm test` full (mcp/index.ts edit moves frozen digests → re-freeze with reason, precedent)

**Interfaces:**
- Consumes: Task 1 `resolveAllowedOrigin`, `CORS_DEFAULT_ORIGINS` (import `../_shared/cors.js`, edge-log relative-import precedent).
- Produces: fail-closed CORS on three functions.

- [ ] **Step 1: Prove current wildcard (RED evidence)**

Run: `Select-String -Path supabase/functions/opera-agent-gateway/index.ts,supabase/functions/opera-agent-mcp/index.ts,supabase/functions/opera-agent-update/index.ts -Pattern 'Access-Control-Allow-Origin.: .\*'`
Expected: 3 matches (the wildcard to kill).

- [ ] **Step 2: Wire each function (same shape, adapted to local headers)**

Gateway (`:16-21`): replace the static CORS object usage so the response headers set `Access-Control-Allow-Origin` ONLY to `resolveAllowedOrigin(req) ?? <no header>`. Concretely: build headers per request — keep `Allow-Headers`, `Allow-Methods`, `Cache-Control` exactly; set the origin header only when the resolver returns non-null. `extractToken` and the 401/405/413 bodies stay byte-identical.

MCP (`:28-34`): same treatment for `corsHeaders` (it is a module const — convert to a per-request builder or spread-override at response sites, whichever touches fewer lines; the preflight/OPTIONS branch must keep working).

Update (`response()` at `:13-22`): `response()` has no `req` — change its signature to accept the request (or the resolved origin) and set ACAO only when allowed; update all call sites in the file (count them first with grep).

`.env.example`: append with documentation comment:

```text
# CORS allowlist for edge functions (comma-separated). Empty = fail-closed
# defaults (this extension + the OAuth consent page).
CORS_ALLOWED_ORIGINS=
```

- [ ] **Step 3: Verify**

Run: `deno lint` on the three files + `deno check --no-lock index.ts` from each function dir (pinned 2.9.6)
Expected: exit 0 (import must resolve — fix the relative path, never the gate).

Run FULL `npm test`
Expected: green; mcp digest moves are re-frozen with reason comments in the same commit (precedent: recompute via repo helpers, never hand-write).

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ .env.example tests/
git commit -m "fix: fail-closed CORS allowlist on gateway/mcp/update

Enterprise Phase 4 Task 2. Env-driven, exact-match, defaults cover
this extension + consent page. Digests re-frozen with reason."
```

---

### Task 3: Token-hygiene proofs + SECURITY.md risk note

**Files:**
- Modify: `tests/gateway-transactions.test.mjs` (add cases to the existing harness)
- Create: `tests/edge-token-hygiene.test.mjs` (static source assertions)
- Modify: `SECURITY.md` (append platform-limitation paragraph)

**Interfaces:**
- Consumes: gateway harness (`h.request` with `{apiKey}` + header forms, per existing lines 45/72/103).
- Produces: proof that tokens never echo or log.

- [ ] **Step 1: Behavioral cases in the gateway harness**

Add tests (read the harness top of `gateway-transactions.test.mjs:1-60` first for exact call shape):

```js
test('gateway 401 responses never echo the submitted token', async () => {
  const marker = 'TEST-TOKEN-UNIQUE-12345';
  const r1 = await h.request({ apiKey: marker, method: 'tabs.list' });
  assert.equal(r1.status, 401);
  assert.doesNotMatch(JSON.stringify(r1.body), /TEST-TOKEN-UNIQUE-12345/);
  const r2 = await h.request({ method: 'tabs.list' }, { authorization: 'Bearer ' + marker });
  assert.equal(r2.status, 401);
  assert.doesNotMatch(JSON.stringify(r2.body), /TEST-TOKEN-UNIQUE-12345/);
});
```

Adjust to the harness's actual response shape (read first — `r.status`/`r.body` names must match the file's convention; the snippet above follows lines 45/72/103 usage).

- [ ] **Step 2: Static no-log-token test**

Create `tests/edge-token-hygiene.test.mjs`: read the four function sources as text; assert NO `console.(error|warn|log|debug)` call in them references identifiers `token`, `apiKey`, `authorization`, `body`, `headers`, `req` (edge-log helper calls with literal `code`/`message` consts pass because they name neither). Assert gateway/mcp 401/405 bodies contain no `Bearer` echo. Use `assert.doesNotMatch` per file with a frozen-contract reason comment (this is a deliberate source-form lock: tokens must never flow into logs).

Run: `node --test tests/gateway-transactions.test.mjs tests/edge-token-hygiene.test.mjs`
Expected: PASS.

- [ ] **Step 3: SECURITY.md paragraph**

Append under Reporting (or a new `## Token transport` section):

```markdown
## Token transport

The gateway accepts device tokens via header (`x-opera-agent-token`,
`Authorization: Bearer`) or `body.apiKey` because GPT Actions cannot
set custom headers (platform limitation, not a choice). Query tokens
are confined to the read-only `/openapi.json` and `/health` surfaces.
> **SUPERSEDED PHRASE — corrected during Fase 5 execution.** No gateway route
> reads the query string, so `?apiKey=` is not a token carrier on any route; the
> sentence above is preserved as part of the plan record. The three real carriers
> are the two headers and `body.apiKey`.
Tokens are verified then dropped: regression tests pin that they never
appear in logs, error payloads, or persisted records.
```

- [ ] **Step 4: Commit**

```bash
git add tests/gateway-transactions.test.mjs tests/edge-token-hygiene.test.mjs SECURITY.md
git commit -m "test: token-hygiene proofs plus documented transport risk

Enterprise Phase 4 Task 3. Behavioral 401 cases plus static
no-log-token locks; body.apiKey retained for GPT Actions."
```

---

### Task 4: Popup + consent error mapping (no raw internals)

**Files:**
- Create: `extension/lib/error-messages.js` (ESM export; popup-only import — popup is a module)
- Modify: `extension/popup.js:60,74,111` (route through mapper; `self-test` JSON output at `:95` stays — explicit diagnostics)
- Modify: `oauth-consent/index.html:73,86,95` (Indonesian actionable equivalents; read the three sites first)
- Create: `tests/error-messages.test.mjs`

**Interfaces:**
- Consumes: nothing new (reads background-supplied strings).
- Produces: `userErrorMessage(value)` mapping; consent strings.

- [ ] **Step 1: Enumerate mappable errors**

Run: `Select-String -Path extension/background.js -Pattern 'lastError|setState\(\{[^}]*error|error: ' | Select-Object -First 20` plus read `popup.js:36-58` for the `call()` helper shape. List the KNOWN error strings the popup can receive (pairing failures, toggle failures, status errors). Record the table in the report.

- [ ] **Step 2: Mapper + tests**

Create `extension/lib/error-messages.js`:

```js
const KNOWN = new Map([
  ['Pairing failed.', 'Pairing failed. Check the code and try again.'],
  ['Unable to update tab privacy.', 'Could not update this tab. Try reloading the page.'],
]);

const GENERIC = 'Something went wrong. Run self-test, then check the connection.';

export function userErrorMessage(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (KNOWN.has(text)) return KNOWN.get(text);
  return GENERIC;
}
```

Extend KNOWN with every string found in Step 1 (exact source strings as keys, actionable English as values — popup page lang is `en`). Create `tests/error-messages.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { userErrorMessage } from '../extension/lib/error-messages.js';

test('known errors map to actionable messages', () => {
  assert.equal(userErrorMessage('Pairing failed.'), 'Pairing failed. Check the code and try again.');
});

test('unknown, garbage, and token-shaped inputs fall back to generic', () => {
  assert.equal(userErrorMessage('Error: connect ECONNREFUSED 127.0.0.1'), 'Something went wrong. Run self-test, then check the connection.');
  assert.equal(userErrorMessage('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), 'Something went wrong. Run self-test, then check the connection.');
  assert.equal(userErrorMessage(null), 'Something went wrong. Run self-test, then check the connection.');
});
```

Wire `popup.js:60,74,111` to `userErrorMessage(...)`. Consent page: replace the three Supabase-English error strings with Indonesian actionable equivalents in place (read the sites first; no new infra).

Run: `node --test tests/error-messages.test.mjs tests/repo-naming-governance.test.mjs`
Expected: PASS.

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add extension/lib/error-messages.js extension/popup.js oauth-consent/index.html tests/error-messages.test.mjs
git commit -m "fix: mapped user-facing errors, no raw internals in popup/consent

Enterprise Phase 4 Task 4. Unknown/token-shaped inputs fall back to
generic; self-test diagnostics unchanged."
```

---

### Task 5: Publishable defaults env-first (2 scripts)

**Files:**
- Modify: `scripts/run-8d-acceptance.ps1:10`, `scripts/run-8d-edge-concurrency.ps1:11`

**Interfaces:**
- Consumes: Task 6 (Fase 1) env-fallback pattern precedent.
- Produces: rotatable publishable defaults, identical unset behavior.

- [ ] **Step 1: Prove current literals + no literal assertions**

Run: `Select-String -Path scripts/run-8d-acceptance.ps1,scripts/run-8d-edge-concurrency.ps1 -Pattern 'PublishableKey = '`
Expected: the two `sb_publishable_...` literals (pre-change evidence).

Run: `Select-String -Path tests/ -Pattern '\$PublishableKey = .sb_publishable'`
Expected: no matches (no test pins the literal — only the `sb_publishable_` SHAPE pattern in synthetic fixtures, which stays valid).

- [ ] **Step 2: Env-first fallback (ASCII only)**

```powershell
$PublishableKey = if ($env:OPERA_AGENT_PUBLISHABLE_KEY) { $env:OPERA_AGENT_PUBLISHABLE_KEY } else { 'sb_publishable_jAbS_QIQsmXQA-Rj8RWPcg_JVeBedJ6' }
```

Keep the identical literal as fallback. Touch nothing else in either file.

- [ ] **Step 3: Verify**

PowerShell parse check (Parser::ParseFile pattern from Fase 2 Task 6 — copy the exact command shape from `docs/superpowers/plans/2026-09-30-enterprise-quality-phase2.md` Task 6 Step 3).
Expected: `PS_PARSE_OK`.

Run: `node --test tests/transaction-edge-concurrency-runner-8d.test.mjs tests/transaction-worker-loss-runner-8d.test.mjs tests/repo-naming-governance.test.mjs`
Expected: PASS. Then FULL `npm test` green before commit.

- [ ] **Step 4: Commit**

```bash
git add scripts/run-8d-acceptance.ps1 scripts/run-8d-edge-concurrency.ps1
git commit -m "chore: publishable key defaults read env first

Enterprise Phase 4 Task 5. Identical literal fallback; enables
rotation without breakage."
```

---

### Task 6: Hygiene sweep (verify-first, micro-fixes only)

**Files:** none unless the sweep finds safe items (then the minimal set).

**Interfaces:**
- Consumes: repo state on the track branch.
- Produces: a recorded verdict — fixed list or "nothing safe found".

- [ ] **Step 1: Sweep (read-only)**

Run and record: `git status --porcelain -uall` (untracked droppings); list `.kilo/`, `.repowise/`, `.spec-kit-venv/`, `.opera-agent-8d-state/`, `.vercel`, `coverage/`, `dist/`, `build/` presence on disk vs tracked (`git ls-files` must NOT contain them); `Select-String` for `TODO|FIXME|XXX|HACK` in runtime dirs (`extension/`, `lib/`, `supabase/functions/`, `scripts/` — docs/templates excluded as known false positives); empty tracked dirs.

- [ ] **Step 2: Fix ONLY safe items**

Safe = untracked-dropping removal (listed by name) + `.gitignore` additions for observed-but-unignored local noise. NEVER: evidence/history deletion, fixture edits, threshold changes, renames. If nothing qualifies, record "sweep clean, no action" — a no-change task whose deliverable is the recorded verdict (Fase 1 Task 8 precedent).

- [ ] **Step 3: Verify + commit-or-record**

If fixes: `npm test` focused (naming governance minimum) + full before commit; micro-commit with per-item reasons. If none: no commit, verdict to the SDD report.

---

### Task 7: Final gate, push, closeout

**Files:**
- Modify: `docs/next-session-handoff.md`, `docs/project-context.md`

**Interfaces:**
- Consumes: Tasks 1–6 evidence.
- Produces: clean pushed branch; merge readiness (merge stays explicit owner decision).

- [ ] **Step 1: Full gates**

`npm test` (599/599+), `npm run check` ok, `py tests/browser_extension_test.py` once (flake policy: one headed rerun max, then halt-and-record). Deno 2.9.6: `deno lint` + per-function `deno check --no-lock` green (prefix `$env:DENO_NO_PACKAGE_JSON=1` only if the machine-local v5 lockfile interferes).

- [ ] **Step 2: Push + per-workflow CI signals**

`git push origin chore/enterprise-security-phase4`, then read check-runs AND status for the head SHA (raw JSON + `ConvertFrom-Json`). Expected: every workflow green (`ci-unit/secrets/audit/deno-install/lint/check/sbom/browser`) — per-gate visibility from Fase 3. Any red: fix forward (never amend pushed) or record honest blocker and halt.

- [ ] **Step 3: Handoff + context + final commit**

Append Fase 4 entries, verify only the two docs dirty, commit with honest subject, push, confirm in-sync.
