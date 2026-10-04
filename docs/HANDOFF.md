# HANDOFF

Related: [AGENTS.md](../AGENTS.md) - [CONTEXT.md](CONTEXT.md) - [ROADMAP.md](../ROADMAP.md)

> What is true now and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main`, sole remote branch, every merge `--ff-only`.
- Version `1.6.15` in `extension/manifest.json` is the source of truth.
- Local gates: `npm test` 763 pass, `npm run check` ok — 26 primitives, 91 safety files.
- Browser harness exits 0 against Brave, headless and headed. `ci-browser` runs the
  same file under `xvfb`.
- Production database: 48 migrations recorded, 0 pending. `opera_claim_next_wait` and
  `opera_run_fast` both present. 58 `opera_*` functions live, 9 edge functions, each
  with a repo counterpart.
- No `sbp_` token in the tree or its history. The two matches in
  `tests/transaction-cloud-8d.test.mjs` are synthetic (`'a'.repeat(40)`).
- `page.read` reports `userState` — `tabActive`, `windowFocused`, `watching` — so the
  model can tell whether the person is looking at the tab before choosing foreground or
  background. Fails open: a missing `userState` is a gap in the report, not a failure.

## Known, not started

- **The Opera-to-Brave rename is a production migration, not a rename.** The `opera_`
  prefix is load-bearing in the database: 58 functions, plus tables and every RPC name
  the bridge and MCP call. Repo surface is ~256 files and ~1982 `opera_*` identifiers.
- **A digest freeze blocks the first edit.** `tests/fixtures/*.json` pin `sourceSha256`
  for `opera-agent-mcp/index.ts` and `extension/background.js`, and
  `tests/helpers/boundary-locks.mjs` pins them by blob SHA.
- Sequence: verify on Brave, then rename, then re-freeze. Otherwise a Brave regression
  is indistinguishable from a rename regression.

## Still open

1. Release so the shipped CRX contains the Options page. Needs the private signing key.
2. Remove the unused `activeTab` permission. Verified unused; touches the declared surface.
3. Publishable-key rotation — a production secret, untouched.
4. SonarCloud project access — the pre-existing New Code wall.
5. Three Supabase PATs need owner action. There is no Management API for PATs, so
   nothing further is possible from here. One remains, scoped to `opera-agent` only.
6. Real login flows on Google and GitHub. Code exists; needs `OA_GOOGLE_EMAIL`,
   `OA_GOOGLE_PASSWORD`, `OA_GITHUB_EMAIL`, `OA_GITHUB_PASSWORD` in the environment.
   Selectors are unverified on a first real run.
7. The largest unknown: how many model round trips a real task costs. Every latency
   figure here models the server and extension path, not the model loop.

## CI

- `3c5b201` concluded **success on all three gates**: unit, secret-scan, browser. That
  is the first real CI evidence in this session, and it took three machine faults to
  get there, none of them in the code:
  - `actions/setup-python` spawned a python.org installer that never finished, at zero
    CPU for over two hours. On a single runner that also blocked the two jobs needing
    no Python. The step is gone; the browser job uses the machine's Python 3.13 with
    playwright and prints the version it used. **The 3.12 pin is not restored.**
  - `shell: bash` resolved to the WSL launcher and the runner has no WSL distribution,
    so every job died in under a second without running a command. The shell is now
    `pwsh`, which is installed and translates no paths.
  - The gitleaks asset name was `.tar.gz`; gitleaks publishes `windows_x64.zip`, so the
    step 404'd. It had never run before, because the shell was broken first.
- Every job also has a timeout and the workflow has a concurrency group, so a hang
  becomes a visible failure and superseded runs do not queue behind each other.

## Blocked, needs the owner at the machine

- The python.org installer cannot complete on this host at all, per-user or all-users.
  That is the underlying fault and it is still there; the workflow now avoids it rather
  than fixing it. Antivirus, a half-finished uninstall, or the earlier crash and freeze
  are the usual suspects.
- The stale `HKCU\Software\Python\PythonCore\3.12` registration, which pointed at the
  runner's tool cache, has been removed and backed up to
  `%TEMP%\opencode\pythoncore-backup.reg`.
- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13.15 with
  playwright.

## Do not touch

- `stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D". Do not
  pop, apply, delete, or build from it. 8E is paused and must not start implicitly.
- `archive/*` tags are historical; never rewrite them.
