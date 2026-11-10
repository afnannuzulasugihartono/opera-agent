@last-edited: 2026-11-09 UTC+7.
@related: [`handoff.md`](handoff.md) - [`design-references.md`](design-references.md) - [`AGENTS.md`](../AGENTS.md)

# Website plan — easy to navigate, easy on the eyes

An audit leads this plan, not a mood board, because the failure is measurable: too much copy for the product on every screen.

## The audit

Read top to bottom across the public pages:

1. Every page narrates what it is instead of doing one job for the reader ("Fitur — Apa yang bisa dilakukan dan untuk siapa." is the page introducing the page).
2. Prose paragraphs repeat claims the design already makes (the button says install; adjacent text explains the button).
3. Two call-to-actions fight for the same attention (pasang + dashboard + pair all land on one page).
4. The accent color is spent on labels, not actions only, so the eye learns nothing is special.
5. Numbers that prove the product (35 tools, 31 primitives, 6 permissions, the refusals, the latency figures) carry no more weight than filler sentences.
6. Five browsers install this; the site showed five letters, and the fan that makes it memorable was text.

## The contract

Three lines, on every page:

1. A page is one job. Name it in one sentence before writing anything else. If you can't, the page is not done.
2. A screen is one action. Every other element is support for that action or proof it is worth taking.
3. Words act or prove. Every sentence either instructs the reader to do something or states a measured fact. Anything else is dead text and dies in this plan.

## The rules

- Kill on sight: page-intros of the page, restated CTAs, "klik di sini", "halaman ini", "seperti yang disebutkan", "kami" boilerplate, any sentence that could fit on any other website unchanged.
- Keep, never compressed: the first-screen answer (what this is), the instructions, the numbers, the legal text, the refusals, the pricing facts, the honest failure modes.
- Budgets: nothing longer than two lines on screen; no section without an action or an artifact; at most two CTAs per screen; at most one h3 under one h2; no nested prose inside prose.
- The bilingual rule stands: authored Indonesian is the source, the `en` dict mirrors it, and the two are edited together in the same commit, never one without the other.
- Gates stay green. Where a gate pins a sentence this plan deletes, the gate is re-pinned with its reason in the commit, never silently deleted.
- No new features anywhere in this plan. Deletion and layout are the whole toolkit.

## The map (page → job → action)

| Page | Job | One action |
| --- | --- | --- |
| `beranda.html` | Convince a first-time reader and steer them | Pasang Opera Agent |
| `unduh.html` | Answer "where do I get it" with the least friction | Open `unduh-berkas.html` |
| `unduh-berkas.html` | Hand over the file for this browser | Download the zip file |
| `fitur.html` | Prove the product works end to end | Unduh |
| `bukti.html` | Show the measured numbers, nothing else | Unduh |
| `studi.html` | Show finished work the reader can judge | Unduh |
| `dukungan.html` | Answer support questions, then leave | Open docs |
| `docs.html` | Teach the roads (explanations allowed here, only here) | Call an example |
| `privasi.html` | The legal page nobody enjoys but needs | — |
| `syarat.html` | The legal page nobody enjoys but needs | — |
| `404.html` | Recover from any dead link | Pick a labeled recovery |
| `index.html` | Sign in without ceremony | Masuk |
| `akun.html` | Account settings with no narrative | Save |

`harga.html` and `dashboard.html` are the site-redesign agent's pages and are not edited by this plan.

## The visual language (manjakan mata)

- **Type.** One face (Inter/system stack), larger visible sizes than the current site (17–19px reading text, not 15–16), only two weights in use per screen (400 text, 650–700 actions). Letter-spacing only on the display headline.
- **Color.** The ground stays `#0b0d10`; the accent `#3ecf8e` is spent on actions, focus rings and verified states only; every gray step is lifted one level from today so 60-year-old eyes stop squinting; no gradients, no glow, no shadows at rest.
- **Layout.** One reading measure (680px) for prose and one wide measure (1200px) for grids. Two columns only when two things are being compared or answered side by side. Sections are 96–120px apart; one idea per screen.
- **Motion.** One arrival choreography (rise 16–20px, 90ms apart, once), one hover (accent shift or a 3px nudge), the browser-fan light-up in order. No new motion is added anywhere else.
- **Images.** The browser fan (real Chromium logos, drawn or official CC0 marks), the measured numbers bigger than the prose around them, the real dashboard, and nothing else. No illustrations of people.
- **Icons.** Inline SVG, single stroke weight, monochrome unless it is the logo itself. No emoji anywhere.

## Execution order

1. `unduh.html` + `unduh-berkas.html` — done on branch `agent/download-redesign/download-redesign` (one door, quiet facts, two-column answers, logos, arrival motion).
2. `fitur.html` — delete the page-intro, collapse each proof block to one claim + one artifact, remove the two duplicated counters.
3. `studi.html` + `dukungan.html` — trim everything that narrates; keep the artifacts and the FAQs.
4. `privasi.html` + `syarat.html` — read-only rhythm pass; no legal fact is cut; only framing sentences die.
5. `404.html` + `index.html` + `akun.html` — reduce to their one job.
6. `beranda.html` — prune the demo to its two most compelling panels, dedupe the statements, cut the hero lede to one clause; keep the install steps and the pair flow untouched.
7. Every page ships the same nav and the same footer, byte for byte.
8. Gate run (`npm test`, `npm run check`) after each page; no page merges red.
9. Browser pass at 390/768/1440 before calling the plan done; screenshots attached to the PR.

## Owner decisions — resolved, least friction first

1. **The `⌘K` search stays.** It works end to end: 21 destinations, bilingual, arrow-key navigable, one dialog built at runtime. Removing a working door adds friction; the failure mode would be a dead box, and it has none.
2. **The footer becomes two columns.** Produk (Beranda, Fitur, Unduh, Bukti, Docs, Dashboard) and Legal (Privasi, Syarat, Dukungan). Wider cells, larger tap targets, nothing duplicated from the nav below this line.
3. **The hero demo becomes one panel.** Chrome only: read the page, read more, end on the refusal that never gets clicked ("ditolak: kolom pembayaran") — the single most memorable beat this product offers. The docs/maps panels go; the "Halaman mana pun" strip already carries the any-page claim.
