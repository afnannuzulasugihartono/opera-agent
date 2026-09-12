# Opera Agent next-session handoff

Use this as the starting prompt for the next implementation session. Verify the repository before making claims.

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
7. docs/semantic-runtime-plan.md
8. docs/milestone-6-plan.md
9. SECURITY.md

Verified compatibility baseline:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged names/input schemas
- established signing identity and pairing preserved
- background-first focus isolation preserved
- immediate signed rollback remains 1.5.2

Milestones 1–6 are complete. Milestone 7 Checkpoints 7A and 7B are complete.

Checkpoint 7A froze the Reactive Browser VM contract without implementing runtime behavior:
- OA_REACTIVE_VM_V1 program schema;
- OA_REACTIVE_VM_CHECKPOINT_V1 metadata-only checkpoint schema;
- OA_CANONICAL_JSON_V1 digest rules;
- the 12-node frozen instruction grammar;
- closed data-only expressions;
- explicit transition/status/error vocabulary;
- read-only-first effect classification over all 26 existing capabilities;
- browser.burst as an atomic read/find/wait-only leaf;
- tenant/device/tab/document provenance and no foreground fallback;
- metadata-only persistence restrictions;
- 36 hostile/boundary replay cases;
- deterministic digest vectors and locked protocol/capability/MCP inventory.

Important frozen limits remain:
- program/checkpoint/result 128 KiB each
- 256 static AST nodes
- AST depth 12
- control-flow depth 4
- 1,000 executed nodes/run
- 200 browser command leaves/run
- 50 iterations/loop, 250 total/run
- 15 s one wait, 60 s cumulative wait
- retry 3
- 1,000 collection items/binding
- 64 bindings
- 20 s execution slice
- 5 minute run deadline

Checkpoint 7B added the pure in-memory core in lib/reactive-vm.js. It is not deployed or reachable from production and performs no browser, network, ambient-clock, random, database, or Supabase work.

7B executes only SEQUENCE, IF, ASSERT, RETURN, internal COMMAND, and SUSPEND. LOOP, UNTIL, WAIT_EVENT, RETRY, COLLECT, and DEDUP remain part of the frozen 7A grammar but are rejected as executable 7B programs until their assigned checkpoints.

COMMAND yields a typed EFFECT_REQUEST instead of executing browser work. Returned effects must match request digest/method and authoritative tenant/device/tab/document provenance before binding. Forged, stale, cross-tenant, cross-device, cross-tab, and stale-document results fail closed. Foreground execution is still forbidden. browser.burst remains an atomic read/find/wait-only leaf; navigation, tab activation, media actions, local reversible page effects, and consequential effects were not added.

The core uses explicit host-supplied logicalNowMs, checks cancellation/deadline at every instruction boundary including pending effects, validates state before transitions, enforces runtime node/command/binding/output budgets, blocks prototype-sensitive paths and secret-like state, and keeps command receipts separate from proof authority.

Accepted 7B evidence:
- focused tests: 10/10 pass
- 10,000 generated bounded programs: pass with no budget escape
- focused 1,000 non-I/O transition p95: 1.1067 ms (<10 ms gate)
- full npm test: 131/131 pass, 0 fail
- npm run check: pass; 26 allowlisted browser primitives, version 1.6.0
- full-suite embedded 7B transition p95: 1.0616 ms
- Chromium extension regression: pass
- background focus audit: 55 commands, focus preserved
- bounded burst stability: 20/20
- background screenshot focus and reconnect checks: pass

No production Supabase migration/function/flag/row, extension source/version, protocol, capability, MCP source/tool/schema, signing identity, pairing state, or production browser behavior changed in 7B. A temporary draft PR used only as a CI runner was closed without merge and the standard CI workflow was restored.

The branch MCP source hash remains:
f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11

The locked 7A inventory digest remains:
sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

NEXT TASK: Checkpoint 7C only.

Implement only LOOP, UNTIL, WAIT_EVENT, and RETRY against the frozen 7A contract and existing pure 7B core. The host supplies a monotonic logical clock and typed observations. Waits must use bounded polling or known semantic deltas and must not hold an unbounded socket/worker.

Retry is allowed only for idempotent observations and structured transient failures. Never retry ambiguous action completion, authorization failure, invalid input, stale target, contradiction, or consequential operations. Cancellation latency must remain at most one yielded leaf and retry/loop/wait counts must never exceed node/run budgets.

Do not begin Checkpoint 7D COLLECT/DEDUP/proof bindings, Checkpoint 7E durable Supabase hosting, production database changes, production Supabase mutation, new MCP surface, extension changes, or broader browser effects. Preserve browser.burst as the existing atomic leaf and preserve all compatibility/security invariants.

Before ending a state-changing session, run focused tests, npm test, and npm run check, update docs/project-context.md and docs/next-session-handoff.md, then commit and push the same branch. Follow AGENTS.md exactly.
```

## Session-close note

Checkpoint 7A began from `e559387c1672c84453f1a98ad819bf6423f95173`. Checkpoint 7B is recorded in `docs/milestone-7-checkpoint-7b.md`. The next implementation session must start at Checkpoint 7C rather than repeating 7A/7B or jumping ahead to 7D+.
