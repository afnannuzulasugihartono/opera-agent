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
  reports, the store form's version, and that no module redeclares the secret regex.
- **1.6.27 shipped on 2026-10-15; `main` has not taken it yet.** Released from tag `v1.6.27`
  on commit `c35b20c`, which lives on `handoff-bridge`. Measured after the release: the
  signed CRX answers 200 at the update endpoint with an ETag equal to its own sha256, and the
  GitHub Release carries the extension zip, the source zip, the CRX and SHA256SUMS. Pull
  request #86 passed every gate and is `blocked` by the base-branch policy: it needs an
  owner approval, which an agent cannot give itself.
- **Seventeen pull requests are stacked and all wait for that one approval.** #87
  `handoff-bridge` -> #89 `download-clean` -> #90 `payload-trim` -> #91 `statement-job` ->
  #92 `first-bookkeepers` -> #94 `pilot-runbook` -> #95 `audit-tree-truth` -> #96
  `code-standard` -> #97 `monetization` -> #98 `device-delivery` -> #99 `money-path` ->
  #100 `comment-structure` -> #101 `dead-code` -> #102 `file-headers` -> #103 `one-home` ->
  #104 `comment-claims` -> #105 `repo-standard`. Each is green; #93 `audit-dead-code` is
  closed and #88 `research-agent-surface` stands apart.
- **The standard is a test, not a document.** `tests/code-standard.test.mjs` measures four
  things: no source file over 1,200 lines (one named exception, the content script Chrome
  loads as a unit), no leftover markers, no twelve-line block repeated inside one file, and
  every exported function in `local/` exercised by the suite.
- **The comment rule is a formatter, not a scanner.** A comment block at column zero is a
  section header and gets a blank line before and after it; an indented block documents the
  code under it; a sentence is one line, so a wrapped one is joined and a two-sentence one is
  split; a bare `//` between paragraphs is a blank line. The gate is `format(file) === file`
  over the whole tree, and the corpus that pins it is `tests/comment-format.test.mjs`.
- **The dead code is gone, and a gate holds it.** The gate in `tests/hygiene.test.mjs` fails
  when a module with its own code is reached by nothing but its own test.
- **Every file says what it is.** The four header fields are on all 280 source files: the
  title names the file and what it is, the state says what it holds rather than what a past
  commit did. The gate in `tests/hygiene.test.mjs` fails on a scaffold word, a doubled name, a
  commit message in the state, or a missing field.
- **One home for each shared module.** The eight `lib/` files that only re-exported another
  module are gone: the edge and the extension now import the shared file directly, and the
  Node suite reaches the same file rather than a pointer to it.
- **A number a comment quotes has to exist.** 216 comment lines quote a number, and every
  one of them is held by the code, a test or a file name. The gate in
  `tests/comment-claims.test.mjs` refuses a number nothing holds, so a measurement cannot
  be invented; a real measurement is allowed when the comment says where it was taken.
- **The repository carries what a reader and a reviewer need.** `tests/readme.test.mjs` reads
  the README's numbers back out of the code, and `tests/professional.test.mjs` fails a missing
  standard file, a pull request that skips CI, a CRLF file, or a document naming a dead path.
- **The browser drive depends on nothing but the page it drives.** A ref dies with its
  document, its route or the extension epoch, so the drive re-finds what it clicks.
- Gates: `npm test`, `npm run check` - 31 primitives, 177 runtime safety files, 1369 unit tests, green.
- Production, measured against the live database rather than the tree: 76 `opera_*`
  functions (65 `SECURITY DEFINER`), 20 `opera_*` tables, **9 deployed edge functions** -
  bridge 64, update 43, runner 46, mcp 95, auth 39, vm 37, gateway 19, listen 14,
  billing (one invoice page, one notification callback).
