# Model Compiler Stage 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the owner's configured endpoint, key, and model name to the existing plan gate so the device composes a program with one model call and no key ever reaches our infrastructure.

**Architecture:** A pure compiler module (`extension/lib/model-client.js`, injected storage plus fetch) chains the existing pieces: `readModelConfig` fails closed when unconfigured, `buildPlanRequest` builds the prompt, one bounded POST goes to the owner's endpoint only, and `compileGoalPlan` validates the reply before it becomes a program. The manifest CSP gains `https:` egress because a static allowlist cannot name the owner's host; code-level single-destination enforcement (fetch is called only with the configured endpoint) plus a new CSP pin carry the guarantee instead.

**Tech Stack:** MV3 service worker (`fetch`, `AbortSignal.timeout`), Node >= 22 (`node --test`), OpenAI chat-completions request/response shape as the endpoint contract.

**Spec:** `docs/superpowers/specs/2026-10-08-execute-graph-design.md` (Stage 2 compiler; Stage 1 narrowed it to read-only programs, unchanged here)

## Global Constraints

- Extension holds generic primitives only: no per-site code and no free `eval` ever in the extension.
- Migrations are timestamp-ordered and never rewritten once applied.
- `authenticated` holds no table grant, only EXECUTE on RPCs; ownership is enforced by RLS.
- Version in `extension/manifest.json` is the source of truth (currently `1.6.20`).
- Fast suite is `npm test`; gates are `npm test` plus `npm run check`.
- Every comment block is spaced from code it does not document (hygiene gate); migrations are exempt.
- No secret, token, or private key in the tree.
- The model key is reported as present or absent, never as a value, and never handed back to any page.

## Review Focus

- The model key must never appear in logs, error payloads, persisted records, or exception messages — a reasonable person expects a failed call to say the call failed, not to echo credentials.
- An `http://` remote endpoint must be refused before any fetch — page content must never travel over plaintext off the machine.
- A non-conforming endpoint response (no `choices[0].message.content` string) must be refused as `MODEL_BAD_RESPONSE`, never parsed as a program.
- The model call must be time-bounded — a hung endpoint must surface `MODEL_TIMEOUT`, never hang the worker.
- The connection probe must send no page content and no goal — only the fixed ping payload.

---

## File structure

- Create `extension/lib/model-client.js` — pure compiler: config check, request build, bounded POST, reply parse, gate compile (Task 1).
- Create `lib/model-client.js` — one-line re-export so the Node suite reaches the same module (Task 1, same pattern as `lib/goal-plan.js`).
- Create `tests/model-client.test.mjs` — drives the real module with injected fake storage plus fetch (Task 1).
- Modify `extension/manifest.json` — `connect-src` gains `https:` (Task 2).
- Modify `tests/manifest-pins.test.mjs` — new pin file asserting the extension CSP shape (Task 2).
- Modify `docs/security.md` — one paragraph: what leaves the device (Task 3).
- Modify `extension/background.js` — one internal message action routing to the compiler (Task 4).
- Modify `extension/options.html` + `extension/options.js` — "Uji koneksi model" probe button plus status line (Task 4).
- Modify `tests/model-client.test.mjs` — probe-builder unit plus routing source pin (Task 4).
- Modify `docs/handoff.md` — Still-open item 6 records Stage 2a (Task 5).

Task 1 is the compiler and carries its tests. Task 2 is the CSP decision plus pin. Task 3 is the security paragraph that must land before the compiler activates. Task 4 is the thin trigger. Task 5 is docs plus the green gates.

---

### Task 1: Model compiler module

**Files:**
- Create: `extension/lib/model-client.js`
- Create: `lib/model-client.js`
- Create: `tests/model-client.test.mjs`

