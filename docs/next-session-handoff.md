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

## Real Edge concurrency candidate

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

Tests-first routing evidence:

- `2b60f0e6e558a676063c2bf0421a9dff8d63bba8` — routing evidence contract;
- `9d46c636cd092537563d6f2fe8dbef6b9286dccc` — bounded helper;
- `d6e9f18ba9f3c80c0326af4241635e573662975a` — runner integration.

The helper requires exactly 8 response samples, inspects only allowlisted
`x-deno-execution-id` / `cf-ray` values in memory, fails closed when evidence is
missing, and never returns/logs raw header values.

## Canonical procedure alignment

The frozen canonical `docs/milestone-8-plan.md` requires worker-death reclaim,
redelivery/nonce durability, and exact rate/queue/concurrency/payload/retention
bounds. It does not require external proof of provider-internal V8-isolate IDs.

The later acceptance procedure had accidentally added the phrase
`multiple real Edge workers`. Commit
`6f470bb9626aec5a0d60c1176af471f89558cbed` corrected that over-specification to
observable hosted concurrency evidence without changing the canonical milestone
plan or claiming worker/isolate identity.

## Independent procedure-alignment re-review: PASS

Jules session `16177705161344454955` independently re-reviewed exact head
`f63bd8f52e086259ccbbf9120b240da1f9720049`. Exact-head CircleCI pipeline #47 and
Vercel were SUCCESS; Jules also reported the 321-test local suite clean.

Final verdict: **PASS**.

Reviewer conclusions:

- `docs/milestone-8-plan.md` is authoritative over the later procedural aid;
- literal worker/V8-isolate identity is not a canonical Checkpoint 8D acceptance
  requirement;
- the old `multiple real Edge workers` phrase was procedural over-specification;
- the corrected procedure faithfully restores canonical 8D requirements without
  weakening a canonical safety requirement;
- request/execution trace IDs remain evidence of distinct hosted requests only,
  not worker IDs;
- the existing eight-way concurrency candidate is a valid bounded measurement
  mechanism;
- no remaining code/procedure finding blocks one live concurrency probe after a
  **separate reviewed static-master enable/restore arrangement**.

This PASS closes the procedure-alignment review gate. It does not authorize silent
production-config mutation and does not permit 8E.

## Exact next step

**DO NOT RUN `RUN_8D_EDGE_CONCURRENCY.cmd` YET.**

1. Require CircleCI/Vercel SUCCESS for the latest exact branch head after this
   handoff.
2. Define/review a bounded static-master procedure for temporarily setting
   `OPERA_AGENT_TRANSACTION_DARK_8D=true` only around the single authorized
   concurrency probe, with fail-closed restoration to `false` even on probe
   failure/interruption. The procedure must not expose the secret value or broaden
   browser/transaction authority.
3. Obtain independent PASS for that static-master arrangement before production
   configuration is changed.
4. Then run exactly one fresh `RUN_8D_EDGE_CONCURRENCY.cmd` live probe. If it emits
   a recovery namespace or fails after fixture creation, do not blindly rerun
   normal mode; use only the reviewed recovery path.
5. Immediately afterward verify static master false, policy OFF,
   operator/namespace unowned, host false, all synthetic 8D tables zero, and
   `opera_agent_private.goal_heads` zero.
6. Continue only remaining 8D real-key crypto tamper negatives, authenticated
   cross-tenant/session negatives, unresolved quantitative/rate evidence, and
   advisor reconciliation.
7. Write final `docs/milestone-8-checkpoint-8d-acceptance.md`, obtain final
   independent 8D audit PASS, and only then permit 8E.

## User-local state

Two accidental untracked 8E files remain preserved in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash while 8D remains open.
