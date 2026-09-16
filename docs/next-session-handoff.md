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

The first user launch at `cb75feb...` failed before runner execution because Deno
could not resolve pinned `npm:@supabase/supabase-js@2.57.4`. No OAuth or production
fixture mutation occurred. Tests-first repair:

- `f98964f11dc9c6e9651cce203d8f02154f3d8be1` — regression test;
- `f493aed0afa17c3833c79f8f82dcddd51c656152` — launcher adds
  `--node-modules-dir=auto` without package.json or install-command changes.

## Routing-trace evidence and independent reviews

Tests-first routing evidence commits:

- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — routing evidence contract;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — bounded helper;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

The helper requires exactly 8 response samples, inspects only allowlisted
`x-deno-execution-id` / `cf-ray` values in memory, requires at least two distinct
trace values for prepare and cancel, fails closed when missing, and emits no raw
header values.

Jules session `16177705161344454955` returned CONDITIONAL PASS twice: first at
`a5dde1e...`, then after routing evidence at exact head `e8b68b31...` with
CircleCI #42 SUCCESS. The second review correctly concluded that trace uniqueness
proves distinct real hosted requests/executions, not distinct Deno process/V8
isolate identity.

## Canonical concurrency procedure correction

After the second CONDITIONAL PASS, the writer compared the disputed procedure
against canonical `docs/milestone-8-plan.md`.

Important finding: the frozen Checkpoint 8D plan does **not** require externally
proving "multiple real Edge workers" or isolate identity. Its acceptance criteria
require worker-death reclaim plus exact rate/queue/concurrency/payload/retention
bounds, redelivery/idempotency, crypto/tenant/policy/advisor/cleanup guarantees.

The phrase "Concurrent cloud races (multiple real Edge workers)" existed only in
the later `docs/milestone-8-checkpoint-8d-acceptance-procedure.md`. It was an
over-specific procedural shorthand that accidentally exceeded provider
observability and the reviewed plan.

Commit `6f470bb9626aec5a0d60c1176af471f89558cbed` corrects that procedure without
changing the milestone plan. Hosted concurrency acceptance now means eight
simultaneous authenticated requests per raced operation against the real endpoint,
distinct hosted request/execution traces, exact 1-winner/7-replay convergence,
bounded responses, fail-closed fencing/recovery, and browser dispatch false.

The procedure explicitly states that this does **not** prove or claim N distinct
worker processes or V8 isolates. This is a canonical-plan alignment correction,
not a waiver of the milestone's security requirements.

Durable context commit after the procedure correction:
`5a10a955f4d9bd70512312f36dfc6c40077b3520`.

## Exact next step

**DO NOT RUN `RUN_8D_EDGE_CONCURRENCY.cmd` YET.**

1. Require CircleCI and Vercel SUCCESS for the latest exact branch head after this
   handoff.
2. Obtain a fresh independent Jules re-review bound to that exact head. Ask the
   reviewer to compare the corrected procedure directly with canonical
   `docs/milestone-8-plan.md` and decide whether the earlier blocker was a
   procedure over-specification rather than a missing canonical acceptance proof.
3. Reviewer must explicitly confirm that the correction does not weaken actual 8D
   acceptance and that no worker/isolate claim is made. Only verdict **PASS**
   authorizes exactly one fresh live concurrency probe.
4. Before the live probe, any required temporary static Edge master enable/restore
   arrangement must be explicit and reviewed. Never silently change production
   secrets/configuration.
5. If the live run emits a recovery namespace, do not blindly rerun normal mode;
   use only the reviewed recovery path for that namespace.
6. After reviewed live PASS, verify production OFF/unowned/zero immediately.
7. Continue only remaining 8D real-key crypto tamper negatives, authenticated
   cross-tenant/session negatives, unresolved quantitative/rate evidence, and
   advisor reconciliation.
8. Write final `docs/milestone-8-checkpoint-8d-acceptance.md`, obtain final
   independent 8D audit PASS, and only then permit 8E.

## User-local state

Two accidental untracked 8E files remain preserved in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash while 8D remains open.

The user should not pull or rerun the concurrency launcher until exact-head CI and
fresh independent review are both PASS.
