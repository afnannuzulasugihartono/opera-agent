@last-edited: 2026-10-26 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main`. #112 and #113 (stacked on #112) are open and wait for the owner's
  merge; a branch starts from `main` and merges back by `--rebase` once the four checks are green.
- Version `1.6.27` in [`extension/manifest.json`](../extension/manifest.json) is the source
  of truth; [`check.mjs`](../scripts/check.mjs) also asserts the MCP version, the store form, and the secret regex.
- **1.6.27 shipped on 2026-10-15.** #86 merged as `e99bf5a`; the CRX route answers 200 with
  `x-opera-sha256` equal to the bytes, and the release carries both zips, the CRX and SHA256SUMS.
- **The standard is a test, not a document.** `tests/code-standard.test.mjs` bars a file over
  1,200 lines, leftover markers, a repeated block, and an unexercised export.
- **The comment rule is a formatter, not a scanner.** Column-zero blocks are section headers
  with a blank line around them; indented blocks document the code under them; a sentence is
  one line. The gate is `format(file) === file`, pinned by `tests/comment-format.test.mjs`.
- **#100 is green, and the landing styles have one home.** New-code duplication fell from
  9.2% to 2.0%, and the shared chrome, footer and download rules live in `landing/site.css`.
- **The dead code is gone, and a gate holds it.** `tests/hygiene.test.mjs` fails when a module
  with its own code is reached by nothing but its own test.
- **Every file says what it is.** All four header fields are on every walked source file; the
  gate fails on a scaffold word, a doubled name, or a missing field.
- **One home for each shared module, and a number a comment quotes has to exist.** The eight
  `lib/` files that only re-exported another module are gone, and
  `tests/comment-claims.test.mjs` refuses a quoted number held by nothing.
- **The repository carries what a reader and a reviewer need.** `tests/professional.test.mjs`
  fails a missing standard file, a pull request that skips CI, a CRLF file, or a dead path.
- **The browser drive depends on nothing but the page it drives.** A ref dies with its
  document, its route or the extension epoch, so the drive re-finds what it clicks.
- Gates: `npm test`, `npm run check` - 31 primitives, 183 runtime safety files, 1561 unit
  tests, green.
- **The local driver is modular, and its tests are too.** `local/primitives.js` assembles the
  modules; `tools.js` holds the MCP surface as data; the tests are one file per module.
- Production, measured against the live database: 76 `opera_*` functions (65
  `SECURITY DEFINER`), 20 `opera_*` tables, and **9 deployed edge functions**.
- **Somebody can pay for a delivered client-month.** `invoice_create` prices manifest rows and
  returns a signed link; it is the one door for a per-delivery bill and a plan month.
- **The everyday Chrome is drivable two ways.** `OPERA_LOCAL_TRANSPORT=bridge` runs the whole
  MCP surface over the extension, and a browser started with `--remote-debugging-port
  --user-data-dir` is driven over CDP directly at 23-42 ms against the bridge's 1.875 ms.
- **The statement job is the first product, and it is local.** `statement_card` names the file
  and folder; `statement_delivered` sniffs the kind, counts PDF pages, records the closing
  balance with its page named, and appends the client-month to a manifest, refusing a second
  line; `statement.download` does it on the device without a person watching. On a
  password-gated portal the gate was detected, the drive stopped, and the download landed
  renamed in 464 ms ([`jobs/statements.md`](jobs/statements.md)).
- **The pilot needs three bookkeepers, not more code.** The offer and checklist are in
  [`product/first-three-bookkeepers.md`](product/first-three-bookkeepers.md); only a fixture
  bank portal is proven, so a pilot runs on the client's machine.
- **The bridge is a WebSocket with a heartbeat, not a held `POST /poll`.** Chrome ends an idle
  service worker after about thirty seconds and an inbound frame does not wake it, so the
  server pings.
- **One CORS policy and one credential-shape check.** Every edge function resolves the
  origin through [`_shared/cors.js`](../supabase/functions/_shared/cors.js); six modules
  import [`lib/secret-pattern.js`](../lib/secret-pattern.js), and `check` bars a redeclaration.
- No management token or secret key in the tree; the signed-in pages carry the Supabase
  publishable key, which is public by design and allowlisted in `.gitleaks.toml`.
- `page.read` reports `userState` - `tabActive`, `windowFocused`, `watching`,
  `lastInputMs` - so the model can tell whether the person is looking. Fails open.
- **The drive reads a surface from evidence, not from a site name.**
  `surface_profile` answers canvas, editable, focus and the accessibility region with the
  number each was measured from; the ladder is `a11y -> dom -> select-all -> vision`, and
  select-all is the only step tagged `caret-move`, so it is skipped without
  `allowCaretMove` and the reason is reported. Measured 2026-10-27 on the everyday Brave at
  port 9333 against a real Google Doc: profile 42 ms, gated read 23-27 ms for 2.663
  characters with no caret touched, against the bridge's 1.875 ms. A canvas caret is not in
  the DOM, so `caretRestored` is never claimed; `tests/no-site-code.test.mjs` fails the
  build if a site name or a `.kix-` selector returns.
- **`run_task` ships the natural-language task door** (spec + plan under `superpowers/`): one MCP tool takes a task, the device compiles it with one device-local model call, the server executes the sealed artifact via the existing VM/adhoc lanes, verifies, saves a capped lesson. 35 cloud tools now.
- **Cloudflare Pages at `opera-agent.pages.dev` serves the site; Vercel is the backup**, and
  `vercel.app` stays in CORS; every `style-src` allows `'self'` and the features page counts
  35 tools, 31 primitives and six permissions, against the code.
- **A deploy is a dispatch, not a push.** [`deploy-site.yml`](../.github/workflows/deploy-site.yml)
  publishes `landing/` with `wrangler pages deploy` after the unit and syntax gates; a push
  that does not deploy leaves CI green and the old build live. The Vercel CLI cannot deploy.
- `landing/_headers` restates the `vercel.json` policy per path, with HSTS, a locked-down
  Permissions-Policy, same-origin COOP and CORP, and `X-Frame-Options: DENY`.

## Measured, not assumed

- **A publish step must fail loudly.** The CRX base64 exceeds the Linux 131,072-byte
  argument limit, so `node` died and curl sent no body; the run went green having published
  nothing. `publish-crx.yml` now fails unless the status is 2xx.
- **Every MCP caller drives the one device named by `DEVICE_NAME`, and sign-up is open**, so
  the function admits the static token or a named account and nobody else, and a test bars
  any wider rule.

## Still open

1. **The Cloudflare API token pasted into a chat is still live** and carries
   `Account API Tokens Write`. The owner has chosen to leave it for now.
2. **The migration ledger is mapped.** Measured 2026-10-26: 107 tree files against 113
   applied versions; `supabase/migrations/ledger-map.json` names the version that applied each
   file with its evidence — 103 proved, 2 with no ledger row, 2 applied outside the ledger (SQL
   in the database, no row). `tests/migration-ledger-map.test.mjs` fails a file the map omits.
3. **OAuth via OpenCode works end to end.** Authorize answers 302 to the consent page, the
   code exchanges for a one-hour token, and a tool call completes. Google sign-in is unverified.
4. **MCP resolves one device per account and stamps the harness provider.**
   `X-Opera-Device` picks among the caller's devices. A real second account still wants a test.
5. **Polling is the one latency lever.** 676.6 ms of 1875.3 ms average over 9,079 commands is
   the device not yet asking (`opera_claim_next_wait`, p95 1914.4 ms).
6. **One-off writes run as `adhoc.*` ephemeral workflows.** Compile, register, start, poll,
   delete; the compiler stays device-local and the key never leaves ([`security.md`](security.md)).
7. Publishable-key rotation still needs owner action. Edge deploy runs via the logged-in CLI.
8. **`browse.recon` ships the unknown-site order.** Detect, map, act, verify with
   total-stop CAPTCHA policy ([`unknown-site.md`](unknown-site.md)).
9. **The console dashboard's table editor is read-only by decision.** It reads sixteen
    tables through `SECURITY DEFINER` `opera_konsol_*` readers; a write side is next.
10. **The update endpoint answers in a nested query string.** Ask with
    `?id=ofgemipoobcnbjkfanmofjbdonjapmgl`.
11. **The price is decided and applied.** `plan.pilot` Rp 99.000 up to 15 client-months,
    `plan.firm` Rp 249.000 up to 50, extra Rp 10.000; invoiced after the first accepted batch,
    and none has arrived.
12. **A bridged window on the taskbar is restored, not refused.** `tabs.activate` reads the
    window first and sends `state: 'normal'` with the focus ask when it is minimized, because
    `focused: true` alone was measured to leave it there; the live suite proves the restore.
13. **A sandbox payment closes a real invoice on the provider's signature; production has not.**
    Driven 2026-10-26: a QRIS payment of Rp 99.000 through the simulator; `Uji Sandbox:2027-08`
    was `paid` at 09:22:30.476 by the signed settlement, every notification written to
    `opera_notification_log`. The first rule used an HMAC with the server key while Midtrans
    documents `SHA512(order + status + amount + key)`, so real notifications were refused; the
    formula is now the provider's and the log reads `the provider signed it`. The page is served
    at `opera-agent.pages.dev/invoice`: a live link's refresh added no attempt, a forced-expired
    link opened attempt 2 while attempt 1 answered `expire`, its late expire notification cleared
    nothing, and a payment through attempt 2 closed `Uji Sandbox:2027-09` with its method and
    transaction id. No real money has moved: production is `[UNVERIFIED]`.

## CI

- Three gates on `ubuntu-24.04`, Node pinned to `22.20.0`: unit, secret-scan, browser
  (headed under `xvfb-run`); a newer push cancels the in-flight run, so push, then wait.
  Every pull request runs them here; the lower stack filters on `main` until #105.
- [`.gitleaks.toml`](../.gitleaks.toml) names paths and symbols that must exist. Re-point
  the allowlist when a file is renamed, never edit the fixture to dodge the scanner, and
  reproduce gitleaks 8.24.0 locally before a push.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim; `py` is 3.13 with playwright.
  The owner merges #87 and the chain; the agent does not merge pull requests on its own.

## Do not touch

- `stash@{0}` - a paused pre-cutover state: do not pop, apply, delete or build from it.
  `archive/*` tags are historical; never rewrite them.
