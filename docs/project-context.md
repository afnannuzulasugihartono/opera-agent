# Opera Agent project context

Last synchronized: 2026-09-17

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, accepted checkpoint records, and the currently selected execution
plan.

## Current boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Signed rollback: `1.5.2`
- Milestone 8: 8A-8D **ACCEPTED**; 8E paused/not started
- Durable 8D closeout head: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Active user-selected work: **Performance Track P — Delta-First Runtime**
- P0: **ACCEPTED** at `699578904e2f19ea713a0933632331cad7299c11`
  with CircleCI #76 and Vercel SUCCESS
- P1: **ACCEPTED** at `cbf3259a337d92410a5ba805dd0fd987a51c1bc5`
  with CircleCI #85 and Vercel SUCCESS
- P2: **FINAL CANDIDATE**; implementation head
  `5f0477441ab0b05335a87c6a7e69a5415dc8b5ce` passed CircleCI #87 and Vercel;
  exact documentation-closeout head still requires green CircleCI + Vercel/status
- P3 has not started

## Performance Track P

Canonical plan: `docs/delta-first-performance-plan.md`.
Acceptance records:

- `docs/delta-first-performance-p0.md`
- `docs/delta-first-performance-p1.md`
- `docs/delta-first-performance-p2.md`

Frozen target architecture:

```text
full snapshot bootstrap
  -> bounded semantic working state
  -> browser signals/change epochs
  -> semantic delta
  -> causal invalidation
  -> relevance gate
  -> local continuation or compact reasoning patch
```

Full snapshot remains the fail-closed recovery primitive whenever continuity is not
provable. Performance Track P does not grant new transaction authority and does not
change the frozen Milestone 8 contracts.

## P1 accepted foundation

P1 introduced the pure bounded process-memory working-state layer:

- `lib/semantic-working-state-p1.js`
- `tests/semantic-working-state-p1.test.mjs`
- `tests/semantic-working-state-p1-adversarial.test.mjs`

Trusted state identity is tenant + device + tab + document generation + runtime
epoch. The state retains bounded semantic metadata, materialized views, dependency
fingerprints, current semantic revision, last source/result revision, and a digest
used to distinguish exact replay from incompatible replay.

P1 requires trusted RESET/full bootstrap and exact contiguous revision continuity.
Exact replay is idempotent. Incompatible duplicate, old input, revision gap,
cross-scope identity, restart, ambiguity, overflow, expiry, eviction, semantic
mismatch, and materialized-view mismatch fail closed.

P1 stores semantic metadata only. Raw page text, raw labels, href/private query
material, form values, and sensitive entities are excluded from the public working
state. No file/database/network persistence was added.

P1 did not suppress the rich reasoning observation; P2 owns that boundary.

## P2 implementation state

P2 adds only a bounded consumer-side reasoning observation adapter:

- `lib/delta-first-observation-p2.js`
- `tests/delta-first-observation-p2.test.mjs`

Behavior:

- trusted RESET/bootstrap => `FULL_SNAPSHOT` plus reconstructed P1 canonical state;
- valid contiguous semantic observation => bounded `COMPACT_PATCH` with source/result
  revision, classification, inserted/updated/moved/removed semantic entities,
  changed/invalidated/removed views, continuity/replay metadata, bounded provenance,
  verification metadata, and byte accounting;
- exact replay is compact/idempotent and does not resend changed facts;
- compact patches exclude raw text, raw labels, href/private-query material, raw
  values, sensitive entities, raw provenance notes, raw invalidation notes, and raw
  completion scope;
- `logicalId` remains observational and is not a direct browser-action handle;
- missing continuity, incompatible duplicate, gap/out-of-order, cross scope,
  ambiguity, overflow, expiry/eviction, semantic/view mismatch, and patch overflow
  fail closed to `FULL_SNAPSHOT` + reset-required and discard stale state;
- compact delivery can resume only after trusted RESET/rebootstrap;
- explicit verification may request a fresh full observation without discarding an
  otherwise valid canonical chain.

P2 does **not** add P3 signal coalescing/relevance gating, P4 local VM continuation,
new browser primitives, extension changes, public MCP changes, production changes,
or transaction authority.

## P2 tests-first / automated evidence

