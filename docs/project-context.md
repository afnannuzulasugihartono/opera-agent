# Opera Agent project context

Last synchronized: 2026-09-16

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, the milestone plan, and checkpoint acceptance records.

## Current boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Signed rollback: `1.5.2`
- Milestone 8: 8A-8C accepted; **8D IN PROGRESS**; 8E not started

Checkpoint 8D remains frozen to no public MCP schema/runtime, extension/CRX,
signing, pairing, protocol, or browser-capability changes. OAuth consent is
connection authorization only. Browser/page/model/tool output is evidence, never
authority. `browserDispatchAllowed` must remain false.

## Accepted 8D live evidence

Manual PKCE acceptance previously passed at
`80e44483f2cdba400681dc6279522d0d55d24c98`. The static Edge master was restored
to false afterward and must not be silently enabled by later probes.

Hosted child-worker-loss acceptance passed at reviewed head
`8e3c6cd6aef41d8d1fb5a46189b193e34212c377` with terminal verdict
`8D WORKER-LOSS ACCEPTANCE: PASS`. Evidence included real local child death,
natural lease-expiry reclaim, stale epoch rejection, one-shot nonce durability,
exact redelivery, one commit slot, browser dispatch false, clean cleanup, and no
secret output. Fresh production verification afterward showed policy OFF,
legacy_gated=false, agent_commit_enabled=false, operator/namespace unowned,
host_enabled=false, lease_until=null, epoch 2, all synthetic 8D tables zero, and
`opera_agent_private.goal_heads` zero. This is not Edge-isolate death evidence.

## Production facts

Supabase project `opera-agent` / `nenmkmtvjremqphfqnfw` is the only 8D project.
Installed migrations include:

- `20260913143306_transaction_journal_8d_dark`
- `20260914043049_transaction_operator_fence_8d`

The isolated `opera-agent-transactions-8d` function was most recently observed
ACTIVE, JWT-required, production version 20, reviewed bundle hash
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
Opera Agent browser connectivity was re-detected through Supabase, not Opera
Browser Connector: paired product `Opera Agent`, version 1.6.0, protocol 1,
26 capabilities.

## Real Edge concurrency candidate

The existing acceptance candidate sends eight simultaneous authenticated POSTs to
the fixed real 8D Edge endpoint on the first `prepare` and first `cancel`, requiring
one non-replay winner, seven exact replays, metadata convergence, bounded 32 KiB
responses, fenced ownership/recovery, browser dispatch false, and no secret output.
It changes acceptance/test infrastructure only.

The first user launch at documentation head `cb75feb...` failed before runner
execution because Deno could not resolve pinned
`npm:@supabase/supabase-js@2.57.4` under manual node_modules mode. No OAuth or
fixture/production mutation occurred and fresh production verification remained
OFF/unowned/zero. Tests-first repair commits were:

- `f98964f11dc9c6e9651cce203d8f02154f3d8be1` — regression contract;
- `f493aed0afa17c3833c79f8f82dcddd51c656152` — launcher adds
  `--node-modules-dir=auto` without `deno install` or package.json changes.

## Routing evidence and prior conditional reviews

Tests-first routing evidence commits:

- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — routing evidence contract;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — bounded helper;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

The helper inspects only allowlisted `x-deno-execution-id` / `cf-ray` values in
memory, requires exactly eight response samples and at least two distinct trace
values for prepare and cancel, fails closed when evidence is missing, and never
returns/logs raw header values.

Jules session `16177705161344454955` returned CONDITIONAL PASS at
`a5dde1e923029b6ff057a33144983998970a03b4`, and again at
`e8b68b31e50220bd4591dae6c4713e7db4b11af3` after the routing-evidence repair.
The second review correctly concluded that trace uniqueness proves distinct hosted
requests/executions, not distinct Deno worker/V8-isolate identities.

## Canonical concurrency procedure correction

