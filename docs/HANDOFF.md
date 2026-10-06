@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# HANDOFF

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

Simplify first, code second, comment third. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.


> What is true now and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main`, sole remote branch, every merge `--ff-only`.
- Version `1.6.15` in `[extension/manifest.json](../extension/manifest.json)` is the source of truth.
- Local gates: `npm test`, `npm run check` ok — 26 primitives, 99 runtime safety files, 531 unit tests.
- Production database: 58 `opera_*` functions, 9 edge functions, each with a repo
  counterpart. The account RPCs the dashboard calls are live and reachable by name.
- No management token or secret key in the tree. The four signed-in and consent pages carry the
  Supabase publishable key, which is public by design and allowlisted in
  [`../.gitleaks.toml`](../.gitleaks.toml).
- `page.read` reports `userState` — `tabActive`, `windowFocused`, `watching` — so the
  model can tell whether the person is looking at the tab before choosing foreground or
  background. Fails open: a missing `userState` is a gap in the report, not a failure.
- **The plan path exists; the model call does not.** Owner decision: the model composes a
  plan once, the device executes it locally, so a task costs one round trip instead of one
  per step. [`lib/goal-plan.js`](../lib/goal-plan.js) is the gate between model text and
  that execution, and it shares the same allowlist so the two cannot drift.
- The blank-line comment rule is a lock, not a habit:
  `[tests/helpers/comment-spacing.mjs](../tests/helpers/comment-spacing.mjs)` classifies
  each line per dialect and `[tests/hygiene.test.mjs](../tests/hygiene.test.mjs)` asserts
  the gap. It walks the filesystem, so a file written minutes ago is checked too.

## Measured, not assumed

- The account and device pages are separate files, and the provider identity is read from
  `app_metadata.providers` rather than `provider`. Both locked where the reason is.
- `Intl.RelativeTimeFormat.prototype.format()` takes CLDR unit identifiers, not localised
  names. Passing "menit" throws at call time, inside the loop that builds the device cards,
  so the live dashboard showed "1 device ter-pairing" above an empty list. Both signed-in
  pages now pass CLDR units. Locked by tests/landing-execution.test.mjs, which executes each
  page's own module against a stub DOM and asserts the rendered output.
- A Supabase access token lasts about an hour and the site holds no SDK to renew it, so an
  aged token read as signed out and was deleted: the reader was signed out roughly hourly
  with no explanation. All four signed-in pages now store the refresh token and renew it,
  and forget both halves only when renewal is also refused. Locked by
  `[tests/landing-execution.test.mjs](../tests/landing-execution.test.mjs)`, which executes the
  renewal against a stub Auth because the failure mode is a silent deletion.
- The MCP OAuth client is registered dynamically by OpenCode, which picks a new random
  localhost port each run and reuses its cached registration. Deleting the client row to force
  a re-registration therefore makes it worse: GoTrue answers `oauth_client_not_found`. Restoring
  the row by hand needs a non-null `client_secret_hash`, or a public client answers
  `error validating client`. Redirect URIs are a comma-separated list with no wildcards.
  `OPERA_AGENT_MCP_TOKEN` is already configured on the edge function, and using it as a bearer
  header in the MCP config removes the dance entirely.
- Account isolation has two measured layers: `authenticated` holds no grant on the tables,
  only EXECUTE on the RPCs, and RLS filters by ownership for the day a grant appears. A
  foreign account read zero devices and was refused a revoke; anon got 401 on all four.
- Two live-endpoint defects found and fixed, both locked in
  `[tests/landing-dashboard.test.mjs](../tests/landing-dashboard.test.mjs)`: a fresh GRANT
  lands on PUBLIC so anon could call every RPC, and two overloads of the pairing issuer
  made PostgREST answer PGRST203.
- **The site is served from Cloudflare Pages at `opera-agent.pages.dev`, and Vercel is the
  backup host.** Measured live: the home page, `/auth` and `/oauth/consent` all answer 200,
  and the installer downloads at 18,432 bytes, byte-identical to
  `[landing/OperaAgent-Installer.exe](../landing/OperaAgent-Installer.exe)`. `opera-agent.vercel.app`
  still answers 200 and is kept as the second host.
- **Cloudflare is the front door because Vercel's budget was exhausted**, and the site's
  origin moved with it: `[extension/lib/endpoints.js](../extension/lib/endpoints.js)` `SITE_ORIGIN`,
  `[supabase/config.toml](../supabase/config.toml)` `site_url`, and the production GoTrue
  `site_url` are all `https://opera-agent.pages.dev`. `vercel.app` stays in the CORS allowlist
  in `[supabase/functions/_shared/cors.js](../supabase/functions/_shared/cors.js)` and in the
  Supabase redirect list, so a login or an install that still names the old host keeps working.
  Measured: the Google authorize endpoint accepts `redirect_to` on both hosts.
