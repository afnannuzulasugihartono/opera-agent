# Opera Agent project context

Last synchronized: 2026-09-15

## Latest normal-Chat reliability result

A separate reliability branch, `fix/chat-control-fallback`, now proves that normal
Chat can keep controlling the paired Opera browser without relying on ChatGPT's
custom Developer-MCP invocation binding. Upstream OpenAI issues #230 and #235
reproduce conversation-level custom-MCP `FORBIDDEN` / native-app mutual exclusion
while the downstream MCP server can remain healthy. OpenAI's current Developer
Mode documentation also treats full write-capable MCP as beta focused on
Business/Enterprise/Edu, so personal-plan custom-MCP availability must not be the
only production control path.

`docs/chat-control-fallback.md` defines the fallback:

```text
Normal Chat -> connected Supabase connector -> opera_enqueue -> durable command
queue -> paired extension -> Opera -> opera_await/opera_await_capture -> Chat
```

No new browser runtime, production schema, Edge function, extension bytes, public
MCP schema, signing identity, pairing, or Milestone 8 transaction state was
changed. The fallback reuses the exact durable queue already used by MCP. The
frozen 18-tool mapping is `tests/fixtures/chat-control-fallback-v1.json` and is
checked by `tests/chat-control-fallback.test.mjs`.

Live normal-Chat acceptance on 2026-09-15, without invoking the custom Opera Agent
MCP: `browser.ping` PASS (447 ms, extension 1.6.0/protocol 1), `tabs.list` PASS
(710 ms), then a bounded background probe opened `https://example.com` (2635 ms),
read that exact tab (718 ms), and closed only the temporary tab (620 ms). Raw user
tab content is intentionally not persisted. This proves the browser/queue/extension
path can remain healthy when the custom-MCP host binding is unavailable.

Operational rule: prefer typed custom MCP when callable; on conversation-level
`FORBIDDEN`, use the documented fixed Supabase enqueue/await fallback rather than
forcing Work mode or a new chat. Keep enqueue and await in separate connector calls
so the queue insert commits before the extension must observe it. This solves
normal-Chat operational continuity, not the upstream ChatGPT router defect itself.

## Latest 8D follow-up audit repair

Newest: commit 6512908 exact-commit PASS, exact-head CI 34820127563 SUCCESS, native
29/29 and full 316/316 zero skips PASS. Fixed test-only helper pins read_only=false for all
closed private operator SQL, no grants/fallback, unchanged statements/parameters/fences.
Focused 43/43, static 1.6.0/26 PASS. Commit/CI binding complete; ready for bounded manual
PKCE acceptance attempt. No 8E until final 8D acceptance. No fixture/browser mutation.

Latest continuation: installation/pin f8c42c2 independently PASS and standard
CI34806580639 SUCCESS. A bounded live CLI attempt failed preflight before OAuth
or fixtures because Management secret values are DIGESTS, not plaintext.
Master restored false (actual SHA-256(false) match), DB epoch0/unowned/hostfalse,
policy OFF, principals/runs0. See
`docs/milestone-8-checkpoint-8d-secret-digest-repair.md` for test-first test-only
repair: strict secret digests plus exact initialized-Edge GET405, no private key
retrieval. Focused26/26, full315/315 and Deno/static check PASS; independent
implementation worktree-delta review PASS with affected29/29 and hostile checks.
Reviewer usage cut off its final commit-binding report; exact-head CI and
remaining live acceptance are next. No new Edge/schema/pin/public-MCP/extension
change. 8D IN PROGRESS; 8E not started. Frozen worker-loss gate may be evidenced
by actual child-worker death against hosted DB, not mislabeled Edge-isolate death;
the final independent evidence review must reconcile that scope explicitly.

