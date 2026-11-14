# @last-edited: 2026-11-12 UTC+7.
# @title: registry install - the extension appears in Chrome, Brave and Edge with one double-click, no store review waiting.
# @state: measured 2026-11-12 on Windows against isolated throwaway profiles: Chrome 153.0.8010.36, Brave 157.1.99.56 and Edge (x86) each installed the extension automatically after the first browser start, from the public update URL.
# @dependencies: `docs/store/extension-registry-install.reg`, `docs/store/extension-registry-uninstall.reg`, `docs/install.md`, `docs/releases/1.6.44.md`.

# WHAT IT DOES

**The interactive path lives in [`docs/install.md`](./install.md)** — this page is the `.reg` route for people who want the keys without the npm package (or whose package is unreachable).

`docs/store/extension-registry-install.reg` writes four keys, one per browser
(Windows `HKCU`, per-user, no administrator rights):

- `HKCU\Software\Google\Chrome\Extensions\ofgemipoobcnbjkfanmofjbdonjapmgl`
- `HKCU\Software\BraveSoftware\Brave-Browser\Extensions\ofgemipoobcnbjkfanmofjbdonjapmgl`
- `HKCU\Software\Microsoft\Edge\Extensions\ofgemipoobcnbjkfanmofjbdonjapmgl`

Each carries one string value, `update_url`, pointing at the signed CRX's
update manifest:

`https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/update.xml?id=ofgemipoobcnbjkfanmofjbdonjapmgl`

On the first browser start after the key is written, the browser reads the
key, fetches the manifest, downloads the CRX, and **installs the extension
on its own**. Every later start re-checks the manifest; when a new CRX is
signed and published, the extension updates without anyone asking.

# HOW IT IS CLAIMED, AND WHAT IS CLAIMED

Measured 2026-11-12 on this machine, Windows, **isolated throwaway
profiles** (not the everyday profile, not a clean machine): each browser
installed the extension at first launch; version `1.6.44_0`; no dialog, no
prompt, no manual step. The everyday browsers on this machine already
carry the extension from a manual unpack, so the key's effect on this
machine was indistinguishable from the install that was already there —
which is exactly why the throwaway-profile test was the one that
counted. These runs install to a **new** profile; the claim is about
first-time install on a machine that does not have it yet.

# WHAT IS TRUE, AND WHAT IS NOT

- The extension id is pinned and the CRX is signed by this project's key;
  the update URL is the same one the web UI points at. Nothing here
  trusts a third party.
- The extension shows as installed by something outside the store. That is
  honest: it **was** installed by something outside the store.
- **This is not the Chrome Web Store.** It does not need store review, and
  it is not available on macOS or Linux — a `.reg` file does nothing
  there — and it does nothing on policy-managed browsers whose admins
  forbid external installs.
- It is not auto-pairing and not auto-signing-in: after the extension is
  present, pairing the device is still one code, as on any other install.
- On unmanaged Windows machines, an installer that writes this key is
  fine. On machines whose owner never chose to run an installer, this
  mechanism is unavailable — and should stay that way.
- Edge on machines where the admin blocks external CRX will behave as the
  admin said, not as we said.

# HOW TO USE IT

1. Download or locate `docs/store/extension-registry-install.reg` from this
   repository (or the release artifact that carries it).
2. Double-click it, or run `reg import store\extension-registry-install.reg`.
3. Restart any open Chrome, Brave or Edge window the first time.
4. The extension is present; pair the device the usual way (unduh page /
   dashboard), as on any manual install.
5. The extension is pinned to the toolbar like any install; pair the device
   as usual.

# HOW TO REMOVE IT

`docs/store/extension-registry-uninstall.reg` deletes the four keys, so no
browser re-installs the extension on later starts. An extension already
installed stays installed; remove it from `chrome://extensions`,
`brave://extensions` or `edge://extensions` like any other extension.

# WHY THIS EXISTS ALONGSIDE THE STORE

The Chrome Web Store is the answer for anyone who should not run a `.reg`
file. This path exists for people who already install software by hand
(developers, docs curl users, IT rolling it out per user on a bench of
machines), and it keeps working between the day you read this and the day
the store listing is live.
