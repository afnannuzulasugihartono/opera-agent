# Milestone 7 Checkpoint 7E — durable Supabase host and dark integration

Accepted: 2026-09-12

Starting accepted head: `23448be406bb7c1a47777306659e0a3bbab18bdc` (Checkpoint 7D closeout).

Checkpoint 7E adds only the frozen durable host for the already-accepted 7D VM. It does not begin Checkpoint 7F production acceptance, broaden browser effects, change the public MCP contract, or change the extension.

## Scope accepted

The pure runtime layers remain isolated and unchanged by durable hosting:

- `lib/reactive-vm.js` — accepted 7B core;
- `lib/reactive-vm-7c.js` — accepted 7C loops/waits/retries;
- `lib/reactive-vm-7d.js` — accepted 7D collection/dedup/proof binding.

Checkpoint 7E adds a host layer around them rather than moving database/network logic into those pure modules.

The durable host owns only:

- bounded Edge execution slices;
- tenant-bound enqueue/claim/checkpoint/cancel/expire/cleanup;
- lease owner/epoch/expiry fencing;
- compare-and-swap logical-transition advancement;
- deterministic logical-effect idempotency;
- bounded queue/rate/concurrency/retention controls;
- opaque encrypted program/checkpoint/result persistence;
- a server feature flag that is default-off;
- dark deployment and rollback/cleanup behavior.

No new public MCP tool or browser capability was added.

## Durable storage boundary

The additive migration creates private schema `opera_agent_private` and the 7E tables:

- `vm_runs`;
- `vm_effects`;
- `vm_rate_windows`.

The schema/tables revoke access from `public`, `anon`, and `authenticated`; only `service_role` receives the required usage/table/RPC privileges. RLS is enabled on all three tables even though no client policy is intentionally provided.

Persistent run rows contain bounded metadata plus opaque `oavm1.*` token envelopes. Program, checkpoint, and terminal result values are AES-256-GCM protected with a Vault-backed 32-byte host key. Raw page text, screenshots, browser parameters, credentials, auth state, arbitrary JSON browser state, and proof-forging data are not durable columns.

The server key RPC returns no key while the feature flag is disabled.

## Default-off dark boundary

`public.loa_v3_config` contains:

`milestone7_vm_enabled = false`

The migration inserts `false` only and never enables the feature. The Edge function may be deployed while the host remains inert. Production verification after migrations, deployment, and every synthetic probe confirmed:

- flag: `false`;
- `vm_runs`: 0 rows;
- `vm_effects`: 0 rows;
- `vm_rate_windows`: 0 rows;
- synthetic browser commands: 0 rows;
- `opera_vm_crypto_key()`: `{ "enabled": false }`.

Any temporary flag enablement used by database probes occurred inside one uncommitted transaction and was reset to `false` before commit, so another production session could not observe an enabled state.

## Lease/CAS state machine

A run advances only when the caller matches all durable fences required for that transition:

- tenant;
- run;
- current program digest;
- current goal revision;
- current target digest;
- lease owner;
- lease epoch;
- unexpired lease;
- expected logical transition;
- unexpired run deadline.

A successful checkpoint increments `logical_transition` exactly once and clears the current lease. Exact checkpoint redelivery is recognized as a replay and returns the already-advanced transition without advancing again.

Expired worker leases are recovered with a new lease epoch. A cancellation request survives worker loss; when the cancelled worker lease expires, recovery terminalizes the run as `CANCELLED` rather than returning it to the queue.

## Exactly-once logical observation effects

Checkpoint 7E retains the frozen Checkpoint 7A read-only effect policy. The host can reserve only:

- `browser.ping`;
- the frozen read/find/wait subset of atomic `browser.burst`;
- `tabs.list`, `tabs.get`, `tabs.find`;
- `page.read`, `page.query`, `page.find`, `page.collect_links`, `page.capture`, `page.wait_for`;
- `media.state`.

No navigation, tab mutation, form mutation, click, pointer, key, scroll, media mutation, or consequential effect is introduced by 7E.

Each logical VM effect receives a deterministic `vm1:<sha256>` idempotency key bound to tenant, run, program digest, request digest, and observation attempt class. That same key is reused as the existing `opera_enqueue` `request_id`.

