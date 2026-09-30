# Enterprise Standards Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `opera-agent` to an enterprise compliance & security baseline with zero runtime behavior changes.

**Architecture:** Nine small tasks on branch `chore/enterprise-standards-phase-1` (basis `a99978d`): license/ownership docs, CI gates appended to the existing CircleCI job, env-template plus behavior-preserving env fallbacks in ops scripts only, one version-drift fix, one read-only Sonar diagnosis, and a final full-gate closeout. Each task ends green and committed.

**Tech Stack:** Node 22 (native `node:test`), PowerShell 5.1-compatible scripts (ASCII-only), CircleCI 2.1, Deno 2.x (lint/check), gitleaks 8.x, CycloneDX cdxgen 11.x.

**Spec:** `docs/superpowers/specs/2026-09-30-enterprise-standards-phase1-design.md`

## Global Constraints

- Work only on branch `chore/enterprise-standards-phase-1`; never touch `main` or `feat/pre-8e-usability-repair-r8`.
- One writer per checkout: run `git status --porcelain` (must be empty) before the first write of the session.
- `npm test` (573/573 baseline) and `npm run check` must stay green after every task.
- Never add a GitHub Actions test workflow; `.github/workflows/release.yml` is release automation only.
- Every new root file needs an `ALLOWED_ROOT_ENTRIES` update in `tests/repo-naming-governance.test.mjs:11-16` in the same commit, with a recorded reason comment.
- Filenames: lowercase kebab-case, except the conventional list at `tests/repo-naming-governance.test.mjs:81` (extend it explicitly with reason if needed).
- PowerShell edits stay ASCII-only (PS 5.1 reads no-BOM files as ANSI).
- Never write a real secret, token, or key into the repo; `.env.example` holds names and empty/example values only.
- No session ends dirty or diverged: commit, push, record the exact head SHA in `docs/next-session-handoff.md`.
- TDD: failing test (or failing gate) first, minimal change, gate green, commit.

## Review Focus

- Gitleaks flags a historical fixture containing a fake-looking secret: add a `.gitleaks.toml` allow exception for that exact path with a reason comment, do not weaken the gate globally (Task 7 pins this test).
- `deno check` reports pre-existing type errors in an edge function: fix only trivial/safe ones (unused imports), record anything behavioral for Fase 2, never widen scope (Task 7 pins this test).
- A reviewer pastes a real token into `.env.example` by mistake: the Task 4 grep-for-secret-patterns step pins this test.
- New CI steps push the CircleCI job over its time budget: keep each tool download cached/pinned and SBOM informational only (Task 7 pins this test).
- The `SUPPORT.md` uppercase name trips the kebab-case filename test: the Task 2 conventional-list extension pins this test.

---

### Task 1: LICENSE + package.json license field

**Files:**
- Create: `LICENSE`
- Modify: `package.json:4` (add license field)
- Modify: `tests/repo-naming-governance.test.mjs:11-16` (allowlist + reason)

**Interfaces:**
- Consumes: nothing.
- Produces: root files `LICENSE`; `package.json` gains `"license": "MIT"`.

- [ ] **Step 1: Create LICENSE and watch the naming gate fail**

Create `LICENSE` with exactly this content:

```text
MIT License

Copyright (c) 2026 AFNAN NUZULA SUGIHARTONO

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Run: `node --test tests/repo-naming-governance.test.mjs`
Expected: FAIL with `unexpected tracked root entries ... LICENSE` (allowlist; note the file is untracked until added — stage it first with `git add -N LICENSE` so the tracked-files check sees it).

- [ ] **Step 2: Allowlist LICENSE and add the package.json field**

In `tests/repo-naming-governance.test.mjs`, extend the set (keep alphabetical-ish order, add reason):

```js
const ALLOWED_ROOT_ENTRIES = new Set([
  '.agents', '.circleci', '.github', '.specify', 'docs', 'extension', 'lib',
  'oauth-consent', 'release-trigger', 'scripts', 'specs', 'supabase', 'tests',
  'tools', '.gitignore', 'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'README.md', 'ROADMAP.md', 'SECURITY.md', 'package.json',
  // Enterprise Phase 1 (2026-09-30): OSI license file at root.
  'LICENSE',
]);
```

In `package.json`, add after line 4 (`"private": true,`):

```json
  "license": "MIT",
