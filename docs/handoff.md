@last-edited: 2026-10-07 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

Simplify first, code second, comment third. Cover every button on every site, and grow the
capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

## State

- `main` = `origin/main`, sole remote branch, every merge `--ff-only`.
- Version `1.6.20` in [`extension/manifest.json`](../extension/manifest.json) is the source of truth.
- Gates: `npm test`, `npm run check` — 28 primitives, 137 runtime safety files, 647 unit tests, green.
- Production: 58 `opera_*` functions, 9 edge functions, each with a repo counterpart. Account RPCs
  are live and reachable by name.
- **The CRX is published.** The update endpoint offers `1.6.20` to extension id
  `ofgemipoobcnbjkfanmofjbdonjapmgl`, which is both the manifest key's id and the signature's id.
  `1.6.17` under that id is inactive; `1.6.14` under the old id `ohbbpamc…` stays active so installs
  that never updated keep working. `opera_releases` allows one active row per id.
- **Live audio is end to end.** Element-tap capture (no new permission) → Groq Whisper
  `verbose_json` → segments in `opera_listen_segments`, audio deleted after use. MCP has
  `media_stream_start/stop` + `media_listen_read` (29 tools); the dashboard shows session
  metadata only, never speech text. Full session proven in the headed harness.
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

- **A publish step must fail loudly.** The CRX base64 exceeds 131,072 bytes, the Linux limit for one
  argument or environment string, so `node` died with "Argument list too long" inside a command
  substitution where `errexit` is off. curl then had no body, and the run went green having published
  nothing. [`.github/workflows/publish-crx.yml`](../.github/workflows/publish-crx.yml) now builds the
  statement in files, deactivates this id's older row before the insert, and fails unless the status
  is 2xx. Verified in a rolled-back transaction: without the update the one-active index refuses the
  insert, with it the insert lands.
- CI pins `ubuntu-24.04` and the node24 action majors (the `latest` label moves under the browser gate).
- The browser harness reads the version from the manifest instead of pinning a stale id and label.
- The account and device pages are separate files, and the provider identity is read from
  `app_metadata.providers` rather than `provider`. Both locked where the reason is.
- `Intl.RelativeTimeFormat` takes CLDR unit identifiers, not localised names. Passing "menit" threw
  inside the loop that builds the device cards, so the dashboard showed "1 device ter-pairing" above
  an empty list. Locked by [`tests/landing-execution.test.mjs`](../tests/landing-execution.test.mjs).
- A Supabase access token lasts about an hour and the site holds no SDK to renew it, so an aged token
  read as signed out and was deleted. All four signed-in pages now store the refresh token and renew
  it, and forget both halves only when renewal is also refused.
- The MCP OAuth client is registered dynamically by OpenCode on a localhost port. Deleting the client
  row makes it worse: GoTrue answers `oauth_client_not_found`. Restoring it by hand needs a non-null
  `client_secret_hash`. Redirect URIs are a comma-separated list with no wildcards.
  `OPERA_AGENT_MCP_TOKEN` is configured on the edge function, and using it as a bearer header removes
  the dance.
- **Every MCP caller drives the one device named by `DEVICE_NAME`, and sign-up is open**, so the
  function admits the static token or a named account and nobody else. An OAuth token that GoTrue
  accepts with 200 still got 401 here because the deployed function (v40, 2026-10-02) rejects every
  non-static token when the allowlist is empty. `OPERA_AGENT_MCP_USER_IDS` now names the owner;
  the repo once carried a rule admitting any confirmed account, undeployed, and a test now bars it.
- **A device name belongs to the account that paired it.** Pairing overwrote the token
  but kept the owner, so a valid code for an owned name hijacked it. Fixed and proved
  with two accounts in rolled-back transactions (5 of 10 failed before, all pass after).
- **Advertised media capabilities are invocable tools.** `browser_status` reported
  `media.play/pause/seek/state` that no caller could invoke; measured live from ChatGPT.
  The four tools now exist (26 total); the keep-media-internal decision is superseded.
- Account isolation has two measured layers: `authenticated` holds no table grant, only EXECUTE on the
  RPCs, and RLS filters by ownership for the day a grant appears. A foreign account read zero devices
  and was refused a revoke; anon got 401 on all four.
- Two live-endpoint defects, both locked in
  [`tests/landing-dashboard.test.mjs`](../tests/landing-dashboard.test.mjs): a fresh GRANT lands on
  PUBLIC so anon could call every RPC, and two overloads of the pairing issuer made PostgREST answer
  PGRST203.
