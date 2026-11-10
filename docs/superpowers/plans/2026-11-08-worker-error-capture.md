# Worker Error Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The extension catches its own service-worker faults — uncaught errors, unhandled rejections, and four named API failures — and shows them in the popup's log and in `browser_status`.

**Architecture:** `extension/worker/error-capture.js` installs two listeners on a target it is handed, so it can be tested without a worker. Faults land in a second list inside `extension/lib/agent-log.js` (20 unique, deduped), separate from the 200-entry ring the popup already renders, and `background.js` answers `browser.ping` with that list, trimmed to the result budget when it would not fit.

**Tech Stack:** MV3 service worker (classic logger + ES modules), `node:test`, MCP surface in `tools.ts`, browser harness in Python.

**Spec:** `docs/superpowers/specs/2026-11-08-worker-error-capture-design.md`

## Global Constraints

- No new MCP tool and no new parameter; `browser_status` gains `errors`, `errorCount`, and (only when trimmed) `errorsTruncated` and `omittedErrors`.
- A fault keeps its whole message: no 300-character slice, no stack.
- The fault list holds at most 20 unique entries, deduped on `code` + `message`; a repeat adds `count` and moves `lastAt`.
- Only `log.error(...)` fills the fault list; `debug` and `warn` do not.
- `CONTENT_PING_FAILED` stays `debug`: it fires on every page before the content script is injected.
- `entries()`, `clear()`, and the popup are unchanged.
- Headers: `@last-edited`, `@title`, `@state`, `@dependencies` in the first 8 lines of every touched file.
- Comments sit above a declaration, one line; no `// WHY` blocks.
- Gates: `npm test`, `npm run check`; `py tests/browser_extension_test.py` when a page's behaviour changes.
- Re-pins only through `npm run gates:refresh`, with the reason in the commit.

## Review Focus

- A worker fault repeating in a loop: the list must stay at 20 unique rows with a rising `count`, and `browser_status` must not grow.
- A fault thrown before the capture is installed: it is not captured, and the empty list must not be read as "nothing ever failed" — `errorCount` starts at 0 too.
- A page-side error (content script): it must not appear in the worker list, because the two runtimes have separate globals.
- An error message of hundreds of kilobytes: carried whole, and the answer trims with `errorsTruncated` instead of failing the tool.
- A device with no fault at all: `errors: []`, `errorCount: 0`, and no `errorsTruncated` key.

---

### Task 1: The fault list in the logger

**Files:**
- Modify: `extension/lib/agent-log.js`
- Test: `tests/agent-log-errors.test.mjs` (new)

**Interfaces:**
- Produces: `log.errors() -> [{code, message, count, firstAt, lastAt}]` newest first; `log.clearErrors()`; `log.errorCount() -> number` (never decreases).
- Unchanged: `log.entries()`, `log.clear()`, `log.debug/warn/error`, `log.configure`.

- [ ] **Step 1: Write the failing test**

```js
// tests/agent-log-errors.test.mjs
// @last-edited: 2026-11-08 UTC+7.
// @title: agent-log-errors.test — the fault list: one row per distinct fault, and a count that never lies.
// @state: the dedupe, the cap, the clear, and the ring it must not disturb.
// @dependencies: node:test, strict, ../extension/lib/agent-log.js.

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/lib/agent-log.js');
const log = globalThis.OperaAgentLog;

test('a repeated fault is one row with a count', () => {
  log.clearErrors();
  log.error('WORKER_UNCAUGHT_ERROR', 'boom');
  log.error('WORKER_UNCAUGHT_ERROR', 'boom');
  const rows = log.errors();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'WORKER_UNCAUGHT_ERROR');
  assert.equal(rows[0].message, 'boom');
  assert.equal(rows[0].count, 2);
  assert.ok(rows[0].firstAt <= rows[0].lastAt);
});

test('a different message is a different fault, newest first', () => {
  log.clearErrors();
  log.error('A', 'one');
  log.error('A', 'two');
  assert.deepEqual(log.errors().map((row) => row.message), ['two', 'one']);
});

test('the list keeps twenty unique faults and drops the oldest', () => {
  log.clearErrors();
  for (let index = 0; index < 25; index += 1) log.error('E' + index, 'm' + index);
  const rows = log.errors();
  assert.equal(rows.length, 20);
  assert.equal(rows[0].code, 'E24');
  assert.equal(rows.at(-1).code, 'E5');
});

test('debug and warn never fill the fault list, and the ring keeps every level', () => {
  log.clearErrors();
  log.clear();
  log.warn('ONLY_WARN', 'w');
  log.debug('ONLY_DEBUG', 'd');
  assert.deepEqual(log.errors(), []);
  assert.ok(log.entries().some((entry) => entry.code === 'ONLY_WARN'));
  assert.ok(log.entries().some((entry) => entry.code === 'ONLY_DEBUG'));
});

test('clearing the list keeps the total, and the total counts every fault', () => {
  log.clearErrors();
  const before = log.errorCount();
  log.error('K', 'k');
  log.error('K', 'k');
  assert.equal(log.errorCount(), before + 2);
  log.clearErrors();
  assert.deepEqual(log.errors(), []);
  assert.equal(log.errorCount(), before + 2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/agent-log-errors.test.mjs`
