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

## 2026-09-16 independent concurrency review

Fresh Jules session `16177705161344454955` audited exact head
`a5dde1e923029b6ff057a33144983998970a03b4`, bound CircleCI #37 SUCCESS, ran a
read-only code audit/local verification, and returned **CONDITIONAL PASS**.

All reviewed safety/contract areas passed except the frozen phrase
"multiple real Edge workers". Eight parallel real Edge requests prove hosted
concurrency but did not independently prove distinct worker/isolate handling.
Jules explicitly stated that live concurrency remained blocked until one of these
conditions was satisfied:

1. record/assert bounded response-header routing evidence such as `cf-ray` or
   `x-deno-execution-id` (with optional region/timing metadata); or
2. formally waive/reinterpret the frozen wording.

The project chose technical evidence, not a governance waiver.

## Tests-first routing-trace evidence repair

The smallest bounded repair is acceptance infrastructure only:

- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — tests first require routing-trace
  evidence, fail-closed behavior, and non-disclosure of raw header values;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — new pure helper
  `tests/helpers/transaction-edge-routing-evidence-8d.mjs`;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

The helper only inspects allowlisted request-routing headers in memory:
`x-deno-execution-id` and `cf-ray`, with optional `x-sb-edge-region` summary. It
requires exactly eight response samples and at least two distinct values from one
strong routing-trace header. If no such evidence exists it fails closed with
`8D_EDGE_WORKER_TRACE_EVIDENCE_MISSING`.

Raw header values are never returned or logged. Receipts record only nonsecret
summary fields such as selected header name, sample count, number of distinct
routing traces, and region-count summary. Both prepare and cancel phases must have
`distinctRoutingTraces >= 2` before acceptance can continue.

This repair does **not** claim that distinct routing traces alone prove distinct
Deno isolates. It implements exactly the smallest bounded evidence requested by
the first independent reviewer so the reviewer can adjudicate it again. It changes
no Edge function, migration/schema, public MCP/runtime, extension, signing,
pairing, protocol, OAuth semantics, or browser authority.

Exact documentation head `e8b68b31e50220bd4591dae6c4713e7db4b11af3`
received CircleCI pipeline #42 SUCCESS and Vercel SUCCESS.

## 2026-09-16 independent routing-evidence re-review

The same independent Jules reviewer re-reviewed exact head
`e8b68b31e50220bd4591dae6c4713e7db4b11af3`, explicitly bound CircleCI #42
SUCCESS/Vercel SUCCESS, inspected the routing-evidence diff, adjudicated header
semantics, and reported 321 local tests passing. The final verdict remained
**CONDITIONAL PASS**.

The reviewer found the repair safe and bounded, but concluded it does **not**
close the frozen "multiple real Edge workers" condition:

- `x-deno-execution-id` demonstrates distinct hosted Edge function executions,
  not a stable worker-process/V8-isolate identity;
- `cf-ray` demonstrates distinct Cloudflare request/routing traces, not backend
  Deno worker/isolate identity;
- therefore `distinctCount >= 2` is valid evidence that separate real requests /
  executions reached the hosted Edge path, but is not proof that distinct workers
  or isolates handled them.

The reviewer explicitly did **not** authorize the live concurrency probe. Its
suggested smallest remaining resolution was a formal governance clarification that
8 simultaneous authenticated requests with distinct execution traces plus exact
1-winner/7-replay convergence are accepted as the operational interpretation of
"multiple real Edge workers/requests".

That suggestion is **not applied automatically**. The current acceptance wording
is frozen and no project-lead/user decision has authorized weakening or
reinterpreting it. Writer self-approval is not sufficient. Until governance is
explicitly changed or stronger bounded evidence of actual worker/isolate diversity
is found and independently accepted, `RUN_8D_EDGE_CONCURRENCY.cmd` remains
blocked.

## Exact next sequence

1. Require exact-head CI SUCCESS for the documentation head that records this
   re-review result.
2. Do **not** run `RUN_8D_EDGE_CONCURRENCY.cmd`; the independent verdict is still
   CONDITIONAL PASS.
3. Do not silently amend the frozen requirement. The next substantive decision is
   either:
   - obtain explicit project-lead/user governance approval to redefine the
     acceptance phrase operationally as reviewer suggested; or
   - find a bounded, non-invasive source of actual worker/isolate identity or
     equivalent evidence and have it independently reviewed.
4. Any temporary static Edge master enablement remains prohibited until a future
   independent PASS authorizes the live probe and the master-state procedure is
   explicitly reviewed.
5. After any future reviewed live PASS, re-query policy/operator/host and every
   synthetic table for OFF/unowned/zero cleanup.
6. Continue only remaining 8D crypto/authenticated cross-tenant/session negatives
   and unresolved quantitative evidence, then advisor reconciliation.
7. Write final `docs/milestone-8-checkpoint-8d-acceptance.md` and obtain final
   independent 8D audit PASS.
8. Only final 8D PASS permits 8E.

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
