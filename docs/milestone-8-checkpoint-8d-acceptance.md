# Checkpoint 8D — acceptance record candidate

Date: 2026-09-16

Status: **LIVE ACCEPTANCE EVIDENCE COMPLETE; FINAL CI + INDEPENDENT OVERALL AUDIT PENDING.**
Checkpoint 8D is not yet marked accepted and Checkpoint 8E remains prohibited until the final independent 8D audit returns PASS on the exact documentation head.

## Frozen boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Live-probe exact runtime head: `cf645799968458d55d5c2b391a5d354c369337b6`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension/signing/pairing/public MCP schema/runtime: unchanged
- Browser dispatch during 8D acceptance: forbidden and observed `false`
- Supabase project: `opera-agent` / `nenmkmtvjremqphfqnfw`
- Edge function: `opera-agent-transactions-8d`, reviewed bundle SHA-256 `96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`

## Prior accepted live evidence

### PKCE / authenticated host path

Manual PKCE acceptance passed at runtime head
`80e44483f2cdba400681dc6279522d0d55d24c98`. OAuth application consent remained connection authorization only; it was not treated as transaction approval. Browser dispatch remained false and the static Edge master was restored to false after the bounded probe.

### Worker-loss / reclaim

Hosted durable worker-loss acceptance passed at
`8e3c6cd6aef41d8d1fb5a46189b193e34212c377` using a real local child process bound to the hosted Supabase database. Evidence included child death, lease-expiry reclaim, stale-epoch rejection, one-shot nonce durability, exact redelivery, one logical commit slot, cancellation/recovery safety, browser dispatch false, clean cleanup, and no secret output. This is worker-process death evidence, not a claim of provider-internal Deno/V8 isolate death.

### Quantitative / boundary evidence

`docs/milestone-8-checkpoint-8d-cloud-bounds.md` records the bounded cloud quantitative continuation, including exact pending-queue, prepare-rate, commit-rate, concurrent-target, target-digest, payload-size, and cleanup-batch boundary assertions. Native/PostgreSQL and hosted acceptance tests remain the authority for crash/recovery and hosted concurrency semantics.

## Credential and rerun authorization chain

The first reviewed live Edge-concurrency launcher attempt was consumed by production preflight and stopped before OAuth/fixture/concurrency execution. Cleanup was verified and the static master was restored to false.

A replacement Supabase project-scoped PAT was independently reviewed in Jules session `14300981553462683613` and approved with exactly:

- Database: READ-WRITE
- API Keys: READ
- Edge Functions: READ
- Edge Function Secrets: READ-WRITE

The token value remained local and was stored via Windows DPAPI. No token value is committed or recorded here.

Fresh read-only rerun authorization in Jules session `3236533720131047548` verified exact head `cf645799968458d55d5c2b391a5d354c369337b6`, a clean tree, and `324/324` tests PASS with zero failures/skips. Final verdict: **PASS**, authorizing exactly one normal live `RUN_8D_EDGE_CONCURRENCY.cmd` execution on that exact head.

## Real hosted Edge concurrency acceptance — PASS

The authorized live run completed successfully on exact runtime head
`cf645799968458d55d5c2b391a5d354c369337b6`.

Namespace:
`c6b88ac8-6b46-4b0f-932a-229422fa1272`

Observed prepare race:

- concurrency: 8
- non-replay winners: 1
- exact replays: 7
- status: `PREPARED`
- trace header: `x-deno-execution-id`
- trace samples: 8
- distinct routing traces: 8
- region header: `x-sb-edge-region`
- distinct regions: 3
- `browserDispatchAllowed=false`
- `secretsPrinted=false`

Observed cancel race:

- concurrency: 8
- non-replay winners: 1
- exact replays: 7
- status: `CANCELLED`
- trace header: `x-deno-execution-id`
- trace samples: 8
- distinct routing traces: 8
- region header: `x-sb-edge-region`
- distinct regions: 3
- `browserDispatchAllowed=false`
- `secretsPrinted=false`

The final receipt reported:

