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
contract, signing, pairing, protocol, or browser authority.

Important unresolved review question: eight simultaneous calls to the real Edge
endpoint demonstrate a hosted concurrency race, but the current runtime exposes no
stable per-isolate identifier. Therefore this candidate does not independently
prove that eight distinct Edge isolates/workers handled the requests. The
independent reviewer must explicitly decide whether this is sufficient for the
frozen plan phrase "multiple real Edge workers". Do not overclaim the evidence and
do not add runtime instrumentation merely to force a PASS without review.

## First concurrency launch attempt and repair

CircleCI pipeline `/33` reached SUCCESS for documentation head
`cb75febf873542795e5d15bee96ad17dd97b32d1`. Before the required independent
review was completed, the user ran `RUN_8D_EDGE_CONCURRENCY.cmd` once from the
canonical Windows checkout.

The launcher synchronized to `cb75feb...`, loaded the locally DPAPI-encrypted
Management token, and then Deno stopped during module resolution with:

`Could not find a matching package for 'npm:@supabase/supabase-js@2.57.4' in the node_modules directory.`

No OAuth URL was emitted, no recovery namespace was emitted, and the acceptance
runner's `main()` did not execute. The repository has a root `package.json` and no
root `deno.json`; current Deno therefore defaults npm resolution to manual
`node_modules` mode. The pinned Supabase SDK is intentionally not an application
`package.json` dependency, so the launcher needed an explicit Deno npm-resolution
mode.

Fresh read-only Supabase checks after this failure showed the production boundary
still clean: policy `OFF`, `legacy_gated=false`, `agent_commit_enabled=false`,
operator/namespace unowned, `host_enabled=false`, `lease_until=null`, epoch `2`,
all synthetic 8D tables zero, and `opera_agent_private.goal_heads` zero. No
recovery command is needed.

The repair was tests-first:

- `f98964f11dc9c6e9651cce203d8f02154f3d8be1` — regression test requiring
  explicit automatic Deno npm resolution and forbidding package-manager install
  commands in the launcher;
- `f493aed0afa17c3833c79f8f82dcddd51c656152` — launcher-only fix adding
  `--node-modules-dir=auto` to the existing `deno run` command.

The pinned SDK import remains `npm:@supabase/supabase-js@2.57.4`. The repair does
not run `deno install`, does not modify `package.json`, and changes no Edge code,
schema/migration, OAuth semantics, MCP/extension contract, signing/pairing, or
browser authority.

At the implementation head `f493aed...`, CircleCI pipeline `/35` is `pending` and
Vercel is green. Documentation commits after that implementation also require
exact-head CI SUCCESS. The failed attempt is not acceptance evidence.

## Exact next step

**DO NOT RERUN `RUN_8D_EDGE_CONCURRENCY.cmd` YET.**

1. Verify CircleCI SUCCESS for the latest exact branch head after this handoff.
2. Obtain an independent review PASS of the concurrency runner, launcher, and the
   Deno dependency-resolution repair. The review must explicitly check:
   - fixed project and exact Edge endpoint;
   - authenticated user/session path rather than forged identity;
   - bounded eight-way `prepare` and `cancel` races;
   - exactly-one winner / replay semantics;
   - fenced operator ownership and fail-closed recovery/cleanup;
   - no browser authority or public runtime/schema change;
   - no credential leakage;
   - PowerShell/Deno CLI correctness, including the scoped
     `--node-modules-dir=auto` repair;
   - whether the evidence actually satisfies "multiple real Edge workers" or
     needs additional bounded evidence.
3. Only after both exact-head CI and independent review are green may the user run
   one fresh normal concurrency probe. Do not silently enable the static Edge
   master switch; any required master-state change must be explicit and reviewed.
4. If a later run prints a recovery namespace, do not rerun normal mode; recover
   only that namespace using the reviewed launcher path.
5. After any reviewed live PASS, re-query policy/operator/host and every synthetic
   table to prove final OFF/unowned/zero cleanup.
6. Continue only the still-open 8D matrix: real installed-key crypto tamper
   negatives, authenticated cross-tenant/session negatives, and any unresolved
   quantitative evidence; then reconcile advisors.
7. Write the final `docs/milestone-8-checkpoint-8d-acceptance.md` with exact head,
   CI, probe receipts, advisor reconciliation, and final clean-state evidence.
8. Obtain the independent final 8D audit. Only verdict **PASS** permits 8E.

## User-local note

Before the worker-loss probe, two accidental untracked 8E files in the canonical
Windows checkout were preserved in a Git stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or build on that stash while 8D remains open.

The user's canonical checkout was at `cb75feb...` when the failed concurrency
launch occurred. It is now behind the repaired remote branch. Do not ask the user
to pull or rerun the launcher until the CI and independent-review gates above are
satisfied.

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
