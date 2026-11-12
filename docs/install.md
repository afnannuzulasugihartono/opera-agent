# @last-edited: 2026-11-12 UTC+7.
# @title: install - one command turns an empty Windows machine into a browser that has Opera Agent.
# @state: measured 2026-11-12 on Windows against isolated throwaway profiles: Chrome 153.0.8010.36, Brave 157.1.99.56 and Edge each installed the extension automatically on first browser start; deleting the keys removed it the same way.
# @dependencies: `docs/registry-install.md`, `store/extension-registry-install.reg`, `store/extension-registry-uninstall.reg`, `local/install.js`, `local/postinstall.js`, `local/registry.js`, `local/bin/opera-agent-mcp.js`.

# WHAT THE COMMAND DOES

`opera-agent-mcp install` (and `npm i -g opera-agent-mcp`, via the postinstall hook):

1. Only on Windows. On any other OS it prints the Web Store path and exits 0.
2. Detects the Chromium browsers this machine carries - Chrome, Brave and Edge - by probing the exact paths Chrome, Brave and Edge live at (`local/browsers.js`, the same table the driver uses; no second list).
3. Writes one per-user registry key per detected browser (`HKCU\Software\<Vendor>\<product>\Extensions\ofgemipoobcnbjkfanmofjbdonjapmgl`) carrying `update_url` = the public update manifest. The browser installs the extension itself on its next start; no UAC, no admin, no download dialog.
4. Creates `%LOCALAPPDATA%\OperaAgent\{Chrome,Brave,Edge}\` only for the browsers found, containing a **verified** copy of the build (`opera-agent.zip`, sha256 checked against the `x-opera-sha256` header of the public update endpoint before the bytes are written) plus a README that explains the whole mechanism and the manual fallback.
5. Runs `opera-agent-mcp doctor` and prints what remains human: sign in with `opera-agent-mcp auth` (OAuth, one browser round trip) and pair the device in the extension (one code, on purpose - pairing is the one thing a machine may not fake).

`npm i -g opera-agent-mcp` performs the same install silently from the
`postinstall` hook, but only when installed globally, never in CI, and only
when `OPERA_AGENT_NO_INSTALL` is unset. `OPERA_AGENT_NO_INSTALL=1 npm i -g opera-agent-mcp` opts out. The postinstall hook can never turn an npm install red.

# WHAT THE UNINSTALL DOES

`opera-agent-mcp uninstall`, one command, maximum honesty:

1. Deletes the three registry keys. Registry-installed copies of the extension **leave the browser on the next start** - verified the same day on the same three browsers (Secure Preferences read zero mentions of the extension after a relaunch).
2. Deletes `%LOCALAPPDATA%\OperaAgent\` - the dedicated ChromeProfile, the verified build copies, the README, everything - unless `--keep-pair` is passed, in which case the paired-device file is the only thing kept.
3. Spawns a detached `npm uninstall -g opera-agent-mcp`; the package removes itself after the process exits. If it cannot, the exact command to run is printed.
4. Prints the one thing it cannot script away: the extension's `Remove` button at `chrome://extensions` (`edge://`, `brave://`), needed only for copies installed the manual developer-mode way (`Load unpacked`).

# WHAT IT IS NOT

- Not a tampering tool: Secure Preferences are never edited; installs and removals go through the registry keys the browsers already honor.
- Not a store replacement: browsers and machines under policy that forbid external extensions keep their admin's answer.
- Not an auto-pairing flow and not an auto sign-in; OAuth and the pairing code are the human's to give, deliberately.
- Not a promise about macOS or Linux: the registry keys do not exist there and the command says so and exits 0.

# THE PATHS, MEASURED

| Path | Outcome | Evidence |
|---|---|---|
| Not Windows | prints Web Store path, exits 0, touches nothing | unit test |
| No Chrome/Brave/Edge found | prints the missing browser, exits 0, touches nothing | unit test |
| Key write denied for one browser | the others still complete; install exits 1; postinstall exits 0 | unit test |
| Zip fetch fails / hash mismatch | no folder written, keys still written, reason printed, install exits 1 | unit test |
| Fresh Windows machine, browser starts after install | extension installs itself | driven on this machine 2026-11-12, Chrome 153.0.8010.36, Brave 157.1.99.56, Edge |
| Keys deleted, browser starts | extension removes itself | driven same day, all three browsers |
| Chrome after a removal, keys restored | does **not** silently reinstall in that profile | driven 2026-11-12; the removal blacklist is in the browser, not in us. A user who Removes needs Load unpacked, or the Web Store listing |
| Developer-mode (Load unpacked) copy | not visible to the keys; one click at `chrome://extensions` removes it | known browser behaviour |

# THE TWO COMMANDS

```
npm i -g opera-agent-mcp            # or: npx opera-agent-mcp install
opera-agent-mcp auth                 # the one human step: sign in
# pair the device in the extension; that part takes one code and nothing else

...later...
opera-agent-mcp uninstall           # one command, almost everything gone
# restart the browser; the registry-installed extension is gone
```
