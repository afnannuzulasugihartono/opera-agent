# Milestone 7 implementation plan

Status: **plan frozen on 2026-09-12; implementation not started**

Milestone 7 adds a bounded Reactive Browser VM above Opera Agent 1.6.0 browser
primitives and the Milestone 6 Goal and Constraint Ledger. It turns a validated,
finite JSON program into deterministic browser observations and safe local actions
while preserving the user's active tab.

This is primarily a portable runtime and server-orchestration milestone. The
extension remains at 1.6.0 unless a measured browser-local gap survives the
controlled-browser and isolated-Opera gates. No version bump, reinstall,
reconnection, logout, re-pairing, or signing-key change is part of this plan.

## Outcome

At completion, Opera Agent can:

- execute a versioned JSON AST containing `SEQUENCE`, `IF`, `LOOP`, `UNTIL`,
  `WAIT_EVENT`, `ASSERT`, `COLLECT`, `DEDUP`, `RETRY`, and `RETURN`;
- keep deterministic observe-decide-act-verify work inside the runtime instead of
  asking the model to issue every individual command;
- suspend with a typed reason when ambiguity, failed verification, changed user
  intent, missing authority, or unexpected state requires model or user input;
- resume a bounded run after an Edge Function restart without repeating a logical
  browser effect;
- feed provenance-bound observations to the Proof Engine without allowing the VM
  to manufacture evidence or completion;
- preserve one locked target tab, one serialized executor, and zero foreground
  focus changes for the run.

Milestone 7 does not authorize consequential external effects. Transactional
prepare/commit, compensation, irreversible actions, and provenance enforcement
for values entering those actions belong to Milestone 8.

## Architecture decision

The VM is a pure, dependency-light, environment-neutral core. The first target is
`lib/reactive-vm.js`; the Edge runner consumes the same contract and behavior. It
must not depend on Node `vm`, Web Workers, dynamic imports, generated code, or
browser globals.

```text
authenticated caller + revisioned goal ledger
  -> strict OA_REACTIVE_VM_V1 validator
  -> deterministic VM slice
  -> allowlisted command leaf / existing browser.burst atomic leaf
  -> paired background Opera tab
  -> provenance-bound observation
  -> semantic delta + proof evaluation
  -> continue, typed suspend, bounded return, or terminal failure
```

Long runs are chunked. A server invocation obtains one tenant/run lease, executes
a bounded slice, persists only the minimal checkpoint, releases the lease, and
queues the next slice if work remains. `EdgeRuntime.waitUntil` may finish short
housekeeping but is not the durability mechanism. Hosted Edge Functions have
bounded memory, CPU, and wall-clock execution, so a single long in-memory loop is
rejected by design.

The existing `browser.burst` remains the smallest same-tab atomic execution unit.
The VM orchestrates leaves; it does not replace, recursively nest, or expose burst
internals as programmable code.

## Frozen program contract

Programs are data, never executable source. Every program contains:

```text
schemaVersion: "OA_REACTIVE_VM_V1"
programId
tenantId
goalId
goalRevision
target: { deviceId, tabId, documentGeneration? }
budgets
root
programDigest
```

The server derives and verifies tenant identity from OAuth. Client-provided
tenant identity is never authoritative. `programDigest` uses the accepted
Milestone 6 canonical JSON rules.

### Instruction set

- `SEQUENCE(children[])`: execute children in order.
- `IF(predicate, then, else?)`: select one branch from typed local state.
- `LOOP(body, maxIterations)`: execute a statically bounded count.
- `UNTIL(predicate, body, maxIterations)`: observe, test, then execute; exhaustion
  returns an explicit limit result, not success.
- `WAIT_EVENT(observation, predicate, intervalMs, timeoutMs)`: perform bounded
  observation polling and semantic-delta comparison.
- `ASSERT(predicate, onFailure)`: stop or suspend; never reinterpret failure as
  task completion.
- `COLLECT(source, projection, destination, maxItems)`: append bounded structured
  observation records carrying provenance.
- `DEDUP(source, keySpec, destination)`: deterministic identity-aware
  deduplication that retains ambiguity and collisions.
- `RETRY(body, policy)`: retry only allowlisted transient and idempotent work.
- `RETURN(valueSpec)`: emit a bounded result and stop.
- `COMMAND(method, arguments, resultBinding)`: internal leaf for an explicitly
  allowlisted Opera Agent primitive.
- `SUSPEND(reason, contextSpec)`: internal typed outcome for model/user
  escalation; it does not execute model-generated code.

