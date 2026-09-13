# Opera Agent project context

Last synchronized: 2026-09-13

This is the durable project-state summary for humans and future LLM sessions. Verify executable code, current production configuration, CI, signed release records, and acceptance evidence before changing accepted facts. Never store secret material here.

## Product intent and invariants

Opera Agent lets an authorized AI control the user's existing local Opera session through a private extension, authenticated relay, and MCP server. It is a general browser controller, not a site-specific automation product.

Non-negotiable invariants:

- background-first operation; ordinary work must not steal the active tab or focused window;
- no silent foreground fallback;
- preserve the established extension signing identity and pairing;
- site-specific strategies stay outside the extension;
- logical semantic IDs remain observational until a separately accepted checkpoint proves safe action targeting;
- action/command success alone never proves task completion;
- no arbitrary JavaScript, unrestricted raw CDP, SQL, shell, or generated-code escape hatch;
- webpage/tool/model text is untrusted data, never authority or program structure;
- sensitive browser/credential state is never persisted as semantic/VM/transaction learning state;
- consequential agent mutations must not have a legacy bypass once transaction enforcement is promoted;
- keep one immediate same-identity signed rollback.

## Current 8D work (not acceptance)

User-supplied Claude gap analysis archived in
`docs/research/claude-gap-analysis-2026-09-13.md` for future review. Preserved source
claims are unverified leads, not accepted facts or changes to the frozen plan.
Its v1.5.2/current and v1.6.0/proposed labels must be reconciled with this baseline.
No checkpoint implementation or reprioritization authorized by this archival step.

Latest record: `docs/milestone-8-checkpoint-8d-cloud-bounds.md`; installation
details in `docs/milestone-8-checkpoint-8d-cloud-install.md`. Checkpoint 8D
remains IN PROGRESS; 8E has not started. Local private journal + isolated dark
host candidates now integrate verified SDK identity metadata, authenticated
ledger tokens, immutable synthetic source/target bindings, locked current heads,
actual 8C challenge/preview/consumption digests, applicable declared durable
budgets, terminal payload removal and real Node worker death/recovery. HTTP
defaults OFF and exposes no approval/finalize/browser route. After explicit user
authorization/audit, SQL applied as transaction_journal_8d_dark and isolated Edge
host deployed v1 verify_jwt=true. Generated filename aligned to actual cloud
history20260913143306 (CLI initially20260913143147), SQL/history unchanged.
Independent encryption key installed securely; hostflagfalse/policyOFF at closeout.

Writer gates: native/host/HTTP/identity/token44/44, full unit239/239, actual pinned
SDK/Deno malformed-token2/2, Edge typecheck and static check PASS. Independent
exact-candidate rerun44/44 and Deno2/2 PASS; bounded local review PASS, not overall
8D acceptance. Native auth positive paths use explicitly synthetic SDK doubles;
neither these tests nor malformed-token rejection prove live signed OAuth.
Initial dark source/target authority is an immutable server-owned synthetic
registry, not a browser source collector. Nonempty ledger constraints/nonGoals
fail closed; generic clicks do not establish real-world predicates.

Fresh cloud checks: all12 tablesRLS, ordinary-role private tables/26 functions
denied; actual anon/auth RPC denial42501. Rolled-back cloud primitive15 assertions
PASS, enabled-host anon/malformedJWT rejectionPASS/OFF503 verified. All11 synthetic
data tables0, policyOFF singleton remains; M7 flagfalse/VM runs/effects/rates0.
Security after ERROR0/WARN31 inherited/INFO31 (+12 private RLS-no-policyINFO);
performanceINFO8 (+principal FK/2unused indexes), ERROR/WARN0. Fresh native44/44/
full239/239PASS. SignedOAuth positive/revocation/bound hosted prepare/recovery/full
cloud gates still open; installation/anon denial not overall8D acceptance.
Verify standard exact-head CI/Chromium and temporaryPR closure from artifacts.
No extension/public MCP/OAuth runtime, signing, pairing or workflow changes occurred.
Earlier admission/journal evidence is historical in its linked records.

