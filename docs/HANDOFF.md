@last-edited: 2026-10-05 18:50 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [CONTEXT.md](CONTEXT.md) - [ROADMAP.md](../ROADMAP.md)

# HANDOFF

Simplify first, code first, comments second. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.


> What is true now and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main`, sole remote branch, every merge `--ff-only`.
- Version `1.6.15` in `[extension/manifest.json](../extension/manifest.json)` is the source of truth.
- Local gates: `npm test`, `npm run check` ok — 26 primitives, 98 runtime safety files.
- Production database: 58 `opera_*` functions, 9 edge functions, each with a repo
  counterpart. The account RPCs the dashboard calls are live and reachable by name.
- No `sbp_` token in the tree or its history.
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

- The account page and the device page are separate files, the way the references this
  site follows separate them: Supabase separates profile from resources, opencode
  separates settings from projects. Locked in
  `[tests/landing-dashboard.test.mjs](../tests/landing-dashboard.test.mjs)`.
- `Intl.RelativeTimeFormat.prototype.format()` takes CLDR unit identifiers, not localised
  names. Passing "menit" throws at call time, inside the loop that builds the device cards,
  so the live dashboard showed "1 device ter-pairing" above an empty list. Both signed-in
  pages now pass CLDR units. Locked by tests/landing-render.test.mjs, which executes each
  page's own module against a stub DOM and asserts the rendered output.
- A Supabase access token lasts about an hour and the site holds no SDK to renew it, so an
  aged token read as signed out and was deleted: the reader was signed out roughly hourly
  with no explanation. All four signed-in pages now store the refresh token and renew it,
  and forget both halves only when renewal is also refused. Locked by
  `[tests/landing-session.test.mjs](../tests/landing-session.test.mjs)`, which executes the
  renewal against a stub Auth because the failure mode is a silent deletion.
- The MCP OAuth client is registered dynamically by OpenCode, which picks a new random
  localhost port each run and reuses its cached registration. Supabase does not support
  wildcards for OAuth client redirect URIs, so the port is appended by hand each time, as a
  comma-separated list. `OPERA_AGENT_MCP_TOKEN` is already configured on the edge function,
  and using it as a bearer header in the MCP config removes the dance entirely.
- Account isolation has two measured layers: `authenticated` holds no grant on the tables,
  only EXECUTE on the RPCs, and RLS filters by ownership for the day a grant appears. A
  foreign account read zero devices and was refused a revoke; anon got 401 on all four.
- Two live-endpoint defects found and fixed, both locked in
  `[tests/landing-dashboard.test.mjs](../tests/landing-dashboard.test.mjs)`: a fresh GRANT
  lands on PUBLIC so anon could call every RPC, and two overloads of the pairing issuer
  made PostgREST answer PGRST203.
- The site is live at `opera-agent.vercel.app` and every page serves the fixed content:
  the account and device pages split, the device list renders, and the OAuth permission
  screen is at `/oauth/consent`. Measured on the live site, not on the repository.
- **The outage cause, so it cannot repeat silently:** the repo is connected to Vercel, so
  every push auto-deploys, and the project Root Directory was unset, so each push built
  the repository root, which has no `index.html`. Every path answered 404 the moment a
  push replaced a good CLI deployment. Root Directory is now `landing`.
- The OAuth permission screen is a page of the site at `/oauth/consent`, not a separate
  deployment. GoTrue builds that URL as SiteURL + `authorization_path` and validates the
  origin of every consent call against its Site URL, so a screen on another host renders
  but can never approve anything. Locked by
  `[tests/landing-consent.test.mjs](../tests/landing-consent.test.mjs)`.
- **Two production settings remain the owner`s, and the order matters.** The site URL must
  move to the site origin, and only after that the superseded `oauth-consent/` directory
  can be deleted. Changing it while the site was down would have left no consent screen
  at all.
- OAuth client redirect URIs do not support wildcards in Supabase, and OpenCode picks a
  new random localhost port each run. The registration is a comma-separated list, not a
  space-separated one; that mistake cost one failed fix.
- Vercel Hobby allows 100 deployments a day and 1 concurrent build, and a connected
  project deploys on every push whether or not the CLI was used.
- Cloudflare Pages is prepared as the second host: 500 builds a month, unlimited bandwidth,
  no credit card, and a `pages.dev` subdomain. `landing/_headers` restates the vercel.json
  policy per path, every path enumerated so no rule overlaps another and no rule-ordering
  trap exists. Locked by `[tests/landing-hosting.test.mjs](../tests/landing-hosting.test.mjs)`.
  No `_redirects` file is needed: Pages resolves an extensionless URL to the matching
  `.html` and serves `404.html` for anything unmatched.

## Known, not started

- The rename sweep is done: 42 files, 47 exported identifiers, 69 assertion codes. Production
  names stay where a deployed object carries them, and the digest freezes were re-cut in
  the same commit.
- `tests/fixtures/*.json` still pin `sourceSha256` for
  `[supabase/functions/opera-agent-mcp/index.ts](../supabase/functions/opera-agent-mcp/index.ts)` and
  `[extension/background.js](../extension/background.js)`, and
  `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` pins them by blob
  SHA. Any edit to either file re-cuts those in the same commit, or the suite fails.

## Still open

1. Release so the shipped CRX contains the Options page. Needs the private signing key.
2. Publishable-key rotation — a production secret, untouched.
3. SonarCloud project access — the pre-existing New Code wall.
4. Supabase PATs and the login credentials for Google and GitHub need owner action; there
   is no Management API for PATs, and the live login cases only lack the submit.
5. **The one real latency lever, and it is an owner decision.** Measured over 9,079
   production commands, 676.6 ms of the 1875.3 ms average is the device not yet having
   asked for the command, p95 1914.4 ms. That wait is the polling ramp inside
   `opera_claim_next_wait`, which falls to a 250 ms floor after 720 ms idle. A 100 ms
   floor should bring p95 near 1000 ms at 10 idle polls per second instead of 4; 50 ms
   gets near 700 ms at 20. It is not changed: it alters a production function on the
   command path, and the right floor depends on how many devices idle at once, which
   this repository cannot answer. Full numbers in `[docs/benchmarks.md](benchmarks.md)`.
6. The largest unknown: how many model round trips a real task costs. Every latency
   figure here models the server and extension path, not the model loop. The plan path
   is the answer being built for it; see item 9.
7. **The plan path needs two owner inputs before it can run.** The endpoint, key and model
   name come from the user's own configuration on their device — no shared key, ever, since
   the product ships at scale — and [`SECURITY.md`](../SECURITY.md) has to say plainly what
   leaves the device. After that the remaining work is the VM host: handing a compiled
   program to `opera_start_workflow` needs a new RPC, which is production shape.

## CI

- The three gates run on `ubuntu-latest`: unit, secret-scan, browser. The browser gate runs
  the same harness headed under `xvfb-run` on playwright's chromium, because the branded
  Chrome in the image loads no unpacked MV3 extension and headless Chromium starts no MV3
  service worker.
- The secret-scan gate runs in CI only, and `[.gitleaks.toml](../.gitleaks.toml)` names paths
  and symbols that must exist. Re-point the allowlist when a file is renamed; never edit the
  fixture to dodge the scanner. `[tests/hygiene.test.mjs](../tests/hygiene.test.mjs)` locks
  that every allowlist path names a tracked file.
- The concurrency group cancels an in-flight run when a newer one queues, so a push made
  while CI is running destroys the evidence for the head being tested. Push, then wait.

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
