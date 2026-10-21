@last-edited: 2026-10-21 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

Simplify first, code second, comment third. Cover every button on every site, and grow the
capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

## State

- `main` = `origin/main`, and it is the sole remote branch again. Nine stale branches were
  removed on 2026-10-10 after each was measured: `main` was 1 to 277 commits ahead of every
  one, and none held a file `main` lacks. Every merge `--ff-only`.
- Version `1.6.27` in [`extension/manifest.json`](../extension/manifest.json) is the source
  of truth. [`check.mjs`](../scripts/check.mjs) also asserts the version the MCP server
  reports, the store form's four-part version, and that no module redeclares the secret
  regex.
- **1.6.27 shipped on 2026-10-15; `main` has not taken it yet.** Released from tag
  `v1.6.27` on commit `c35b20c`, which lives on `handoff-bridge`. Measured after the
  release: the signed CRX answers 200 at the update endpoint with an ETag equal to its own
  sha256, `update.xml` offers 1.6.27 for `ofgemipoobcnbjkfanmofjbdonjapmgl`, and the GitHub
  Release carries the extension zip, the source zip, the CRX and SHA256SUMS. Pull request
  #86 passed every gate with zero open issues and is `blocked` by the base-branch policy: it
  needs an owner approval, which an agent cannot give itself.
