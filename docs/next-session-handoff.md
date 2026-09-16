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
5. installed 8D migration/fence and the existing 8D acceptance helpers.

Use one active writer. Repository/CI/production evidence outranks chat summaries.
Never paste or commit Management/OAuth/signing/pairing/crypto credentials.

## Completed live evidence in the current continuation

The user completed the reviewed manual PKCE runner on Windows/Opera and received:

`8D PKCE ACCEPTANCE: PASS`

That run was at reviewed head
`80e44483f2cdba400681dc6279522d0d55d24c98`. It proved the bounded OAuth/host
acceptance path and zero browser dispatch; OAuth connection consent is not
transaction approval.

During troubleshooting, the static Edge master secret was temporarily enabled as
required by that reviewed PKCE preflight. After the run the user explicitly
restored `OPERA_AGENT_TRANSACTION_DARK_8D=false`. The available connector cannot
read its plaintext value, so retain that user action as the static-master
restoration evidence; do not silently enable it for later probes.

Subsequent fixed/read-only and rollback-bounded production checks observed:

- policy `OFF`;
- `legacy_gated=false`;
- `agent_commit_enabled=false`;
- operator owner/namespace null;
- DB `host_enabled=false`;
- all 8D synthetic transaction rows zero;
- synthetic `goal_heads` zero;
- ordinary-role mutation/execute grants for the 8D private boundary zero;
- direct private mutation denial for `anon` and `authenticated`;
- database-level cross-tenant denial/replay/idempotency/bounds/minute-rollover
  probes passing and rolling back cleanly;
- security advisor findings for 8D private RLS tables remain INFO; no new
  checkpoint-specific security ERROR/WARN was identified in that readout.

These observations help the final evidence reconciliation but do **not** by
themselves close the remaining real process-death/authenticated-cloud gates or the
independent final audit.

## New hosted child-worker-loss acceptance candidate

The branch advanced from the prior reviewed PKCE head to
`d1fcce9cf2e44c7f15a154e3cee32a5e56d06377`, which added a native minute-rollover
regression and the current acceptance procedure.

This continuation then implemented the previously missing **real child-process
death against hosted Supabase DB** acceptance candidate, tests first:

- `d6ac1ec8395293536a7e8d7fb461e62df06afde6` — test contract requiring a
  bounded/recoverable child-worker-loss runner;
- `c04f086f029d4745f29bfcfb7f8a003b7d122188` —
  `tests/cloud/transaction-worker-loss-8d.mjs`;
- `0deb03db0df86929a846ec96ac1b99772d6156f3` — test contract for a one-click
  Windows launcher;
- `fefe2cbe8c5c51d55e20833ea8249364df0d59b1` —
  `scripts/run-8d-worker-loss.ps1`;
- `8b621451e5c41b6a49c081f0b98079430f263208` —
  `RUN_8D_WORKER_LOSS.cmd`;
- subsequent documentation commits synchronize project context/handoff only.

### What the candidate does

It is test/acceptance infrastructure only, not extension/MCP/Edge runtime. It:

- uses only the existing scoped Management bearer from environment/DPAPI;
- targets the fixed production project and fixed SQL only;
- requires clean `OFF`, unowned, zero-synthetic state before mutation;
- acquires the reviewed server operator epoch fence;
- creates only a deterministic synthetic principal/transaction;
- temporarily sets the fenced **database** host flag + policy DARK while the
  static Edge master remains false;
- launches a real child Deno process;
- the child prepares, claims lease epoch 1, reaches `AWAITING_APPROVAL`, installs
  an unconsumed synthetic nonce/approval, emits a nonsecret armed receipt, and
  exits intentionally with sentinel code 23 without cleanup;
- the parent verifies the lease was still live at child death, waits for natural
  ~30-second lease expiry, reclaims as a second worker at lease epoch 2, proves a
  stale epoch-1 transition is rejected, finalizes once, exact-redelivers once,
  verifies nonce one-shot + one commit slot + one rate debit, then cancels;
- `finally` restores host false + policy OFF, uses fenced exact cleanup, releases
  the server fence, and verifies clean state;
- if cleanup cannot complete it prints only a nonsecret recovery namespace/
  recovery command;
- exposes no OAuth flow, browser primitive, extension/MCP mutation, public grant,
  generic user SQL, or secret output. `browserDispatchAllowed` stays false.

The Windows launcher requires PowerShell 7, refuses a dirty worktree, safely
fast-forwards `feat/semantic-runtime-1.6.0`, decrypts the already-stored Management
token using Windows DPAPI, runs the probe, and clears the process environment.
It does **not** enable `OPERA_AGENT_TRANSACTION_DARK_8D` and does not need a
publishable key.

Focused source/parser tests for the candidate passed 2/2 in the writer's isolated
syntax/test check. This is not full repository acceptance.

## Exact next step

**DO NOT RUN THE LIVE WORKER-LOSS PROBE YET.**

1. Verify exact-head CircleCI at the latest branch commit. It must be SUCCESS.
2. Obtain an **independent review PASS** of the new worker-loss candidate and
   launcher. Review must explicitly check fixed target/SQL, server-fence coverage,
   real child death, natural lease expiry, stale lease-epoch rejection, nonce
   durability, exact-redelivery single slot/debit, fail-closed cleanup/recovery,
   no browser/OAuth authority, no secret leakage, and no public runtime changes.
3. Only after both gates are green, have the user run exactly one normal probe by
   double-clicking `RUN_8D_WORKER_LOSS.cmd` (or invoking the same file from a
   terminal). Expected duration is roughly 30-45 seconds.
4. Expected terminal result is `8D WORKER-LOSS ACCEPTANCE: PASS` plus a JSON
   receipt showing child death, reclaim, stale epoch rejection, nonce one-shot,
   exact redelivery, one commit slot, browser dispatch false, and clean state.
5. If a recovery namespace is printed, do not rerun normal mode. Use:
   `RUN_8D_WORKER_LOSS.cmd -RecoverNamespace <uuid>` after the stale server fence
   can expire.
6. After live PASS, re-query final production OFF/zero state and continue the
   remaining authenticated cross-session/real Edge concurrency/crypto negative
   matrix, advisor reconciliation, final acceptance record, and independent final
   8D audit.
7. Only an independent final **PASS** permits 8E.

## Important scope distinctions

- The earlier database-level reclaim simulation is useful evidence but is not the
  new real child-process death gate.
- The new candidate kills a real local child worker while durable state lives in
  the hosted Supabase DB. Do not relabel it as an Edge-isolate termination.
- Static master `false` means the public Edge transaction host stays killed even
  while the bounded probe temporarily exercises the private fenced DB primitives.
- No browser dispatch exists in 8D; consequential browser execution remains later
  checkpoint work.
- The separate persistent MCP reliability investigation remains
  `PERSISTENT_MCP_BLOCKED` and must not be folded into this 8D worker-loss gate.

## Final 8D acceptance still requires

Before 8D can close, reconcile and record all required evidence from
`docs/milestone-8-plan.md`, including direct/private denial, cross-tenant
isolation, exact redelivery/collision, real worker death/reclaim, nonce durability,
cancel/expiry after worker loss, quantitative/rate/concurrency/payload/retention
bounds, crypto tamper/wrong-kind/wrong-tenant failures, invalid policy
combinations, authenticated cloud negatives, final advisors, exact-head CI,
production OFF/zero cleanup, acceptance documentation, and independent final
review.

Do not start 8E while any one of those required gates is open.