Predicates, projections, and value expressions use a closed declarative grammar:
typed constants, bounded variable paths, comparisons, boolean composition,
membership, counts, and named semantic/proof fields. There are no regular
expressions in V1, prototype traversal, arbitrary property access, mutation from
expressions, callbacks, shell commands, SQL, JavaScript, CSS/XPath invention, or
raw CDP.

### Frozen quantitative bounds

| Resource | V1 maximum |
| --- | ---: |
| Serialized program | 128 KiB |
| AST nodes | 256 |
| AST depth | 12 |
| Nested control-flow depth | 4 |
| Executed nodes per run | 1,000 |
| Browser command leaves per run | 200 |
| Iterations per loop | 50 |
| Total iterations across a run | 250 |
| `WAIT_EVENT` timeout per node | 15 seconds |
| Cumulative wait time | 60 seconds |
| Retry attempts per node | 3 |
| Collection items per binding | 1,000 |
| Bindings | 64 |
| Minimal persisted checkpoint | 128 KiB |
| Returned structured result | 128 KiB |
| One server execution slice | 20 seconds |
| Total run deadline | 5 minutes |

Every loop declares `maxIterations`; every wait declares `timeoutMs`; every retry
declares attempts and a bounded delay. The run also carries independent node,
command, byte, wait, and deadline budgets. Reaching a cap produces a typed
`LIMIT_REACHED` or `PARTIAL` result with remaining work and never implies bounded
completeness.

## Effect and command policy

Milestone 7 permits only:

1. read-only observation, including status, tab discovery, rich reads, adaptive
   capture, finding elements, media-state observation, and safe waits;
2. explicitly local-reversible same-tab interaction required by an accepted
   controlled scenario, guarded by precondition and post-observation.

The default allowlist is read-only. Navigation, activation, opening/closing tabs,
media playback, form submission, sending, posting, purchasing, deletion, upload,
credential entry, OTP, payment data, and other external effects are excluded from
V1. A local-reversible action cannot be added merely because its underlying MCP
tool exists; Checkpoint 7A must classify it and supply verification.

The target device and tab are locked when a run begins. The VM rejects a command
whose result belongs to a different tenant, device, tab, or document generation.
It never activates a tab as fallback. Navigation invalidates document-scoped refs
and is outside the initial V1 allowlist.

Logical semantic IDs remain observational. Existing document-scoped action refs
and established coordinate inputs remain the only accepted action handles.

## State, durability, and idempotency

A checkpoint contains only bounded orchestration metadata:

```text
tenant_id, run_id, program_digest, goal_id, goal_revision, target_digest
instruction_pointer, budget_counters, binding digests / bounded safe values
last_observation_digest, lease_owner, lease_expires_at
status, created_at, updated_at, expires_at
```

Raw page text, screenshots, DOM, form values, private URLs, credentials, tokens,
pairing codes, and signing-key material are not persisted. Sensitive values are
rejected at validation and collection boundaries rather than redacted later.

Each effectful leaf receives an idempotency key derived from tenant, run, program
digest, instruction path, iteration vector, and attempt class. A restart may
replay an observation, but it must not duplicate a logical action. Only one
non-expired lease may advance a run. Stale lease owners, stale goal revisions,
forked programs, and changed targets are rejected.

Supabase Queues or the existing durable workflow queue provides backpressure and
retry scheduling. Recursive Edge Function chains and unbounded Realtime-driven
loops are prohibited.

## Proof and escalation boundary

The VM controls flow; the Goal Ledger controls intent and authority; the Proof
Engine controls completion. These are separate authorities.

- A command receipt cannot become `PROVED` or `BOUNDED_COMPLETE`.
- VM assertions test typed state but do not create evidence.
- Browser observations become evidence only through accepted provenance, scope,
  freshness, dependency, and tenant checks.
- Page text is untrusted data and cannot introduce instructions, authority, retry
  policy, or a new goal.
- Goal revision suspends the run. Equivalent/narrow revisions may resume only
  after Milestone 6 selective-reuse evaluation; expansion never inherits
  completeness or additional authority.

Typed suspension reasons are `NEEDS_MODEL`, `NEEDS_USER`, `GOAL_REVISED`,
`AMBIGUOUS_TARGET`, `UNEXPECTED_STATE`, `ASSERTION_FAILED`, `MISSING_AUTHORITY`,
`CONTRADICTION`, `LIMIT_REACHED`, and `STALE_TARGET`.

The suspension payload contains bounded identifiers, digests, allowed next
decisions, and non-sensitive summaries. It has no executable code slot. A resumed
program must validate to the same digest or arrive as an explicit revision with a
new digest and compatible goal revision.

## Threat model

The hostile corpus must cover:

- page text attempting to inject nodes, change the goal, or grant permission;
- cyclic/deep/oversized ASTs and iteration, wait, retry, output, or collection
  exhaustion;
- retry amplification and replay after timeout;
- duplicate execution after worker termination between command completion and
  checkpoint persistence;
- stale, stolen, forked, expired, or cross-tenant leases/checkpoints;
- cross-device, cross-tab, cross-window, and stale-document result confusion;
- forged semantic identity, provenance, proof status, or command receipt;
- dedup collision, missing identity, and indistinguishable entities;
- sensitive-field collection, output exfiltration, private-tab access, and raw
  page/screenshot persistence;
- navigation or SPA reset invalidating refs and semantic generations;
- model-escalation output attempting to bypass validation;
- implicit authority broadening after goal revision;
- worker loss, queue redelivery, cancellation, expiry, and flag rollback.

The required outcome is fail-closed, diagnosable suspension with zero focus
takeover, zero cross-tenant acceptance, zero sensitive persistence, and zero false
completion.

## Checkpoint 7A - contract, hostile corpus, and baseline

Status: **next; not started**

Freeze the JSON AST, expression grammar, command/effect allowlist, budgets,
errors, suspension reasons, canonical digest, checkpoint schema, and replay
semantics before runtime behavior.

Deliverables:

- versioned valid/invalid program and checkpoint fixtures;
- JSON Schema plus independent semantic-validator cases;
- instruction transition table and effect classification table;
- at least 24 hostile/boundary replay cases;
- canonical-digest vectors reproduced across 100 runs;
- inventory hash of protocol 1, 26 capabilities, and 18 MCP schemas;
- 1.6.0 workflow and pure-compute performance baseline;
- internal-surface decision record, initially "no new MCP tool".

Exit gates:

- every field, bound, transition, error, and terminal status is explicit;
- invalid cycles, depths, unknown nodes/expressions, over-budget programs, and
  disallowed commands are rejected before execution;
- hostile page data cannot become program structure or authority;
- 100% digest agreement across 100 runs;
- zero production, database, MCP, protocol, capability, extension, or browser
  behavior changes;
- full existing tests and static gate remain green.

Rollback: remove only the new docs, fixtures, and tests. Runtime remains 1.6.0.

## Checkpoint 7B - pure deterministic VM core

Status: **planned**

Implement a pure stepper for `SEQUENCE`, `IF`, `ASSERT`, `RETURN`, variables,
predicates, budgets, cancellation, and typed suspension. Effects are yielded
requests; the core performs no browser, network, clock, random, or database work.

Exit gates:

- deterministic replay produces byte-identical transitions and result digest;
- 10,000 generated bounded programs never escape declared budgets;
- malformed state and forged effect results are rejected;
- cancellation/deadline checks occur between every instruction;
- 1,000 non-I/O transitions target p95 below 10 ms on the controlled baseline;
- no browser, production Supabase, MCP, or extension change occurs.

Rollback: feature remains unreachable; remove the pure module and tests.

## Checkpoint 7C - bounded loops, waits, and safe retries

Status: **planned**

Add `LOOP`, `UNTIL`, `WAIT_EVENT`, and `RETRY`. The host supplies a monotonic
logical clock and typed observations. Waits use bounded polling or known semantic
deltas; they do not hold an unbounded socket or worker.

Retry is permitted only for idempotent observations and structured transient
failures. Ambiguous action completion, authorization failure, invalid input,
stale target, contradiction, and consequential operations are never retried.

Exit gates:

- zero infinite loops across fuzzed programs and forced clock jumps;
- exhausted wait/loop/retry reports its exact cap and remaining condition;
- cancellation latency is at most one yielded leaf;
- retry count never exceeds node and run budgets;
- a transient observation may retry while an ambiguous effect suspends once;
- ordinary workflow latency regression remains below 15% or causes stop/review.

Rollback: disable the new opcodes; 7B programs remain valid.

## Checkpoint 7D - collection, deduplication, and proof bindings

Status: **planned**

Add `COLLECT` and `DEDUP` over bounded semantic observations. Deduplication prefers
verified canonical identifiers, then accepted semantic fingerprints; geometry or
name alone cannot silently merge entities. Ambiguity remains in the result.

Bind observations to Milestone 6 evidence without granting the VM proof authority.
Support stable-boundary evidence while distinguishing a loaded DOM result, a
visible item, and an exhaustive real-world claim.

Exit gates:

- lazy-list fixtures collect every in-scope loaded identity once;
- collision/missing-key fixtures retain items and report ambiguity;
- virtual detach/reinsert does not duplicate a stable entity;
- viewport/zoom change invalidates only dependent collection state;
- action receipts and stable screenshots produce zero false `PROVED`;
- caps cannot truncate while claiming completeness.