Expected: FAIL — `log.errors` is not a function.

- [ ] **Step 3: Implement in `extension/lib/agent-log.js`**

Keep the ring exactly as it is. Add beside it:

```js
const MAX_FAULTS = 20;
let faults = [];
let faultTotal = 0;

function recordFault(entry) {
  faultTotal += 1;
  const key = entry.code + '|' + entry.message;
  const found = faults.find((row) => row.code + '|' + row.message === key);
  if (found) {
    found.count += 1;
    found.lastAt = entry.t;
    return;
  }
  faults.unshift({ code: entry.code, message: entry.message, count: 1, firstAt: entry.t, lastAt: entry.t });
  if (faults.length > MAX_FAULTS) faults = faults.slice(0, MAX_FAULTS);
}

// `emit` calls `recordFault(entry)` when `level === 'error'`.
```

Export `errors() { return faults.map((row) => ({ ...row })); }`, `clearErrors() { faults = []; }`, `errorCount() { return faultTotal; }`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/agent-log-errors.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/agent-log.js tests/agent-log-errors.test.mjs
git commit -m "Keep the faults the logger sees: twenty rows, deduped, with a count that never resets"
```

---

### Task 2: The capture module and the four promoted failures

**Files:**
- Create: `extension/worker/error-capture.js`
- Modify: `extension/background.js` (install it; `AX_SUMMARY_COLLECTION_FAILED`, `TAB_ZOOM_PROBE_FAILED`, `USER_STATE_PROBE_FAILED` at error level)
- Modify: `extension/worker/tab-content.js` (`RESPONSE_BODY_PARSE_FAILED` at error level)
- Test: `tests/worker-error-capture.test.mjs` (new)

**Interfaces:**
- Produces: `captureWorkerErrors({ target, log }) -> { installed: true }`; codes `WORKER_UNCAUGHT_ERROR` and `WORKER_UNHANDLED_REJECTION`.
- Message order: `event.error?.message`, then `event.reason?.message`, then `String(event.message ?? event.reason ?? '')`.

- [ ] **Step 1: Write the failing test**

```js
// tests/worker-error-capture.test.mjs
// @last-edited: 2026-11-08 UTC+7.
// @title: worker-error-capture.test — the worker's own faults reach the logger, without a worker.
// @state: the two listeners, the message each carries, and the report Chrome keeps.
// @dependencies: node:test, strict, ../extension/worker/error-capture.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { captureWorkerErrors } from '../extension/worker/error-capture.js';

function harness() {
  const listeners = {};
  const calls = [];
  const target = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const log = { error: (code, message) => calls.push({ code, message }) };
  captureWorkerErrors({ target, log });
  return { listeners, calls };
}

test('both worker channels are watched', () => {
  const { listeners } = harness();
  assert.equal(typeof listeners.error, 'function');
  assert.equal(typeof listeners.unhandledrejection, 'function');
});

test('an uncaught error becomes one fault, and its message is carried whole', () => {
  const { listeners, calls } = harness();
  const message = 'x'.repeat(5000);
  listeners.error({ error: new Error(message) });
  assert.deepEqual(calls, [{ code: 'WORKER_UNCAUGHT_ERROR', message }]);
});

test('a rejection becomes one fault, with or without an Error', () => {
  const { listeners, calls } = harness();
  listeners.unhandledrejection({ reason: new Error('refused') });
  listeners.unhandledrejection({ reason: 'plain string' });
  assert.deepEqual(calls, [
    { code: 'WORKER_UNHANDLED_REJECTION', message: 'refused' },
    { code: 'WORKER_UNHANDLED_REJECTION', message: 'plain string' }
  ]);
});

