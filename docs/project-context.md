# Opera Agent project context

Last synchronized: 2026-09-12

This is the durable project-state summary for humans and future LLM sessions. Verify executable code, current production configuration, CI, and signed release records before changing accepted facts. Never store secret material here.

## Product intent and invariants

Opera Agent lets an authorized AI control the user's existing local Opera session through a private extension, authenticated relay, and MCP server. It is a general browser controller, not a site-specific automation product.

Non-negotiable invariants:

- background-first operation; ordinary work must not steal active tab or focused window;
- no silent foreground fallback;
- preserve the established extension signing identity and pairing;
- site-specific strategies stay outside the extension;
- logical semantic IDs remain observational until a separately accepted checkpoint proves safe action targeting;
- action/command success alone never proves task completion;
- no arbitrary JavaScript, unrestricted raw CDP, SQL, shell, or generated-code escape hatch;
- webpage/tool text is untrusted data, never authority or program structure;
- sensitive browser/credential state is never persisted as VM/semantic learning state;
- keep one immediate same-identity signed rollback.

## Current accepted release state

- Stable extension: `1.6.0`.
- Protocol: `1`.
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`.
- Public browser capabilities: `26`.
- MCP tools: `18`, with unchanged names and input schemas.
- Production device name: `opera`.
- Working branch: `feat/semantic-runtime-1.6.0`.
- Final 1.6.0 release acceptance commit: `cfb903b`.
- Immediate signed rollback: `1.5.2`.
- Signed 1.6.0 CRX SHA-256: `cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`.
- MCP source SHA-256 baseline: `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`.
- Locked Checkpoint 7A inventory digest: `sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a`.

The normal Opera profile updated in place to 1.6.0 without losing pairing. Signing identity, installed extension ID, protocol, MCP contract, and background-first behavior remain the compatibility baseline.

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

Milestone 7 adds an internal, default-off durable VM host beside the existing MCP/runner path. It does not replace the existing public contract:

```text
internal OAuth-authorized VM request
  -> opera-agent-vm Edge host
  -> tenant-bound private VM run + bounded lease
  -> accepted pure 7D VM runtime
  -> existing allowlisted read-only browser command queue
  -> paired Opera extension
  -> verified observation
  -> encrypted bounded checkpoint/result