Superseding continuation: separate reviewer `review_8d_candidate` returned PASS
for exact f1e6f944 and bounded master-OFF installation. See
`docs/milestone-8-checkpoint-8d-fence-review.md` and
`docs/milestone-8-checkpoint-8d-fenced-install.md`. Actual fence history version
is 20260914043049; migration filename reconciled without history rewrite.
The isolated fenced Edge v8 is ACTIVE/JWT required; all13 deployed bodies match.
Observed bundle/pin: 96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1.
Master remains OFF; fresh control state epoch0/unowned/hostfalse and policy OFF,
legacyfalse/agentfalse, principals/runs/goals zero. Public MCP/extension/signing
remain unchanged. Pin-delta review/CI, full cloud acceptance and final independent
8D review remain required before 8E. Earlier undeployed statements below are
historical and superseded by this installation, not overall checkpoint acceptance.

The user closed the other writer and requested repair here. See
`docs/milestone-8-checkpoint-8d-audit-repair.md`. The follow-up repairs atomic local
lease publication/retirement, exclusive server release zero-owned-row checks,
and actual remote bundle verification on recovery. Full local Node tests pass
314/314 with zero skips; focused gates pass 46/46; Windows stress has zero dual
owners in 150 trials; the native PostgreSQL release regression passes.
Static inventory remains 1.6.0/26. No fresh CI/browser/cloud acceptance is claimed.
The migration remains undeployed and the fenced Edge pin deliberately stays zero.
Production, OAuth, extension, MCP runtime, signing and pairing were not changed.
Independent exact-candidate review is next; 8D remains IN PROGRESS, 8E not started.
Permanent nonsecret retirement witnesses must not be removed while stale I/O can
resume; unfinished legacy active locks fail closed. Earlier records below are
historical, not acceptance of this new repair.

## Latest user-requested reliability investigation

See `docs/mcp-reliability-investigation.md`. Status is now
`HOST_MCP_UNRESOLVED / NORMAL_CHAT_FALLBACK_PROVEN`: the upstream ChatGPT
conversation-router defect is not patchable from this repository, but its effect
on the user's normal-Chat browser workflow is bypassed through the existing durable
Supabase command plane. Earlier public MCP health and extension stale-generation
diagnostics remain valid as narrower evidence; they are no longer the only route
to keep the browser workflow running.

The fallback branch changes no browser runtime or production infrastructure. Its
new test/fixture freeze the adapter mapping and preserve the current locked 18-tool
surface. Continue MCP-specific diagnostics only to distinguish host/server failure,
not as a prerequisite for ordinary browser control when the fallback passes.
8D remains open; 8E not started.

This is the durable project-state summary for humans and future LLM sessions.
Executable repository state, exact-head CI artifacts, signed release records, and
production queries outrank chat summaries. Never store secrets here.

## Product intent and invariants

Opera Agent lets an authorized AI control the user's existing local Opera session
through a private extension, authenticated relay, and MCP server. It is a general
browser controller, not site-specific automation.

Non-negotiable invariants:

- background-first operation; ordinary work must not steal the active tab or focused window;
- no silent foreground fallback;
- preserve established extension signing identity and pairing;
- no arbitrary JavaScript, unrestricted raw CDP, SQL, shell, or generated-code escape hatch;
- webpage/tool/model text is untrusted data, never authority or program structure;
- sensitive browser/credential state is never persisted as semantic/VM/transaction learning state;
- once transaction enforcement is promoted, the same agent identity must have no legacy mutation bypass;
- keep an immediate same-identity signed rollback.

## Current accepted release state

- Stable extension: `1.6.0`.
- Protocol: `1`.
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`.
- Public browser capabilities: `26`.
- Public MCP tools: `18`, unchanged names and input schemas.
- Production device name: `opera`.
- Working branch: `feat/semantic-runtime-1.6.0`.
- Reliability side branch: `fix/chat-control-fallback`.
- Final 1.6.0 release acceptance commit: `cfb903b`.
- Accepted 8A contract/test commit: `4c84dab`.
- Accepted 8B pure engine/test commit: `0f333a1`.
- Accepted 8C pure authority-verifier/test commit: `e2b228b`.
- Immediate signed rollback: `1.5.2`.
- Signed 1.6.0 CRX SHA-256: `cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`.
- Canonical-LF MCP source SHA-256: `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`.

Never commit, paste, log, or transmit private signing-key material, pairing
secrets, service keys, OAuth secrets, passwords, OTPs, payment data, private
crypto-key contents, or user bearers.

## Architecture

```text
ChatGPT / another MCP client
  -> authenticated Streamable HTTP MCP server
  -> allowlisted relay / workflow layer
  -> paired Opera extension
  -> local Opera tab
  -> structured observation or verified action outcome
