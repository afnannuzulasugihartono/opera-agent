# Pre-8E Performance Usability Repair — R2 Evidence

Status: **R2 ACCEPTED / CLOSED — R3 NOT AUTHORIZED**

Date: 2026-09-19

Branch: `feat/pre-8e-usability-repair-r2`

R1 accepted closeout base:
`f468230986101f09880ce1e38cf69b705570c507`

R2 implementation evidence head:
`70c79db6d76ab624d19bd5d6067a1469ef522045`

## Scope

R2 implements only T012–T016 fresh-target revalidation.

R3 post-action verification is not implemented. Protocol 1, the 26 allowlisted
browser primitives, the 18 public MCP tool names/input schemas, background-first
behavior, canonical semantic state/delta authority, VM enablement, transaction
authority, production schema/deployment, Milestone 8E, and the preserved accidental
8E stash remain outside this checkpoint.

## T012 — tests-first red evidence

Tests-only head:
`5a5072a5c3515edb111b1e0e8c45bfa254361351`

Controlled fixture `tests/fixtures/pre-8e-usability-r2.html` covers:

- one unique same-document equivalent replacement;
- two ambiguous equivalent replacements;
- same-tab SPA route reset followed by a same-id replacement;
- a target whose label changes into security-code/sensitive evidence;
- a target that disappears.

The ambiguous stale-click attempt intentionally includes caller-provided
`logicalId`, `x`, and `y` values so the acceptance test proves those
observational fields cannot mint action authority.

CircleCI #223 failed exactly as tests-first required:

- `uniqueRecovered: False`;
- `ambiguousRejected: True`;
- `routeRejected: True`;
- `sensitiveRejected: True`;
- `disappearingRejected: True`.

This proved the pre-R2 runtime was already fail-closed for unsafe stale states and
lacked only bounded unique recovery.

## T013/T014 — bounded fresh-target revalidation

Runtime head:
`3ea81c1604b3f60fad917ba6ee8b478af8556aae`

`extension/content.js` now stores a bounded action descriptor when a browser ref is
first minted. A stale ref is eligible for local recovery only when:

1. it belongs to the current document id;
2. the current origin/path/query route key still equals the descriptor route key;
3. the current candidate preserves stable key/source and bounded id/tag/role/name/
   type/label/href metadata;
4. the candidate has not become sensitive;
5. the candidate is currently actionable;
6. exactly one candidate satisfies all checks.

Zero candidates or more than one candidate fail closed. No coordinate guessing is
performed. The action resolver does not read caller-supplied `logicalId`, `x`,
or `y` as stale-ref recovery authority.

Both synthetic click and trusted click-info use the same bounded resolver, so trusted
CDP click cannot bypass revalidation.

## Historical hash-lock rebaseline

R2 intentionally changed `extension/content.js`. Its authorized SHA-1 became:

`132f7967c8432339f6244402d093fd1d6af0f1c9`

The four P2/P3/P4/P5 frozen-byte tests still expected the accepted R1 content hash:

`a34da8a70f8e48a858c281e403d16a244e78f72c`

CircleCI #224 therefore produced 419/423 passing tests and exactly four content-file
hash mismatches. After confirming the R1→R2 net runtime change was entirely within
authorized R2 scope, only those four `extension/content.js` locks were rebaselined
at `34e7181d0584900851b58f9cf5069b7dad905a8b`. Background, manifest, MCP,
and prior runtime locks were not changed.

## Controlled-browser regression alignment

After hash rebaseline, CircleCI #225 passed unit/static tests and reached Chromium.
It then failed an older pre-R2 assertion requiring a benign same-document stale ref
to be rejected.

That assertion was superseded by the R2 contract, not by weaker safety policy.
`tests/browser_extension_test.py` was aligned at
`70c79db6d76ab624d19bd5d6067a1469ef522045` so:

- benign unique same-document replacement is recovered;
- the recovered old ref is rebound to the fresh replacement;
- the R2 fixture proves a real unique replacement click effect
  (`unique-clicked:1`);
- ambiguous, route-reset, sensitive and disappearing stale targets remain rejected.

## T015 — stale-state safety and compatibility verification

Exact implementation evidence head:
`70c79db6d76ab624d19bd5d6067a1469ef522045`

- CircleCI **#226 SUCCESS**;
- Vercel **SUCCESS**.

The required pipeline completed the full Node/static gate, Playwright/Chromium setup,
and controlled extension regression.

The R1 accepted base
`f468230986101f09880ce1e38cf69b705570c507` to R2 implementation head diff
changes runtime only in `extension/content.js`; it does not modify
`extension/lib/protocol.js`, `extension/background.js`,
`extension/manifest.json`, or
`supabase/functions/opera-agent-mcp/index.ts`.

Current exact-head inventory was independently read from source:

- Protocol version: **1**;
- allowlisted browser primitives: **26**;
- public MCP tools: **18**;
- public MCP input schemas: unchanged because the MCP source file is byte-identical
  to the accepted R1 base.

Unsafe stale-state action count remains zero in controlled R2 scenarios:
ambiguity, route reset, sensitivity change and disappearance all reject before the
stale target can act. Only the unique equivalent same-document replacement is
permitted to rebind.

## T016 — closeout

Spec/plan/tasks, roadmap, project context, handoff, and constitution converge on the
same boundary:

- R0–R2 ACCEPTED / CLOSED;
- R3 NOT AUTHORIZED / NOT STARTED;
- Milestone 8E paused/not started;
- no implicit checkpoint advancement.

STOP after R2. Do not start R3 or Milestone 8E without a new explicit user
instruction.