```

- [ ] **Step 3: Gate green**

Run: `node --test tests/repo-naming-governance.test.mjs`
Expected: PASS (all 5 tests).

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add LICENSE package.json tests/repo-naming-governance.test.mjs
git commit -m "chore: add MIT LICENSE, package.json license field, naming allowlist

Enterprise Phase 1 Task 1. No runtime changes."
```

---

### Task 2: SECURITY.md upgrade + SUPPORT.md

**Files:**
- Modify: `SECURITY.md` (full rewrite below)
- Create: `SUPPORT.md`
- Modify: `tests/repo-naming-governance.test.mjs:15` (allowlist) and `:81` (conventional list)

**Interfaces:**
- Consumes: Task 1 allowlist pattern.
- Produces: root files `SUPPORT.md`, upgraded `SECURITY.md`.

- [ ] **Step 1: Write both docs and watch the naming gate fail**

Replace `SECURITY.md` with exactly:

```markdown
# Security

Opera Agent can interact with a local browser and therefore uses a strict allowlisted command model.

## Security principles

- No arbitrary `eval` or remote code execution.
- Browser actions must use known, validated primitives.
- Passwords, PINs, OTP/2FA codes, CVV/CVC, and security-code fields remain blocked.
- File uploads remain blocked unless explicitly designed and reviewed later.
- Private extension signing keys must never be committed to the repository.
- Production secrets belong in secure secret storage, not source code.
- Commands should be auditable and bounded by timeouts and payload limits.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.6.x   | :white_check_mark: |
| < 1.6   | :x:                |

Only the latest patch of the current minor line receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Report privately via the repository
Security tab (Report a vulnerability) or direct contact with the
maintainer. Include: affected version, reproduction steps, and impact.

Proposed response targets: acknowledgement within 5 business days,
critical fix or mitigation within 30 days. These targets are proposed
for owner adjustment during review.
```

Create `SUPPORT.md` with exactly:

```markdown
# Support

## Supported versions

Security fixes: latest patch of `1.6.x` (see `SECURITY.md`).

## Where to get help

1. `docs/install.md` — installation, pairing, smoke test.
2. `docs/testing.md` — test suite and browser regression.
3. `docs/troubleshooting.md` if present, otherwise open a private
   discussion with the maintainer for deployment questions.
4. Security issues: follow `SECURITY.md`, never a public thread.
```

Stage both (`git add -N SECURITY.md SUPPORT.md`) and run: `node --test tests/repo-naming-governance.test.mjs`
Expected: FAIL — `unexpected tracked root entries ... SUPPORT.md`, plus the kebab-case test flags `SUPPORT.md` (uppercase, not in the conventional list).

- [ ] **Step 2: Allowlist SUPPORT.md in both lists**

In `ALLOWED_ROOT_ENTRIES` add with reason:

```js
  // Enterprise Phase 1 (2026-09-30): user support entry point at root.
  'SUPPORT.md',
```

In the conventional regex at line 81, add `SUPPORT` to the alternation with reason comment above it:

```js
  // Enterprise Phase 1 (2026-09-30): SUPPORT.md follows the same
  // conventional-uppercase-doc exemption as README/SECURITY.
  const conventional = /^(README|AGENTS|SECURITY|CONTRIBUTING|CHANGELOG|ROADMAP|CODE_OF_CONDUCT|LICENSE|SUPPORT)\.md$|^SKILL\.md$/;
```

- [ ] **Step 3: Gate green**

Run: `node --test tests/repo-naming-governance.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add SECURITY.md SUPPORT.md tests/repo-naming-governance.test.mjs
git commit -m "chore: upgrade SECURITY.md, add SUPPORT.md, naming allowlists

Enterprise Phase 1 Task 2. Response targets are proposed for owner
adjustment. No runtime changes."
```

---

### Task 3: .github/CODEOWNERS

**Files:**
- Create: `.github/CODEOWNERS`

**Interfaces:**
- Consumes: nothing (`.github` already allowlisted; `CODEOWNERS` has no `.md` extension so the kebab test ignores it).
- Produces: default reviewer rule for the whole repo.

- [ ] **Step 1: Create CODEOWNERS**

