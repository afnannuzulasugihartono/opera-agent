# U-I — Identity hardening (geometry-aware refs, ambiguity-ranked find)

Date: 2026-09-21

Status: **IMPLEMENTED / local gates green; awaiting exact-head CI evidence**
(CircleCI + Vercel on the pushed head), after which acceptance follows the
2026-09-19 standing CI-evidence authorization.

Branch: `feat/pre-8e-usability-repair-r8`

## Scope

U-I implements methods I1, I2, and I3 from
`docs/research/perception-identity-verification-2026-09-20.md` so that the
model's most common loop — find, then click/fill — succeeds on the first
round trip more often and fails safely when it cannot. The public MCP
inventory stays frozen at 18 tools with unchanged input schemas; all additions
are extension-internal result fields (`candidateRank`, `hint`, `fuzzy`) or
observational error messages, following the R4 `view:"compact"` and U-V1
`expect` precedents. Protocol 1 and the 26 primitives are unchanged.

## What changed

`extension/content.js`:

- **I1 — geometry-aware rebind rejection.** Action-ref descriptors now record
  mint-time geometry in document coordinates (`rectAtMint`, via the new
  scroll-invariant `documentRectOf`) and the `mutationVersion` at mint. When a
  stale ref attempts rebind through the existing R2 revalidation path and the
  sole candidate has drifted more than `GEOMETRY_DRIFT_TOLERANCE_PX` (24 px)
  from its mint-time document rect, rebind is refused with a fail-closed error
  naming the mutation-version boundary, the current plausible candidates
  (label/tag/rect as JSON), and the instruction to re-run `page.find`. This
  addresses the production Maps hazard (stale `Zoom in` ref rebinding after a
  panel redraw and clicking elsewhere). Document coordinates keep ordinary
  scrolling and `scrollIntoView` from tripping the guard; the connected-target
  path is untouched, so R2's in-place clone rebind continues to work.
- **I2 — ambiguity hints and bounded fuzzy projection.** When `page.find`
  returns more than one candidate, each item gains `candidateRank` (1-based)
  and a `hint` (actionability, viewport state, sensitivity, and the explicit
  `index:` instruction). When an exact-field search yields zero entries, one
  bounded fuzzy candidate (first interactive element whose serialized text
  contains the query) is projected as `item` with `fuzzy: true` and an
  explicit exact-match-fallback hint instead of a bare zero; `count: 0` and
  empty `items` are preserved so callers that ignore the new fields behave
  exactly as before.
- **I3 — visible-text actionable fallback.** When neither exact fields nor
  fuzzy text match, `findVisibleTextCandidate` locates the visible text node
  (bounded to 2,000 text nodes), then returns the closest actionable element
  by center-to-center distance. This collapses the Docs-style
  capture/re-read/reason loop into one round trip.

## Acceptance evidence (local, Windows workstation)

- Node suite: **453/454 pass**; the single failure is the pre-existing
  repository-root governance test caused by ignored local state (`deno.lock`)
  and is absent on clean CI checkouts.
- `npm run check`: PASS — 26 allowlisted primitives, 68 runtime safety files,
  version 1.6.3.
- Controlled-browser regression (`tests/browser_extension_test.py`, Edge,
  headless=new): **exit 0**, including three new U-I scenarios:
  - ambiguity hints present with `chose:1` / `chose:2` on the two `Choose`
    buttons;
  - exact-match zero projects the offscreen `Skip navigation` fuzzy candidate
    with `fuzzy: true` and the fallback hint;
  - a ref minted on `Zoom in` (x≈108) refuses rebind after a destroy-and-
    relocate redraw (mutationVersion 2→3) with the relocated candidate
    (x≈708) named in the refusal, and the visible-text fallback surfaces the
    actionable `Save` near "Quarterly document".
- Source-contract locks added in `tests/ui-identity-hardening.test.mjs`.
- Frozen-byte locks for `extension/content.js` rebaselined
  `9872dd3e…` → `0340d471…` in the P2/P3/P4/P5 boundary tests (recorded
  reason: U-I runtime change; `background.js` untouched).

## Boundary notes (recorded honestly)

- The geometry guard applies only to the disconnected-target rebind path. A
  still-connected element keeps its existing descriptor-match authority, so
  scrolled-but-present refs are unaffected by design.
- The refusal error carries candidate data inside the message string because
  the content-script error transport is string-only; structured candidates
  would require a bridge contract change and are deferred.
- I2's fuzzy projection is attempted only when a `text` query exists and the
  exact-field search returned zero entries; it never fires on role/tag-filtered
  non-text queries.
- Controlled-browser acceptance here ran on the workstation (Edge headless=new)
  rather than the CI Chromium job; exact-head CI evidence remains the
  acceptance basis per the standing authorization.

## I4 follow-up (2026-09-21 afternoon): live T041 stale-ref evidence + signature rebind

After this checkpoint shipped (commit `d230451`), the live rerun of T041 in
production Opera on the installed 1.6.3 candidate was captured in
`opera_commands` (Supabase, times UTC):

- 07:47:38.481 `page.find {"text":"Skip"}` (no limit — the repaired R8
  projection path) returned the correct dominant item: the real Skip button,
  `actionable:true`, `inViewport:true`, `stableKeySource:"id"`. The R8 find
  repair itself worked.
- 07:47:45.244 `page.click ref=oa_f514a741_wx` failed with
  `EXECUTION_ERROR "Element not found or reference is stale."` 6.8 s later.

Root cause: the Skip control's stable key is its DOM id. YouTube recreates the
ad Skip control during the ad lifecycle, and the successor frequently carries
**no id**. `revalidationCandidates` only searched the keyed pool
(`#id`/href/semantic), so the pool emptied and the ref failed closed — the same
failure mode as the original 1.6.2 gate.

Repair (I4): a bounded **signature rebind fallback** now runs when a keyed
successor disappears: it scans the first 500 interactive elements for a unique
replacement matching the intrinsic signature (normalized visible text/label,
tag, and every explicit descriptor field), still actionable and non-sensitive.
Uniqueness is still enforced by the caller; the mint-time geometry guard is
still the last line of defense, so a moved successor still refuses.

Evidence: tests-first (node source-contract red → green), controlled-browser
regression **PASS exit 0** on Edge headless (new U-I I4 scenario: find "Skip"
→ same-place successor without id → old ref click succeeds and the result
marker appears; plus all prior gates). Node suite 454/455 (single pre-existing
local governance artifact); `npm run check` PASS; content.js blob hash
`0340d471…` → `2ee26615…` rebaselined in the P2/P3/P4/P5 locks.

Environment note: the browser regression is non-deterministic on a used
workstation when headed (R5 foreground pointer gate requires real OS window
focus; `window.focused` flips while the user works). Headless
(`OA_BROWSER_HEADLESS=1`) is deterministic and now the recorded local gate.

## Disposition

Remaining proposed checkpoints: U-P1 (CDP accessibility-tree observation),
U-P3 (stale pruning), U-P2 (vision sampling). R8 live acceptance and any
signed-release promotion (a new version would be required for U-I to reach
real Opera) remain separate explicit user decisions; Milestone 8E stays paused.
