# Performance Track P — Checkpoint P1 acceptance record

Date: 2026-09-17

Status: **FINAL CANDIDATE — exact-head CI/status checks required. P2 has not started.**

## Boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Accepted P0 head: `699578904e2f19ea713a0933632331cad7299c11`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Milestone 8: 8A-8D accepted; 8E paused/not started
- Browser/extension/CRX/signing/pairing/public-MCP/production/transaction-authority changes in P1: **none**

## Implementation

P1 introduces the pure bounded in-memory working-state layer:

- `lib/semantic-working-state-p1.js`
- `tests/semantic-working-state-p1.test.mjs`
- `tests/semantic-working-state-p1-adversarial.test.mjs`

The layer is not wired to suppress or replace the existing rich `page.read` path in
P1. The current full observation remains available and is used as a correctness
oracle while the incremental state is reconstructed. Delta-first reasoning delivery
belongs to P2.

## State identity and contents

A state handle is bound to trusted runtime identity:

- tenant;
- device;
- tab;
- document generation;
- runtime epoch.

The bounded working state retains only semantic metadata needed for continuity:

- current semantic revision;
- sanitized semantic entities;
- materialized views;
- entity-set and scroll dependency fingerprints;
- last accepted source/result revision;
- exact last-observation digest for replay detection.

Raw page text, labels, hrefs/private query material, input values, and sensitive
entities are not retained in the public working-state representation. The store is
process-memory only; P1 adds no file/database/network persistence.

## Continuity behavior

P1 requires a trusted `RESET`/full observation to bootstrap. Thereafter:

- exact `sourceRevision -> resultingRevision` continuity is mandatory;
- resulting revision must advance exactly one observation at a time;
- exact duplicate replay is idempotent;
- same revision with different semantic material is `INCOMPATIBLE_DUPLICATE`;
- older observations are `OUT_OF_ORDER`;
- forward gaps are `REVISION_GAP`;
- cross-tenant/device/tab/document and runtime-epoch mismatch fail closed;
- ambiguous identity fails closed;
- reset/full-snapshot-required observations cannot be merged into an existing
  continuity chain and require fresh bootstrap;
- entity/view/byte/age/state-count caps are explicit;
- expiry or capacity eviction makes the state unavailable and requires reset/full
  bootstrap rather than pretending continuity.

For P1 only, the still-present rich observation is checked against the incrementally
reconstructed state. A semantic entity or materialized view that changes without a
matching delta is rejected as `DELTA_MISMATCH` / `VIEW_DELTA_MISMATCH` before the
accepted state is mutated.

## Tests-first chain

- `644b4b9e48c12dc5f65b08e3176c4cca77c8be62` — initial P1 failing contract tests;
- `f6c95ab7f0b37e28d038a832d411ee4f4da19cc5` — bounded semantic working-state implementation;
- `8f450d6c911628e234b19bcd641c37c5b60cc7eb` — distinguish true out-of-order input from incompatible duplicate replay;
- `27e683af29de562d91ca2303d5eb8e74606e2700` — adversarial INSERT/MOVE/REMOVE, false-delta/view, and byte-cap coverage.

Automated evidence before documentation closeout:

- exact implementation head `8f450d6c911628e234b19bcd641c37c5b60cc7eb`: CircleCI #79 SUCCESS, Vercel SUCCESS;
- hardened implementation/test head `27e683af29de562d91ca2303d5eb8e74606e2700`: CircleCI #80 SUCCESS, Vercel SUCCESS.

The normal CircleCI job runs the full `npm test`, `npm run check`, and controlled
Chromium extension regression. P1 did not modify extension files; Chromium remains a
compatibility regression gate, not evidence that P1 is browser-wired.

## Explicit non-goals

P1 does not:

- suppress full snapshots to the reasoning layer;
- add a public MCP tool or input field;
- change `page.read` or extension bytes;
- add MutationObserver/IntersectionObserver/viewport signal routing;
- add relevance gating;
- wake/suppress an LLM;
- run a local autonomous observation loop;
- add browser mutation authority or transaction execution;
- change Supabase production schema, Edge functions, OAuth, secrets, or policy;
- start Checkpoint 8E.

Those boundaries prevent P1 from silently absorbing P2-P4 scope.

## P1 acceptance rule

The final P1 candidate is the branch head containing this record plus the required
plan/roadmap/project-context/handoff synchronization. P1 becomes accepted when, on
that exact head:

1. full Node tests pass;
2. `npm run check` passes;
3. controlled Chromium regression passes through the normal CircleCI job;
4. CircleCI reports SUCCESS;
5. Vercel/status reports SUCCESS;
6. no browser/extension/public-MCP/production/transaction authority changed.

No second status-only commit is required after those exact-head checks are green.

## Exact next gate

- Pending/queued/in-progress required CI => **STOP**.
- Required check failure => diagnose only that P1 failure.
- All required checks SUCCESS => P1 accepted.
- Then stop and wait for explicit user continuation.
- The next Performance Track checkpoint is **P2 — delta-first observation
  pipeline**.
- Checkpoint 8E remains paused while Performance Track P is active.
