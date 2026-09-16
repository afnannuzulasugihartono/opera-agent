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

## Prior independent static-master review

Fresh Jules session `6098947889864439430` reviewed exact head
`f1b2cadde60510d46b38a8f3bf5f991bfd9ba4f8`, bound to CircleCI #54 SUCCESS and
Vercel SUCCESS, and returned **PASS**. It accepted the fixed project/secret scope,
write-only Management API use, DPAPI handling, false -> true -> one probe ->
finally false bracket, recovery behavior, bounded restore attempts, mandatory DB
host gate, no public/browser authority widening, and browser dispatch false.

That PASS authorized one future normal probe for the then-reviewed launcher only.

## Live launcher attempts after that review

Documentation head before the attempts:
`71995dbc5733d872b50656d04e7bcda9bc58f9f1`.

Attempt 1:
- launcher synchronized to the exact head;
- loaded local DPAPI Management token;
- baseline static-master `false` POST returned HTTP 403;
- stopped before any successful secret write, OAuth, fixture, or Edge probe.

A new scoped PAT was then created through the Supabase Dashboard with:
- project scope: `opera-agent` only;
- expiry: 7 days;
- capability: only `Edge Function Secrets: Read-write`;
- token value kept local and stored with Windows DPAPI.

Attempt 2:
- same exact launcher head;
- baseline `false` POST returned HTTP 400;
- stopped before `restoreRequired=true`, before master `true`, OAuth, fixture, or
  Edge probe.

Root cause is confirmed against the current Supabase Management API OpenAPI spec:
`POST /v1/projects/{ref}/secrets` requires a JSON **array** of `{name,value}`
objects. PowerShell pipeline enumeration in the launcher turned the intended
one-element array into a scalar JSON object.

## Tests-first repair now on branch

- `9f372e6ce6f16927233090826180f26a14fb9bd5` — adds regression assertions that
  require array-preserving `ConvertTo-Json -InputObject @(...)` and reject the old
  pipeline serialization form.
- `07acfa962e3b9acde8a087d0d05657d3b0709f98` — minimal implementation fix:
  `ConvertTo-Json -InputObject @(@{ name = ...; value = ... }) -Compress`.
- `2192584f498f2c44a54440dbd5f08094bd56dbde` — durable project-context update.

The repair does not change project ref, secret name, allowed values, Management
endpoint, restore behavior, browser authority, public MCP/runtime/schema,
extension/signing/pairing/protocol, or the bounded Edge probe itself.

## Exact next gate

**DO NOT RUN `RUN_8D_EDGE_CONCURRENCY.cmd` AGAIN YET.**

1. Treat the latest branch head containing this handoff as the required exact CI
   head.
2. Require CircleCI and Vercel SUCCESS. Pending => STOP. Failed => diagnose only
   that failure.
3. Obtain a fresh independent read-only review of the repaired launcher and exact
   CI head because this launcher controls a production-boundary static master.
   The review must verify:
   - Supabase secrets body is a JSON array matching `CreateSecretBody`;
   - fixed project/secret/value scope remains unchanged;
   - no GET/list/reveal/delete secret path was introduced;
   - baseline false -> true -> exactly one probe -> finally false remains intact;
   - `-RecoverNamespace` and `-RestoreMasterOnly` cannot enable master;
   - max-three restore and fail-loud behavior remain intact;
   - independent DB host gate remains mandatory;
   - no public/browser authority widening and `browserDispatchAllowed=false`.
4. Only a fresh independent **PASS** may authorize one normal live launcher run.
5. After that run, immediately verify static master false, policy OFF,
   operator/namespace unowned, host false, synthetic 8D tables zero, and
   `opera_agent_private.goal_heads` zero.
6. Continue only remaining 8D crypto tamper negatives, authenticated
   cross-tenant/session negatives, quantitative/rate evidence, advisor
   reconciliation, acceptance doc, and final independent 8D audit.
7. Only final 8D audit PASS permits 8E.

## User-local state

Two accidental untracked 8E files remain preserved in a stash named approximately
`preserve accidental 8E files before completing checkpoint 8D`. Do not pop, apply,
delete, or use that stash while 8D remains open.
