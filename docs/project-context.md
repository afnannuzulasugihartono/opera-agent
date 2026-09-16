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
- Milestone 8: 8A-8D **ACCEPTED**; 8E not started
- Checkpoint 8D durable closeout head before Performance Track P:
  `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Active user-selected work: **Performance Track P — Delta-First Runtime**
- Current checkpoint: **P0 FINAL CANDIDATE; exact-head CI/status required**
- P1 not started; 8E remains paused

Checkpoint 8D preserved the frozen boundary: no public MCP schema/runtime,
extension/CRX, signing, pairing, protocol, or browser-capability changes. OAuth
consent remained connection authorization only. `browserDispatchAllowed` remained
false throughout 8D acceptance.

## Performance Track P

The user selected a bounded performance track after closing 8D and before starting
8E. The detailed frozen plan is `docs/delta-first-performance-plan.md`; the P0
candidate record is `docs/delta-first-performance-p0.md` and the machine-readable
contract is `tests/fixtures/delta-performance-baseline-p0-v1.json`.

The target direction is:

```text
full snapshot bootstrap
  -> bounded semantic working state
  -> browser signals/change epochs
  -> semantic delta
  -> causal invalidation
  -> relevance gate
  -> local continuation or compact reasoning patch
```

A full snapshot remains the fail-closed recovery primitive whenever continuity is
not provable. Performance Track P does not grant new transaction authority or
change the frozen Milestone 8 contracts.

P0 scope is contract/baseline/docs/tests only. It authorizes no runtime,
extension, MCP, browser, database, Edge, OAuth, production, signing/pairing, or
transaction-authority mutation.

P0 freezes these future target gates without claiming they are already achieved:

- false completion 0;
- foreground takeover 0;
- stale-state action 0;
- relevant-signal loss 0;
- small-change reasoning payload reduction >= 75% median;
- repetitive reasoning/tool round-trip reduction >= 60% median;
- steady-state full-snapshot reduction >= 80%;
- long repetitive task speedup >= 2.0x median;
- simple-operation median regression <= 15%.

Inherited accepted 1.6.0 browser evidence from `docs/benchmarks.md` remains the
reference baseline: rich-read median 19.83 ms, p95 20.65 ms, 50,953-byte enriched
snapshot median, and 6,087-byte single-update delta (12% delta/snapshot ratio).
P0 does not relabel those historical accepted measurements as fresh exact-head live
measurements.

## Final 8D acceptance chain

### Live-probe runtime head

The real hosted Edge concurrency acceptance ran exactly once on runtime head
`cf645799968458d55d5c2b391a5d354c369337b6` after fresh independent rerun
authorization PASS.

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

Authorized namespace:
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

## Production state after the 8D PASS

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

## Final independent overall 8D audit — PASS

Final read-only Jules session `17943137394205042765` reviewed exact documentation
head `d0ce3c42c076e3c60d61a2a72150e57371cf8a09` after CircleCI #65 and Vercel both
reported SUCCESS. The reviewer verified the exact head, clean git state, `324/324`
passing tests, canonical 8D acceptance mapping, and zero repository
diffs/artifacts. Final verdict: **PASS**.

The later durable 8D closeout ended at
`696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab` with CircleCI #69 and Vercel SUCCESS;
temporary audit PR #43 was closed without merge. 8D is therefore fully closed.

`docs/milestone-8-checkpoint-8d-acceptance.md` is the authoritative consolidated
8D acceptance record.

## Exact next gate

1. Treat the branch head containing the complete P0 artifacts, roadmap, context,
   and handoff as the exact P0 final candidate.
2. Require CircleCI and Vercel/status checks on that exact head to be SUCCESS.
   Pending/queued/in-progress => STOP; a real failure => diagnose only P0.
3. No second status-only commit is required after exact-head green checks.
4. Once green, P0 is accepted. Do **not** begin P1 in the same turn without an
   explicit user continuation.
5. If the user continues the selected performance track, exact next checkpoint is
   **P1 — persistent semantic working state**.
6. Do not start 8E while Performance Track P remains the selected active track.

## Invariants and user-local state

- one active writer;
- tests before behavior;
- background-first browser operation;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print Management/OAuth/signing/pairing/crypto credentials;
- do not rerun the live 8D Edge concurrency probe: its reviewed one-run
  authorization was consumed by the PASS.

Two accidental untracked 8E files remain preserved in a Git stash named roughly
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash automatically. Performance Track P does not use it.
If 8E later resumes and might reuse those files, inspect them first against the
canonical 8E scope.
