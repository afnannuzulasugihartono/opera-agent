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

## Current Checkpoint 8D production boundary

8D is the first production-shape transaction checkpoint and remains open. Earlier
explicitly authorized installation created only the isolated dark backend:

- migration `transaction_journal_8d_dark` is applied; repository history file is `20260913143306_transaction_journal_8d_dark.sql`;
- Edge `opera-agent-transactions-8d` v1 is installed with `verify_jwt=true`;
- an independent transaction-journal encryption key was installed securely;
- accepted closeout state from the installation/probe sessions was host flag false, transaction policy `OFF`, `legacy_gated=false`, `agent_commit_enabled=false`;
- all 11 synthetic data tables were zero at that closeout; the policy singleton remained intentionally;
- Milestone 7 VM flag was false and VM run/effect/rate tables were zero;
- rolled-back real-cloud primitive probe passed 15 assertions;
- enabled-host anon and malformed-JWT denial passed; final OFF anon response was 503 `TRANSACTION_DISABLED` with `dispatch=false`;
- ordinary-role RPC access was denied; private transaction tables use RLS/no client policies;
- earlier security advisor check had no ERROR and inherited WARNs; performance had no ERROR/WARN, with informational private-RLS/index findings retained for later reconciliation.

Those production values are **inherited evidence, not freshly reverified by the
latest local operator/supervisor work**. Do not infer current cloud state from chat;
read it before any future live probe.

## Current 8D local hosted-acceptance chain

The test-only hosted-acceptance controller in
`tests/helpers/transaction-cloud-controller-8d.mjs` already implements the bounded
sequence against injected trusted adapters:

`preflight -> SDK identity snapshot -> ownership -> fixture/session binding -> ledger seal -> enable/DARK -> prepare/replay/status/cancel/replay/status -> cancelled payload check -> OFF/exact cleanup/verify`.

Its controller tests previously passed focused 36/36 and full 275/275 at the prior
exact head; standard CI run `34789183097` was successful including static and
Chromium. This proves only that earlier local controller candidate, not overall 8D.

### Latest local operator ownership/recovery candidate

Record: `docs/milestone-8-checkpoint-8d-operator-supervisor.md`.

`tests/helpers/transaction-cloud-operator-8d.mjs` now supplies the missing LOCAL
fixed-project operator/supervisor boundary used by future acceptance wiring. It is
test-only and accepts only the existing eleven controller operator methods. It
adds no generic SQL/shell/command/URL/model/page supplied operation and no public
API.

The target is pinned to project `nenmkmtvjremqphfqnfw`, the existing OAuth client,
and loopback callback before owned mutation. Durable local ownership stores only
nonsecret exact cleanup identifiers and phase. One global lease and one dirty
manifest provide fail-closed crash evidence. A pending manifest blocks a fresh
run. Lease expiry alone cannot steal ownership from a still-live local PID; an
expired dead owner may be reclaimed. Ownership rechecks the durable manifest after
lease acquisition so a process that passed an earlier preflight cannot overwrite
a crashed peer's manifest.

The local phase machine is:

`OWNED -> INSTALLED -> SEALED -> HOST_ENABLED -> DARK -> CLEANING`.

Host/policy/cleanup calls require durable ownership. Fixture scope must match the
manifest. The injected backend's exact server-session check must return a live
user/client/session binding before insert-only provisioning is allowed. Ledger
scope must match the owned tenant/goal before the injected existing crypto sealer
may run. Tokens/keys/session identity are never placed in the manifest.

Abort handling is quiescent rather than Promise.race based: an in-flight backend
operation settles before the next mutation can begin. Lost replies retain dirty
ownership. Recovery reclaims exclusive control, re-pins the target, writes
`CLEANING`, attempts host disable and policy OFF, and **will not delete fixture
rows if either control-plane safety operation fails**. PASS requires host false,
mode OFF, zero exact-owned rows, zero payload rows, `agentCommitEnabled=false`,
and `legacyGated=false`; only then are manifest and lease removed. Failed/unknown
recovery keeps dirty evidence.

Writer-local focused evidence before the repository commit: **14/14 PASS, zero
skips**, including a real child-process-death persistence case, lost reply,
aborted-session quiescence, failed control-plane recovery, live-PID lease fencing,
and the post-lease manifest race. Helper SHA-256:
`f34dc7b1a4d5408087980b95968bd74432621dc64be93fdbb46c1a3270ce08b9`.
Test SHA-256:
`38ff23f3c22a61369ef5c121e8080354f9028eebac8a3c29688da7bc7fe0d872`.

