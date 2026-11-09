# Dashboard Rebuild + Plan-Exhaustion Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Working in worktree `D:\GitHub\opera-agent-dashboard-rebuild` on branch `agent/dashboard-rebuild/dashboard-rebuild` (already created). Release steps run from the **main checkout**, one at a time, never from the worktree.

**Goal:** Make an exhausted plan visible in opencode tools and rebuild the dashboard around a plan hero, in release 1.6.35.

**Architecture:** Three code changes (hosted MCP plan info merged on every answer incl. failure; local MCP `browser_status` passes `/health` meter through; dashboard rebuilt as an app shell with a Pelanggan group and a disclosure-separated Operator group) plus the release plumbing. No gate, quota, billing, or wallet logic changes.

**Tech Stack:** Vanilla JS/TS edge function, static HTML/CSS (no framework), node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-dashboard-rebuild-design.md`

## Global Constraints

- Version 1.6.35 everywhere a version is named (spec — "Perubahan 4: Rilis 1.6.35").
- `OPERA_AGENT_MCP_RAW` handling and the `browser_status` tool **description bytes stay unchanged** (`tests/hosted-mcp.test.mjs`, `tests/mcp-surface.test.mjs`, `tests/fixtures/mcp-contract-v1.json` all pin it). Do not touch the description strings.
- All dashboard reads go through `opera_*` RPCs; never a raw `/rest/v1/<table>` path (pinned in `tests/landing-dashboard.test.mjs`).
- One language per string only via the `id`/`en` dictionary pair; every `data-i18n` key must resolve in **both** languages.
- No new dependencies, no CSS framework, no build step. Site brand is dark-only (`#0b0d10` background, `#3ecf8e` accent).
- npm publish is **staged and awaits explicit user approval**; nothing goes public without it.
- Command payloads never render (`.result` must not match the dashboard HTML outside permitted contexts; the existing test stays green).

## Review Focus

The spec implies these input classes but pins none of them; each gets a test in the task that owns the code, most likely first:

1. Plan fetch fails / no session (signed-out or DB down) → the plan hero must render a legible warn state, never an empty progress bar or a JS crash — test: `landing-dashboard.test.mjs` pins the failure path markup + `refreshPlan` try/catch.
2. `resetsAt` computed with local-midnight instead of UTC → user resets "tomorrow" at the wrong hour — test: unit assertion in `local-mcp-server.test.mjs` for the UTC computation.
3. Plan merged on the hosted error path but the error shape is eaten (`isError` lost, `error.code` gone) → agents lose the failure taxonomy — test: source-level pin in `mcp-surface.test.mjs` + preserved `{ ok:false, error:{ code } }` shape check.
4. `#tabel` / `#dengar` moved under the operator disclosure but deep links (`#tabel`) never open it → an operator deep-link lands on an empty-looking page — test: pin `showSection` auto-opens the disclosure for operator targets.
5. EN dictionary drifts from ID (key missing on one side) → English users see raw Indonesian or blanks — test: `landing-dashboard.test.mjs` walks every `data-i18n` key and asserts it exists in both `id` and `en`.

---

### Task 1: hosted `planInfo` reports remaining + exhaustion

**Files:**
- Modify: `supabase/functions/opera-agent-mcp/plan-info.ts`
- Test: `tests/hosted-plan-gate.test.mjs`

**Interfaces:**
- Produces: `planInfo(db, userId) → { plan, planStatus, planQuota, planUsed, planRemaining, planExhausted } | null` (null for static/absent user/failure, unchanged). `planRemaining = max(0, quota - used)`, `planExhausted = used >= quota`.

- [ ] **Step 1: Update the failing test** — in `tests/hosted-plan-gate.test.mjs`, change the first test's `deepEqual` to include `planRemaining: 5000 - 314` (4684) and `planExhausted: false`; add `test('a pilot at the cap reports zero remaining and exhausted')` with `fakeDb({ plan: 'plan.pilot', count: 200 })` asserting `planRemaining === 0` and `planExhausted === true`; add `test('usage reports from the local bridge count toward exhaustion')` with `count: 190, reports: [{ commands: 10 }]` asserting `planExhausted === true` (200 >= 200).
- [ ] **Step 2: Run it to verify it fails** — `node --test tests/hosted-plan-gate.test.mjs` → FAIL (`planRemaining`/`planExhausted` undefined).
- [ ] **Step 3: Implement** — in `plan-info.ts`, compute `const remaining = Math.max(0, quota - used)` after `used` is known, return both fields alongside the existing four. No new imports.
- [ ] **Step 4: Run tests to verify pass** — `node --test tests/hosted-plan-gate.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add supabase/functions/opera-agent-mcp/plan-info.ts tests/hosted-plan-gate.test.mjs && git commit -m "The hosted caller gets the two plan facts it was one fetch away from"`.

