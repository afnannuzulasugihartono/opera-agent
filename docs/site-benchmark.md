@last-edited: 2026-11-01 UTC+7.
@related: [`AGENTS.md`](../AGENTS.md) - [`design-references.md`](design-references.md) - [`handoff.md`](handoff.md) - [`superpowers/specs/2026-10-26-cohere-grade-site-design.md`](superpowers/specs/2026-10-26-cohere-grade-site-design.md)

# Benchmark situs — Cline, OpenCode, Cohere

Measured 2026-11-01 in Chromium, one script on every page. Our home at an inner
width of 912px (the reader's window); Cohere at 1000px. Every number below is
measured, and "How to measure it again" repeats the method.

## The public home, measured

| | Opera Agent (`/beranda`, before) | Cline (`cline.bot`) | OpenCode (`opencode.ai`) | Cohere (`cohere.com`) |
|---|---|---|---|---|
| headline | 54.7px, weight 600, −2.74px tracking, 2 lines | 47.5px, weight 340, +0.54px, 1 line | 22px, weight 700 (the hero is a terminal) | 60px, weight 400, −1.2px |
| hero action | 44px tall, pill, 14.5px type | 36px, radius 7px, 14.4px type | a copy-paste command | 52px, pill, 16px type |
| navigation | 9 flat doors, 15.5px type | 43 links through a mega menu | 6 links, 15px type | 64 links through a mega menu |
| sections | 7 | 12 | 10 | 33 |
| paragraphs | 26, longest 104 characters | 19, longest 138 characters | 6, longest 247 characters | not comparable: the mega menu and the consent dialog live inside the page |
| real images | 0 (a CSS mock of the console) | 6 | 2 | 88 |
| page height | 4625px | 6585px | 3649px | 1872px |

**After, live on 2026-11-01** (`https://opera-agent.pages.dev/beranda`, 912px
inner width): headline 54.72px, weight 500, −1.6416px tracking; 23 paragraphs,
longest 104 characters; 7 sections; 0 images; page height 4592px; navigation
overflow 0px. The hero action keeps its 44px. A same-origin A/B at the same
width measured the copy change on its own: 25 paragraphs and 4638px before,
23 and 4574px after.

What the numbers say:

1. **Our prose is the shortest of the four.** The longest paragraph on the home
   page is 104 characters against Cline's 138 and OpenCode's 247. One idea, one
   action, one object per section — the rule from the Cohere-grade spec holds.
2. **Our headline was the heaviest and the tightest of the four.** It printed
   600 weight with −2.74px of tracking where Cohere prints 400/−1.2px and Cline
   prints 340/+0.54px. The repo's spec sets display type at 500, tracking
   −0.03em, line height 1.02; the live site had drifted to 600/−0.05em/0.97.
   The type is back on the spec, inside the band the references occupy.
3. **The hero action keeps its 44px.** It sits between Cohere's 52px and
   Cline's 36px, and the spec fixes it at 44px.
4. **The navigation gave away four doors for nothing.** At a 912px window the
   whole row (Unduh, Model Anda, Dashboard, Akun, Fitur, Privasi, Dukungan,
   language, Masuk) needs 777px of the 849px the shell leaves, and four were
   hidden while 72px sat unused. They now survive down to 861px, where the row
   stops fitting.
5. **We ship no photographs.** Cline shows six, Cohere eighty-eight; our proof
   is a CSS mock of the console. A reader cannot see the product.

## The signed-in console, measured

The live dashboard sends a stranger to the sign-in page on purpose ("no token,
no dashboard"), so the console was measured from a local render of
`landing/dashboard.html` with its two Supabase origins pointed at a local stub
answering with two devices, one online. The instrument is a route in the stub
that opens the console in an iframe and writes its geometry into the DOM, so
headless Chrome can dump the same numbers before and after.

Cline's console was measured in the same browser: title 24px/600, section
heading 16px/600, nav link 16px/400 at 239×48, and an active sidebar item in a
soft purple fill rather than a block.

| | before | after | reference |
|---|---|---|---|
| view title | 18px/500, line box 22.5px | 24px/600, line box 30px | Cline's title is 24px/600 |
| metric figures | 22px/600 | 18px/600 | the title now outranks the numbers under it |
| heading weight | site.css's marketing 500 reached both app surfaces | `body.app-dark` re-pins 600 | the account title was 34px/500 |
| header content | a centred 1200px box at x=111, over a 1422px console | the window's edges, 24px gutters | one measure on one screen |
| footer content | a third centred box | the same gutters | |
| active rail item | a solid accent block, the loudest thing on the page | `--accent-soft` fill, `--accent-strong` text, 9.27:1 measured | Cline uses a soft tint |
| header doors | 9, the marketing map and the app's own | 5: Unduh, Dashboard, Akun, the language | Cline's and OpenCode's app bars carry the app's destinations only |
| account line | "Device milik {email}." | "Akun {email}." | the page names the account |
| app bar actions | two, the second one already in the nav, the rail and the account view | one | |
| status line | "2 device ter-pairing, 1 daring." — two of the three figures again | "Semua device daring." / "Sebagian device offline." / "Tidak ada device daring." | the state, not the counts |
| document title | "Tabel — Opera Agent" | "Tabel \| Dashboard Opera Agent" | Cline writes "Home \| Cline Dashboard", OpenCode "Activity \| OpenCode Console" |

The radii, the label scale and the title size are Cline's own console
measurements. The rest of this table is what the redesign changed.

## What shipped on 2026-11-01

1. **Display type back on the spec.** `h1`–`h4` carry weight 500, the hero
   headline sits at line height 1.02 and tracking −0.03em, and the eyebrow is
   12px/500 as the spec sets it. Locked by `tests/landing-visual.test.mjs`.
2. **The navigation keeps the product map above 861px.** The four secondary
   doors are shed only where the row stops fitting, and the row still scrolls
   where even that is too much.
3. **Console view titles breathe.** `section h1` sits at line height 1.25, so
   the line box (22.5px) is taller than the 18px glyphs. Locked by
   `tests/landing-dashboard.test.mjs`.
4. **The home page stops half-switching language.** The eyebrow read
   "Daftar terbuka · Browser automation, under your control" on an Indonesian
   page, the tile said "Devices", the member action said "Pair device", and the
   three install steps stayed Indonesian under the EN toggle. All four are
   Indonesian now, and the three steps are translated.
5. **The home copy stopped repeating itself.** The eyebrow promised control
   ("under your control"), the privacy section promised it again, and the
   closing band promised it a third time. The FAQ sub-line said "Jawaban
   singkat." about a list of five short answers. The eyebrow now names the
   mechanism (MCP), the privacy section links the policy and nothing else, and
   the FAQ and closing band lost their filler lines.
6. **The console's headings are the console's own.** site.css gives every
   `h1`–`h4` the marketing display weight of 500, and it reached both signed-in
   surfaces: the console's view title measured 18px/500 and the account page's
   34px/500. `app.css` now re-pins 600 on `body.app-dark`, and the console's
   title is 24px/600 — the size Cline prints its own in.
7. **The console carries one measure.** The header's content sat in its own
   centred 1200px box over a 1422px console and the footer in a third, so one
   screen held three widths. Both now take the console's own 24px gutters.
8. **The console says one thing once.** The account line reads "Akun {email}."
   instead of calling an account a device, the app bar dropped the "Kelola
   akun" button the nav, the rail and the account view already carry, and the
   status line names a state ("Sebagian device offline.") instead of repeating
   two of the three figures above it.
9. **The active rail item is a tint, not a block.** A solid accent fill was the
   loudest thing on the dark canvas; it is now `--accent-soft` with
   `--accent-strong` text, measured at 9.27:1.
10. **The browser tab follows the app convention.** "Tabel — Opera Agent"
    became "Tabel | Dashboard Opera Agent", after measuring Cline's "Home |
    Cline Dashboard" and OpenCode's "Activity | OpenCode Console".
11. **The app bar carries the app's own doors.** The signed-in bar carried
    nine items — the marketing map and the app's destinations — where
    Cline's and OpenCode's app bars carry the app's destinations only. The
    console and the account page now show Unduh, Dashboard, Akun and the
    language; every door stays in the footer.
12. **The dark canvas answers the keyboard.** `site.css`'s focus ring is
    `#0b6b52`, which measures 2.99:1 on the console's canvas and 2.82:1 on a
    card — under the 3:1 a focus indicator has to clear — and its selection
    painted white ink on the brand green, 1.76:1. The app shell now re-points
    the ring to the accent (11.72:1) and inks the selection dark on the
    accent.
13. **The summary card says one thing once.** The Ringkasan view opened with
    a lead-in that listed the three things its own card showed, and the card
    then said "Pasang dulu di bagian Unduh, lalu pair dengan akun ini" on top
    of the checklist that names those steps and the app bar's action that
    points at Unduh. The lead-in is gone and the state line states the fact;
    the steps live in the checklist, once.

## Next round, ranked

1. **A real picture of the product in the hero.** Cline shows six images,
   Cohere eighty-eight; we show a CSS mock. One PNG of the extension popup
   answers "what does this look like" better than any copy. It also needs
   `img-src 'self'` in `landing/_headers` and `landing/vercel.json`, which
   today allow `data:` only, plus the hosting gate that keeps those two files
   in step. The best trust-per-hour item left.
2. **One product map in the navigation.** Nine flat doors work at 1440px; the
   references give a reader a map of what the product does (43 and 64 links).
   A short "Fitur" group — read the page, click, fill the form — costs one
   list and no mega menu.
3. **Translation coverage on the remaining pages.** Measured across all twelve
   landing pages: 198 Indonesian sentences carry a `data-i18n` mark and 84 do
   not. The gaps are `akun.html` (17), `privasi.html` (16), `dashboard.html`
   (15), `syarat.html` (14), `oauth/consent.html` (11), `404.html` (5),
   `unduh-berkas.html` (3), `index.html` (2) and `unduh.html` (1).
   `beranda.html`, `fitur.html` and `dukungan.html` are clean. The three app
   surfaces — `akun.html`, `dashboard.html` and `oauth/consent.html` — carry
   the language toggle and load `i18n.js`, but hold no `#i18n-dict` at all, so
   their toggle switches nothing.
4. **The console, measured with a real account.** Every console number above
   comes from a stubbed session; the redesign was measured the same way.
   Re-measure against a real account before the next round, and keep the
   surface dark: it is the only place on the site that is.
5. **Cohere's 52px action.** Only if the spec's 44px is revisited. Cline's
   36px says 44px is a fine middle, and our action already carries the one
   filled action per section.

## How to measure it again

- Open the four pages in the same Chromium and read the computed style of the
  first `h1`, the first filled action in the hero, the first `section`, and the
  navigation's children. Count the sections, the paragraphs and the images.
- For the navigation, set the header's wrap width to a chosen viewport width
  and read `nav.scrollWidth` against `nav.clientWidth`: the row fits when the
  first is not larger than the second. A media query in this browser measures
  the viewport **including** the scrollbar, so a 912px window leaves
  `912 − 15 − 48 = 849px` of shell.
- For the console, point `AUTH_HOST` and `REST` at a local stub that answers
  `/auth/v1/user` and `opera_my_devices`, inject the access token, and measure
  the signed-in shell. The live page will not show it to a stranger, and that
  is the design. The stub serves one `/measure` route that opens the console
  in an iframe and writes the geometry — header and footer boxes, the content
  column, the view title, the metric figures, the active rail item — into the
  DOM, so `chrome --headless=new --dump-dom` prints the same numbers before
  and after. The screenshot has to disable transitions: the console's primary
  action changes class after the session resolves, and headless Chrome
  captures the frame before the fill has finished.
