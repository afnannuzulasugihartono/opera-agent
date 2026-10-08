# Ephemeral Workflows (Ad-hoc Write) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run one-off write tasks through the proven runner path using temporary workflows that always disappear.

**Architecture:** A pure compiler (`supabase/functions/_shared/adhoc-compile.js`, re-exported by `lib/adhoc-compile.js`) validates an ad-hoc graph into a runner-shaped definition; a new migration adds ephemeral lifecycle columns plus three RPCs (register, delete, sweep) following the repo's revoke-all plus service_role-only grants; a new `run_adhoc` MCP tool compiles, registers, starts, polls, deletes best-effort, and returns the run's honest status. No new executor, no new step vocabulary, no new browser primitive.

**Tech Stack:** Node >= 22 (`node --test`), Deno edge functions, Supabase Postgres / PLpgSQL.

**Spec:** `docs/superpowers/specs/2026-10-08-adhoc-write-design.md`

## Global Constraints

- Extension holds generic primitives only: no per-site code and no free `eval` ever in the extension.
- Migrations are timestamp-ordered and never rewritten once applied.
- `authenticated` holds no table grant, only EXECUTE on RPCs; new RPCs revoke all from public, anon, authenticated and grant EXECUTE to service_role only.
- Version in `extension/manifest.json` is the source of truth (currently `1.6.20`).
- Fast suite is `npm test`; gates are `npm test` plus `npm run check`.
- Every comment block is spaced from code it does not document (hygiene gate); migrations are exempt.
- No secret, token, or private key in the tree.

## Review Focus

- A temporary row that is never deleted litters the workflows table — a reasonable person expects every `adhoc.*` row to carry a bounded lease and a sweeper that only touches that prefix.
- A delete call naming a permanent workflow must be refused — the prefix guard is the only thing between a caller typo and a destroyed named workflow.
- Rotating `requestId` values must not bypass the quota — the global active-ephemeral cap bounds rotation abuse.
- A consequential click on an icon-only button with no label must still require confirmation — every write node must declare a label, and the pattern must see it.
- A definition smuggling a non-allowlisted method must die twice — once in the compiler, once in `opera_validate_steps` at registration.

---

## File structure

- Create `supabase/functions/_shared/adhoc-compile.js` — pure graph-to-definition compiler, dependency-free (Task 1).
- Create `lib/adhoc-compile.js` — one-line re-export for the Node suite (Task 1, same pattern as `lib/goal-ledger.js`).
- Create `tests/adhoc-compile.test.mjs` — drives the real compiler (Task 1).
- Create `supabase/migrations/20261009000000_opera_agent_ephemeral_workflows.sql` — columns plus three RPCs (Task 2).
- Create `tests/ephemeral-workflows.test.mjs` — pins the migration text (Task 2).
- Modify `supabase/functions/opera-agent-mcp/index.ts` — add `run_adhoc` beside `run_workflow` (Task 3).
- Modify `tests/mcp-surface.test.mjs`, `tests/fixtures/mcp-contract-v1.json`, `tests/helpers/boundary-locks.mjs`, count pins — frozen inventory for the +1 tool (Task 3).
- Modify `docs/superpowers/specs/2026-10-08-adhoc-write-design.md` — quota line: global active cap (no owner column on workflows), with rationale (Task 4).
- Modify `docs/handoff.md` — record the feature within the 150-line cap (Task 4).

Task 1 is the compiler and carries its behavior tests. Task 2 is the migration plus text pins. Task 3 is the caller tool plus inventory. Task 4 is docs plus the green gates.

---

### Task 1: Ad-hoc compiler

**Files:**
- Create: `supabase/functions/_shared/adhoc-compile.js`
- Create: `lib/adhoc-compile.js`
- Create: `tests/adhoc-compile.test.mjs`

**Interfaces:**
- Consumes: nothing (pure; no imports).
- Produces: `compileAdhocGraph(graph)` → `{ok: true, definition: {steps, output}}` or `{ok: false, code, message}`. Codes: `GRAPH_NOT_OBJECT`, `UNKNOWN_NODE_TYPE`, `METHOD_NOT_ALLOWED`, `LABEL_REQUIRED`, `CONFIRM_REQUIRED`, `GRAPH_TOO_LARGE`, `BUDGET_EXCEEDED`.

