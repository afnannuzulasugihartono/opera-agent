# Enterprise Quality Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deno lint/check green, every silent catch logged with context, structured edge-function logs, and a Sonar verdict — with zero runtime behavior change.

**Architecture:** Ten sequential tasks on branch `chore/enterprise-standards-phase-1` (basis `4476fe9`): syntax fix first (unblocks all parsing), lint by rule, type errors with evidence-first debugging, a shared dependency-free logger following the repo's established `role-reconcile.js` R9-C pattern (no exports, `globalThis` publication, manifest + side-effect import), catch conversion preserving fallback semantics, an edge log helper in `_shared/`, a time-boxed Sonar chase, and a full-gate closeout.

**Tech Stack:** Deno 2.1.4 pinned for repro (CI version; local 2.9.6 reports 14 extra newer-rule findings that are out of scope — on any disagreement CI 2.1.4 wins), Node 22 native `node:test`, MV3 extension (module service worker, classic content scripts).

**Spec:** `docs/superpowers/specs/2026-09-30-enterprise-quality-phase2-design.md`

## Global Constraints

- Work only on branch `chore/enterprise-standards-phase-1`; never touch `main` or `feat/pre-8e-usability-repair-r8`.
- One writer per checkout: `git status --porcelain` must be empty before the first write of the session.
- `npm test` and `npm run check` stay green after every task; Deno repro uses pinned 2.1.4 (`deno upgrade --version 2.1.4` on this machine, `deno --version` must print `2.1.4` before any inventory claim).
- Never add a GitHub Actions test workflow; never write any real secret.
- Fallback semantics that existing tests pin (JSON.parse defaults, `check(..., false)`, `candidates = []`, boolean probes, thrown validation errors) are NEVER removed or weakened — only logged.
- TDD with RED/GREEN evidence; frequent commits; no session ends dirty or diverged (commit, push, record SHA in `docs/next-session-handoff.md`).
- Evidence-first repair loop for every bug (reproduce, falsifiable hypothesis, failing regression test, minimal generic fix).
- Filenames stay lowercase kebab-case; no process-lifecycle tokens in new names.

## Review Focus

- A service-worker restart wipes the logger ring buffer, so an operator must never assume log persistence across restarts: `tests/logger.test.mjs` pins that a fresh module evaluation starts with an empty buffer (Task 5 pins this test).
- Narrowing `any` to `unknown` plus a type guard can newly reject inputs the old code accepted on gateway/ledger paths: the Task 4 tests pin byte-identical accept/reject behavior on representative inputs before and after.
- Escaping the instructions string could alter the MCP instructions text served to models: the Task 1 test pins that the parsed string equals the intended text character-for-character (only the escaping changes, asserted via the fixed literal).
- A log call inside a hot content-script path (mutation observer, element scan) could spam console and churn the buffer: Task 7 pins that `debug` routes to the buffer only under the default `warn` console threshold, and the buffer never exceeds 200 entries.
- A converted catch could accidentally swallow an error the old code threw (e.g. `content.js:1605` must still throw `Invalid CSS selector.`): Task 7 pins the throw with an explicit test.

---

### Task 1: Fix mcp instructions SyntaxError + parse regression test

**Files:**
- Modify: `supabase/functions/opera-agent-mcp/index.ts:372` (escape only)
- Create: `tests/edge-syntax.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a parsing edge-function source; the test pattern reused by Task 9's gate.

- [ ] **Step 1: Reproduce with pinned Deno**

Run: `deno upgrade --version 2.1.4; deno --version`
Expected: `deno 2.1.4`.

Run: `deno check --no-lock supabase/functions/opera-agent-mcp/index.ts` from `supabase/functions/opera-agent-mcp/`
Expected: FAIL with a parse error at `372:4509` (`Expected ',', got 'a'`). Controller-verified independently via node import parse. Record the exact output — it is the RED evidence and the falsifiable hypothesis anchor (unescaped `"` inside the double-quoted instructions literal, e.g. `key "a"`).

- [ ] **Step 2: Write the failing regression test**

