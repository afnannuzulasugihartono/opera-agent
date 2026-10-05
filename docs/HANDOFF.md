@last-edited: 2026-10-05 16:55 UTC+7.
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

- The site is split the way the two references the site follows split: Supabase separates
  profile from resources, opencode separates settings from projects. `/akun` is who you
  are and `/dashboard` is your devices. The nav once pointed "Akun" at the sign-in page
  and "Dashboard" at a file called akun.html.
- The provider identity is read from `app_metadata.providers`, not `provider`: measured on
  this project, an account that signed in with Google reports provider "email" with
  providers ["email","google"], because a magic link created the row first.
- `Intl.RelativeTimeFormat.prototype.format()` takes CLDR unit identifiers, not localised
  names. Passing "menit" throws at call time, inside the loop that builds the device cards,
  so the live dashboard showed "1 device ter-pairing" above an empty list. Both signed-in
  pages now pass CLDR units. Locked by tests/landing-render.test.mjs, which executes each
  page's own module against a stub DOM and asserts the rendered output.
- Account isolation has two measured layers: `authenticated` holds no grant on the tables,
  only EXECUTE on the RPCs, and RLS filters by ownership for the day a grant appears. A
  foreign account read zero devices and was refused a revoke; anon got 401 on all four.
- Two live-endpoint defects found and fixed, both locked in
  `[tests/landing-dashboard.test.mjs](../tests/landing-dashboard.test.mjs)`: a fresh GRANT
  lands on PUBLIC so anon could call every RPC, and two overloads of the pairing issuer
  made PostgREST answer PGRST203.
- **The site was down for every visitor and the cause was hosting, not code.** The repo
  is connected to Vercel, so each push auto-deploys, and the project Root Directory was
  unset, so the auto-deployment built the repository root, which has no `index.html`.
  Every path answered 404 the moment the last push replaced a good CLI deployment.
  Root Directory is now `landing`, so a push builds the site again.
- Vercel Hobby allows 100 deployments a day and 1 concurrent build; that budget is spent.
  Deploying from `landing/` by CLI never triggered the limit, but a git push did, because
  a connected project deploys on every push whether or not the CLI was used.
- Cloudflare Pages is prepared as the second host: 500 builds a month, unlimited bandwidth,
  no credit card, and a `pages.dev` subdomain. `landing/_headers` restates the vercel.json
  policy per path, every path enumerated so no rule overlaps another and no rule-ordering
  trap exists. Locked by `[tests/landing-hosting.test.mjs](../tests/landing-hosting.test.mjs)`.
  No `_redirects` file is needed: Pages resolves an extensionless URL to the matching
  `.html` and serves `404.html` for anything unmatched.
- Moving hosts costs one Supabase setting, not a code change. The Google OAuth callback is
  the project Auth host, which does not move; only the site origin must be added to the
  Supabase redirect allowlist. Measured: the authorize endpoint accepts any `redirect_to`
  and defers the check to the callback, so the allowlist cannot be probed from outside.
## Known, not started

- **The Opera-to-Brave rename is a production migration, not a rename.** The `opera_`
  prefix is load-bearing in the database: 58 functions, plus tables and every RPC name
  the bridge and MCP call. Repo surface is ~256 files and ~1982 `opera_*` identifiers.
- **A digest freeze blocks the first edit.** `tests/fixtures/*.json` pin `sourceSha256`
  for [`supabase/functions/opera-agent-mcp/index.ts`](../supabase/functions/opera-agent-mcp/index.ts) and `[extension/background.js](../extension/background.js)`, and
  `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` pins them by blob SHA.
- Sequence: verify on Brave, then rename, then re-freeze. Otherwise a Brave regression
  is indistinguishable from a rename regression.

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
  the same harness headed under `xvfb-run` on playwright's chromium; the branded Chrome in
  the image loads no unpacked MV3 extension at all, and headless Chromium starts no MV3
  service worker.
- The secret-scan gate runs in CI only, and `[.gitleaks.toml](../.gitleaks.toml)` names paths
  and symbols that must exist: a renamed file or variable that the allowlist still calls by
  its old name turns a known synthetic fixture back into a red gate. Re-point the allowlist;
  never edit the fixture to dodge the scanner. `[tests/hygiene.test.mjs](../tests/hygiene.test.mjs)`
  locks that every allowlist path names a tracked file.
- The concurrency group cancels an in-flight run when a newer one queues, so a push made
  while CI is running destroys the evidence for the head being tested. Push, then wait.
- The browser gate proves the extension end to end on Linux, but the focus audit cannot see
  what a headless display hides, so the local gates still run Brave headed on this machine.
- The focus audit reports five states and fails only when focus lands on a different window
  or a different tab, which is what a steal physically is. Both steal branches were proved
  red by disabling them.

## Blocked, needs the owner at the machine

- Python 3.12.10 installs and runs per-user (`py -3.12`, pip 25.0.1), twice proven
  (install-verify, uninstall-reinstall-verify). 3.13.15 stays the default untouched.
- The per-machine install is still broken: its `dev_AllUsers` MSI crashes with a
  stack overflow (`0xC00000FD`) during file costing, in both scopes, even after
  re-registering the MSI engine (`msiexec /unregister` + `/regserver`, service
  running). The dev-symbols package is poisoned on this machine; nobody needs it
  to run Python. Next steps are OS-level (SFC, servicing) and need the owner.
- The repo does not need per-machine: the runner runs interactively as ASUS, so
  per-user installs are visible to it.
- `%TEMP%\opencode\pythoncore-backup.reg` still holds the removed 3.12 registry
  registration.
- Use `py`, not `python`, which hits the Microsoft Store shim. `py` is 3.13.15 with
  playwright.

## Do not touch

- `stash@{0}` — a paused pre-cutover state kept under an old milestone name. Do not
  pop, apply, delete, or build from it, and do not start its work implicitly.
- `archive/*` tags are historical; never rewrite them.