Constants (fixed here, referenced by later tasks): `MAX_COMMAND_NODES = 12`, `MAX_DEFINITION_BYTES = 32768`, `REPEAT_MAX = 6`, `LEASE_MAX_SECONDS = 3600` (lease enforced server-side; compiler stamps a requested lease the RPC clamps). Read methods needing no confirmation: `page.read`, `page.find`, `page.query`, `page.collect_links`, `page.scroll`, `page.wait_for`, `tabs.list`, `tabs.get`, `tabs.find`, `media.state`. Write methods: `page.click`, `page.fill`, `page.key`, `page.focus`. Everything else refused. Every `page.click` / `page.fill` node must carry a non-empty string `declaredLabel` (`LABEL_REQUIRED` otherwise); a label matching `/pay|buy|checkout|submit|delete|remove|send|publish|subscribe|transfer|password|passcode|otp|2fa|card|cvv/i` requires `confirm: true` on the node (`CONFIRM_REQUIRED` otherwise), and the compiler copies `confirmed: true` plus the matched pattern into the emitted step for audit. Structural node types mirror the runner: `command`, `if` (with `then`/`else`), `repeat` (with `steps`, `until`, `maxIterations` <= `REPEAT_MAX`), `set`, `wait`, `fail`. The emitted definition is `{steps: [...validated...], output: {result: {'$ref': 'steps'}, status: 'completed'}}` — honesty comes from the run row, which the tool returns verbatim.

- [ ] **Step 1: Write the failing test**

Create `tests/adhoc-compile.test.mjs`:

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: adhoc-compile.test — Test.
// @state: locks the ad-hoc graph compiler: allowlists, label plus confirm rules, budgets.
// @dependencies: node:test, strict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAdhocGraph, MAX_COMMAND_NODES } from '../lib/adhoc-compile.js';

const click = (label, extra = {}) => ({ id: 'n1', type: 'command', method: 'page.click', params: { ref: 'r1' }, declaredLabel: label, ...extra });

test('reads pass, ordinary writes pass with labels', () => {
  const out = compileAdhocGraph({ nodes: [
    { id: 'n0', type: 'command', method: 'page.find', params: { text: 'Skip' } },
    click('Skip ad'),
  ] });
  assert.equal(out.ok, true);
  assert.equal(out.definition.steps.length, 2);
});