- **A deploy is a dispatch, not a push.** `[.github/workflows/deploy-site.yml](../.github/workflows/deploy-site.yml)`
  publishes `landing/` with `wrangler pages deploy` and runs the unit and syntax gates first.
  CI still runs on every push; a deploy happens when someone asks for one. It cannot be a
  Git integration because an existing Direct Upload project cannot be switched to one.
- **Releases fire on a `v*` tag, and only that.** `release.yml` verifies the
  signed CRX `publish-crx.yml` inserted, packs the source and extension
  archives, and publishes the GitHub release. The old `release-trigger/**`
  path nudge on `main` is gone with its scaffold; the packing workflow stays
  dispatch-only because it needs `CF_TOKEN`, the signing key and the owner's
  call.
- **Packing a CRX and publishing it is now a workflow.**
  `[.github/workflows/publish-crx.yml](../.github/workflows/publish-crx.yml)` packs with the
  `CRX_SIGNING_KEY` secret, refuses to publish unless the signature resolves to the same id
  the manifest declares, inserts the `opera_releases` row, and then confirms the served
  bytes. It activates nothing else: 1.6.14 under the old id is self-consistent and must
  keep serving installs that never updated.
- **A release touches no file on the site.**
  `[supabase/functions/opera-agent-update/index.ts](../supabase/functions/opera-agent-update/index.ts)`
  serves `/download/opera-agent.crx` and `/download/opera-agent.zip`, both answering with the
  active row for the current identity and both naming the version in `Content-Disposition`,
  so a reader's saved file says which build it is. The archive is the payload sliced out of
  the signed CRX after its header — those bytes are already a zip — so no second copy of the
  extension exists to fall out of step. Proved by clearing the row's `active` flag and
  watching the path answer 404, then restoring it. The two hosted artefacts and the header
  rules that pinned them for a year are deleted; the installer is the only binary the site
  still hosts, because its bytes do not change on a release and its digest can stay printed.
- **The outage cause, so it cannot repeat silently:** the repo is connected to Vercel, so
  every push auto-deploys, and the project Root Directory was unset, so each push built
  the repository root, which has no `index.html`. Every path answered 404 the moment a
  push replaced a good CLI deployment. Root Directory is now `landing`.
- The OAuth permission screen is a page of the site at `/oauth/consent`, not a separate
  deployment. GoTrue builds that URL as SiteURL + `authorization_path` and validates the
  origin of every consent call against its Site URL, so a screen on another host renders
  but can never approve anything. Locked by
  `[tests/landing-consent.test.mjs](../tests/landing-consent.test.mjs)`.
- A push that does not deploy fails silently: the commit is on main, CI is green, and
  production keeps serving the previous build. Check the live content, not the push status.
  The Vercel project stays as the backup host with its automatic deployment off in
  `[landing/vercel.json](../landing/vercel.json)`; its CLI cannot deploy this project at all,
  because Root Directory is `landing`, so it resolves `landing/landing` and refuses.
- `landing/_headers` restates the `vercel.json` policy per path for Cloudflare Pages, every path
  enumerated so no rule overlaps another and no rule-ordering trap exists. Locked by
  `[tests/landing-hosting.test.mjs](../tests/landing-hosting.test.mjs)`. No `_redirects` file is
  needed: Pages resolves an extensionless URL to the matching `.html` and serves `404.html`
  for anything unmatched, redirecting with a 308 that a client following redirects resolves.
