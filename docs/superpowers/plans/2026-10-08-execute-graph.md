# Execute(graph) Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing plan compiler to the existing VM host so a compiled program runs without the model in the loop.

**Architecture:** No new graph system. `extension/lib/goal-plan.js` already compiles model text to `OA_REACTIVE_VM_V1` programs; `supabase/functions/opera-agent-vm/index.ts` already enqueues, resumes, and reports on those programs tenant-scoped. The missing piece is the caller-facing path: an MCP tool that hands a compiled program to the VM host. Stage 1 builds and pins that path with hand-written programs only.

**Tech Stack:** Node >= 22 (`node --test`), Deno edge functions, Supabase Postgres / PLpgSQL, MV3 extension (untouched in Stage 1).

**Spec:** `docs/superpowers/specs/2026-10-08-execute-graph-design.md`

## Global Constraints

- Extension holds generic primitives only: no per-site code and no free `eval` ever in the extension.
- Migrations are timestamp-ordered and never rewritten once applied.
- `authenticated` holds no table grant, only EXECUTE on RPCs; ownership is enforced by RLS.
- Version in `extension/manifest.json` is the source of truth (currently `1.6.20`).
- Fast suite is `npm test`; gates are `npm test` plus `npm run check`.
- Every comment block is spaced from code it does not document (hygiene gate); migrations are exempt.
- No secret, token, or private key in the tree.

## Review Focus

- A program whose `tenantId` differs from the caller must be refused with `CROSS_TENANT`, never executed.
- A program over the frozen byte budget must be refused with `OVER_LIMIT`, never truncated.
- A `COMMAND` node naming a non-allowlisted method must be refused by the gate before enqueue.
- Resuming a run after the page document changed generation must not act on stale refs.
- Resuming or reading an expired or foreign-tenant run must fail closed, never leak its evidence.

---

## File structure

- Create `tests/vm-program-intake.test.mjs` — pins the VM-true joint: sealed, `children`, read-only (Task 1b; Task 1 BLOCKED and superseded).
- Modify `supabase/functions/opera-agent-mcp/index.ts` — add one `run_program` tool beside `run_workflow`, sealing gate output to VM-true shape (Task 2).
- Modify `tests/mcp-surface.test.mjs` — extend `FROZEN_MCP_TOOLS` and the schema-hash map for the new tool (Task 2).
- Create `tests/vm-program-rpc.test.mjs` — pins EXECUTE-only grants plus owner RLS on program-run RPCs (Task 3).
- Create `tests/vm-program-status.test.mjs` — pins honest partial status on the VM host source (Task 4).
- Modify `docs/handoff.md` — close Still-open item 6 within the 150-line cap (Task 5).
- Modify `extension/lib/goal-plan.js` plus `tests/goal-plan-request.test.mjs` — prompt teaches `children` (Task 6).

Task 1b produces a passing pin with no production change. Task 2 is the main production-code task, Task 6 a small one. Tasks 3 and 4 are pin tests over existing sources. Task 5 is docs plus the green gates.

---

### Task 1: Pin the compiler-to-VM joint — BLOCKED, superseded by T1b

Task 1's probe proved a 4-layer joint mismatch (report: `.superpowers/sdd/task-1-report.md`):
gate emits no `programDigest`, passes partial budgets, passes `steps` through, and
allowists write methods the read-only collect VM refuses. Ruling in the ledger:
Stage 1 narrows to VM-true read-only programs. T1b below replaces this task's
test with the VM-true pin. No commit was made for Task 1.

### Task 1b: Pin the VM-true joint (test-only, no production change)

**Files:**
- Modify: `tests/vm-program-intake.test.mjs` (untracked file Task 1 left behind)
- Modify: none other

**Interfaces:**
- Consumes: `compileGoalPlan` from `../extension/lib/goal-plan.js`,
  `validateCollectProgram` from `../lib/reactive-vm-collect.js`,
  `canonicalJson`/`digestCanonical` from `../lib/goal-ledger.js`,
  the 17 required budget keys from `validateBudgets` in `lib/reactive-vm.js:179-189`.
- Produces: proof that a sealed, VM-true, gate-approved program is accepted unchanged.

- [ ] **Step 1: Rewrite the test to VM-true shape**

Replace the contents of `tests/vm-program-intake.test.mjs` with:

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: vm-program-intake.test — Test.
// @state: locks that a sealed VM-true program passes the VM validator unchanged.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGoalPlan } from '../extension/lib/goal-plan.js';
import { validateCollectProgram } from '../lib/reactive-vm-collect.js';
import { canonicalJson, digestCanonical } from '../lib/goal-ledger.js';