test('non-allowlisted method dies', () => {
  const out = compileAdhocGraph({ nodes: [{ id: 'n0', type: 'command', method: 'tabs.navigate', params: {} }] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'METHOD_NOT_ALLOWED');
});

test('write node without a label dies', () => {
  const out = compileAdhocGraph({ nodes: [{ id: 'n0', type: 'command', method: 'page.fill', params: { ref: 'r1', value: 'x' } }] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'LABEL_REQUIRED');
});

test('consequential label without confirm dies, with confirm passes and records it', () => {
  const bad = compileAdhocGraph({ nodes: [click('Pay now')] });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'CONFIRM_REQUIRED');
  const good = compileAdhocGraph({ nodes: [click('Pay now', { confirm: true })] });
  assert.equal(good.ok, true);
  assert.equal(good.definition.steps[0].confirmed, true);
});

test('budgets bound nodes and size', () => {
  const many = { nodes: Array.from({ length: MAX_COMMAND_NODES + 1 }, (_, i) => ({ id: `n${i}`, type: 'command', method: 'page.read', params: {} })) };
  assert.equal(compileAdhocGraph(many).ok, false);
  const big = { nodes: [{ id: 'n0', type: 'command', method: 'page.read', params: { pad: 'x'.repeat(40000) } }] };
  assert.equal(compileAdhocGraph(big).code, 'GRAPH_TOO_LARGE');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/adhoc-compile.test.mjs`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the minimal compiler**

Create `supabase/functions/_shared/adhoc-compile.js` (no imports, no Deno, DOM, or Node APIs) implementing exactly the contract above. Create `lib/adhoc-compile.js`:

```js
// @last-edited: 2026-10-08 UTC+7.
// @title: adhoc-compile — re-export so the Node suite reaches the shared compiler.
// @state: the implementation lives in supabase/functions/_shared, where the edge function imports it; this file only points at it.
// @dependencies: _shared/adhoc-compile.

export * from '../supabase/functions/_shared/adhoc-compile.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/adhoc-compile.test.mjs` (expect PASS all 5), then `npm test 2>&1 | tail -n 9` (all pass).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/adhoc-compile.js lib/adhoc-compile.js tests/adhoc-compile.test.mjs
git commit -m "feat: ad-hoc graph compiler for ephemeral workflows"
```

### Task 2: Ephemeral lifecycle migration

**Files:**
- Create: `supabase/migrations/20261009000000_opera_agent_ephemeral_workflows.sql`
- Create: `tests/ephemeral-workflows.test.mjs`

**Interfaces:**
- Consumes: `opera_validate_steps` (existing; second method gate), `opera_workflows` table (existing columns plus three new ones).
- Produces: `opera_register_ephemeral_workflow(text, jsonb, text)`, `opera_delete_workflow(text)`, `opera_sweep_ephemeral_workflows()` — all `security definer`, all revoked from public/anon/authenticated with EXECUTE to service_role only.

Migration content (exact requirements, write the SQL to meet them):

```sql
alter table public.opera_workflows add column if not exists ephemeral boolean not null default false;
alter table public.opera_workflows add column if not exists lease_until timestamptz;
alter table public.opera_workflows add column if not exists request_id text;
create unique index if not exists opera_workflows_request_id_uidx on public.opera_workflows(request_id) where request_id is not null;
create index if not exists opera_workflows_ephemeral_lease_idx on public.opera_workflows(ephemeral, lease_until) where ephemeral = true;
```

`opera_register_ephemeral_workflow(p_request_id text, p_definition jsonb, p_description text default '')`: reject `p_request_id` not matching `^[A-Za-z0-9_-]{1,100}$` with `INVALID_REQUEST`; idempotency: a row with that `request_id` returns its `{name, lease_until}` unchanged; quota: count rows with `ephemeral` and `lease_until > now()` >= 100 returns `RATE_LIMITED`; validate `p_definition->'steps'` with `opera_validate_steps` (refusals pass through); name := `'adhoc.' || substring(gen_random_uuid()::text, 1, 8)` retried up to 3 times on collision; lease := `now() + interval '60 minutes'`; insert with `ephemeral = true` (no version row — ephemeral rows have no rollback history); audit event `workflow.ephemeral_registered`; return `{ok, name, version: 1, lease_until}`. First statement of the function calls `opera_sweep_ephemeral_workflows()` (piggyback GC, no scheduler needed).

`opera_delete_workflow(p_name text)`: if `p_name` does not start with `adhoc.` return `PERMANENT_DELETE_REFUSED` (never a permanent row, ever); delete the row; return `{ok, deleted}`. Run history is preserved (no foreign key from runs to workflows).

`opera_sweep_ephemeral_workflows()`: delete rows with `ephemeral` and `lease_until < now()`; return `{ok, swept}`.

Each function: `revoke all ... from public, anon, authenticated;` plus `grant execute ... to service_role;` naming the exact signature.

- [ ] **Step 1: Write the migration file** to meet every requirement above (read `20260907204221_opera_agent_1_0_0_workflows.sql:107-160` for the house style: `create or replace`, `security definer`, `set search_path = public`, `jsonb_build_object` envelopes).

- [ ] **Step 2: Write the pin test** `tests/ephemeral-workflows.test.mjs` asserting on the migration text: three function names exist; `adhoc.` prefix literal present; `PERMANENT_DELETE_REFUSED` present; `RATE_LIMITED` present; `lease_until` plus `request_id` columns present; revoke-all lines for all three signatures plus three service_role grants; no `grant ... to authenticated|anon|public`.

- [ ] **Step 3: Run** `node --test tests/ephemeral-workflows.test.mjs` (PASS), then full `npm test` (all pass).

- [ ] **Step 4: Commit** both files with `git commit -m "feat: ephemeral workflow lifecycle in SQL"`.

### Task 3: `run_adhoc` MCP tool

**Files:**
- Modify: `supabase/functions/opera-agent-mcp/index.ts` (add tool after `run_program`)
- Modify: `tests/mcp-surface.test.mjs`, `tests/fixtures/mcp-contract-v1.json`, `tests/helpers/boundary-locks.mjs`, count pins (`FROZEN_MCP_TOOLS`, toolCount 36→37, registration-order list)

**Interfaces:**
- Consumes: `compileAdhocGraph` from `../_shared/adhoc-compile.js` (Deno relative import, same as `../_shared/vm-token.js` precedent); existing `rpc`, `toolError`, `deviceName`/`provider` stamping; VM-host-free run path (`opera_register_ephemeral_workflow`, `opera_start_workflow`, `opera_get_workflow_run`, `opera_delete_workflow`, `opera_sweep_ephemeral_workflows`).
- Produces: tool `run_adhoc` taking `{graph, requestId, input?, timeoutMs?}`, returning `{runId, status, result?, error?, deleted}`.

Behavior (exact): `requestId` malformed → reject (never silent); compile fails → return the compiler refusal, no RPC called; else `opera_sweep_ephemeral_workflows()` (piggyback), `opera_register_ephemeral_workflow(requestId, definition, description)`, `opera_start_workflow(name, input ?? {}, timeoutMs ?? 60000, deviceName)`; poll `opera_get_workflow_run` until status in completed/failed/expired/cancelled or the deadline (`min(timeoutMs ?? 60000, 120000)` plus 10s margin); then `opera_delete_workflow(name)` best-effort — a delete failure is recorded as `deleted: false` with its code but never overwrites the run result; return the run's status/result/error verbatim plus `deleted`. Description: "Run a one-off write task (find, fill, ordinary clicks, verify) as a temporary workflow on the paired Opera device: the definition is compiled, registered under adhoc.*, executed, then deleted. Consequential actions need confirm:true in the graph."

- [ ] **Step 1: Add `'run_adhoc'` to `FROZEN_MCP_TOOLS`** (alphabetical slot: immediately before `'run_browser_burst'`) and run the surface test to watch it fail naming `run_adhoc`.

- [ ] **Step 2: Register the tool** per the behavior above, copying the `run_program`/`run_workflow` helper patterns (no new header names, no query-string token, provider stamping identical).

- [ ] **Step 3: Re-freeze** the schema hash (copy actual from failure output; any other tool's hash changing means STOP and report), fixture tools/toolCount/sourceSha256, boundary SHA, and count pins — same mechanical procedure that Stages 1–2a established. Verify each re-freeze is positional-only.

- [ ] **Step 4: Run** `node --test tests/mcp-surface.test.mjs` (PASS), full `npm test` (all pass), `npm run check` (28 primitives — no new primitive).

- [ ] **Step 5: Commit** with `git commit -m "feat: run_adhoc executes one-off writes as ephemeral workflows"`.

### Task 4: Docs plus green gates

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-adhoc-write-design.md` (quota line only)
- Modify: `docs/handoff.md` (Still-open area only, cap 150 lines)

- [ ] **Step 1: Amend the spec quota line** to: per-requestId idempotency plus a global active-ephemeral cap of 100 — no owner column exists on `opera_workflows` (tenancy rides on runs via device/provider), so a per-tenant quota would need a schema the spec did not ask for. One sentence plus this rationale, nothing else in the spec changes.

- [ ] **Step 2: Update the handoff** recording: one-off writes run as `adhoc.*` ephemeral workflows (compile, register, start, poll, delete; sweeper plus lease bound every row); consequential actions need recorded confirmation; no new executor or primitive.

- [ ] **Step 3: Run the full gates fresh** (`npm test` all pass; `npm run check` ok) and commit docs with `git commit -m "docs: ephemeral workflows shipped"`.

---

## Self-review

- Spec coverage: compiler plus budgets plus confirm rule is Task 1; lifecycle plus quota plus sweeper is Task 2; caller path plus honesty is Task 3; docs are Task 4. The spec's `run_program`-adjacent VM-host sentence is Stage 1 (shipped). The spec's Testing section maps to Tasks 1 (compiler pins), 2 (naming/lease pins), 3 (surface plus honesty via run-row passthrough).
- Placeholder scan: every step carries exact code, commands, names, regexes, and numbers. Task 3's re-freeze points at the established mechanical procedure with STOP conditions, not a deferral.
- Type consistency: `compileAdhocGraph(graph)` and its codes identical in Tasks 1 and 3; RPC names plus signatures identical in Tasks 2 and 3; `run_adhoc` input/output fields identical in Task 3's behavior and tests; `MAX_COMMAND_NODES = 12`, `MAX_DEFINITION_BYTES = 32768`, `REPEAT_MAX = 6`, lease 60 minutes, cap 100 used once each and referenced elsewhere.
- Review Focus: unswept rows are Task 2's lease plus sweep pins; permanent delete is Task 2's prefix-guard pin; quota rotation is Task 2's global-cap pin; labelless consequential click is Task 1's `LABEL_REQUIRED` plus pattern pins (every write node must declare a label first, so icon-only buttons cannot slip past); method smuggling is Task 1's allowlist pin plus Task 2's `opera_validate_steps` second gate.
