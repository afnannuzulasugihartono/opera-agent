@last-edited: 2026-10-10 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

Simplify first, code second, comment third. Cover every button on every site, and grow the
capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

## State

- `main` = `origin/main`, and it is the sole remote branch again. Nine stale branches were
  removed on 2026-10-10 after each was measured: `main` was 1 to 277 commits ahead of every
  one, and none held a file `main` lacks. Every merge `--ff-only`.
- Version `1.6.23` in [`extension/manifest.json`](../extension/manifest.json) is the source
  of truth. [`check.mjs`](../scripts/check.mjs) also asserts the version the MCP server
  reports, the store form's four-part version, and that no module redeclares the secret regex.
- Gates: `npm test`, `npm run check` — 28 primitives, 162 runtime safety files, 850 unit
  tests, green.
- Production, measured against the live database rather than the tree: 73 `opera_*`
  functions (62 `SECURITY DEFINER`), 17 `opera_*` tables, 10 deployed edge functions.
- **The CRX is published.** The update endpoint offers `1.6.22` to extension id
  `ofgemipoobcnbjkfanmofjbdonjapmgl`, which is both the manifest key's id and the
  signature's id. `1.6.21` and `1.6.17` under that id are inactive; `1.6.14` under the old
  id `ohbbpamc…` stays active. `opera_releases` allows one active row per id.
- **Live audio is end to end.** Element-tap capture (no new permission) → Groq Whisper
  `verbose_json` → segments in `opera_listen_segments`, audio deleted after use. MCP has
  `media_stream_start/stop` + `media_listen_read` (39 tools); the dashboard shows session
  metadata only, never speech text.
- No management token or secret key in the tree. The four signed-in and consent pages carry
  the Supabase publishable key, which is public by design and allowlisted in
  `.gitleaks.toml`.
- `page.read` reports `userState` — `tabActive`, `windowFocused`, `watching`,
  `lastInputMs` — so the model can tell whether the person is looking at the tab before
  choosing foreground or background. Fails open.
- **The plan path exists; the model call does not.** The model composes a plan once, the
  device executes it locally, so a task costs one round trip instead of one per step.
  [`lib/goal-plan.js`](../lib/goal-plan.js) is the gate between model text and that
  execution, and it shares the allowlist so the two cannot drift.
- **One CORS policy, not two.** Six edge functions answered
  `Access-Control-Allow-Origin: "*"` while three used the shared allowlist. All ten resolve
  per request through [`_shared/cors.js`](../supabase/functions/_shared/cors.js), and
  [`edge-cors.test.mjs`](../tests/edge-cors.test.mjs) drives a real request to prove it.
- **One credential-shape check, not nine.** Nine modules each carried their own copy of the
  secret regex. They now import [`lib/secret-pattern.js`](../lib/secret-pattern.js), and
  `check` fails if any module declares it again.

## Measured, not assumed

- **A publish step must fail loudly.** The CRX base64 exceeds 131,072 bytes, the Linux limit
  for one argument, so `node` died with "Argument list too long" inside a command
  substitution where `errexit` is off; curl then had no body and the run went green having
  published nothing. [`publish-crx.yml`](../.github/workflows/publish-crx.yml) builds the
  statement in files and fails unless the status is 2xx.
- **Every edge function answers CORS per request.** A module-level answer cannot be right for
  two in-flight requests, and threading an origin through 17 call sites is worse than one
  wrapper at the serve boundary.
- **An account signed in with Google reports provider "email"** if a magic link created the
  row first. The account page renders the real shape; the card's own logic is executed
  against measured payloads.
- `Intl.RelativeTimeFormat` takes CLDR unit identifiers, not localised names. Passing
  "menit" threw inside the loop that builds the device cards, so the dashboard showed
  "1 device ter-pairing" above an empty list. Locked by
  [`landing-execution.test.mjs`](../tests/landing-execution.test.mjs).
- A Supabase access token lasts about an hour and the site holds no SDK to renew it, so an
  aged token read as signed out and was deleted. All four signed-in pages store the refresh
  token and renew it.
- **Every MCP caller drives the one device named by `DEVICE_NAME`, and sign-up is open**, so
  the function admits the static token or a named account and nobody else.
  `OPERA_AGENT_MCP_USER_IDS` names the owner; a rule admitting any confirmed account once
  sat undeployed in the repo, and a test now bars it.
- **A device name belongs to the account that paired it.** Pairing overwrote the token but
  kept the owner, so a valid code for an owned name hijacked it. Proved with two accounts
  in rolled-back transactions.
- Account isolation has two layers: `authenticated` holds no table grant, only EXECUTE on
  the RPCs, and RLS filters by ownership for the day a grant appears. A foreign account read
  zero devices and was refused a revoke; anon got 401 on all four.