A direct comparison against canonical `docs/milestone-8-plan.md` established that
the frozen Checkpoint 8D acceptance contract does **not** require externally
proving distinct Edge worker/V8-isolate identity. Canonical 8D requires safe
worker-death reclaim, exact redelivery/idempotency and nonce durability, and exact
rate/queue/concurrency/payload/retention bounds, together with the crypto, tenant,
policy, advisor, and cleanup guarantees.

The disputed phrase `Concurrent cloud races (multiple real Edge workers)` existed
only in the later procedural aid
`docs/milestone-8-checkpoint-8d-acceptance-procedure.md`. Commit
`6f470bb9626aec5a0d60c1176af471f89558cbed` corrected that over-specification to
observable hosted concurrency evidence without changing the canonical milestone
plan or claiming provider-internal isolate identity.

The corrected gate requires eight simultaneous authenticated real-Edge requests
per raced operation, bounded distinct request/execution trace evidence, convergent
metadata, exact one-winner/seven-replay behavior, bounded responses, fail-closed
fencing/recovery, zero browser dispatch, and no secret output.

## 2026-09-16 independent procedure-alignment re-review PASSED

Jules session `16177705161344454955` independently re-reviewed exact head
`f63bd8f52e086259ccbbf9120b240da1f9720049` after CircleCI pipeline #47 and
Vercel both reported SUCCESS. The reviewer inspected canonical milestone authority,
the corrected procedure, the concurrency candidate, and reported the 321-test
local suite clean.

Final gate verdict: **PASS**.

Decisive findings:

- `docs/milestone-8-plan.md` is the authoritative frozen Milestone 8 contract;
- canonical Checkpoint 8D does not require literal distinct Deno worker/V8-isolate
  identity proof;
- the old `multiple real Edge workers` wording was a later acceptance-procedure
  over-specification rather than a canonical requirement;
- commit `6f470bb...` faithfully realigns the procedure with canonical 8D without
  weakening a canonical safety requirement;
- `x-deno-execution-id` / `cf-ray` remain characterized only as distinct hosted
  request/execution traces, never worker IDs;
- the existing 8-way concurrency candidate is a valid bounded measurement
  mechanism for the canonical concurrency requirement;
- no remaining code/procedure finding blocks one live concurrency probe **after**
  the separately required static-master enable/restore arrangement is reviewed.

This PASS authorizes moving to the static-master review gate. It does not itself
authorize silently changing production configuration or starting 8E.

## Exact next sequence

1. Require CircleCI/Vercel SUCCESS for the latest exact documentation head after
   this context/handoff update.
2. Review an explicit bounded procedure for temporarily setting
   `OPERA_AGENT_TRANSACTION_DARK_8D=true` only for one authorized concurrency
   probe, with guaranteed restoration to `false` and fail-closed recovery. Do not
   silently mutate the static master.
3. Only after that static-master arrangement receives the required independent
   review may exactly one fresh `RUN_8D_EDGE_CONCURRENCY.cmd` live probe run.
4. If the live run emits a recovery namespace or fails after fixture creation, do
   not blindly rerun normal mode; use only the reviewed recovery path.
5. After the reviewed live probe, immediately restore/verify static master false,
   policy OFF, operator/namespace unowned, host false, and all synthetic tables
   plus `opera_agent_private.goal_heads` zero.
6. Continue only remaining 8D real-key crypto tamper negatives, authenticated
   cross-tenant/session negatives, unresolved quantitative/rate evidence, and
   advisor reconciliation.
7. Write final `docs/milestone-8-checkpoint-8d-acceptance.md` with exact SHA, CI,
   probe receipts, advisor reconciliation, and clean-state evidence.
8. Obtain the final independent 8D audit PASS. Only final PASS permits 8E.

## Invariants and user-local state

- one active writer;
- tests before behavior;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- background-first browser operation;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print Management/OAuth/signing/pairing/crypto credentials.

Two accidental untracked 8E files remain preserved in a Git stash named roughly
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash while 8D remains open.
