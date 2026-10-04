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

## Blocked, needs the owner at the machine

- **CI acceptance is not obtainable right now, and that is a machine fault, not a code
  fault.** `actions/setup-python@v5` removes the tool-cache Python, then its installer
  never finishes: zero CPU for over two hours, waiting on a UI prompt nobody answers.
  The five runs before that failed with `setup.ps1` unable to remove registry keys,
  "Requested registry access is not allowed", then "Error happened during Python
  installation". One hung job held the single self-hosted runner, so ten pushes queued
  with no result. Do not call any head green until a run concludes.
- The installer processes were killed twice so the runner could advance, and it hangs
  again on the next job. `.github/workflows/ci.yml` now gives every job a timeout and a
  concurrency group, so the block becomes a visible failure instead of a silent one.
  That does not fix the installer.
- The stale `HKCU\Software\Python\PythonCore\3.12` registration, which pointed at the
  runner's tool cache, has been removed and backed up to
  `%TEMP%\opencode\pythoncore-backup.reg`. The runner re-registers it on its next
  install; that is expected.
- Python 3.13.15 is installed, is first on the user PATH, and has playwright. `py`
  resolves to it. Use `py`, not `python`, which hits the Microsoft Store shim.
- Likely cause worth checking when the owner is at the machine: the python.org
  installer cannot complete on this host at all, per-user or all-users. Antivirus, a
  half-finished uninstall, or the earlier crash and freeze are the usual suspects.

## Do not touch

- `stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D". Do not
  pop, apply, delete, or build from it. 8E is paused and must not start implicitly.
- `archive/*` tags are historical; never rewrite them.
