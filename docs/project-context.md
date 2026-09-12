# Opera Agent project context

Last synchronized: 2026-09-12

This is the durable project-state summary for humans and future LLM sessions. Verify executable code and signed release records before changing accepted facts. Never store secret material here.

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

The normal Opera profile updated in place to 1.6.0 without losing pairing. Signing identity, installed extension ID, protocol, and background-first behavior remain the compatibility baseline.

Never commit, paste, log, or transmit private signing-key material, pairing secrets, access tokens, service keys, OAuth secrets, passwords, OTPs, or payment data.

## Architecture

```text
ChatGPT / another MCP client
  -> authenticated Streamable HTTP MCP server
  -> allowlisted relay / workflow layer
  -> paired Opera extension
  -> local Opera tab
  -> structured observation or verified action outcome
```

The extension owns browser-local sensing and named primitives. Server infrastructure owns pairing, heartbeat, command/workflow transport, updates, and MCP backend state. Browser content never grants authority.

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

Current MCP source SHA-256 on this branch:
`f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`.

Checkpoint 7A exposed stale fixture-only hash metadata (`6235ed...`) and aligned it to the source that already existed. MCP source, tool names, and schemas were not changed.

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
- Milestone 7 — Reactive Browser VM: Checkpoints **7A, 7B, 7C, and 7D complete**; Checkpoint **7E is next**.
- Milestones 8–11 remain gated and deferred.

Milestone 6 proof evaluation at 500 evidence items recorded 1.9055 ms median / 2.4166 ms p95 in the accepted pure-compute baseline. Production/security details remain in `docs/milestone-6-checkpoint-6e.md` and `docs/milestone-6-checkpoint-6f.md`.

## Checkpoint 7A — accepted contract freeze

Checkpoint 7A froze the Reactive Browser VM contract, schemas, hostile corpus, effect classification, persistence boundary, digest vectors, and quantitative gates without implementing runtime behavior.

Frozen versions:

- program: `OA_REACTIVE_VM_V1`;
- checkpoint: `OA_REACTIVE_VM_CHECKPOINT_V1`;
- canonicalization: `OA_CANONICAL_JSON_V1`.

Frozen instruction grammar:
`SEQUENCE`, `IF`, `LOOP`, `UNTIL`, `WAIT_EVENT`, `ASSERT`, `COLLECT`, `DEDUP`, `RETRY`, `RETURN`, internal `COMMAND`, and `SUSPEND`.

Important frozen limits:

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

The effect boundary is read-only first. `browser.burst` remains one atomic existing leaf restricted to its read/find/wait subset. Foreground fallback, navigation/tab/media mutation, consequential effects, and raw sensitive persistence are excluded.

The hostile/boundary corpus contains 36 synthetic cases with zero focus changes, zero cross-tenant acceptance, zero sensitive persistence, and zero false completion. Locked public inventory remains protocol 1 / 26 capabilities / 18 MCP tools with digest:

`sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a`.

Detailed record: `docs/milestone-7-checkpoint-7a.md`.

## Checkpoint 7B — accepted pure deterministic VM core

Checkpoint 7B added `lib/reactive-vm.js`, a pure deterministic in-memory VM core. It is not deployed or reachable from production and performs no browser, network, ambient-clock, random, database, or Supabase work.

7B executes `SEQUENCE`, `IF`, `ASSERT`, `RETURN`, internal `COMMAND`, and `SUSPEND`. `COMMAND` yields a typed `EFFECT_REQUEST`; browser work is never performed inside the core. Effect results must match canonical request digest/method plus tenant/device/tab/applicable-document provenance before binding.

The core validates state before every transition, uses host-supplied `logicalNowMs`, checks cancellation/deadline at every instruction boundary, enforces runtime node/command/binding/output budgets, rejects secret-like state and prototype-sensitive paths, and keeps command receipts separate from proof authority.

Accepted evidence:

- focused: 10/10;
- 10,000 generated bounded programs: pass;
- focused non-I/O p95: 1.1067 ms;
- full suite: 131/131;
- static check: pass;
- Chromium regression: pass;
- 55 background-focus audit commands preserved;
- burst stability: 20/20.

Detailed record: `docs/milestone-7-checkpoint-7b.md`.

## Checkpoint 7C — accepted bounded loops, waits, and safe retries

Checkpoint 7C leaves the accepted 7B module untouched and adds `lib/reactive-vm-7c.js` as an isolated pure runtime layer for `LOOP`, `UNTIL`, `WAIT_EVENT`, and `RETRY`.

The host supplies a monotonic logical clock. Waits use bounded read-only polling, worst-case polling is charged to the command budget, retry is restricted to structured transient read-only observation failures, and ambiguous/authority/stale/invalid/contradictory outcomes never retry. Effect digests bind active control-vector state. Page/tool data cannot define program structure, grant authority, or create proof.

Accepted evidence:

- focused 7C: 11/11;
- 1,000 bounded LOOP/UNTIL fuzz programs: pass;
- 100 forced-clock WAIT timeout cases: pass;
- full suite: 142/142;
- `npm run check`: pass, 26 primitives / version 1.6.0;
- same-runner p95 regression ~1.7%, below the 15% gate;
- Chromium regression: pass;
- focus audit: 55 commands preserved;
- burst stability: 20/20.

Detailed record: `docs/milestone-7-checkpoint-7c.md`.

## Checkpoint 7D — accepted collection, deduplication, and proof bindings

