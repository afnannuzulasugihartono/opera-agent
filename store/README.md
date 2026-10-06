@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [HANDOFF.md](../docs/HANDOFF.md) - [extension/README.md](../extension/README.md)

# Chrome Web Store

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

The listing as the store will show it, and why each field is what it is.

## The package

`py scripts/build-store-package.py` writes [`store/opera-agent-store.zip`](opera-agent-store.zip) and
[`store/store-manifest.json`](store-manifest.json).

The zip is deterministic: entry timestamps are pinned, so two builds of the same source produce the
same bytes and the same digest. Measured on the current build: 32 files, 101,586 bytes, sha256
`4632475a5acd99c40e0edea6a4aba284f88adce98c406a5d5b804768c90dd868`.

The store rejects two fields the sideload build needs, so the package carries its own manifest and the
sideload manifest is untouched:

- `key` — the store assigns the extension id, and a manifest that declares one is refused.
- `update_url` — the store owns updates once an extension is listed.

That is why [`extension/manifest.json`](../extension/manifest.json) keeps both: the installer writes a
policy naming the id derived from `key`, and [`opera-agent-update`](../supabase/functions/opera-agent-update/index.ts)
serves the signed CRX for that id. The store extension is a different installation with a different id.

## Listing

- Name: `Opera Agent`
- Version: `1.6.15.0` — the store requires four parts, the project carries three, so the build appends a zero
- Description, 104 characters of the 132 allowed:
  > Bawa asisten AI Anda mengemudikan browser: klik, ketik, isi formulir, baca halaman. Anda pilih modelnya.
- Category: `Productivity`
- Language: `Indonesian` — the copy is Indonesian, and declaring the wrong one is the fastest route to a review asking for a change

## Permissions and the justification each one needs

The store asks for a sentence per permission. These are the ones that draw scrutiny, and the sentence
to give for each.

- `debugger` — this is the permission that makes the product work at all. It attaches Chrome DevTools
  Protocol to a tab, which is what lets a keystroke reach an element that no script can focus.
  Sentence: *Menempelkan Chrome DevTools Protocol ke tab agar perintah mengetik dan klik bisa mencapai
  elemen yang tidak dapat difokuskan oleh skrip biasa.*
- `scripting` — injects the content script on demand.
  Sentence: *Menyuntikkan content script ke halaman setiap kali perintah datang dari relay.*
- `tabs` — enumerate and activate tabs.
  Sentence: *Membaca dan mengaktifkan tab untuk menjalankan perintah pada tab yang benar.*
- `storage` — the options page.
  Sentence: *Menyimpan alamat bridge, endpoint model, dan preferensi pengguna.*
- `alarms` — the periodic check that waits for a command.
  Sentence: *Menjalankan pemeriksaan berkala untuk mengambil perintah dari relay.*
- `host_permissions: http://*/* and https://*/*` — every site, because the product's whole purpose is
  driving whatever page the user is on.
  Sentence: *Akses ke semua situs karena produk ini menjalankan perintah pada halaman yang sedang
  dibuka pengguna, situs mana pun.*

## Single purpose statement

The store requires one sentence describing what the extension does for the user. A truthful one, using
only the runtime's own claims:

> Opera Agent menjalankan perintah browser — klik, ketik, isi formulir, buka dan baca halaman — yang
> dikirim oleh asisten AI pengguna, melalui relay milik pengguna.

This says nothing the runtime cannot do. The extension cannot browse on its own, cannot read pages
without a command from the user's own assistant, and cannot send content to a model the user did not
choose.

## The icons

Four sizes, drawn by [`scripts/draw-icon.py`](../scripts/draw-icon.py) in the site's own palette:
`#0b0d10` background, `#14181d` card, `#14b8a6` accent. The mark is the pointer the extension actually
uses — one dot that moves — so the icon is the product rather than a letter.

The PNG encoder is written by hand in that script because this repository has no dependencies and
Pillow is not installed. Verified by decoding the output back: 128x128, 8-bit RGBA, the corners are
the background and the centre pixels are the surface and the accent, so the file is a real image and
not a blank one.

| Size | Bytes | Used by |
|---|---|---|
| 16 | 177 | browser toolbar |
| 32 | 309 | extension list |
| 48 | 372 | extension management page |
| 128 | 588 | the store listing, and `chrome://extensions` header |

## Privacy declarations

- Single purpose: as above
- Remote code: **the extension does not execute remotely supplied code**, and this must be declared
  honestly. The MV3 CSP in [`extension/manifest.json`](../extension/manifest.json) is
  `script-src 'self'`, so a page cannot cause the extension to run code it supplied.
- Data collection: declare **none by the extension itself**. Page content travels from the user's
  browser to the user's own model endpoint, which the user configured, and the extension returns none
  of it to us. The store's declaration asks what *the extension* collects; this one stores nothing
  about the person using it beyond the account the user chose to sign in with.
- Data usage certification: the extension is not sold, not used for advertising, and not used to
  decide credit or lending.

One question here deserves a straight answer rather than a careful one: the relay does carry commands
and command status between the browser and the assistant, and page text reaches whichever model
endpoint the user configured. Neither of those is collection by the extension, and the review is
entitled to ask, so [`docs/HANDOFF.md`](../docs/HANDOFF.md) records what actually crosses the wire.

## Screenshots

The store wants at least one 1280x800 screenshot. None exist in the tree yet. They have to show the
product doing something, not the store page, and they must not contain a real account, a real email
address, or a real session. [`landing/index.html`](../landing/index.html) is the honest source: it
already shows the dashboard, the device list, and the account page against the live backend.

## Privacy policy URL

The store requires a publicly reachable privacy policy. The page already exists and is already
served:

```
https://opera-agent.pages.dev/privasi.html
```

Measured: 200. It is reachable without a session, which is the requirement.

## What is left, and it is not code

1. A Google account, and a one-time developer registration fee of $5.
2. The upload itself, at the Chrome Web Store developer dashboard, which requires a browser and a
   human. There is no API for the initial upload that this repository can call.
3. Review. Expect days, not hours, and expect a question about `debugger`, because it is the honest
   answer to what this product does.

Everything above the upload line is built and checked. The script refuses to produce a package that
carries a field the store rejects, so a rejection on that ground cannot happen twice.