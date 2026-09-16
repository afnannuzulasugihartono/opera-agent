# Checkpoint 8D — live acceptance procedure

Date: 2026-09-16

Status: **LIVE PROCEDURE EXECUTED — PASS. FINAL EXACT-HEAD CI + OVERALL 8D AUDIT PENDING.**

This document began as the live-production procedure for Checkpoint 8D. The
bounded live steps have now been executed. It is retained as the operational
procedure/history; the consolidated evidence record is
`docs/milestone-8-checkpoint-8d-acceptance.md`.

Checkpoint 8D remains IN PROGRESS until the final independent overall audit
returns PASS. Checkpoint 8E has not started.

## Frozen boundary

The procedure never authorizes public MCP/runtime/schema, extension/CRX, signing,
pairing, protocol, browser-capability, or agent-facing transaction promotion.
OAuth consent is connection authorization only. Browser dispatch must remain
false throughout 8D.

Fixed production target:

- Supabase project: `opera-agent` / `nenmkmtvjremqphfqnfw`
- Edge function: `opera-agent-transactions-8d`
- reviewed bundle SHA-256:
  `96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`
- static master: `OPERA_AGENT_TRANSACTION_DARK_8D`
- service-only host gate: `opera_tx_operator_host_gate_8d()`

The static master alone is never transaction authority. Every accepted request
also requires the independently fenced service-only DB host gate.

## Canonical concurrency interpretation

The canonical `docs/milestone-8-plan.md` requires hosted concurrency/CAS evidence,
worker-death reclaim, exact redelivery/idempotency and exact quantitative bounds.
It does not require proof of provider-internal Deno worker PIDs or V8-isolate IDs.

The hosted concurrency gate therefore means:

- eight independently issued simultaneous authenticated POST requests to the
  fixed real 8D endpoint for first `prepare`;
- eight independently issued simultaneous authenticated POST requests to the
  same endpoint for first `cancel`;
- exactly one non-replay winner and seven exact replays per phase;
- convergent transaction/commit metadata;
- bounded responses;
- allowlisted request/execution routing traces without logging raw values;
- `browserDispatchAllowed=false` throughout;
- fenced cleanup/recovery and no secret output.

Routing/execution headers are operational evidence of distinct hosted request
executions. They are not proof of distinct provider-internal V8 isolates.

## Completed prerequisite evidence

### PKCE / authenticated host acceptance

Manual PKCE acceptance passed at
`80e44483f2cdba400681dc6279522d0d55d24c98`. OAuth consent remained connection
authorization only, not transaction approval. Cleanup restored the static master
to false.

### Worker-loss / reclaim

Hosted durable worker-loss acceptance passed at
`8e3c6cd6aef41d8d1fb5a46189b193e34212c377` using real child-process death bound
to the hosted database. Reclaim, stale-epoch rejection, one-shot nonce durability,
exact redelivery, one logical commit slot, cancellation/recovery safety, zero
browser dispatch and clean cleanup were verified.

### Quantitative gates

`docs/milestone-8-checkpoint-8d-cloud-bounds.md` records the accepted pending
queue, prepare/commit rate, concurrent-target, target-digest, exact payload-size
and cleanup-batch boundaries. The native/PostgreSQL/host negative suites provide
complementary retention, token/crypto, tenant and policy-fail-closed evidence.

## Static-master bracket

Normal `RUN_8D_EDGE_CONCURRENCY.cmd` behavior is fixed to one project/secret:

1. load the Management token only from current-shell or local Windows-DPAPI
   storage;
2. write the fixed master to `false` as baseline;
3. set that same master to `true` immediately around one reviewed probe;
4. run the fixed real Edge concurrency acceptance;
5. restore `false` in PowerShell `finally`, with at most three attempts;
6. fail loudly if restore cannot be confirmed;
7. clear credential environment variables.

`-RecoverNamespace` never enables the master. `-RestoreMasterOnly` only writes the
fixed master to false and performs no OAuth/fixture/probe action.

The single-element Supabase secrets body is serialized with array-preserving
`ConvertTo-Json -InputObject @(...)`; this repaired the earlier HTTP 400 scalar
serialization failure without widening authority.

