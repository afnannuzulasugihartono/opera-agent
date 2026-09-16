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

## Closed live evidence

- Manual Windows/Opera PKCE acceptance passed at
  `80e44483f2cdba400681dc6279522d0d55d24c98`; OAuth consent remained connection
  authorization only and browser dispatch stayed false.
- Hosted child-worker-loss acceptance passed at
  `8e3c6cd6aef41d8d1fb5a46189b193e34212c377` with real local child death,
  lease-expiry reclaim, stale epoch rejection, nonce durability, exact redelivery,
  one commit slot, clean cleanup, and no secret output.
- Fresh production verification afterward was policy OFF,
  legacy_gated=false, agent_commit_enabled=false, operator/namespace unowned,
  host_enabled=false, lease null, epoch 2, all synthetic 8D tables zero, and
  `opera_agent_private.goal_heads` zero.

## Production and concurrency facts

Supabase project: `opera-agent` / `nenmkmtvjremqphfqnfw`.
The isolated `opera-agent-transactions-8d` function was most recently observed
ACTIVE, JWT-required, production version 20, reviewed bundle hash
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
Its static master is `OPERA_AGENT_TRANSACTION_DARK_8D`; even when true, the Edge
host still requires the separate service-only DB operator host gate.

The concurrency candidate sends eight simultaneous authenticated requests on first
`prepare` and first `cancel`, requiring one winner, seven exact replays, convergent
metadata, bounded response size, distinct bounded hosted request/execution traces,
browser dispatch false, and no secret output.

Tests-first Deno/routing repairs already landed:

- `f98964f11dc9c6e9651cce203d8f02154f3d8be1` — Deno-resolution regression;
- `f493aed0afa17c3833c79f8f82dcddd51c656152` — `--node-modules-dir=auto`;
- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — routing evidence contract;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — bounded routing helper;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

## Canonical procedure alignment — PASS

The frozen `docs/milestone-8-plan.md` requires safe worker-death reclaim plus exact
rate/queue/concurrency/payload/retention enforcement; it does not require public
proof of distinct provider-internal V8-isolate IDs.

Commit `6f470bb9626aec5a0d60c1176af471f89558cbed` corrected the later procedure's
accidental `multiple real Edge workers` over-specification to observable hosted
concurrency without weakening the canonical plan.

Jules session `16177705161344454955` independently re-reviewed exact head
`f63bd8f52e086259ccbbf9120b240da1f9720049` with CircleCI #47/Vercel SUCCESS and
returned **PASS**. It authorized moving to the separate static-master arrangement
review gate. It did not authorize silent production mutation or 8E.

## Current writer change — static-master bracket candidate

This candidate is **NOT YET AUTHORIZED FOR LIVE USE**.

Tests first:

- `714ef9dad2d9049284f3bf951528d9095b7b0535` — launcher contract requires fixed
  project/name/value authority, true/false bracket, `finally` restore, bounded
  restore retries, recovery-only restore, no secret reveal/delete, and no token
  logging.

Implementation:

- `97a1c58ba3714455ff8d0463bf076229efdd71ae` —
  `scripts/run-8d-edge-concurrency.ps1` now brackets one normal probe with:
  baseline `false` -> temporary `true` -> existing probe -> `finally` restore
  `false` (max three attempts).
- `-RecoverNamespace` never enables the static master.
- `-RestoreMasterOnly` only POSTs the fixed master secret to `false`; it runs no
  OAuth, fixture, Edge concurrency, or browser work.
- any non-201 Management API response fails closed; response bodies are not
  printed.
- Management/publishable-key environment variables are cleared before exit.

Procedure documentation:

- `95572c3e1fe62fae212b4899da307110b7ce95c8` —
  `docs/milestone-8-checkpoint-8d-static-master-procedure.md`.

The fixed Management endpoint is
`POST https://api.supabase.com/v1/projects/nenmkmtvjremqphfqnfw/secrets`, using the
existing DPAPI-protected Management token. Only
`OPERA_AGENT_TRANSACTION_DARK_8D=true|false` is accepted by the launcher. No GET,
reveal, delete, arbitrary project/name/value, deployment, schema, MCP, extension,
OAuth, signing, pairing, protocol, or browser authority change is introduced.

Supabase documents that remote Edge Function secrets become available without a
function redeploy. Abrupt OS termination/power loss cannot guarantee local
`finally`; in that case `-RestoreMasterOnly` is the bounded recovery action, while
the separate DB host gate remains fail-closed.

## Exact next step

**DO NOT RUN `RUN_8D_EDGE_CONCURRENCY.cmd` YET.**

1. Check CircleCI and Vercel for the latest exact branch head after the durable
   context/handoff commits. If pending, stop. If failed, diagnose only that failure.
2. Once exact-head CI is SUCCESS, obtain a fresh independent Jules review bound to
   that exact head. Reviewer must inspect:
   - the tests-first static-master contract;
   - fixed Management API project/secret/value authority;
   - DPAPI/token non-disclosure;
   - baseline false -> true -> one probe -> `finally` false;
   - max-three restore retries and `-RestoreMasterOnly` hard-termination recovery;
   - `-RecoverNamespace` never enabling master;
   - unchanged Edge bundle plus separate DB host gate;
   - no browser/public-runtime/schema/signing/pairing widening.
3. Only verdict **PASS** authorizes exactly one normal
   `RUN_8D_EDGE_CONCURRENCY.cmd` live probe.
4. If the live run prints a recovery namespace, recover it before any normal rerun.
   If master restoration is uncertain, run only
   `RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly` first.
5. Immediately after the one reviewed live probe verify static master false,
   policy OFF, operator/namespace unowned, host false, all synthetic 8D tables zero,
   and `opera_agent_private.goal_heads` zero.
6. Continue remaining 8D real-key crypto tamper negatives, authenticated
   cross-tenant/session negatives, unresolved quantitative/rate evidence, and
   advisor reconciliation.
7. Write final `docs/milestone-8-checkpoint-8d-acceptance.md`, obtain final
   independent 8D audit PASS, and only then permit 8E.

## User-local state

Two accidental untracked 8E files remain preserved in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash while 8D remains open.
