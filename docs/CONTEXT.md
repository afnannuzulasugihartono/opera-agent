Last edited: 2026-10-04 17:52.

# CONTEXT

Simplify first. State what is true now, never its history.

Cover every button on every site. After the main sites hold, add sites that teach new functions.

Related: [AGENTS.md](../AGENTS.md) rules - [HANDOFF.md](HANDOFF.md) last session - [runbook.md](runbook.md)

> Facts that must survive because they cannot be recovered by reading the code.
> Next action: [HANDOFF.md](HANDOFF.md). Session logs: git history.

## Toolchain

| Fact | Consequence |
|---|---|
| Deno pin 2.9.6 is gone, not restorable locally; only an unreliable 2.1.4 remains | Never `deno upgrade`; `deno lint`/`check` rest on CI |
| `npm test` globs `tests/*.test.mjs` without recursing | A new test in a subdirectory silently never runs |
| Browser harness needs `py` on Windows, not `python` | `py tests/browser_extension_test.py` |
| `node --check` exits 0 on a broken `.ts` | `npm run check` is the gate that actually works |

## PowerShell traps (each one produced a wrong answer)

| Trap | Fix |
|---|---|
| An alias outranks a function (`h` beat a defined `H`) | Check `Get-Alias` before defining a short name |
| `Invoke-RestMethod` already parses JSON | `.Content` is `$null`; use `Invoke-WebRequest -UseBasicParsing` |
| `ConvertFrom-Json` needs `-InputObject` | A pipe returns arrays nested one level deeper |
| `>` and `Add-Content` write UTF-16 and corrupt UTF-8 | `[IO.File]::AppendAllText` with explicit no-BOM UTF-8 |
| `gh api --jq` breaks under PowerShell quoting | Quote the jq expression separately |

## Git and history

| Trap | Consequence |
|---|---|
| `origin/main` rejects merge commits | Every merge is `--ff-only`; rebuild linearly by cherry-pick |
| A stale remote branch hides indefinitely | Check the whole branch list, not a prefix, then archive before deleting |

## Facts that contradict a comment

| Fact | Consequence |
|---|---|
| No gateway route reads the query string — `extractToken` checks `x-opera-agent-token`, `Authorization`, then `body.apiKey` | `?apiKey=` is not a token carrier anywhere |
| Nothing ever writes `status = 'disabled'` to `opera_devices`; only `'online'` is written | Re-enabling a device is owner-only, direct SQL; `[tests/device-status-truth.test.mjs](../tests/device-status-truth.test.mjs)` fails on purpose if a write path appears |
| There is no scheduler — no `pg_cron`, no `cron.schedule`, no caller of the cleanup functions | No data class is purged automatically |

## Gate signals

| Trap | Consequence |
|---|---|
| GitHub combined status reads `success` while a check-run is pending or red — already one recorded false-green | Read per-context statuses, never the roll-up |
| A green local suite is not acceptance | Acceptance is GitHub Actions plus Vercel SUCCESS on the exact evidence head |
| The headed-Windows harness fails with `page.pointer stole browser focus` or `FOREGROUND_REQUIRED`, measured with later changes stashed | Pre-existing; do not attribute it to current work |

## What makes a claim acceptable here

- A lock is not accepted until it fails on a realistic violation.
- A harness must test both directions; rejection-only testing hid inverted logic.
- A file must not claim more than it delivers.
- If a test cannot see a case, say so in the test file.

## Measurements

- All latency numbers live in [`benchmarks.md`](benchmarks.md), local and production.
  This file records only the traps around taking them.
- `tests/real_site_smoke.py` drives the extension through a **local mock bridge**, so it
  measures the extension's own cost, not a network round trip. A production speed claim
  cannot come from it.
- The burst-versus-separate-calls ratio moved above and below 1 between runs, so this
  harness can establish no ordering. Local and production timings disagree about what
  matters; a latency claim has to say which one it measured.
- `opera_claim_next` has no `pg_sleep` and returns immediately. The wait is in
  `opera_claim_next_wait`, called by the bridge. Measuring the wrong one of two
  similarly named functions answers nothing.
- The slowest non-navigation primitive is `page.scroll`, which waits for lazy DOM
  changes to settle. First place to look for a win on the extension side.

## Real sites, measured

- Google sign-in is **two steps**: the first screen has only "Email or phone" and a
  Next button, and the password field appears afterwards. A login case that asserts a
  password box on the first read fails on Google's own flow, not on a defect.
- GitHub's sign-in screen lists "Sign in with a passkey" before the password submit,
  so a first-match label lookup picks the passkey button. Match on the exact label.
- YouTube's search field carries role `combobox`, not `searchbox`. Anything that
  filters on role must accept both or it will not see the one field on the page.
- `media.play` on a document the user never interacted with is refused by Chrome's
  autoplay policy, in Chrome's own words. A trusted click on the player is the gesture
  it wants, and it starts the video.
- On a page whose header re-renders continuously, a ref read in one round trip is
  stale by the time the click runs, and re-finding in a second round trip is equally
  stale. `find` plus `click` with `refFromStep` inside one `browser.burst` is what
  works, and it succeeded on every control that failed the other way.
- A refused `not-found` ref costs the full deadline, about 7.5s: the same ref
  retried five times over 38 seconds never resolved. Fail-fast is an owner
  decision (`waitedMs >= 3000` is a deliberate tested contract), so avoid the
  refusal with a single-call burst.

## Deployment and platform

| Trap | Consequence |
|---|---|
| CI never applies migrations | Migration first, then deploy, or an edge function calling a new RPC fails outright |
| The Supabase migration API ignores the filename version, stamps one from apply time, and puts the whole filename in `name` | Apply, then `update` the row, or every migration reads unapplied forever and `db push` re-runs them all |
| Supabase has no API for personal access tokens; `/v1/oauth/revoke` is OAuth-only | An agent holding a PAT cannot rotate or revoke it; plan for owner action |
| Renaming `opera_*` is a production migration — 58 functions in `public`, the prefix load-bearing in every RPC | Plus the freeze cost: `tests/fixtures/*.json` pin `sourceSha256`, `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` pins runtime files by blob SHA |
| The Chrome debugger banner persists for the whole attachment and cannot be hidden | Caching an attach across commands is a regression, not an optimisation; the only lever is batching more work per attach |
| Edge functions run on Supavisor transaction mode, which has no `LISTEN/NOTIFY` | Every wakeup is server-side `pg_sleep` polling |
| OpenAI reportedly rejects `.` in MCP tool names (`^[a-zA-Z0-9_-]+$`, a developer report, not official) | Treat dotted names as unverified against OpenAI until actually tested |
| A headed browser on Windows reports no focused window whenever the OS moves focus elsewhere | Comparing two focus reads then reports a steal that never happened. A steal must also end with something focused: the runtime can only add focus, so nothing focused means the host withdrew it |
| A sweep that dedupes on a truncated display label while filtering on the full label | One control consumes the whole click budget and the summary reads as a low response rate. Here 12 clicked / 2 responded was really 1 control clicked 11 times; the true figure was 8 of 9 |

## Blind alleys

| Explored | Outcome |
|---|---|
| `npm audit` and SBOM quarantines | Investigated and exonerated |
| Renaming the 22 MCP tools to dotted form | Declined — they deliberately differ from primitives, and three tests extract names with `/registerTool\("([a-z_]+)"/g`, which would silently truncate instead of failing |
| The bridge pull-cadence comment as stale | It fairly approximated the earlier cadence, and both cadences are now pinned in tests |