Cloud quantitative continuation:8 grouped assertions PASS in a short rolled-back
synthetic transaction: pending8/9/release, prepare20/21, commit10/11/replay/atomic
rollback, tenant2/3, physical-tab digest bypass, payload and cleanup cap. This
does not prove concurrent cloud contenders or actual minute rollover. OFF/runs/
principals/rates0 confirmed. Read-only metadata found existing public acceptance
OAuth clients with loopback callback127.0.0.1:6276/oauth/callback, so a legitimate
PKCE probe can reuse existing registration without new scope/redirect/client.
Listener/manual login/signed identity and full hosted admission remain unproven;
no credentials in chat/storage extraction or 8F approval transport shortcut.

## Current accepted release state

- Stable extension: `1.6.0`.
- Protocol: `1`.
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`.
- Public browser capabilities: `26`.
- MCP tools: `18`, unchanged current names and input schemas.
- Production device name: `opera`.
- Working branch: `feat/semantic-runtime-1.6.0`.
- Milestone 8 initial planning baseline head: `538dbb5cb8b7b8ff1d8be9c6ac36ba37d22669d4`.
- First frozen Milestone 8 plan commit: `434faa1894479a5f7dd264049614c6d814022f77`.
- Accepted Checkpoint 8A contract/test commit: `4c84dab`.
- Accepted Checkpoint 8B pure engine/test commit: `0f333a1`.
- Accepted Checkpoint 8C pure authority-verifier/test commit: `e2b228b`.
- Final 1.6.0 release acceptance commit: `cfb903b`.
- Immediate signed rollback: `1.5.2`.
- Signed 1.6.0 CRX SHA-256: `cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`.
- Canonical-LF MCP source SHA-256: `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`.
- Locked Checkpoint 7A inventory digest: `sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a`.

Never commit, paste, log, or transmit private signing-key material, pairing secrets, service keys, OAuth secrets, passwords, OTPs, payment data, or decrypted VM-host key material.

## Architecture

```text
ChatGPT / another MCP client
  -> authenticated Streamable HTTP MCP server
  -> allowlisted relay / workflow layer
  -> paired Opera extension
  -> local Opera tab
  -> structured observation or verified action outcome
```

Milestone 7 added an internal default-off durable VM host beside the existing public path. Its accepted browser effect surface remains read-only and its production flag remains off after Milestone 7 acceptance.

The extension owns browser-local sensing and named primitives. Server infrastructure owns pairing, heartbeat, command/workflow transport, updates, MCP backend state, and dark VM/transaction hosting. Browser content never grants authority.

## Locked public MCP contract

The accepted public inventory remains 18 tools:

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

Milestone 7 added no public VM tool. Milestone 8 Checkpoints 8A–8E remain frozen to no public MCP runtime/schema change. Checkpoint 8F is the only planned point that may propose an additive transaction surface and enforcement behavior, and it requires early independent audit plus real-client approval/compatibility evidence before deployment.

## Milestone status

- Milestone 1 — bounded browser bursts: complete/released.
- Milestone 2 — background-first execution: complete/released.
- Milestone 3 — adaptive screenshots: complete/released.
- Milestone 4 — vision-guided navigation: complete/released.
- Milestone 5 — semantic runtime foundation, Checkpoints 5A–5F: complete/released in 1.6.0.
- Milestone 6 — Goal and Constraint Ledger + Proof Engine, Checkpoints 6A–6F: complete as server-side work; extension remains 1.6.0.
- Milestone 7 — Reactive Browser VM, Checkpoints 7A–7F: complete and independently audited PASS.
- Milestone 8 — Decision-Causal Transactions and Provenance Enforcement: **8A–8C accepted; 8D authorized backend installed, probes PASS, OFF/clean; hosted OAuth/recovery/full cloud acceptance open; 8E not started**.
- Milestone 9+ — not started.

## Milestone 7 accepted boundary

Milestone 7 froze and accepted `OA_REACTIVE_VM_V1`, `OA_REACTIVE_VM_CHECKPOINT_V1`, `OA_CANONICAL_JSON_V1`, a closed data-only grammar, deterministic pure runtime layers, bounded collection/proof binding, and a separate durable Supabase host.

The accepted VM effect surface remains read-only: `browser.ping`, restricted read/find/wait `browser.burst`, `tabs.list/get/find`, `page.read/query/find/collect_links/capture/wait_for`, and `media.state`. No navigation, tab mutation, click/fill/key/pointer/scroll/media mutation, consequential effect, direct logical-ID action, arbitrary JavaScript/raw CDP, or public VM MCP tool was accepted by Milestone 7.

The independent Codex audit at Milestone 7 final head `551e8283c0417b173e106ee0598cca848f2f4ff0` returned **PASS** on 2026-09-12. It grants no new browser authority and does not promote the VM flag.

## Production dark state after Milestone 7

Accepted closeout state:

- `milestone7_vm_enabled=false`;
- `vm_runs=0`;
- `vm_effects=0`;
- `vm_rate_windows=0`;
- temporary Milestone 7 command rows zero;
- device `opera` online on extension 1.6.0 / protocol 1 / 26 capabilities.

Milestone 8 planning/revision plus Checkpoints 8A–8B changed none of these production values and created no Milestone 8 production config/flag.

## Milestone 8 revised frozen plan

Authoritative plan: `docs/milestone-8-plan.md`.

The transaction lifecycle remains:

```text
PREPARE -> VALIDATE -> APPROVE(if required) -> COMMIT
        -> OBSERVE -> VERIFY -> RECEIPT