The existing queue uniqueness on `(device_id, request_id)` therefore closes the dangerous crash window after dispatch but before VM checkpoint. If a new worker reclaims the run and redelivers the same logical leaf, it resolves to the already-created browser command rather than creating a second command.

The private effect journal additionally refuses an idempotency key whose request digest/method differs from the original reservation.

## Goal, target, tab, and document freshness

The Edge host checks the current Milestone 6 goal head before enqueue and before a resumed slice. A revised/non-open goal becomes `GOAL_REVISED`.

The run target remains locked to production device name `opera` and the program device identifier. Pending effects cannot switch device or tab. Cross-tab effect arguments are rejected.

For document-scoped observations, when the program binds a document generation the host extracts the returned observation generation and compares it to the locked generation. A mismatch produces `STALE_DOCUMENT`; it is not silently rebound to the new document.

Encrypted program/checkpoint values are also re-digested when reopened and must match durable program/target/checkpoint metadata and the tenant/run identity before execution continues.

## Bounded host limits

7E preserves or tightens the frozen Milestone 7 limits:

- program plaintext: 128 KiB;
- checkpoint plaintext: 128 KiB;
- result plaintext: 128 KiB;
- execution slice: 20 s with a safety margin;
- run deadline: 5 min;
- default lease: 25 s, maximum lease: 30 s;
- tenant active-running concurrency: 4;
- tenant outstanding queue: 32;
- enqueue rate: 20/minute/tenant;
- cleanup retention input: 1 hour through 7 days;
- bounded opaque-token storage envelope.

The Edge host will not start a new pending browser effect when the remaining slice budget is too small to safely await and checkpoint it.

## Production transaction probes

Two production database probe suites were executed against the deployed schema. All synthetic rows were isolated to reserved probe tenant IDs, and all probe setup was deleted before commit. The flag was restored to `false` before commit.

The durability/security probe passed all assertions:

1. first claim received lease epoch 1 / logical transition 0;
2. cross-tenant get/cancel returned no run;
3. wrong worker/lease was rejected as `STALE_LEASE`;
4. stale program digest was rejected;
5. stale goal revision was rejected;
6. stale target digest was rejected;
7. one valid checkpoint advanced transition 0 -> 1;
8. exact checkpoint redelivery replayed transition 1 without incrementing it;
9. the next worker received lease epoch 2;
10. one logical `browser.ping` effect was reserved and enqueued;
11. repeating the same deterministic request ID returned the identical command ID and exactly one `opera_commands` row;
12. reusing the idempotency key with different request material returned `IDEMPOTENCY_COLLISION`;
13. forced lease expiry simulated worker death after dispatch/before checkpoint;
14. a replacement worker reclaimed with lease epoch 3;
15. redelivery after that crash still resolved to the same command ID and one command row;
16. cancellation while running survived forced worker death and recovery ended `CANCELLED`;
17. `anon` and `authenticated` had zero executable 7E RPCs and zero private-schema/table access;
18. persisted private tables exposed no JSON/JSONB/bytea raw-browser-state columns;
19. cleanup removed every synthetic run/effect/rate/command before commit.

The independent limits/backpressure probe also passed:

- enqueue 1–20 accepted for the isolated tenant;
- enqueue 21 returned `RATE_LIMITED`;
- 32 outstanding runs caused the next enqueue to return `QUEUE_FULL`;
- four active valid leases caused a fifth claim to return `TENANT_CONCURRENCY`;
- expired queued work became `EXPIRED`;
- terminal work beyond retention was removed by cleanup;
- a declared payload above 128 KiB returned `INVALID_RUN`;
- all synthetic rows were removed and the feature flag remained `false` after commit.

The first durability probe attempt never committed because its SQL test harness used a PL/pgSQL variable name that was ambiguous with a column name. PostgreSQL aborted/rolled back that transaction. A state check immediately afterward confirmed flag `false`, zero VM rows, zero rate/effect rows, and zero synthetic commands. Only the probe variable was renamed before the successful rerun; production runtime behavior was not weakened.

## Edge dark deployment

`opera-agent-vm` is deployed as a separate internal Edge function:

- status: `ACTIVE`;
- deployed version: 2;
- `verify_jwt`: `true`;
- Supabase deployment bundle SHA-256: `e18f6b81d6e31031ef885cbf83c2be2f2ca11c0a73ceab9a5f508ee59d6f3fbb`.

