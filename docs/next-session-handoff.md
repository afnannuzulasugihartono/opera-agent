# Opera Agent next-session handoff

Last synchronized: 2026-09-16. Continue **ONLY Checkpoint 8D**. 8E has not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`

Branch: `feat/semantic-runtime-1.6.0`

Accepted release remains extension `1.6.0`, protocol `1`, 26 browser capabilities,
18 public MCP tools, unchanged signing/pairing, and signed rollback `1.5.2`.
Milestone 8 checkpoints 8A-8C are accepted. 8D is **IN PROGRESS**. Nothing in
this handoff permits 8E.

Read first:

1. `AGENTS.md` and `SECURITY.md`;
2. `docs/project-context.md` and this handoff;
3. `docs/milestone-8-plan.md`;
4. `docs/milestone-8-checkpoint-8d-acceptance-procedure.md`;
5. installed 8D migration/fence and current 8D acceptance helpers.

Use one active writer. Repository/CI/production evidence outranks chat summaries.
Never paste or commit Management/OAuth/signing/pairing/crypto credentials.

## Completed live evidence

### Manual PKCE acceptance

The user previously completed the reviewed Windows/Opera PKCE acceptance at
`80e44483f2cdba400681dc6279522d0d55d24c98` and received
`8D PKCE ACCEPTANCE: PASS`. The path verified authenticated session binding while
keeping `browserDispatchAllowed=false`. OAuth consent is connection authorization,
not transaction approval. The static Edge master switch was restored to `false`
afterward and must not be silently enabled by later probes.

### Hosted child-worker-loss acceptance

The user synchronized the canonical checkout `D:\GitHub\opera-agent` to reviewed
head `8e3c6cd6aef41d8d1fb5a46189b193e34212c377` and ran exactly one
`RUN_8D_WORKER_LOSS.cmd` probe.

Terminal verdict: `8D WORKER-LOSS ACCEPTANCE: PASS`.

The nonsecret receipt proved child death, reclaim, stale-epoch rejection,
one-shot nonce consumption, exact redelivery, one commit slot,
`browserDispatchAllowed=false`, clean cleanup, and no secret output.

A fresh read-only production verification immediately after the probe showed:

- policy `OFF`;
- `legacy_gated=false`;
- `agent_commit_enabled=false`;
- operator owner and namespace null;
- DB `host_enabled=false`;
- `lease_until=null`;
- epoch `2`;
- every synthetic 8D transaction table zero rows;
- `opera_agent_private.goal_heads` zero rows.

This closes the hosted child-worker-loss/reclaim gate. It is a real local child
process death against durable hosted Supabase state; do not call it an Edge-isolate
termination test.

## Current production facts

Supabase project `opera-agent` / `nenmkmtvjremqphfqnfw` is healthy. Installed 8D
migrations include `20260913143306_transaction_journal_8d_dark` and
`20260914043049_transaction_operator_fence_8d`.

The isolated `opera-agent-transactions-8d` function was most recently observed
ACTIVE, JWT-required, production version `20`, with reviewed bundle hash
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
Historical docs may mention earlier version numbers; current production inspection
and the bundle hash outrank those labels.

Opera Agent browser connectivity was re-detected through Supabase, not Opera
Browser Connector: paired `Opera Agent` 1.6.0, protocol 1, 26 capabilities.

## Current writer work: real Edge concurrency candidate

After worker-loss PASS and final OFF/zero verification, the next frozen acceptance
procedure sub-gate is concurrent cloud races against the real Edge endpoint.

The current writer added test/acceptance infrastructure only, tests first:

- `610b5f0c818a45855cb9add118ae32b265ee1554` —
  `tests/transaction-edge-concurrency-runner-8d.test.mjs` contract;
- `59d13b3d790aa707c29211b2696231b0230ebd0b` —
  `tests/cloud/transaction-edge-concurrency-8d.mjs`;
- `12d7e5bfdb22fbe8c0dee82f7a23fb72bd03e27a` —
  `scripts/run-8d-edge-concurrency.ps1`;
- `ed46f9500394ea9a3893f02be6a2140215b32061` —
  `RUN_8D_EDGE_CONCURRENCY.cmd`.

The candidate reuses the existing PKCE acceptance controller and existing fenced
operator/cleanup machinery. On the first authenticated `prepare` and first
`cancel`, it sends eight simultaneous POST requests to the fixed deployed 8D Edge
endpoint, requiring exactly one non-replay winner and seven exact metadata
replays. It preserves bounded response sizes, fixed target, recovery semantics,
`browserDispatchAllowed=false`, and no secret printing.

It does **not** change Edge runtime, migrations/schema, MCP, extension, public
contract, signing, pairing, protocol, or browser authority. No live concurrency
probe has been run.

Important unresolved review question: eight simultaneous calls to the real Edge
endpoint demonstrate a hosted concurrency race, but the current runtime exposes no
stable per-isolate identifier. Therefore this candidate does not independently
prove that eight distinct Edge isolates/workers handled the requests. The
independent reviewer must explicitly decide whether this is sufficient for the
frozen plan phrase "multiple real Edge workers". Do not overclaim the evidence and
do not add runtime instrumentation merely to force a PASS without review.

At the writer implementation head `ed46f9500394ea9a3893f02be6a2140215b32061`,
CircleCI pipeline `/32` was still `pending`; Vercel was `success`. The final docs
commit itself must also receive exact-head CI SUCCESS before any live probe.

## Exact next step

**DO NOT RUN `RUN_8D_EDGE_CONCURRENCY.cmd` YET.**

1. Verify exact-head CircleCI for the latest branch head. Require SUCCESS.
2. Obtain an independent review PASS of the concurrency runner, test contract, and
   launcher. Review must explicitly check:
   - fixed project and exact Edge endpoint;
   - authenticated user/session path rather than forged identity;
   - bounded eight-way `prepare` and `cancel` races;
   - exactly-one winner / replay semantics;
   - fenced operator ownership and fail-closed recovery/cleanup;
   - no browser authority or public runtime/schema change;
   - no credential leakage;
   - PowerShell/CLI correctness;
   - whether the evidence actually satisfies "multiple real Edge workers" or
     needs additional bounded evidence.
3. Only after both CI and independent review are green may a live concurrency
   probe be considered. Do not silently enable the static Edge master switch; any
   required master-state change must be explicit and reviewed.
4. After any reviewed live PASS, re-query policy/operator/host and every synthetic
   table to prove final OFF/unowned/zero cleanup.
5. Continue only the still-open 8D matrix: real installed-key crypto tamper
   negatives, authenticated cross-tenant/session negatives, and any unresolved
   quantitative evidence; then reconcile advisors.
6. Write the final `docs/milestone-8-checkpoint-8d-acceptance.md` with exact head,
   CI, probe receipts, advisor reconciliation, and final clean-state evidence.
7. Obtain the independent final 8D audit. Only verdict **PASS** permits 8E.

## User-local note

Before the worker-loss probe, two accidental untracked 8E files in the canonical
Windows checkout were preserved in a Git stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash while 8D remains open.

The user's canonical checkout was clean and aligned at `8e3c6cd...` before the
new remote concurrency commits. It will be behind the branch after this writer
session. Do not ask the user to pull/run the concurrency launcher until the CI and
independent-review gates above are satisfied.

## Final 8D acceptance still requires

Before 8D can close, reconcile all evidence required by
`docs/milestone-8-plan.md`, including direct/private denial, cross-tenant
isolation, exact redelivery/collision, real worker death/reclaim, nonce durability,
cancel/expiry after worker loss, quantitative/rate/concurrency/payload/retention
bounds, crypto tamper/wrong-kind/wrong-tenant failures, invalid policy
combinations, authenticated cloud negatives, final advisors, exact-head CI,
production OFF/zero cleanup, acceptance documentation, and independent final
review.

Do not start 8E while any required 8D gate is open.
