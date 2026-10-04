Last edited: 2026-10-04 17:52.

# HANDOFF

Simplify first. State what is true now, never its history.

Cover every button on every site. After the main sites hold, add sites that teach new functions.

Related: [AGENTS.md](../AGENTS.md) - [CONTEXT.md](CONTEXT.md) - [ROADMAP.md](../ROADMAP.md)

> What is true now and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main`, sole remote branch, every merge `--ff-only`.
- Version `1.6.15` in `[extension/manifest.json](../extension/manifest.json)` is the source of truth.
- Local gates: `npm test` 769 pass, `npm run check` ok — 26 primitives, 91 safety files.
- Browser harness exits 0 against Brave, headless and headed. `ci-browser` runs the
  same file under `xvfb`.
- Live suite: 106 passed, 0 failed, 12 skipped against real YouTube videos, opencode.ai,
  Google Maps, GitHub, Wikipedia and Google Docs. `OA_ONLY=<substring>` runs one
  case group.
- Google coverage is Maps, YouTube and Docs. YouTube additionally proves the
  transcript panel through `...more` when the video carries captions, the Like
  button dispatching up to the sign-in wall, and the comments section missing
  for logged-out sessions. New sites that teach new functions: GitHub search
  (overlay trigger, type, submit, results) and Wikipedia (ref-scroll, section
  jump).
- All 26 allowlisted primitives are driven by both suites. `media.play` was the last one
  the deterministic harness never called.
- `media.play` in background mode is refused on a real video by Chrome's autoplay policy.
  The extension names the cause and the recovery, which is foreground mode.
- Production database: 48 migrations recorded, 0 pending. `opera_claim_next_wait` and
  `opera_run_fast` both present. 58 `opera_*` functions live, 9 edge functions, each
  with a repo counterpart.
- No `sbp_` token in the tree or its history. The two matches in
  `[tests/transaction-cloud.test.mjs](../tests/transaction-cloud.test.mjs)` are synthetic (`'a'.repeat(40)`).
- `page.read` reports `userState` — `tabActive`, `windowFocused`, `watching` — so the
  model can tell whether the person is looking at the tab before choosing foreground or
  background. Fails open: a missing `userState` is a gap in the report, not a failure.

## Known, not started

- **The Opera-to-Brave rename is a production migration, not a rename.** The `opera_`
  prefix is load-bearing in the database: 58 functions, plus tables and every RPC name
  the bridge and MCP call. Repo surface is ~256 files and ~1982 `opera_*` identifiers.
- **A digest freeze blocks the first edit.** `tests/fixtures/*.json` pin `sourceSha256`
  for [`supabase/functions/opera-agent-mcp/index.ts`](../supabase/functions/opera-agent-mcp/index.ts) and `[extension/background.js](../extension/background.js)`, and
  `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` pins them by blob SHA.
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
   The forms themselves are already located on the live sites and the selectors are
   verified; only the submit needs credentials.
7. **The one real latency lever, and it is an owner decision.** Measured over 9,079
   production commands, 676.6 ms of the 1875.3 ms average is the device not yet having
   asked for the command, p95 1914.4 ms. That wait is the polling ramp inside
   `opera_claim_next_wait`, which falls to a 250 ms floor after 720 ms idle. A 100 ms
   floor should bring p95 near 1000 ms at 10 idle polls per second instead of 4; 50 ms
   gets near 700 ms at 20. It is not changed: it alters a production function on the
   command path, and the right floor depends on how many devices idle at once, which
   this repository cannot answer. Full numbers in `[docs/benchmarks.md](benchmarks.md)`.
8. The largest unknown: how many model round trips a real task costs. Every latency
   figure here models the server and extension path, not the model loop.

## CI

- `1facc42` concluded **success on all three gates**: unit, secret-scan, browser. It is the
  head that carries the `media.play` change, so it is the acceptance evidence for the
  runtime. Three earlier commits are green on the same gates.
- The self-hosted runner `laptop-d-runner` is offline, so CI jobs queue and never
  start. Starting it is an owner action on that machine. Pushes made while it is
  offline only replace one dead queued run with another.
- The concurrency group cancels an in-flight run when a newer one queues, so a push made
  while CI is running destroys the evidence for the head that was being tested. Push, then
  wait. Two runs were lost to this during this session.
- One browser failure came out of this session and was a defect in the harness, not the
  product: the focus audit called a window losing OS focus a stolen focus. It now reports
  five states and only fails when focus lands on a different window or a different tab,
  which is what a steal physically is. The classifier is checked on all five at the start
  of every run, and both steal branches were proved red by disabling them.
- Reaching the first green run took three machine faults, none of them in the code:
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

- Python 3.12.10 installs and runs per-user (`py -3.12`, pip 25.0.1), twice proven
  (install-verify, uninstall-reinstall-verify). 3.13.15 stays the default untouched.
- The per-machine install is still broken: its `dev_AllUsers` MSI crashes with a
  stack overflow (`0xC00000FD`) during file costing, in both scopes, even after
  re-registering the MSI engine (`msiexec /unregister` + `/regserver`, service
  running). The dev-symbols package is poisoned on this machine; nobody needs it
  to run Python. Next steps are OS-level (SFC, servicing) and need the owner.
- The repo does not need per-machine: the runner runs interactively as ASUS, so
  per-user installs are visible to it.
- `%TEMP%\opencode\pythoncore-backup.reg` still holds the removed 3.12 registry
  registration.
- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13.15 with
  playwright.

## Do not touch

- `stash@{0}` — "preserve accidental 8E files before completing checkpoint 8D". Do not
  pop, apply, delete, or build from it. 8E is paused and must not start implicitly.
- `archive/*` tags are historical; never rewrite them.
