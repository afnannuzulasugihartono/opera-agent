# Installable MCP and Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One installable npm package (`opera-agent-mcp`) with two modes — cloud and local — where the local mode is metered by the service, and the plan gate lives in the bridge and the hosted MCP, never in readable client code.

**Architecture:** The package is the existing local MCP, renamed and made self-contained by a `prepack` step that copies the two cross-tree imports into it. The local mode speaks only over the loopback bridge; the cloud mode is a stdio-to-HTTP proxy in front of the hosted MCP. Plans live in `opera_account_plans` and in a shared `supabase/functions/_shared/plans.js`; the loopback bridge asks the cloud once per session for an allowance and enforces it locally; the hosted MCP enforces the same shared quota per command.

**Tech Stack:** Node 20+ ESM, no dependencies in the package, Deno edge functions, Postgres via Supabase, `node:test`, Python browser harness.

**Specs:** `docs/superpowers/specs/2026-11-08-installable-mcp-design.md` and `docs/superpowers/specs/2026-11-08-plans-and-tiers-design.md`

## Global Constraints

- One package, mode as an argument: `opera-agent-mcp cloud` and `opera-agent-mcp local`.
- The package carries every module it imports: no import may leave the packed tree.
- The extension stays a separate CRX; the package never installs it.
- The local mode is the loopback bridge only: the debug-port road and `OPERA_LOCAL_TRANSPORT=cdp` are gone.
- The gate lives in the bridge (cloud and loopback) and in the hosted MCP; no plan check in client code.
- The quota is shared per account across both surfaces; the loopback bridge gets an allowance once per session and reports usage back.
- No new dependency in the package; Node >= 20.
- Headers on every touched file; comments above declarations, one line, no `// WHY` blocks.
- Gates: `npm test`, `npm run check`, `py tests/browser_extension_test.py`; re-pins only through `npm run gates:refresh`.

## Review Focus

- The published tarball: a missing file turns every install into "run it from a repo clone" — the bug this plan exists to remove.
- A session that starts while the cloud is unreachable: the local mode must fail with a message about the meter, not with a stack trace.
- Two surfaces spending the same quota: the loopback bridge's allowance must come out of the same daily count the hosted surface sees.
- A command past the allowance: refused with the plan named, never silently dropped.
- An account with no plan row: treated as the free plan, never as "no limit".
- The package's own smoke test: the server must start from the packed tree, not from the repo.

---

### Task 1: The package, self-contained

**Files:**
- Modify: `local/package.json` (name, bin, version, files)
- Create: `scripts/pack-mcp.mjs` (the prepack step)
- Modify: `local/bin/opera-local.js` (the CLI entry: mode as an argument)
- Test: `tests/mcp-package.test.mjs` (new)

**Interfaces:**
- Produces: the npm package `opera-agent-mcp` with the binary `opera-agent-mcp`; `scripts/pack-mcp.mjs` writes `local/lib/socket-protocol.js` and `local/lib/endpoints.js` from `extension/lib/` and copies the rewritten import paths.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`tests/mcp-package.test.mjs` reads `local/package.json` and asserts the name is `opera-agent-mcp`, the bin is `opera-agent-mcp`, and `files` lists every file the server imports. A second test packs the tree (`npm pack --dry-run --json`) and asserts the tarball contains `lib/socket-protocol.js` and `lib/endpoints.js`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/mcp-package.test.mjs`
Expected: FAIL — the package is still named `opera-local` and the two modules are not in it.

- [ ] **Step 3: Implement**

- `local/package.json`: `name: "opera-agent-mcp"`, `bin: { "opera-agent-mcp": "bin/opera-agent-mcp.js" }`, `version: "1.6.29"`, `files` gains `lib/` and `bin/opera-agent-mcp.js`.
- `local/bin/opera-agent-mcp.js`: reads the mode from `process.argv[2]` (`cloud` or `local`), prints usage for `--help`, and starts the matching server. `local/bin/opera-local.js` stays as a thin alias.
- `scripts/pack-mcp.mjs`: copies `extension/lib/socket-protocol.js` and `extension/lib/endpoints.js` into `local/lib/`, rewriting `../extension/lib/` to `./` in the copies, and is wired as the package's `prepack`.
- `local/bridge-ws.js` and `local/wallet-client.js`: import from `./lib/` instead of `../extension/lib/`, and the repo copies of those two modules are generated (not hand-edited).

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/mcp-package.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add local/package.json local/bin scripts/pack-mcp.mjs local/bridge-ws.js local/wallet-client.js tests/mcp-package.test.mjs
git commit -m "Pack the MCP so an install is one command, with every module it imports inside it"
```