- **Somebody can pay for a delivered client-month.** `invoice_create` takes the manifest
  rows - not a typed number - prices them from `opera_price_list`, writes one invoice per
  customer per month, and returns a signed link the customer opens. Drilled live: two
  client-months became 1,000,000 cents and a page reading `Total Rp 10.000`; a forged
  signature, a wrong amount, an unsettled status and a replay after the key was removed
  were all refused, and a signed `settlement` marked the invoice paid. A small invoice
  (under Rp 100.000) opens straight into QRIS, because a fixed fee would eat it; a larger
  one offers the provider's list. The transaction carries a derived order id, because the
  readable invoice id has characters Midtrans refuses. The provider key is not set, so the
  Snap request itself is `[UNVERIFIED]` until a real key exists. Fees and the foreign-client
  paths are in [`product/billing.md`](product/billing.md).
- **The everyday Chrome is drivable at localhost speed.** `OPERA_LOCAL_TRANSPORT=bridge` runs the whole MCP surface over it.
- **The statement job is the first product, and it is local.** `statement_card` names the
  file and the folder before the drive; `statement_delivered` verifies the file on disk -
  kind sniffed from the bytes, PDF pages counted from the file's own structure, closing
  balance recorded with the page named as its source - and appends the client-month to a
  manifest, refusing a second line for the same client-month. Measured on a local portal
  that asks for a password: the gate was detected, the drive stopped, the download landed
  renamed in 464 ms. See [`jobs/statements.md`](jobs/statements.md).
- **The device delivers a statement without a person watching, and it is proven.** `statement.download`
  lets the extension download the file under the card's name, wait until the browser says it
  is whole, read the kind and the page count from the bytes the page fetched, and write one
  line into a manifest in the browser's own storage; `statement.manifest` reads it back. The
  cloud surface exposes them as `statement_deliver` and `statement_manifest`. Driven end to
  end in a real Chromium by the browser gate: 266 bytes, 2 pages, 388.9 ms, the card's name
  on disk, a second delivery refused.
- **The pilot needs three bookkeepers, not more code.** The offer, the channel copy and the
  session checklist are written: [`product/first-three-bookkeepers.md`](product/first-three-bookkeepers.md)
  and [`product/pilot-runbook.md`](product/pilot-runbook.md). The unproven part is a real bank
  portal: only a fixture has been driven, so a pilot runs on the client's own machine.
- **One CORS policy and one credential-shape check.** Every edge function resolves the origin per request through
  [`_shared/cors.js`](../supabase/functions/_shared/cors.js); six modules import [`lib/secret-pattern.js`](../lib/secret-pattern.js), and `check` fails if any module declares it again.
- No management token or secret key in the tree; the signed-in pages carry the Supabase publishable key, which is public by design and allowlisted in `.gitleaks.toml`.
- `page.read` reports `userState` - `tabActive`, `windowFocused`, `watching`, `lastInputMs` - so the model can tell whether the person is looking at the tab. Fails open.
- **The plan path exists; the model call does not.** The model composes a plan once and the
  device runs it locally, so a task costs one round trip; [`extension/lib/goal-plan.js`](../extension/lib/goal-plan.js) is the gate that shares the allowlist.
- **The bridge transport is a held `POST /poll`, not a WebSocket.** Chrome does not start a service worker for an inbound socket frame, so the socket stayed `OPEN` and heard nothing.
- **Cloudflare Pages at `opera-agent.pages.dev` serves the site; Vercel is the backup**, and `vercel.app` stays in the CORS allowlist.
- **A deploy is a dispatch, not a push.** [`deploy-site.yml`](../.github/workflows/deploy-site.yml)
  publishes `landing/` with `wrangler pages deploy` after the unit and syntax gates. A push
  that does not deploy fails silently: CI is green and production keeps the old build. The
  Vercel CLI cannot deploy this project: Root Directory is `landing`, so it resolves
  `landing/landing` and refuses.
