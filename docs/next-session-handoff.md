# Opera Agent next-session handoff

Use this as the starting prompt for the next implementation session. Verify repository, production flag state, Edge function state, and CI before making claims.

## Handoff prompt

```text
Continue the private Opera Agent project from repository:
https://github.com/afnannuzulasugihartono/opera-agent

Working branch:
feat/semantic-runtime-1.6.0

Read first, in order:
1. AGENTS.md
2. docs/project-context.md
3. docs/next-session-handoff.md
4. docs/milestone-7-plan.md
5. docs/milestone-7-checkpoint-7a.md
6. docs/milestone-7-checkpoint-7b.md
7. docs/milestone-7-checkpoint-7c.md
8. docs/milestone-7-checkpoint-7d.md
9. docs/milestone-7-checkpoint-7e.md
10. docs/semantic-runtime-plan.md
11. docs/milestone-6-plan.md
12. SECURITY.md

Verified compatibility baseline:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged names/input schemas
- production device name opera
- established signing identity and pairing preserved
- background-first focus isolation preserved
- no silent foreground fallback
- immediate signed rollback remains 1.5.2
- signed 1.6.0 CRX SHA-256:
  cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0
- MCP source SHA-256 baseline:
  f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11
- locked 7A inventory digest:
  sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

Milestones 1–6 are complete. Milestone 7 Checkpoints 7A through 7E are complete.

Checkpoint 7A froze OA_REACTIVE_VM_V1, OA_REACTIVE_VM_CHECKPOINT_V1,
OA_CANONICAL_JSON_V1, the closed instruction/expression grammar, read-only-first
effects, persistence boundary, hostile corpus, and protocol/capability/MCP inventory.

Frozen quantitative limits remain:
- program/checkpoint/result 128 KiB each
- 256 static AST nodes
- AST depth 12
- control-flow depth 4
- 1,000 executed nodes/run
- 200 browser command leaves/run
- 50 iterations/loop, 250 total/run
- 15 s one wait, 60 s cumulative wait
- retry attempts/node 3
- 1,000 collection items/binding
- 64 bindings
- 20 s execution slice
- 5 minute run deadline

Checkpoint 7B added lib/reactive-vm.js as the accepted pure deterministic core.
Checkpoint 7C leaves 7B untouched and adds lib/reactive-vm-7c.js for LOOP,
UNTIL, WAIT_EVENT, and safe read-only RETRY.
Checkpoint 7D leaves 7B/7C untouched and adds lib/reactive-vm-7d.js for COLLECT,
DEDUP, bounded observation envelopes, causal invalidation, and non-exhaustive proof
binding.

Checkpoint 7E leaves those pure VM layers as the execution core and adds the
separate durable host/storage boundary.

Accepted 7E architecture:
- lib/reactive-vm-host-7e.js contains bounded host limits, metadata validation,
  deterministic effect idempotency, and host retry scheduling;
- supabase/functions/_shared/vm-token.js implements bounded AES-256-GCM oavm1
  program/checkpoint/result tokens;
- private schema opera_agent_private contains vm_runs, vm_effects,
  vm_rate_windows;
- only service_role has private schema/table and opera_vm_* execution authority;
- public, anon, authenticated are revoked;
- VM feature flag is milestone7_vm_enabled and defaults/remains false;
- Vault key opera_agent_vm_host_v1 is not returned while the flag is off;
- opera-agent-vm Edge function is deployed separately from public MCP;
- deployed Edge function is ACTIVE version 2 with verify_jwt=true;
- function also calls auth.getUser and requires explicit configured user-id/email
  allowlisting, then binds p_tenant_id to user.id;
- public opera-agent-mcp remains existing version 12 and was not changed.

Accepted 7E durable fencing:
- tenant/run identity;
- program digest;
- Goal Ledger revision/state;
- target digest / paired opera device;
- locked tab;
- document generation for document-scoped observations;
- lease owner + lease epoch + lease expiry;
- expected logical transition;
- 5 minute run deadline.

A valid checkpoint advances logical_transition once and clears the lease. Exact
checkpoint redelivery is a replay and does not advance again. Expired non-cancelled
worker leases can be reclaimed with a higher lease epoch. A cancellation request
survives worker death and terminalizes CANCELLED rather than being requeued.

Accepted 7E idempotency behavior:
- each logical read-only browser effect derives deterministic vm1:<sha256> identity;
- the same identity is passed to existing opera_enqueue as request_id;
- existing (device_id, request_id) uniqueness closes crash-after-dispatch /
  before-checkpoint duplicate-command risk;
- effect journal rejects the same idempotency key if request digest/method differs;
- command success remains process evidence, not proof authority.

The accepted VM effect surface is still only the frozen 7A read-only set:
- browser.ping
- restricted read/find/wait subset of atomic browser.burst
- tabs.list / tabs.get / tabs.find
- page.read / page.query / page.find / page.collect_links / page.capture /
  page.wait_for
- media.state

No navigation, tab mutation, click/fill/key, pointer, scroll, media mutation,
consequential effect, direct logical-ID action, or arbitrary code surface was added.

Accepted 7E server limits:
- 20 s bounded Edge slice
- 5 min run deadline
- 25 s default lease / 30 s max
- 4 active running runs per tenant
- 32 outstanding runs per tenant
- 20 enqueue/minute per tenant
- 128 KiB plaintext program/checkpoint/result
- retention cleanup input 1 hour through 7 days

Production dark-integration evidence:
- both additive 7E migrations applied successfully;
- opera-agent-vm ACTIVE v2, verify_jwt=true;
- deployment bundle SHA-256:
  e18f6b81d6e31031ef885cbf83c2be2f2ca11c0a73ceab9a5f508ee59d6f3fbb
- embedded transformed CI bundle integrity hash:
  437a68ef43a4ffcaab7ab2ccef288fe9a34994605cbe25d159c2ac37c853fa19
- milestone7_vm_enabled remains false;
- vm_runs = 0;
- vm_effects = 0;
- vm_rate_windows = 0;
- opera_vm_crypto_key() returns only {enabled:false} while flag off.

Production transaction probes passed and cleaned themselves before commit:
- cross-tenant get/cancel succeeded zero times;
- stale lease/program/goal/target rejected;
- one valid transition advanced once; exact checkpoint redelivery replayed only;
- worker-death simulation reclaimed at a higher lease epoch;
- crash/redelivery reused one command ID and exactly one command row;
- conflicting idempotency material rejected;
- cancellation survived dead-worker recovery;
- anon/authenticated had zero 7E RPC/private-schema authority;
- enqueue #21 rate-limited;
- queue overflow above 32 rejected;
- fifth active tenant claim concurrency-limited;
- expiry and cleanup passed;
- declared payload >128 KiB rejected;
- post-probe flag false / VM rows zero / synthetic commands zero.

The first production probe attempt failed only because the SQL harness used a
PL/pgSQL variable name ambiguous with a column name. PostgreSQL rolled the entire
transaction back; immediate verification showed flag false and zero synthetic
state. Only the test variable was renamed before the successful rerun.

Security advisors after migration/deploy added no 7E-relevant ERROR/WARN. New VM
tables appear only as informational RLS-without-policy because they are intentionally
service-role-only. Performance advisor reports informational unused indexes while
the feature remains dark.

A temporary CI run earlier hit the already-accepted 7C same-runner benchmark at
20.52% versus the 15% limit. 7E focused tests still passed. The threshold was not
weakened; later exact-head CI passed full Node/static and Chromium gates.

NEXT TASK: Checkpoint 7F only.

7E dark deployment is not 7F production acceptance. Before doing anything, read
the frozen 7F section in docs/milestone-7-plan.md. Preserve the 7A effect policy,
background-first behavior, extension 1.6.0, protocol 1, 26 capabilities, 18 MCP
tools, signing/pairing identity, and proof separation.

Do not begin Milestone 8+, consequential effects, direct logical-ID actions, public
MCP additions/changes, extension changes, or broader browser authority while
working on 7F unless the frozen plan explicitly authorizes it.

The milestone7_vm_enabled flag must remain false unless the frozen 7F acceptance
procedure explicitly requires a bounded activation step and all 7F preconditions
are satisfied. Do not infer authorization merely because opera-agent-vm exists.

Before ending any state-changing session:
- run the checkpoint-focused tests;
- run full npm test and npm run check;
- run relevant Chromium/background compatibility gates;
- run production/security gates required by the checkpoint;
- update docs/project-context.md and this handoff;
- restore any temporary CI instrumentation to the standard workflow;
- close temporary validation PRs without merge when used only for branch CI;
- compare final net diff against the previous accepted checkpoint;
- follow AGENTS.md exactly.
```

## Session-close note

Checkpoint 7E began from accepted 7D final head `23448be406bb7c1a47777306659e0a3bbab18bdc`. Its durable acceptance record is `docs/milestone-7-checkpoint-7e.md`. The next implementation session must start at Checkpoint 7F rather than repeating 7E or jumping to Milestone 8+.

## Collaboration rule

Follow the checkpoint/milestone ownership policy in `AGENTS.md`. ChatGPT Web may
implement and accept one checkpoint at a time; Codex independently audits the
complete milestone before the next milestone starts. Use
`docs/prompts/chatgpt-web-checkpoint.md` to begin a new checkpoint session. Keep
one active writer on the shared milestone branch and treat chat reports as
unverified until reconciled with repository and acceptance evidence.

Before closing 7F, resolve the Windows portability defect in the raw MCP source
hash gates observed at `bb6f28d`: a CRLF checkout hashes to `6235ed...`, while LF
normalization reproduces the frozen `f8735a...` fixture. The current Windows run is
168/171 with exactly three hash-lock failures; `npm run check` passes. Preserve the
inventory lock and make its byte-canonicalization cross-platform rather than
changing the expected contract hash to a platform-specific value.