Create `tests/edge-syntax.test.mjs` with exactly this content (source-text scan is used because `node --check` exits 0 on broken `.ts` — the test states this reason in its comment, per the repo's frozen-contract exception rule):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Frozen contract: every edge-function entrypoint must parse under Deno.
// node --check exits 0 on broken .ts (verified 2026-09-30), so this test
// scans the string-literal structure instead of executing code.
test('mcp instructions literal has no unescaped quotes', async () => {
  const source = await readFile(new URL('../supabase/functions/opera-agent-mcp/index.ts', import.meta.url), 'utf8');
  const line = source.split('\n').find((l) => l.includes('instructions: "Use Opera Agent'));
  assert.ok(line, 'instructions literal not found');
  const first = line.indexOf('"Use Opera Agent');
  const last = line.lastIndexOf('"');
  assert.ok(last > first, 'literal has no closing quote');
  const body = line.slice(first + 1, last);
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '"' && body[i - 1] !== '\\') {
      assert.fail(`unescaped quote at offset ${i}: ...${body.slice(Math.max(0, i - 30), i + 30)}...`);
    }
  }
});
```

Run: `node --test tests/edge-syntax.test.mjs`
Expected: FAIL with `unescaped quote at offset ...`.

- [ ] **Step 3: Minimal fix — escape every interior quote**

On line 372 only, replace each unescaped `"` inside the instructions literal with `\"`. Change nothing else on the line (no rewording — the served text must stay identical).

- [ ] **Step 4: Verify GREEN three ways**

Run: `node --test tests/edge-syntax.test.mjs`
Expected: PASS.

Run from `supabase/functions/opera-agent-mcp/`: `deno check --no-lock index.ts`
Expected: exit 0 (parse fixed; type findings may remain — those are Task 4).

Run: `node --test tests/repo-naming-governance.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/opera-agent-mcp/index.ts tests/edge-syntax.test.mjs
git commit -m "fix: escape quotes in mcp instructions literal, add parse regression test

Enterprise Phase 2 Task 1. Value-preserving escape only; served text
unchanged. No other behavior change."
```

---

### Task 2: deno lint — no-explicit-any (63 instances)

**Files:**
- Modify: files under `supabase/functions/` flagged by the rule (enumerate at runtime; do not touch `extension/`, `lib/`, `tests/`, migrations)
- Test: `deno lint` itself (exit 0) + `npm test` unchanged

**Interfaces:**
- Consumes: Task 1 (source parses).
- Produces: `any`-free edge functions for Task 4's type check.

- [ ] **Step 1: Enumerate with pinned Deno**

Run from repo root: `deno lint --rules-include=no-explicit-any supabase/functions/`
Expected: 63 problems (2.1.4 count; if the count differs, record the real list — the linter is the enumerator, fix every instance it reports, no more).

- [ ] **Step 2: Fix each instance narrowly**

For each `any`: give the narrowest explicit type the surrounding code proves (parameter shapes from call sites, return shapes from usages). Where the value is genuinely unknown at the boundary, use `unknown` plus a narrowing guard following the existing `opera-agent-ledger/index.ts:178` pattern:

```ts
const failure = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
```

Rules: no `// deno-lint-ignore` comments; no `any` added anywhere; if one instance demands a redesign (not a type annotation), stop that instance, record it in the commit trailer as Fase-2-deferred with file:line, and continue with the rest. Never change runtime accept/reject behavior — a narrowing guard must accept exactly what the old code accepted.

- [ ] **Step 3: Verify**

Run: `deno lint --rules-include=no-explicit-any supabase/functions/`
Expected: `Checked N files` with no findings, exit 0.

