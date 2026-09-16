# Opera Agent project context

Last synchronized: 2026-09-16

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, `docs/milestone-8-plan.md`, and checkpoint acceptance records.

## Current boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Signed rollback: `1.5.2`
- Milestone 8: 8A-8C accepted; **8D IN PROGRESS — live evidence complete, final CI/audit pending**; 8E not started

Checkpoint 8D remains frozen to no public MCP schema/runtime, extension/CRX,
signing, pairing, protocol, or browser-capability changes. OAuth consent is
connection authorization only. `browserDispatchAllowed` remains false.

## Live-probe runtime head

The real hosted Edge concurrency acceptance was executed exactly once on runtime
head `cf645799968458d55d5c2b391a5d354c369337b6` after a fresh independent rerun
authorization PASS.

That runtime head is now historical evidence. Documentation-only commits made
after the probe must receive fresh exact-head CI and the final overall 8D audit
before 8D can be marked accepted.

## Accepted 8D live evidence

### PKCE

Manual PKCE acceptance passed at
`80e44483f2cdba400681dc6279522d0d55d24c98`. OAuth application consent remained
connection authorization only, browser dispatch remained false, and the static
Edge master was restored to false afterward.

### Worker-loss / reclaim

Hosted durable worker-loss acceptance passed at
`8e3c6cd6aef41d8d1fb5a46189b193e34212c377` with real local child process death
against the hosted Supabase database, lease-expiry reclaim, stale-epoch rejection,
one-shot nonce durability, exact redelivery, one logical commit slot,
cancellation/recovery safety, browser dispatch false, clean cleanup, and no secret
output. This is not provider-internal Edge/V8-isolate death evidence.

### Quantitative bounds

`docs/milestone-8-checkpoint-8d-cloud-bounds.md` records the accepted bounded
cloud quantitative continuation for pending queue, prepare/commit rates,
concurrent targets, target digest, exact payload boundary, and cleanup batch.
Native/PostgreSQL and hosted tests provide the complementary durability,
retention, crypto/token, tenant and policy-negative coverage.

### Real hosted Edge concurrency — PASS

Authorized run namespace:
`c6b88ac8-6b46-4b0f-932a-229422fa1272`.

Prepare race:
- concurrency 8;
- one non-replay winner + seven exact replays;
- status `PREPARED`;
- eight distinct `x-deno-execution-id` routing traces;
- three observed `x-sb-edge-region` regions;
- `browserDispatchAllowed=false`;
- `secretsPrinted=false`.

Cancel race:
- concurrency 8;
- one non-replay winner + seven exact replays;
- status `CANCELLED`;
- eight distinct `x-deno-execution-id` routing traces;
- three observed `x-sb-edge-region` regions;
- `browserDispatchAllowed=false`;
- `secretsPrinted=false`.

Final receipt reported `prepareWinners=1`, `cancelWinners=1`, eight distinct
routing traces for both phases, `clean=true`, browser dispatch false and no secret
output. Terminal result: **`8D EDGE CONCURRENCY ACCEPTANCE: PASS`**. The launcher
then reported **static Edge master restored to false**.

Routing traces prove distinct hosted request executions only; do not claim distinct
V8 isolates or provider-internal worker processes.

## Production state after the PASS

Fresh independent read-only database verification after the live probe returned:

- policy `OFF`;
- `legacy_gated=false`;
- `agent_commit_enabled=false`;
- `opera_tx_operator_host_gate_8d()=false`;
- operator epoch `3`;
- owner null;
- namespace null;
- lease null;
- `hostEnabled=false`;
- `principals=0`;
- `rates=0`;
- `acceptance_bindings=0`;
- `runs=0`;
- `run_identities=0`;
- `run_limits=0`;
- `run_previews=0`;
- `run_challenges=0`;
- `journal=0`;
- `approvals=0`;
- `commit_slots=0`;
- `opera_agent_private.goal_heads=0`.

The database check cannot reveal the static Edge secret value; master-false evidence
comes from the reviewed launcher's successful bounded Management API restore.