Tests-first chain:

- `0f1b856b27776a813cbe818a0677344e991c9c3c` — frozen P2 contract tests before implementation; CircleCI #86 expected red boundary
- `5f0477441ab0b05335a87c6a7e69a5415dc8b5ce` — implementation; CircleCI #87 SUCCESS + Vercel SUCCESS

The P2 suite covers bootstrap; UPDATE/INSERT/MOVE/REMOVE/MIXED;
NO_RELEVANT_CHANGE; exact replay; incompatible duplicate; revision gap and
out-of-order; cross-tab/document/runtime epoch; ambiguity; overflow; expiry/eviction;
RESET; semantic/view mismatch; sensitive-data exclusion; patch overflow; canonical
state reconstruction; fail-closed recovery; explicit verification; no synthesized
completion/foreground authority; byte locks on extension/public-MCP sources; and a
paired deterministic small-change benchmark.

CircleCI includes the full Node suite, `npm run check`, and controlled Chromium
extension regression. P2 does not modify extension/browser code; Chromium is
compatibility evidence.

Controlled P2 benchmark:

- median paired rich reasoning payload: **22,244 bytes**;
- median compact patch: **1,380 bytes**;
- median reduction: **93.80%** versus the frozen P2 minimum of >=75%;
- fallback count: 0;
- reset count on valid-continuity pairs: 0;
- stale-state continuation: 0;
- false completion: 0;
- foreground takeover: 0;
- relevant semantic information loss: 0.

These are controlled P2 claims. Real Opera, steady-state full-snapshot reduction,
reasoning/tool round-trip reduction, long-task speedup, and simple-operation
regression remain P5 gates.

## Frozen P5 targets

P0 froze these future acceptance targets; P2 does not claim them all achieved:

- false completion = 0;
- foreground takeover = 0;
- stale-state action = 0;
- relevant-signal loss = 0;
- small-change reasoning payload reduction >= 75% median;
- repetitive reasoning/tool round-trip reduction >= 60% median;
- steady-state full-snapshot reduction >= 80%;
- long repetitive task median speedup >= 2.0x;
- simple-operation median regression <= 15%.

Inherited accepted 1.6.0 reference evidence remains rich-read median 19.83 ms,
p95 20.65 ms, 50,953-byte enriched snapshot median, and 6,087-byte single-update
delta (12% delta/snapshot ratio). Those historical measurements remain reference
context, not fresh P2 real-browser measurements.

## Closed 8D state

Checkpoint 8D is fully closed. The successful hosted Edge concurrency probe ran
exactly once on runtime head `cf645799968458d55d5c2b391a5d354c369337b6`.
Final independent overall audit Jules session `17943137394205042765` returned PASS.
Durable 8D roadmap closeout finished at
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab` with CircleCI #69 and Vercel SUCCESS;
audit PR #43 was closed without merge.

Post-probe production remained policy OFF, legacy_gated false,
agent_commit_enabled false, DB host gate false, operator owner/namespace/lease null,
host false, and synthetic 8D tables/goal-head rows zero. Do not rerun
`RUN_8D_EDGE_CONCURRENCY.cmd`; its reviewed one-run authorization was consumed.

## Exact next gate

1. Treat the branch head containing P2 tests, implementation, acceptance record,
   synchronized performance plan, roadmap, project context, and handoff as the exact
   P2 final candidate.
2. Require CircleCI and Vercel/status on that exact head to be SUCCESS.
3. Pending/queued/in-progress => **STOP**.
4. Failure => diagnose only that P2 failure.
5. If both checks are green, P2 is accepted without another status-only commit.
6. Stop after P2. Start **P3 — multi-signal coalescer and relevance gate** only after
   explicit user continuation.
7. Do not start 8E while Performance Track P remains the selected active track.

## Invariants and user-local state

- one active writer;
- tests before behavior;
- background-first browser operation;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print Management/OAuth/signing/pairing/crypto credentials;
- action success is not completion proof;
- performance gains never justify stale-state action, false completion, missed
  relevant changes, or foreground takeover.

Two accidental untracked 8E files remain preserved in a Git stash named roughly
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash automatically. Performance Track P does not use it.
If 8E later resumes, inspect it against the canonical 8E scope first.