```

Normal-Chat fallback converges on the same relay before browser execution:

```text
Normal Chat -> Supabase connector -> opera_enqueue/opera_await -> paired extension
```

Browser content never grants authority. Server infrastructure owns pairing,
transport and dark transaction hosting; the extension owns browser-local sensing
and named primitives. The fallback is an operational adapter, not an authority
expansion: it is restricted by repository policy to the fixed enqueue/await calls
and the same browser safety semantics.

## Locked public MCP contract

The accepted public inventory remains:

1. `browser_status`
2. `run_browser_burst`
3. `list_tabs`
4. `open_url`
5. `activate_tab`
6. `navigate_tab`
7. `close_tab`
8. `read_page`
9. `capture_page`
10. `find_elements`
11. `click_element`
12. `fill_element`
13. `press_key`
14. `scroll_page`
15. `move_pointer`
16. `click_at`
17. `drag_pointer`
18. `wheel_at`

Contract fixture: `tests/fixtures/mcp-contract-v1.json`.
Fallback mapping fixture: `tests/fixtures/chat-control-fallback-v1.json`.

Milestone 8 Checkpoints 8A-8E remain frozen to no public MCP runtime/schema
change. The ownership/fencing work below changes no extension/MCP contract,
signing identity, pairing, CRX, protocol, capability count, or rollback release.

## Milestone status

- Milestones 1-5: complete/released; semantic runtime foundation ships in 1.6.0.
- Milestone 6: Goal/Constraint Ledger + Proof Engine complete as server-side work.
- Milestone 7: Reactive Browser VM complete and independently audited PASS; accepted production VM flag remains false.
- Milestone 8: 8A-8C accepted; **8D IN PROGRESS**; 8E and later checkpoints not started.
- Milestone 9+: not started.

## Milestone 8 frozen boundary

Authoritative plan: `docs/milestone-8-plan.md`.

Lifecycle:

```text
PREPARE -> VALIDATE -> APPROVE(if required) -> COMMIT
        -> OBSERVE -> VERIFY -> RECEIPT
