# Opera Agent durable context

> **Scope:** facts and traps that must survive because they cannot be recovered by
> reading the code. Session logs and architecture live in
> `docs/context-archive.md`; what to do next lives in
> `docs/next-session-handoff.md`. Keep this file under roughly 120 lines.

## Toolchain facts

- **Deno is pinned to 2.9.6** at
  `C:\Users\ASUS\AppData\Local\Temp\opencode\deno296\deno.exe`. The machine's own
  `deno` is 2.1.4 and unreliable for the gates. Never `deno upgrade`; if the
  binary vanishes, re-extract it from that directory's own `deno.zip`.
- **`npm test` globs `tests/*.test.mjs` and does not recurse**, so the integration
  tests under `tests/postgres/` never run in the fast suite, by design — they need
  a live database. A new test in a subdirectory silently never runs.
- **The browser test needs `py` on Windows**, not `python`. Run
  `py tests/browser_extension_test.py` directly; CI calls `python` and is fine.
- **PowerShell, five traps that each produced a wrong answer.** An alias outranks a
  function, so `function H` lost to the `h` alias for `Get-History` and printed a
  live credential into an error message. `Invoke-RestMethod` already parses JSON,
  so `.Content` on its result is `$null` — get the raw string from
  `Invoke-WebRequest -UseBasicParsing`. `ConvertFrom-Json` needs `-InputObject`, not
  a pipe, or arrays come back nested. `>` and `Add-Content` write UTF-16 and corrupt
  UTF-8 files; append via `[IO.File]::AppendAllText` with an explicit no-BOM UTF-8
  encoding. And `gh api --jq` breaks under PowerShell quoting.

## Branch and history traps

- **`origin/main` rejects merge commits.** Every merge must be `--ff-only`, and
  history that must be rebuilt is rebuilt linearly by cherry-pick. That has already
  cost one full rebuild.
- **A stale remote branch can hide indefinitely.** A cleanup once swept `chore/*`
  and missed a fully contained `feat/*`. Check the full branch list, not a prefix,
  and archive before deleting.

## Facts that contradict a code comment

- **No gateway route reads the query string.** `extractToken` checks
  `x-opera-agent-token`, then `Authorization`, then `body.apiKey`; `?apiKey=` is
  not a token carrier anywhere. A header comment claimed otherwise until Phase 5.
- **Nothing ever assigns `status = 'disabled'` to `opera_devices`.** Only
  `'online'` is written, so that state needs direct SQL, which is why re-enabling a
  device is owner-only. Locked by `tests/device-status-truth.test.mjs`, which fails
  on purpose if a write path is added.
- **There is no scheduler.** `pg_cron` is absent, no `cron.schedule` exists, and
  nothing calls `opera_goal_cleanup`, `opera_vm_cleanup` or `opera_vm_expire`. No
  data class is purged automatically.

## Gate-signal traps

- **GitHub combined status can read `success` while a check-run is still pending or
  red** — already one recorded false-green here. Read per-context statuses, never
  the roll-up; trusting it can accept a head whose `ci-unit` is still running.
- **A green local suite is not acceptance.** Acceptance is CircleCI plus Vercel
  SUCCESS on the exact evidence head.
- The headed-Windows browser harness can fail with `page.pointer stole browser
  focus` or `FOREGROUND_REQUIRED`. Measured at a base commit with later changes
  stashed, so it **pre-exists them**. Do not attribute it to current work.

## How a claim gets accepted here

The rule that cost the most to learn; three review rounds produced claims stronger
than the code, and Phase A repeated the pattern three more times.

- A lock is **not accepted** until it has been made to fail on a realistic
  violation.
- A harness must test **both** directions — broken input that must be rejected and
  legitimate input that must be accepted. Testing rejection only hides inverted
  logic; a check that always returned false passed the first version.
- A file must not claim more than it delivers. If a test cannot see a case, say so
  in the test file rather than letting the commit message imply otherwise.

## Deployment and platform traps

- **CI does not apply migrations.** `.circleci/config.yml` runs only `deno lint`
  and `deno check`; no `supabase db push`, no project link, and `docs/runbook.md`
  treats applying one as owner-only. So an edge function that starts calling a new
  RPC has a hard ordering requirement: migration first, then deploy, or the control
  path fails outright.
- **The Supabase migration API rewrites the version you hand it.** `POST
  /v1/projects/{ref}/database/migrations` ignores the filename's version, stamps one
  from the apply time, and puts the whole filename in `name`. Left alone, every
  migration reads as unapplied forever and `db push` re-runs them all. Apply, then
  `update` the row. `statements` is stored as one element however many the file has.
- **Supabase has no API for personal access tokens.** Every PAT path returns 404 and
  `/v1/oauth/revoke` is for OAuth, so an agent holding a PAT cannot rotate or revoke
  it. Plan for owner action instead of hunting an endpoint.
- **Renaming anything `opera_*` is a production migration, not a rename.** 58
  `opera_*` functions live in `public` and the prefix is load-bearing in every RPC
  the bridge and MCP call. Add the freeze cost: `tests/fixtures/*.json` pin
  `sourceSha256` and `tests/helpers/boundary-locks.mjs` pins two runtime files by
  blob SHA.
- **The Chrome debugger banner cannot be hidden** — it persists for the whole
  attachment, and Chrome's guidance is attach-during-a-task, detach-immediately
  after. Caching an attach across commands is a product regression, not an
  optimisation; the only lever is batching more work per attach.
- **Edge functions run on Supavisor transaction mode, which does not support
  `LISTEN/NOTIFY`.** Any wakeup must be server-side `pg_sleep` polling, already this
  repository's established pattern.
- **OpenAI reportedly rejects `.` in MCP tool names** (`^[a-zA-Z0-9_-]+$` per a
  developer report, not an official document) while MCP's spec permits dots. Treat
  dotted names as unverified against OpenAI until actually tested.

## Blind alleys already explored

Recorded so a later session does not repeat them.

- `npm audit` and SBOM quarantines were investigated and exonerated.
- The gated `node --check` exits 0 on a broken `.ts` file — `scripts/check.mjs` is
  the gate that actually works.
- The pinned `deno` binary vanished once and was restored from its own zip.
- Two stale git worktrees held 3.7 MB of duplicate tree. Both were verified clean
  and fully merged, then removed with `git worktree remove`.
- **Renaming the 22 MCP tools to dotted form was declined.** They deliberately
  differ from the primitives and follow no rule: some reverse word order
  (`list_tabs`/`tabs.list`), some are renamed outright
  (`click_element`/`page.click`), four pointer tools share one primitive. Worse,
  three test files extract names with `/registerTool\("([a-z_]+)"/g`, which would
  silently truncate `browser.status` to `browser` instead of failing.
- **The bridge pull-cadence comment was not stale; I was wrong.** It fairly
  approximated the pre-2026-09-24 250ms cadence (53 modelled with instantaneous
  polls, 49 at 20ms). Both cadences are now pinned in tests.