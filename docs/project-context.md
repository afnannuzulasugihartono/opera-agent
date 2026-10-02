# Opera Agent durable context

> **Scope:** facts and traps that must survive because they cannot be recovered by
> reading the code. Not a session log, not an architecture description, not a
> history. Those live in `docs/context-archive.md`; what to do next lives in
> `docs/next-session-handoff.md`.
>
> Each entry below was learned the hard way and is worth more than a paragraph of
> description would be. Keep the file under roughly 120 lines.

## Toolchain facts

- **Deno is pinned to 2.9.6** at
  `C:\Users\ASUS\AppData\Local\Temp\opencode\deno296\deno.exe`. The machine's
  own `deno` is 2.1.4 and is unreliable for the gates. Never run `deno upgrade`.
  If the pinned binary disappears, re-extract it from that same directory's own
  `deno.zip` — do not download anything.
- **`npm test` globs `tests/*.test.mjs` and does not recurse.** The integration
  tests under `tests/postgres/` therefore never run in the fast suite, by design,
  because they need a live database. A new test in a subdirectory silently never runs.
- **The browser test needs `py` on Windows**, not `python`. Do not use
  `npm run test:browser` on this machine; run `py tests/browser_extension_test.py`
  directly. CI calls `python` and is unaffected.

## Branch and history traps

- **`origin/main` rejects merge commits.** Any merge into `main` must be
  `--ff-only`, and history that has to be rebuilt has to be rebuilt linearly by
  cherry-pick. This has already cost one full rebuild.
- **A stale remote branch can hide indefinitely.** A previous cleanup swept
  `chore/*` and missed a `feat/*` branch that was fully contained in `main`. Check
  the full branch list, not a prefix, and archive before deleting.

## Facts that contradict a code comment

- **No gateway route reads the query string.** `extractToken` checks
  `x-opera-agent-token`, then `Authorization`, then `body.apiKey`. `?apiKey=` is
  not a token carrier on any route. The gateway's own header comment used to
  claim otherwise and was corrected in Phase 5.
- **Nothing in the repository ever assigns `status = 'disabled'`** to
  `opera_devices`. Only `'online'` is written. The `disabled` state is reachable
  only by direct SQL. This is why re-enabling a disabled device is owner-only, and
  it is locked by `tests/device-status-truth.test.mjs`, which fails on purpose if a
  write path is ever added.
- **There is no scheduler.** `pg_cron` is not installed, no `cron.schedule`
  exists, and nothing in the repository calls `opera_goal_cleanup`,
  `opera_vm_cleanup`, or `opera_vm_expire`. No data class is purged automatically.

## Known flake

- The headed-Windows browser harness can fail with `page.pointer stole browser
  focus` or `FOREGROUND_REQUIRED`. Measured at a base commit with later changes
  stashed, so it **pre-exists them**. Do not attribute it to current work.

## Gate-signal traps

- **GitHub combined status can read `success` while a check-run is still pending
  or red.** This has already produced one recorded false-green in this repository.
  Read the per-context statuses, never the roll-up. A session that trusts the
  roll-up can accept a head whose `ci-unit` is still running.
- **A green local suite is not acceptance.** Acceptance is CircleCI plus Vercel
  SUCCESS on the exact evidence head.

## How a claim gets accepted here

The rule that cost the most to learn. How it was arrived at is in
`docs/context-archive.md`; three review rounds in a row produced claims stronger
than the code, and the Phase A measurement repeated the pattern three more times.

- A lock is **not accepted** until it has been made to fail on a realistic
  violation.
- A harness must test **both** directions — broken input that must be rejected and
  legitimate input that must be accepted. Testing rejection only hides inverted
  logic; a check that always returned false passed the first version.
- A file must not claim more than it delivers. If a test cannot see a case, say so
  in the test file instead of letting the commit message imply otherwise.

## Deployment and platform traps

- **CI does not apply migrations.** `.circleci/config.yml` runs only `deno lint` and
  `deno check`; there is no `supabase db push` and no project link. Migrations are
  applied by hand and `docs/runbook.md` treats that as an owner-only environment
  change. So a change that makes an edge function call a new RPC has a hard ordering
  requirement: migration first, then deploy, or the control path fails outright.
- **The Chrome debugger banner cannot be hidden** — it persists for the whole
  attachment, and Chrome's guidance is attach-during-a-task, detach-immediately
  after. So caching an attach across commands is a product regression, not an
  optimisation; the only lever is batching more work per attach.
- **Edge functions run on Supavisor transaction mode, which does not support
  `LISTEN/NOTIFY`.** Any wakeup has to be server-side `pg_sleep` polling, which
  already is this repository's established pattern.
- **OpenAI reportedly rejects `.` in MCP tool names** (`^[a-zA-Z0-9_-]+$` per a
  developer report, not an official document) while MCP's spec permits dots.
  Treat dotted names as unverified against OpenAI until actually tested.

## Blind alleys already explored

Recorded so a later session does not repeat them.

- `npm audit` and SBOM quarantines were investigated and exonerated.
- The gated `node --check` exits 0 on a broken `.ts` file — `scripts/check.mjs`
  is the gate that actually works.
- `gh api --jq` breaks under PowerShell quoting; use raw JSON with
  `ConvertFrom-Json`.
- The `pinned deno` binary vanished once and was restored from its own zip, not
  re-downloaded.
- Two stale git worktrees (`.kilo/worktrees/exclusive-vacation` and a temp one)
  held 3.7 MB of duplicate tree. Both were verified clean and fully merged, then
  removed with `git worktree remove`.
- **Renaming the 22 MCP tools to dotted form was investigated and declined.** They
  deliberately differ from the primitives and follow no rule: some reverse word
  order (`list_tabs`/`tabs.list`), some are renamed outright
  (`click_element`/`page.click`), four pointer tools share one primitive.
  Restructuring buys no consistency, and three test files extract names with
  `/registerTool\("([a-z_]+)"/g`, which would silently truncate `browser.status` to
  `browser` instead of failing.
- **The bridge pull-cadence comment was not stale; I was wrong.** It described the
  pre-2026-09-24 250ms cadence, and its "~52 calls, ~13k claims/hour" fairly
  approximates that old loop (53 modelled with instantaneous polls, 49 at 20ms).
  Superseded on 2026-10-02 and both cadences are now pinned in tests.
