# Docs Paper Parity — Design

- Date: 2026-10-14
- Status: spec, awaiting review
- Goal: Opera Agent drives Google Docs to full API parity — styling, tables,
  images, alignment, fonts, margins, footnotes, headers/footers, page numbers,
  TOC, equations, bibliography — UI-only, no Google API, no new permission.

## Non-goals

- Google Docs API / OAuth / identity permission: eliminated by decision.
- Slides/Sheets: phase 2 (menu.walk is generic; only seeds differ).
- Streaming type-as-model-generates: phase 2.
- Zotero/citation-manager automation: v1 bibliography is footnote style plus
  a formatted manual list.

## Background

Docs renders its body to canvas; the menu bar, toolbars, and dialogs stay
real DOM with ARIA. Past sessions proved canvas recipes (Docs/Sheets/Slides
key sequences) and menu patterns (burst + hover + refFromStep), but the agent
still shot menus blind: coordinate clicks without grounding, no settle wait,
no post-action proof. Research (two rounds, sourced) sets the fast shape:
keyboard-first menus, MutationObserver + 2 stable rAF settle (~32ms),
pipelined CDP input (~1 RTT), in-page predicate verify (1-5ms), clipped
JPEG + pHash only for paint asserts (20-80ms).

## Architecture

v1 executes over the local bridge (1-6ms per call); the relay stays a
fallback for remote drives, never the primary road for paper work.

One engine, three layers over the frozen 29 primitives:

1. menu.walk — one server-side workflow. Input: path array
   (["Insert", "Table"]) plus optional target. Prefers the keyboard road
   (Alt-letter, arrows, Enter); falls back to hover chains (hover, settle,
   hover, settle, click/press). Menu paths are data, never code.
2. Structure workflows — versioned, one hop each: docs.apply_heading,
   docs.make_list, docs.insert_table, docs.insert_image, docs.footnote,
   docs.header_footer, docs.page_setup, docs.toc_insert,
   docs.export_pdf. Each declares parameters and its expected end state.
3. Model orchestration — the model composes outline to sections to
   structures and verifies; it decides, never aims.

## Components

- menu.walk workflow: path resolution, road selection (keyboard first),
  per-level ground-act-prove, honest failure with the level reached, the
  last observed state, and freshRef candidates.
- Seed menu map: validated Docs paths as versioned workflow data. Grows
  from the attempt log: three successes promote a path to a seed.
- Structure workflows (9): thin compositions of menu.walk plus typing
  and dialog fills, each with parameter schema and end-state predicate.
  Coverage map: page numbers ride header_footer; equations and bibliography
  ride menu.walk seeds with no dedicated workflow in v1.
- Verify ladder: in-page predicate, then container checksum, then clipped
  screenshot compare. A structure without proof is a failure, never silent.

## Data flow

Model goal -> workflow call (1 hop) -> device burst (find, hover, settle,
act, prove per level, all local) -> result with evidence -> model. No model
round trip sits inside a menu walk. Refs mint and die inside one burst via
refFromStep; a stale ref is refused with candidates, never re-aimed blind.

## Error handling

- Fail closed at every level: no valid ref means stop and report.
- Unknown outcome (timeout): re-check state before any retry, never repeat
  blindly (existing rule, kept).
- Honest errors carry: failed level, last observed state, freshRef
  candidates, and whether the menu is still open.
- No coordinate shooting: raw coordinates require measured geometry from a
  live ref, or the call is refused.

## Testing

- Every seeded path proven against live Google Docs (headed, like
  browser_extension_test.py): walked for real, effect verified for real.
- Anti-blind tests: scrambled/hidden menus must fail honestly, never click
  blindly.
- E2E v1: from a user idea, build one representative mini-thesis
  (multi-chapter, all 9 structures, exported PDF) and verify every artefact
  exists. The product bar is a real thesis from real ideas, proven at small
  scale first.
- Budgets locked: <50ms per menu level steady-state, proof mandatory.

## Phases

- v1: menu.walk + 9 structure workflows + thesis E2E. Letters and CVs
  compose from the same set (phase 1b, no new machinery).
- v2: Slides/Sheets seeds, streaming typing, Zotero-class citation flows.