- `prepareWinners=1`
- `cancelWinners=1`
- `prepareDistinctRoutingTraces=8`
- `cancelDistinctRoutingTraces=8`
- `browserDispatchAllowed=false`
- `clean=true`
- `secretsPrinted=false`

Terminal launcher result:

`8D EDGE CONCURRENCY ACCEPTANCE: PASS`

The launcher then reported:

`Static Edge master restored to false.`

Routing traces are evidence of distinct hosted request executions. They are deliberately not interpreted as proof of distinct provider-internal V8 isolates or worker processes.

## Independent post-probe production cleanup verification

A separate read-only production query after the live PASS returned:

- policy mode: `OFF`
- `legacy_gated=false`
- `agent_commit_enabled=false`
- DB host gate: `false`
- operator epoch: `3`
- operator owner: `null`
- operator namespace: `null`
- lease: `null`
- `hostEnabled=false`
- `principals=0`
- `rates=0`
- `acceptance_bindings=0`
- `runs=0`
- `run_identities=0`
- `run_limits=0`
- `run_previews=0`
- `run_challenges=0`
- `journal=0`
- `approvals=0`
- `commit_slots=0`
- `opera_agent_private.goal_heads=0`

The database verification does not reveal the static Edge secret value; the master-false evidence is the launcher's bounded Management API restore result. No secret value was printed or persisted in this record.

## Advisor reconciliation

Fresh Supabase security and performance advisors were read after the live probe.

Checkpoint-8D-owned findings are **INFO only**:

- RLS enabled with no client policies on the private/service-only 8D tables, including `opera_agent_private.goal_heads` and `opera_agent_tx_candidate.*` — intentional isolation evidence for this checkpoint;
- unindexed foreign key on `opera_agent_tx_candidate.runs` — INFO;
- unused 8D indexes such as `tx_candidate_retention` / `goal_heads_cleanup_idx` — INFO.

No checkpoint-8D object appears in an advisor `ERROR` or `WARN` finding. Current WARN findings are on pre-existing/public legacy surfaces (`loa_v3_*`, relay functions, `pg_net`, anonymous-access/Auth configuration) rather than the 8D private transaction candidate. Therefore the canonical gate “no checkpoint-introduced unresolved relevant ERROR/WARN” is satisfied for the current 8D objects.

Supabase remediation references for the observed advisory classes:

- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## Canonical 8D acceptance mapping

The evidence chain now covers the frozen `docs/milestone-8-plan.md` 8D acceptance classes:

- direct private-role denial and tenant isolation: accepted 8D SQL/host candidate and negative suites;
- cross-tenant claims/reads/cancel/approval/commit-slot rejection: accepted negative suites;
- exact redelivery advances once / idempotency collision fails closed: native + hosted durable acceptance;
- worker death before browser dispatch reclaimable: worker-loss PASS;
- approval nonce one-shot across death/redelivery: worker-loss PASS;
- cancel/expiry survive worker loss: native/hosted durable evidence;
- rate/queue/concurrency/payload/retention bounds: quantitative suites plus hosted concurrency PASS;
- crypto wrong-kind/wrong-tenant/tamper rejection: accepted token/crypto negative suites;
- invalid policy combinations fail closed: accepted policy/host tests;
- advisor gate: no 8D-introduced relevant ERROR/WARN;
- post-probe OFF/dark + zero synthetic rows: independently verified above.

This record does not broaden any authority and does not promote `DARK`/`ENFORCED` agent-facing transaction execution.

## Remaining closeout gate

1. Treat the final documentation commit containing this record plus synchronized context/handoff as the new exact audit head.
2. Require CI/status checks on that exact head to be green. Pending/in-progress => STOP. A real test failure => diagnose only that failure.
3. Obtain a fresh independent **overall Checkpoint 8D** read-only audit on the exact documentation head. It must reconcile the canonical plan against the full evidence chain, verify no source/runtime authority drift, verify post-probe cleanup/advisors, and return exactly PASS / CONDITIONAL PASS / FAIL.
4. Only a final **PASS** may mark Checkpoint 8D accepted and permit starting 8E.

Until then: **8D IN PROGRESS; 8E NOT STARTED.**