test('the report Chrome makes is not cancelled', () => {
  const { listeners } = harness();
  let prevented = false;
  listeners.error({ error: new Error('boom'), preventDefault: () => { prevented = true; } });
  listeners.unhandledrejection({ reason: new Error('boom'), preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/worker-error-capture.test.mjs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `extension/worker/error-capture.js` and install it**

```js
export function captureWorkerErrors({ target, log }) {
  const messageOf = (event) => String(
    event?.error?.message ?? event?.reason?.message ?? event?.message ?? event?.reason ?? ''
  );
  target.addEventListener('error', (event) => log.error('WORKER_UNCAUGHT_ERROR', messageOf(event)));
  target.addEventListener('unhandledrejection', (event) => log.error('WORKER_UNHANDLED_REJECTION', messageOf(event)));
  return { installed: true };
}
```

In `extension/background.js`, call it once at module scope after the imports: `captureWorkerErrors({ target: self, log });`. Then raise the three named catches in that file from `log.debug`/`log.warn` to `log.error`, and in `extension/worker/tab-content.js` raise `RESPONSE_BODY_PARSE_FAILED` to `log.error`. Leave `CONTENT_PING_FAILED` where it is.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/worker-error-capture.test.mjs tests/background-load.test.mjs tests/hygiene.test.mjs`
Expected: PASS. `background-load.test.mjs` records the worker's load-time statements; add the install call there if it lists them, and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add extension/worker/error-capture.js extension/background.js extension/worker/tab-content.js \
  tests/worker-error-capture.test.mjs tests/background-load.test.mjs
git commit -m "Catch the worker's own faults, and stop hiding four of them at debug level"
```

---

### Task 3: `browser_status` carries the faults

**Files:**
- Modify: `extension/background.js` (`browser.ping`)
- Modify: `supabase/functions/opera-agent-mcp/tools.ts` (the `browser_status` description)
- Modify: `tests/mcp-surface.test.mjs`, `tests/fixtures/mcp-contract-v1.json`, `tests/helpers/boundary-locks.mjs`
- Modify: `docs/agent-call.md`, `tests/agent-call-docs.test.mjs`

**Interfaces:**
- Consumes: `log.errors()`, `log.errorCount()` (Task 1); `fitWithinBudget` from `extension/lib/serialize.js`.
- Produces: `browser.ping` answers `{..., errors, errorCount}`; when trimmed, `errorsTruncated: true` and `omittedErrors: n`.

- [ ] **Step 1: Write the failing tests**

In `tests/mcp-surface.test.mjs`, extend the existing browser_status checks: the description must contain `errors` and `errorCount`. In `tests/agent-call-docs.test.mjs`:

```js
test('the guide says where the worker faults are read', () => {
  const guide = read('docs/agent-call.md');
  assert.match(guide, /browser_status/);
  assert.match(guide, /errors/);
  assert.match(guide, /errorCount/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/mcp-surface.test.mjs tests/agent-call-docs.test.mjs`
Expected: FAIL — the description and the guide say nothing about errors.

- [ ] **Step 3: Implement**

In `extension/background.js`'s `browser.ping`, build the list and trim it to the result budget:

```js
const allErrors = log.errors();
const fitted = fitWithinBudget(allErrors, RESULT_BUDGET_BYTES);
return {
  ..., errors: fitted.elements, errorCount: log.errorCount(),
  ...(fitted.truncated ? { errorsTruncated: true, omittedErrors: allErrors.length - fitted.elements.length } : {})
};
```

`fitWithinBudget` drops from the end, and `errors()` is newest first, so the oldest rows go first — which is the order the spec asks for.

Update the `browser_status` description so it says what it returns: `... Returns: ok, paired, product, version, deviceName, capabilities, protocolVersion and time, plus bridge.lastError when the bridge has failed, and the worker's own faults as errors with errorCount.` Re-freeze the contract (`sourceSha256`, digests if moved) and the boundary pins.

Add a short paragraph to `docs/agent-call.md` under the hosted section: the worker catches its own uncaught errors and unhandled rejections, `log.error` faults live in `errors`, `errorCount` is the total since the worker started, the list holds 20 unique rows, and a trimmed answer says so.

- [ ] **Step 4: Run the suite and the gates**

Run: `node --test tests/*.test.mjs`, then `npm run check`, then `npm run gates:refresh`
Expected: PASS. Commit says which pins moved and why.

- [ ] **Step 5: Commit**

```bash
git add extension/background.js supabase/functions/opera-agent-mcp/tools.ts tests/mcp-surface.test.mjs \
  tests/fixtures/mcp-contract-v1.json tests/helpers/boundary-locks.mjs gates.lock docs/agent-call.md \
  tests/agent-call-docs.test.mjs
git commit -m "Answer browser_status with the worker's own faults, and say when they were trimmed"
```

---

### Task 4: The live check

- [ ] **Step 1:** Merge to `main` from the main checkout and reload the unpacked extension (the human's step).
- [ ] **Step 2:** Call `browser_status`; expect `errors: []` and `errorCount: 0` on a healthy worker, with `bridge.lastError` absent.
- [ ] **Step 3:** Report the numbers, and say plainly that the capture path itself is proven by the unit test, not by a deliberate crash.

---

## Self-Review

- **Spec coverage:** the two worker channels (Task 2), the four promoted codes (Task 2), the fault list and its API (Task 1), the `browser_status` fields and the trimmed answer (Task 3), the popup left alone (Task 1 keeps `entries()`), the live check (Task 4).
- **Type consistency:** `errors()` returns the rows `browser_status` sends; `errorCount()` is the number it sends; `fitWithinBudget` takes the array `errors()` returns; `captureWorkerErrors` takes the `log` object Task 1 extends.
- **Review Focus:** a loop stays at 20 rows (Task 1's cap test), a pre-install fault is honestly absent (no test fakes history), a page error cannot appear (separate globals; the spec's non-goal), an enormous message trims the answer (Task 3's `fitWithinBudget`), and the healthy device has no `errorsTruncated` key (Task 3's conditional spread).
