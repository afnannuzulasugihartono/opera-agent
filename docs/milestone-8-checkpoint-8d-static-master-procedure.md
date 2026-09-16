# Checkpoint 8D — static master probe bracket

Date: 2026-09-16.

This document defines the bounded production-configuration arrangement required
before the single reviewed real-Edge concurrency probe. It is procedure only; it
is not live acceptance evidence and does not authorize Checkpoint 8E.

## Authority and fixed boundary

The only production configuration changed by this bracket is the existing Edge
Function secret:

- project: `nenmkmtvjremqphfqnfw` (`opera-agent`);
- secret name: `OPERA_AGENT_TRANSACTION_DARK_8D`;
- accepted values: literal `true` or literal `false` only;
- Management API endpoint: `POST https://api.supabase.com/v1/projects/nenmkmtvjremqphfqnfw/secrets`;
- Management credential: the existing Windows-DPAPI-protected Management token;
- no secret value is read back, revealed, logged, committed, or copied into probe
  output.

Supabase documents that production Edge Function secrets set through the platform
are available to functions without redeployment. The launcher therefore does not
deploy or patch function source to perform this bracket.

The Edge function still requires the independent service-only database operator
host gate. Static master `true` alone does not grant browser dispatch or ordinary
agent transaction authority. `browserDispatchAllowed` remains false throughout
Checkpoint 8D.

## Normal one-probe sequence

`RUN_8D_EDGE_CONCURRENCY.cmd` performs this exact sequence after clean-worktree,
branch synchronization, exact-head display, and Management-token validation:

1. POST the fixed master secret with value `false` to establish a fail-closed
   baseline.
2. Mark restoration as required before attempting enablement.
3. POST the same fixed secret with value `true`.
4. Run exactly one existing bounded real-Edge concurrency acceptance runner.
5. Whether the runner passes, fails, throws, or the OAuth flow is cancelled, enter
   the PowerShell `finally` block.
6. Restore the fixed secret to `false`; retry restoration at most three times.
7. Clear Management/publishable-key environment variables from the launcher
   process.
8. Return success only when the probe succeeds and static-master restoration did
   not fail.

The Management API response for each secret update must be HTTP `201`; any other
status fails closed. Response bodies are not printed because they are unnecessary
for the gate.

## Failure and interruption rules

- `-RecoverNamespace <uuid>` runs only the previously reviewed durable fixture /
  ownership recovery path. It does **not** set static master to `true`.
- `-RestoreMasterOnly` performs only a fixed-name `false` write. It runs no OAuth,
  fixture creation, Edge concurrency probe, or browser action.
- If automatic restore fails after three bounded attempts, the launcher exits
  nonzero and explicitly blocks further 8D probes until
  `RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly` succeeds.
- A normal rerun is prohibited when a recovery namespace was printed; recover that
  namespace first.
- Abrupt OS termination, machine power loss, or forced process kill cannot be
  guaranteed to execute a local `finally` block. `-RestoreMasterOnly` is the
  reviewed recovery action for that case. The separate database host/operator gate
  remains fail-closed even if the static master were left `true` temporarily.

## Deliberately excluded authority

The bracket does not:

- GET or reveal any Edge secret value;
- DELETE secrets;
- accept an arbitrary project ref, secret name, URL, or secret value;
- alter the deployed Edge bundle, function version, JWT verification setting,
  database schema, migrations, MCP/public runtime, extension, signing, pairing,
  protocol, OAuth semantics, or browser capabilities;
- grant browser dispatch or consequential transaction approval;
- treat OAuth login as transaction approval.

## Required review gate

Before any production secret is changed by this procedure:

1. exact-head CI must be green;
2. an independent reviewer must inspect the tests-first contract, launcher change,
   this document, and the unchanged Edge master/DB-host-gate interaction;
3. verdict must be **PASS**.

Only that PASS authorizes the user to run exactly one normal
`RUN_8D_EDGE_CONCURRENCY.cmd` invocation. Immediately afterward, production state
must be verified again as static master false, policy OFF, operator/namespace
unowned, host false, synthetic 8D rows zero, and
`opera_agent_private.goal_heads` zero.
