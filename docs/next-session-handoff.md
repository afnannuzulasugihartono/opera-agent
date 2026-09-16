# Opera Agent next-session handoff

Last synchronized: 2026-09-16. Continue **ONLY Checkpoint 8D closeout**. 8E has not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable release: extension 1.6.0, protocol 1, 26 browser capabilities, 18 public MCP
tools, unchanged signing/pairing, signed rollback 1.5.2.

Milestone 8 checkpoints 8A-8C are accepted. 8D is **IN PROGRESS — live acceptance evidence complete; final exact-head CI + independent overall audit pending**. Nothing here permits 8E. Repository/CI/production evidence outranks chat summaries. Never commit or print credentials.

## Live acceptance status

The real hosted Edge concurrency probe has **PASSED**. Do not rerun it during normal closeout.

Exact runtime head used for the live probe:
`cf645799968458d55d5c2b391a5d354c369337b6`.

Authorized namespace:
`c6b88ac8-6b46-4b0f-932a-229422fa1272`.

Prepare race:
- concurrency 8
- 1 non-replay winner + 7 exact replays
- status `PREPARED`
- 8 distinct `x-deno-execution-id` routing traces
- 3 observed Edge regions
- `browserDispatchAllowed=false`
- `secretsPrinted=false`

Cancel race:
- concurrency 8
- 1 non-replay winner + 7 exact replays
- status `CANCELLED`
- 8 distinct `x-deno-execution-id` routing traces
- 3 observed Edge regions
- `browserDispatchAllowed=false`
- `secretsPrinted=false`

Terminal result:
`8D EDGE CONCURRENCY ACCEPTANCE: PASS`

Launcher restore result:
`Static Edge master restored to false.`

Routing traces prove distinct hosted request executions only; do not claim distinct provider-internal V8 isolates or worker processes.

## Independent post-probe production state

Fresh read-only production verification after the PASS:

- policy `OFF`
- `legacy_gated=false`
- `agent_commit_enabled=false`
- DB host gate false
- operator epoch 3
- owner null
- namespace null
- lease null
- host false
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

The database verification cannot reveal the static Edge secret value; master-false evidence is the reviewed launcher's successful bounded Management API restore.

## Other closed 8D live evidence

- PKCE acceptance passed at `80e44483f2cdba400681dc6279522d0d55d24c98`; OAuth consent remained connection authorization only and browser dispatch false.
- Hosted durable worker-loss acceptance passed at `8e3c6cd6aef41d8d1fb5a46189b193e34212c377` with child-process death against hosted DB, lease-expiry reclaim, stale-epoch rejection, nonce durability, exact redelivery, one logical commit slot, clean cleanup and no secret output.
- Quantitative boundary evidence is recorded in `docs/milestone-8-checkpoint-8d-cloud-bounds.md` and complementary native/PostgreSQL/host suites.

## Credential / authorization chain

Credential-scope review Jules session `14300981553462683613` returned PASS for one project-only Supabase PAT with exactly:

- Database READ-WRITE
- API Keys READ
- Edge Functions READ
- Edge Function Secrets READ-WRITE

The value remained local under Windows DPAPI and was never printed or committed.

Fresh rerun authorization Jules session `3236533720131047548` verified exact runtime head `cf645799968458d55d5c2b391a5d354c369337b6`, clean tree and `324/324` tests PASS, then returned **PASS** for exactly one normal live run. That authorization has now been consumed by the successful PASS above.

## Advisor reconciliation

Fresh post-probe Supabase security and performance advisors show no 8D-owned `ERROR` or `WARN` findings.

8D-related findings are INFO only: service-only/private RLS tables with no client policies, one unindexed FK on `opera_agent_tx_candidate.runs`, and currently-unused 8D retention/cleanup indexes. Existing WARN findings are on pre-existing/public legacy surfaces (`loa_v3_*`, relay functions, `pg_net`, anonymous-access/Auth configuration), not the 8D private transaction candidate.

Therefore the canonical “no checkpoint-introduced unresolved relevant ERROR/WARN” gate is satisfied for 8D objects.

## Documentation closeout now on branch

The branch now contains:

- `docs/milestone-8-checkpoint-8d-acceptance.md` — consolidated acceptance-record candidate;
- synchronized `docs/project-context.md`;
- executed-state `docs/milestone-8-checkpoint-8d-acceptance-procedure.md`;
- this handoff.

These are documentation-only closeout commits after the runtime/live probe head. The final branch head containing this handoff is the required **exact CI + final-audit candidate**.

## Exact next gate

1. Read the branch exact head after this handoff commit.
2. Require CI/status checks green on that exact head. Pending/queued/in-progress => **STOP** at CI. A real test failure => diagnose only that failure.
3. After exact-head CI is green, obtain one fresh independent **overall Checkpoint 8D** read-only audit. The reviewer must reconcile every frozen `docs/milestone-8-plan.md` 8D acceptance bullet against the full evidence chain, including live Edge PASS, worker-loss/PKCE/quantitative/negative evidence, post-probe OFF/zero-row cleanup, advisor reconciliation and absence of authority drift.
4. Final reviewer returns exactly PASS / CONDITIONAL PASS / FAIL.
5. Only **PASS** may change 8D status to accepted and permit beginning 8E.
6. If not PASS, perform only the smallest bounded correction identified; do not expand scope.

**Do not run `RUN_8D_EDGE_CONCURRENCY.cmd` again during normal closeout.** The reviewed one-run authorization was consumed successfully.

## User-local state

Two accidental untracked 8E files remain preserved in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash while 8D remains open.