const reply = JSON.stringify({
  root: {
    type: 'SEQUENCE',
    children: [
      { type: 'COMMAND', method: 'page.find', arguments: { text: 'Skip' }, resultBinding: 'hit' },
      { type: 'COMMAND', method: 'page.read', arguments: {}, resultBinding: 'text' }
    ]
  }
});

function fullBudgets() {
  return {
    astDepth: 12, browserCommandLeavesPerRun: 12, runDeadlineMs: 60000,
    serializedProgramBytes: 4096, programBytes: 8192
  };
}

test('a sealed VM-true program passes the VM validator unchanged', async () => {
  const target = { deviceId: 'opera', tabId: 1 };
  const compiled = compileGoalPlan(reply, { target, budgets: fullBudgets() });
  assert.equal(compiled.ok, true, JSON.stringify(compiled).slice(0, 300));
  const program = { ...compiled.program, tenantId: 'caller', budgets: fullBudgets() };
  program.programDigest = await digestCanonical(canonicalJson(program));
  const accepted = await validateCollectProgram(program);
  assert.ok(accepted, 'VM validator must accept sealed VM-true programs as-is');
});

test('a non-allowlisted method never reaches the VM validator', () => {
  const bad = JSON.stringify({ root: { type: 'COMMAND', method: 'page.evil', arguments: {} } });
  const refused = compileGoalPlan(bad, { target: { deviceId: 'opera', tabId: 1 }, budgets: {} });
  assert.equal(refused.ok, false);
  assert.match(refused.code, /METHOD_NOT_ALLOWED/);
});
```

Rules for this rewrite: read `lib/reactive-vm.js:179-189` first and use the exact 17 budget keys the validator requires (the five above are placeholders for the real key set — copy each key name verbatim from source). Read `lib/goal-ledger.js` first and use its real export names for canonical JSON plus digest (if the names differ, use the real ones and note the rename in the report). Keep `children` (never `steps`) and read-only methods only.

- [ ] **Step 2: Run to verify it passes**

Run: `node --test tests/vm-program-intake.test.mjs`
Expected: PASS, both tests. Any FAIL is a real gap in the assumed producer contract — stop and report BLOCKED with the exact error.

- [ ] **Step 3: Run the full suite to verify the tree is green again**

Run: `npm test 2>&1 | tail -n 9`
Expected: all pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add tests/vm-program-intake.test.mjs
git commit -m "test: pin sealed VM-true programs pass the VM validator"
```

*Old Task 1 body removed — superseded by T1b above.*

### Task 2: Add the `run_program` MCP tool

**Files:**
- Modify: `supabase/functions/opera-agent-mcp/index.ts` (add tool right after the `run_workflow` registration, ~line 576)
- Modify: `tests/mcp-surface.test.mjs` (`FROZEN_MCP_TOOLS`, `FROZEN_TOOL_SCHEMAS`)
- Test: run `node --test tests/mcp-surface.test.mjs`

**Interfaces:**
- Consumes: existing `rpc`, `execute`, `toolError` helpers and `deviceName` / `provider` stamping in the MCP server; the VM host `enqueue` operation at `.../functions/v1/opera-agent-vm`; the sealing contract pinned by T1b (VM-true shape: `children`, read-only methods, full 17-key budgets, `programDigest` over canonical JSON, `tenantId` = caller).
- Produces: tool `run_program` taking `{ program, requestId }`, returning `{ runId, status }`. The tool seals gate output to VM-true shape before enqueue and refuses anything it cannot seal — it never widens the VM.

- [ ] **Step 1: Write the failing pin update**

Add `'run_program'` to `FROZEN_MCP_TOOLS` in `tests/mcp-surface.test.mjs` (alphabetical slot: after `'run_browser_burst'`, before `'run_workflow'`).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/mcp-surface.test.mjs`
Expected: FAIL naming `run_program` as unregistered.

- [ ] **Step 3: Register the tool**

Insert after the `run_workflow` registration in `supabase/functions/opera-agent-mcp/index.ts`:

```ts
server.registerTool("run_program", {
  title: "Run Opera Agent program",
  description: "Run a gate-approved OA_REACTIVE_VM_V1 read-only program end to end on the paired Opera device without the model in the loop: the VM host enqueues it, the device executes read/verify commands, and verification evidence returns in status/result. Use this for ad-hoc multi-step read intents instead of hand-driving each find. Write actions are refused here; they run as registered workflows via run_workflow.",
  inputSchema: {
    program: z.object({}).passthrough()
      .describe("A compileGoalPlan-approved program object (schemaVersion OA_REACTIVE_VM_V1) with children (never steps) and read-only methods. The tool fills full budgets, sets tenantId to the caller, and seals programDigest before enqueue; anything unsealable is refused."),
    requestId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]{1,100}$/)
      .describe("Idempotency key; a malformed key is rejected so replay protection is never silent here."),
  },
}, async ({ program, requestId }: { program: Record<string, unknown>; requestId: string }) =>
  callVmHost("enqueue", { program, requestId }, deviceName, provider).then(vmRunResult).catch(toolError));
