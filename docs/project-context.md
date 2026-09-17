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
- P1: **FINAL CANDIDATE**; exact documentation-closeout head still requires green
  CircleCI + Vercel/status
- P2 has not started

## Performance Track P

Canonical plan: `docs/delta-first-performance-plan.md`.
Acceptance records:

- `docs/delta-first-performance-p0.md`
- `docs/delta-first-performance-p1.md`

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

## P1 implementation state

P1 introduces only a pure bounded process-memory working-state layer:

- `lib/semantic-working-state-p1.js`
- `tests/semantic-working-state-p1.test.mjs`
- `tests/semantic-working-state-p1-adversarial.test.mjs`

Trusted state identity is tenant + device + tab + document generation + runtime
epoch. The state retains bounded semantic metadata, materialized views, dependency
fingerprints, current semantic revision, last source/result revision, and a digest
used to distinguish exact replay from incompatible replay.

P1 continuity rules:

- trusted `RESET`/full observation required for bootstrap;
- exact contiguous revision advancement required;
- exact duplicate replay is idempotent;
- incompatible duplicate, old input, revision gap, cross-tenant/device/tab/document,
  runtime-epoch mismatch, ambiguity, overflow, expiry, and capacity eviction fail
  closed;
- reset/full-snapshot-required observations require fresh bootstrap;
- current rich observation is still present and acts as a correctness oracle;
- semantic/view material that differs from the asserted delta is rejected before
  accepted state mutation.

P1 stores semantic metadata only. Raw page text, raw labels, href/private query
material, form values, and sensitive entities are excluded from the public working
state. No file/database/network persistence was added.

P1 explicitly does **not** suppress the rich observation delivered to reasoning.
That is P2 scope.

## P1 tests-first / automated evidence

- `644b4b9e48c12dc5f65b08e3176c4cca77c8be62` — initial contract tests
- `f6c95ab7f0b37e28d038a832d411ee4f4da19cc5` — implementation
- `8f450d6c911628e234b19bcd641c37c5b60cc7eb` — duplicate/out-of-order test correction
- `27e683af29de562d91ca2303d5eb8e74606e2700` — adversarial reconstruction tests

Automated gates already green before documentation closeout:

- `8f450d...`: CircleCI #79 SUCCESS + Vercel SUCCESS
- `27e683...`: CircleCI #80 SUCCESS + Vercel SUCCESS

CircleCI includes the full Node suite, `npm run check`, and controlled Chromium
extension regression. The Chromium pass is compatibility evidence only; P1 did not
change or wire the extension.

## Frozen P5 targets

P0 froze these future acceptance targets; P1 does not claim them achieved:

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
delta (12% delta/snapshot ratio). These historical measurements are not fresh P1
performance claims.

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

1. Treat the branch head containing the complete P1 implementation, tests,
   acceptance record, plan, roadmap, project context, and handoff as the exact P1
   final candidate.
2. Require CircleCI and Vercel/status on that exact head to be SUCCESS.
3. Pending/queued/in-progress => **STOP**.
4. Failure => diagnose only that P1 failure.
5. If both checks are green, P1 is accepted without another status-only commit.
6. Stop after P1. Start **P2 — delta-first observation pipeline** only after explicit
   user continuation.
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
