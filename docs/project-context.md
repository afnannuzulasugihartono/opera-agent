# Opera Agent durable context

> **Scope:** facts and traps that must survive because they cannot be recovered by
> reading the code. Not a session log, not an architecture description, not a
> history. Those live in `docs/context-archive.md`; what to do next lives in
> `docs/next-session-handoff.md`.
>
> Each entry below was learned the hard way and is worth more than a paragraph of
> description would be. Keep the file under roughly 100 lines.

## Toolchain facts

- **Deno is pinned to 2.9.6** at
  `C:\Users\ASUS\AppData\Local\Temp\opencode\deno296\deno.exe`. The machine's
  own `deno` is 2.1.4 and is unreliable for the gates. Never run `deno upgrade`.
  If the pinned binary disappears, re-extract it from that same directory's own
  `deno.zip` — do not download anything.
- **`npm test` globs `tests/*.test.mjs` and does not recurse.** The integration
  tests under `tests/postgres/` therefore never run in the fast suite, by design,
  because they need a live database. A new test placed in a subdirectory will
  silently never run.
- **The browser test needs `py` on Windows**, not `python`. CI calls `python`
  directly and is unaffected. `package.json`'s `test:browser` script documents the
  non-Windows invocation.

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
  focus` or `FOREGROUND_REQUIRED`. This was measured at a base commit with later
  changes stashed and **pre-exists them**. Do not attribute it to current work, and
  do not spend a session chasing it.

## How a claim gets accepted here

This is the rule that cost the most to learn. In three consecutive review rounds
every one of my own claims turned out to be stronger than the code:

1. A commit message asserted that a drift pin covered the carrier list. It did not
   exist. Proof: making `?apiKey=` a working carrier left every gateway test green.
2. The pin then written passed three realistic implementations, including
   `new URLSearchParams(...)`, while rejecting a legitimate non-token query
   parameter. It was rewritten to pin the carrier set positively, and its blind
   spots are now written into the test file rather than left implied.
3. The comment stripper had two shapes that silently deleted live code, which would
   have blinded a security lock while appearing to pass.

The rule that follows:

- A lock is **not accepted** until it has been made to fail on a realistic
  violation.
- A harness must test **both** directions — broken input that must be rejected and
  legitimate input that must be accepted. Testing rejection only hides inverted
  logic; a check that always returned false passed the first version.
- A file must not claim more than it delivers. If a test cannot see a case, say so
  in the test file instead of letting the commit message imply otherwise.

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