Run: `npm test`
Expected: 588/588 PASS (edge sources are not unit-tested by node, but the run proves nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/
git commit -m "refactor: explicit types for deno no-explicit-any in edge functions

Enterprise Phase 2 Task 2. Narrowest provable types; unknown+guard at
boundaries. Deferred instances (if any): <file:line + reason>."
```

---

### Task 3: deno lint — require-await (5) + no-unused-vars (4)

**Files:**
- Modify: the exact files/lines `deno lint --rules-include=require-await,no-unused-vars supabase/functions/` reports
- Test: `deno lint` exit 0 + `npm test`

**Interfaces:**
- Consumes: Task 2 (same gate, remaining rules).
- Produces: fully lint-clean edge functions.

- [ ] **Step 1: Enumerate**

Run: `deno lint --rules-include=require-await,no-unused-vars supabase/functions/`
Expected: 5 + 4 problems (record the real list if different).

- [ ] **Step 2: Fix**

`require-await`: remove `async` where no `await` exists (if the `async` is load-bearing for the return type, keep the modifier and restructure minimally — record the case). `no-unused-vars`: delete the unused binding; if it documents intent, prefix with `_` only where the rule honors it, otherwise delete. No behavior change: verify each edited function's call sites still typecheck by eye and by Task 4's gate.

- [ ] **Step 3: Verify full lint clean**

Run: `deno lint supabase/functions/`
Expected: exit 0, no findings under pinned 2.1.4 (2.9.6-only rules like `no-import-prefix` are out of scope — do not chase them).

Run: `npm test`
Expected: 588/588 PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/
git commit -m "refactor: clear deno require-await and no-unused-vars in edge functions

Enterprise Phase 2 Task 3. No behavior change."
```

---

### Task 4: deno check type errors (5 known)

**Files:**
- Modify: `supabase/functions/opera-agent-gateway/index.ts:208`, `supabase/functions/opera-agent-ledger/index.ts:159-160`, `supabase/functions/opera-agent-vm/index.ts:506`, `supabase/functions/opera-agent-auth/index.ts` (npm:openai resolution), plus whatever `deno check` still reports after Tasks 1–3

**Interfaces:**
- Consumes: Tasks 1–3 (parses, lints).
- Produces: type-clean edge functions; gate `deno check` green for Task 10's CI proof.

- [ ] **Step 1: Reproduce each error (evidence first)**

Run from each function dir: `deno check --no-lock index.ts` for gateway, ledger, vm, auth (pinned 2.1.4). Record each exact code/line. Known expectations: gateway TS2339 at `:208` (`error?.message` on `unknown`); ledger TS2353+TS18048 at `:159-160` (`opened.ledger` shape); vm TS2345 at `:506` (`persistSlice` argument mismatch); auth `npm:openai` resolution via `edge-runtime.d.ts`.

- [ ] **Step 2: Fix minimally with regression reasoning**

Gateway `:208` — narrow `unknown` exactly like the ledger precedent (do not invent a new idiom):

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  return json({ ok: false, error: { code: "GATEWAY_ERROR", message: message.slice(0, 300) } }, 502);
}
```

Ledger `:159-160` — read `openLedgerToken`'s return type first; fix the type (or the access) whichever the signature proves wrong; falsifiable hypothesis recorded in the commit trailer. vm `:506` — read `persistSlice`'s signature first; same rule. Auth — try an import-map entry for `npm:openai` in that function's `deno.json` first; only if the map cannot satisfy the edge runtime, drop the direct `edge-runtime.d.ts` import and type the minimum surface locally (record which path won and why).

For every fix: state the hypothesis (one line) before editing. If any error resists a minimal fix (needs redesign), record it as deferred with file:line+reason and continue — but then the gate stays red and Task 10 records that honestly.

- [ ] **Step 3: Pin accept/reject behavior (Review-Focus test)**

For gateway and ledger: add cases to the existing suites if they cover these paths, else extend `tests/edge-syntax.test.mjs` is WRONG file — put them in the suites that own the paths (`tests/gateway-transactions.test.mjs` exists; ledger has its transaction suites). The tests assert representative inputs are accepted/rejected identically before and after (run them against the pre-fix tree via `git stash` if doubt exists, then unstash). Name the covering tests in the report.

- [ ] **Step 4: Verify gate green**

Run: `for d in supabase/functions/opera-agent-*/; do (cd "$d" && deno check --no-lock index.ts); done`
Expected: all exit 0 under 2.1.4.

Run: `npm test`
Expected: 588/588 PASS (or higher if Step 3 added cases).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ tests/
git commit -m "fix: resolve deno check type errors in gateway/ledger/vm/auth

Enterprise Phase 2 Task 4. Hypotheses: <one line each>. Behavior
preserved per covering tests: <names>. Deferred (if any): <file:line>."
```

---

### Task 5: Shared extension logger module + wiring + unit tests