```

Policy modes remain `OFF`, `DARK`, and `ENFORCED`. OAuth connection consent is
not transaction approval. Observations/page/tool/model output are evidence, not
authority. There must never be a state where an agent receives transaction
authority while retaining a direct legacy mutation bypass.

## Checkpoint 8D current state

8D remains open. The local/pre-live implementation now includes the ownership and
server-side fencing fixes requested after independent review findings. No fresh
OAuth or production mutation was performed while implementing these fixes.

### Production state remains the previously installed OFF backend

The currently installed production shape was **not changed by the ownership/fence
work**:

- applied production migration remains `20260913143306_transaction_journal_8d_dark.sql`;
- production Edge function remains the previously installed `opera-agent-transactions-8d`, historically observed ACTIVE/version 6/`verify_jwt=true`;
- previously observed deployed bundle SHA remains `bad0ae493209891e45bc90a11d91ef85dac72022f70f7aaf8ba9e8152c822769`;
- prior read-only closeout evidence showed host master flag false, transaction policy `OFF`, `legacy_gated=false`, `agent_commit_enabled=false`, all 11 synthetic 8D tables zero, and synthetic goal rows zero.

Those production facts are inherited from the prior read-only verification. This
ownership/fencing task intentionally performed **no production migration, Edge
deploy, secret mutation, policy mutation, fixture write, OAuth login, or browser
dispatch**.

### Test-first ownership findings

Two security/correctness gaps were made deterministic before runtime changes:

1. a fresh namespace could previously ignore a dirty manifest belonging to a
   different namespace after the global local lease expired;
2. a remote operator mutation that had already escaped the dead local process
   could previously complete after recovery had restored/verified clean state.

Test-first commit `3595f8026ad72a14e39dc48df989cad235806670`
produced the expected failing CI run `34801030099`. The delayed-mutation harness
synchronization itself was then made deterministic in
`6d535cabaa257cd5f94018f67640fd95cc971900` before the runtime fix.

The regression files now include:

- `tests/transaction-cloud-ownership-fence-8d.test.mjs`;
- `tests/transaction-cloud-server-fence-static-8d.test.mjs`.

### Global local dirty-ownership admission

`tests/helpers/transaction-cloud-operator-8d.mjs` now discovers pending dirty
manifests globally within the 8D state directory rather than checking only the
new run's namespace.

Properties:

- any pending dirty manifest blocks every fresh namespace with `8D_RECOVERY_REQUIRED`;
- more than one dirty manifest fails closed with `8D_MULTIPLE_DIRTY_MANIFESTS`;
- ownership rechecks the global pending state after acquiring the local control lease;
- recovery requires the requested namespace to match the globally pending manifest;
- existing live-PID fencing and exact nonsecret cleanup manifest remain intact.

This closes the fresh-namespace bypass without changing the manifest's secret-free
shape.

### Server-side epoch fence candidate

New review-only migration candidate:

`supabase/migrations/20260914043049_transaction_operator_fence_8d.sql`

Installed master-OFF after independent PASS; see the fenced-install record above.

It adds a service-only singleton `opera_agent_tx_candidate.operator_control` with:

- monotonically increasing `epoch`;
- exact `owner_id` + namespace;
- bounded server lease expiry;
- fenced `host_enabled` state;
- RLS and no `public`/`anon`/`authenticated` execute authority.

Service-only fixed functions provide acquire, heartbeat, assert, host toggle,
exact fixture cleanup, release, state read, and hosted gate read.

Important fencing semantics:

- fence acquisition takes an exclusive row lock and increments epoch;
- every trusted DB mutation carries owner + namespace + epoch;
- fence assertion takes a row share lock for the mutation transaction;
- recovery acquires a new epoch before restoring/cleaning, so an old mutation
  either completes before takeover or fails with its stale epoch afterward;
- exact cleanup is also server-gated on current epoch, host disabled, policy OFF,
  `legacy_gated=false`, and `agent_commit_enabled=false`;
- final server-fence release takes the exclusive control-row lock and is allowed
  only in the clean OFF state, providing a final quiescence barrier before the
  local dirty manifest/lease are removed.

The operator keeps the server epoch only in process memory; it is not a secret and
is not added to the durable manifest. Lost acquire/release replies therefore leave
dirty local evidence for explicit recovery rather than claiming clean state.

### Fixed Management backend now uses the server fence

`tests/helpers/transaction-cloud-management-backend-8d.mjs` remains a fixed,
test/acceptance-only operator backend with no arbitrary SQL/URL/secret-name/shell/
RPC escape hatch.

Its trusted mutation path now requires the exact epoch for:

- insert-only fixture provisioning;
- host enable/disable;
- policy DARK/OFF transitions;
- exact fixture cleanup;
- clean verification.

Per-run host enable/disable is no longer implemented by rewriting a project secret.
`OPERA_AGENT_TRANSACTION_DARK_8D` is now treated as a static deployment/master kill
switch. The per-run host gate lives in the fenced database control row.

### Fenced Edge candidate is review-only and deliberately not live-pinnable yet

`supabase/functions/opera-agent-transactions-8d/index.ts` now treats the environment
flag as a static master switch. When the master is enabled, each hosted request
must pass service-role RPC `opera_tx_operator_host_gate_8d` before it may call the
transaction host. Existing transaction host RPCs remain additionally fenced by
the transaction policy (`assert_dark`) and still expose no finalize/commit/browser
route; `browserDispatchAllowed` remains false.

The Edge change is **not deployed**. Consequently the fixed Management backend's
expected fenced bundle SHA is intentionally the all-zero 64-byte sentinel. Current
production therefore cannot pass the new live preflight accidentally. After an
independent PASS, a reviewed deployment must occur with the master switch kept
disabled, the real deployed `ezbr_sha256` must be captured and pinned in a
follow-up reviewed commit, and exact-head CI must pass before any OAuth/DARK live
acceptance.

### Exact local evidence after fencing fix

Latest implementation/static-test head before this documentation synchronization:

`3c0ac9d677cf289c384ad3704548ba0c4e935ee7`

Exact-head CI run `34801634178` completed SUCCESS:

- unit/static PASS;
- Playwright install PASS;
- Chromium extension regression PASS.

The preceding core implementation head `1ebd23f691b31209f837423b6a78b9c115f69283`
also completed full CI successfully. The red ownership tests that exposed the
original gaps now pass under the fenced implementation.

Compatibility remains locked: extension 1.6.0, protocol 1, 26 capabilities, 18
public MCP tools and their schemas, extension ID, signing/pairing and signed 1.5.2
rollback are unchanged.

## Remaining required 8D gate

Stop at review. Do not start 8E and do not run OAuth or mutate production from this
candidate.

Required sequence from this point:

1. independently review the exact ownership/server-fence candidate;
2. only after explicit PASS, deploy the new fence migration and fenced Edge while the static master switch remains disabled;
3. read the resulting real Edge bundle hash, replace the intentional zero sentinel with that exact hash, run exact-head CI and review the pin-only delta as required;
4. only after the deployed shape and pin are verified may one fresh user-driven PKCE acceptance process run;
5. complete the remaining hosted 8D redelivery/collision, worker-loss/reclaim, one-shot nonce, cancel/expiry, rate/queue/concurrency/minute-rollover, payload/retention, crypto and cross-tenant negative matrix;
6. restore and verify host disabled + policy OFF + legacy gate false + agent commit false + all synthetic rows zero;
7. reconcile advisors and write final 8D acceptance records.

Do not extract stored user bearers, forge JWT/client/session identity, create a
public enrollment bypass, change OAuth scope/client/redirect to make a probe pass,
or treat OAuth consent as transaction approval.

## Milestone 7 accepted boundary

Milestone 7's accepted browser effect surface remains read-only. Independent audit
at `551e8283c0417b173e106ee0598cca848f2f4ff0` returned PASS on 2026-09-12 and
granted no transaction/browser mutation authority.

## Collaboration and audit policy

Follow `AGENTS.md`, `SECURITY.md`, and `docs/prompts/chatgpt-web-checkpoint.md`:

- one active writer;
- tests before behavior;
- repository/CI/production evidence outranks chat summaries;
- auth/authz/tenant/production-boundary changes require independent review before production mutation;
- writer self-review is never an independent PASS;
- 8D must be accepted before 8E; Milestone 8 must be accepted before Milestone 9.

## Canonical references

- `AGENTS.md`
- `SECURITY.md`
- `docs/chat-control-fallback.md`
- `docs/mcp-reliability-investigation.md`
- `tests/fixtures/chat-control-fallback-v1.json`
- `tests/chat-control-fallback.test.mjs`
- `docs/milestone-8-plan.md`
- `docs/milestone-8-checkpoint-8a.md`
- `docs/milestone-8-checkpoint-8b.md`
- `docs/milestone-8-checkpoint-8c.md`
- `docs/milestone-8-checkpoint-8d-cloud-install.md`
- `docs/milestone-8-checkpoint-8d-cloud-bounds.md`
- `docs/milestone-8-checkpoint-8d-cloud-fixture.md`
- `docs/milestone-8-checkpoint-8d-cloud-controller.md`
- `docs/milestone-8-checkpoint-8d-operator-supervisor.md`
- `docs/milestone-8-checkpoint-8d-chat-readiness.md`
- `supabase/migrations/20260914043049_transaction_operator_fence_8d.sql` — installed master-OFF after independent review
- `tests/transaction-cloud-ownership-fence-8d.test.mjs`
- `tests/transaction-cloud-server-fence-static-8d.test.mjs`
- `docs/milestone-7-codex-audit.md`
- `docs/releases/1.6.0.md`