This is **not** a live operator backend, not production crash-recovery evidence,
and not overall 8D acceptance. The injected backend still must be independently
reviewed and then bound to the existing secure operator credential realm and exact
production operations before fresh OAuth/live DARK acceptance. No fresh OAuth,
production query/mutation, deployment, key access, browser action, extension,
public MCP, signing, pairing, CRX, or release change was made by this local unit.

## Required next 8D gate

Before another login or live production enablement:

1. independently audit the exact operator/supervisor runner candidate and its fixed backend wiring;
2. only after PASS, bind it to existing service/operator authority for exact preflight, real Auth-session check, insert-only synthetic fixture install, existing ledger sealing, host/DARK control, exact cleanup, and clean verification;
3. perform a fresh user-driven PKCE login with memory-only bearer and signed SDK claim/user verification in the same bounded process;
4. exercise the authenticated hosted prepare/replay/status/cancel path with no browser dispatch;
5. prove legitimate negative/revocation paths, hosted worker loss/reclaim/nonce durability, remaining cloud concurrency/quota/minute-rollover/payload/retention/crypto gates;
6. restore and verify host false + policy OFF + exact-owned rows zero;
7. reconcile advisors and perform final independent 8D review.

Do not extract a stored user bearer, forge JWT/client/session identity, invent a
new public enrollment endpoint, change OAuth scope/client/redirect to bypass the
gate, or treat OAuth consent as 8F transaction approval. If the existing legitimate
OAuth path cannot support the probe, stop for a reviewed acceptance approach.

## Milestone 7 accepted boundary

Milestone 7 froze `OA_REACTIVE_VM_V1`, `OA_REACTIVE_VM_CHECKPOINT_V1`, and
`OA_CANONICAL_JSON_V1`, a closed data-only grammar, deterministic runtime, bounded
collection/proof binding, and a separate durable Supabase host. Its accepted
browser effect surface is read-only. The independent Milestone 7 Codex audit at
`551e8283c0417b173e106ee0598cca848f2f4ff0` returned PASS on 2026-09-12 and granted
no new browser mutation authority.

Accepted Milestone 7 production closeout remains historically:
`milestone7_vm_enabled=false`, `vm_runs=0`, `vm_effects=0`, `vm_rate_windows=0`,
temporary command rows zero, device `opera` on extension 1.6.0/protocol1/26
capabilities.

## Collaboration and audit policy

Follow `AGENTS.md` and `docs/prompts/chatgpt-web-checkpoint.md`:

- one active writer on the milestone branch;
- repository/test/CI/production evidence outranks model reports;
- deterministic failing tests precede new runtime behavior;
- early independent audit is required before production mutation when auth/authz, tenant isolation, encryption, signing, public MCP schemas, irreversible actions, or production DB shape are affected;
- the frozen Milestone 8 plan itself received independent Codex PASS at revision `11a285bfb464cc3a1c157befe6e0aa0aa557f2fc`;
- complete Milestone 8 later requires independent PASS before Milestone 9.

The current ChatGPT writer may complete bounded local 8D engineering and exact-head
CI without repeatedly invoking Codex. The independent audit remains a gate before
the next live OAuth/production acceptance boundary; it is not removed or bypassed.

## Canonical references

- `AGENTS.md` — session-close, checkpoint, writer, and audit policy.
- `SECURITY.md` — security contract.
- `docs/milestone-8-plan.md` — reviewed frozen Milestone 8 plan.
- `docs/milestone-8-plan-codex-review.md` — plan review.
- `docs/milestone-8-checkpoint-8a.md` — accepted transaction contract.
- `docs/milestone-8-checkpoint-8b.md` — accepted pure prepare/policy engine.
- `docs/milestone-8-checkpoint-8c.md` — accepted provenance/approval verifier.
- `docs/milestone-8-checkpoint-8d-cloud-install.md` — installed OFF backend record.
- `docs/milestone-8-checkpoint-8d-cloud-fixture.md` — production-shaped synthetic DATA boundary.
- `docs/milestone-8-checkpoint-8d-cloud-controller.md` — local hosted-acceptance controller.
- `docs/milestone-8-checkpoint-8d-operator-supervisor.md` — latest local ownership/recovery candidate.
- `docs/milestone-7-codex-audit.md` — independent Milestone 7 PASS.
- `docs/semantic-runtime-plan.md` and `docs/roadmap.md` — dependency/history references.
- `docs/releases/1.6.0.md` — signed release record.
