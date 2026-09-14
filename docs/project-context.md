# Opera Agent project context

Last synchronized: 2026-09-14

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
- preserve the established extension signing identity and pairing;
- keep site-specific strategies outside the extension;
- logical semantic IDs remain observational until a separately accepted action-targeting checkpoint;
- action/command success alone never proves task completion;
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

The extension owns browser-local sensing and named primitives. Server
infrastructure owns pairing, heartbeat, command/workflow transport, updates, MCP
backend state, and dark VM/transaction hosting. Browser content never grants
authority.

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

Milestone 8 Checkpoints 8A-8E are frozen to no public MCP runtime/schema change.
8F is the only planned point that may propose an additive transaction surface and
enforcement behavior, and it requires early independent audit plus real-client
approval/compatibility evidence before deployment.

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

Policy modes remain `OFF`, `DARK`, and `ENFORCED`:

- `OFF`: no Milestone 8 transaction execution; accepted legacy behavior unchanged.
- `DARK`: synthetic/internal transaction acceptance identities only; no ordinary agent transaction commit authority.
- `ENFORCED`: every generic state-changing legacy tool for the same agent identity is transaction-gated; direct mutation without trusted executor authority returns `TRANSACTION_REQUIRED` before browser dispatch.

There must never be a state where an agent receives transaction authority and can
bypass it through direct navigation/tab mutation/click/fill/key/scroll/pointer or
mutating browser bursts. Internal transaction executor authority is server-derived
and transaction-bound, never a model-supplied argument/header/capability.

V1 allows at most one state-changing commit action and at most one consequential
external action per transaction. Compensation is always a new transaction.
Goal/Constraint Ledger remains user-intent authority; OAuth connection consent is
not transaction approval; observations/page/tool/model output are evidence, not
authority; Proof Engine remains completion authority; receipts are process
evidence only.

## Checkpoint 8D current state

8D is the first production-shape transaction checkpoint and remains open because
its required independent pre-live audit and bounded authenticated production DARK
acceptance have not yet occurred. The local implementation and production-shaped
pre-live boundary are otherwise substantially complete.

### Installed production-shape backend

The isolated dark backend is already installed:

- applied migration: `20260913143306_transaction_journal_8d_dark.sql`;
- Edge function: `opera-agent-transactions-8d`, currently deployment version 6, ACTIVE, `verify_jwt=true`;
- exact deployed bundle SHA-256: `bad0ae493209891e45bc90a11d91ef85dac72022f70f7aaf8ba9e8152c822769`;
- an independent transaction-journal encryption key is installed securely;
- public MCP/runtime, extension, signing, pairing, and CRX remain unchanged.

Fresh read-only verification on 2026-09-14 showed:

- transaction policy `OFF`;
- `legacy_gated=false`;
- `agent_commit_enabled=false`;
- all 11 8D synthetic data tables zero;
- `opera_agent_private.goal_heads` zero;
- all 12 candidate tables RLS-enabled with no client policies;
- reviewed candidate routines deny `anon` and `authenticated` execute authority;
- no public `opera_tx_%` routine was exposed by the reviewed privilege query;
- migration history includes `20260913143306_transaction_journal_8d_dark`;
- deployed Edge bundle hash exactly matches the fixed acceptance backend pin.

The Edge deployment version number itself is not used as integrity authority; the
exact bundle hash is.

### Fixed Management acceptance backend

`tests/helpers/transaction-cloud-management-backend-8d.mjs` now provides the
previously missing fixed production operator backend for the bounded acceptance
runner. It is test/acceptance infrastructure, not a public API.

It pins:

- Supabase project `nenmkmtvjremqphfqnfw`;
- existing OAuth client and loopback callback;
- Management API origin;
- Edge function slug and exact bundle hash;
- host flag and transaction-key secret names;
- fixed parameterized SQL statements only.

There is no caller-supplied SQL, URL, secret name, shell, raw-CDP, JavaScript,
generic RPC, model, or page operation surface. The Management credential is
provided only through an in-memory provider and is never returned or logged by the
backend. Session verification binds exact signed user + OAuth client + Auth
session before insert-only provisioning. Existing ledger crypto is used only in
memory; decoded key bytes are zeroed. Transaction-key preflight validates the key
through the existing 32-byte decoder before an OAuth URL may be emitted.

