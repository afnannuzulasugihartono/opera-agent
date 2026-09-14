# Opera Agent next-session handoff

Last synchronized: 2026-09-14. Continue ONLY Checkpoint 8D. 8E has not started.

## Read before work

1. `AGENTS.md` and `SECURITY.md`.
2. `docs/project-context.md` and this handoff.
3. `docs/milestone-8-plan.md` and `docs/milestone-8-plan-codex-review.md`.
4. Accepted records 8A-8C.
5. `docs/milestone-8-checkpoint-8d-cloud-install.md` and `docs/milestone-8-checkpoint-8d-cloud-bounds.md`.
6. `docs/milestone-8-checkpoint-8d-cloud-fixture.md` and `docs/milestone-8-checkpoint-8d-cloud-controller.md`.
7. `docs/milestone-8-checkpoint-8d-operator-supervisor.md`.
8. **Latest:** `docs/milestone-8-checkpoint-8d-chat-readiness.md`.

Inspect the current worktree/remote before editing. Repository:
`afnannuzulasugihartono/opera-agent`; branch `feat/semantic-runtime-1.6.0`.
Use one active writer only.

## Current boundary

8A-8C are accepted. 8D remains **IN PROGRESS**. 8E has not started.

The local implementation remainder that was previously missing is now present:

- durable fixed-project operator/supervisor;
- fixed Supabase Management acceptance backend;
- exact opt-in live/recovery runner;
- cleanup-order fail-closed hardening;
- 180000 ms ownership window for the bounded live runner;
- transaction encryption-key preflight validation and key-byte zeroing.

Do **not** repeat implementation of a production operator adapter. That work is no
longer the next task.

## Latest code candidate and CI

Latest code candidate before documentation closeout:

`0bc958eb782de17b22b2c19081c5f85e908ccc7a`

Exact-head GitHub Actions run `34796100802` completed SUCCESS:

- unit/static PASS;
- Playwright install PASS;
- Chromium extension regression PASS.

Documentation synchronization commits follow that code candidate. Verify the new
branch HEAD and its exact-head CI before doing any further work; do not infer the
final docs-head CI from this file.

## Production read-only state reverified

Fresh read-only Supabase checks on 2026-09-14 showed:

- policy `OFF`;
- `legacy_gated=false`;
- `agent_commit_enabled=false`;
- all 11 8D synthetic transaction tables zero;
- `opera_agent_private.goal_heads` zero;
- all 12 candidate tables RLS enabled with no client policies;
- reviewed candidate routines deny `anon` and `authenticated` execute authority;
- migration `20260913143306_transaction_journal_8d_dark` applied.

Edge `opera-agent-transactions-8d` is ACTIVE, currently deployment version 6,
`verify_jwt=true`, and has exact deployed bundle SHA-256
`bad0ae493209891e45bc90a11d91ef85dac72022f70f7aaf8ba9e8152c822769`, matching the
fixed backend integrity pin. Treat exact bundle hash, not deployment version number,
as the integrity fence.

No production mutation was performed during this read-only revalidation.

## Fixed Management acceptance backend

File: `tests/helpers/transaction-cloud-management-backend-8d.mjs`.

The backend pins project `nenmkmtvjremqphfqnfw`, existing OAuth client/callback,
Management origin, Edge slug/hash, host flag, transaction-key secret name, and
fixed parameterized SQL only. It exposes no arbitrary SQL, URL, secret-name,
shell, raw-CDP, JavaScript, generic-RPC, model, or page surface.

It verifies exact server Auth session + user + OAuth client before insert-only
fixture provisioning, uses existing ledger crypto only in memory, validates the
transaction host key through the 32-byte decoder during preflight, and zeroes
decoded key bytes. Secrets/bearers are not printed or persisted by the backend.

## Durable operator/supervisor

File: `tests/helpers/transaction-cloud-operator-8d.mjs`.

It provides:

- exclusive global-control lease;
- durable nonsecret dirty manifest with exact cleanup IDs + phase;
- live-PID split-brain fencing;
- post-acquire manifest recheck;
- phase machine `OWNED -> INSTALLED -> SEALED -> HOST_ENABLED -> DARK -> CLEANING`;
- exact session-before-insert and ledger-scope checks;
- quiescent abort behavior;
- lost-reply evidence;
- dead-owner recovery;
- control-plane restoration before cleanup;
- clean completion only after host false, policy OFF, exact-owned/payload rows zero, agent commit false, legacy gate false.

PID reuse can conservatively keep a stale expired lease BUSY when an unrelated live
process has reused the PID. This is a fail-closed availability limitation, not a
split-brain or authority bypass.