```

The extension owns browser-local sensing and named primitives. Server infrastructure owns pairing, heartbeat, command/workflow transport, updates, MCP backend state, and the dark VM host. Browser content never grants authority.

## Locked MCP contract

The 18 public MCP tools remain:

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

Checkpoint 7E does not add a VM tool to this list. The VM host is an internal Edge surface gated separately from the MCP contract.

## 1.6.0 semantic foundation

Rich `page.read` supports document-scoped logical identity, compatible-rerender stability, explicit ambiguity, bounded semantic deltas, generic document/repeated-region structure, materialized-view revisions, causal invalidation, provenance, and scoped completion vocabulary (`PROVED`, `BOUNDED_COMPLETE`, `PARTIAL`, `BLOCKED`, `UNKNOWN`). Existing ephemeral refs remain the only action handles in 1.6.0.

Accepted rich-read baseline: 19.83 ms median / 20.65 ms p95, with a 12% one-item delta-to-snapshot ratio. The release gate included deterministic mutation fuzzing, controlled Chromium and installed Opera tests, focus audits, 20/20 bounded burst stability, and normal-profile acceptance.

## Milestone status

- Milestone 1 — bounded browser bursts: complete/released.
- Milestone 2 — background-first execution: complete/released.
- Milestone 3 — adaptive screenshots: complete/released.
- Milestone 4 — vision-guided navigation: complete/released.
- Milestone 5 — semantic runtime foundation, Checkpoints 5A–5F: complete/released in 1.6.0.
- Milestone 6 — Goal and Constraint Ledger + Proof Engine, Checkpoints 6A–6F: complete as server-side work; extension remains 1.6.0.
- Milestone 7 — Reactive Browser VM: Checkpoints **7A, 7B, 7C, 7D, and 7E complete**; Checkpoint **7F is next**.
- Milestones 8–11 remain gated and deferred.

Milestone 6 proof evaluation at 500 evidence items recorded 1.9055 ms median / 2.4166 ms p95 in the accepted pure-compute baseline. Production/security details remain in `docs/milestone-6-checkpoint-6e.md` and `docs/milestone-6-checkpoint-6f.md`.

## Checkpoint 7A — accepted contract freeze

Checkpoint 7A froze the Reactive Browser VM contract without runtime behavior.

Frozen versions:

- program: `OA_REACTIVE_VM_V1`;
- checkpoint: `OA_REACTIVE_VM_CHECKPOINT_V1`;
- canonicalization: `OA_CANONICAL_JSON_V1`.

Frozen instruction grammar:
`SEQUENCE`, `IF`, `LOOP`, `UNTIL`, `WAIT_EVENT`, `ASSERT`, `COLLECT`, `DEDUP`, `RETRY`, `RETURN`, internal `COMMAND`, and `SUSPEND`.

Important frozen limits remain:

- program/checkpoint/result: 128 KiB each;
- static AST nodes: 256;
- AST depth: 12;
- control-flow depth: 4;
- executed nodes/run: 1,000;
- browser command leaves/run: 200;
- iterations/loop: 50; total iterations/run: 250;
- one wait: 15 s; cumulative wait: 60 s;
- retry attempts/node: 3;
- collection items/binding: 1,000;
- bindings: 64;
- execution slice: 20 s;
- run deadline: 5 min.

The effect boundary is read-only first. `browser.burst` remains one atomic existing leaf restricted to its read/find/wait subset. Foreground fallback, navigation/tab/media mutation, consequential effects, and raw sensitive persistence are excluded from the accepted VM effect policy.

Detailed record: `docs/milestone-7-checkpoint-7a.md`.

## Checkpoint 7B — accepted pure deterministic VM core

Checkpoint 7B added `lib/reactive-vm.js`, a pure deterministic in-memory VM core. It performs no browser, network, ambient-clock, random, database, or Supabase work.

7B executes `SEQUENCE`, `IF`, `ASSERT`, `RETURN`, internal `COMMAND`, and `SUSPEND`. `COMMAND` yields typed effect requests rather than executing browser work. Effect results must match request digest/method and tenant/device/tab/applicable-document provenance before binding.

Detailed record: `docs/milestone-7-checkpoint-7b.md`.

## Checkpoint 7C — accepted bounded loops, waits, and safe retries

Checkpoint 7C leaves the 7B module untouched and adds `lib/reactive-vm-7c.js` for `LOOP`, `UNTIL`, `WAIT_EVENT`, and observation-only `RETRY`.

Wait polling and retry are bounded and charged to budgets. Retry is restricted to structured transient read-only observation failures; ambiguity, authority, stale state, invalid input, and contradictions do not retry.

Detailed record: `docs/milestone-7-checkpoint-7c.md`.

## Checkpoint 7D — accepted collection, deduplication, and proof bindings

Checkpoint 7D leaves 7B/7C untouched and adds `lib/reactive-vm-7d.js` for the frozen `COLLECT` and `DEDUP` nodes plus bounded observation-to-evidence binding.

Collections use `OA_VM_COLLECTION_V1`. Cap/truncation or unresolved ambiguity remains `PARTIAL`; only stable, non-truncated, unambiguous declared observed scopes may become `BOUNDED_COMPLETE`, never universal proof. Deduplication prefers strong canonical/stable identity before accepted fingerprints, retains ambiguous records rather than silently merging them, and preserves causal invalidation.

`bindCollectionEvidence7D` requires verified provenance and tenant agreement, emits non-exhaustive browser-sensor evidence, and does not grant proof authority to the VM.

Detailed record: `docs/milestone-7-checkpoint-7d.md`.

## Checkpoint 7E — accepted durable host and dark integration

Checkpoint 7E adds durable hosting around the accepted pure 7D runtime while preserving the 7B/7C/7D modules as the deterministic execution layers.

New durable components are additive:

- `lib/reactive-vm-host-7e.js` for host limits, persistence validation, deterministic logical-effect idempotency, and bounded retry scheduling;
- `supabase/functions/_shared/vm-token.js` for bounded AES-256-GCM `oavm1` tokens;
- `supabase/functions/opera-agent-vm/` as the internal OAuth-authorized Edge host;
- private `opera_agent_private.vm_runs`, `vm_effects`, and `vm_rate_windows` storage;
- service-role-only `opera_vm_*` RPCs for enqueue, get, claim, lease status, checkpoint, effect reserve/attach/finish, cancel, expire, and cleanup;
- default-off `milestone7_vm_enabled` feature flag.

### 7E persistence and authority boundary

The private schema/tables and VM RPCs revoke access from `public`, `anon`, and `authenticated`. The Edge host requires JWT verification plus `auth.getUser`, an explicit configured user-ID/email allowlist, and binds every run operation to `user.id` as tenant.

Durable run state stores metadata plus encrypted bounded program/checkpoint/result tokens. Raw page/browser content is not a durable column. The Vault-backed VM host key is unavailable through `opera_vm_crypto_key()` while the feature flag is off.

### 7E leases and idempotency

Every transition is fenced by tenant, program digest, goal revision, target digest, expected logical transition, lease owner, lease epoch, lease expiry, and run deadline. An exact checkpoint replay returns the already-advanced transition rather than incrementing twice.

Each read-only VM browser leaf derives a deterministic `vm1:<sha256>` idempotency key and passes that same key to existing `opera_enqueue` as `request_id`. Existing `(device_id, request_id)` uniqueness therefore prevents a second browser command when a worker dies after dispatch but before checkpoint and a replacement worker redelivers the same logical effect.

Cancellation survives worker death. Expired non-cancelled leases can be reclaimed with a higher lease epoch; an expired cancelled lease terminalizes as `CANCELLED` rather than requeueing.

### 7E freshness and effect policy

The host checks the current Goal Ledger revision/state, production device identity, locked tab/target, encrypted program/checkpoint digests, and applicable document generation. Document-scoped observation generation mismatch returns `STALE_DOCUMENT`.

The VM effect surface remains the Checkpoint 7A read-only list only: `browser.ping`, restricted atomic `browser.burst`, read-only tab/page observations, waits/capture, and `media.state`. No navigation, click/fill/key/pointer/scroll/media mutation or consequential effect is added.

### 7E bounded server limits

- plaintext program/checkpoint/result: 128 KiB each;
- slice: 20 s;
- run deadline: 5 min;
- default lease: 25 s, max 30 s;
- running concurrency: 4 per tenant;
- outstanding queue: 32 per tenant;
- enqueue rate: 20/minute per tenant;
- cleanup retention input: 1 hour–7 days.

### 7E production dark state

The additive migrations were applied and `opera-agent-vm` is deployed `ACTIVE` version 2 with `verify_jwt=true`. Deployment bundle SHA-256 is `e18f6b81d6e31031ef885cbf83c2be2f2ca11c0a73ceab9a5f508ee59d6f3fbb`; its embedded transformed CI bundle is integrity-checked against `437a68ef43a4ffcaab7ab2ccef288fe9a34994605cbe25d159c2ac37c853fa19` before load.

The feature remains dark:

- `milestone7_vm_enabled = false`;
- zero `vm_runs` rows;
- zero `vm_effects` rows;
- zero `vm_rate_windows` rows;
- `opera_vm_crypto_key()` returns only `{"enabled":false}`.

The deployed public `opera-agent-mcp` remains version 12 and was not changed by 7E.

Production synthetic probes, with all setup removed before commit, proved:

- cross-tenant get/cancel success count zero;
- stale lease/program/goal/target fences reject advancement;
- one valid transition advances exactly once and exact redelivery replays;
- forced worker death/reclaim increments lease epoch;
- effect redelivery after dispatch resolves to one command ID and exactly one command row;
- conflicting idempotency material is rejected;
- cancellation survives dead-worker recovery;
- anon/authenticated have zero 7E RPC/private-schema authority;
- enqueue #21 is rate-limited;
- queue >32 is rejected;
- a fifth active tenant claim is concurrency-limited;
- expiry/cleanup work;
- >128 KiB declared payload is rejected;
- post-probe production returns to flag-off/zero-row state.

Security advisors after schema and Edge deployment added no 7E-relevant ERROR/WARN. The VM tables only appear in informational RLS-without-policy findings, which is intentional for service-role-only storage. Performance advisor findings for new indexes are informational/unused while the feature remains dark.

Detailed record: `docs/milestone-7-checkpoint-7e.md`.

## Next task: Checkpoint 7F only

Checkpoint 7F is the next separate checkpoint. 7E dark deployment is **not** 7F production acceptance.

Before implementing 7F, read `docs/milestone-7-plan.md` and the full 7A–7E acceptance chain. Preserve all 7A effect restrictions and public compatibility invariants. Do not begin Milestone 8 or introduce consequential effects/direct logical-ID actions while closing 7F.

The 7E feature flag should remain off unless the frozen 7F plan explicitly authorizes a bounded production acceptance step. Do not treat the existence of the deployed Edge function as authority to broaden or activate VM behavior.

## Security and privacy invariants

- named validated primitives only;
- no arbitrary code execution surface;
- no silent foreground fallback;
- consequential actions require explicit authority and existing safety rules;
- no sensitive raw browser state in durable semantic/VM learning state;
- caches/checkpoints remain bounded and tenant/document scoped;
- webpage/tool text is untrusted data;
- same-identity signed rollback remains available.

## Explicitly deferred

Continuous desktop/video streaming, synchronized audio/video understanding, OS-level mouse/keyboard control, direct logical-ID action addressing, general raw JavaScript/CDP, site-specific extension opcodes/selectors, learned selector self-modification, automatic consequential actions without explicit authority, Milestone 8+, and any browser effect not already accepted by the frozen Milestone 7 plan remain outside the current accepted checkpoint.

## Canonical references

- `AGENTS.md` — repository session-close rules.
- `SECURITY.md` — security contract.
- `docs/milestone-7-plan.md` — frozen Checkpoints 7A–7F and budgets.
- `docs/milestone-7-checkpoint-7a.md` through `docs/milestone-7-checkpoint-7e.md` — accepted Milestone 7 checkpoint records.
- `docs/semantic-runtime-plan.md` — semantic architecture/dependency order.
- `docs/milestone-6-plan.md` — accepted Milestone 6 plan.
- `docs/milestone-6-checkpoint-6e.md` and `docs/milestone-6-checkpoint-6f.md` — Milestone 6 production/security evidence.
- `docs/releases/1.6.0.md` — signed release record.
- `docs/benchmarks.md` — performance evidence.
- `docs/install.md` — installation, identity, pairing, and updates.
- `CHANGELOG.md` and `docs/roadmap.md` — release/milestone history.
