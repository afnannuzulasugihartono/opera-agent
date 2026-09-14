# Opera Agent next-session handoff

Last synchronized: 2026-09-14. Continue ONLY Checkpoint 8D. 8E has not started.

## Latest request: repair remaining 8D audit findings

The other writer is closed. This session repaired candidate fcbec894's local
ownership race, release clean-state gap, and recovery integrity gap. Read
`docs/milestone-8-checkpoint-8d-audit-repair.md` before the historical records below.
Local Node suite 314/314, focused gates 46/46, static 1.6.0/26, Windows stress
zero dual owners/150 and native release regression PASS. This is implementation
verification, not independent review or new CI/live acceptance.
Next: independent review of the exact committed repair diff, including the new
native PostgreSQL gate (`OPERA_PG_BIN`), permanent retirement witness semantics,
exclusive release owned-row check, and actual recovery bundle verification.
No production mutation/deployment/OAuth has occurred; zero bundle pin remains.
Do not deploy or start cloud acceptance until independent review passes; do not
start 8E. Prior reliability diagnostics are preserved as a separate side task.

## Latest user-requested side investigation

An earlier user request is persistent MCP availability, separate from transaction
ownership repair. Read `docs/mcp-reliability-investigation.md` before continuing
that request. Phase 1/2 evidence and read-only diagnostics are present; recovery
implementation/manual acceptance are NOT complete. Do not claim a proven host
root cause from a missing tool namespace or a successful public health response.
Local verification: focused diagnostic/MCP 17/17, full 310/310 zero skips,
static 1.6.0/26 and whitespace PASS. This is not new CI or real-host acceptance.
Use `node scripts/mcp-connection-diagnostics.mjs`; without an explicitly supplied
legitimate bearer it intentionally leaves authenticated discovery UNTESTED.
Never obtain credentials by extracting stored sessions or pasting them into chat.
Next: authenticated direct discovery plus same-outage host diagnostics, and a
separate reviewed reliability/release subplan before changing extension bytes or
locked MCP runtime. The ownership-fence review below remains pending and production
must stay unchanged. Do not deploy, run transaction OAuth/DARK, or start 8E.

## Read before work

1. `AGENTS.md` and `SECURITY.md`.
2. `docs/project-context.md` and this handoff.
3. `docs/milestone-8-plan.md` and accepted 8A-8C records.
4. `docs/milestone-8-checkpoint-8d-cloud-install.md` and `docs/milestone-8-checkpoint-8d-cloud-bounds.md`.
5. `docs/milestone-8-checkpoint-8d-cloud-fixture.md` and `docs/milestone-8-checkpoint-8d-cloud-controller.md`.
6. `docs/milestone-8-checkpoint-8d-operator-supervisor.md` and `docs/milestone-8-checkpoint-8d-chat-readiness.md`.
7. **New review target:** `supabase/migrations/20260914031000_transaction_operator_fence_8d.sql` plus the ownership/fence tests listed below.

Repository: `afnannuzulasugihartono/opera-agent`.
Branch: `feat/semantic-runtime-1.6.0`.
Use one active writer only.

## Current boundary

8A-8C are accepted. 8D remains **IN PROGRESS**. 8E has not started.

The earlier ownership + server-side fencing candidate had green exact-head CI;
the follow-up above supersedes its review target and has local tests only so far.
This task intentionally did **not** mutate production,
run OAuth, deploy an Edge function, apply a migration, change a secret, dispatch a
browser action, or modify extension/MCP compatibility.

Stop now for independent review. Do not start 8E.

## Why this repair exists

Independent review identified two ownership failures in the previous pre-live
candidate:

1. a fresh namespace could bypass a dirty manifest belonging to another namespace
   after the local global lease expired;
2. a remote trusted mutation could outlive the dead local process and commit after
   recovery had already restored/verified clean state.

A prior cleanup-order issue was already fixed before this repair: fixture deletion
is forbidden until host disablement and policy OFF restoration both succeed.

## Test-first evidence

Initial failing test commit:

`3595f8026ad72a14e39dc48df989cad235806670`

CI run `34801030099` failed in unit/static as expected. The tests exposed global
pending-manifest admission and delayed pre-recovery mutation behavior. The delayed
mutation test's start synchronization was then made deterministic in:

`6d535cabaa257cd5f94018f67640fd95cc971900`

Regression files:

- `tests/transaction-cloud-ownership-fence-8d.test.mjs`
- `tests/transaction-cloud-server-fence-static-8d.test.mjs`

## Local ownership fix

File: `tests/helpers/transaction-cloud-operator-8d.mjs`.

The local state directory now has globally singular dirty ownership semantics:

- fresh preflight searches for any pending manifest, not only the new namespace;
- any dirty manifest blocks every fresh namespace with `8D_RECOVERY_REQUIRED`;
- more than one dirty manifest fails closed;
- ownership rechecks global pending state after local lease acquisition;
- `--recover <namespace>` must match the globally pending manifest;
- live-PID fencing remains in place.

The durable manifest remains nonsecret and keeps its existing version/shape. The
server epoch is memory-only and is not persisted there.

## Server-side fence candidate

New migration candidate:

`supabase/migrations/20260914031000_transaction_operator_fence_8d.sql`

**NOT DEPLOYED.**

It adds one service-only singleton control row with:

- monotonically increasing fence epoch;
- exact owner + namespace;
- bounded server lease;
- fenced `host_enabled` state.

Fixed service-only functions provide acquire, heartbeat, assert, host toggle,
exact cleanup, release, state read, and hosted gate read. `public`, `anon`, and
`authenticated` have no execute authority on these functions.

Fencing rule:

- trusted mutation carries owner + namespace + epoch;
- mutation asserts the epoch while holding the control row with a share lock;
- recovery takes an exclusive row lock and increments epoch before cleanup;
- therefore an old mutation either commits before takeover or observes a stale
  epoch and cannot commit after the new owner completes recovery;
- cleanup itself additionally requires current epoch, host disabled, policy OFF,
  `legacy_gated=false`, and `agent_commit_enabled=false`;
- final server-fence release is a clean-state exclusive-lock barrier before the
  local manifest/lease may be deleted.

## Operator integration

The internal backend contract now additionally requires:

- `acquireFence`
- `heartbeatFence`
- `releaseFence`

These are internal trusted-adapter methods only. The public controller/operator
surface used by the acceptance controller remains the same eleven operations, and
public MCP remains unchanged.

Normal ownership writes dirty local evidence before remote fence acquisition so a
lost acquire reply remains recoverable. Normal clean completion releases the
server fence before deleting local ownership. Recovery acquires a fresh server
epoch before restoring host/OFF/cleanup.

## Fixed Management backend integration

File: `tests/helpers/transaction-cloud-management-backend-8d.mjs`.

The backend remains fixed-project/fixed-SQL test infrastructure and has no generic
SQL, URL, secret-name, shell, code, RPC, model, or page escape hatch.

All trusted mutations now carry the exact fence:

- insert-only fixture provisioning;
- host enable/disable;
- DARK/OFF policy changes;
- cleanup;
- clean verification.

Per-run host toggling no longer writes the project secret. The existing
`OPERA_AGENT_TRANSACTION_DARK_8D` secret becomes only a static deployment/master
kill switch.

## Fenced Edge candidate

File: `supabase/functions/opera-agent-transactions-8d/index.ts`.

**NOT DEPLOYED.**

When the static master switch is enabled, each request must first receive `true`
from service-role-only `opera_tx_operator_host_gate_8d` before the transaction host
runs. The underlying candidate transaction mutations remain policy-fenced by
`assert_dark()` as well.

No finalize, transaction commit, approval, browser dispatch, or new public MCP
surface was introduced. `browserDispatchAllowed` remains false.

## Deliberate fail-closed deployment pin

Because the fenced Edge source has not been deployed, its real Supabase
`ezbr_sha256` does not exist yet. The Management backend therefore uses the exact
all-zero 64-character digest as an intentional impossible/pending pin.

This means the current production Edge can **not** accidentally pass the new live
preflight. Do not replace the sentinel by guessing a hash.

After independent PASS only:

1. deploy the reviewed fence migration and fenced Edge with the static master switch still disabled;
2. read the real deployed Edge bundle hash;
3. replace the zero sentinel with that exact hash in a pin-only change;
4. run exact-head CI and review that delta as required;
5. only then may fresh PKCE/OAuth acceptance be considered.

## Exact CI evidence

Latest implementation/static-test head before documentation commits:

`3c0ac9d677cf289c384ad3704548ba0c4e935ee7`

Exact GitHub Actions run:

`34801634178`

Result: **SUCCESS**

- unit/static PASS;
- Playwright install PASS;
- Chromium extension regression PASS.

Core implementation head `1ebd23f691b31209f837423b6a78b9c115f69283`
also completed full CI successfully.

## Production is untouched by this repair

Do not confuse the review candidate with production.

Production still has the earlier installed 8D backend only:

- applied migration `20260913143306_transaction_journal_8d_dark.sql`;
- previously observed Edge deployment version 6 / `verify_jwt=true`;
- previously observed old bundle SHA `bad0ae493209891e45bc90a11d91ef85dac72022f70f7aaf8ba9e8152c822769`;
- prior read-only closeout state host master false, policy OFF, legacy gate false,
  agent commit false, synthetic transaction rows zero.

This repair did not reconfigure or deploy any of those resources.

## Locked compatibility

Unchanged:

- extension `1.6.0`;
- protocol `1`;
- extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`;
- 26 browser capabilities;
- 18 public MCP tools with unchanged schemas;
- signing identity and pairing;
- immediate signed rollback `1.5.2`.

Chromium regression passed on the exact ownership/fence implementation head.

## Exact next step

**REVIEW ONLY.**

Independently audit the exact branch after the documentation synchronization,
with focus on:

- global dirty-manifest singularity;
- local lease/PID fencing interaction with server lease;
- epoch takeover and row-lock ordering;
- delayed pre-recovery insert/host/DARK/OFF/cleanup mutations;
- lost acquire/release replies;
- server lease expiry during an in-flight transaction;
- cleanup/release clean-state gates;
- service-role-only grants/RLS;
- Edge host-gate race against policy `assert_dark()` quiescence;
- absence of public/model/page authority paths;
- deliberate zero bundle-pin fail-closed behavior.

Do not deploy, run OAuth, enable DARK, mutate production, merge an audit-only PR,
or start 8E until the required independent review explicitly permits the next
production boundary.