---

### Task 2: The local mode is the bridge only

**Files:**
- Modify: `local/driver.js`, `local/bin/opera-local.js`, `local/browsers.js`, `docs/agent-call.md`, `local/README.md`
- Test: `tests/local-transport-target.test.mjs` (rewrite), `tests/local-browsers.test.mjs` (rewrite)

**Interfaces:**
- Produces: `openSession()` always uses the loopback bridge; `OPERA_LOCAL_TRANSPORT` and `OPERA_LOCAL_PORT` no longer choose a road.
- Consumes: Task 1's package.

- [ ] **Step 1: Write the failing test**

A test asserts that with no extension linked, opening a session fails with the link error naming the extension, and that no debugging port is opened (the port argument is never used).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/local-transport-target.test.mjs`
Expected: FAIL — the port road still exists.

- [ ] **Step 3: Implement**

Delete the port branch in `local/driver.js`, the transport choice in `local/bin/opera-local.js`, and the programmatic browser launch in `local/browsers.js`; keep `local/bin/opera-chrome.cmd` (it launches Chrome with the extension). Update the docs: the transport table, `OPERA_LOCAL_TRANSPORT`, and `OPERA_LOCAL_PORT` are gone.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test` and `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add local docs tests
git commit -m "One road for the local drive: the loopback bridge, on the everyday profile"
```

---

### Task 3: The cloud mode and its login

**Files:**
- Create: `local/cloud.js` (the stdio-to-HTTP proxy), `local/oauth.js` (the browser login)
- Modify: `local/bin/opera-agent-mcp.js`
- Test: `tests/local-cloud.test.mjs` (new)

**Interfaces:**
- Produces: `opera-agent-mcp cloud` serves the hosted MCP over stdio; the OAuth token lives in the user's config folder; `OPERA_AGENT_MCP_TOKEN` wins when set.
- Consumes: the hosted endpoint and the OAuth config endpoint.

- [ ] **Step 1: Write the failing test**

A test drives the proxy against a fake hosted endpoint (a local HTTP server that speaks MCP over HTTP) and asserts a tool call round-trips, and that without a token the proxy asks for a login and names the URL to open.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/local-cloud.test.mjs`
Expected: FAIL — no proxy exists.

- [ ] **Step 3: Implement**

The proxy speaks MCP over stdio and forwards each call to the hosted endpoint over HTTP with the bearer token; the login opens the consent URL and stores the token under the user's config folder.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/local-cloud.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add local tests
git commit -m "Give the package a cloud mode: the same tools, the hosted server, a browser login"
```

---

### Task 4: The plans, the data, and the shared limits

**Files:**
- Create: `supabase/migrations/2026_11_08_000000_opera_account_plans.sql`, `supabase/functions/_shared/plans.js`
- Modify: `supabase/migrations/ledger-map.json`
- Test: `tests/plans.test.mjs` (new)

**Interfaces:**
- Produces: `opera_account_plans(user_id, plan, status, updated_at)`; `opera_my_plan()` returning `{ok, plan, dailyQuota, usedToday, sessionAllowance}`; `PLANS` in `_shared/plans.js` with the two plans and their caps.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`tests/plans.test.mjs` asserts both plans exist in `_shared/plans.js` with a daily quota and the feature flags, that `plan.pilot` refuses the whole-page map and `plan.firm` allows it, and that the migration creates the table and the RPC.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/plans.test.mjs`
Expected: FAIL — neither exists.

- [ ] **Step 3: Implement**

The migration creates the table, the RPC, and the grants; `_shared/plans.js` holds the two plans and their caps. Update the migration ledger map.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/plans.test.mjs`, `npm test`, `npm run check`
Expected: PASS.

- [ ] **Step 5: Apply it and commit**

```bash
node scripts/apply-migrations.mjs supabase/migrations/2026_11_08_000000_opera_account_plans.sql
git add supabase tests
git commit -m "Give every account a plan, and one place that says what each plan allows"
```

---

### Task 5: The gate in the cloud bridge

**Files:**
- Modify: `supabase/functions/opera-agent-bridge/bridge-socket.ts`, `supabase/functions/opera-agent-bridge/index.ts`
- Test: `tests/bridge-plan-gate.test.mjs` (new)

**Interfaces:**
- Consumes: `opera_my_plan()` and `PLANS` from Task 4.
- Produces: a handshake that refuses a device whose account has no active plan, and a command that is refused with `PLAN_LIMIT_REACHED` when the daily quota is spent; the whole-page map and the statement commands are `plan.firm` only.

- [ ] **Step 1: Write the failing test**

