# Opera Agent project context

Last synchronized: 2026-09-12

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
- keep one immediate same-identity signed rollback.

## Current accepted release state

- Stable extension: `1.6.0`.
- Protocol: `1`.
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`.
- Public browser capabilities: `26`.
- MCP tools: `18`, unchanged current names and input schemas.
- Production device name: `opera`.
- Working branch: `feat/semantic-runtime-1.6.0`.
- Milestone 8 planning baseline head: `538dbb5cb8b7b8ff1d8be9c6ac36ba37d22669d4`.
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

Milestone 7 added an internal default-off durable VM host beside the existing public path:

```text
internal OAuth-authorized VM request
  -> opera-agent-vm Edge host
  -> tenant-bound private VM run + bounded lease
  -> accepted pure 7D VM runtime
  -> existing allowlisted read-only browser command queue
  -> paired Opera extension
  -> verified bounded observation
  -> encrypted bounded checkpoint/result
```

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

Milestone 7 added no public VM tool. Milestone 8 Checkpoints 8A–8E are also frozen to no public MCP change. Checkpoint 8F is the only planned point that may propose an additive transaction surface, and it requires early independent audit plus real-client approval/compatibility evidence before deployment.

## Milestone status

- Milestone 1 — bounded browser bursts: complete/released.
- Milestone 2 — background-first execution: complete/released.
- Milestone 3 — adaptive screenshots: complete/released.
- Milestone 4 — vision-guided navigation: complete/released.
- Milestone 5 — semantic runtime foundation, Checkpoints 5A–5F: complete/released in 1.6.0.
- Milestone 6 — Goal and Constraint Ledger + Proof Engine, Checkpoints 6A–6F: complete as server-side work; extension remains 1.6.0.
- Milestone 7 — Reactive Browser VM, Checkpoints 7A–7F: complete and independently audited PASS.
- Milestone 8 — Decision-Causal Transactions and Provenance Enforcement: **plan frozen for user review; implementation not started; Checkpoint 8A blocked pending explicit user approval**.
- Milestone 9+ — not started.

## Milestone 7 accepted boundary

Milestone 7 froze and accepted `OA_REACTIVE_VM_V1`, `OA_REACTIVE_VM_CHECKPOINT_V1`, `OA_CANONICAL_JSON_V1`, a closed data-only grammar, deterministic pure runtime layers, bounded collection/proof binding, and a separate durable Supabase host.

The durable host provides tenant/program/goal/target/tab/document/lease/logical-transition fences, AES-256-GCM bounded `oavm1` tokens, deterministic `vm1:<sha256>` effect idempotency reused as the existing command request ID, cancellation/expiry/reclaim, and bounded queue/rate/concurrency behavior.

The accepted VM effect surface remains read-only:

- `browser.ping`;
- restricted read/find/wait `browser.burst`;
- `tabs.list`, `tabs.get`, `tabs.find`;
- `page.read`, `page.query`, `page.find`, `page.collect_links`, `page.capture`, `page.wait_for`;
- `media.state`.

No navigation, tab mutation, click/fill/key/pointer/scroll/media mutation, consequential effect, direct logical-ID action, arbitrary JavaScript/raw CDP, or public VM MCP tool was accepted by Milestone 7.

The independent Codex audit at Milestone 7 final head `551e8283c0417b173e106ee0598cca848f2f4ff0` returned **PASS** on 2026-09-12. It reproduced the 171-test suite, static checks, focused 7F gates, controlled Chromium harness, Edge bundle, exact-head CI/temporary-PR cleanup, and production dark state. The audit grants no new browser authority and does not promote the VM flag.

## Production dark state after Milestone 7

Accepted closeout state:

- `milestone7_vm_enabled=false`;
- `vm_runs=0`;
- `vm_effects=0`;
- `vm_rate_windows=0`;
- temporary Milestone 7 command rows zero;
- device `opera` online on extension 1.6.0 / protocol 1 / 26 capabilities.

Milestone 8 planning changed none of these values and did not create a Milestone 8 feature flag.

## Milestone 8 frozen plan

Authoritative plan: `docs/milestone-8-plan.md`.

The transaction lifecycle is:

```text
PREPARE -> VALIDATE -> APPROVE(if required) -> COMMIT
        -> OBSERVE -> VERIFY -> RECEIPT