**Files:**
- Create: `extension/lib/agent-log.js` (no import/export statements — classic-script compatible)
- Modify: `extension/manifest.json:28-34` (prepend `"lib/agent-log.js"` to content_scripts js)
- Modify: `extension/background.js:20` (side-effect import + availability assert, same R9-C pattern as `role-reconcile.js:16-21`)
- Modify: `extension/popup.js` (side-effect import + availability assert; popup is a module per `popup.html:57`)
- Create: `tests/logger.test.mjs`

**Interfaces:**
- Consumes: the R9-C `role-reconcile.js` pattern (no-exports file, manifest-first load, `globalThis` publication).
- Produces: `globalThis.OperaAgentLog` API consumed by Tasks 6–7: `configure({level})`, `log(level, code, message, fields?)`, `debug/warn/error(code, message, fields?)`, `entries()`, `clear()`; entry shape `{t, level, code, message, commandId}`; ring buffer cap 200; console output for entries at or above the configured level (default `warn`); message/code bounds matching `normalizeError` (`message.slice(0,1000)`, `code.slice(0,100)`).

- [ ] **Step 1: Write the failing tests**

Create `tests/logger.test.mjs` importing the module for side effects, then reading `globalThis.OperaAgentLog`. Cover: levels route to console only at/above threshold (stub `console.warn`/`console.error` capture, restore after); buffer records `debug` even when console threshold is `warn`; buffer never exceeds 200 entries (push 250, assert length 200 with newest retained); `commandId` field preserved; `entries()` returns a copy (mutating it does not affect the buffer); fresh module evaluation starts empty (the Review-Focus persistence test — re-import a unique query-string URL and assert empty); invalid level to `configure` throws.

Run: `node --test tests/logger.test.mjs`
Expected: FAIL (`OperaAgentLog` undefined — file does not exist yet).

- [ ] **Step 2: Implement `extension/lib/agent-log.js`**

Plain script, no `import`/`export` (must parse as classic for content scripts AND as a side-effect module import). Full content:

```js
(() => {
  'use strict';
  if (globalThis.OperaAgentLog) return;
  const MAX_ENTRIES = 200;
  const LEVELS = { debug: 10, warn: 30, error: 50 };
  const VALID = new Set(['debug', 'warn', 'error']);
  let threshold = LEVELS.warn;
  let buffer = [];
  function shape(code, message) {
    return {
      code: String(code || 'LOG').slice(0, 100),
      message: String(message ?? '').slice(0, 1000)
    };
  }
  function emit(level, code, message, fields) {
    const s = shape(code, message);
    const entry = {
      t: new Date().toISOString(),
      level,
      code: s.code,
      message: s.message,
      commandId: fields && typeof fields.commandId === 'string' ? fields.commandId : null
    };
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(buffer.length - MAX_ENTRIES);
    if (LEVELS[level] >= threshold) {
      const text = `[opera-agent:${level}] ${entry.code} ${entry.message}`;
      if (level === 'error') console.error(text);
      else if (level === 'warn') console.warn(text);
      else console.debug(text);
    }
    return entry;
  }
  globalThis.OperaAgentLog = {
    configure(options) {
      const level = options && options.level;
      if (!VALID.has(level)) throw new Error('Invalid log level.');
      threshold = LEVELS[level];
    },
    log: emit,
    debug: (code, message, fields) => emit('debug', code, message, fields),
    warn: (code, message, fields) => emit('warn', code, message, fields),
    error: (code, message, fields) => emit('error', code, message, fields),
    entries() { return buffer.slice(); },
    clear() { buffer = []; }
  };
})();
```

- [ ] **Step 3: Wire manifest + module asserts**

Prepend `"lib/agent-log.js"` to `manifest.json` content_scripts js (before `semantic-identity.js`). In `background.js` after line 20 add the R9-C-style block:

```js
// Agent log: same no-export pattern as role-reconcile.js — the manifest
// loads it first for classic content scripts; this side-effect import
// publishes it for the module service worker.
import './lib/agent-log.js';
const log = globalThis.OperaAgentLog || {};
if (typeof log.warn !== 'function') throw new Error('Agent log runtime is unavailable.');
```

Same two lines (minus the comment) in `popup.js` at top. Read `popup.js:1-15` first to place the import correctly (module file — side-effect import must precede usage; popup has no usage yet, so top is fine).