A test drives the bridge's command path with a fake plan reader: no plan -> the handshake closes with the plan named; quota spent -> the command is refused with `PLAN_LIMIT_REACHED`; `plan.pilot` -> the whole-page map is refused; `plan.firm` -> it is allowed.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bridge-plan-gate.test.mjs`
Expected: FAIL — the bridge knows no plans.

- [ ] **Step 3: Implement**

The handshake reads the plan and refuses without an active one; the command path counts the day's commands and refuses past the quota; the firm-only features are gated.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/bridge-plan-gate.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/opera-agent-bridge tests
git commit -m "Ask the bridge who is calling, and what their plan allows"
```

---

### Task 6: The gate in the hosted MCP

**Files:**
- Modify: `supabase/functions/opera-agent-mcp/index.ts`, `supabase/functions/opera-agent-mcp/tools.ts`
- Test: `tests/hosted-plan-gate.test.mjs` (new)

**Interfaces:**
- Consumes: Task 4's RPC and limits.
- Produces: `browser_status` answers `plan`, `planQuota` and `planUsed`; a command past the quota is refused with `PLAN_LIMIT_REACHED`; the whole-page map is `plan.firm` only.

- [ ] **Step 1: Write the failing test**

A test asserts `browser_status` carries the plan fields, that the quota refusal names the plan, and that the whole-page map is refused for a pilot account.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/hosted-plan-gate.test.mjs`
Expected: FAIL — the hosted surface knows no plans.

- [ ] **Step 3: Implement**

The status reads the plan through the RPC and reports it; the command path refuses past the quota; the whole-page map checks the plan.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/hosted-plan-gate.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/opera-agent-mcp tests
git commit -m "Tell the hosted caller which plan it is on, and stop it when the quota is gone"
```

---

### Task 7: The loopback bridge meters the local drive

**Files:**
- Modify: `local/bridge-ws.js`, `local/bridge.js`
- Test: `tests/local-bridge-plan.test.mjs` (new)

**Interfaces:**
- Consumes: the device token in the extension's `hello` frame; the cloud's plan answer.
- Produces: at session start the bridge asks the cloud for the plan and a session allowance, refuses the session when the cloud cannot be reached (the meter needs it), counts commands locally, refuses past the allowance with `PLAN_LIMIT_REACHED`, and reports the usage when the session ends.

- [ ] **Step 1: Write the failing test**

A test drives the bridge with a fake cloud: the session is refused when the cloud is unreachable, the allowance is enforced, and the usage is reported at the end.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/local-bridge-plan.test.mjs`
Expected: FAIL — the bridge asks nobody.

- [ ] **Step 3: Implement**

The bridge verifies the device token with the cloud once per session, enforces the returned allowance, and reports usage.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/local-bridge-plan.test.mjs` and `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add local tests
git commit -m "Meter the local drive where it happens: the loopback bridge"
```

---

### Task 8: What the operator sees, and the docs

**Files:**
- Modify: `local/bin/opera-agent-mcp.js` (the `doctor` command), `docs/agent-call.md`, `local/README.md`, `README.md`
- Test: `tests/mcp-package.test.mjs` (extend)

**Interfaces:**
- Produces: `opera-agent-mcp doctor` prints the bridge state, the device, the extension version, the plan, the daily quota, the remaining quota, and the CRX download link.

- [ ] **Step 1: Write the failing test**

The package test asserts the doctor command prints the plan and the quota, and that the docs name the two modes and where the gate lives.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/mcp-package.test.mjs`
Expected: FAIL — no doctor command exists.

- [ ] **Step 3: Implement**

The doctor command asks the bridge for the plan and prints it; the docs describe the install, the two modes, the metered local road, and the plans.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`, `npm run check`, `py tests/browser_extension_test.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add local docs README.md tests
git commit -m "Show the operator what is connected and what their plan allows"
```

---

## Self-Review

- **Spec coverage:** the package, the two modes, the prepack step, the bridge-only local road (Task 1-3), the plan data and shared limits (Task 4), the gates in the cloud bridge and the hosted MCP (Tasks 5-6), the metered loopback bridge (Task 7), the doctor and the docs (Task 8).
- **Type consistency:** `opera_my_plan()` returns the same fields in every consumer; `PLAN_LIMIT_REACHED` is one code everywhere; `plan.pilot` and `plan.firm` are the same names in the MCP schema, the bridge and the shared module.
- **Review Focus:** the tarball's completeness (Task 1's pack test), a cloud that cannot be reached (Task 7), one quota across two surfaces (Tasks 5-7), a refusal that names the plan (Tasks 5-7), an account with no row (Task 4's default), and a server that starts from the packed tree (Task 1).