### Task 2: hosted `executeStatus` merges plan on success AND failure

**Files:**
- Modify: `supabase/functions/opera-agent-mcp/index.ts` (`executeStatus`, ~lines 500)
- Modify: `tests/helpers/boundary-locks.mjs` (re-pin `supabase/functions/opera-agent-mcp/index.ts`)
- Test: `tests/mcp-surface.test.mjs`

**Interfaces:**
- Consumes: `planInfo` from Task 1 (adds `planRemaining`/`planExhausted`).
- Produces: `browser_status` structuredContent always carrying `plan`/`planStatus`/`planQuota`/`planUsed`/`planRemaining`/`planExhausted` when userId is known — also when the command failed. `isError:true` and the `{ ok:false, error:{ code, message } }` shape survive untouched; only additive plan fields.

- [ ] **Step 1: Write the failing pin** — in `tests/mcp-surface.test.mjs` add `test('browser_status answers its plan even when the command failed', ...)` asserting from source: `executeStatus` merges `plan` before returning an `isError` answer — assert the isError branch (or a shared merge helper) references `planInfo(` **and** that the old early `if (answer.isError) return answer;` line no longer exists (`assert.doesNotMatch(source, /if \(answer\.isError\) return answer;/)`).
- [ ] **Step 2: Run it to verify it fails** — `node --test tests/mcp-surface.test.mjs` → FAIL on the new pin.
- [ ] **Step 3: Implement** — restructure `executeStatus`: always `const [presence, plan] = await Promise.all([devicePresence(userId), planInfo(await db(), userId)])`; if `answer.isError`, merge `...(plan ?? {})` into the existing error structuredContent (keeping `ok:false`, `error`, every existing key), keep `isError:true`, return re-serialized text with the same shape; else merge as today. Also spread `planRemaining`/`planExhausted` via `plan` (already in the Task 1 object — no extra code).
- [ ] **Step 4: Run tests** — `node --test tests/mcp-surface.test.mjs tests/hosted-mcp.test.mjs tests/mcp-output-tidy.test.mjs tests/mcp-output-kr.test.mjs` → PASS (descriptions unchanged so `mcp-contract-v1.json` needs no re-pin; if `mcp-output-tidy.test.mjs` reshapes merged output unexpectedly, extend its expectation minimally and say so).
- [ ] **Step 5: Re-pin the boundary in the same commit** — compute `git hash-object supabase/functions/opera-agent-mcp/index.ts` (LF-normalized via the helper — check `boundary-locks.mjs` header for the exact normalization; if the gate normalizes CRLF→LF, hash after `sed -i` equivalent or `git hash-object --stdin < file` with contents normalized). Replace the entry `'../supabase/functions/opera-agent-mcp/index.ts', '09f854c4ca203b3c1f076a663fa94841847e08f0'` with the new hash and say in the commit message why: `executeStatus now merges plan info on the failure path; the tool description and schemas are byte-identical`.
- [ ] **Step 6: Commit** — message like `browser_status tells the plan also when the command it carried failed`.

### Task 3: local MCP `browser_status` passes the meter through

**Files:**
- Modify: `local/mcp-server.js` (`linkedDevices`, ~line 263; `browser_status` case, ~line 500)
- Test: `tests/local-mcp-server.test.mjs`

**Interfaces:**
- Produces: `linkedDevices(port) → [{ name, id, instanceId, extensionVersion, slot, port, plan: null | { plan, allowance, dailyQuota, usedToday, remaining, resetsAt } }]`. `resetsAt` = next UTC midnight ISO string, computed locally.
- Produces: `browser_status` top-level `planExhausted?: true` and `planExhaustedDevices?: string[]` — present only when the loopback bridge answered (remote road omits both; never invented).

