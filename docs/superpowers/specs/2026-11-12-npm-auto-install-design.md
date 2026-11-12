# @last-edited: 2026-11-12 UTC+7.
# @title: npm install does everything; npm uninstall undoes everything - the browser extension is installed and removed by the registry, never by hand.
# @state: the design for the install/uninstall flow; evidence at the bottom is what makes it design, not wish.
# @dependencies: `docs/registry-install.md`, `docs/superpowers/specs/2026-11-12-npm-auto-install-design.md`, `store/extension-registry-install.reg`, `store/extension-registry-uninstall.reg`.

## THE ASK, VERBATIM (paraphrased)

When someone uses the npm command, the extension installs itself into the browser(s) present, and can update through the same mechanism already built and proven. No download, no extract, no paste into Chrome, no manual pairing hunt. One command makes the machine ready: local MCP works immediately, cloud MCP needs one OAuth sign in. The same one command uninstalls everything - the extension, the registry keys, the folders, and the MCP package itself. And nothing of that should touch a browser it doesn't know exists.

## WHAT THE BROWSERS ALLOW (evidence, measured 2026-11-12, isolated throwaway profiles)

| Mechanism | Chrome 153.0.8010.36 | Brave 157.1.99.56 | Edge x86 |
|---|---|---|---|
| `External Extensions\id.json` + `external_update_url` | no | no | no |
| `--policy-path` + `ExtensionInstallForcelist` | no | no | not tried |
| `HKCU\Software\<Vendor>\<product>\Extensions\id` + `update_url` | installs | installs | installs |
| The same key deleted, relaunch | extension removed itself | extension removed itself | extension removed itself |

Registry path per vendor: `HKCU\Software\Google\Chrome\Extensions\<id>`, `HKCU\Software\BraveSoftware\Brave-Browser\Extensions\<id>`, `HKCU\Software\Microsoft\Edge\Extensions\<id>`. Each carries one value, `update_url`, pointing at the public update manifest (`.../opera-agent-update/update.xml?id=ofgemipoobcnbjkfanmofjbdonjapmgl`); the browser fetches the CRX (`ofgemipoobcnbjkfanmofjbdonjapmgl`) itself, installs it, and re-checks the manifest on later starts. A key deleted means the extension is gone by the browser's own hand at next startup; a key re-added means it installs again. In Chrome the removal proved non-reversible in that profile (sticky; it refuses to re-add); Edge and Brave re-installed after restore.

Uninstall of a **registry-installed copy** is therefore exact: the `.reg` file we already ship (`store/extension-registry-uninstall.reg`) is a full uninstall. A copy installed the old manual way (`Load unpacked` from `C:\OperaAgent\*`) does not follow the registry — it stays until the user removes it at `chrome://extensions`. That asymmetry is the browser's, not ours; it is recorded here once.

## DESIGN

### `opera-agent-mcp install` (subcommand in `local/install.js`)

1. OS check: not Windows → print the store links and exit 0. macOS/Linux: no registry, no promise we cannot keep.
2. Browser detection by path probe (each reported once):
   - Chrome: `<Program Files>\Google\Chrome\Application\chrome.exe`, `<Program Files(x86)>` variant (found absent on this machine), `<LocalAppData>\Google\Chrome\Application\chrome.exe`.
   - Brave: `<Program Files>\BraveSoftware\Brave-Browser\Application\brave.exe`.
   - Edge: `<Program Files(x86)>\Microsoft\Edge\Application\msedge.exe`.