- **Eight pull requests are stacked and all wait for that one approval.** #87
  `handoff-bridge` -> #89 `download-clean` -> #90 `payload-trim` -> #91 `statement-job` ->
  #92 `first-bookkeepers` -> #94 `pilot-runbook` -> #95 `audit-tree-truth` -> #96
  `code-standard` (which carries #93 `audit-dead-code`, now closed). Each is green.
- **The standard is a test, not a document.** `tests/code-standard.test.mjs` measures four
  things: no source file over 1,200 lines (one named exception, the content script Chrome
  loads as a unit), no leftover markers, no twelve-line block repeated inside one file, and
  every exported function in `local/` exercised by the suite. The comment rule was
  unenforced where it mattered - the scanner miscounted one template literal - and it is
  enforced now.
- Gates: `npm test`, `npm run check` - 29 primitives, 177 runtime safety files, 1311 unit
  tests, green.
- Production, measured against the live database rather than the tree: 76 `opera_*`
  functions (65 `SECURITY DEFINER`), 18 `opera_*` tables, **8 deployed edge functions** -
  bridge 64, update 43, runner 46, mcp 95, auth 39, vm 37, gateway 19, listen 14.
- **The everyday Chrome is drivable at localhost speed.** `OPERA_LOCAL_TRANSPORT=bridge`
  runs the whole MCP surface over the everyday profile with no debugging flag and no cloud
  hop: `list_tabs` 7 ms, `read_page` 8 ms, `ax_snapshot` 95 ms, a burst of eight at 23 ms.
- **The statement job is the first product, and it is local.** `statement_card` names the
  file and the folder before the drive; `statement_delivered` verifies the file on disk -
  kind sniffed from the bytes, PDF pages counted from the file's own structure, closing
  balance recorded with the page named as its source - and appends the client-month to a
  manifest, refusing a second line for the same client-month. Measured on a local portal
  that asks for a password: the gate was detected, the drive stopped, the download landed
  renamed in 464 ms, the manifest held one row. See
  [`jobs/statements.md`](jobs/statements.md).
- **The pilot needs three bookkeepers, not more code.** The offer, the channel copy and the
  session checklist are written: [`product/first-three-bookkeepers.md`](product/first-three-bookkeepers.md)
  and [`product/pilot-runbook.md`](product/pilot-runbook.md). The unproven part is a real
  bank portal: only a fixture has been driven, and the cloud surface has no `download` and
  no statement calls, so a pilot runs on the client's own machine.
- **One CORS policy and one credential-shape check.** Every edge function resolves the
  origin per request through [`_shared/cors.js`](../supabase/functions/_shared/cors.js), and
  six modules import [`lib/secret-pattern.js`](../lib/secret-pattern.js); `check` fails if
  any module declares the pattern again.
- No management token or secret key in the tree. The signed-in pages carry the Supabase
  publishable key, which is public by design and allowlisted in `.gitleaks.toml`.
- `page.read` reports `userState` - `tabActive`, `windowFocused`, `watching`, `lastInputMs`
  - so the model can tell whether the person is looking at the tab. Fails open.
- **The plan path exists; the model call does not.** The model composes a plan once, the
  device executes it locally, so a task costs one round trip instead of one per step, and
  [`lib/goal-plan.js`](../lib/goal-plan.js) is the gate that shares the allowlist.
- **The bridge transport is a held `POST /poll`, not a WebSocket.** Chrome does not start a
  service worker for an inbound socket frame, so the socket stayed `OPEN` and heard
  nothing. Do not put a socket back on this road.
- **Cloudflare Pages at `opera-agent.pages.dev` serves the site; Vercel is the backup**, and
  `vercel.app` stays in the CORS allowlist and the redirect list.
- **A deploy is a dispatch, not a push.** [`deploy-site.yml`](../.github/workflows/deploy-site.yml)
  publishes `landing/` with `wrangler pages deploy` after the unit and syntax gates. A push
  that does not deploy fails silently: CI is green and production keeps the old build. The
  Vercel CLI cannot deploy this project: Root Directory is `landing`, so it resolves
  `landing/landing` and refuses.
- `landing/_headers` restates the `vercel.json` policy per path for Cloudflare Pages, every
  path enumerated so no rule overlaps another. Every response carries HSTS, a locked-down
  Permissions-Policy, same-origin COOP and CORP, `X-Frame-Options: DENY`, and a hash-named
  `script-src` in place of `unsafe-inline`. Re-hash both files after an inline script
  changes, or the page goes silent.
## Measured, not assumed

- **A publish step must fail loudly.** The CRX base64 exceeds 131,072 bytes, the Linux limit
  for one argument, so `node` died with "Argument list too long" and curl then had no body:
  the run went green having published nothing. `publish-crx.yml` now fails unless the status
  is 2xx.
- **Every MCP caller drives the one device named by `DEVICE_NAME`, and sign-up is open**, so
  the function admits the static token or a named account and nobody else. A rule admitting
  any confirmed account once sat undeployed in the repo, and a test now bars it.

## Still open

1. **The Cloudflare API token pasted into a chat is still live** and carries
   `Account API Tokens Write`. The owner has chosen to leave it for now.
2. **The migration ledger and the tree disagree on names.** Production holds 109 applied
   rows; the tree holds 101 files and only 42 share a version with a row, because files were
   renamed after they were applied (`yt_watch_v1` applied, `opera_agent_youtube_watch_summarize`
   in the tree). The schema itself matches the tree's last state - both private schemas
   exist, all 13 `docs.*` workflows are registered, `page.stream` is in `opera_methods`, and
   `opera_signal_device` is absent because a later migration drops it. A fresh rebuild from
   the tree replays renamed files, so the tree cannot prove which SQL produced the live
   schema. Owner decision: re-align the file names to the ledger, or accept the drift in
   writing.
3. **1.6.25 and 1.6.26 shipped to the update service but were never tagged**, never got a
   GitHub Release, and have no note under `docs/releases/`; the release notes jump from
   1.6.24 to 1.6.27.
4. **OAuth via OpenCode works end to end.** Authorize answers 302 to the consent page, the
   code exchanges for a one-hour token, and a tool call completes. Sign-in by Google is
   still unverified.
5. **MCP resolves one device per account and stamps the harness provider.**
   `X-Opera-Device` picks among the caller's devices. A real second account still wants its
   own test before opening access.
6. **Polling is the one latency lever.** 676.6 ms of 1875.3 ms average over 9,079 commands
   is the device not yet asking (`opera_claim_next_wait`, p95 1914.4 ms). Lower only after
   fleet impact.
7. **One-off writes run as `adhoc.*` ephemeral workflows.** Compile, register, start, poll,
   delete; lease plus sweeper bound every row. The compiler stays device-local and the key
   never leaves ([`security.md`](security.md)).
8. Publishable-key rotation still needs owner action. Edge deploy runs via the logged-in CLI.
9. **`browse.recon` ships the unknown-site order.** Detect, map, act, verify with
   total-stop CAPTCHA policy ([`unknown-site.md`](unknown-site.md)); 3x recurrence becomes a
   named-workflow candidate.
10. **The console dashboard's table editor is read-only by decision.** It reads sixteen
    tables through `SECURITY DEFINER` `opera_konsol_*` readers with zero table grants; a
    write side is the next move.
11. **The update endpoint answers in a nested query string.** Chromium sends
    `?x=id%3D<id>%26v%3D<version>`, so ask with `?id=ofgemipoobcnbjkfanmofjbdonjapmgl`.
12. **The price for a delivered client-month is undecided.** The pilot is free; the anchor
    in the outreach sheet is Rp 5.000 per client-month, or US$1.50 for the English market.

## CI

- Three gates on `ubuntu-24.04`, Node pinned to `22.20.0`: unit, secret-scan, browser
  (headed under `xvfb-run`). The concurrency group cancels an in-flight run when a newer one
  queues, so push, then wait.
- [`.gitleaks.toml`](../.gitleaks.toml) names paths and symbols that must exist. Re-point the
  allowlist when a file is renamed, never edit the fixture to dodge the scanner, and
  reproduce gitleaks 8.24.0 locally before a push.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim; `py` is 3.13 with playwright.
  The base-branch policy blocks every merge above until the owner approves #87.

## Do not touch

- `stash@{0}` - a paused pre-cutover state under an old milestone name: do not pop, apply, delete or build from it. `archive/*` tags are historical; never rewrite them.
