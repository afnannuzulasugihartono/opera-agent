@last-edited: 2026-11-11 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main`. #112 and #113 (stacked on #112) are open and wait for the owner's
  merge; a branch starts from `main` and merges back by `--rebase` once the four checks are green.
- Version `1.6.37` in [`extension/manifest.json`](../extension/manifest.json) is the source of truth. **The hosted relay no longer blackholes on a stale pairing** (#225 merged): the pinned device now answers every call while it is live, a pin that names a sleeping browser is refused by name (`503 pinned_device_not_live`, naming the awake browsers and the header that reaches one), and `X-Opera-Device: any` is the caller asking for the freshest browser on purpose - the silent switch that handed the agent a tab id belonging to another browser is gone; `browser_status` merges presence and plan on every path and reports `device {name, source pin|freshest, pinned, ageMs, alternatives}`. **A revoked device leaves the account** (migration 20261110210000): the revoke writes the state `revoked`, `opera_my_devices` leaves it out, the relay never picks it, and the devices revoked before that state were marked the same way; the row stays for the history and pairing the same browser brings it back. **A device names the browser it really is** (1.6.37): the detection believes `navigator.brave` and the brand list before the user agent string, the heartbeat carries the name, and a new device takes its browser name. **A re-install of the extension keeps one device per browser** (1.6.37 on this branch): the dashboard writes `oa_device_id` to the browser's cookie jar, the content script mirrors it into storage, pair time sends both that and the legacy id, and `opera_pair_device` (10-argument overload, migration 20261110160000_opera_pair_cookie_identity.sql) adopts the legacy row in place — adoption refused across accounts. the 1.6.39 CRX is signed and published (the endpoint advertises it and serves the same bytes); npm stays unpublished. **The extension now updates itself**: Chromium never updates an extension loaded from a folder, so the reader gives one permission - the extension's own folder - and the worker writes a newer build over it and restarts itself (1.6.39); a hand-installed CRX is refused by Chromium (`CRX_REQUIRED_PROOF_MISSING`), so the signed package serves the update service and the managed machines, not a drag-and-drop. **The hosted road's presence half answers the truth now** (#228, merged and redeployed): `devicePresence` orders `nullsFirst: false`, so a never-seen row can no longer win `ORDER BY last_seen_at DESC LIMIT 1` — `browser_status` live reports `deviceStatus: online`, fresh `deviceLastSeenAt`, actual `extensionVersion` (was "offline / never / 1.6.33" while both browsers answered). The 13 stuck `queued` commands to the dead `opera` row (12 pings, 1 tabs.open, all expired) were expired via one bounded `UPDATE status='expired' WHERE status='queued' AND expires_at < now() AND device_id = (select id from opera_devices where device_name='opera')`. Thirteen ids, no deletes. The 1.6.36 **dashboard cookie `oa_device_id` is live** (deploy-site dispatch 42637200157) and the hosted road answers end to end in ~250-300 ms warm (enqueue → claimed → completed, measured per row); the tool round trip on this client measures ~8.8-9.2 s because of the edge/client path the gate forbade trading for SSE amputation (`command-event-stream`). **The plan is for sale, and only truth is sold** - the pricing page sells both ways (wallet top-up Rp10.000 and Plan Firm Rp249.000/month, QRIS, one payment, 30 days, no auto-renew); `opera_account_plans` carries `expires_at`/`source` (migration 20261110120000, ledger `20261109113407`), every plan gate degrades an expired plan to pilot, and on invoice settlement `opera-agent-billing` flips the account with a 30-day expiry (extends from the running expiry, or from now). `browser_status` carries the plan on both roads; the rebuilt dashboard opens with the plan hero under a Pelanggan/Operator rail, bilingual id/en. Verified against a local mock Supabase through a CDP-pointed Chrome (firm, exhausted, unreadable, phone width, both languages); the signed-in purchase itself waits for the owner's eyes on the live page. **The local drive works again** (#223): the bridge namespace clears 32-bit tab ids (a billion collided and blackholed every per-tab command), one browser is one device (a reconnect no longer double-lists it or double-bills the meter), and `tabs.get` is implemented on the loopback worker (the installed 1.6.35 CRX needs the next release to carry it; the bridge fix needs no rebuild). Live-proved in both browsers (namespaced ids round trip; CDP drive answers on real tabs). Frozen (Memory-Saver discarded) background tabs answer every CDP call with "no answer from the tab within 8000 ms" - activate or reload them first, or drive a fresh tab; a Chrome property, not a bridge bug.
- **1.6.27 shipped on 2026-10-15** as `e99bf5a`; the CRX route answers 200 with
  `x-opera-sha256` equal to the bytes, and the release carries both zips, the CRX and SHA256SUMS.
  The two releases published with no files on 2026-10-25 are drafts now, and `release.yml`
  counts the four files before it publishes and gives Latest to the newest version.
- **The standard is a test, not a document.** `tests/code-standard.test.mjs` bars leftover
  markers, a repeated block, and an unexercised export.
- **The comment rule is a formatter, not a scanner.** Column-zero blocks are section headers
  with a blank line around them; indented blocks document the code under them; a sentence is
  one line. The gate is `format(file) === file`, pinned by `tests/comment-format.test.mjs`.
- **#100 is green, and the landing styles have one home.** New-code duplication fell from
  9.2% to 2.0%; the shared chrome, footer and download rules live in `landing/site.css`.
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
- Gates: `npm test`, `npm run check` - 31 primitives, 203 runtime safety files, 1972 unit tests, green.
- **The local drive is metered where it happens.** The hello carries the paired credentials (1.6.32, published);
  the loopback bridge verifies the session once, enforces the allowance with the plan named in the refusal, and reports usage into the shared count;
  `opera-agent-mcp doctor` prints what is linked and the one fix when it is not.
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
- **The pilot needs three bookkeepers, not more code, and it runs on their machine.** The offer is
  [`product/first-three-bookkeepers.md`](product/first-three-bookkeepers.md); the fixture-portal run in
  [`../proof/run.md`](../proof/run.md) rebuilt four site files byte for byte; fixture portal only.
- **The bridge is a WebSocket with a heartbeat, not a held `POST /poll`.** Chrome ends an idle
  service worker after ~30 seconds and an inbound frame does not wake it, so the server pings.
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
- **The plan path exists; the model call does not.** The model composes a plan once and the
  device runs it locally; [`goal-plan.js`](../extension/lib/goal-plan.js) shares the allowlist.
- **Cloudflare Pages at `opera-agent.pages.dev` is the only host that serves the site**, and
  the Vercel deploy path is gone: no `vercel.json`, no `vercel.app` in CORS, no Vercel check on a pull request. Every `style-src` allows `'self'`, and the features page counts
  35 tools, 31 primitives and six permissions, against the code.
- **A deploy is a dispatch, not a push.** [`deploy-site.yml`](../.github/workflows/deploy-site.yml)
  publishes `landing/` with `wrangler pages deploy` after the unit and syntax gates; a push
  that does not deploy leaves CI green and the old build live.
- `landing/_headers` carries the policy per path, with HSTS, a locked-down
  Permissions-Policy, same-origin COOP and CORP, and `X-Frame-Options: DENY`.

## Measured, not assumed

- **A publish step must fail loudly.** The CRX base64 exceeds the Linux 131,072-byte argument limit, so `node` died and curl sent no body; the run went green having published nothing. `publish-crx.yml` now fails unless the status is 2xx.
- **Every MCP caller drives the one device named by `DEVICE_NAME`, and sign-up is open**, so the function admits the static token or a named account and nobody else, and a test bars any wider rule.

## Still open

0. **Both wires print the same K&R shape** (`{ ok, ...facts }`): the local stdio surface was migrated to `tidyForAi`; both surfaces answer one shape (`local/mcp-server.js`, gate `tests/code-standard.test.mjs`); a refused tool answers the same way on both roads (`{ ok: false, error: { code, message } }`), and every local answer carries its cost as `elapsedMs`. **Local dialog tools now work** - `local/primitives.js` never exported `dialogState`/`dialogType`/`dialogPress` (was `session.dialogState is not a function` on a live browser). Two machines added to `docs/state-machines.json`: `hosted-tab-ownership-rank` (**fixed**: the pinned device answers every call while it is live, a sleeping pin is a named `503 pinned_device_not_live` that names the awake browsers and the header to send, and `X-Opera-Device: any` asks for the freshest one on purpose; the local cloud road sends the pin from the paired device file) and `tools-output-shape` (envelopes diverged; now flat on both wires; rank 1). **Every `.md` is tidied repo-wide** (spacing, punctuation, structure, mojibake; CHANGELOG's missing 1.6.25/1.6.26 rows added) and three unreferenced scripts plus 15 dead exports are deleted or unexported; a mojibake purge ran across watch.js, site.css and _headers; every tracked file was walked once with an input→output read (gates green). The relay fix is live: `opera-agent-mcp` was deployed on 2026-11-10 from the main checkout, and the hosted check answers discovery 200, initialize 401 and authorize 302 (`proof/hosted-mcp.json`). The 1.6.37 CRX is published and the endpoint serves it; the browser takes it on its next update check. One step is left for the owner: paste a pairing code into the extension popup, so the browser's cookie identity is captured and a re-install keeps the same device. `npm test`, `check ok`, `comment format ok: 554 files`.

1. **The Cloudflare API token pasted into a chat is still live** and carries
   `Account API Tokens Write`. The owner has chosen to leave it for now.
2. **The migration ledger is mapped.** Measured 2026-10-26: 107 tree files against 113 applied
   versions, each mapped with its evidence - 103 proved, 2 with no ledger row, 2 outside the ledger;
   `tests/migration-ledger-map.test.mjs` fails a file the map omits.
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
    link opened attempt 2 while attempt 1 answered `expire`, its late expire cleared
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

## Do not touch

- `stash@{0}` - a paused pre-cutover state: do not pop, apply, delete or build from it.
  `archive/*` tags are historical; never rewrite them.