```

The first Codex review identified three blockers. Their reviewed resolution and
accepted8A–8C remain frozen. 8D has an authorized isolated backend, OFF/clean,
not overall acceptance; see the latest installation record.

### Enforcement/cutover boundary

Milestone 8 has logical policy modes `OFF`, `DARK`, and `ENFORCED`.

- `OFF`: no Milestone 8 transaction execution; accepted legacy behavior unchanged.
- `DARK`: only synthetic/internal transaction acceptance identities; no ordinary agent transaction commit authority.
- `ENFORCED`: if an agent receives transaction commit capability, every generic state-changing legacy tool for that same agent identity is gated. Direct mutation without trusted transaction-executor authority returns `TRANSACTION_REQUIRED` before browser dispatch.

There must never be a production state where the same agent can use the transaction path and bypass it through `open_url`, tab mutation, click/fill/key/scroll/pointer tools, or a mutating `run_browser_burst`. Observational tools remain compatible. Internal executor authority is server-derived, transaction-bound, and never exposed as an MCP argument/header/capability to the model. Any separate operator identity must be unavailable to the agent credential realm.

### V1 single-action rule

V1 contains at most **one state-changing commit action** and therefore at most one consequential external action per transaction. Read-only pre/post observations do not count as actions. Attempts to encode a second action reject before preparation.

Compensation is always a new transaction with its own transaction ID, prepare digest, authority/provenance checks, approval when required, idempotency/commit slot, observation, verification, and receipt. The original transaction cannot execute an inverse as an additional action or inherit approval for it.

### MCP 2026 approval binding

MCP `2026-07-28` is treated as stateless and explicit opt-in:

- no approval security depends on `Mcp-Session-Id`;
- modern client capabilities are checked on the current request;
- missing required form-elicitation capability returns `-32021 MissingRequiredClientCapability` and advances no transaction state;
- confirmation uses `resultType: input_required`, bounded `inputRequests`, opaque verified `requestState`, and the retry's per-round `inputResponses`;
- the JSON-RPC request ID may change on retry and is not authority;
- approval challenge state binds authenticated user, trusted OAuth client identity, tenant, transaction ID, prepare/preview digests, nonce, and expiry;
- self-reported MCP `clientInfo` is not OAuth client identity;
- V1 permits one approval MRTR round.

Legacy initialize-era clients may use a compatible elicitation shim only when the transport can render actual user confirmation. `Mcp-Session-Id` may route legacy transport but is not approval authority. Incapable legacy/stateless clients fail cleanly; there is no fallback to model prose.

Actual ChatGPT confirmation remains mandatory in Checkpoint 8F. If ChatGPT cannot visibly elicit a real user decision, consequential production commit remains unavailable.

### Authority/provenance/recovery summary

- Goal/Constraint Ledger = intent/constraint authority.
- Observations/page/tool/model output = facts/operands/evidence only, never new authority.
- Prepared transaction = exact narrow candidate authority for one action.
- User approval = fresh one-shot authority bound to exact challenge/prepare state.
- OAuth consent = client connection authorization, not transaction approval.
- Proof Engine = completion authority.
- Transaction/command receipt = process evidence only.
- Every consequential action input carries bounded provenance; only explicit user/ledger/trusted-policy sources may carry `AUTHORITY`.
- Crash recovery reuses one deterministic `tx1:` identity and underlying command request ID.
- Unknown post-dispatch completion becomes `AMBIGUOUS` and is reconciled read-only; irreversible/unknown work is not blindly redispatched.
- Cancellation before dispatch guarantees zero transaction mutation; after dispatch it does not claim undo.

## Checkpoint 8B accepted boundary

The pure `lib/transaction-prepare.js` module now prepares and validates immutable singular-action envelopes, compiles deterministic predicate dependency fingerprints, plans selective or fail-closed revalidation, generates bounded digest-only previews, conservatively classifies generic primitives as `IRREVERSIBLE_OR_UNKNOWN`, and decides direct-tool/transaction availability under `OFF`/`DARK`/`ENFORCED`.

Identical inputs reproduce the accepted 8A prepared fixture byte-for-byte. The module receives timestamps explicitly and performs no browser, network, database, ambient-clock, approval, commit, receipt, proof, or production work. The full suite is 193/193 and the measured 64-predicate revalidation p95 is `0.0324 ms` on the recorded local Node 22 run.

An 8A fixture erratum now supplies the originally required trusted effect-classification table. Every generic primitive defaults to `IRREVERSIBLE_OR_UNKNOWN`; client-provided effect classes are untrusted and no narrower trusted descriptors are currently frozen.

## Checkpoint 8C accepted boundary

The pure `lib/transaction-authority.js` module now validates exact-bound provenance, prevents browser/tool/model/server-derived values from carrying authority, creates immutable OAuth-user approval challenges, and verifies modern one-round `requestState`/`inputResponses` decisions against every frozen security binding. TTL, capability, decline, tamper, stale provenance, and already-consumed nonce checks fail closed.

8C emits only a deterministic nonce-consumption claim. Durable atomic consumption, journal recovery, leases, and cross-worker replay protection remain 8D work and are not implied by the pure verifier. The full suite is 204/204. No public runtime or production path calls this module yet.

8D local preflight at `5933a6c1f2448fe82142bf83a68bc1d607ae4f79` reproduced two inherited boundaries: digest-valid imported challenges are not independently checked for the global approval TTL by the verifier, and provenance source labels/digests are not resolved against trusted ledger state. Neither diagnostic touched production or dispatched a browser action. This was a self-review, **not** the required independent audit. Durable authority admission remains prohibited pending independent review and tests-first remediation/candidate review. Record: `docs/milestone-8-checkpoint-8d-preflight.md`.

Separate read-only reviewer `independent_8d_gate` inspected `7270753eeddceabae7980a747e6716f2d2278c9a` and returned **CONDITIONAL PASS only for bounded local tests-first remediation/candidate construction**, not deployment or 8D acceptance. It independently reran 8C 11/11 and static checks, confirmed imported interval and source-authentication boundaries, and additionally reproduced ignored narrower declared prepare/total/approval lifetime budgets. Production still requires an actual SQL/host candidate, real PostgreSQL evidence, and independent exact-candidate review. Record: `docs/milestone-8-checkpoint-8d-independent-review.md`.

Local lifetime remediation is completed at implementation/test commit `07a217d`: preparation honors narrower prepare/total lifetime budgets, and shared creation/import approval interval validation honors global/declared TTL, prepared-window containment and exclusive expiry. Focused tests are 6/6; full Node regression is 210/210. Source authentication, actual argument/provenance coverage and atomic durable consumption remain unimplemented host prerequisites. No runtime/production integration was added. Next permitted unit is isolated local host/admission candidate construction after user continuation; 8D is not accepted. Record: `docs/milestone-8-checkpoint-8d-lifetime-remediation.md`.

## Revised frozen checkpoints

- 8A — contract, hostile corpus, enforcement policy, dual-era approval contract, and baseline; **accepted**. Record: `docs/milestone-8-checkpoint-8a.md`.
- 8B — pure single-action decision-causal prepare engine and enforcement decision logic; **accepted**. Record: `docs/milestone-8-checkpoint-8b.md`.
- 8C — provenance + approval challenge verifier with user/OAuth-client/requestState binding; **accepted**. Record: `docs/milestone-8-checkpoint-8c.md`.
- 8D — durable transaction/approval journal and dark Supabase host; early Codex before production mutation.
- 8E — controlled single-action executor; compensation only as a separate transaction.
- 8F — trusted dual-era approval transport + transaction enforcement cutover + MCP/OAuth compatibility; early Codex before deployment/promotion.
- 8G — bounded dark/live acceptance including bypass, modern/legacy confirmation, recovery, and cleanup.
- 8H — compatibility/performance closeout + independent milestone audit.

## Quantitative V1 summary

The full table is in `docs/milestone-8-plan.md`. Key limits now include: 64 KiB proposal, 128 KiB prepared state, 64 KiB receipt, exactly one state-changing/consequential action maximum, one approval MRTR round, 64 predicates, 128 provenance records, transform depth 8, 10-minute prepare/transaction lifetime, 2-minute approval lifetime, 30-second one-command timeout, 3 post-commit observation attempts, one concurrent commit per target tab, two concurrent committing transactions per tenant, and bounded rate/retention limits.

## Compatibility impact

### MCP

8A–8E do not change public MCP runtime/schema. 8F alone may propose additive transaction tools and enforcement behavior after early audit. Existing 18 names/input schemas remain locked. Observational tools stay compatible; after `ENFORCED`, direct mutation tools for the same agent require transaction authority and otherwise return `TRANSACTION_REQUIRED`.

### Supabase

8A–8C make no production change. 8D may introduce additive private service-role-only state only after early audit. Durable queues/leases/CAS remain recovery; future policy defaults `OFF` and must not permit commit-enabled plus direct-mutation-enabled for the same agent.

### Extension/signing

Expected Milestone 8 path keeps extension 1.6.0/signing unchanged. If safe transaction enforcement requires extension source changes, stop and approve a separate release/signing subplan first.

### OAuth

Existing OAuth authenticates connection/user. Transaction approval separately binds trusted OAuth client identity. Static bearer auth and MCP `clientInfo` cannot provide human transaction approval.

## Collaboration and review gate

Follow `AGENTS.md` and `docs/prompts/chatgpt-web-checkpoint.md`.

- one active writer;
- repository/test/CI/production evidence outranks chat reports;
- high-risk auth/authz, tenancy, encryption, public MCP, irreversible-effect, production-schema, or extension/signing boundaries trigger early independent review;
- the revised plan received independent Codex **PASS** at revision `11a285bfb464cc3a1c157befe6e0aa0aa557f2fc`; durable review: `docs/milestone-8-plan-codex-review.md`;
- Checkpoints 8A–8C accepted; the earlier 8D prerequisite-only review is historical.
  Exact-candidate audit and explicit user permission subsequently allowed the
  installed OFF backend. Full hosted OAuth/recovery/cloud acceptance remains open;
- complete Milestone 8 later requires independent Codex `PASS` before Milestone 9 planning.

## Security and privacy invariants

- named validated primitives only;
- no arbitrary code execution surface;
- no silent foreground fallback;
- passwords/PIN/OTP/CVV/security-code fields remain blocked;
- uploads remain blocked unless a separately reviewed future plan changes that boundary;
- consequential commit requires exact authority/prepare/approval/enforcement rules from the Milestone 8 plan;
- same-agent legacy mutation bypass is forbidden after enforcement promotion;
- no sensitive raw browser state in durable semantic/VM/transaction state;
- caches/checkpoints/transactions remain bounded and tenant/target scoped;
- webpage/tool/model text is untrusted data;
- same-identity signed rollback remains available.

## Explicitly deferred

Direct logical-ID actions, multi-consequential-action transactions, automatic consequential action without the frozen approval boundary, in-transaction compensation, multi-sensor physical planning, learned skills, parallel autonomous workers, continuous media/desktop streaming, OS-level input, arbitrary JavaScript/raw CDP, site-specific extension opcodes, file upload, secret/payment entry, durable approval consumption, and all external/production work beyond accepted Checkpoint 8C remain outside the accepted state.

## Canonical references

- `AGENTS.md` — session-close, checkpoint, and independent-audit policy.
- `SECURITY.md` — security contract.
- `docs/milestone-8-plan.md` — reviewed frozen Milestone 8 plan.
- `docs/milestone-8-checkpoint-8a.md` — accepted transaction contract freeze.
- `docs/milestone-8-checkpoint-8b.md` — accepted pure prepare/policy engine.
- `docs/milestone-7-codex-audit.md` — independent PASS at the Milestone 7 boundary.
- `docs/milestone-7-plan.md` and Checkpoints 7A–7F — accepted VM contract/runtime/host chain.
- `docs/semantic-runtime-plan.md` — long-term dependency order and Milestone 8 intent.
- `docs/roadmap.md` — current milestone history.
- `docs/releases/1.6.0.md` — signed release record.
