@last-edited: 2026-11-11 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main` at `0ab5982a` (1.6.41 release pending merge of this branch). Branch `agent/release-1.6.41/release-1.6.41` carries the 1.6.41 bump; a branch starts from `main` and merges back by squash once the checks are green.
- Version `1.6.41` in [`extension/manifest.json`](../extension/manifest.json) is the source of truth once the release merges.
- **The pinned device decides** (relay, `device.ts`): a live pin answers every call, a sleeping pin is refused by name (`503 pinned_device_not_live`, naming the awake browsers and the header), `X-Opera-Device: any` asks for freshest on purpose; a revoked device is never picked; presence is measured, not the stored status (`PRESENCE_WINDOW_MS = 120_000`).
- **The relay may run exactly the methods the extension serves.** `opera_methods` had drifted: `statement.download`/`statement.manifest` were missing (both tools were refused by name), and `page.read`/`page.capture` carried a shorter budget than the contract. The list is seeded from `extension/lib/protocol.js` via migration `20261110230000_opera_methods_from_contract.sql`, and `tests/relay-method-contract.test.mjs` pins seed to contract.
- **The extension updates itself, once asked.** The served version was asked of the legacy `/health` (always 1.0.1), so updates never happened; the check now reads `HEAD /download/opera-agent.zip` (`X-Opera-Version`), and when it cannot, the build's signed manifest decides. `check_update`/`apply_update` are hosted tools; the worker answers `extension.update` by writing the served build over the reader's allowed folder and restarting. The update page can be closed at any time; nothing lives there. 1.6.40 and earlier still need one manual folder overwrite (the build carrying the pull does not exist there).
- **The popup is one flat list**, Tampermonkey-shaped at twice the width: Dashboard, Pairing, Update (one amber row when a build waits), Documentation; Indonesian/English via `extension/lib/i18n.js`. The toolbar carries the site icon.
- Gates: `npm test`, `npm run check` - 32 primitives, 216 runtime safety files, green on `main`.
- **The local drive is metered where it happens.** Bridge loopback verifies the session, enforces the plan with the plan named, reports usage into the shared count; `opera-agent-mcp doctor` prints what is linked and the one fix when it is not.
- Production, measured against the live database: 76 `opera_*` functions (65 `SECURITY DEFINER`), 20 `opera_*` tables, and **9 deployed edge functions**.
- **Somebody can pay for a delivered client-month.** `invoice_create` prices manifest rows and returns a signed link.
- **The every-browser drive is drivable two ways.** `OPERA_LOCAL_TRANSPORT=bridge` runs the MCP surface over the extension; a browser with remote debugging is driven over CDP.
- **The bridge is a WebSocket with a heartbeat.** The server pings; idle service workers are never left to die silently.
- **One CORS policy and one credential-shape check** across every edge function.
- `page.read` reports `userState` (fails open) so the model knows whether the person is looking.
- **The drive reads a surface from evidence, not from a site name.** `surface_profile` answers canvas, editable, focus and the accessibility region with the measured number.
- `plan.pilot` Rp 99.000 up to 15 client-months; `plan.firm` Rp 249.000 up to 50; extra Rp 10.000 - invoiced after the first accepted batch; none has arrived.
- **Cloudflare Pages at `opera-agent.pages.dev` is the only host that serves the site**, and
  a push that does not deploy leaves CI green and the old build live: [`deploy-site.yml`](../.github/workflows/deploy-site.yml) publishes `landing/` with `wrangler pages deploy` after the unit and syntax gates, and it is dispatched by hand. The site carries 37 tools and 32 primitives everywhere (measured live 2026-11-11).
- `landing/_headers` carries the policy per path, with HSTS, a locked-down Permissions-Policy, same-origin COOP and CORP, and `X-Frame-Options: DENY`.

## Measured, not assumed

- **A publish step must fail loudly.** The CRX base64 exceeds the Linux argument limit, so the run went green having published nothing; `publish-crx.yml` now fails unless the status is 2xx.
- **The served-version check asked the wrong endpoint for years** and nothing noticed; measured live: `/health` answers `{"version":"1.0.1","extensionId":"pagjlnohdemoohcncicjmaejedcmcocm"}`, `/health?id=ofgemipoobcnbjkfanmofjbdonjapmgl` answers the current release, and the zip HEAD answers `X-Opera-Version`.

## Still open

0. **The 1.6.41 release shipped on 2026-11-11.** PR #254 merged, `opera-agent-update` and `opera-agent-mcp` are deployed, `publish-crx` signed and served it (update.xml advertises 1.6.41, `/health?id=` answers 1.6.41, the zip answers `X-Opera-Version: 1.6.41` and carries the flat TM popup and the site icon), and the site redeployed. The reader on 1.6.40 does one manual folder overwrite (the build could not pull itself before this) or presses Unduh once; after that it is hands-free.
0a. **The 1.6.42 release shipped on 2026-11-11.** Same chain plus the nudge: `publish-crx` enqueued one `extension.update` per non-revoked device after the release row landed and the endpoint served it; both devices claimed it within seconds and report 1.6.42 (opera-9 completed in 12 s, opera-10 in 3 s). The popup base is pinned at 400px end to end, so the MV3 panel cannot collapse on Chrome's initial viewport.
1. **The Cloudflare API token pasted into a chat is still live** and carries `Account API Tokens Write`. The owner has chosen to leave it for now.
2. **The migration ledger is mapped.** 122 files, each with its evidence; `tests/migration-ledger-map.test.mjs` fails a file the map omits.
3. **OAuth via OpenCode works end to end.** Google sign-in is unverified.
4. **Polling is the one latency lever.** `opera_claim_next_wait` p95 1914.4 ms.
5. **Publishable-key rotation still needs owner action.** Edge deploy runs via the logged-in CLI.
6. **A sandbox payment closes a real invoice; production has not.** Rp 99.000 through the simulator closed `Uji Sandbox:2027-09` by signed settlement; production is `[UNVERIFIED]`.

## CI

- Four gates on `ubuntu-24.04`, Node pinned to `22.20.0`: unit, secret-scan, browser (headed under `xvfb-run`), SonarCloud; a newer push cancels the in-flight run. Every pull request runs them here.
- [`.gitleaks.toml`](../.gitleaks.toml) re-point the allowlist when a file is renamed; never edit the fixture to dodge the scanner.

## Blocked, needs the owner at the machine

- Use `py`, not `python`, which hits the Microsoft Store shim; `py` is 3.13 with playwright.
- One manual step on 1.6.41 (see Still open #0); one pairing code pasted once for the cookie identity so re-installs keep the same device.

## Do not touch

- `stash@{0}` - a paused pre-cutover state: do not pop, apply, delete or build from it.
  `archive/*` tags are historical; never rewrite them.