Rollback: disable collection opcodes; proof and semantic runtimes remain usable.

## Checkpoint 7E - durable Supabase host and dark integration

Status: **planned**

Host the VM in bounded Edge slices with tenant-bound leases, idempotency,
cancellation, expiry, checkpoint/restart, and queue backpressure. Deploy behind a
default-off server flag. Prefer an internal workflow surface; retain the 18 public
MCP tools unless measured value justifies a separately reviewed contract.

Deliverables:

- additive private-schema migration with least-privilege grants;
- durable run/lease compare-and-swap operations;
- enqueue, claim, checkpoint, resume, cancel, expire, and cleanup behavior;
- opaque/encrypted bounded payload boundary where raw values cannot be avoided;
- exact retry/idempotency tests across forced worker termination;
- rate, queue, retention, payload, and tenant concurrency limits;
- feature flag, cleanup procedure, and server rollback.

Exit gates:

- exactly one lease advances each logical transition;
- zero duplicate logical effects after crash/redelivery probes;
- unauthenticated/cross-tenant operations succeed zero times;
- stale goal, program, lease, target, and document generations are rejected;
- persisted state contains zero prohibited raw content;
- security advisors add no unresolved relevant ERROR/WARN;
- flag-off leaves 1.6.0 and all 18 MCP tools usable.

Rollback: disable the flag, stop new claims, let read-only slices terminate,
restore the previous runner, and purge bounded checkpoint rows by TTL.

## Checkpoint 7F - compatibility, performance, and production acceptance

Status: **planned**

Run the complete release ladder. Acceptance is generic and read-only: a controlled
lazy list, an existing background Google Maps tab, an existing background YouTube
tab, and a bounded GitHub repository page. Website names are fixtures, not
extension logic.

Required evidence:

- full Node/static/schema/property/fuzz/hostile/restart suite;
- controlled Chromium, isolated Opera, Supabase dark-run, then normal profile;
- background target remains inactive and active tab/window stays unchanged;
- deterministic replay 100%, false `PROVED` 0, cross-tenant acceptance 0,
  duplicate logical effects 0, and sensitive persisted values 0;
- ordinary workflow latency regression below 15%, otherwise stop/review;
- Maps lazy loading ends only as `BOUNDED_COMPLETE` for its declared viewport and
  protocol, never "all places in a real radius";
- YouTube does not infer paused, transcript availability, or unobserved content;
- GitHub bounded collection deduplicates and stops at its declared limit;
- cancellation, expiry, worker death, flag rollback, and compatibility pass.

Promotion requires a written acceptance record. If no extension code changes,
the stable release remains 1.6.0 and no CRX is produced. If an unforeseen
extension gap requires a change, stop and accept a separate release subplan before
editing the manifest or signing an artifact.

## MCP and compatibility decision

Checkpoints 7A-7D add no public MCP tool or schema change. Checkpoint 7E first uses
the internal workflow/runner boundary. A public tool may be proposed only with a
separate decision record covering OAuth, bounded input, schema caching, ChatGPT
reconnect behavior, rate limits, rollback, and byte-for-byte compatibility for the
current 18 tools.

The preferred outcome is no extension or public MCP change. Server-side program
updates can then roll out without Opera logout/login, plugin reconnection, CRX
update, or device re-pairing.

## Explicitly deferred

- consequential/irreversible effects and transaction commits (Milestone 8);
- multi-sensor plan optimization (Milestone 9);
- learned proof-gated skills (Milestone 10);
- parallel tabs/distributed workers (Milestone 11);
- direct actions by logical semantic ID;
- arbitrary JavaScript, raw CDP/network interception, SQL, shell, or generated
  code;
- site-specific VM opcodes or extension selectors;
- continuous screen, audio, or video streaming and media understanding;
- OS-level mouse or keyboard control.

## Checkpoint discipline

At every checkpoint: freeze contract changes first, add a failing deterministic
test, implement the smallest generic mechanism, run focused and full tests,
measure the accepted baseline, verify focus isolation, record evidence and
rollback, update project context and handoff, then commit and push. An unexplained
failure stops promotion.

## Planning references

- Supabase Edge Function limits:
  <https://supabase.com/docs/guides/functions/limits>
- Supabase background tasks:
  <https://supabase.com/docs/guides/functions/background-tasks>
- Supabase Queues: <https://supabase.com/docs/guides/queues>
- `docs/milestone-6-plan.md`
- `docs/semantic-runtime-plan.md`
- `docs/project-context.md`