- [ ] **Step 4: Verify**

Run: `node --test tests/logger.test.mjs tests/repo-naming-governance.test.mjs`
Expected: all PASS (kebab name `agent-log.js` passes; root untouched).

Run: `npm run check`
Expected: exit 0 (new file auto-discovered and parsed).

- [ ] **Step 5: Commit**

```bash
git add extension/lib/agent-log.js extension/manifest.json extension/background.js extension/popup.js tests/logger.test.mjs
git commit -m "feat: shared extension logger with ring buffer and commandId correlation

Enterprise Phase 2 Task 5. No-export pattern (classic + module contexts).
Default console threshold warn; buffer records debug and up."
```

---

### Task 6: Convert silent catches — background, popup, protocol, semantic-identity

**Files:**
- Modify: `extension/background.js` (`:81`, `:148`, `:252`, `:272`, `:277`, `:460`, `:466`, `:573`, `:910`, `:1063` — verify list at runtime), `extension/popup.js:16`, `extension/lib/protocol.js:232`, `extension/semantic-identity.js:34`

**Interfaces:**
- Consumes: Task 5 `globalThis.OperaAgentLog` (`log` const in background/popup; protocol.js and semantic-identity.js are classic-or-module? — check their headers first: if classic-only, use `globalThis.OperaAgentLog` directly with the same availability pattern, never an import that breaks their load context).
- Produces: zero silent catches in these files; fallback semantics byte-identical.

- [ ] **Step 1: Enumerate and classify**

Run: `Select-String -Path extension/background.js,extension/popup.js,extension/lib/protocol.js,extension/semantic-identity.js -Pattern 'catch\s*\{'`
Classify each hit: (a) fallback-with-default already tested (e.g. `protocol.js:228-234` safeUrl→null, `background.js:288` atob→Infinity) → keep logic, add `log.debug`; (b) pure swallow (debugger detach/enable/disable, focus emulation, getZoom, tab probes at `:81/:148/:460/:466/:573/:910/:1063`) → add `log.warn` with the operation name and available ids. Record the classification table in the report.

- [ ] **Step 2: Convert one file at a time, running tests between files**

Example shape (background.js debugger detach):

```js
try { await chrome.debugger.detach(target); } catch (error) { log.debug('DEBUGGER_DETACH_FAILED', error?.message || String(error), { commandId: current?.commandId }); }
```

Use `debug` for idempotent-cleanup failures, `warn` for capability losses (focus emulation, zoom, tab lookup). `commandId` passed only where a command context variable is in scope — never invent one; `null` otherwise. Codes UPPER_SNAKE describing the operation. Never alter the fallback value, control flow, or thrown behavior.

- [ ] **Step 3: Verify**

Run: `node --test tests/logger.test.mjs tests/protocol.test.mjs tests/repo-naming-governance.test.mjs`
Expected: all PASS (protocol fallback tests prove semantics preserved).

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js extension/popup.js extension/lib/protocol.js extension/semantic-identity.js
git commit -m "refactor: log previously silent catches in background/popup/protocol/identity