- [ ] **Step 1: Write the failing tests** — in `tests/local-mcp-server.test.mjs` add `test('browser_status carries the meter of every linked device', ...)` and `test('browser_status flags an exhausted plan and names the device', ...)`. Drive deterministically: start a `node:http` server on an ephemeral port in the test; serve `/health` with two devices — `opera-a` (`meter: { plan:'plan.firm', allowance:500, dailyQuota:5000, usedToday:300, sent:0, remaining:4700 }`) and `opera-b` (`usedToday:5000, remaining:0`) — `createMcpServer({ ...ctx(), port: async () => ephemeralPort })`, call `browser_status`, assert: `payload.devices.length === 2`, `payload.devices[0].plan.remaining === 4700`, `payload.planExhausted === true`, `payload.planExhaustedDevices` deep-equals `['opera-b']`, and `devices[0].plan.resetsAt` equals the expected next-UTC-midnight string (compute in the test the same way; also assert `payload.devices[0].plan.resetsAt.endsWith('00:00:00.000Z')`). Then a second fixture with `remaining: 4700` only → `planExhausted` absent or false. Use `server.close()` in `finally`.
- [ ] **Step 2: Run to verify it fails** — `node --test tests/local-mcp-server.test.mjs` → FAIL (`plan` undefined on device rows).
- [ ] **Step 3: Implement** — in `linkedDevices`, extend the mapping to carry `plan: d?.meter ? { plan, allowance, dailyQuota, usedToday, remaining, resetsAt: nextUtcMidnight() } : null`; add module-private `const nextUtcMidnight = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString(); }`. In the `browser_status` case, after `linkedDevices`, compute `const exhausted = devices?.filter((d) => d.plan && Number(d.plan.remaining) <= 0).map((d) => d.name)` and spread `...(exhausted?.length ? { planExhausted: true, planExhaustedDevices: exhausted } : {})` into the answer object. Non-loopback (`devices` null) → nothing added.
- [ ] **Step 4: Run tests** — `node --test tests/local-mcp-server.test.mjs` → PASS; then `node --test tests/mcp-package.test.mjs tests/local-bridge-plan.test.mjs tests/plans.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add local/mcp-server.js tests/local-mcp-server.test.mjs && git commit -m "The local status line carries the plan meter of every linked browser"`.

### Task 4: dashboard rebuild

**Files:**
- Rewrite: `landing/dashboard.css`
- Rewrite: `landing/dashboard.html`
- Modify: `tests/landing-dashboard.test.mjs`
- Keep untouched: `landing/site.css`, `landing/app.css`, `landing/_headers`, `landing/i18n.js` (mechanism), `landing/palette.js`, `landing/wayfind.js`, `landing/akun.html`

**Interfaces (must survive the rewrite; these are test-pinned):**
- All RPC call shapes unchanged (`opera_my_devices`, `opera_my_listen`, `opera_konsol_tables`, `opera_konsol_table`, `opera_create_pairing_code`, `opera_revoke_my_device`, `opera_run_on_my_device`). New: `refreshPlan()` calls `opera_my_plan` via the same REST constant and header pattern.
- Element ids kept: `devices`, `historyRows`, `historySearch`, `historyCount`, `historyEmpty`, `historyNoMatch`, `konsolHead/konsolRows/konsolEmpty/konsolPrev/konsolNext/konsolPage/konsolJson/konsolCsv/konsolSearch/konsolStatus`, `listens`, `walletBalance/walletAvailable/walletTopUp/walletRefresh/walletStatus/priceRows/walletRows/walletEmpty/priceEmpty`, `pairName/pairButton/pairCodeBox/pairCode/pairCopy/pairCountdown/pairStatus`, `runMethod/runButton/runStatus`, `accountFacts`, `statDevices/statOnline/statCommands`, `metrics`, `status`, `installState`, `checklist`, `whoami`, `primaryCta`, `railCollapse`, `konsolList/railTables`, `whoami`, `railDeviceLabel`, sections `ringkasan/device/riwayat/tabel/dengar/saldo/pairing/aksi/akun` (all keep their ids; deep links keep working).
- New ids: `planName`, `planChip`, `planFill`, `planUsed`, `planQuota`, `planRemaining`, `planResets`, `planAllowance`, `planExhaustedBanner` (hidden by default), `planRefresh`, `operatorToggle`, `operatorGroup`.
- `showSection()` keeps owning view selection; extended to auto-open `operatorToggle` when `location.hash` is `#tabel` or `#dengar`.

**Information architecture (final):**

```
main.console > .layout
  nav.rail (aria-label="Bagian dashboard")
    .railGroup (Pelanggan / Customer): Ringkasan, Device, Riwayat, Aksi, Saldo, Pairing, Akun
    .railGroup.operator (behind <button id="operatorToggle" aria-expanded="false" aria-controls="operatorGroup">): Tabel, Dengar
  .consoleMain (all nine <section>, unchanged ids)
```