Create `.github/CODEOWNERS` with exactly:

```text
# Default owner for everything. Release automation paths get the same
# owner explicitly so no path is ever unowned.
* @afnannuzulasugihartono
/.github/workflows/release.yml @afnannuzulasugihartono
/supabase/migrations/ @afnannuzulasugihartono
/extension/ @afnannuzulasugihartono
```

- [ ] **Step 2: Verify zero test impact**

Run: `node --test tests/repo-naming-governance.test.mjs`
Expected: PASS (no root change, no `.md` file added).

- [ ] **Step 3: Commit**

```bash
git add .github/CODEOWNERS
git commit -m "chore: add CODEOWNERS with default owner

Enterprise Phase 1 Task 3. No runtime changes."
```

---

### Task 4: .env.example + allowlist + no-real-secrets proof

**Files:**
- Create: `.env.example`
- Modify: `tests/repo-naming-governance.test.mjs:11-16` (allowlist + reason)

**Interfaces:**
- Consumes: env names verified in `supabase/functions/*/index.ts` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, OPERA_AGENT_MCP_TOKEN, OPERA_AGENT_MCP_DEVICE_NAME, OPERA_AGENT_MCP_USER_IDS, OPERA_AGENT_MCP_EMAILS) plus ops-level SUPABASE_PROJECT_REF, OPERA_AGENT_MCP_BASE_URL, OPERA_AGENT_DIAGNOSTIC_BEARER.
- Produces: `.env.example` consumed by Tasks 6 (scripts read two of these names).

- [ ] **Step 1: Create .env.example and watch the naming gate fail**

Create `.env.example` with exactly (empty/example values only — never real secrets):

```text
# Copy to .env (gitignored) for local use. Never commit real values.
# Supabase project (see supabase/config.toml for the self-hosted default).
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# MCP server allowlist (see supabase/functions/opera-agent-mcp/index.ts).
OPERA_AGENT_MCP_TOKEN=
OPERA_AGENT_MCP_DEVICE_NAME=opera
OPERA_AGENT_MCP_USER_IDS=
OPERA_AGENT_MCP_EMAILS=
# Ops scripts (see scripts/*.ps1, scripts/mcp-connection-diagnostics.mjs).
SUPABASE_PROJECT_REF=nenmkmtvjremqphfqnfw
OPERA_AGENT_MCP_BASE_URL=https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp
OPERA_AGENT_DIAGNOSTIC_BEARER=
```

Stage (`git add -N .env.example`) and run: `node --test tests/repo-naming-governance.test.mjs`
Expected: FAIL with `unexpected tracked root entries ... .env.example`.

- [ ] **Step 2: Allowlist and prove no real secrets**

Add to `ALLOWED_ROOT_ENTRIES` with reason:

```js
  // Enterprise Phase 1 (2026-09-30): env template; values stay empty/example.
  '.env.example',
```

Then prove the template holds no credential material (this is the Review-Focus test for accidental secret paste):

```powershell
Select-String -Path .env.example -Pattern 'ghp_|github_pat_|sb_secret|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20}'
```

Expected: no matches.

Also prove `.env` itself stays ignored:

```powershell
git check-ignore -q .env; if ($LASTEXITCODE -ne 0) { throw '.env NOT IGNORED' } else { '.env ignored OK' }
```

Expected: `.env ignored OK`.

- [ ] **Step 3: Gate green**

Run: `node --test tests/repo-naming-governance.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .env.example tests/repo-naming-governance.test.mjs
git commit -m "chore: add .env.example template, naming allowlist

Enterprise Phase 1 Task 4. Template values only; .env stays gitignored.
No runtime changes."
```

---

### Task 5: docs/install.md version drift (1.6.0 -> 1.6.13)

**Files:**
- Modify: `docs/install.md:5,13,26,35,43`

**Interfaces:**
- Consumes: shipped version `1.6.13` from `package.json:3`, `extension/manifest.json:4`.
- Produces: install doc consistent with the shipped release.

- [ ] **Step 1: Apply the five exact edits**