## Hosted controller and cleanup hardening

File: `tests/helpers/transaction-cloud-controller-8d.mjs`.

Sequence:

`preflight -> signed SDK identity -> ownership -> session binding -> insert-only fixture -> ledger seal -> host enable -> DARK -> prepare/replay/status/cancel/replay/status -> cancelled payload check -> host disable -> OFF -> exact cleanup -> verify clean`.

Critical latest fix: normal cleanup now refuses row deletion whenever host disable
or OFF restoration fails or is ambiguous. It leaves dirty durable ownership for
recovery and returns `CLOUD_CLEANUP_FAILED`. Deterministic tests cover both control
failure cases.

Database `assert_dark()` acquires a share lock on the singleton policy row for
mutating candidate RPCs; restoring OFF updates that same row. Therefore successful
OFF restoration waits behind already-admitted database mutation transactions and
acts as the database quiescence fence before exact-owned cleanup.

## Live/recovery runner

File: `tests/cloud/transaction-cloud-acceptance-8d.mjs`.

- explicit opt-in only;
- SDK pinned to `npm:@supabase/supabase-js@2.57.4`;
- no OAuth URL until production-shape preflight passes;
- fresh namespace;
- bearer/verifier remain in process memory;
- Management credential, bearer, verifier, ledger key, and payload token are not printed;
- only accept mode and exact `--recover <namespace>` mode;
- recovery mode does not require OAuth SDK/key when no dirty manifest exists;
- live-runner ownership TTL is 180000 ms.

HTTP/Edge 8D accepts only `prepare`, `status`, and `cancel`; it has no finalize,
commit, approval, or browser route. `browserDispatchAllowed` stays false.

## Writer readiness review

Record: `docs/milestone-8-checkpoint-8d-chat-readiness.md`.

The active ChatGPT writer completed a bounded code/security self-review, fresh
read-only production checks, Edge bundle reconciliation, migration verification,
RLS/function privilege verification, and advisor reconciliation.

This is **NOT** an independent audit. Do not relabel it as PASS for the governance
gate.

Fresh advisors:

- security: no ERROR; remaining WARNs are inherited legacy/public findings; private 8D no-policy tables appear as expected INFO;
- performance: no ERROR/WARN; 8D-relevant findings are INFO only, including one unindexed `runs` foreign key and unused-index notices.

## Independent audit blocker

PR #43 remains the audit vehicle and must **not be merged**.

The Codex connector explicitly reported that the account had reached its code
review usage limit. Therefore no independent verdict exists for the latest
candidate. Copilot quota failure is also not a verdict.

The active writer must not substitute its own self-review for the required
independent PASS. If no independent reviewer is available, stop at this boundary.

## Exact next meaningful 8D work

Do not implement 8E. Do not redo the fixed backend. Do not ask for a fresh OAuth
login until the audit gate is satisfied.

When an independent reviewer becomes available:

1. independently review the exact final branch SHA, including operator/supervisor, Management backend, live runner, controller, migration, Edge host, and the latest cleanup/lease/key hardening;
2. require explicit PASS before any fresh OAuth or production DARK mutation;
3. after PASS, run one fresh user-driven PKCE login with memory-only bearer and verify signed claims/user plus exact server Auth-session/OAuth-client binding;
4. run the bounded synthetic hosted DARK lifecycle with `browserDispatchAllowed=false`;
5. prove required hosted 8D cases: redelivery/collision, worker-loss/reclaim, one-shot nonce, cancel/expiry durability, rate/queue/concurrency/minute rollover, payload/retention, crypto tamper/wrong-kind/wrong-tenant, and cross-tenant/user/client rejection;
6. restore and verify host false, policy OFF, legacy gate false, agent commit false, all synthetic rows zero;
7. reconcile advisors, write final 8D acceptance/context/handoff, and only then mark 8D accepted.

If the legitimate OAuth path cannot provide the required acceptance context, stop
for a reviewed approach. Never extract a stored bearer, forge JWT/session/client
identity, change OAuth client/scope/redirect to make a test pass, add a public
enrollment bypass, or treat OAuth consent as transaction approval.

## Locked compatibility and rollback

Extension 1.6.0; protocol 1; capabilities 26; public MCP 18 unchanged schemas.
Extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`; same signing/pairing; immediate
signed rollback 1.5.2. No CRX, extension reinstall, or MCP reconnect is required by
this 8D work.

Stop after 8D. Do not begin 8E or Milestone 9 in the same continuation unless the
user explicitly requests it after 8D is accepted.