**Interfaces:**
- Consumes: `readModelConfig(storage)` from `./options-store.js` → `{configured, code, missing}` or `{configured: true, endpoint, model, key}`; `buildPlanRequest(goal, {page, methods, maxCommands})` from `./goal-plan.js`; `compileGoalPlan(rawText, {target, budgets})` from `./goal-plan.js`.
- Produces: `composeModelPlan({storage, fetchImpl}, {goal, page, target, budgets})` → `{ok: true, program}` or `{ok: false, code, message, missing?}`. Refusal codes: `MODEL_NOT_CONFIGURED` (with `missing`), `MODEL_HTTP_ERROR` (with `status`), `MODEL_BAD_RESPONSE`, `MODEL_TIMEOUT`, plus gate refusals passed through unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/model-client.test.mjs`:

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: model-client.test — Test.
// @state: locks the device-local model compiler: config gate, single destination, bounded call, key never leaks.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeModelPlan, buildProbeRequest, MODEL_TIMEOUT_MS, MODEL_MAX_TOKENS } from '../lib/model-client.js';

const storageOf = (cfg) => ({ get: async () => cfg });
const program = { root: { type: 'SEQUENCE', children: [{ type: 'COMMAND', method: 'page.find', arguments: { text: 'Skip' }, resultBinding: 'hit' }] } };
const fetchOk = (t, body = program) => {
  t.calls = [];
  return async (url, init) => {
    t.calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }) };
  };
};
const full = { modelEndpoint: 'https://llm.example.com/v1/chat/completions', modelName: 'm', modelKey: 'sk-test-key-abc123' };
const target = { deviceId: 'opera', tabId: 1 };
const budgets = { astDepth: 12, browserCommandLeavesPerRun: 12 };

test('unconfigured device never fetches', async () => {
  const t = {};
  const out = await composeModelPlan({ storage: storageOf({}), fetchImpl: fetchOk(t) }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual(t.calls, []);
});

test('http remote endpoint is refused before fetch', async () => {
  const t = {};
  const out = await composeModelPlan({ storage: storageOf({ ...full, modelEndpoint: 'http://evil.example.com/x' }), fetchImpl: fetchOk(t) }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.deepEqual(t.calls, []);
});

test('one bounded POST to the configured endpoint only, key never in body or result', async () => {
  const t = {};
  const out = await composeModelPlan({ storage: storageOf(full), fetchImpl: fetchOk(t) }, { goal: 'find skip', page: {}, target, budgets });
  assert.equal(out.ok, true);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, full.modelEndpoint);
  const sent = JSON.parse(t.calls[0].init.body);
  assert.equal(sent.model, 'm');
  assert.equal(sent.temperature, 0);
  assert.ok(!JSON.stringify(sent).includes('sk-test-key-abc123'), 'key must not be in the body');
  assert.equal(t.calls[0].init.headers.Authorization, 'Bearer sk-test-key-abc123');
  assert.ok(!JSON.stringify(out).includes('sk-test-key-abc123'), 'key must not be in the result');
});

test('non-conforming response is refused, never a program', async () => {
  const t = {};
  const bad = async (url, init) => { t.calls = [{ url }]; return { ok: true, status: 200, json: async () => ({ choices: [] }) }; };
  const out = await composeModelPlan({ storage: storageOf(full), fetchImpl: bad }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_BAD_RESPONSE');
});

test('probe carries no page content and no goal', () => {
  const probe = buildProbeRequest({ model: 'm' });
  assert.equal(probe.temperature, 0);
  assert.ok(JSON.stringify(probe).length < 300);
});

test('compiler bounds are pinned', () => {
  assert.equal(MODEL_TIMEOUT_MS, 30000);
  assert.equal(MODEL_MAX_TOKENS, 2000);
});

test('a hung endpoint surfaces MODEL_TIMEOUT, never a hang', async () => {
  const hanging = () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  const out = await composeModelPlan({ storage: storageOf(full), fetchImpl: hanging }, { goal: 'x', page: {}, target, budgets });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODEL_TIMEOUT');
});
```

Note on the key-leak assertions: they pin the body and result against a distinctive fixture key. The structural guarantee — the key is read only to set the `Authorization` header and the module has no logging import — still needs reviewer confirmation; no log line may carry it.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/model-client.test.mjs`
Expected: FAIL with "Cannot find module" (no implementation yet).

- [ ] **Step 3: Write the minimal module**

Create `extension/lib/model-client.js`:

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: model-client — device-local model compiler over the owner's endpoint.
// @state: The key travels only in the Authorization header to the configured endpoint; failures name codes, never credentials.
// @dependencies: options-store, goal-plan.

import { readModelConfig } from './options-store.js';
import { buildPlanRequest, compileGoalPlan } from './goal-plan.js';

export const MODEL_TIMEOUT_MS = 30000;
export const MODEL_MAX_TOKENS = 2000;

function endpointOk(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function buildProbeRequest({ model }) {
  return { model, messages: [{ role: 'system', content: 'Reply with exactly {}.' }, { role: 'user', content: 'ping' }], temperature: 0, max_tokens: 16 };
}

export async function composeModelPlan({ storage, fetchImpl }, { goal, page, target, budgets }) {
  const cfg = await readModelConfig(storage);
  if (!cfg.configured) return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: `Model not configured: missing ${cfg.missing.join(', ')}.`, missing: cfg.missing };
  if (!endpointOk(cfg.endpoint)) return { ok: false, code: 'MODEL_BAD_ENDPOINT', message: 'The model endpoint must be https or loopback http.' };
  const req = buildPlanRequest(goal, { page });
  if (!req.ok) return req;
  const body = { model: cfg.model, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }], temperature: 0, max_tokens: MODEL_MAX_TOKENS };
  let res;
  try {
    res = await fetchImpl(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = String(error?.name || '') === 'TimeoutError';
    return { ok: false, code: timedOut ? 'MODEL_TIMEOUT' : 'MODEL_HTTP_ERROR', message: timedOut ? 'The model call timed out.' : 'The model call failed.' };
  }
  if (!res || !res.ok) return { ok: false, code: 'MODEL_HTTP_ERROR', message: `The model endpoint answered ${res?.status ?? 'nothing'}.` };
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, code: 'MODEL_BAD_RESPONSE', message: 'The model endpoint did not answer JSON.' };
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) return { ok: false, code: 'MODEL_BAD_RESPONSE', message: 'The model endpoint answered without text.' };
  return compileGoalPlan(content, { target, budgets });
}
```

