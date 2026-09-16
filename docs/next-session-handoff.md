# Opera Agent next-session handoff

Last synchronized: 2026-09-16. Continue **ONLY Checkpoint 8D**. 8E has not started.

## Current authoritative boundary

Repository: `afnannuzulasugihartono/opera-agent`
Branch: `feat/semantic-runtime-1.6.0`
Stable release: extension 1.6.0, protocol 1, 26 browser capabilities, 18 public MCP
tools, unchanged signing/pairing, signed rollback 1.5.2.

Milestone 8 checkpoints 8A-8C are accepted. 8D is **IN PROGRESS**. Nothing here
permits 8E. Repository/CI/production evidence outranks chat summaries. Never commit
or print credentials.

## Closed 8D live evidence

- PKCE acceptance passed at `80e44483f2cdba400681dc6279522d0d55d24c98`;
  OAuth consent remained connection authorization only and browser dispatch false.
- Hosted child-worker-loss acceptance passed at
  `8e3c6cd6aef41d8d1fb5a46189b193e34212c377` with child death, lease-expiry
  reclaim, stale epoch rejection, nonce durability, exact redelivery, one commit
  slot, clean cleanup, and no secret output.
- Production verification afterward: policy OFF, `legacy_gated=false`,
  `agent_commit_enabled=false`, operator/namespace unowned, host false, lease null,
  epoch 2, all synthetic tables zero, and `opera_agent_private.goal_heads` zero.

## Production/concurrency facts

Supabase project: `opera-agent` / `nenmkmtvjremqphfqnfw`.
`opera-agent-transactions-8d` was most recently observed ACTIVE, JWT-required,
production version 20, reviewed bundle hash
`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.

Static master: `OPERA_AGENT_TRANSACTION_DARK_8D`. Even when true, each transaction
request still requires service-only DB `opera_tx_operator_host_gate_8d()` true.

The bounded concurrency candidate races eight simultaneous authenticated requests
for first `prepare` and first `cancel`, requiring one non-replay winner + seven
exact replays, convergent metadata, bounded responses, distinct hosted
request/execution trace evidence, browser dispatch false, and no secret output.

Prior repair/evidence commits:

- `f98964f11dc9c6e9651cce203d8f02154f3d8be1` — Deno resolution regression;
- `f493aed0afa17c3833c79f8f82dcddd51c656152` — `--node-modules-dir=auto`;
- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — routing evidence contract;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — bounded routing helper;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

The canonical milestone does not require distinct provider-internal V8-isolate IDs.
Commit `6f470bb9626aec5a0d60c1176af471f89558cbed` corrected the later procedure's
over-specification. Jules session `16177705161344454955` re-reviewed exact head
`f63bd8f52e086259ccbbf9120b240da1f9720049` and returned **PASS** for the
canonical hosted concurrency interpretation.

## Static-master bracket — independently PASSED

Tests-first/implementation/procedure commits:

- `714ef9dad2d9049284f3bf951528d9095b7b0535` — static-master launcher contract;
- `97a1c58ba3714455ff8d0463bf076229efdd71ae` — launcher bracket;
- `95572c3e1fe62fae212b4899da307110b7ce95c8` — procedure document;
- durable state through exact reviewed head
  `f1b2cadde60510d46b38a8f3bf5f991bfd9ba4f8`.

Normal launcher behavior is fixed to project `nenmkmtvjremqphfqnfw` and secret
`OPERA_AGENT_TRANSACTION_DARK_8D` only:

1. baseline POST `false`;
2. temporary POST `true` immediately around one probe;
3. exactly one existing bounded concurrency probe;
4. `finally` restore `false`, max three restore attempts;
5. restore failure forces launcher failure;
6. clear Management/publishable-key environment variables.

`-RecoverNamespace` never enables master. `-RestoreMasterOnly` writes only the
fixed master to `false` and runs no OAuth, fixture, probe, or browser action. No
GET/list/reveal/delete secret path exists.

Hard OS termination/power loss can bypass local `finally`; recovery is explicitly
`RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly`. Static master true by itself is
still fail-closed because the independent DB host gate remains mandatory.

Fresh independent Jules review:

- session: `6098947889864439430`
- exact reviewed head: `f1b2cadde60510d46b38a8f3bf5f991bfd9ba4f8`
- bound CI: CircleCI #54 SUCCESS, Vercel SUCCESS
- local read-only suite reported: **324/324 PASS**, clean repo
- final verdict: **PASS**

The reviewer explicitly accepted all ten requested invariants, including fixed
project/secret authority, write-only secret management, DPAPI/token handling,
true/false bracket, recovery paths never enabling master, bounded restore retries,
hard-termination fail-closed semantics, mandatory DB host gate, no public/browser
authority widening, and test coverage.

Authorization from this review is narrow: **exactly ONE future normal
`RUN_8D_EDGE_CONCURRENCY.cmd` live probe**. It does not authorize 8E or a second
normal probe.

## Exact next step

**DO NOT RUN THE CMD UNTIL THE LATEST DOCUMENTATION HEAD CI IS SUCCESS.**

1. Check CircleCI and Vercel for the latest exact branch head containing this
   handoff and `docs/project-context.md` update. Pending => STOP. Failed => diagnose
   only that failure.
2. Once exact-head CI is SUCCESS, the next user action is exactly one normal run:

   ```powershell
   cd D:\GitHub\opera-agent
   .\RUN_8D_EDGE_CONCURRENCY.cmd
   ```

   Do not run a second normal probe without new authorization.
3. If the run prints a recovery namespace, recover that namespace before any
   normal rerun. If static-master restoration is uncertain, run only:

   ```powershell
   .\RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly
   ```

4. After the single live probe, immediately verify static master false, policy OFF,
   operator/namespace unowned, host false, all synthetic 8D tables zero, and
   `opera_agent_private.goal_heads` zero.
5. Continue only remaining 8D real-key crypto tamper negatives, authenticated
   cross-tenant/session negatives, unresolved quantitative/rate evidence, and
   advisor reconciliation.
6. Write final `docs/milestone-8-checkpoint-8d-acceptance.md`, obtain final
   independent 8D audit PASS, and only then permit 8E.

## User-local state

Two accidental untracked 8E files remain preserved in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash while 8D remains open.
