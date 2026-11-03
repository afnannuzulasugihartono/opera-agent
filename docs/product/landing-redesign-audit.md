# Redesign the landing, benchmarked against Cline

Audit of the public site, run 2026-11-03 against the taste-skill redesign procedure
(`taste/redesign` + `taste/default`): typefaces, type scale, spacing, hierarchy, column
width, and one primary action per screen.

## What the page is today

`site.css` still carries the brochure its first version was built as: a warm paper
canvas (`#f7f5ef`), one serif-ish sans, 18px body, a 980px `--pill` and a 22px `--radius`.
Every card is a rounded slab with a soft shadow. The dashboard already moved off that
language — `app.css` marked the move explicitly ("a Cline button is 6px and a Cline card
10px … 22px card and 980px pill are the brochure shape") — so the signed-in product and
the public page no longer speak the same language.

## Findings, worst first

**Critical — the page and the product disagree about what this is.** The marketing page
is paper, pill-shaped and soft; the console is dark, 6px and flat. A visitor signs in and
the product looks like a different company. *(structural, medium)*

**Major — two accent systems.** `--accent` is a deep green (`#0b6b52`) used for buttons
and links, while `--brand` is the mint (`#3ecf8e`) used inside the logo. On paper the mint
is too light for text, so the mint is decoration only; on the dark console the mint is the
working accent. One brand, two roles, no page that shows both. *(colour, small)*

**Major — body copy sits at 17–18px on a 980px measure.** A reference product page
(Cline's own dashboard at 1536px: 13px UI labels, 14px body, a 12-column content grid and
no pill) reads denser and more deliberate at the same distance. Long paragraphs at 18px on
a wide measure read slow. *(typography, small)*

**Major — every section is a card.** Rounded slabs with shadows make a feature list look
like a brochure; the reference uses plain fields of tone, spacing and one picture per idea.
Shadows at rest are the taste rules' own red flag. *(layout, medium)*

**Minor — the nav carries nine items**, four of them secondary, so nothing is the
primary action. One primary action per screen. *(hierarchy, small)*

**Minor — spacing is not one scale.** `22px`, `18px`, `14px`, `1200px` measure plus several
one-off paddings, so vertical rhythm drifts page to page. *(spacing, small)*

## What the fix changes

- **One type scale and one measure,** taken from the console's own: 13/14/16/20/28/40,
  body 15px, prose 680px, content 1160px.
- **One accent** — the mint `#3ecf8e` — with a darker working pair (`#0f9d63`,
  `#0a7a4d`) for text and buttons on paper, so mint text clears 4.5:1 there and the dark
  console keeps the same hue. Everything else is neutral.
- **Flat surfaces:** cards lose their shadow at rest and take a 6–10px radius, the pair
  `app.css` already measured. Tonal steps replace borders.
- **One primary action per screen,** and the nav drops to the four that answer a visitor's
  question.

The redesign is a token and component change in `site.css` plus a hero rewrite of
`beranda.html`; section content and copy are preserved.