- **Cloudflare Pages at `opera-agent.pages.dev` serves the site; Vercel is the backup**,
  because Vercel's budget was exhausted. `SITE_ORIGIN` in
  [`endpoints.js`](../extension/lib/endpoints.js), `site_url` in
  [`config.toml`](../supabase/config.toml) and the production GoTrue `site_url` all name the
  Cloudflare host. `vercel.app` stays in the CORS allowlist and the redirect list.
- **A deploy is a dispatch, not a push.** [`deploy-site.yml`](../.github/workflows/deploy-site.yml)
  publishes `landing/` with `wrangler pages deploy` after the unit and syntax gates. A push
  that does not deploy fails silently: CI is green and production keeps the previous build,
  so check the live content. The Vercel **CLI cannot deploy** this project: Root Directory is
  `landing`, so it resolves `landing/landing` and refuses.
- `landing/_headers` restates the `vercel.json` policy per path for Cloudflare Pages, every
  path enumerated so no rule overlaps another. Every response carries HSTS, a locked-down
  Permissions-Policy, same-origin COOP and CORP, `X-Frame-Options: DENY`, and a hash-named
  `script-src` in place of `unsafe-inline`. Change a page's inline script and re-hash both
  files or the page goes silent.

## Still open

1. **The Cloudflare API token pasted into a chat is still live** and carries
   `Account API Tokens Write`. The owner has chosen to leave it for now.
2. **OAuth via OpenCode works end to end.** Authorize answers 302 to the consent page, the
   code exchanges for a one-hour token, and a tool call completes. Unverified: sign-in by
   Google.
3. **MCP resolves one device per account and stamps the harness provider.**
   `X-Opera-Device` picks among the caller's devices, `X-Opera-Provider` lands on each
   command and run. A real second account still wants its own test before opening access.
4. **English toggle + login gate shipped.** Shared `landing/i18n.js` drives EN/ID everywhere
   except legal bodies. Policy installer stays deleted: Chrome marks off-store policy
   `[BLOCKED]` on unmanaged machines.
5. **Polling is the one latency lever.** 676.6 ms of 1875.3 ms average over 9,079 commands is
   the device not yet asking (`opera_claim_next_wait`, p95 1914.4 ms). Lower only after
   fleet impact.
6. **One-off writes run as `adhoc.*` ephemeral workflows.** Compile, register, start, poll,
   delete; lease plus sweeper bound every row. The compiler stays device-local and the key
   never leaves ([`security.md`](security.md)).
7. Publishable-key rotation still needs owner action. Edge deploy runs via the logged-in CLI.
8. **`browse.recon` ships the unknown-site order.** Detect, map, act, verify with total-stop
   CAPTCHA policy ([`unknown-site.md`](unknown-site.md)); 3x recurrence becomes a
   named-workflow candidate.
9. **Console-style dashboard shipped with a read-only table editor.** The `#tabel` section
   reads sixteen tables through `SECURITY DEFINER` `opera_konsol_*` readers: zero table
   grants, sixteen policies rebuilt from one scope map and drift-locked string for string.
   Read-only by decision — a write side is the next move.
10. **The CRX shipped at 1.6.22.** The bump moved every frozen surface as one piece; six
    tests and one helper carry the release number, and
    [`boundary-locks.mjs`](../tests/helpers/boundary-locks.mjs) re-pins the manifest on the
    version line only.
11. **The update endpoint answers in a nested query string.** `?x=` is not the id — Chromium
    sends `?x=id%3D<id>%26v%3D<version>`. Ask with `?id=ofgemipoobcnbjkfanmofjbdonjapmgl`.
12. **`opera_v2_releases` was live but unwritten.** The table existed in production with no
    migration creating it, so the tree could not rebuild what it described and
    `20261010090000` would stop on a missing relation. Stated now in
    `20261010080000`, timestamped before it for that reason.

## CI

- Three gates on `ubuntu-24.04`, Node pinned to `22.20.0`: unit, secret-scan, browser
  (headed under `xvfb-run`).
- [`.gitleaks.toml`](../.gitleaks.toml) names paths and symbols that must exist. Re-point the
  allowlist when a file is renamed; never edit the fixture to dodge the scanner.
- The concurrency group cancels an in-flight run when a newer one queues, so push, then wait.
- gitleaks 8.24.0 runs locally and is the gate worth reproducing before a push.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13 with playwright.

## Do not touch

- `stash@{0}` — a paused pre-cutover state under an old milestone name. Do not pop, apply,
  delete, or build from it.
- `archive/*` tags are historical; never rewrite them.