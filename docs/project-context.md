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
- Milestone 7 — Reactive Browser VM: Checkpoints **7A, 7B, and 7C complete**; Checkpoint **7D is next**.
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

Checkpoint 7C leaves the accepted 7B module untouched and adds `lib/reactive-vm-7c.js` as an isolated pure runtime layer for exactly:

- `LOOP`;
- `UNTIL`;
- `WAIT_EVENT`;
- `RETRY`.

`COLLECT` and `DEDUP` remain explicitly non-executable until Checkpoint 7D.

The host supplies a monotonic logical clock. Backwards logical time fails closed. Waits use bounded read-only polling; there is no unbounded socket/worker/timer. WAIT observations are ephemeral predicate data rather than automatically retained bindings. Timeout/cumulative-wait exhaustion reports exact typed limits.

Static 7C validation accounts for worst-case loop iterations, retry multiplication, and `WAIT_EVENT` polling (`ceil(timeoutMs / intervalMs)`) against the frozen command/iteration budgets before execution. Runtime counters independently enforce the same limits.

Retry remains observation-only and applies only to a narrow structured transient-error vocabulary. Ambiguous/unknown completion, authority failure, stale target/document, invalid input/schema/argument, contradiction, and all other non-transient failures suspend once instead of retrying. Retry delays are host-logical-time boundaries, not ambient timers.

Effect-request digests continue to bind method/arguments/target and now also bind the active loop/until iteration and retry attempt through a control vector. Returned effects must still pass tenant/device/tab/document provenance checks. Page/tool data cannot define program structure, grant authority, modify retry policy, or create proof.

Initial accepted 7C evidence:

- focused 7C tests: **11/11 pass**;
- 1,000 bounded LOOP/UNTIL fuzz programs: **pass**;
- 100 forced-clock WAIT timeout cases: **pass**;
- transient-only retry and non-retry classifications: **pass**;
- cancellation at pending-effect/wait/retry-delay boundaries: **pass**;
- full `npm test`: **142/142 pass, 0 fail**;
- `npm run check`: **pass**, `26 allowlisted browser primitives, version 1.6.0`;
- same-runner p95: 7B **0.9787 ms**, 7C **0.9949 ms**, ratio **1.017** (~1.7% regression, below the 15% gate);
- Chromium extension regression: **pass**;
- background-focus audit: **55 commands, focus preserved**;
- bounded burst stability: **20/20**.

The detailed record is `docs/milestone-7-checkpoint-7c.md`. Session close must preserve the standard CI workflow after any temporary exact-head instrumentation and close the temporary validation PR without merge.

Checkpoint 7C changes no production Supabase migration/function/flag/row, no extension source/version, no protocol, no public capability, no MCP source/tool/schema, no signing identity, no pairing state, and no production browser behavior.

## Next task: Checkpoint 7D only

Implement only the frozen `COLLECT` and `DEDUP` semantics over bounded semantic observations, plus bounded bindings to Milestone 6 evidence without granting the VM proof authority.

7D must preserve ambiguity. Prefer verified canonical identifiers, then accepted semantic fingerprints; geometry or name alone must never silently merge entities. Virtual detach/reinsert must not duplicate a stable identity. Caps must never truncate data while claiming completeness. Loaded DOM results, visible items, and exhaustive real-world claims remain distinct.

Do **not** begin Checkpoint 7E durable Supabase hosting, queue/lease persistence, production database changes, new public MCP surface, extension changes, or broader browser effects while doing 7D.

Before completing 7D, preserve extension 1.6.0, protocol 1, 26 capabilities, 18 MCP tools, signing identity, pairing, and background focus isolation; run focused tests, `npm test`, `npm run check`, and relevant Chromium regression; update this context and `docs/next-session-handoff.md`; then commit/push the same branch.

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

Continuous desktop/video streaming, synchronized audio/video understanding, OS-level mouse/keyboard control, direct logical-ID action addressing, general raw JavaScript/CDP, site-specific extension opcodes/selectors, learned selector self-modification, parallel multi-tab workers, automatic consequential actions without explicit authority, 7E durable VM hosting, and Milestones 8–11 remain outside the current accepted checkpoint.

## Canonical references

- `AGENTS.md` — repository session-close rules.
- `SECURITY.md` — security contract.
- `docs/milestone-7-plan.md` — frozen Checkpoints 7A–7F and budgets.
- `docs/milestone-7-checkpoint-7a.md` — accepted 7A record.
- `docs/milestone-7-checkpoint-7b.md` — accepted 7B record.
- `docs/milestone-7-checkpoint-7c.md` — accepted 7C record.
- `docs/semantic-runtime-plan.md` — semantic architecture/dependency order.
- `docs/milestone-6-plan.md` — accepted Milestone 6 plan.
- `docs/milestone-6-checkpoint-6e.md` and `docs/milestone-6-checkpoint-6f.md` — Milestone 6 production/security evidence.
- `docs/releases/1.6.0.md` — signed release record.
- `docs/benchmarks.md` — performance evidence.
- `docs/install.md` — installation, identity, pairing, and updates.
- `CHANGELOG.md` and `docs/roadmap.md` — release/milestone history.