**Ringkasan (hero):** `<section id="ringkasan">` gains the plan card first:
- `<h1>Ringkasan</h1>` stays.
- Plan card: `planName`, `planChip` (status), progress `<div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="N" id="planFill">` inside a track, `planUsed`/`planQuota` numerals ("206 / 5000"), `planRemaining`, `planAllowance` (session allowance), `planResets` ("reset besok 00.00 UTC" / "resets tomorrow 00:00 UTC"), and `<p id="planExhaustedBanner" hidden>` reading "Plan habis — reset besok (UTC)." / "Plan exhausted — resets tomorrow (UTC)." with a link to `/harga` / `/harga` (same path both languages; the site's harga page is one URL).
- Failure path: `refreshPlan()` catches → status line `.status warn` + plan card shows a legible "Status paket tidak bisa dibaca. Muat ulang." with a `planRefresh` retry button; never an unfilled progressbar with zeros as if they were real data (zero only paints when the RPC answered with real numbers).
- Install checklist + `installState` + metrics strip render below the plan card, unchanged in behaviour.

**Visual system (evolusi brand, executed per design-taste-frontend):** load the design-taste-frontend skill before Task 4 implementation. Rules applied: dark-only, `#0b0d10` ground with layered surface tints, `#3ecf8e` accent used only for action/positive/progress, radii scale from `--radius-sm`/`--radius`, shadow + 1px borders over glow, hero numeral scale for `planUsed`, tabular-nums for counters, spacing in 8px multiples, no gradients except none at all, no emoji, inline SVG icons only, focus-visible outlines, `prefers-reduced-motion: reduce` disables transitions.

**Steps:**

- [ ] **Step 1: Load design-taste-frontend skill** (invoke the skill tool with `design-taste-frontend`) and read its app-screen rules before touching CSS.
- [ ] **Step 2: Rewrite `landing/dashboard.css`** — keep `--*` tokens aligned to `site.css` (`--ink`, `--muted`, `--line`, `--accent`, `--accent-soft`, `--danger`, `--radius-sm`, `--radius`); add hero/progress/chip/disclosure/group styles; keep a `@media (max-width: 760px)` block in which `.rail` becomes `grid-auto-flow: column` horizontal scroll (the existing test pins `grid-auto-flow: column` inside that media query — keep that exact declaration).
- [ ] **Step 3: Rewrite `landing/dashboard.html`** per the IA above — copy the proven JS logic blocks (`esc`, `relativeTime`, `TRANSLATED` + the five refusal translations verbatim, `showSection`, `refreshDevices` + 10s poll + `visibilitychange`, `currentSession` guards ×3+, MutationObserver install marker, revoke confirm, wallet + pairing countdown + konsol + CSV, `location.replace('./index.html')`, shared nav/footer/`href="./akun.html"`, `aria-current="page"` on the brand link, `Device milik`, `id="installState"` logic, `<dt>Status</dt>`/`<dt>Terakhir terlihat</dt>`/`<dt>Perintah</dt>`/`<dt>ID device</dt>`, `data-copy="${esc(device.id)}"`, `/salin ID/`). Add `refreshPlan()` + the hero markup. Add `<script type="application/json" id="i18n-dict">` with `id` and `en` key sets covering every static string (nav, rail groups, hero, metrics, checklist, empty states, buttons, footer). Every static visible string gets `data-i18n`.
- [ ] **Step 4: Update `tests/landing-dashboard.test.mjs`** — keep all pins still true; **change** the rail-sections test to also require `operatorToggle`/`operatorGroup` and the two group labels; **add** pins: `opera_my_plan` present; `id="planExhaustedBanner"` present; `role="progressbar"` present; `<script type="application/json" id="i18n-dict">` parses and its `id` and `en` dictionaries carry the identical key set; every `data-i18n` attribute key exists in both dictionaries. **Do not weaken** any pin that still holds (RPC scoping, `_headers`, hash routing, MutationObserver, refusal translations, revoke confirm, `.result` ban).
- [ ] **Step 5: Run the full suite** — `npm test` → PASS; `npm run check` → PASS. If `check` flags landing files in `gates.lock`, see Task 5 for the re-pin step (do it there, not ad hoc).
- [ ] **Step 6: Real-browser pass** — serve `landing/` locally (`npx serve` or `node scripts/landingserve.mjs` — inspect its usage first) and open `dashboard.html` in Opera Agent (dogfood the local road) or a CDP-attached Chrome; screenshot signed-out (must show sign-in redirect), and the three hero states by temporarily stubbing `opera_my_plan` responses via a local fetch mock if login is unavailable. Signed-in with real account is the user's verification after deploy — note it in the PR.
- [ ] **Step 7: Commit** — `git add landing/dashboard.html landing/dashboard.css tests/landing-dashboard.test.mjs && git commit -m "The dashboard speaks product: plan first, pelanggan first, operator behind one door"`.

### Task 5: release 1.6.35

**Files:** `package.json`, `local/package.json`, `extension/manifest.json`, `extension/lib/protocol.js`, `store/store-manifest.json`, `scripts/check.mjs` (its version pin), `supabase/functions/opera-agent-mcp/index.ts` (PRODUCT_VERSION), `tests/{protocol,mcp-surface,burst-atomic-actions,hover-settle,role-reconcile,timeout-retry-popup-parity}.test.mjs` (their 1.6.34 pins), `CHANGELOG.md`, `docs/releases/1.6.35.md` (new), `docs/handoff.md`, `package-lock.json`, `gates.lock` (only if a gated file moved — check `node scripts/gates.mjs --refresh` output, with reasons in the commit message), `tests/helpers/boundary-locks.mjs` (already re-pinned in Task 2)

- [ ] **Step 1: Bump every 1.6.34 → 1.6.35** — `git grep -l '1.6.34' -- . ':!node_modules' ':!docs/releases/1.6.34.md'` minus the spec. Keep each file's surrounding format.
- [ ] **Step 2: Write `docs/releases/1.6.35.md` and CHANGELOG entry** — what changed (plan visible in both roads' `browser_status`; dashboard rebuilt with plan hero; operator group; id+en complete), how it was proven, explicit limits (signed-in verification by account owner; no quota change).
- [ ] **Step 3: `npm test` + `npm run check` + `py tests/browser_extension_test.py`** → all green; fix anything the bump broke (tests that hard-pin the version).
- [ ] **Step 4: `npm run gates:refresh` if and only if `check` says a gated file moved** — print what moved; re-pin with stated reasons; otherwise leave `gates.lock` untouched.
- [ ] **Step 5: PR** — `gh pr create` (branch pushed) with the same title style as recent PRs (`gh pr list --state merged --limit 5` for tone); CI must pass; squash-merge to `main` when green.
- [ ] **Step 6 (from main checkout, one at a time): redeploy `opera-agent-mcp`** from main; **CRX re-sign** for 1.6.35 (extension bytes changed: version pins) via the same workflow 1.6.34 used (`gh run list --workflow=…` to find it; `gh workflow run <name>` / watch with `gh run watch`); update update endpoint expectations; **do not** publish npm — staged publish of `opera-agent-mcp@1.6.35` waits for explicit user approval (1.6.34 may still be pending approval).
- [ ] **Step 7: Update `docs/handoff.md`** — 1.6.35 state, what is proven, what remains (user-side signed-in verification, pending npm approvals for 1.6.34/1.6.35).
- [ ] **Step 8: Clean the worktree** — remove it with `node scripts/agent-worktree.mjs remove <path>` after merge.

---

## Self-Review

**Spec coverage:** Perubahan 1 → Task 3 (lokal) with plan fields; Perubahan 2 → Tasks 1–2 (hosted); Perubahan 3 → Task 4 (IA, hero, operator group, id+en, CSS 760px pin, RPC untouched); Perubahan 4 → Task 5 (bump list, redeploy, gates, npm-staged-only, CRX re-sign); Testing → folded into each task; honest limits → plan footer + PR note.

**Review Focus → tasks:** (1) → Task 4 Step 3 failure path + Step 4 pins; (2) → Task 3 Step 1 resetsAt assertions; (3) → Task 2 Steps 1–3; (4) → Task 4 IA + Step 4 pin (`showSection` auto-opens disclosure); (5) → Task 4 Step 4 dict/key-set pin.

**Type consistency:** `planInfo` object (Task 1) is spread verbatim by `executeStatus` (Task 2) — same keys; local `browser_status` emits snake/camel as pinned (`planExhaustedDevices`, `resetsAt`) in Task 3 and asserted in Task 4's pins only via the local MCP path — no cross-road shape claims are made.

**Proportion:** 5 tasks; code blocks are test assertions and markup contracts, not bodies.