## Credential scope

Fresh independent credential-scope audit Jules session
`14300981553462683613` returned PASS for one project-scoped PAT with exactly:

- Database READ-WRITE
- API Keys READ
- Edge Functions READ
- Edge Function Secrets READ-WRITE

No organization-wide, Project Settings, Logs, Advisors, Storage, Auth Config,
migrations, branches or other scopes were required. The token value remained
local under Windows DPAPI and was never printed/committed.

## Fresh rerun authorization

Jules session `3236533720131047548` independently reviewed exact runtime head
`cf645799968458d55d5c2b391a5d354c369337b6`, verified a clean tree, ran the full
suite (`324/324` PASS, zero failures/skips), and returned **PASS** authorizing
exactly one normal live launcher execution.

That one-run authorization has now been consumed by the successful PASS below.
Do not rerun the live probe without a new explicit reviewed reason; no rerun is
needed for normal 8D closeout.

## Executed real Edge concurrency acceptance — PASS

Exact runtime head:
`cf645799968458d55d5c2b391a5d354c369337b6`

Namespace:
`c6b88ac8-6b46-4b0f-932a-229422fa1272`

Prepare phase:

- concurrency: 8
- winners: 1
- replays: 7
- status: `PREPARED`
- trace header: `x-deno-execution-id`
- trace samples: 8
- distinct routing traces: 8
- region header: `x-sb-edge-region`
- distinct regions: 3
- browser dispatch: false
- secrets printed: false

Cancel phase:

- concurrency: 8
- winners: 1
- replays: 7
- status: `CANCELLED`
- trace header: `x-deno-execution-id`
- trace samples: 8
- distinct routing traces: 8
- region header: `x-sb-edge-region`
- distinct regions: 3
- browser dispatch: false
- secrets printed: false

Final receipt:

- `prepareWinners=1`
- `cancelWinners=1`
- `prepareDistinctRoutingTraces=8`
- `cancelDistinctRoutingTraces=8`
- `browserDispatchAllowed=false`
- `clean=true`
- `secretsPrinted=false`

Terminal output:

`8D EDGE CONCURRENCY ACCEPTANCE: PASS`

The launcher then reported:

`Static Edge master restored to false.`

## Post-probe independent cleanup verification

A separate read-only production DB check after the PASS verified:

- policy `OFF`
- `legacy_gated=false`
- `agent_commit_enabled=false`
- host gate false
- operator epoch 3
- owner null
- namespace null
- lease null
- host false
- every synthetic 8D candidate table zero rows
- `opera_agent_private.goal_heads` zero rows

The DB query cannot reveal the static Edge secret value; the false restore is
established by the reviewed launcher's successful bounded Management API write.

## Advisor reconciliation

Fresh post-probe Supabase security/performance advisors show **no 8D-owned ERROR
or WARN**.

8D-related findings are INFO only:

- RLS-enabled service-only/private tables with no client policies;
- unindexed FK on `opera_agent_tx_candidate.runs`;
- currently-unused 8D retention/cleanup indexes.

Current WARN findings are on pre-existing/public legacy surfaces (`loa_v3_*`,
relay functions, `pg_net`, anonymous-access/Auth configuration), not the 8D
private transaction candidate. The canonical 8D advisor criterion is therefore
satisfied for the current checkpoint objects.

## Remaining closeout procedure

No further production live probe is part of the normal closeout.

1. Commit this executed-procedure update, the consolidated acceptance record,
   `docs/project-context.md`, and `docs/next-session-handoff.md`.
2. Treat the resulting documentation head as the final 8D audit candidate.
3. Require CI/status checks green on that exact head. Pending/in-progress => STOP.
4. Obtain a fresh independent overall Checkpoint 8D read-only audit. It must
   reconcile every canonical 8D acceptance bullet against the evidence chain,
   verify no source/runtime authority drift, and verify cleanup/advisor state.
5. Only final audit **PASS** permits marking 8D accepted and beginning 8E.

Until that verdict: **8D IN PROGRESS; 8E NOT STARTED.**
