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
- Milestone 8: 8A-8C accepted; **8D IN PROGRESS**; 8E not started

Checkpoint 8D remains frozen to no public MCP schema/runtime, extension/CRX,
signing, pairing, protocol, or browser-capability changes. OAuth consent is
connection authorization only. `browserDispatchAllowed` must remain false.

## Accepted 8D live evidence

Manual PKCE acceptance passed at
`80e44483f2cdba400681dc6279522d0d55d24c98`. The static Edge master was restored
to false afterward.

Hosted child-worker-loss acceptance passed at
`8e3c6cd6aef41d8d1fb5a46189b193e34212c377` with real local child death,
natural lease-expiry reclaim, stale epoch rejection, one-shot nonce durability,
exact redelivery, one commit slot, browser dispatch false, clean cleanup, and no
secret output. Fresh production verification afterward showed policy OFF,
legacy_gated=false, agent_commit_enabled=false, operator/namespace unowned,
host_enabled=false, lease null, epoch 2, all synthetic 8D tables zero, and
`opera_agent_private.goal_heads` zero. This is not Edge-isolate death evidence.

## Production facts

Supabase project `opera-agent` / `nenmkmtvjremqphfqnfw` is the only 8D project.
Installed migrations include:

- `20260913143306_transaction_journal_8d_dark`
- `20260914043049_transaction_operator_fence_8d`

The isolated `opera-agent-transactions-8d` function was most recently observed
ACTIVE, JWT-required, production version 20, reviewed bundle hash
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
Its static `OPERA_AGENT_TRANSACTION_DARK_8D` master is only a deployment kill
switch. Even when true, every transaction request still requires the independent
service-only DB `opera_tx_operator_host_gate_8d()` to return true.

## Real Edge concurrency candidate

The bounded candidate sends eight simultaneous authenticated POSTs to the fixed
real 8D Edge endpoint on first `prepare` and first `cancel`, requiring one
non-replay winner, seven exact replays, metadata convergence, bounded 32 KiB
responses, fenced ownership/recovery, browser dispatch false, and no secret output.

The first attempted live launch failed before OAuth or fixture mutation because
Deno could not resolve the pinned Supabase SDK. Tests-first repair commits:

- `f98964f11dc9c6e9651cce203d8f02154f3d8be1` — dependency regression contract;
- `f493aed0afa17c3833c79f8f82dcddd51c656152` — launcher adds
  `--node-modules-dir=auto` without package/install changes.

Bounded routing evidence commits:

- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — routing evidence contract;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — bounded helper;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

Only allowlisted request/execution trace headers are inspected in memory; raw
values are never logged. The evidence is request/execution evidence, never a claim
of distinct provider-internal V8 isolates.

## Canonical concurrency procedure alignment — PASS

`docs/milestone-8-plan.md` requires safe worker-death reclaim,
redelivery/nonce durability, and exact rate/queue/concurrency/payload/retention
bounds. It does not require public proof of provider-internal V8-isolate IDs.

Commit `6f470bb9626aec5a0d60c1176af471f89558cbed` corrected the later procedure's
accidental `multiple real Edge workers` over-specification to observable hosted
concurrency without weakening the canonical plan.

Jules session `16177705161344454955` independently re-reviewed exact head
`f63bd8f52e086259ccbbf9120b240da1f9720049` with CircleCI #47/Vercel SUCCESS and
returned **PASS**. It accepted the eight-way candidate as a valid bounded
measurement mechanism, subject to a separately reviewed static-master bracket.

## Static-master bracket

Tests-first and implementation commits:

- `714ef9dad2d9049284f3bf951528d9095b7b0535` — fixed fail-closed launcher
  contract;
- `97a1c58ba3714455ff8d0463bf076229efdd71ae` — launcher implementation;
- `95572c3e1fe62fae212b4899da307110b7ce95c8` — bounded procedure document;
- `01153259d3c2f58446b16c067fb36d479b1d8166` and
  `f1b2cadde60510d46b38a8f3bf5f991bfd9ba4f8` — durable state updates.

Normal launcher sequence is fixed to project `nenmkmtvjremqphfqnfw` and secret
`OPERA_AGENT_TRANSACTION_DARK_8D` only:

1. load the Management token only from the current shell or Windows-DPAPI storage;
2. POST the fixed master to `false` as baseline;
3. POST the same fixed master to `true` immediately around exactly one probe;
4. run the existing bounded concurrency probe;
5. restore `false` in PowerShell `finally`, retrying at most three times;
6. fail loudly if restore cannot be confirmed by the write result;
7. clear Management/publishable-key environment variables before exit.

`-RecoverNamespace` never enables the master. `-RestoreMasterOnly` only writes the
fixed master to `false` and runs no OAuth, fixture, probe, or browser action. No
GET/list/reveal/delete secret path exists.

Abrupt OS termination or power loss can bypass PowerShell `finally`; the explicit
recovery is `RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly`. Even if the static
master were temporarily left true, the independent DB host gate remains
fail-closed.

## Independent static-master review — PASS, then serialization regression found live

Fresh Jules session `6098947889864439430` independently audited exact head
`f1b2cadde60510d46b38a8f3bf5f991bfd9ba4f8`, bound to CircleCI pipeline #54
SUCCESS and Vercel SUCCESS. The review was read-only and reported **324/324 local
tests passing** with a clean repository. Final gate verdict was **PASS**.

The first post-review launcher attempt at documentation head
`71995dbc5733d872b50656d04e7bcda9bc58f9f1` stopped on the baseline `false` write
with HTTP 403 while using the pre-existing Management PAT. No OAuth, fixture, Edge
probe, or successful master write occurred. A replacement scoped PAT was then
created with project scope `opera-agent`, seven-day expiry, and only
`Edge Function Secrets: Read-write`; its value remained local and was stored under
Windows DPAPI.

A second launcher attempt at the same head authenticated farther but stopped on the
same baseline `false` write with HTTP 400. Supabase's current Management API
OpenAPI contract requires `POST /v1/projects/{ref}/secrets` to receive a JSON array
of `{name,value}` objects. The launcher used a PowerShell pipeline
`@(...) | ConvertTo-Json`, which enumerates a one-element array and serializes the
single object rather than the required JSON array. Therefore the 400 occurred
before `restoreRequired` became true and before the `true` write, OAuth, fixture,
or concurrency probe.

Tests-first repair commits:

- `9f372e6ce6f16927233090826180f26a14fb9bd5` — regression contract requiring
  array-preserving `ConvertTo-Json -InputObject @(...)` and rejecting the prior
  pipeline form;
- `07acfa962e3b9acde8a087d0d05657d3b0709f98` — minimal launcher fix preserving
  the JSON array while leaving project, secret, authority, restore semantics,
  browser-dispatch prohibition, and public contracts unchanged.

Because this launcher controls a production-boundary static master, the repaired
head requires exact-head CI SUCCESS and a fresh independent read-only review PASS
before any further normal live probe. The previous one-probe authorization must
not be treated as sufficient for the modified launcher.

## Exact next sequence

1. Finish durable context/handoff updates for the array-serialization repair.
2. Require CircleCI and Vercel SUCCESS on the exact resulting documentation head.
   Pending => STOP; failed => diagnose only that failure.
3. Obtain a fresh independent read-only review of the repaired launcher and bound
   exact-head CI. Review must confirm the body is an array matching the Supabase
   Management API contract and that all previously accepted static-master safety
   invariants remain unchanged.
4. Only a fresh review PASS may authorize one normal
   `RUN_8D_EDGE_CONCURRENCY.cmd` live probe. Do not rerun before that PASS.
5. If a future live run emits a recovery namespace, recover that namespace before
   any normal rerun. If static-master restoration is uncertain, run only
   `RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly` first.
6. Immediately after the authorized probe verify static master false, policy OFF,
   operator/namespace unowned, host false, all synthetic 8D tables zero, and
   `opera_agent_private.goal_heads` zero.
7. Continue only remaining 8D real-key crypto tamper negatives, authenticated
   cross-tenant/session negatives, unresolved quantitative/rate evidence, and
   advisor reconciliation.
8. Write final `docs/milestone-8-checkpoint-8d-acceptance.md` with exact SHA, CI,
   probe receipts, advisor reconciliation, and clean-state evidence.
9. Obtain the final independent 8D audit PASS. Only final PASS permits 8E.

## Invariants and user-local state

- one active writer;
- tests before behavior;
- background-first browser operation;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit or print Management/OAuth/signing/pairing/crypto credentials.

Two accidental untracked 8E files remain preserved in a Git stash named roughly
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash while 8D remains open.