- **The site was relayout to the Apple standard: display type, pill buttons, wide console,
  generous space, and a hero that swaps.** Home decides signed-in or not from one
  `localStorage` read and no request, because the model key is typed on that page and a
  no-network promise is load-bearing. Dashboard and home carry `.wrap.wide` (1120px); the
  legal pages keep a 720px prose measure.
- **The site grew two missing doors and headers a stranger never sees.** `fitur`
  and `dukungan` are the same single-file, network-free shape as the rest of the
  site, covered by the same `_headers`/`vercel.json` catch-all, sitemap and footer
  locks, so the nav can link them from every page. Every response also carries
  HSTS, a locked-down Permissions-Policy, same-origin COOP and CORP, and
  `X-Frame-Options: DENY`, in addition to hash-named `script-src` that replaced
  `unsafe-inline` on inline scripts — injected inline script is refused while the
  one real inline module per page still runs, verified live in Chromium.
- **Two layout defects measured at 320px, both invisible in source review.** The six footer
  doors are written with no whitespace between their tags, so an inline row of anchors has no
  break opportunity and the margin spacing had nowhere to break: the footer ran 32px past the
  screen on every page. And `pre` is `white-space: pre`, which outranks the `overflow-wrap` on
  the `code` inside it, so the 118-character curl command on unduh ran 662px past it. Fixed
  with a flex gap on the footer row and `pre-wrap` on the box; all nine pages measured clean at
  320, 390, 768, 1280 and 1600.
- **The reveal motion hid the page from being printed.** Nothing scrolls a print preview, so
  every section below the first rendered blank, and find-in-page skips transparent text. A
  print media rule now shows every section. The motion on screen is unchanged, and it still
  bows out for `prefers-reduced-motion` and for any reader without JS.

## Known, not started

- `[tests/fixtures/mcp-contract-v1.json](../tests/fixtures/mcp-contract-v1.json)` pins `sourceSha256`
  for `[supabase/functions/opera-agent-mcp/index.ts](../supabase/functions/opera-agent-mcp/index.ts)`,
  asserted by `[tests/mcp-surface.test.mjs](../tests/mcp-surface.test.mjs)` and
  `[tests/semantic-engine.test.mjs](../tests/semantic-engine.test.mjs)`, and
  `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` pins `lib/` files by blob
  SHA. An edit to a pinned file re-cuts its digest in the same commit, or the suite fails. That
  whole-file digest is a change tax, not a defect detector: it approves a semantic change the moment
  it is re-frozen.

## Still open

1. **The signing key and the manifest key disagreed, and 1.6.15 shipped with it.** Chrome derives
   an installed extension's id from the key in `[extension/manifest.json](../extension/manifest.json)`,
   and the update endpoint serves a CRX under a path named after that id. The manifest still
   carried the old public key while 1.6.15 had been packed and signed with the rotated one, so
   an install landed on the old id, which the endpoint answered with 1.6.14, and could never
   move forward. Measured on the served bytes: the 1.6.15 CRX declared one id and was signed
   with another; 1.6.14, whose two agree, is the only prior CRX that was self-consistent.
   The manifest key is now the signing public key, and the digest lock in
   `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` is re-cut with it.
   Measured after republishing: the served 1.6.15 CRX resolves to
   `ofgemipoobcnbjkfanmofjbdonjapmgl` from both its manifest key and its signature, and the
   new id is offered 1.6.15 while the old id is still offered 1.6.14.
2. **`release.yml` could not have verified a CRX.** It fetched a hardcoded id path, which 404s
   now that the id is derived, and checked the download against a `docs/releases` digest file
   deleted in `23f63d2`. Both are fixed: the id is derived from the manifest key, and the
   digest compared is the ETag the update function already publishes, so the check needs no
   file in the tree.
3. **The Cloudflare API token pasted into a chat is still live** and carries
   `Account API Tokens Write`, which can mint further tokens. It must be revoked at
   dashboard.cloudflare.com and replaced with an account-scoped Pages token held as
   `CF_TOKEN`. It is set as a repository secret, and `CF_ACCOUNT_ID` beside it.
4. **OAuth sign-in has never been driven end to end by a human click.** GoTrue matches
   `redirect_uri` exactly and the port is pinned to `19876` in the OpenCode config for that
   reason; the authorize endpoint accepts a `redirect_to` on both hosts. What is unverified is
   the consent approval and the token exchange in the client.