```

The authority split is frozen:

- Goal/Constraint Ledger = user intent and constraint authority;
- observations/page/tool/model output = facts/operands/evidence only, never new authority;
- prepared transaction = exact narrow candidate authority only;
- user approval = fresh one-shot authority bound to the exact prepared digest;
- OAuth consent = client connection authorization, not transaction approval;
- Proof Engine = completion authority;
- transaction/command receipt = process evidence only.

Trusted effect classes are `READ_ONLY`, `LOCAL_REVERSIBLE`, `STAGED_EXTERNAL`, `COMPENSABLE_EXTERNAL`, and `IRREVERSIBLE_OR_UNKNOWN`. Unknown defaults to the strongest review path; generic click/fill/key/pointer/navigation is not inherently reversible just because the primitive is allowlisted.

Every consequential action input must carry bounded provenance. Only explicit user/ledger/trusted-policy sources may carry `AUTHORITY`. Browser/tool/model values can be operands or evidence but cannot grant permission. Any changed authority-bearing predicate, target, argument, provenance chain, effect class, or expected postcondition invalidates the prepared digest and its approval.

Crash recovery must reuse the same deterministic `tx1:` action identity and underlying command request ID. Unknown post-dispatch completion becomes `AMBIGUOUS` and is reconciled read-only; an irreversible/unknown action is never blindly re-dispatched. Compensation is a separately governed external effect, not database rollback.

Frozen checkpoints:

- 8A — contract, hostile corpus, and baseline; **blocked pending user approval**;
- 8B — pure decision-causal prepare engine;
- 8C — provenance and approval verifier;
- 8D — durable transaction journal/dark Supabase host, with early Codex gate before production mutation;
- 8E — controlled transaction executor and compensation semantics;
- 8F — trusted user approval transport + MCP/OAuth compatibility, with early Codex gate before deployment/promotion;
- 8G — bounded dark/live acceptance on synthetic/reversible fixtures;
- 8H — compatibility/performance closeout and independent milestone audit.

Milestone 8 does not absorb Milestone 9 physical planning, Milestone 10 learned skills, or Milestone 11 parallel workers.

## Milestone 8 compatibility decisions

### MCP

8A–8E retain the 18-tool public contract. 8F may propose additive `prepare_browser_transaction` / `commit_browser_transaction` tools only if real-client trustworthy confirmation can be proven. Existing 18 names/input schemas stay byte-for-byte compatible. No model-supplied `approved:true` substitute is permitted.

### Supabase

8A–8C make no production change. 8D may introduce additive private service-role-only transaction state only after early audit; it must be default-off and cleaned after probes. Durable queues/leases/CAS are the recovery mechanism, not in-memory Edge background tasks.

### Extension/signing

The expected path keeps extension 1.6.0 and the signing identity unchanged. If safe transaction execution requires extension source changes, stop and approve a separate version/release/signing subplan first. No private signing key material belongs in transaction state.

### OAuth/approval

Existing OAuth authenticates the connection/user. It is not transaction approval. Preferred approval is real client-mediated MCP input-required confirmation; a first-party OAuth-authenticated exact-digest approval page may be separately accepted as fallback. Static bearer authentication cannot satisfy human approval for consequential commit.

## Quantitative Milestone 8 V1 summary

The full table is in `docs/milestone-8-plan.md`. Key limits are: 64 KiB proposal, 128 KiB prepared state, 64 KiB receipt, 8 actions, 4 external consequential actions, at most 1 irreversible/unknown action, 64 predicates, 128 provenance records, 8 transform depth, 10-minute prepare/transaction lifetime, 2-minute approval lifetime, 30-second one-command timeout, 3 post-commit observation attempts, one concurrent commit per target tab, two concurrent committing transactions per tenant, and bounded rate/retention limits.

## Collaboration and audit policy

Follow `AGENTS.md` and `docs/prompts/chatgpt-web-checkpoint.md`.

- one active writer;
- one checkpoint per reviewed session;
- repository/test/CI/production evidence outranks chat reports;
- auth/authz, tenancy, encryption, signing, public MCP, extension distribution, irreversible effects, and production-schema boundaries trigger early independent audit;
- complete milestone requires independent Codex `PASS` before Milestone 9 planning.

## Security and privacy invariants

- named validated primitives only;
- no arbitrary code execution surface;
- no silent foreground fallback;
- passwords/PIN/OTP/CVV/security-code fields remain blocked;
- uploads remain blocked unless a separately reviewed future plan changes that boundary;
- consequential commit requires exact authority/prepare/approval rules from the Milestone 8 plan;
- no sensitive raw browser state in durable semantic/VM/transaction state;
- caches/checkpoints/transactions remain bounded and tenant/target scoped;
- webpage/tool/model text is untrusted data;
- same-identity signed rollback remains available.

## Explicitly deferred

Direct logical-ID actions, automatic consequential action without the frozen approval boundary, multi-sensor physical planning, learned skills, parallel autonomous workers, continuous media/desktop streaming, OS-level input, arbitrary JavaScript/raw CDP, site-specific extension opcodes, file upload, secret/payment entry, and any implementation of Milestone 8 before user approval remain outside the current accepted state.

## Canonical references

- `AGENTS.md` — session-close, checkpoint, and independent-audit policy.
- `SECURITY.md` — security contract.
- `docs/milestone-8-plan.md` — frozen Milestone 8 plan awaiting user approval.
- `docs/milestone-7-codex-audit.md` — independent PASS at the Milestone 7 boundary.
- `docs/milestone-7-plan.md` and Checkpoints 7A–7F — accepted VM contract/runtime/host chain.
- `docs/semantic-runtime-plan.md` — long-term dependency order and Milestone 8 intent.
- `docs/roadmap.md` — current milestone status.
- `docs/releases/1.6.0.md` — signed release record.
- `docs/benchmarks.md` — performance evidence.
- `docs/install.md` — installation, identity, pairing, and updates.
