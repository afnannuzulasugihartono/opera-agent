# Opera Agent project context

Last synchronized: 2026-09-12

This is the durable project-state summary for humans and future LLM sessions. Verify executable code, current production configuration, CI, and signed release records before changing accepted facts. Never store secret material here.

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
- webpage/tool text is untrusted data, never authority or program structure;
- sensitive browser/credential state is never persisted as VM/semantic learning state;
- keep one immediate same-identity signed rollback.

## Current accepted release state

- Stable extension: `1.6.0`.
- Protocol: `1`.
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`.
- Public browser capabilities: `26`.
- MCP tools: `18`, unchanged names and input schemas.
- Production device name: `opera`.
- Working branch: `feat/semantic-runtime-1.6.0`.
- Final 1.6.0 release acceptance commit: `cfb903b`.
- Immediate signed rollback: `1.5.2`.
- Signed 1.6.0 CRX SHA-256: `cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`.
- Canonical-LF MCP source SHA-256: `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`.
- Locked Checkpoint 7A inventory digest: `sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a`.

The normal Opera profile remains paired and online on 1.6.0. Milestone 7 did not change the extension version, signed artifact, protocol, capability count, public MCP inventory, or action-targeting contract.

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

Milestone 7 adds an internal, default-off durable VM host beside the existing public path:

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

The Milestone 7 VM remains an internal Edge surface and does not add an MCP tool.

## Milestone status

- Milestone 1 — bounded browser bursts: complete/released.
- Milestone 2 — background-first execution: complete/released.
- Milestone 3 — adaptive screenshots: complete/released.
- Milestone 4 — vision-guided navigation: complete/released.
- Milestone 5 — semantic runtime foundation, Checkpoints 5A–5F: complete/released in 1.6.0.
- Milestone 6 — Goal and Constraint Ledger + Proof Engine, Checkpoints 6A–6F: complete as server-side work; extension remains 1.6.0.
- Milestone 7 — Reactive Browser VM, Checkpoints **7A–7F: complete and accepted**.
- Milestone 8+ — **not started; Milestone 7 independent Codex audit passed, so Milestone 8 planning is now permitted**.

## Milestone 7 accepted chain

### 7A — contract freeze

7A froze `OA_REACTIVE_VM_V1`, `OA_REACTIVE_VM_CHECKPOINT_V1`, `OA_CANONICAL_JSON_V1`, the closed instruction/expression grammar, read-only-first effect policy, persistence boundary, hostile corpus, protocol/capability/MCP inventory, and bounded execution budgets.

Important limits remain: 128 KiB program/checkpoint/result; 256 AST nodes; depth 12; control depth 4; 1,000 executed nodes; 200 browser leaves; 50 iterations/loop and 250 total; 15 s one wait and 60 s cumulative wait; 3 retry attempts; 1,000 collection items/binding; 64 bindings; 20 s slice; 5 min run deadline.

### 7B — deterministic core

`lib/reactive-vm.js` is the pure deterministic VM core for `SEQUENCE`, `IF`, `ASSERT`, `RETURN`, internal `COMMAND`, and `SUSPEND`. It performs no browser/network/database/ambient-clock work. Command leaves yield typed effect requests and bind only provenance-verified results.

### 7C — loops, waits, retries

`lib/reactive-vm-7c.js` leaves 7B untouched and adds bounded `LOOP`, `UNTIL`, `WAIT_EVENT`, and observation-only `RETRY`. Ambiguity, authority, stale state, invalid input, and contradictions never retry.

### 7D — collection, deduplication, proof binding

`lib/reactive-vm-7d.js` leaves 7B/7C untouched and adds `COLLECT`, `DEDUP`, bounded observation envelopes, causal invalidation, and non-exhaustive evidence binding. Stable bounded scopes may become `BOUNDED_COMPLETE`; truncation/ambiguity/unobserved boundaries remain `PARTIAL`; collection evidence alone never grants universal `PROVED`.

### 7E — durable host and dark integration

7E adds the separate durable host/storage boundary:

- `lib/reactive-vm-host-7e.js`;
- AES-256-GCM `oavm1` bounded tokens;
- internal OAuth-authorized `opera-agent-vm` Edge host;
- private service-role-only `vm_runs`, `vm_effects`, `vm_rate_windows` storage;
- tenant/program/goal/target/tab/document/lease/logical-transition fencing;
- deterministic `vm1:<sha256>` effect idempotency reused as existing `opera_enqueue.request_id`;
- cancellation, expiry, worker-reclaim, queue/rate/concurrency bounds;
- default-off flag `milestone7_vm_enabled`.

The accepted VM browser effect surface remains only the frozen 7A read-only set: `browser.ping`, restricted atomic `browser.burst`, `tabs.list/get/find`, `page.read/query/find/collect_links/capture/wait_for`, and `media.state`. No navigation, click/fill/key/pointer/scroll/media mutation or consequential effect was added.

### 7F — compatibility, performance, production acceptance

7F closes the milestone without changing extension/runtime authority. Durable record: `docs/milestone-7-checkpoint-7f.md`.

Accepted evidence includes:

- focused 7F gates `6/6`;
- full Node suite `171/171` on Ubuntu;
- full Node suite `171/171` on actual `windows-latest`;
- `npm run check`: `26 allowlisted browser primitives, version 1.6.0` on both platforms;
- controlled Chromium regression pass;
- background focus audit: 55 commands, zero focus takeover;
- bounded burst stability: 20/20;
- 100 deterministic collection replays agree byte-for-byte;
- zero false `PROVED` in the 7F bounded-evidence gate;
- paired same-runner semantic-read regression `13.851%`, below the frozen `<15%` threshold;
- normal-profile Maps/YouTube/GitHub read-only acceptance while targets remain inactive;
- Supabase crash/redelivery/idempotency/cancellation/expiry/cross-tenant dark-run acceptance;
- post-probe production flag false and all VM/temp acceptance rows zero.

A fresh separate isolated-Opera launcher was not available during 7F closeout. 7F therefore does not claim a new isolated-Opera run; that compatibility rung is inherited from accepted 1.6.0 because extension source/artifact behavior is unchanged, while fresh 7F browser evidence is controlled Chromium plus the signed normal Opera profile.

## Cross-platform source-hash policy

The Windows audit at the pre-fix 7F head found three false MCP source-hash failures: a CRLF checkout produced raw SHA-256 beginning `6235ed…`, while the frozen fixture represents canonical LF bytes and correctly locks `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`.

The accepted fix adds `tests/helpers/canonical-source-hash.mjs` and explicitly canonicalizes CRLF/lone-CR bytes to LF before hashing. Only the three hash-check call sites changed. The expected hash, 7A inventory lock, MCP source, and public contract were not changed. Actual Windows CI then passed 171/171 plus static validation.

## Production dark state after 7F

Final closeout queries verified:

- `milestone7_vm_enabled = false`;
- `vm_runs = 0`;
- `vm_effects = 0`;
- `vm_rate_windows = 0`;
- temporary `m7-7f-%` command rows = 0;
- device `opera` online on extension 1.6.0 / protocol 1 / 26 capabilities.

7F changed no production schema/function. Security-advisor output still contains baseline findings, but there is no 7F-introduced advisor finding.

## Agent collaboration policy

Checkpoint implementation and live Opera/MCP acceptance may be handled by ChatGPT Web one checkpoint at a time. Codex performs an independent audit at the end of each milestone before the next milestone begins. Only one agent may write the milestone branch at a time. High-risk authentication, tenancy, encryption, signing, public MCP, extension distribution, irreversible-effect, or production-schema boundaries trigger an earlier Codex review before promotion.

The authoritative rules are in `AGENTS.md`; the reusable ChatGPT Web prompt is `docs/prompts/chatgpt-web-checkpoint.md`. A chat report is not acceptance evidence until verified against repository state, tests/CI, direct observations, or production queries.

## Independent Milestone 7 audit

Codex independently audited final milestone head
`551e8283c0417b173e106ee0598cca848f2f4ff0` and returned **PASS** on
2026-09-12. The audit reran the local 171-test suite, static contract check,
focused 7F suite, controlled browser harness, and Edge bundle; reconciled the
exact-head successful GitHub CI run and closed-unmerged temporary PR; and
rechecked production Supabase dark/clean state. Durable evidence is in
`docs/milestone-7-codex-audit.md`.

Milestone 8 may now enter planning. It remains not started, and this audit does
not grant additional browser authority or enable the production VM flag.

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

Continuous desktop/video streaming, synchronized audio/video understanding, OS-level mouse/keyboard control, direct logical-ID action addressing, general raw JavaScript/CDP, site-specific extension opcodes/selectors, learned selector self-modification, automatic consequential actions without explicit authority, Milestone 8+, and any browser effect not already accepted by the frozen Milestone 7 plan remain outside the current accepted milestone.

## Canonical references

- `AGENTS.md` — repository session-close and collaboration rules.
- `SECURITY.md` — security contract.
- `docs/prompts/chatgpt-web-checkpoint.md` — reusable checkpoint implementation prompt.
- `docs/milestone-7-plan.md` — frozen Checkpoints 7A–7F and budgets.
- `docs/milestone-7-checkpoint-7a.md` through `docs/milestone-7-checkpoint-7f.md` — accepted Milestone 7 chain.
- `docs/milestone-7-codex-audit.md` — independent PASS verdict at the Milestone 7 boundary.
- `docs/semantic-runtime-plan.md` — semantic architecture/dependency order.
- `docs/milestone-6-plan.md` and Checkpoint 6 records — accepted Milestone 6 chain.
- `docs/releases/1.6.0.md` — signed release record.
- `docs/benchmarks.md` — performance evidence.
- `docs/install.md` — installation, identity, pairing, and updates.
- `CHANGELOG.md` and `docs/roadmap.md` — release/milestone history.