- Line 5: `Opera Agent 1.6.0 is the stable release.` -> `Opera Agent 1.6.13 is the stable release.`
- Line 13: `Releases 1.1.0 through 1.6.0 use extension ID` -> `Releases 1.1.0 through 1.6.13 use extension ID`
- Line 26: `...-ohbbpamcljckmjhcpkcmefdobkoeaick-1.6.0.crx` -> `...-ohbbpamcljckmjhcpkcmefdobkoeaick-1.6.13.crx`
- Line 35: `Extract \`opera-agent-1.6.0-extension.zip\`` -> `Extract \`opera-agent-1.6.13-extension.zip\``
- Line 43: ``Expected version: `1.6.0`.`` -> ``Expected version: `1.6.13`.``

Do not touch the `1.1.0` / `1.0.x` historical mentions on line 13.

- [ ] **Step 2: Prove no stale 1.6.0 remains**

Run: `Select-String -Path docs/install.md -Pattern '1\.6\.0'`
Expected: no matches.

Run: `node --test tests/repo-naming-governance.test.mjs`
Expected: PASS (no renames involved).

- [ ] **Step 3: Commit**

```bash
git add docs/install.md
git commit -m "docs: install.md 1.6.0 -> 1.6.13 to match shipped release

Enterprise Phase 1 Task 5. Docs only."
```

---

### Task 6: Ops-script env fallbacks (behavior-preserving)

**Files:**
- Modify: `scripts/deploy-gateway.ps1:6`
- Modify: `scripts/run-8d-acceptance.ps1:9`
- Modify: `scripts/run-8d-edge-concurrency.ps1:11`
- Modify: `scripts/run-8d-worker-loss.ps1` (`$ProjectRef` line — locate with grep first)
- Modify: `scripts/mcp-connection-diagnostics.mjs:3`

**Interfaces:**
- Consumes: `.env.example` names `SUPABASE_PROJECT_REF`, `OPERA_AGENT_MCP_BASE_URL` (Task 4).
- Produces: scripts that read env first and fall back to the identical literal default. Existing tests keep passing because the literal default stays in source (`tests/transaction-edge-concurrency-runner-8d.test.mjs:25` and `tests/transaction-worker-loss-runner-8d.test.mjs:13` assert the literal is present).

- [ ] **Step 1: Failing-proof — show current hardcoded lines**

Run:

```powershell
Select-String -Path scripts/deploy-gateway.ps1,scripts/run-8d-acceptance.ps1,scripts/run-8d-edge-concurrency.ps1,scripts/run-8d-worker-loss.ps1 -Pattern "ProjectRef.*=.*'|^\$ref = '"
Select-String -Path scripts/mcp-connection-diagnostics.mjs -Pattern 'const BASE'
```

Expected: four `$ref`/`$ProjectRef` literals and `const BASE = 'https://...'` — the pre-change evidence. Record the output in the commit message trailer.

- [ ] **Step 2: Apply env-first fallbacks (ASCII only)**

In the three `.ps1` files replace the literal assignment with the same shape (example for `deploy-gateway.ps1:6`):

```powershell
$ref = if ($env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF } else { 'nenmkmtvjremqphfqnfw' }
```

and for the `$ProjectRef` files:

```powershell
$ProjectRef = if ($env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF } else { 'nenmkmtvjremqphfqnfw' }
```

Change nothing else in those files (the `$Branch`, DPAPI, and smoke-test lines stay untouched — stale-branch cleanup is out of scope).

In `scripts/mcp-connection-diagnostics.mjs:3` replace with:

```js
const BASE = process.env.OPERA_AGENT_MCP_BASE_URL || 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';
```

- [ ] **Step 3: Parse checks + focused tests**

Run:

```powershell
powershell -NoProfile -Command "$e=$null;$t=$null;@('scripts/deploy-gateway.ps1','scripts/run-8d-acceptance.ps1','scripts/run-8d-edge-concurrency.ps1','scripts/run-8d-worker-loss.ps1')|ForEach-Object{[void][System.Management.Automation.Language.Parser]::ParseFile($_,[ref]$t,[ref]$e)};if($e.Count){$e|Format-List;exit 1}else{'PS_PARSE_OK'}"
```

Expected: `PS_PARSE_OK`.

Run: `node --check scripts/mcp-connection-diagnostics.mjs`
Expected: exit 0.

Run:

```bash
node --test tests/mcp-connection-diagnostics.test.mjs tests/transaction-edge-concurrency-runner-8d.test.mjs tests/transaction-worker-loss-runner-8d.test.mjs tests/repo-naming-governance.test.mjs
```

Expected: all PASS (the source-literal assertions still match the fallback default).

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-gateway.ps1 scripts/run-8d-acceptance.ps1 scripts/run-8d-edge-concurrency.ps1 scripts/run-8d-worker-loss.ps1 scripts/mcp-connection-diagnostics.mjs
git commit -m "chore: ops scripts read SUPABASE_PROJECT_REF / MCP base URL from env

Enterprise Phase 1 Task 6. Identical literal fallback; pre-change grep
output: <paste Step 1 output>. No behavior change without env set."
```

---

### Task 7: CircleCI gates — secret scan, audit, Deno, SBOM

**Files:**
- Modify: `.circleci/config.yml` (append four steps after `Unit and static tests`, before `Install Playwright`)

**Interfaces:**
- Consumes: pinned tool versions below; root `deno.lock` is machine-local (untracked, gitignored) while `supabase/functions/opera-agent-mcp/deno.lock` is the tracked reproducible surface — hence `--no-lock` on `deno check`.
- Produces: CI that fails on leaked secrets, high+ advisories, lint/type errors, with an informational SBOM artifact.

- [ ] **Step 1: Prove the gate gap on the basis head**

Run: `Select-String -Path .circleci/config.yml -Pattern 'gitleaks|npm audit|deno|sbom'`
Expected: no matches — the gap evidence.

- [ ] **Step 2: Append the four steps**

Insert after the `Unit and static tests` step (after line 29):

```yaml
      - run:
          name: Secret scan (gitleaks)
          command: |
            GITLEAKS_VERSION="8.24.0"
            curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o /tmp/gitleaks.tar.gz || {
              GITLEAKS_VERSION="$(curl -sSf https://api.github.com/repos/gitleaks/gitleaks/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')"
              echo "pinned gitleaks missing; falling back to latest v8: ${GITLEAKS_VERSION}"
              curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o /tmp/gitleaks.tar.gz
            }
            tar -xzf /tmp/gitleaks.tar.gz -C /tmp gitleaks
            /tmp/gitleaks detect --source . --verbose
      - run:
          name: Dependency audit
          command: npm audit --audit-level=high
      - run:
          name: Install Deno and lint/typecheck edge functions
          command: |
            # Root deno.lock is machine-local (gitignored); the tracked
            # per-function lockfile is the reproducible surface, hence --no-lock.
            curl -fsSL https://deno.land/install.sh | sh -s "v2.1.4" || curl -fsSL https://deno.land/install.sh | sh
            export DENO_INSTALL="$HOME/.deno"
            export PATH="$DENO_INSTALL/bin:$PATH"
            deno --version
            deno lint supabase/functions/
            for fn in supabase/functions/opera-agent-*/index.ts; do deno check --no-lock "$fn"; done
      - run:
          name: SBOM artifact (CycloneDX, informational)
          command: |
            npx --yes @cyclonedx/cdxgen@11 --output-file bom.json --fail-on-error .
      - store_artifacts:
          path: bom.json
          destination: sbom
```

Rules for first-green friction (Review-Focus pins): if `gitleaks` flags a historical fixture, add a `.gitleaks.toml` allow exception for that exact path with a reason comment (do not disable rules globally). If `deno check` reports pre-existing type errors, fix only trivial/safe ones (unused imports); record anything behavioral for Fase 2 in the commit message and keep it out of this diff. `npm audit` has zero dependencies so it passes trivially today — it guards the future.

- [ ] **Step 3: Push and prove CI green on the exact head**

```bash
git add .circleci/config.yml
git commit -m "ci: add gitleaks, npm audit, deno lint/check, SBOM artifact