Enterprise Phase 2 Task 6. Fallback semantics unchanged; debug for
cleanup, warn for capability loss. Classification table in report."
```

---

### Task 7: Convert silent catches — content.js (15 sites)

**Files:**
- Modify: `extension/content.js` (`:160`, `:182`, `:609`, `:923`, `:1049`, `:1117`, `:1120`, `:1322`, `:1605`, `:1685`, `:1691`, `:1699`, `:1797` — verify list at runtime; content.js is a classic IIFE, use `globalThis.OperaAgentLog` directly, never an import)

**Interfaces:**
- Consumes: Task 5 logger (manifest-loaded before content.js).
- Produces: zero silent catches in content.js; Review-Focus pins hold.

- [ ] **Step 1: Enumerate and classify (same sieve as Task 6)**

Tested fallbacks that MUST keep exact behavior: `:609` querySelectorAll→return, `:1049` URL→continue, `:1117/:1120` check(...,false), `:1322` JSON→[], `:1691` text→'', `:1699` selector→false. Thrown validation that MUST still throw: `:1605` `Invalid CSS selector.` Add `log.debug` to fallbacks, `log.warn` to pure swallows (`:160`, `:182`, `:923`, `:1685`, `:1797`). No `commandId` in content scope (no command context — pass nothing; `null` default applies).

- [ ] **Step 2: Convert, preserving every branch**

Apply the same call shape as Task 6. Double-check `:1605` still throws (its `throw` stays outside any suppression) and `:1117/:1120` still call `check` with `false`.

- [ ] **Step 3: Pin the Review-Focus behaviors**

Extend `tests/logger.test.mjs` is the WRONG file (unit scope) — instead prove via existing suites plus two targeted assertions: run the content-adjacent suites (`node --test tests/protocol.test.mjs tests/workflow-dsl.test.mjs` at minimum) AND add to `tests/logger.test.mjs` a hot-path test: 300 rapid `debug` calls leave buffer at exactly 200 with newest retained and zero console output under default threshold (Review-Focus spam pin). Add a static assertion test that `content.js` source still contains `throw new Error('Invalid CSS selector.')` with a frozen-contract reason comment (Review-Focus swallow pin).

Run: `node --test tests/logger.test.mjs tests/protocol.test.mjs tests/workflow-dsl.test.mjs tests/repo-naming-governance.test.mjs`
Expected: all PASS.

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add extension/content.js tests/logger.test.mjs
git commit -m "refactor: log previously silent catches in content script

Enterprise Phase 2 Task 7. Fallbacks and thrown validation preserved;
hot-path buffer bound pinned by test."
```

---

### Task 8: Edge log helper + convert 3 call sites

