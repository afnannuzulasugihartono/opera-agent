# Opera Agent next-session handoff

Last synchronized: 2026-09-14. Continue ONLY Checkpoint 8D. 8E has not started.

## Read before work

1. `AGENTS.md` and `SECURITY.md`.
2. `docs/project-context.md` and this handoff.
3. `docs/milestone-8-plan.md` and `docs/milestone-8-plan-codex-review.md`.
4. Accepted records 8A-8C.
5. `docs/milestone-8-checkpoint-8d-cloud-install.md` and `docs/milestone-8-checkpoint-8d-cloud-bounds.md`.
6. `docs/milestone-8-checkpoint-8d-cloud-fixture.md`.
7. `docs/milestone-8-checkpoint-8d-cloud-controller.md`.
8. **Latest:** `docs/milestone-8-checkpoint-8d-operator-supervisor.md`.

Inspect the current worktree/remote before editing. Repository:
`afnannuzulasugihartono/opera-agent`; branch `feat/semantic-runtime-1.6.0`.
Use one active writer only.

## Current boundary

8A-8C are accepted. 8D remains **IN PROGRESS**. 8E has not started.

The isolated 8D backend was previously installed with explicit permission and
reviewed candidate evidence. Historical closeout state was host flag false,
transaction policy OFF, `legacy_gated=false`, `agent_commit_enabled=false`,
synthetic data rows zero, and M7 VM disabled/empty. Migration
`20260913143306_transaction_journal_8d_dark.sql` and Edge
`opera-agent-transactions-8d` v1 (`verify_jwt=true`) remain the installed shape.
Those production values were NOT freshly queried by the latest local
operator/supervisor work; verify them before any future live probe.

Prior local hosted-acceptance controller:
`tests/helpers/transaction-cloud-controller-8d.mjs`.
It sequences preflight -> SDK snapshot -> ownership -> install/session binding ->
ledger seal -> host/DARK -> prepare/replay/status/cancel/replay/status -> cancelled
payload check -> independent OFF/exact cleanup/verify against trusted injected
adapters. Prior focused 36/36 and full 275/275 passed; exact-head CI run
`34789183097` at `85ec1befef26c295f301aa253f938b47ed62ffa3` succeeded including
static and Chromium. It did not contain durable hard-death ownership/recovery.

## Latest local 8D operator/supervisor candidate

Files:

- `tests/helpers/transaction-cloud-operator-8d.mjs`
- `tests/transaction-cloud-operator-8d.test.mjs`
- `docs/milestone-8-checkpoint-8d-operator-supervisor.md`

This test-only boundary is fixed to project `nenmkmtvjremqphfqnfw`, the existing
OAuth client, and `http://127.0.0.1:6276/oauth/callback`. Public/operator surface is
only the controller's eleven named methods; there is no generic SQL/shell/command/
URL/model/page operation and no new public endpoint.

It adds:

- one exclusive global-control lease;
- one durable nonsecret dirty ownership manifest containing only exact tenant/actor/goal/transaction cleanup IDs + phase;
- live-PID fencing so TTL expiry alone cannot create split-brain;
- post-acquire manifest recheck so an earlier preflight cannot overwrite a crashed peer;
- phase machine `OWNED -> INSTALLED -> SEALED -> HOST_ENABLED -> DARK -> CLEANING`;
- exact-scope session-before-insert contract and insert-only acknowledgement;
- exact tenant/goal ledger-seal scope, with sealed token kept out of manifest;
- cooperative abort/quiescence with no Promise.race late-mutation window;
- durable lost-reply evidence;
- stale/dead-parent recovery that re-pins target, disables host, sets OFF, and only then performs exact cleanup;
- failed control-plane recovery refuses row deletion and keeps dirty recovery evidence;
- clean completion only when host false, mode OFF, exact-owned rows/payload zero, agent commit false, legacy gate false.

Writer-local focused run before commit: **14/14 PASS, zero skips**. It includes a
real spawned child process that exits without cleanup, lost insert reply,
abort/quiescence, failed host-disable recovery, live-PID lease fencing, and the
post-lease manifest race.

Hashes:

- helper: `f34dc7b1a4d5408087980b95968bd74432621dc64be93fdbb46c1a3270ce08b9`
- focused test: `38ff23f3c22a61369ef5c121e8080354f9028eebac8a3c29688da7bc7fe0d872`

The helper is still a LOCAL operator/supervisor with an injected backend. It does
**not** itself resolve production credentials or prove actual cloud Auth-session,
ledger crypto, SQL provisioning, host control, or crash recovery. No fresh OAuth,
production query/mutation, host enablement, policy change, deployment, key access,
browser action, extension/MCP/signing/pairing/CRX/release change occurred in this
unit.

Standard exact-head CI for the commit containing this handoff must be verified from
GitHub artifacts. The temporary validation PR must be closed without merge after
CI. Do not infer CI PASS merely from this file.

## Exact next meaningful 8D work

**Do not immediately ask for another OAuth login.** The local remainder is now at a
clean independent-audit boundary rather than a repeated micro-audit loop.

Next:

1. Independently audit the exact operator/supervisor candidate and the proposed fixed production backend wiring. Required verdict for live continuation: PASS.
2. After PASS only, bind the injected backend to the existing separate operator credential realm and exact existing production primitives: read-only preflight, real server Auth-session/user/client membership check, insert-only fixture provisioning, existing ledger crypto sealing, host flag/DARK control, exact-owned cleanup, strict clean verification. Do not add generic SQL/CLI/RPC escape hatches.
3. Then perform one fresh manual PKCE connection login, keeping bearer/verifier only in that bounded process. Verify signed `getClaims` + `getUser` snapshot and server-side live session binding. Never extract a stored bearer.
4. Run authenticated synthetic hosted prepare/replay/status/cancel/replay/status with `dispatch=false`, then exact cleanup and OFF verification.
5. Continue remaining hosted worker-loss/reclaim/nonce durability and real cloud concurrency/quota/minute-rollover/payload/retention/crypto gates.
6. Reconcile advisors, confirm production OFF/clean, commit final 8D acceptance/context/handoff, and obtain the independent final 8D review.

If the legitimate existing OAuth route cannot provide the required acceptance
context, stop for a reviewed approach. Do not forge JWT/session/client identity,
change OAuth client/scope/redirect to make a test pass, create a new public
enrollment endpoint, or treat connection consent as transaction approval.

## Codex / independent-audit workflow

Do **not** return to the earlier pattern `small edit -> Codex -> small edit -> Codex`.
`AGENTS.md` permits ChatGPT Web to own bounded checkpoint implementation. Continue
local implementation/tests/CI with one writer; use the independent auditor at the
actual high-risk production gate and final milestone boundary.

The current operator/supervisor work must not be self-labelled independent PASS by
its writer. If Codex is unavailable, local development and exact-head CI may still
finish, but stop before fresh OAuth/live production mutation at the documented
audit boundary.

## Locked compatibility and rollback

Extension 1.6.0; protocol 1; capabilities 26; public MCP 18 unchanged schemas.
Extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`; same signing/pairing; immediate
signed rollback 1.5.2. No CRX, extension reinstall, or MCP reconnect is required by
this local 8D unit.

Stop after 8D. Do not begin 8E or Milestone 9 in the same continuation unless the
user explicitly requests it after 8D is accepted.