The deployment came from the CI-built/minified bundle for branch head `1931a48535935813df4cbc59dbca303caa86a7ad`. The transport wrapper verifies the embedded transformed bundle SHA-256 before loading it:

`437a68ef43a4ffcaab7ab2ccef288fe9a34994605cbe25d159c2ac37c853fa19`.

The function itself additionally calls `auth.getUser`, requires the configured user-ID/email allowlist, and rejects requests when both allowlists are empty. All run operations bind `p_tenant_id` to the authenticated user ID. Thus JWT verification is an outer gate, not a replacement for tenant binding.

The public `opera-agent-mcp` deployment remains the existing version 12 and was not modified by 7E.

## Focused and CI coverage

The original focused 7E suite contains 9 gates for:

- frozen host/storage limits;
- deterministic control-sensitive effect idempotency;
- metadata-only persisted boundary and secret rejection;
- persistence classification without false completion;
- bounded deterministic retry scheduling;
- AES-GCM opaque token kind/tamper checks;
- private/default-off/lease-fenced/service-role SQL contract;
- OAuth + 7D + deterministic `opera_enqueue` host wiring;
- public MCP/extension exclusion.

A dedicated boundary test adds explicit source gates for:

- tenant, goal, target, tab, and document-generation fail-closed behavior;
- OAuth allowlist fail-closed behavior;
- authenticated-user tenant binding;
- service-role-only 7E RPC/private-schema authority.

Pre-closeout validation on commit `1931a48535935813df4cbc59dbca303caa86a7ad`, GitHub Actions run `34679156068`, was fully green:

- focused 7E: pass;
- CI Edge bundle: pass;
- full Node/static suite: pass;
- `npm run check`: pass;
- controlled Chromium extension regression: pass.

An earlier instrumentation run transiently failed only the already-accepted 7C same-runner performance comparison at 20.52% versus the 15% gate. The 7E focused suite remained green. The threshold was not loosened; a subsequent exact-head run passed the full suite and Chromium regression.

The final documentation/boundary-test head must be revalidated before closeout, after which temporary CI instrumentation is restored byte-for-byte to the standard workflow and the temporary draft validation PR is closed unmerged.

## Security advisors

Security advisors were run after schema migration and again after Edge deployment.

Checkpoint 7E introduced no relevant `ERROR` or `WARN`. Its three private VM tables appear only under the informational `RLS Enabled No Policy` advisory, which is intentional because the tables are service-role-only and have no client policy.

Remaining WARNs are pre-existing baseline findings outside 7E, including older mutable-search-path functions, `pg_net` in `public`, intentionally exposed legacy security-definer RPCs, anonymous-policy/auth configuration, and leaked-password protection configuration. They were not introduced or broadened by 7E.

Performance advisor findings for 7E are informational unused-index notices while the feature remains dark/empty.

## Compatibility boundary

Checkpoint 7E changes no:

- extension source or version;
- extension ID;
- protocol;
- 26-capability public browser inventory;
- 18 MCP tool names or input schemas;
- MCP source contract;
- signing identity;
- pairing;
- normal background-first focus behavior;
- signed 1.6.0 release artifact;
- immediate signed rollback 1.5.2;
- proof-engine authority rules;
- `browser.burst` atomic-leaf boundary.

The feature flag remains `false`, so extension 1.6.0 and the existing 18-tool MCP path continue to be the active production behavior.

## Rollback and cleanup

Immediate server rollback is:

1. keep/set `milestone7_vm_enabled = false`;
2. stop new VM claims/enqueues;
3. allow any already-running read-only slice to terminate or lose its bounded lease;
4. keep using the pre-7E runner/MCP path;
5. expire and purge bounded VM rows through the 7E expiry/cleanup RPCs and TTL policy;
6. leave the extension, pairing, MCP contract, and signed release untouched.

The new tables/functions are additive and need not be dropped for emergency rollback. Keeping the flag off is sufficient to prevent the host from obtaining its crypto key or starting work.

## Next checkpoint

Checkpoint 7F is next, but it remains a separate production-acceptance checkpoint. Do not treat this 7E dark deployment as 7F acceptance.

7F must validate the complete accepted VM host in its frozen production acceptance scope without changing the 7A effect policy or the public compatibility baseline. Milestones 8–11 remain deferred.
