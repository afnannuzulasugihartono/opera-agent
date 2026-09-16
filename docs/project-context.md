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

CircleCI pipeline #37 later passed at exact documentation head
`a5dde1e923029b6ff057a33144983998970a03b4`.

## Independent concurrency review and routing evidence repair

Jules session `16177705161344454955` audited exact head
`a5dde1e923029b6ff057a33144983998970a03b4` and returned **CONDITIONAL PASS**
because the acceptance procedure used the phrase "multiple real Edge workers" but
the runner did not expose worker/isolate identity.

The project implemented the requested bounded routing evidence tests-first:

- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — test contract requires routing
  evidence, fail-closed missing-evidence behavior, and no raw header disclosure;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — pure helper
  `tests/helpers/transaction-edge-routing-evidence-8d.mjs`;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

The helper inspects only allowlisted request/execution routing headers in memory:
`x-deno-execution-id` and `cf-ray`, with optional `x-sb-edge-region` summary. It
requires exactly eight response samples and at least two distinct values from one
allowlisted trace header. Missing evidence fails closed. Raw values are never
returned or logged; receipts expose only header name and counts. Both prepare and
cancel phases must satisfy the bound.

Exact documentation head `e8b68b31e50220bd4591dae6c4713e7db4b11af3`
received CircleCI #42 SUCCESS and Vercel SUCCESS. Jules re-reviewed that exact head,
reported 321 local tests passing, and again returned **CONDITIONAL PASS** because
`x-deno-execution-id` and `cf-ray` prove distinct request/execution traces but not
provider-internal V8-isolate/process identity.

## 2026-09-16 canonical concurrency clarification

A direct comparison against the canonical `docs/milestone-8-plan.md` found that the
frozen Checkpoint 8D acceptance contract does **not** require externally proving
"multiple real Edge workers". The canonical acceptance criteria require:

- worker death before browser dispatch to be safely reclaimable;
- exact redelivery/idempotency and nonce durability;
- exact rate/queue/concurrency/payload/retention bounds;
- crypto/tenant/policy/advisor/cleanup guarantees.

The phrase "Concurrent cloud races (multiple real Edge workers)" existed only in
`docs/milestone-8-checkpoint-8d-acceptance-procedure.md`, a later procedural aid.
It accidentally strengthened the provider-observability requirement beyond the
reviewed milestone plan.

Commit `6f470bb9626aec5a0d60c1176af471f89558cbed` corrects the procedure to the
canonical plan instead of waiving the plan. The hosted concurrency gate is now
explicitly defined as eight simultaneous authenticated real-Edge requests per
raced operation, distinct hosted request/execution traces, convergent metadata,
exact one-winner/seven-replay behavior, bounded responses, fail-closed fencing,
and zero browser dispatch.

The correction explicitly forbids claiming that trace diversity proves N distinct
Deno workers or V8 isolates. It changes no milestone plan, runtime code, Edge
function, database schema, public MCP surface, extension, OAuth behavior, signing,
pairing, protocol, or browser authority.

This is a plan-alignment correction, not writer self-approval of a weaker security
contract. It must receive exact-head CI and a fresh independent review before any
live concurrency probe.

## Exact next sequence

1. Require CircleCI/Vercel SUCCESS for the latest exact documentation head after
   this context/handoff update.
2. Obtain a fresh Jules independent re-review bound to that exact head. Reviewer
   must explicitly verify that the procedure correction is faithful to canonical
   `docs/milestone-8-plan.md`, does not weaken the actual 8D acceptance criteria,
   and does not overclaim worker/isolate evidence.
3. Only reviewer verdict **PASS** authorizes exactly one fresh
   `RUN_8D_EDGE_CONCURRENCY.cmd` live probe.
4. Before that live probe, any temporary static Edge master enable/restore
   procedure must be explicit and independently reviewed; never silently mutate
   production configuration.
5. After any reviewed live PASS, immediately re-query policy/operator/host and all
   synthetic tables for OFF/unowned/zero cleanup.
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