```

Wire `callVmHost` and `vmRunResult` by copying the `execute` helper pattern in the same file: POST JSON to the `opera-agent-vm` function URL, stamp `X-Opera-Device` with `deviceName` and the provider header exactly as `execute` does, return the parsed envelope on HTTP 200, throw `toolError` otherwise. No new header names, no query-string token.

- [ ] **Step 4: Run to verify it passes, then fix the schema hash**

Run: `node --test tests/mcp-surface.test.mjs`
Expected: FAIL on the `FROZEN_TOOL_SCHEMAS` hash for `run_program` only. Copy the actual hash from the failure output into the map as `run_program: '<actual>'`. Re-run until PASS. If any other tool's hash changed, stop — the tool registration touched a shared schema; report it.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/opera-agent-mcp/index.ts tests/mcp-surface.test.mjs
git commit -m "feat: run_program hands a compiled program to the VM host"
```

### Task 3: Pin EXECUTE-only plus owner RLS on program-run RPCs

**Files:**
- Create: `tests/vm-program-rpc.test.mjs`
- Modify: none expected (`opera_vm_enqueue`, `opera_vm_get`, `opera_vm_cancel` already exist; this task proves they follow the repo's grant pattern)

**Interfaces:**
- Consumes: migration files matching `supabase/migrations/*vm*.sql`.
- Produces: proof that program-run RPCs grant EXECUTE only and filter by ownership.

- [ ] **Step 1: List the VM migrations**

Run: `ls supabase/migrations/ | grep -i vm`
Expected: the migration filenames that create `opera_vm_enqueue`, `opera_vm_get`, `opera_vm_cancel`, and the runs table plus its RLS policies.

- [ ] **Step 2: Write the failing test**

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: vm-program-rpc.test — Test.
// @state: locks EXECUTE-only grants plus owner RLS on program-run RPCs.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = new URL('../supabase/migrations/', import.meta.url);
const body = fs.readdirSync(dir)
  .filter((n) => /vm/i.test(n))
  .map((n) => fs.readFileSync(path.join(dir.pathname, n), 'utf8'))
  .join('\n');

test('program-run RPCs grant EXECUTE only, never table grants', () => {
  for (const fn of ['opera_vm_enqueue', 'opera_vm_get', 'opera_vm_cancel']) {
    assert.ok(body.includes(fn), `${fn} must exist`);
  }
  assert.doesNotMatch(body, /grant\s+(select|insert|update|delete)\s+on\s+public\.opera_vm/i);
});

test('program runs are filtered by owning tenant', () => {
  assert.match(body, /p_tenant_id/);
  assert.match(body, /row level security|create policy/i);
});
```

- [ ] **Step 3: Run to verify**

Run: `node --test tests/vm-program-rpc.test.mjs`
Expected: PASS if the existing migrations follow the pattern, FAIL naming the exact missing grant or policy — in which case stop and report; the fix is a new migration (timestamp-ordered, never a rewrite), not an edit.

- [ ] **Step 4: Commit**

```bash
git add tests/vm-program-rpc.test.mjs
git commit -m "test: pin EXECUTE-only plus owner RLS on program-run RPCs"
```

### Task 4: Pin honest partial status

**Files:**
- Create: `tests/vm-program-status.test.mjs`
- Modify: none expected

**Interfaces:**
- Consumes: `supabase/functions/opera-agent-vm/index.ts` source text.
- Produces: proof that terminal states and per-run evidence survive to the caller.

- [ ] **Step 1: Write the failing test**

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: vm-program-status.test — Test.
// @state: locks honest partial status on the VM host.
// @dependencies: node:test, strict, node:fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const vm = fs.readFileSync(
  new URL('../supabase/functions/opera-agent-vm/index.ts', import.meta.url), 'utf8'
);

test('terminal states distinguish success, limits, and failure', () => {
  for (const state of ['SUSPENDED', 'RETURNED', 'LIMIT_REACHED', 'FAILED', 'CANCELLED', 'EXPIRED']) {
    assert.ok(vm.includes(`"${state}"`), state);
  }
});

test('status and result operations stay tenant-scoped', () => {
  assert.ok(vm.includes('p_tenant_id'), 'every run lookup carries the tenant');
  assert.match(vm, /operation === "status"/);
  assert.match(vm, /operation === "result"/);
});

test('over-budget programs and stale documents fail closed', () => {
  assert.ok(vm.includes('OVER_LIMIT'), 'byte budget refusal exists');
  assert.ok(vm.includes('observedGeneration !== program.target.documentGeneration'), 'stale generation never acts');
});
```

- [ ] **Step 2: Run to verify**

Run: `node --test tests/vm-program-status.test.mjs`
Expected: PASS (these operations exist today). Any FAIL names a real gap against the spec's honest-status requirement — stop and report it.

- [ ] **Step 3: Commit**

```bash
git add tests/vm-program-status.test.mjs
git commit -m "test: pin honest partial status on the VM host"
```

### Task 5: Close the handoff item and green the gates

**Files:**
- Modify: `docs/handoff.md` (Still-open item 6 only, cap 150 lines)
- Test: `npm test`, `npm run check`

**Interfaces:**
- Consumes: all prior tasks green.
- Produces: a clean tree with the plan-path gap recorded as closed for Stage 1.

- [ ] **Step 1: Update the handoff**

Replace Still-open item 6's closing sentence with: the caller-facing path exists (`run_program` to VM `enqueue`); remaining Stage 2 is owner model config plus the `security.md` paragraph before any live model call. Keep the file at or under 150 lines — cut a spent sentence elsewhere if needed.

- [ ] **Step 2: Run the full gates fresh**

Run: `npm test 2>&1 | tail -n 10`
Expected: `pass <all>`, `fail 0`.
Run: `npm run check 2>&1 | tail -n 3`
Expected: `check ok: 28 allowlisted browser primitives, ...` (no new primitive was added in Stage 1).

- [ ] **Step 3: Commit**

```bash
git add docs/handoff.md
git commit -m "docs: plan-path caller gap closed for Stage 1"
```

### Task 6: Align the prompt and gate on `children`

**Files:**
- Modify: `extension/lib/goal-plan.js` (`buildPlanRequest` system prompt)
- Modify: `tests/goal-plan-request.test.mjs` (prompt pins)
- Test: `node --test tests/goal-plan-request.test.mjs tests/goal-plan.test.mjs tests/vm-program-intake.test.mjs`

**Interfaces:**
- Consumes: T1b's proof that the VM demands `children`.
- Produces: a prompt that teaches the only shape the VM accepts, plus pins.

- [ ] **Step 1: Run the gate tests to record the baseline**

Run: `node --test tests/goal-plan-request.test.mjs tests/goal-plan.test.mjs`
Expected: PASS. Read the failure output of the next step against this baseline.

- [ ] **Step 2: Name `children` in the prompt**

In `buildPlanRequest`'s `system` array in `extension/lib/goal-plan.js`, extend the shape line:

```js
'Shape: {"root": <node>} where a node is one of SEQUENCE, COMMAND, LOOP, UNTIL, WAIT_EVENT, RETRY, ASSERT or RETURN. A SEQUENCE node carries its steps in "children" (never "steps"): {"type":"SEQUENCE","children":[<node>, ...]}.',
```

- [ ] **Step 3: Run to verify, then update the prompt pins**

Run: `node --test tests/goal-plan-request.test.mjs`
Expected: FAIL naming only the changed prompt text. Update the pinned expectations to the new text verbatim. Re-run until PASS. If any non-prompt assertion fails, stop and report.

- [ ] **Step 4: Run the joint pin to verify nothing drifted**

Run: `node --test tests/vm-program-intake.test.mjs tests/goal-plan.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/goal-plan.js tests/goal-plan-request.test.mjs
git commit -m "feat: prompt teaches children, the only shape the VM accepts"
```

---

## Self-review

- Spec coverage: intent (one model round trip, read-only Stage 1) is Task 2's tool; no-new-primitive and no-eval constraints need no task because Stage 1 adds no primitive and Task 6's gate edit adds no eval; schema/constraints/verification are T1b's joint pin; `children` teaching is Task 6; honest partial status is Task 4; testing is Tasks 1b–4 plus Task 5's gates; security paragraph is explicitly Stage 2 and recorded in Task 5's handoff line, not silently dropped.
- Placeholder scan: no TBD/TODO; every code step shows exact code, exact commands, exact expected output; Task 3's migration listing is a concrete `ls` command, not a deferral.
- Type consistency: `run_program` takes `{ program, requestId }` and returns the VM envelope in every task that names it; `tenantId`/`p_tenant_id` naming matches the VM host source in Tasks 2–4.
- Review Focus: tenant smuggle is Tasks 1 and 4; byte budget and stale generation are Task 4's third test; method smuggle is Task 1's second test; expiry is the `EXPIRED` terminal in Task 4 Step 1.