- **Cloudflare Pages at `opera-agent.pages.dev` serves the site; Vercel is the backup host**, because
  Vercel's budget was exhausted. `SITE_ORIGIN` in
  [`extension/lib/endpoints.js`](../extension/lib/endpoints.js), `site_url` in
  [`supabase/config.toml`](../supabase/config.toml) and the production GoTrue `site_url` all name the
  Cloudflare host. `vercel.app` stays in the CORS allowlist
  ([`supabase/functions/_shared/cors.js`](../supabase/functions/_shared/cors.js)) and the redirect
  list. The installer is the only binary the site hosts.
- **A deploy is a dispatch, not a push.**
  [`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml) publishes `landing/`
  with `wrangler pages deploy` after the unit and syntax gates. A push that does not deploy fails
  silently: CI is green and production keeps the previous build, so check the live content. The Vercel
  **CLI cannot deploy** this project, because Root Directory is `landing` and it resolves
  `landing/landing` and refuses. That Root Directory was once unset, so every push built a root with
  no `index.html` and every path answered 404.
- **Releases fire on a `v*` tag, and only that.** `release.yml` verifies the signed CRX that
  `publish-crx.yml` inserted, packs the archives, and publishes the release.
- `landing/_headers` restates the `vercel.json` policy per path for Cloudflare Pages, every path
  enumerated so no rule overlaps another. Every response carries HSTS, a locked-down
  Permissions-Policy, same-origin COOP and CORP, `X-Frame-Options: DENY`, and a hash-named
  `script-src` in place of `unsafe-inline`.

## Still open

1. **The Cloudflare API token pasted into a chat is still live** and carries `Account API Tokens Write`. The owner has chosen to leave it for now.
2. **OAuth via OpenCode works end to end.** Authorize answers 302 to the consent page,
   the code exchanges for a one-hour token, GoTrue `/user` answers 200, and a tool call
   through it (`browser_status`) completes. Unverified: sign-in by Google.
3. **MCP resolves one device per account and stamps the harness provider.** `X-Opera-Device`
   picks among the caller's devices, `X-Opera-Provider` (else User-Agent: opencode, kilo,
   chatgpt, …) lands on each command and run, and the dashboard shows device / browser /
   provider per row. Verified live with stamped `browser.ping` calls. The gateway accepts
   a user JWT too (ChatGPT plugin bundle in `landing/chatgpt-plugin/`) and resolves the
   same way. A real second account still wants its own test before opening access.
4. **The installer GUI has never been run.**
   [`scripts/OperaAgentInstaller.cs`](../scripts/OperaAgentInstaller.cs) compiles to a real PE with
   `requireAdministrator` set. Unverified: the form itself, and whether Chrome reads the policy it
   writes. `chrome://policy` is where to look.
5. **The one real latency lever, and it is a measurement we now apply.** Over 9,079 production
   commands, 676.6 ms of the 1875.3 ms average is the device not yet having asked for the command,
   p95 1914.4 ms: the polling ramp in `opera_claim_next_wait`. The conservative ladder is in place
   (under 50 ms through the idle window, tail 100 ms, migration
   `20261007000000_opera_agent_claim_wait_fast_tail`). Lower it further only after confirming fleet
   impact.
6. **One-off writes run as `adhoc.*` ephemeral workflows.** Compile, register, start, poll,
    delete; lease plus sweeper bound every row; consequential actions need recorded confirmation;
    no new executor or primitive. The compiler stays device-local, one call per task over the owner
    endpoint, key never leaves ([`security.md`](security.md)); the options probe validates endpoint
    plus key with zero page content.
7. Publishable-key rotation, SonarCloud project access, and Supabase PATs all need owner action.

## CI

- Three gates on `ubuntu-24.04`: unit, secret-scan, browser. The browser gate runs the harness headed
  under `xvfb-run`, because the branded Chrome in the image loads no unpacked MV3 extension.
- [`.gitleaks.toml`](../.gitleaks.toml) names paths and symbols that must exist. Re-point the
  allowlist when a file is renamed; never edit the fixture to dodge the scanner.
- The concurrency group cancels an in-flight run when a newer one queues, so push, then wait.
- gitleaks 8.24.0 runs locally and is the gate worth reproducing before a push.
- `publish-crx.yml` may sit `queued` for many minutes with no job started. Cancelling and re-dispatching clears it.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13 with playwright.
- The per-machine Python install is broken on this machine: its `dev_AllUsers` MSI crashes during
  file costing in both scopes. Repairing it is OS-level. Nothing in the repo depends on it.

## Do not touch

- `stash@{0}` — a paused pre-cutover state under an old milestone name. Do not pop, apply, delete,
  or build from it.
- `archive/*` tags are historical; never rewrite them.