Enterprise Phase 1 Task 7. CircleCI stays the only code/test gate."
git push origin chore/enterprise-standards-phase-1
```

Then read BOTH signals for the pushed SHA (the combined status alone lies while a check-run is pending):

```bash
$sha = git rev-parse HEAD
gh api "repos/afnannuzulasugihartono/opera-agent/commits/$sha/check-runs" --jq '.check_runs[] | "\(.name): \(.conclusion // .status)"'
gh api "repos/afnannuzulasugihartono/opera-agent/commits/$sha/status" --jq '.state'
```

Expected: every check-run `completed: success` (or neutral for informational) and status `success`. If a new gate is red, follow the friction rules in Step 2, amend in a new commit (never amend pushed commits — add a fixup commit), push again.

- [ ] **Step 4: Record the evidence**

Append the CI run URL and conclusions to the Task 7 commit message trailer via an empty-amend-free follow-up commit only if needed; otherwise record them in `docs/next-session-handoff.md` at closeout (Task 9).

---

### Task 8: SonarCloud gate diagnosis (read-only)

**Files:** none (investigation only; findings go to the handoff at closeout).

**Interfaces:**
- Consumes: failing `SonarCloud Code Analysis` check-runs on R9 heads (context in `docs/next-session-handoff.md:44-52`).
- Produces: a diagnosis or a documented blocked state — never a guessed fix.

- [ ] **Step 1: Authenticate the CLI**

Run: `gh auth status`
Expected: logged in (this machine has used `gh api` for CI reads before). If not, stop the task and record blocked.

- [ ] **Step 2: Pull the Sonar check-run output for the basis head**

```bash
gh api "repos/afnannuzulasugihartono/opera-agent/commits/a99978d/check-runs" --jq '.check_runs[] | select(.name | contains("Sonar")) | {name, conclusion, details_url, output: .output.text}'
```

- [ ] **Step 3: Follow the details URL as far as anonymous access allows**

If the findings are readable, list the top rule violations by file. If they require SonarCloud project access, stop and record `BLOCKED: needs SonarCloud project access` — do not guess, do not change code to satisfy an unseen gate.

- [ ] **Step 4: Record (no commit)**

Write the outcome (diagnosis or blocked state) into the session notes for Task 9's handoff entry. No code, no commit — a no-change task whose deliverable is the recorded answer.

---

### Task 9: Final gate, push, and session closeout

**Files:**
- Modify: `docs/next-session-handoff.md` (append Fase 1 entry), `docs/project-context.md` (append Fase 1 entry)

**Interfaces:**
- Consumes: all green tasks above.
- Produces: a clean, pushed branch and durable context. No merge to `main` — the owner decides promotion separately (PR link below).

- [ ] **Step 1: Full suite + static gate**

Run: `npm test`
Expected: 573/573 PASS (baseline count; a higher count from new tests is fine, a lower count is a red flag).

Run: `npm run check`
Expected: exit 0 with 26 primitives / 1.6.13.

Run once: `py tests/browser_extension_test.py`
Expected: exit 0. On a single failure on a runtime-unchanged head, treat as suspected flake per handoff policy: reproduce headed, rerun once with evidence; two consecutive failures on the same content means stop and open a repair loop (out of scope for this plan — record and halt).

- [ ] **Step 2: Push and verify exact-head CI**

```bash
git push origin chore/enterprise-standards-phase-1
$sha = git rev-parse HEAD
gh api "repos/afnannuzulasugihartono/opera-agent/commits/$sha/check-runs" --jq '.check_runs[] | "\(.name): \(.conclusion // .status)"'
gh api "repos/afnannuzulasugihartono/opera-agent/commits/$sha/status" --jq '.state'
```

Expected: all green. Record `$sha`.

- [ ] **Step 3: Handoff + context entries and final commit**

Append to `docs/next-session-handoff.md` under the enterprise-track section: final head SHA, per-task commit SHAs, CI conclusions (CircleCI, Vercel, gitleaks, Sonar-diagnosis outcome from Task 8), and the PR URL `https://github.com/afnannuzulasugihartono/opera-agent/pull/new/chore/enterprise-standards-phase-1` (open the PR only if the owner asks — default is branch-only).

Append a 3-line entry to `docs/project-context.md`.

Verify: `git status --porcelain` shows only the two docs files; commit; push; `git status -sb` shows `...origin/chore/enterprise-standards-phase-1` with no ahead/behind.

```bash
git add docs/next-session-handoff.md docs/project-context.md
git commit -m "docs: Fase 1 closeout — <final-sha>, CI green, PR link inside

Enterprise Phase 1 Task 9."
git push origin chore/enterprise-standards-phase-1
```
