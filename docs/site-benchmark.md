@last-edited: 2026-11-01 UTC+7.
@related: [`AGENTS.md`](../AGENTS.md) - [`design-references.md`](design-references.md) - [`handoff.md`](handoff.md) - [`superpowers/specs/2026-10-26-cohere-grade-site-design.md`](superpowers/specs/2026-10-26-cohere-grade-site-design.md)

# Benchmark situs — Cline, OpenCode, Cohere

Measured 2026-11-01 in Chromium, one script on every page. Our home at an inner
width of 912px (the reader's window); Cohere at 1000px. Every number below is
measured, and "How to measure it again" repeats the method.

## The public home, measured

| | Opera Agent (`/beranda`) | Cline (`cline.bot`) | OpenCode (`opencode.ai`) | Cohere (`cohere.com`) |
|---|---|---|---|---|
| headline | 54.7px, weight 600, −2.74px tracking, 2 lines | 47.5px, weight 340, +0.54px, 1 line | 22px, weight 700 (the hero is a terminal) | 60px, weight 400, −1.2px |
| hero action | 44px tall, pill, 14.5px type | 36px, radius 7px, 14.4px type | a copy-paste command | 52px, pill, 16px type |
| navigation | 9 flat doors, 15.5px type | 43 links through a mega menu | 6 links, 15px type | 64 links through a mega menu |
| sections | 7 | 12 | 10 | 33 |
| paragraphs | 26, longest 104 characters | 19, longest 138 characters | 6, longest 247 characters | not comparable: the mega menu and the consent dialog live inside the page |
| real images | 0 (a CSS mock of the console) | 6 | 2 | 88 |
| page height | 4625px | 6585px | 3649px | 1872px |

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
answering with two devices, one online.

| | Opera Agent console | note |
|---|---|---|
| view title | 18px, weight 600, line box 17.8px | the line box was smaller than the glyphs it held |
| controls | 36px, radius 6px, 13.5px type | 10px cards and 6px controls are the benchmark's own console measurements |
| rail | 220px wide, 8 doors, 13.5px type | |
| metric strip | 22px numbers, 11px labels | |
| surfaces | `#0c0e11` canvas, `#12151a` cards, radius 10px | |

The console was benchmarked against Cline in an earlier round — the radii, the
label scale and the title size are Cline's. The one defect left was
typographic.

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
3. **Translation coverage on the remaining pages.** `unduh.html`, `fitur.html`,
   and `dukungan.html` carry unmarked strings of their own. The mechanism is
   already there; the marking is not.
4. **The console, measured with a real account.** Every console number above
   comes from a stubbed session. Re-measure before changing the console, and
   keep the surface dark: it is the only place on the site that is.
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
  `/auth/v1/user` and `opera_my_devices`, and measure the signed-in shell. The
  live page will not show it to a stranger, and that is the design.
