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
7. docs/milestone-7-checkpoint-7c.md
8. docs/semantic-runtime-plan.md
9. docs/milestone-6-plan.md
10. SECURITY.md

Verified compatibility baseline:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged names/input schemas
- established signing identity and pairing preserved
- background-first focus isolation preserved
- no silent foreground fallback
- immediate signed rollback remains 1.5.2

Milestones 1–6 are complete. Milestone 7 Checkpoints 7A, 7B, and 7C are complete.

Checkpoint 7A froze OA_REACTIVE_VM_V1, OA_REACTIVE_VM_CHECKPOINT_V1,
OA_CANONICAL_JSON_V1, the 12-node instruction grammar, closed expressions,
read-only-first effects, metadata-only persistence, hostile replay/digest vectors,
and the protocol 1 / 26 capability / 18 MCP inventory.

Frozen quantitative limits remain:
- program/checkpoint/result 128 KiB each
- 256 static AST nodes
- AST depth 12
- control-flow depth 4
- 1,000 executed nodes/run
- 200 browser command leaves/run
- 50 iterations/loop, 250 total/run
- 15 s one wait, 60 s cumulative wait
- retry attempts/node 3
- 1,000 collection items/binding
- 64 bindings
- 20 s execution slice
- 5 minute run deadline

Checkpoint 7B added lib/reactive-vm.js as the accepted pure deterministic
in-memory core. It executes SEQUENCE, IF, ASSERT, RETURN, internal COMMAND, and
SUSPEND. Browser effects are yielded requests and must return with matching digest,
method, and tenant/device/tab/document provenance. The core has no browser,
network, ambient-clock, random, database, or Supabase side effects.

Checkpoint 7C deliberately leaves lib/reactive-vm.js as the accepted 7B baseline
and adds lib/reactive-vm-7c.js as an isolated pure layer for LOOP, UNTIL,
WAIT_EVENT, and RETRY only.

7C semantics:
- host supplies monotonic logicalNowMs; clock rollback fails closed;
- LOOP is bounded by per-loop and total-run iteration budgets;
- UNTIL checks before first iteration and after every body completion;
- exhausted UNTIL reports LIMIT_REACHED with conditionMet=false;
- WAIT_EVENT is bounded read-only polling, never an unbounded socket/worker;
- wait observations are ephemeral predicate data, not automatic durable bindings;
- WAIT timeout and cumulative wait report exact typed limits;
- worst-case polling ceil(timeoutMs/intervalMs) counts against command budget;
- RETRY applies only to structured transient read-only observation failures;
- ambiguous/unknown completion, authority failure, stale target/document, invalid
  input/schema/argument, contradiction, and non-transient failures never retry;
- retry delays are logical-time boundaries and exhausted retries report exact cap;
- pending effect digests bind active loop/until iteration and retry attempt;
- effect provenance/sensitive-state/proof-separation rules from 7B remain intact.

Accepted 7C evidence:
- focused 7C tests: 11/11 pass
- 1,000 bounded LOOP/UNTIL fuzz programs: pass
- 100 forced-clock WAIT timeout cases: pass
- transient-only retry/non-retry classification: pass
- cancellation at pending-effect/wait/retry-delay boundaries: pass
- full npm test: 142/142 pass, 0 fail
- npm run check: pass; 26 allowlisted browser primitives, version 1.6.0
- same-runner p95: 7B 0.9787 ms, 7C 0.9949 ms, ratio 1.017 (~1.7% regression)
- Chromium extension regression: pass
- background focus audit: 55 commands, focus preserved
- bounded burst stability: 20/20

Checkpoint 7C did not change production Supabase migration/function/flag/row,
extension source/version, protocol, capability inventory, MCP source/tool/schema,
signing identity, pairing state, or production browser behavior.

The branch MCP source hash remains:
f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11

The locked 7A inventory digest remains:
sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

NEXT TASK: Checkpoint 7D only.

Implement COLLECT and DEDUP over bounded semantic observations and bind accepted
observations to Milestone 6 evidence without granting the VM proof authority.

Requirements from the frozen plan:
- lazy-list fixtures collect every in-scope loaded identity once;
- verified canonical identifiers are preferred, then accepted semantic fingerprints;
- geometry or name alone cannot silently merge entities;
- missing keys/collisions retain items and report ambiguity;
- virtual detach/reinsert does not duplicate a stable identity;
- viewport/zoom change invalidates only causally dependent collection state;
- loaded DOM result, visible item, and exhaustive real-world claim remain distinct;
- action receipts and stable screenshots still create zero false PROVED results;
- collection caps can never truncate while claiming completeness.

Do not begin Checkpoint 7E durable Supabase hosting, queue/lease persistence,
production database changes, production Supabase mutation, new public MCP surface,
extension changes, direct logical-ID actions, or broader browser effects.

Preserve browser.burst as the existing atomic leaf. Preserve all 7A budgets,
7B/7C effect/provenance rules, proof separation, extension 1.6.0, protocol 1,
26 capabilities, 18 MCP tools, signing identity, pairing, and background focus.

Before ending a state-changing session, run focused tests, npm test, npm run check,
and relevant Chromium regression; update docs/project-context.md and this handoff;
commit/push the same branch and follow AGENTS.md exactly.
```

## Session-close note

Checkpoint 7A began from `e559387c1672c84453f1a98ad819bf6423f95173`. Checkpoint 7B is recorded in `docs/milestone-7-checkpoint-7b.md`; Checkpoint 7C is recorded in `docs/milestone-7-checkpoint-7c.md`. The next implementation session must start at Checkpoint 7D rather than repeating earlier checkpoints or jumping to 7E+.