## Production facts

Supabase project `opera-agent` / `nenmkmtvjremqphfqnfw` is the only 8D project.
Installed migrations include:

- `20260913143306_transaction_journal_8d_dark`
- `20260914043049_transaction_operator_fence_8d`

The isolated `opera-agent-transactions-8d` function was reviewed as ACTIVE,
JWT-required, production version 20, bundle SHA-256
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
Its static `OPERA_AGENT_TRANSACTION_DARK_8D` master is only a deployment kill
switch. Even when true, every transaction request still requires the independent
service-only DB `opera_tx_operator_host_gate_8d()` to return true.

## Credential / launcher chain

The launcher is fixed to project `nenmkmtvjremqphfqnfw` and secret
`OPERA_AGENT_TRANSACTION_DARK_8D`. It establishes false baseline, temporarily sets
true around exactly one bounded probe, restores false in `finally` with at most
three attempts, fails loudly on restore failure, and clears local credential
environment variables. `-RecoverNamespace` never enables the master;
`-RestoreMasterOnly` can only write false.

The PowerShell one-element-array serialization defect was repaired tests-first:

- `9f372e6ce6f16927233090826180f26a14fb9bd5` — regression contract;
- `07acfa962e3b9acde8a087d0d05657d3b0709f98` — array-preserving
  `ConvertTo-Json -InputObject @(...)` implementation.

The replacement Supabase PAT was independently scoped and reviewed in Jules
session `14300981553462683613`: project-only, Database READ-WRITE, API Keys READ,
Edge Functions READ, Edge Function Secrets READ-WRITE, no additional permissions.
Its value remained local under Windows DPAPI and was never printed or committed.

Fresh Jules rerun authorization session `3236533720131047548` reviewed exact
runtime head `cf645799968458d55d5c2b391a5d354c369337b6`, reported `324/324` tests PASS
with zero failures/skips, and returned **PASS** for exactly one normal live run.
That authorization has now been consumed by the successful live PASS.

## Advisor reconciliation

Fresh post-probe Supabase advisors show no 8D-owned `ERROR` or `WARN` findings.
8D-related findings are INFO only:

- private/service-only RLS tables with no client policies;
- an unindexed FK on `opera_agent_tx_candidate.runs`;
- currently-unused 8D retention/cleanup indexes.

Current WARN findings belong to pre-existing/public legacy surfaces (`loa_v3_*`,
relay functions, `pg_net`, anonymous-access/Auth configuration), not the private
8D transaction candidate. The 8D advisor acceptance criterion is therefore
satisfied for the current checkpoint objects.

## Acceptance record

`docs/milestone-8-checkpoint-8d-acceptance.md` now records the full live evidence,
post-probe cleanup, advisor reconciliation and canonical acceptance mapping.
Its status remains a **candidate pending final exact-head CI and independent overall
8D audit**. Do not treat creation of the record itself as 8D acceptance.

## Exact next sequence

1. Finish synchronization of `docs/milestone-8-checkpoint-8d-acceptance-procedure.md`
   and `docs/next-session-handoff.md` to the post-probe state.
2. Treat the resulting documentation commit as the exact final-audit candidate.
3. Require CI/status checks green on that exact head. Pending/in-progress => STOP;
   failed => diagnose only the failing check.
4. Obtain a fresh independent **overall Checkpoint 8D** read-only audit of the
   exact documentation head and complete evidence chain.
5. Only final audit **PASS** may mark 8D accepted and permit starting 8E.
6. If final audit is not PASS, perform only the smallest bounded correction it
   identifies, then repeat exact-head CI/audit as required.

## Invariants and user-local state

- one active writer;
- tests before behavior;
- background-first browser operation;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print Management/OAuth/signing/pairing/crypto credentials;
- do not rerun the live Edge concurrency probe: the reviewed one-run authorization
  was consumed by the PASS above;
- do not begin 8E before final 8D audit PASS.

Two accidental untracked 8E files remain preserved in a Git stash named roughly
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash while 8D remains open.