3. For every detected browser, idempotent write of the HKCU key + `update_url`. No admin, no prompt, no UAC.
4. `%LOCALAPPDATA%\OperaAgent\` created if absent; for every detected browser, `OperaAgent\{Chrome,Brave,Edge}\` with:
   - `extension.crx` — downloaded from the CRX URL after reading `x-opera-sha256` from the HEAD response (the same header the unduh page documents); verified before saved; content-type must look like a CRX (`Cr24`) or download fails and the folder is not created;
   - `README.txt` — one screen: how the registry mechanism works, what the folder is for (backup for manual Load unpacked when the registry route is blocked by policy), how to uninstall (the .reg file plus one browser click), where pairing happens.
5. `doctor()` runs; output closes the loop: bridge/device/plan status, plus exactly what remains human-only - sign in with `opera-agent-mcp auth` and one pairing code in the browser. No wizard, no prompt for anything from the user.
6. Failures are honest and local: any probe or write error logs what failed, leaves the rest working, prints the manual fallback path, and exits 1 only for `install` itself. Nothing is deleted on error.

### `local/postinstall.mjs` (the automation promise)

Runs only when: installed globally (`npm_config_global=true`), not CI (`CI` unset), and the user did not opt out (`OPERA_AGENT_NO_INSTALL=1`). It calls the same install logic with a single line of output ("opera-agent-mcp: extension registered in Chrome, Brave; run `opera-agent-mcp install` for the full report"). It must never fail an npm install: every error is caught, printed, exit 0. If the user does not want any of it: `OPERA_AGENT_NO_INSTALL=1 npm i -g opera-agent-mcp`, or `opera-agent-mcp uninstall` after.

### `opera-agent-mcp uninstall` (one command, maximal honesty)

1. Delete the three HKCU keys (from `store/extension-registry-uninstall.reg` equivalents, in code): registry-installed copies of the extension **uninstall themselves** on next browser start (verified, see table).
2. Delete `%LOCALAPPDATA%\OperaAgent\` entirely, including `ChromeProfile` (the dedicated development profile) and the paired-device credentials. Flag `--keep-pair` preserves the device file only.
3. Unregister the MCP package itself: a detached child waits for this process to exit and then runs `npm uninstall -g opera-agent-mcp`. It cannot succeed inside its own process; the child is fire-and-forget. Failure prints the manual command (`npm uninstall -g opera-agent-mcp`) and succeeds anyway.
4. Print the one click that cannot be scripted away in every detected browser: remove the extension (`chrome://extensions`, `brave://extensions`, `edge://extensions` → Remove). Developer-mode copies vanish only there; registry copies are already gone by then.
5. `bin/opera-agent-mcp.js` wires `install` and `uninstall` alongside `auth` and `doctor`.

### What updates (nothing is built)

The update path is already the one proven on this machine: browsers re-read the update manifest on their own schedule; the release pipeline re-signs the CRX and regenerates `update.xml` for each release (already happening for 1.6.44/1.6.45). A version the browser does not yet have installs itself on the next start after the manifest moves. There is no background daemon, no cron, no polling from the npm package.

### What is deliberately absent

- No writes to the everyday profile (Secure Preferences/Preferences are HMAC-protected; any tamper is detected and reset by the browser).
- No silent pairing, no auto-`auth`, no example pairing code in docs that contains a real one.
- No auto-wiring of MCP client configs (opencode/claude code/cursor); that is a separate decision, not a detail of this one.
- Landing page changes are out of this design.

## TESTING

- Unit tests (CI): browser detection against a tmpdir tree with fake chrome.exe/brave.exe/msedge.exe at the paths above; key writes asserted against a mocked registry layer (or a real HKCU subkey tree prefixed with a test namespace — never the real one); CRX download+verify against a local HTTP server serving a 3-byte `Cr24` payload and one with a deliberately wrong hash; uninstall prints exactly what succeeded and what it could not.
- `docs/registry-install.md` gains the command path; the .reg stays for users who prefer not to install the npm package first.
- Drive the real thing once on this machine: spawn a fresh Chrome/Brave profile with the keys present and look for the extension folder after the first launch (the same test that produced the table above), and drive the Remove click live.

## RELEASE

Ship as **1.6.46**: PR from worktree, CI (unit/browser/secret-scan/SonarCloud), squash-merge, dispatch `publish-npm.yml -f version=1.6.46` (npm@11.5.1 path now proven on 1.6.45), registry confirmation (now polls). The CRX and the extension stay at 1.6.44 until the next extension-bearing release; the update manifest keeps saying 1.6.44.

## RISKS

- Brave reinstall flakiness (needed a second start the first time) is noted, not hidden; if a machine shows the same, it is a browser behaviourality, and the docs say "restart twice" for Brave.
- Chrome's sticky block after removal is real: a profile that ever uninstalled will not silently re-install; this fails toward safety (it does not surprise anyone), and is documented.
- The removal of `%LOCALAPPDATA%\OperaAgent` destroys pairing state irrecoverably - by design ("uninstall everything") - and by flag it is reversible in intent only (device must re-pair).
- Uninstall without a browser restart shows no change; command prints that.

## WHAT THIS IS NOT

Not the Web Store replacement, not a tampering tool, not a way to install into a profile that has not been told to accept it (policy-managed machines keep their admin's answer). It is the consenting-install story for Windows, end to end.