**Files:**
- Create: `supabase/functions/_shared/edge-log.js` (match siblings' ESM style; zero imports)
- Modify: `supabase/functions/opera-agent-bridge/index.ts:192`, `supabase/functions/opera-agent-runner/index.ts:566`, `supabase/functions/opera-agent-mcp/index.ts:722` (read each site first — replace only the ad-hoc `console.error(..., slice(0,500))` shape)
- Create: `tests/deno/edge-log.test.ts` (run bare: `deno test tests/deno/edge-log.test.ts`, following the `docs/milestone-8-checkpoint-8d-host-candidate.md:101` precedent of direct deno test invocation)

**Interfaces:**
- Consumes: Tasks 1–4 (hosts parse, lint, typecheck).
- Produces: `createEdgeLog({ commandId?, requestId? })` returning `{ debug, warn, error }` with explicit truncation bound constant; import path matches the existing relative style of the consuming function (verify against a current `../_shared/` import in that file before writing yours).

- [ ] **Step 1: Write the failing Deno test**

Create `tests/deno/edge-log.test.ts` importing `../../supabase/functions/_shared/edge-log.js` (two levels up from `tests/deno/`). Cases: levels format `{t, level, code, message, commandId}`; overlong message truncated at the helper's bound (assert exact bound constant, not magic); `commandId`/`requestId` carried; no throw on circular/undefined payloads.

Run: `deno test tests/deno/edge-log.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement the helper**

Zero imports, ESM exports, same plain-const style as `_shared/goal-ledger.js`:

```js
const MAX_LOG_MESSAGE = 1000;
export function createEdgeLog(context) {
  const commandId = context && typeof context.commandId === 'string' ? context.commandId : null;
  const requestId = context && typeof context.requestId === 'string' ? context.requestId : null;
  function emit(level, code, message) {
    const record = {
      t: new Date().toISOString(),
      level,
      code: String(code || 'LOG').slice(0, 100),
      message: String(message ?? '').slice(0, MAX_LOG_MESSAGE),
      commandId,
      requestId
    };
    if (level === 'error') console.error(JSON.stringify(record));
    else if (level === 'warn') console.warn(JSON.stringify(record));
    else console.debug(JSON.stringify(record));
    return record;
  }
  return {
    debug: (code, message) => emit('debug', code, message),
    warn: (code, message) => emit('warn', code, message),
    error: (code, message) => emit('error', code, message)
  };
}
```

- [ ] **Step 3: Convert the 3 call sites, payloads unchanged**

Read each site; replace only the logging expression with the helper at matching level, same message content, `commandId`/`requestId` from the enclosing scope where present (never invent). Then:

Run: `deno test tests/deno/edge-log.test.ts`
Expected: PASS.

Run from each touched function dir: `deno check --no-lock index.ts` (pinned 2.1.4)
Expected: exit 0 (the new import must resolve — fix the relative path, never the gate).

Run: `deno lint supabase/functions/_shared/edge-log.js`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/edge-log.js supabase/functions/opera-agent-bridge/index.ts supabase/functions/opera-agent-runner/index.ts supabase/functions/opera-agent-mcp/index.ts tests/deno/edge-log.test.ts
git commit -m "refactor: structured edge log helper, convert 3 ad-hoc sites

Enterprise Phase 2 Task 8. Same messages/levels; explicit truncation
bound; payloads unchanged."
```

---

### Task 9: Sonar chase (time-boxed, read-only unless access lands)

**Files:** none unless access yields actionable findings (then the smallest behavior-preserving config change only — never a guessed code fix).

**Interfaces:**
- Consumes: Task 8 evidence (deno-green state proves local hygiene; remaining Sonar delta is the target).
- Produces: a Sonar verdict — green, or `BLOCKED: needs SonarCloud project access` with the attempt trail.

- [ ] **Step 1: Re-read the failing condition**

Run: `gh api "repos/afnannuzulasugihartono/opera-agent/commits/<current-head>/check-runs"` (raw JSON + `ConvertFrom-Json` — the `--jq` filter breaks under PowerShell quoting, proven Task 8). Extract the Sonar run: name, conclusion, details_url, output summary. Baseline expectation from Fase 1: `C Reliability Rating on New Code (required ≥ A)`.

- [ ] **Step 2: Follow the details URL (time box: 30 minutes)**

Try anonymous project APIs for `afnannuzulasugihartono_opera-agent`. If per-issue data appears, list top violations by file:line:rule. If 404/empty (Task 8 outcome), record the exact probes and stop — do not guess, do not touch code to satisfy an unseen gate.

- [ ] **Step 3: Record (no commit)**

Write verdict + evidence to the SDD report file. If access landed AND findings map onto already-fixed Fase 2 debt (e.g. the mcp:372 syntax error), say so explicitly — that is a diagnosis, and the fix already shipped in Task 1.

---

### Task 10: Final gate, push, closeout

**Files:**
- Modify: `docs/next-session-handoff.md`, `docs/project-context.md` (append Fase 2 entries)

**Interfaces:**
- Consumes: Tasks 1–9 evidence.
- Produces: clean pushed branch; merge readiness statement (merge stays an explicit owner decision; `main` takes the head only with full CI green).

- [ ] **Step 1: Full gates**

Run: `npm test`
Expected: 588/588 or higher PASS.

Run: `npm run check`
Expected: exit 0.

Run once: `py tests/browser_extension_test.py`
Expected: exit 0 (single-failure-on-unchanged-runtime = suspected flake: one headed rerun max with evidence, then halt-and-record).

- [ ] **Step 2: Push + BOTH CI signals on the exact head**

```bash
git push origin chore/enterprise-standards-phase-1
$sha = git rev-parse HEAD
```

Read check-runs AND status for `$sha` (raw JSON + `ConvertFrom-Json`). Expected: everything `success` INCLUDING the deno gate (Tasks 1–4 greened it) — this is the merge-readiness proof. If any gate is red, do not close: fix forward in a new commit (never amend pushed) or record the honest blocker and halt.

- [ ] **Step 3: Handoff + context + final commit**

Append Fase 2 entry to `docs/next-session-handoff.md` (final SHA, per-task SHAs, CI conclusions both signals, Sonar verdict, deno-green proof) and a 3-line entry to `docs/project-context.md`. Verify `git status --porcelain` shows only the two docs, commit, push, confirm `...origin/chore/enterprise-standards-phase-1` with no ahead/behind.

```bash
git add docs/next-session-handoff.md docs/project-context.md
git commit -m "docs: Fase 2 closeout — <final-sha>, CI conclusions, Sonar verdict inside"
```

Use an honest subject line reflecting the real state (replace the placeholder above with the actual outcome, e.g. `docs: Fase 2 closeout — <sha>, CI green, Sonar <verdict>`).
