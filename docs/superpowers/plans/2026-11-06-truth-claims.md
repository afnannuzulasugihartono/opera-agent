# Truth Pass over the agent-call branch — implementation plan

> **For agentic workers:** implement task-by-task, TDD (RED → GREEN → gates) per task.

**Goal:** Every claim in `docs/agent-call.md`, `local/README.md`, `proof/extension-run.md` and the proof/check scripts matches what the code and the live servers actually do. Scope = the 13 review findings on merged #189–#191, nothing more.

**Evidence already gathered (2026-11-06):**
- OpenCode schema (https://opencode.ai/config.json, live): servers live at `mcp.servers.<name>`; remote `oauth` fields are snake_case (`client_id`, `redirect_uri`, `callback_port` …). The guide's `"mcp": { "opera-agent": … }` + `"clientId"` snippet is the old shape and is ignored by current OpenCode.
- OAuth client id `bbc5eb76-f385-435b-8b13-8e339b45e633` IS registered in Supabase `auth.oauth_clients` ("Opera Agent", redirect `http://127.0.0.1:19876/mcp/oauth/callback` = OpenCode's default callback). Live probe: authorize with that client+redirect → `302` to `/oauth/consent`; any other redirect → `400 invalid redirect_uri`.
- `local/driver.js:110` + `local/bin/opera-local.js:43`: `OPERA_LOCAL_TRANSPORT` unset = auto (bridge when an extension is linked, CDP otherwise). `local/sessions.js:119` calls `openSession` with `launch:false`, so a client pointed at 9333 with nothing listening gets `No browser is listening on port 9333.` — the server does not open a second browser.
- `tests/extension-run.test.mjs` re-hashes the fixture and compares with the recorded hash; it never re-drives a browser. The "cannot drift away from the code that makes it" sentence overstates this.
- Chrome 153.0.8010.36 (branded) is installed; `--load-extension` is ignored by branded Chrome 137+ (Chromium / Chrome for Testing still honour it) — so `scripts/extension-run.mjs` "own" mode must fail fast naming that limit instead of waiting 60 s for a link that cannot come.
- Chrome prefs: `download.default_directory` empty (default `~/Downloads`); OneDrive root exists, `OneDrive\Downloads` does not — but Known Folder Move can redirect Downloads there, so the extension-road watch must cover both and name them.
- Bridge on 9451 is up and linked (`/health` → `linked:true`), so the extension proof runs in `joined` mode.

**Gates per task:** `npm test`, `npm run check`, `node scripts/format-comments.mjs --check`. Baseline on `agent/truth/claims` (240bbe53): 1849 tests, 1846 pass, 0 fail, 3 skipped.

**Workflow:** branch `agent/truth/claims` off `origin/main` (already created, worktree `D:/GitHub/opera-agent-truth`); conventional commits; PR from `.github/pull_request_template.md`; merge `gh pr merge <n> --squash --admin --delete-branch=false`; no `landing/` change in this pass, so no deploy dispatch.

---

### Task 1: the call guide says what the code does

**Files:** `docs/agent-call.md`, `local/README.md`, `tests/agent-call-docs.test.mjs`

- [ ] RED: add doc locks — transport default is `unset (auto)` with meaning "bridge when an extension is linked, CDP otherwise" (guide + README env table); port 9333 refusal wording `No browser is listening on port 9333.` with a pointer to `local/README.md`; hosted claim dated from `proof/hosted-mcp.json` `checkedAt`; OpenCode snippet uses `mcp.servers` + `oauth.client_id` + the registered `redirect_uri`; the guide names the OAuth client id pinned in `scripts/hosted-mcp-check.mjs`; the "cannot drift" sentence is gone from the guide; tool count read from `import { TOOLS }` instead of a loose regex.
- [ ] GREEN: fix `docs/agent-call.md` and `local/README.md` (incl. `polls` → `dials` at README:62).
- [ ] Gates.

### Task 2: hosted MCP check records a scrubbed, dated snapshot and proves the pinned OAuth client

**Files:** `scripts/hosted-mcp-check.mjs`, `proof/hosted-mcp.json`, `tests/hosted-mcp.test.mjs`

- [ ] RED: test that a token-shaped string in a response body never reaches the record; test that the record keeps only status/error fields; test that the record carries an `authorize` probe result for the pinned client id + redirect (302 → consent path, query dropped).
- [ ] GREEN: scrub token-shaped strings, record selected fields only, add the authorize probe, export `HOSTED_MCP_URL` / `OAUTH_CLIENT_ID` / `OAUTH_REDIRECT_URI`; re-run the script to regenerate `proof/hosted-mcp.json`.
- [ ] Gates.

### Task 3: the extension-road download cannot move the wrong file

**Files:** `local/primitives-file.js`, `tests/local-file.test.mjs`

- [ ] RED: two new finished files in the watched folder → `downloaded:false` naming both, nothing moved or renamed; the browser folder watch covers `~/Downloads` and `~/OneDrive\Downloads`; the failure message names every watched folder.
- [ ] GREEN: implement candidate-folder watch list + ambiguity refusal.
- [ ] Gates.

### Task 4: the proof runner and its record tell the truth about mode and limits

**Files:** `scripts/extension-run.mjs`, `proof/extension-run.md`, `tests/extension-run.test.mjs`

- [ ] RED: join the existing bridge only when `holder.linked === true`; own mode fails fast naming the `--load-extension` Chrome 137+ limit for branded Chrome; `recordMarkdown` says "No debugging port, no cloud relay." only in joined mode; the closing sentence says what the test actually re-checks; `proof/extension-run.md` equals `recordMarkdown(rows from jsonl)`.
- [ ] GREEN: implement, regenerate `proof/extension-run.md` from the recorded jsonl (no browser drive needed), add the equality lock to the test.
- [ ] Gates.

### Task 5: ledger, PR, merge

**Files:** `.superpowers/sdd/2026-11-06-agent-call-path/progress.md` (copy in from the previous worktree), PR body from `.github/pull_request_template.md`

- [ ] Update the ledger: press-proof outcome (#191), the focus-emulation probe + the public correction posted on PR #190, review findings and rulings (incl. deferred minors: hosted MCP URL literal in 3 places, loose tool-count regex — fixed here by import — and the update-service `/health` staleness, still open).
- [ ] `npm test`, `npm run check`, `node scripts/format-comments.mjs --check`; conventional commit; push; PR; `gh pr merge <n> --squash --admin --delete-branch=false`.
- [ ] No `landing/` change → no deploy dispatch.
