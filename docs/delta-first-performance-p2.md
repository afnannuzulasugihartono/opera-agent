# Performance Track P — Checkpoint P2 acceptance record

Date: 2026-09-17

Status: **FINAL CANDIDATE — exact-head CI/status checks required. P3 has not started.**

## Boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Accepted P0 head: `699578904e2f19ea713a0933632331cad7299c11`
- Accepted P1 head: `cbf3259a337d92410a5ba805dd0fd987a51c1bc5` with CircleCI #85 and Vercel SUCCESS
- P2 implementation head: `5f0477441ab0b05335a87c6a7e69a5415dc8b5ce` with CircleCI #87 and Vercel SUCCESS
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Signed rollback: `1.5.2`
- Milestone 8: 8A–8D accepted; 8E paused/not started
- P3/P4/P5: not started
- Extension/CRX/signing/pairing/public-MCP/production/transaction-authority changes in P2: **none**

## Objective and implementation

P2 makes the bounded P1 working state usable as a delta-first reasoning observation
pipeline while preserving full rich snapshots as the fail-closed recovery primitive.
The implementation is additive and server/consumer-side only:

- `lib/delta-first-observation-p2.js`
- `tests/delta-first-observation-p2.test.mjs`

No extension bytes, browser dispatch, public MCP schema, Supabase production state,
signing identity, pairing, transaction authority, or Milestone 8 contract changed.

## Reasoning observation contract

For a trusted `RESET`/bootstrap observation, reasoning receives `FULL_SNAPSHOT` and
the P1 store reconstructs canonical semantic state.

For a valid contiguous observation, reasoning receives a bounded `COMPACT_PATCH`
containing only the semantic material required by the delta:

- source and resulting semantic revision;
- classification;
- inserted, updated, moved, and removed logical entities;
- changed, invalidated, and removed semantic views;
- continuity/replay metadata;
- bounded provenance/sensor confidence;
- explicit `fullSnapshotIncluded: false`;
- bounded payload accounting.

The canonical reconstructed working state remains available internally and is not
replaced by the compact patch. Semantic `logicalId` remains observational only; the
patch does not introduce `ref` or another direct browser-action handle.

Raw page text, raw labels, href/private-query material, raw values, sensitive
entities, raw provenance notes, raw invalidation notes, and raw completion scope are
excluded from compact patches.

## Recovery and fail-closed behavior

P2 falls back to `FULL_SNAPSHOT` and requires reset/rebootstrap when continuity is
not safe, including:

- missing continuity;
- incompatible duplicate;
- revision gap or out-of-order input;
- tab/document/runtime-epoch mismatch;
- ambiguous identity;
- P1 state overflow, expiry, or eviction;
- semantic delta mismatch or materialized-view mismatch;
- compact-patch overflow;
- trusted RESET/document-generation transition.

After a continuity failure, stale state is discarded and compact delivery cannot
silently resume until a trusted RESET/full observation rebuilds state.

An explicit verification request may keep valid canonical continuity while sending
a fresh `FULL_SNAPSHOT`; this is not treated as task completion proof.

## Tests-first chain

- `0f1b856b27776a813cbe818a0677344e991c9c3c` — frozen P2 contract tests before the module existed; CircleCI #86 failed at the expected tests-first red boundary;
- `5f0477441ab0b05335a87c6a7e69a5415dc8b5ce` — minimum delta-first pipeline implementation; CircleCI #87 SUCCESS and Vercel SUCCESS.

The normal CircleCI job covers the full `npm test`, `npm run check`, and controlled
Chromium extension regression. The Chromium pass is compatibility evidence only;
P2 does not wire or modify the extension.

The P2 suite covers bootstrap, UPDATE/INSERT/MOVE/REMOVE/MIXED,
NO_RELEVANT_CHANGE, exact replay, incompatible duplicate, gaps/out-of-order,
cross-scope identity, ambiguity, overflow, expiry/eviction, RESET, semantic/view
mismatch, sensitive-data exclusion, patch overflow, canonical reconstruction,
fail-closed recovery, explicit verification, completion/foreground authority, byte
locks for extension/public-MCP sources, and the paired small-change benchmark.

## Controlled paired benchmark

The frozen nine-update controlled workload compares each rich observation with the
compact P2 reasoning payload from the same semantic change sequence.

Deterministic accounting for that workload:

- median rich reasoning payload: **22,244 bytes**;
- median compact patch: **1,380 bytes**;
- median reduction: **93.80%**;
- frozen P2 minimum: **>= 75%**;
- fallback count: **0**;
- reset count during valid-continuity pairs: **0**;
- stale-state continuation: **0**;
- false completion: **0**;
- foreground takeover: **0**;
- relevant semantic information loss: **0**.

The benchmark is a controlled P2 acceptance shape, not a claim that the full P5
real-Opera performance targets are already satisfied.

## Explicit non-goals

P2 does not add:

- P3 multi-signal coalescing or task relevance gating;
- MutationObserver/IntersectionObserver/resize/history routing changes;
- task-relevance statuses such as `IGNORE_FOR_TASK`, `APPLY_AND_CONTINUE`, or `REASON_REQUIRED`;
- P4 local Reactive VM continuation loops;
- a new browser primitive;
- extension/CRX distribution changes;
- a public MCP tool/input field;
- Supabase production changes;
- consequential transaction execution;
- Checkpoint 8E implementation.

## P2 acceptance rule

The final P2 candidate is the exact branch head containing:

- P2 tests;
- P2 implementation;
- this acceptance record;
- synchronized performance plan;
- synchronized roadmap;
- synchronized project context;
- synchronized next-session handoff.

P2 becomes accepted only when, on that exact head:

1. full Node tests pass;
2. `npm run check` passes;
3. controlled Chromium regression passes through normal CircleCI;
4. CircleCI reports SUCCESS;
5. Vercel/status reports SUCCESS;
6. the P1-to-P2 diff contains no extension/public-MCP/production/transaction-authority change.

No second status-only commit is required after those exact-head checks are green.

## Exact next gate

- Pending/queued/in-progress required CI => **STOP**.
- Required check failure => diagnose only that P2 failure.
- All required exact-head checks SUCCESS => P2 accepted.
- Stop after P2 acceptance and wait for explicit user continuation.
- Next Performance Track checkpoint: **P3 — multi-signal coalescer and relevance gate**.
- Checkpoint 8E remains paused while Performance Track P is active.
