@last-edited: 2026-10-07 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

Simplify first, code second, comment third. Cover every button on every site, and grow the
capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

## State

- `main` = `origin/main`, sole remote branch, every merge `--ff-only`.
- Version `1.6.16` in [`extension/manifest.json`](../extension/manifest.json) is the source of truth.
- Gates: `npm test`, `npm run check` — 26 primitives, 100 runtime safety files, 533 unit tests, green.
- Production: 58 `opera_*` functions, 9 edge functions, each with a repo counterpart. Account RPCs
  are live and reachable by name.
- No management token or secret key in the tree. The four signed-in and consent pages carry the
  Supabase publishable key, which is public by design and allowlisted in `.gitleaks.toml`.
- `page.read` reports `userState` — `tabActive`, `windowFocused`, `watching` — so the model can tell
  whether the person is looking at the tab before choosing foreground or background. Fails open.
- **The plan path exists; the model call does not.** The model composes a plan once, the device
  executes it locally, so a task costs one round trip instead of one per step.
  [`lib/goal-plan.js`](../lib/goal-plan.js) is the gate between model text and that execution, and
  it shares the allowlist so the two cannot drift.
- The blank-line comment rule is a lock, not a habit:
  [`tests/helpers/comment-spacing.mjs`](../tests/helpers/comment-spacing.mjs) classifies each line
  per dialect and [`tests/hygiene.test.mjs`](../tests/hygiene.test.mjs) asserts the gap.

## Measured, not assumed

- The account and device pages are separate files, and the provider identity is read from
  `app_metadata.providers` rather than `provider`. Both locked where the reason is.
- `Intl.RelativeTimeFormat` takes CLDR unit identifiers, not localised names. Passing "menit"
  threw inside the loop that builds the device cards, so the live dashboard showed
  "1 device ter-pairing" above an empty list. Locked by
  [`tests/landing-execution.test.mjs`](../tests/landing-execution.test.mjs), which runs each page's
  own module against a stub DOM.
- A Supabase access token lasts about an hour and the site holds no SDK to renew it, so an aged
  token read as signed out and was deleted: readers were signed out hourly with no explanation.
  All four signed-in pages now store the refresh token and renew it, and forget both halves only
  when renewal is also refused.
- The MCP OAuth client is registered dynamically by OpenCode, which picks a new random localhost
  port each run. Deleting the client row makes it worse: GoTrue answers `oauth_client_not_found`.
  Restoring it by hand needs a non-null `client_secret_hash`. Redirect URIs are a comma-separated
  list with no wildcards. `OPERA_AGENT_MCP_TOKEN` is configured on the edge function, and using it
  as a bearer header removes the dance.
- Account isolation has two measured layers: `authenticated` holds no table grant, only EXECUTE on
  the RPCs, and RLS filters by ownership for the day a grant appears. A foreign account read zero
  devices and was refused a revoke; anon got 401 on all four.
- Two live-endpoint defects, both locked in
  [`tests/landing-dashboard.test.mjs`](../tests/landing-dashboard.test.mjs): a fresh GRANT lands on
  PUBLIC so anon could call every RPC, and two overloads of the pairing issuer made PostgREST answer
  PGRST203.
- **Cloudflare Pages at `opera-agent.pages.dev` serves the site; Vercel is the backup host.**
  Measured live: home, `/auth` and `/oauth/consent` answer 200, and the installer downloads at
  18,432 bytes, byte-identical to
  [`landing/OperaAgent-Installer.exe`](../landing/OperaAgent-Installer.exe). Cloudflare is the front
  door because Vercel's budget was exhausted. The origin moved with it:
  [`extension/lib/endpoints.js`](../extension/lib/endpoints.js) `SITE_ORIGIN`,
  [`supabase/config.toml`](../supabase/config.toml) `site_url`, and the production GoTrue
  `site_url`. `vercel.app` stays in the CORS allowlist
  ([`supabase/functions/_shared/cors.js`](../supabase/functions/_shared/cors.js)) and the Supabase
  redirect list.