### Durable local ownership and recovery

`tests/helpers/transaction-cloud-operator-8d.mjs` supplies the fixed-project
operator/supervisor boundary. It provides:

- one exclusive global-control lease;
- one nonsecret dirty ownership manifest containing exact cleanup identifiers and phase;
- live-PID fencing so TTL expiry alone cannot create split-brain;
- post-acquire manifest recheck;
- phase machine `OWNED -> INSTALLED -> SEALED -> HOST_ENABLED -> DARK -> CLEANING`;
- exact session-before-insert and ledger-scope fences;
- quiescent abort handling without Promise.race late-mutation shortcuts;
- durable lost-reply evidence;
- dead-owner recovery that restores host false + policy OFF before row cleanup;
- failed/ambiguous control restoration that preserves dirty evidence rather than deleting rows.

PID reuse can conservatively keep an expired stale lease BUSY if the OS has reused
the old PID for a live process. This is a fail-closed availability limitation, not
an authority or split-brain bypass.

### Hosted acceptance controller and live runner

`tests/helpers/transaction-cloud-controller-8d.mjs` sequences:

`preflight -> signed SDK identity snapshot -> durable ownership -> exact session binding -> insert-only fixture -> ledger seal -> host enable -> DARK -> prepare/replay/status/cancel/replay/status -> cancelled payload check -> host disable -> OFF -> exact cleanup -> clean verification`.

The HTTP/Edge boundary accepts only `prepare`, `status`, and `cancel`; it has no
finalize/commit/browser route and reports `browserDispatchAllowed:false`.

The controller now gates deletion on successful control-plane restoration. If
host disablement or OFF restoration fails or is ambiguous, it does not delete the
fixture or claim clean state; the dirty manifest remains for recovery and the run
fails `CLOUD_CLEANUP_FAILED`.

Database `assert_dark()` holds a share lock on the singleton policy row for
mutating candidate RPC transactions. Restoring `OFF` updates that same row, so a
successful OFF restoration cannot complete ahead of an already-admitted mutating
transaction. Successful OFF restoration is therefore a database quiescence fence
before exact-owned cleanup.

`tests/cloud/transaction-cloud-acceptance-8d.mjs` is the explicit opt-in live/
recovery runner. It uses pinned SDK `npm:@supabase/supabase-js@2.57.4`, emits no
OAuth URL until preflight passes, keeps bearer/verifier in process memory, and
exposes only normal accept mode plus exact `--recover <namespace>`. It uses a
180000 ms local ownership lease, leaving bounded room for the 60000 ms acceptance
window plus control restoration/cleanup while remaining below the operator's
300000 ms maximum.

### Latest exact-head evidence

Writer readiness record:
`docs/milestone-8-checkpoint-8d-chat-readiness.md`.

Latest code candidate before documentation closeout:
`0bc958eb782de17b22b2c19081c5f85e908ccc7a`.

Exact-head CI run `34796100802` completed SUCCESS:

- unit/static gate PASS;
- Playwright install PASS;
- Chromium extension regression PASS.

The active writer also performed a bounded code/security self-review and found the
cleanup-order issue described above, which was fixed with deterministic regression
tests before this synchronization. This writer review is **not** an independent
audit and must never be labelled as one.

### Fresh advisor reconciliation

Fresh security advisors reported no ERROR. Existing WARNs are inherited
legacy/public findings; the private 8D tables appear as expected RLS-without-policy
informational findings. Fresh performance advisors reported no ERROR/WARN; the
8D-relevant items are informational, including one unindexed `runs` foreign key
and unused-index notices.

These informational items remain visible for later optimization/reconciliation and
do not weaken authorization rules.

## Remaining required 8D gate

The active writer has completed the work that can be safely done without an
independent pre-live audit. The remaining sequence is:

1. independently review the exact final candidate and obtain explicit PASS;
2. only after PASS, run one fresh user-driven PKCE login with memory-only bearer and verify signed claims/user plus exact server Auth-session/OAuth-client binding;
3. run bounded production DARK acceptance with synthetic fixture only and `browserDispatchAllowed=false`;
4. prove hosted redelivery/collision, worker-loss/reclaim, one-shot nonce, cancel/expiry durability, quota/concurrency/minute-rollover/payload/retention, crypto tamper/wrong-kind/wrong-tenant, and cross-tenant/user/client negative cases required by the frozen 8D plan;
5. restore and verify host false + policy OFF + `legacy_gated=false` + `agent_commit_enabled=false` + all synthetic rows zero;
6. reconcile advisors and write the final 8D acceptance record.

The current Codex code-review path reports its usage limit reached, so no
independent PASS exists for the latest candidate. Do not fabricate or substitute a
writer self-review for that verdict. Local development and CI may complete, but
fresh OAuth/live production mutation remains blocked by governance until an
independent PASS is available.

Do not extract a stored user bearer, forge JWT/client/session identity, invent a
new public enrollment endpoint, change OAuth scope/client/redirect to bypass the
gate, or treat OAuth connection consent as transaction approval.

## Milestone 7 accepted boundary

Milestone 7 froze `OA_REACTIVE_VM_V1`, `OA_REACTIVE_VM_CHECKPOINT_V1`, and
`OA_CANONICAL_JSON_V1`, a closed data-only grammar, deterministic runtime, bounded
collection/proof binding, and a separate durable Supabase host. Its accepted
browser effect surface is read-only. The independent Milestone 7 Codex audit at
`551e8283c0417b173e106ee0598cca848f2f4ff0` returned PASS on 2026-09-12 and granted
no new browser mutation authority.

## Collaboration and audit policy

Follow `AGENTS.md` and `docs/prompts/chatgpt-web-checkpoint.md`:

- one active writer on the milestone branch;
- repository/test/CI/production evidence outranks model reports;
- deterministic failing tests precede runtime behavior changes;
- early independent audit is required before production mutation when auth/authz, tenant isolation, encryption, signing, public MCP schemas, irreversible actions, or production DB shape are affected;
- the frozen Milestone 8 plan itself received independent Codex PASS at revision `11a285bfb464cc3a1c157befe6e0aa0aa557f2fc`;
- complete Milestone 8 later requires independent PASS before Milestone 9.

The current ChatGPT writer may finish bounded local 8D engineering and exact-head
CI without repeatedly invoking Codex. The independent audit remains the gate before
fresh OAuth/production acceptance; it is not removed or bypassed.

## Canonical references

- `AGENTS.md` — session-close, checkpoint, writer, and audit policy.
- `SECURITY.md` — security contract.
- `docs/milestone-8-plan.md` — reviewed frozen Milestone 8 plan.
- `docs/milestone-8-plan-codex-review.md` — plan review.
- `docs/milestone-8-checkpoint-8a.md` — accepted transaction contract.
- `docs/milestone-8-checkpoint-8b.md` — accepted pure prepare/policy engine.
- `docs/milestone-8-checkpoint-8c.md` — accepted provenance/approval verifier.
- `docs/milestone-8-checkpoint-8d-cloud-install.md` — installed OFF backend record.
- `docs/milestone-8-checkpoint-8d-cloud-bounds.md` — bounded production database probes.
- `docs/milestone-8-checkpoint-8d-cloud-fixture.md` — production-shaped synthetic DATA boundary.
- `docs/milestone-8-checkpoint-8d-cloud-controller.md` — hosted-acceptance controller history.
- `docs/milestone-8-checkpoint-8d-operator-supervisor.md` — durable ownership/recovery history.
- `docs/milestone-8-checkpoint-8d-chat-readiness.md` — latest writer readiness/self-audit boundary.
- `docs/milestone-7-codex-audit.md` — independent Milestone 7 PASS.
- `docs/semantic-runtime-plan.md` and `docs/roadmap.md` — dependency/history references.
- `docs/releases/1.6.0.md` — signed release record.