5. **The installer GUI has never been run.** `[scripts/OperaAgentInstaller.cs](../scripts/OperaAgentInstaller.cs)`
   compiles to a real PE with a branded header, select-all and per-browser checkboxes, and a
   three-step progress bar, and `requireAdministrator` is set because `HKCU\Software\Policies`
   is `ReadKey` for this account. Unverified: the form itself, and whether Chrome reads the
   policy it writes. `chrome://policy` is where to look.
6. Publishable-key rotation — a production secret, untouched.
7. SonarCloud project access — the pre-existing New Code wall.
8. Supabase PATs and the login credentials for Google and GitHub need owner action; there
   is no Management API for PATs, and the live login cases only lack the submit.
5. **The one real latency lever, and it is a measurement we now apply.** Measured over 9,079
   production commands, 676.6 ms of the 1875.3 ms average is the device not yet having
   asked for the command, p95 1914.4 ms. That wait is the polling ramp inside
   `opera_claim_next_wait`. The owner picked the conservative ladder: ramp under 50 ms
   through the idle window, tail coarsened to 100 ms instead of 250 ms (migration
   `20261007000000_opera_agent_claim_wait_fast_tail`), taking p95 near 1000 ms at 10 idle
   polls per second. It is measured, not assumed: lower it further (50 ms / ~20 polls)
   only after confirming fleet impact.
7. **The plan path needs two owner inputs before it can run.** The endpoint, key and model
   name come from the user's own configuration on their device — no shared key, ever, since
   the product ships at scale — and `[security.md](security.md)` has to say plainly what
   leaves the device. After that the remaining work is the VM host: handing a compiled
   program to `opera_start_workflow` needs a new RPC, which is production shape.

## CI

- Three gates on `ubuntu-latest`: unit, secret-scan, browser. The browser gate runs the same
  harness headed under `xvfb-run`, because the branded Chrome in the image loads no unpacked
  MV3 extension and headless Chromium starts no MV3 service worker.
- `[.gitleaks.toml](../.gitleaks.toml)` names paths and symbols that must exist. Re-point the
  allowlist when a file is renamed; never edit the fixture to dodge the scanner.
- The concurrency group cancels an in-flight run when a newer one queues, so push, then wait.
- gitleaks 8.24.0 runs locally and is the gate worth reproducing before a push. CI checks out
  one commit, so `gitleaks detect --log-opts=-1` is what it sees; a full-history scan reports
  eight findings in files that were renamed or deleted long ago, which is why the allowlist
  names only paths the tree still has.
- **The unit gate is green at 531/531**, and the site relayout ships with it. The
  dead-export guard now scans `.ts` as well as `.mjs`, so it no longer flags eight
  symbols production edge functions import; the 18 truly dead symbols went with it,
  SHAs re-frozen.
- **Cloudflare applied none of `_headers` until it was one path per block.**
  Measured live twice: first no CSP anywhere (comma-joined lines match nothing),
  then CSP on some pages but defaults on the extensionless addresses (blocks
  named only the `.html` spelling). Both fixed, both locked, verified live on
  all eight addresses: our CSP plus `no-referrer` everywhere.
- **The site tells the truth now.** Auth answers `disable_signup:false`, so the
  invite-only copy, the per-result pricing with no billing behind it, and the
  privacy contact inventing a reply channel are all replaced with what is real.
  Plus the company surface: one embedded mark in nine heads, identical
  six-door footers, robots plus sitemap, share cards, theme color, dashboard out
  of quirks mode, navs marking the page.
- `publish-crx.yml` may sit `queued` for many minutes with a runner already assigned and no
  job started. Cancelling and re-dispatching clears it; the run itself is sound.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13.15 with
  playwright, and 3.12.10 installs per-user if a harness needs it.
- The per-machine Python install is broken on this machine: its `dev_AllUsers` MSI crashes
  with a stack overflow during file costing in both scopes. Repairing it is OS-level and
  needs the owner. Nothing in the repo depends on it.

## Do not touch

- `stash@{0}` — a paused pre-cutover state kept under an old milestone name. Do not
  pop, apply, delete, or build from it, and do not start its work implicitly.
- `archive/*` tags are historical; never rewrite them.
