@last-edited: 2026-11-12 UTC+7.
@related: [AGENTS.md](../AGENTS.md)

# handoff

What is true now, and what to do next. Cap 150 lines. Spent detail: git history.

## State

- `main` = `origin/main` at `eb0b9557` (1.6.44). Version `1.6.44` in [`extension/manifest.json`](../extension/manifest.json) is the source of truth.
- **The pinned device decides** (relay, `device.ts`): a live pin answers every call, a sleeping pin is refused by name (`503 pinned_device_not_live`, naming the awake browsers and the header), `X-Opera-Device: any` asks for freshest on purpose; a revoked device is never picked; presence is measured, not the stored status (`PRESENCE_WINDOW_MS = 120_000`).
- **The relay may run exactly the methods the extension serves.** `opera_methods` had drifted: `statement.download`/`statement.manifest` were missing (both tools were refused by name), and `page.read`/`page.capture` carried a shorter budget than the contract. The list is seeded from `extension/lib/protocol.js` via migration `20261110230000_opera_methods_from_contract.sql`, and `tests/relay-method-contract.test.mjs` pins seed to contract.
- **The extension updates itself, once asked.** The served version was asked of the legacy `/health` (always 1.0.1), so updates never happened; the check now reads `HEAD /download/opera-agent.zip` (`X-Opera-Version`), and when it cannot, the build's signed manifest decides. `check_update`/`apply_update` are hosted tools; the worker answers `extension.update` by writing the served build over the reader's allowed folder and restarting. The update page can be closed at any time; nothing lives there. 1.6.40 and earlier still need one manual folder overwrite (the build carrying the pull does not exist there).
- **The popup is one flat list**, Tampermonkey-shaped at twice the width: Dashboard, Pairing, Update (one amber row when a build waits), Documentation; Indonesian/English via `extension/lib/i18n.js`. The toolbar carries the site icon.
- **Two capture tools beyond stills** (2026-11-12): `record_start` arms a recording on the tab to a webm in Downloads - after arming, any commands run against the page (clicks, fills, scrolls, bursts, whatever the task needs) and everything is captured - and `record_stop` finalizes the webm with the manifest plus up to four sampled stills as images; `scan_page` scans a page into one self-contained html in Downloads (light DOM with stylesheets, scripts (integrity kept), images, icons, srcset and @font-face fonts inlined as data URLs; shadow roots are not serialized). All refuse the sensitive-surface gate exactly as `capture_page` does. Gates green: `npm test`, `npm run check`.
- Gates: `npm test`, `npm run check` - 35 primitives, 223 runtime safety files, green on `main`.
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
  a push that does not deploy leaves CI green and the old build live: [`deploy-site.yml`](../.github/workflows/deploy-site.yml) publishes `landing/` with `wrangler pages deploy` after the unit and syntax gates, and it is dispatched by hand. The site carries 40 tools and 35 primitives everywhere (measured live 2026-11-12).
- `landing/_headers` carries the policy per path, with HSTS, a locked-down Permissions-Policy, same-origin COOP and CORP, and `X-Frame-Options: DENY`.

## Measured, not assumed

- **A publish step must fail loudly.** The CRX base64 exceeds the Linux argument limit, so the run went green having published nothing; `publish-crx.yml` now fails unless the status is 2xx.
- **The served-version check asked the wrong endpoint for years** and nothing noticed; measured live: `/health` answers `{"version":"1.0.1","extensionId":"pagjlnohdemoohcncicjmaejedcmcocm"}`, `/health?id=ofgemipoobcnbjkfanmofjbdonjapmgl` answers the current release, and the zip HEAD answers `X-Opera-Version`.

## Still open

0. **The 1.6.41 release shipped on 2026-11-11.** PR #254 merged, `opera-agent-update` and `opera-agent-mcp` are deployed, `publish-crx` signed and served it (update.xml advertises 1.6.41, `/health?id=` answers 1.6.41, the zip answers `X-Opera-Version: 1.6.41` and carries the flat TM popup and the site icon), and the site redeployed. The reader on 1.6.40 does one manual folder overwrite (the build could not pull itself before this) or presses Unduh once; after that it is hands-free.
0a. **The 1.6.42 release shipped on 2026-11-11.** Same chain plus the nudge: `publish-crx` enqueued one `extension.update` per non-revoked device after the release row landed and the endpoint served it; both devices claimed it within seconds and report 1.6.42 (opera-9 completed in 12 s, opera-10 in 3 s). The popup base is pinned at 400px end to end, so the MV3 panel cannot collapse on Chrome's initial viewport.
0b. **Every tool now has a measured number on both roads** ([`latency.md`](latency.md)): the local road answers in single-digit milliseconds for most tools (read_page 13 ms, press_key 47 ms, open_url 201 ms, capture_page 61 ms with a p95 of 8.0 s because the first one attaches the debugger), the hosted road in about 1.3 s. Measuring them found two defects, both fixed: the hosted waits parked a PostgREST connection for the whole command and queued every later call behind it (about ten seconds for work the device did in 414 ms), and the extension's bridge probe took a Chrome debugging port on 9222 for a bridge and never linked. The harness that measures it is `npm run benchmark:latency`, and `npm run bridge` starts the bridge it needs.
0c. **The 1.6.44 release shipped on 2026-11-12.** PR #264 merged (squash, `eb0b9557`), `20261112000000_opera_methods_record_scan.sql` applied to `opera_methods` (`page.record_start`/`page.record_stop`/`page.scan` enabled, 10s/30s/55s), `opera-agent-mcp` redeployed from that commit and answers `streamable-http` on `/health`, and `publish-crx` signed and served the build (release row `1.6.44` active, `update.xml`/`X-Opera-Version` advertise 1.6.44, `/health?id=` answers the same sha). Both paired devices claimed `extension.update` within seconds and completed it (opera-9 at 06:34:26Z, opera-10 at 06:34:13Z).
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
