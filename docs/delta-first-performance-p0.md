# Performance Track P — Checkpoint P0 acceptance record

Date: 2026-09-17

Status: **FINAL CANDIDATE — exact-head CI/status checks required. P1 has not started.**

## Boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Accepted pre-P0 baseline head: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Milestone 8: 8A-8D accepted; 8E paused/not started
- P0 runtime/extension/MCP/production/transaction mutation: **none authorized**

## P0 artifacts

P0 freezes the performance track in:

- `docs/delta-first-performance-plan.md`
- `tests/fixtures/delta-performance-baseline-p0-v1.json`
- `tests/delta-performance-p0.test.mjs`
- `docs/delta-first-performance-p0.md`
- synchronized `docs/roadmap.md`, `docs/project-context.md`, and
  `docs/next-session-handoff.md`

## Frozen evidence and claims

P0 records inherited accepted 1.6.0 browser evidence from `docs/benchmarks.md`:

- rich read median: 19.83 ms;
- rich read p95: 20.65 ms;
- enriched snapshot median: 50,953 bytes;
- single-update delta: 6,087 bytes;
- single-update delta/snapshot ratio: 12%;
- zero accepted focus changes and zero persisted sensitive values in that baseline.

These are inherited measurements, not fresh live measurements from the P0 exact
head. P0 deliberately performs no real-site browser acceptance and makes no claim
that the P5 speed targets have already been achieved.

## Frozen P5 targets

The machine-readable P0 contract freezes these future paired acceptance targets:

- false completion = 0;
- foreground takeover = 0;
- stale-state action = 0;
- relevant-signal loss = 0;
- small-change reasoning payload reduction >= 75% median;
- repetitive reasoning/tool round-trip reduction >= 60% median;
- steady-state full-snapshot reduction >= 80%;
- long repetitive task speedup >= 2.0x median;
- simple-operation median regression <= 15%.

Correctness outranks latency. A faster result with worse correctness does not pass.

## P0 acceptance rule

The final P0 candidate is the branch head containing this acceptance record plus the
required roadmap/context/handoff synchronization. P0 becomes accepted when, on
that exact head:

1. the new P0 contract tests pass;
2. the full Node suite passes;
3. `npm run check` passes through the normal CI path;
4. CircleCI reports SUCCESS;
5. Vercel/status reports SUCCESS;
6. no runtime, extension, MCP, database, Edge, OAuth, production, signing, pairing,
   or transaction-authority behavior changed.

No second status-only commit is required after those exact-head checks turn green.
A later session must verify the exact branch head and check statuses before starting
P1.

## Exact next gate

- If required CI/status checks are pending: **STOP**.
- If a required check fails: diagnose only that P0 failure.
- If all required checks are SUCCESS: P0 is accepted and the next user-directed
  checkpoint is **P1 — persistent semantic working state**.
- Do not begin P1 in the same turn without explicit user continuation.
- Do not start 8E while Performance Track P remains the user-selected active track.
