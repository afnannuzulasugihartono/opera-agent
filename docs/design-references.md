@last-edited: 2026-10-09 UTC+7.
@related: [`AGENTS.md`](../AGENTS.md) - [`handoff.md`](handoff.md)

# Design references

Measured values taken from public reference pages (fetched 2026-10-09), plus
what this repo adopted from each and what it deliberately left behind. Numbers
below are observations, not copied assets: no third-party markup, stylesheet,
image, or font ships in this tree.

## Steam store about page

Source: `https://store.steampowered.com/about/` (public marketing page).

Observed hero grammar:
- Two-column hero: left text block, right product visual, generous whitespace.
- Install button: block-level, uppercase 18px letterspaced label aligned left,
  OS glyph pinned right, blue gradient that slides on hover, soft drop shadow,
  near-square corners.
- Stats row above the button: small-caps label with a colored dot beside it
  (blue for online, green-yellow for playing now), one big number each.
- "Also available on" row with platform marks under the button.

Adopted on `landing/unduh.html`: the layout order (title, value, stats,
button, also-available), the button grammar (uppercase, letterspaced,
glyph-right, sliding gradient, shadow), and the stat shape (dot plus caps
label plus big number). Kept brand green instead of Steam blue, and a pure
CSS mock panel instead of product art. Stats show pinned source counts (tool
total, primitive total), never fabricated live figures.

## VS Code download page

Source: `https://code.visualstudio.com/download` (public marketing page).

Observed card grammar:
- One card per platform in a three-column grid; the matching card carries a
  pill badge and a highlighted border.
- Card anatomy top to bottom: platform icon plus name, one full-width primary
  button, one requirement line, an "other downloads" select.
- Primary buttons are filled rectangles with small radius; the page accent
  sampled at `#0078d4`.

Adopted on `landing/unduh-berkas.html`: one card per browser (five, so the
grid wraps), detected-browser badge plus highlight, zip as the filled primary
button and CRX as the ghost secondary, one requirement line per card. Site
radius and green accent stay as the house style.

## Standing rule

A reference informs layout and hierarchy. Copy, counts, and claims always
come from this repo's own pinned sources: every number on a landing page
must have a test recomputing it, and every compatibility sentence must match
a measured behavior, not the reference's words.