Checkpoint 7D leaves 7B and 7C untouched and adds `lib/reactive-vm-7d.js` as a pure isolated layer for exactly the frozen `COLLECT` and `DEDUP` nodes plus bounded observation-to-evidence binding.

Collections use a bounded internal `OA_VM_COLLECTION_V1` envelope with projected records, count/cap metadata, explicit ambiguities, observation provenance, scope kind, causal dependency metadata, completion state, and invalidation state. A capped/truncated or ambiguous collection is always `PARTIAL`; only a stable, non-truncated, unambiguous declared observed scope can be `BOUNDED_COMPLETE`, and it is explicitly never universal proof.

Deduplication prefers verified canonical identity (`logicalId`, `canonicalId`, accepted stable ID/href keys) before accepted semantic fingerprints. Geometry, name, label, text, viewport position, index, and similar weak fields never grant merge authority. Missing strong identity retains the record with `MISSING_STRONG_IDENTITY`; conflicting identity retains records with `IDENTITY_COLLISION`. Compatible virtual detach/reinsert with the same logical identity deduplicates while preferring the higher semantic revision.

Causal invalidation is scoped: document-generation changes invalidate dependent state; viewport/zoom changes invalidate only viewport-dependent collections rather than unrelated loaded-DOM state.

`bindCollectionEvidence7D` requires verified provenance and tenant agreement. It can emit bounded `BOUNDARY_OBSERVATION` or `DIRECT_OBSERVATION` evidence with browser-sensor trust, but always with `exhaustive: false`. The VM does not run proof evaluation and gains no proof authority. Bounded stable-feed evidence may support `BOUNDED_COMPLETE`; universal closed-world `PROVED` still requires the Milestone 6 proof engine's independent exhaustive evidence rules. Action receipts remain non-outcome evidence.

Accepted pre-closeout CI evidence on head `138cfbbb59350b9160c72016f59139b2ee79dc38` (run `34669862521`, job `103489062331`):

- focused 7D: **12/12 pass, 0 fail**;
- deterministic bounded 1,000-item collection/dedup: **pass**;
- full `npm test`: **154/154 pass, 0 fail**;
- `npm run check`: **pass**, `check ok: 26 allowlisted browser primitives, version 1.6.0`;
- controlled Chromium extension regression: **pass**;
- background-focus audit: **55 commands, focus preserved**;
- bounded burst stability: **20/20**;
- background screenshot focus preservation and network/browser-restart reconnect: **pass**.

The first 7D CI pass had one test-fixture tenancy mismatch; the runtime correctly rejected it as `CROSS_TENANT`. Only the test fixture was aligned. The security rule was not relaxed.

Detailed record: `docs/milestone-7-checkpoint-7d.md`.

Checkpoint 7D changes no production Supabase migration/function/flag/row/configuration, extension source/version, protocol, public capability, MCP source/tool/schema, signing identity, pairing state, production browser behavior, or signed artifact.

## Next task: Checkpoint 7E only

Implement only the frozen durable Supabase host and dark-integration scope from `docs/milestone-7-plan.md`:

- bounded Edge execution slices;
- tenant-bound leases and compare-and-swap advancement;
- idempotency, cancellation, expiry, checkpoint/restart, and queue backpressure;
- additive private-schema migration with least-privilege grants;
- enqueue, claim, checkpoint, resume, cancel, expire, and cleanup behavior;
- opaque/encrypted bounded payload boundary where raw values cannot be avoided;
- forced worker-termination retry/idempotency tests;
- rate, queue, retention, payload, and tenant-concurrency limits;
- default-off server feature flag, cleanup procedure, and server rollback.

7E exit gates require exactly one lease per logical transition, zero duplicate logical effects after crash/redelivery, zero unauthenticated/cross-tenant success, rejection of stale goal/program/lease/target/document generations, zero prohibited raw persisted content, no unresolved relevant security-advisor ERROR/WARN, and flag-off compatibility with extension 1.6.0 plus all 18 MCP tools.

Prefer the internal workflow surface. Do **not** add a public MCP tool unless a separate reviewed contract decision justifies it. Do not start Checkpoint 7F production acceptance or Milestones 8+ while doing 7E.

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

Continuous desktop/video streaming, synchronized audio/video understanding, OS-level mouse/keyboard control, direct logical-ID action addressing, general raw JavaScript/CDP, site-specific extension opcodes/selectors, learned selector self-modification, parallel multi-tab workers, automatic consequential actions without explicit authority, Checkpoint 7F, and Milestones 8–11 remain outside the current accepted checkpoint.

## Canonical references

- `AGENTS.md` — repository session-close rules.
- `SECURITY.md` — security contract.
- `docs/milestone-7-plan.md` — frozen Checkpoints 7A–7F and budgets.
- `docs/milestone-7-checkpoint-7a.md` — accepted 7A record.
- `docs/milestone-7-checkpoint-7b.md` — accepted 7B record.
- `docs/milestone-7-checkpoint-7c.md` — accepted 7C record.
- `docs/milestone-7-checkpoint-7d.md` — accepted 7D record.
- `docs/semantic-runtime-plan.md` — semantic architecture/dependency order.
- `docs/milestone-6-plan.md` — accepted Milestone 6 plan.
- `docs/milestone-6-checkpoint-6e.md` and `docs/milestone-6-checkpoint-6f.md` — Milestone 6 production/security evidence.
- `docs/releases/1.6.0.md` — signed release record.
- `docs/benchmarks.md` — performance evidence.
- `docs/install.md` — installation, identity, pairing, and updates.
- `CHANGELOG.md` and `docs/roadmap.md` — release/milestone history.
