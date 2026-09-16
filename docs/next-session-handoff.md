# Opera Agent next-session handoff

Last synchronized: 2026-09-16. Continue **ONLY Checkpoint 8D**. 8E has not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable release: extension 1.6.0, protocol 1, 26 browser capabilities, 18 public MCP
tools, unchanged signing/pairing, signed rollback 1.5.2.

Milestone 8 checkpoints 8A-8C are accepted. 8D is **IN PROGRESS**. Nothing in this
handoff permits 8E. Use one active writer. Repository/CI/production evidence
outranks chat summaries. Never commit or print credentials.

## Accepted live evidence already closed

- Manual Windows/Opera PKCE acceptance passed at
  `80e44483f2cdba400681dc6279522d0d55d24c98`; OAuth consent is connection
  authorization only and browser dispatch stayed false.
- Hosted child-worker-loss acceptance passed at
  `8e3c6cd6aef41d8d1fb5a46189b193e34212c377` with real local child death,
  lease-expiry reclaim, stale epoch rejection, nonce durability, exact redelivery,
  one commit slot, clean cleanup, and no secret output.
- Fresh production verification after worker-loss was policy OFF,
  legacy_gated=false, agent_commit_enabled=false, operator/namespace unowned,
  host_enabled=false, lease null, epoch 2, all synthetic 8D tables zero, and
  `opera_agent_private.goal_heads` zero.

The worker-loss result is not Edge-isolate death evidence.

## Production facts

Supabase project: `opera-agent` / `nenmkmtvjremqphfqnfw`.
The isolated `opera-agent-transactions-8d` function was most recently observed
ACTIVE, JWT-required, production version 20, reviewed bundle hash
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
Static Edge master was restored to false after prior PKCE work and must never be
silently enabled.

## Real Edge concurrency candidate and Deno repair

The 8D candidate sends eight simultaneous authenticated POSTs to the fixed real
Edge endpoint on first `prepare` and first `cancel`, requiring one non-replay
winner, seven exact replays, metadata convergence, bounded response size,
fenced cleanup/recovery, browser dispatch false, and no secret output.

A first user launch at `cb75feb...` failed before runner execution because Deno
could not resolve pinned `npm:@supabase/supabase-js@2.57.4`. No OAuth or production
fixture mutation occurred. Tests-first repair:

- `f98964f11dc9c6e9651cce203d8f02154f3d8be1` — regression test;
- `f493aed0afa17c3833c79f8f82dcddd51c656152` — launcher adds
  `--node-modules-dir=auto` without package.json or install-command changes.

CircleCI pipeline #37 passed at exact head
`a5dde1e923029b6ff057a33144983998970a03b4`.

## First independent review

Jules session `16177705161344454955` audited exact head
`a5dde1e923029b6ff057a33144983998970a03b4` and returned **CONDITIONAL PASS**.
Every reviewed safety/contract item passed except proof for the frozen phrase
"multiple real Edge workers".

The reviewer asked for bounded Edge routing/execution trace evidence or an
explicit governance reinterpretation. The writer implemented technical evidence,
not a waiver.

## Bounded routing-trace evidence repair

Tests-first commits:

- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — test contract requires
  routing-trace evidence, fail-closed missing-evidence behavior, and no raw header
  disclosure;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — helper
  `tests/helpers/transaction-edge-routing-evidence-8d.mjs`;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

Implementation properties:

- exactly 8 response samples are required;
- only allowlisted trace headers `x-deno-execution-id` and `cf-ray` are inspected;
- optional `x-sb-edge-region` is summarized separately;
- at least 2 distinct trace values are required for both prepare and cancel;
- missing evidence fails closed with `8D_EDGE_WORKER_TRACE_EVIDENCE_MISSING`;
- raw response-header values remain in memory only and are never returned/logged;
- receipts contain only header name + counts;
- no Edge runtime/function, DB schema/migration, MCP/public runtime, extension,
  OAuth semantics, signing, pairing, protocol, or browser authority changes.

Exact documentation head `e8b68b31e50220bd4591dae6c4713e7db4b11af3`
received CircleCI pipeline #42 SUCCESS and Vercel SUCCESS.

## Independent routing-evidence re-review result

The same independent Jules reviewer re-reviewed exact head
`e8b68b31e50220bd4591dae6c4713e7db4b11af3`, bound CircleCI #42 SUCCESS and
Vercel SUCCESS, inspected the routing-evidence diff, adjudicated trace-header
semantics, and reported 321 local tests passing.

Final verdict: **CONDITIONAL PASS**.

The live concurrency probe remains **NOT AUTHORIZED**.

Decisive finding:

- `x-deno-execution-id` is evidence of distinct hosted Edge function executions,
  not a stable worker/V8-isolate identity;
- `cf-ray` is evidence of distinct Cloudflare request/routing traces, not backend
  Deno worker/isolate identity;
- therefore distinct trace values prove separate real requests/executions reached
  the hosted Edge path, but do not prove distinct workers/isolates.

The helper itself was accepted as bounded, fail-closed, nonsecret, and
non-invasive. The blocker is evidentiary semantics, not a newly found code-safety
bug.

Jules suggested that the smallest path to PASS is a **formal governance
clarification** accepting 8 simultaneous authenticated requests with distinct
execution traces plus exact 1-winner/7-replay convergence as the operational
meaning of "multiple real Edge workers/requests".

That clarification has **not** been applied. The wording is frozen and no
project-lead/user decision has authorized weakening or reinterpreting it. Do not
self-approve or silently edit the acceptance contract.

## Exact next step

**DO NOT RUN `RUN_8D_EDGE_CONCURRENCY.cmd`.**

1. First require CircleCI SUCCESS for the latest documentation head that records
   this re-review result. If pending, stop; if failed, diagnose only that failure.
2. The next substantive decision is governance/evidence, not a live probe:
   - either obtain explicit project-lead/user approval to adopt the reviewer's
     operational interpretation of "multiple real Edge workers/requests"; or
   - find a bounded, non-invasive source of actual worker/isolate identity or
     equivalent evidence, implement tests first if code changes are needed, then
     obtain another independent PASS.
3. Do not silently enable the static Edge master or mutate production while the
   independent verdict is CONDITIONAL PASS.
4. Only a future independent **PASS** authorizes exactly one fresh live concurrency
   probe.
5. If a future live run emits a recovery namespace, do not blindly rerun normal
   mode; use only the reviewed recovery path for that namespace.
6. After reviewed live PASS, verify production OFF/unowned/zero again.
7. Continue only remaining 8D real-key crypto tamper negatives, authenticated
   cross-tenant/session negatives, unresolved quantitative evidence, and advisor
   reconciliation.
8. Write final `docs/milestone-8-checkpoint-8d-acceptance.md`, obtain final
   independent 8D audit PASS, and only then permit 8E.

## User-local state

Two accidental untracked 8E files remain preserved in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash while 8D remains open.

The user should not pull or rerun the concurrency launcher while the independent
review remains CONDITIONAL PASS.
