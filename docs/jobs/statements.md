# The statement job

One client, one portal, one month: that triple is the unit of work and the unit that is
billed. This page is the card the agent works through. It contains no site knowledge —
the portal decides its own words, its own frames and its own sign-in page — so the drive
looks at what is on screen and decides from that.

## The card

```
statement_card { client: "Toko Sinar Jaya", portal: "BCA", period: "2026-09", url: "…" }
```

returns:

```
dir       …/opera-statements/2026-09/toko-sinar-jaya
saveAs    toko-sinar-jaya-bca-2026-09.pdf
manifest  …/opera-statements/2026-09/manifest.json
steps     open, sign in if asked, read, find the download control, download, deliver
proof     the file on disk, its kind, its pages, the balance and where it came from
refuse    a .crdownload, an empty file, a password typed by the agent, a month not on screen
```

The name is derived, not typed: the same client-month always lands on the same file, so
the folder sorts as one family and the manifest cannot grow near-duplicates.

## What the agent does, in order

1. `open_url` the portal, or the statement page the person gave.
2. `read_page` — if it asks to sign in, **stop and ask the person to sign in in their
   own browser**. The drive never types a password and never answers a one-time code.
3. `read_page` again and check the account and the month on screen against the card.
4. `find_elements` for the download control by the words the portal actually uses.
5. `download` with `dir` and `saveAs`, and act only on `downloaded:true`.
6. Read the closing balance off the page, then `statement_delivered` with the path.

## What a delivery claims

`statement_delivered` checks the file itself, so the claim does not rest on the agent's
word:

| Claim | How it is known |
|---|---|
| The file exists and is whole | on disk, not `.crdownload`/`.tmp`, larger than zero bytes |
| What kind of file it is | first bytes: `%PDF-`, `PK\x03\x04` (workbook), `\xD0\xCF\x11\xE0` (old Office), else named as "other" |
| How many pages | `/Type /Page` counted in the file's own structure; `null` with a reason when the file compresses its objects |
| The closing balance | recorded exactly as the page printed it, with the page named as its source |

The one thing it does **not** claim: that the balance inside the PDF equals the balance
on the page. Reading text out of a compressed PDF would need a parser, and a manifest
that pretends to have checked would be worse than one that says where the number came
from.

A second line for the same client-month is refused (`duplicate:true`), because that is
how one month gets billed twice. `replace:true` corrects the existing line instead.

## Measured

Driven end to end over the real MCP surface against the signed-in Chrome, with a local
portal that asks for a password, lists two months, and serves an attachment:

- sign-in gate detected: **yes** — the drive stopped rather than typing a password
- `download`: landed as `statement-2026-09.pdf`, renamed to
  `toko-sinar-jaya-bca-2026-09.pdf`, **178 bytes, 460 ms**
- `statement_delivered`: `kind: pdf`, **pages: 2**, balance `Rp 8.900.000` → `8900000`
- manifest: **1 row**, `delivered: 1`, one period, one client
- a second delivery of the same client-month: `duplicate: true`, still one row
- whole run: **10 calls, 6,997 characters, 1,170 ms** of tool time — ten because the
  fixture signs the person out first so the gate is really met; the job itself is the
  other nine, 6,429 characters and 1,012 ms

The synthetic portal is a fixture, not a claim about any real bank. What it proves is
the loop: the card names the file before anything is clicked, the file that lands is the
one the card asked for, and the manifest refuses what is not whole.

## Two ways to deliver

| | Local (the driver) | Device (the extension) |
|---|---|---|
| Where it runs | on the operator's machine, against a debug port | in the user's own browser, paired to a bridge |
| Who downloads | the driver, over CDP | the device, with the `downloads` permission |
| Where the file lands | the folder the card named | the browser's own download folder, under the card's name |
| Where the proof is read | the file on disk | the same bytes, read by the page that fetched them, plus the browser's own download record |
| Where the manifest lives | beside the files, on disk | the device's own storage, on the user's machine |

The device path is the one that can run without a person watching, which is what turns
this from a service into a product. It adds two commands:

- `statement.download` — the device downloads the file under the name it is given, waits
  until the browser says the file is whole, reads the kind and the page count from the
  bytes the page fetched, and writes one line into the device's manifest
- `statement.manifest` — the device reads that manifest back

The two are exposed on the cloud surface as `statement_deliver` and `statement_manifest`.

**What is proved and what is not.** The device path is unit-tested against a fake
browser: the name rule, the wait, the refusals, the duplicate rule and the row are all
covered ([`tests/statement-device.test.mjs`](../../tests/statement-device.test.mjs)). It has
**not** been driven end to end in a real browser against a real portal — that needs the
extension loaded in a browser with a portal serving a file, which is the next piece of
work, and it is marked unverified until it is.

The permission is part of the promise: without `downloads` the file can only be saved
under the name the portal gives it, and a delivery that cannot be seen on disk is a
claim, not a delivery. The site says so in the permission list.

## Then bill it

The manifest is the record, so it is also the bill. `invoice_create` takes the rows the
manifest returned and turns each delivered client-month into one line priced from
`opera_price_list`; the customer gets a signed link to a page that lists those lines and
the amount, and nothing is charged for a month that is not in the manifest. The same
client-month twice is refused rather than billed twice, and a paid invoice cannot be
reopened by a later call. The page, the signature and the drill that drove them are in
[`docs/product/billing.md`](../product/billing.md).

