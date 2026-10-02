# Installation

## Recommended one-time installation

Opera Agent 1.6.14 is the release candidate. The private update channel serves it under the unchanged extension identity:

```text
ohbbpamcljckmjhcpkcmefdobkoeaick
```

## Signing identity history

The 1.1.0 line introduced the current signing identity because the legacy private key was unavailable. Releases 1.1.0 through 1.6.14 use extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`, so updates in this line preserve the installed identity and pairing. The older 1.0.x identity is retained only as historical documentation.

Update manifest:

```text
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/update.xml
```

Opera/Chromium automatically appends the installed extension ID to that shared URL. For a manual diagnostic of the current identity, use `update.xml?id=ohbbpamcljckmjhcpkcmefdobkoeaick`; requesting the shared URL without an ID intentionally returns the legacy channel.

Signed CRX:

```text
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-update/opera-agent-ohbbpamcljckmjhcpkcmefdobkoeaick-1.6.14.crx
```

The initial install is a browser trust boundary and may require a one-time Opera confirmation. Private self-hosted update delivery has been verified end-to-end in managed Chromium with the same CRX3 signing model. Actual Opera/Windows policy behavior is verified during the target-browser acceptance pass.

## Unpacked fallback

If Opera refuses a private CRX install without enterprise policy:

1. Extract `opera-agent-1.6.14-extension.zip` to a permanent folder.
2. Open `opera://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the folder containing `manifest.json`.
6. Accept requested permissions, including debugger access for trusted input.
7. Open the Opera Agent popup.

Expected version: `1.6.14`.

## Pairing

Create a one-time pairing code from the connected Supabase project:

```sql
select public.opera_create_pairing_code('opera', 10);
```

Paste the returned code into the Opera Agent popup and choose **Pair device**. The popup should become `ready`. The device secret is generated locally by the extension; the database stores only its SHA-256 hash.

## Smoke test

```sql
select public.opera_run('browser.ping', '{}'::jsonb, 5000, 'opera');
select public.opera_run('tabs.list', '{}'::jsonb, 5000, 'opera');
select public.opera_run_workflow('browser.status', '{}'::jsonb, 5000, 'opera');
```

## Updates

Site/workflow behavior normally updates in Supabase and requires no extension reinstall. When browser-local primitives change, a new signed CRX is published under the same extension ID and the update manifest points to the active release.