- `landing/_headers` restates the `vercel.json` policy per path for Cloudflare Pages, every
  path enumerated so no rule overlaps another. Every response carries HSTS, a locked-down
  Permissions-Policy, same-origin COOP and CORP, `X-Frame-Options: DENY`, and a hash-named
  `script-src` in place of `unsafe-inline`.
## Measured, not assumed

- **A publish step must fail loudly.** The CRX base64 exceeds the Linux 131,072-byte argument limit, so `node` died with "Argument list too long" and curl sent no body; the run went green having published nothing. `publish-crx.yml` now fails unless the status is 2xx.
- **Every MCP caller drives the one device named by `DEVICE_NAME`, and sign-up is open**, so
  the function admits the static token or a named account and nobody else, and a test bars any
  wider rule.

## Still open

1. **The Cloudflare API token pasted into a chat is still live** and carries
   `Account API Tokens Write`. The owner has chosen to leave it for now.
2. **The migration ledger and the tree disagree on names.** Production holds 109 applied
   rows; the tree holds 101 files and only 42 share a version with a row, because files were
   renamed after they were applied. A fresh rebuild replays renamed files, so the tree cannot
   prove which SQL produced the live schema. Owner decision: re-align, or accept the drift.
3. **1.6.25 and 1.6.26 shipped to the update service but were never tagged**, never got a
   GitHub Release, and have no note under `docs/releases/`.
4. **OAuth via OpenCode works end to end.** Authorize answers 302 to the consent page, the
   code exchanges for a one-hour token, and a tool call completes. Google sign-in is
   unverified.
5. **MCP resolves one device per account and stamps the harness provider.**
   `X-Opera-Device` picks among the caller's devices. A real second account still wants its
   own test before opening access.
6. **Polling is the one latency lever.** 676.6 ms of 1875.3 ms average over 9,079 commands
   is the device not yet asking (`opera_claim_next_wait`, p95 1914.4 ms).
7. **One-off writes run as `adhoc.*` ephemeral workflows.** Compile, register, start, poll,
   delete; the compiler stays device-local and the key never leaves ([`security.md`](security.md)).
8. Publishable-key rotation still needs owner action. Edge deploy runs via the logged-in CLI.
9. **`browse.recon` ships the unknown-site order.** Detect, map, act, verify with
   total-stop CAPTCHA policy ([`unknown-site.md`](unknown-site.md)).
10. **The console dashboard's table editor is read-only by decision.** It reads sixteen
    tables through `SECURITY DEFINER` `opera_konsol_*` readers; a write side is next.
11. **The update endpoint answers in a nested query string.** Ask with
    `?id=ofgemipoobcnbjkfanmofjbdonjapmgl`.
12. **The price is decided and applied.** `plan.pilot` is Rp 99.000 for up to 15
    client-months, `plan.firm` is Rp 249.000 for up to 50, and an extra client-month is
    Rp 10.000. The invoice is issued after the first batch is accepted, so a failed
    batch is Rp 0. The first three transfers are the live proof; none has arrived yet.
    The public `invoice_create` tool still bills per delivery, so a plan invoice is sent
    to the function directly.

## CI

- Three gates on `ubuntu-24.04`, Node pinned to `22.20.0`: unit, secret-scan, browser
  (headed under `xvfb-run`). The concurrency group cancels an in-flight run when a newer one
  queues, so push, then wait. Every pull request runs them, whatever it targets.
- [`.gitleaks.toml`](../.gitleaks.toml) names paths and symbols that must exist. Re-point the
  allowlist when a file is renamed, never edit the fixture to dodge the scanner, and
  reproduce gitleaks 8.24.0 locally before a push.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim; `py` is 3.13 with playwright.
  The base-branch policy blocks every merge above until the owner approves #87.

## Do not touch

- `stash@{0}` - a paused pre-cutover state under an old milestone name: do not pop, apply, delete or build from it. `archive/*` tags are historical; never rewrite them.