- **A deploy is a dispatch, not a push.**
  [`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml) publishes `landing/`
  with `wrangler pages deploy` and runs the unit and syntax gates first. It cannot be a Git
  integration because an existing Direct Upload project cannot be switched to one.
- **Releases fire on a `v*` tag, and only that.** `release.yml` verifies the signed CRX
  `publish-crx.yml` inserted, packs the archives, and publishes the release.
- **Packing and publishing a CRX is a workflow.**
  [`.github/workflows/publish-crx.yml`](../.github/workflows/publish-crx.yml) packs with
  `CRX_SIGNING_KEY`, refuses to publish unless the signature resolves to the manifest's id, inserts
  the `opera_releases` row, then confirms the served bytes. The installer is the only binary the
  site hosts, because its bytes do not change on a release.
- **The outage cause, so it cannot repeat silently:** the repo is connected to Vercel, so every
  push auto-deploys, and Root Directory was unset, so each push built the repository root, which has
  no `index.html`. Every path answered 404 the moment a push replaced a good CLI deployment. Root
  Directory is now `landing`.
- A push that does not deploy fails silently: the commit is on main, CI is green, and production
  keeps serving the previous build. Check the live content, not the push status. The Vercel
  **CLI cannot deploy** this project at all, because Root Directory is `landing`, so it resolves
  `landing/landing` and refuses.
- `landing/_headers` restates the `vercel.json` policy per path for Cloudflare Pages, every path
  enumerated so no rule overlaps another. No `_redirects` is needed: Pages resolves an
  extensionless URL to the matching `.html` and serves `404.html` for anything unmatched.
- The site was relayout to the Apple standard: display type, pill buttons, wide console, and a
  hero that swaps. Home decides signed-in from one `localStorage` read and no request, because the
  model key is typed there and a no-network promise is load-bearing. `fitur` and `dukungan` are
  network-free doors under the same header, sitemap and footer locks.
- Every response carries HSTS, a locked-down Permissions-Policy, same-origin COOP and CORP, and
  `X-Frame-Options: DENY`, plus hash-named `script-src` that replaced `unsafe-inline`.
- **Two layout defects measured at 320px, both invisible in source review.** The footer anchors had
  no whitespace between tags, so the row ran 32px past the screen; and `pre` is `white-space: pre`,
  which outranks `overflow-wrap` on the `code` inside it, so the 118-character curl command ran
  662px past it. All nine pages now measure clean at 320, 390, 768, 1280 and 1600. The reveal motion
  also hid the page from print previews, which scroll nothing; a print media rule shows every section.
- The site tells the truth now: Auth answers `disable_signup:false`, so the invite-only copy, the
  per-result pricing with no billing behind it, and the invented privacy reply channel are replaced
  with what is real.

## Known, not started

- [`tests/fixtures/mcp-contract-v1.json`](../tests/fixtures/mcp-contract-v1.json) pins
  `sourceSha256` for the MCP edge function, and
  [`tests/helpers/boundary-locks.mjs`](../tests/helpers/boundary-locks.mjs) pins `lib/` files by
  blob SHA. An edit to a pinned file re-cuts its digest in the same commit. That whole-file digest
  is a change tax, not a defect detector.

## Still open

1. **The signing key and the manifest key disagreed, and 1.6.15 shipped with it.** An install landed
   on the old id, which the endpoint answered with 1.6.14, and could never move forward. The
   manifest key is now the signing public key, and the served 1.6.15 CRX resolves to
   `ofgemipoobcnbjkfanmofjbdonjapmgl` from both its manifest key and its signature.
2. **`release.yml` could not have verified a CRX.** It fetched a hardcoded id path and checked a
   digest file deleted in `23f63d2`. Both fixed: the id is derived from the manifest key, and the
   digest compared is the ETag the update function already publishes.
3. **The Cloudflare API token pasted into a chat is still live** and carries
   `Account API Tokens Write`. Revoke it at dashboard.cloudflare.com and replace it with an
   account-scoped Pages token held as `CF_TOKEN`.
4. **OAuth sign-in has never been driven end to end by a human click.** GoTrue matches
   `redirect_uri` exactly, so the port is pinned to `19876`. Unverified is the consent approval and
   the token exchange in the client.
5. **The installer GUI has never been run.**
   [`scripts/OperaAgentInstaller.cs`](../scripts/OperaAgentInstaller.cs) compiles to a real PE with
   `requireAdministrator` set. Unverified: the form itself, and whether Chrome reads the policy it
   writes. `chrome://policy` is where to look.
6. **The one real latency lever, and it is a measurement we now apply.** Over 9,079 production
   commands, 676.6 ms of the 1875.3 ms average is the device not yet having asked for the command,
   p95 1914.4 ms. That wait is the polling ramp in `opera_claim_next_wait`. The conservative ladder
   is in place (under 50 ms through the idle window, tail coarsened to 100 ms, migration
   `20261007000000_opera_agent_claim_wait_fast_tail`). Lower it further only after confirming fleet
   impact.
7. **The plan path needs two owner inputs before it can run.** The endpoint, key and model name come
   from the user's own configuration on their device, and [`security.md`](security.md) has to say
   plainly what leaves the device. The remaining work is the VM host: handing a compiled program to
   `opera_start_workflow` needs a new RPC.
8. Publishable-key rotation, SonarCloud project access, and Supabase PATs all need owner action.

## CI

- Three gates on `ubuntu-latest`: unit, secret-scan, browser. The browser gate runs the same harness
  headed under `xvfb-run`, because the branded Chrome in the image loads no unpacked MV3 extension.
- [`.gitleaks.toml`](../.gitleaks.toml) names paths and symbols that must exist. Re-point the
  allowlist when a file is renamed; never edit the fixture to dodge the scanner.
- The concurrency group cancels an in-flight run when a newer one queues, so push, then wait.
- gitleaks 8.24.0 runs locally and is the gate worth reproducing before a push.
- `publish-crx.yml` may sit `queued` for many minutes with a runner already assigned and no job
  started. Cancelling and re-dispatching clears it.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13.15 with playwright.
- The per-machine Python install is broken on this machine: its `dev_AllUsers` MSI crashes during
  file costing in both scopes. Repairing it is OS-level. Nothing in the repo depends on it.

## Do not touch

- `stash@{0}` — a paused pre-cutover state under an old milestone name. Do not pop, apply, delete,
  or build from it.
- `archive/*` tags are historical; never rewrite them.