Create `lib/model-client.js` with exactly:

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: model-client — re-export so the Node suite and the extension share one compiler.
// @state: the implementation lives in the extension, where the device will run it; this file only points at it.
// @dependencies: extension/lib/model-client.

export * from '../extension/lib/model-client.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/model-client.test.mjs`
Expected: PASS all 7. Then `npm test 2>&1 | tail -n 9` — all pass.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/model-client.js lib/model-client.js tests/model-client.test.mjs
git commit -m "feat: device-local model compiler over the owner endpoint"
```

### Task 2: Extension CSP for the owner endpoint

**Files:**
- Modify: `extension/manifest.json` (`content_security_policy.extension_pages`)
- Create: `tests/manifest-pins.test.mjs`

**Interfaces:**
- Consumes: none (static policy string).
- Produces: proof the worker may reach the owner's https endpoint.

Decision (explicit, needs owner sign-off at plan review): a static allowlist cannot name the owner's host, so `connect-src` gains a blanket `https:` token. The guarantee moves to code: `fetch` is called only with the configured endpoint (pinned by Task 1's single-destination test). Loopback http stays for local models. If the owner rejects blanket `https:`, the fallback is loopback-only models and Task 1's http-remote test already covers the refusal — say so in the report instead of editing the manifest.

- [ ] **Step 1: Write the failing pin**

Create `tests/manifest-pins.test.mjs`:

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: manifest-pins.test — Test.
// @state: locks the extension CSP shape the compiler needs.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const csp = manifest.content_security_policy.extension_pages;

test('the worker may reach the owner https endpoint and loopback, Supabase stays named', () => {
  assert.match(csp, /(^| )https:( |$|;)/);
  assert.match(csp, /http:\/\/127\.0\.0\.1:\*/);
  assert.match(csp, /https:\/\/\*\.supabase\.co/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/manifest-pins.test.mjs`
Expected: FAIL on the `https:` token (not present today).

- [ ] **Step 3: Edit the manifest**

In `extension/manifest.json`, change `connect-src` to:

```
script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* https://*.supabase.co https:
```

Change nothing else in the manifest.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/manifest-pins.test.mjs` (PASS), then `npm run check` (version pin intact).

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json tests/manifest-pins.test.mjs
git commit -m "feat: extension CSP reaches the owner https endpoint"
```

### Task 3: Security paragraph — what leaves the device

**Files:**
- Modify: `docs/security.md` (append one paragraph under Token transport or a new `## Model calls` section)

**Interfaces:**
- Consumes: Task 1's structural guarantees (key only in Authorization header; endpoint https-or-loopback enforced twice: at save in `options-store.js` and at call in `model-client.js`).
- Produces: the disclosure that must exist before the compiler activates.

- [ ] **Step 1: Add the paragraph**

Append under a new `## Model calls` heading at the end of `docs/security.md`:

```md
## Model calls

One model call per task, made by the device itself to the owner's configured
endpoint. What leaves: the goal text plus the capped page observation
(`buildPlanRequest`: goal under 1200 characters, page text under 1200
characters, at most 40 elements). What never leaves the device: the model key,
which travels only in the `Authorization` header to that endpoint and never to
our server, queue, database, or logs; page content beyond the capped
observation; anything from another tab. An unconfigured device refuses with
`MODEL_NOT_CONFIGURED` before any network call. Live proof with a real key
awaits the owner and is outside this change.
```

- [ ] **Step 2: Commit**

```bash
git add docs/security.md
git commit -m "docs: what leaves the device on a model call"
```

### Task 4: Thin trigger — options probe plus background action

**Files:**
- Modify: `extension/background.js` (one internal message action)
- Modify: `extension/options.html` + `extension/options.js` (probe button plus status line)
- Modify: `tests/model-client.test.mjs` (routing source pin)

**Interfaces:**
- Consumes: `composeModelPlan` and `buildProbeRequest` from `./lib/model-client.js`; existing `chrome.runtime.onMessage` scope dispatch in `background.js`; existing options-page save patterns in `options.js`.
- Produces: an owner-clicked probe that validates endpoint plus key with zero page content.

- [ ] **Step 1: Add the background action**

In `extension/background.js`'s `chrome.runtime.onMessage` listener, beside the existing scopes, add:

```js
if (message && message.scope === 'opera-agent-options' && message.action === 'testModel') {
  Promise.resolve(async () => {
    const cfg = await readModelConfig(chrome.storage.local);
    if (!cfg.configured) return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: `Belum dikonfigurasi: ${cfg.missing.join(', ')}.` };
    const probe = buildProbeRequest({ model: cfg.model });
    const res = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ ...probe }), signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
    if (!res || !res.ok) return { ok: false, code: 'MODEL_HTTP_ERROR', message: `Endpoint menjawab ${res?.status ?? 'nothing'}.` };
    return { ok: true };
  })()
    .then((reply) => sendResponse(reply))
    .catch((error) => sendResponse({ ok: false, code: 'MODEL_HTTP_ERROR', message: String(error?.message || error).slice(0, 200) }));
  return true;
}
```

Import `readModelConfig` (already imports save functions from `./lib/options-store.js` — extend that import), `buildProbeRequest` and `MODEL_TIMEOUT_MS` from `./lib/model-client.js`. Never include `cfg.key` in any reply or log line.

- [ ] **Step 2: Add the options probe button**

In `extension/options.html`, beside the model form, add a button `id="modelProbe"` labelled `Uji koneksi model` and a status span `id="modelProbeStatus"`. In `extension/options.js`, on click: disable the button, `chrome.runtime.sendMessage({ scope: 'opera-agent-options', action: 'testModel' })`, render `Tersambung.` on ok or the returned message otherwise, re-enable. Follow the file's existing `showModelStatus` pattern.

- [ ] **Step 3: Pin the routing in the suite**

Append to `tests/model-client.test.mjs`:

```js
test('background routes the options probe action to the compiler module', async () => {
  const bg = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.ok(bg.includes(`scope === 'opera-agent-options'`));
  assert.ok(bg.includes(`action === 'testModel'`));
  assert.ok(bg.includes('buildProbeRequest'));
});
```

Add the `node:fs` import the test needs (extend `@dependencies` to `node:test, strict, node:fs`).

- [ ] **Step 4: Run and commit**

Run: `node --test tests/model-client.test.mjs` (PASS), `npm test` (all pass).
```bash
git add extension/background.js extension/options.html extension/options.js tests/model-client.test.mjs
git commit -m "feat: options probe validates the owner model connection"
```

### Task 5: Handoff line plus green gates

**Files:**
- Modify: `docs/handoff.md` (Still-open item 6 only, cap 150 lines)
- Test: `npm test`, `npm run check`

- [ ] **Step 1: Update the handoff**

Record: compiler wired device-locally over the owner endpoint (one call per task, key never leaves); CSP `https:` decision with code-level single-destination enforcement; live proof with a real key still awaits the owner. Cut a spent sentence to hold 150 lines.

- [ ] **Step 2: Run the full gates fresh**

Run: `npm test 2>&1 | tail -n 10` (all pass, 0 fail). Run: `npm run check 2>&1 | tail -n 3` (check ok, still 28 primitives — Stage 2a adds no primitive).

- [ ] **Step 3: Commit**

```bash
git add docs/handoff.md
git commit -m "docs: Stage 2a compiler wired, live proof awaits owner key"
```

---

## Self-review

- Spec coverage: compiler plus owner config is Tasks 1 and 4; security paragraph is Task 3 (lands in the same branch before any live call, satisfying the spec gate); VM-host wiring was Stage 1 (`run_program`, already shipped); endpoint/key/model sourcing is pre-existing (`options-store.js`, landing-page external config) and Task 4's probe proves it end to end short of a live key.
- Placeholder scan: every code step shows exact code, commands, and expected output; no TBD/TODO; Task 4's probe payload is fully specified (`buildProbeRequest` shape pinned in Task 1).
- Type consistency: `composeModelPlan({storage, fetchImpl}, {goal, page, target, budgets})` and `buildProbeRequest({model})` named identically in Tasks 1 and 4; refusal codes (`MODEL_NOT_CONFIGURED`, `MODEL_HTTP_ERROR`, `MODEL_BAD_RESPONSE`, `MODEL_TIMEOUT`, `MODEL_BAD_ENDPOINT`) identical everywhere used; `MODEL_MAX_TOKENS = 2000`, `MODEL_TIMEOUT_MS = 30000` fixed once in Task 1 and referenced, never redefined.
- Review Focus: key-in-logs is Task 1's fixture-key assertions plus reviewer confirmation duty; http downgrade is Task 1's refusal test; non-conforming response is Task 1's `MODEL_BAD_RESPONSE` test; unbounded wait is Task 1's `MODEL_TIMEOUT` mapping test plus the `AbortSignal.timeout(MODEL_TIMEOUT_MS)` wiring it exercises; probe leakage is Task 1's probe-content test.
