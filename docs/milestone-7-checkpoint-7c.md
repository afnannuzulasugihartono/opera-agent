# Milestone 7 Checkpoint 7C — bounded loops, waits, and safe retries

Status: accepted pure-runtime checkpoint on 2026-09-12, contingent on the session-close exact branch-head CI gate described below.

## Scope

Checkpoint 7C extends the accepted pure in-memory Reactive Browser VM with only the opcodes assigned by the frozen Milestone 7 plan:

- `LOOP`
- `UNTIL`
- `WAIT_EVENT`
- `RETRY`

It does not implement `COLLECT` or `DEDUP`, does not bind VM output into Milestone 6 proof authority, does not add durable checkpoint hosting, and does not deploy or enable a production runtime.

The accepted 7B module, `lib/reactive-vm.js`, remains the byte-for-byte 7B baseline. 7C is isolated in `lib/reactive-vm-7c.js`, which reuses the frozen 7A validator and 7B expression semantics while adding only the new bounded control-flow behavior. This preserves a simple rollback: remove the 7C layer and its tests and 7B remains usable.

## Host clock and purity boundary

The 7C core remains pure and environment-neutral. It performs no browser, network, ambient clock, random, database, or Supabase work.

Every step receives an explicit host-supplied `logicalNowMs`. Logical time must be monotonic; a backwards clock is rejected as invalid semantics. The host therefore cannot extend a wait or retry window by rewinding time.

Cancellation and run-deadline checks happen before pending effects, waits, and retry delays are advanced. The runtime never holds an unbounded socket, worker, timer, or browser connection.

## LOOP

`LOOP` executes its body exactly `maxIterations` times when no terminal condition interrupts it.

The runtime enforces both:

- the frozen per-loop cap (`iterationsPerLoop`, maximum 50); and
- the frozen total-run cap (`totalIterationsPerRun`, maximum 250).

Static 7C validation rejects a declared loop whose worst-case iteration count exceeds the program's declared budget. Runtime accounting is still enforced independently.

## UNTIL

`UNTIL` evaluates its predicate before the first body execution and after every completed iteration.

If the condition becomes true, control continues normally. If the condition remains false after `maxIterations`, the VM terminates as `LIMIT_REACHED` with explicit context including:

- limit `UNTIL_MAX_ITERATIONS`;
- the declared maximum;
- completed iterations; and
- `conditionMet: false`.

This prevents an exhausted loop from being mistaken for successful completion.

## WAIT_EVENT

`WAIT_EVENT` is implemented as bounded polling over the frozen read-only observation methods. It does not create a hidden effect channel and it does not execute foreground work.

The first observation is yielded immediately. Subsequent observations are yielded only when the host logical clock reaches the next bounded poll point. A forced clock jump to or beyond the deadline closes the wait deterministically.

The observation value is scoped ephemerally to predicate evaluation as `observation`; it is not copied into long-lived VM bindings merely because it was used to evaluate a wait condition.

Timeout exhaustion terminates as `LIMIT_REACHED` with exact context including:

- limit `WAIT_EVENT_TIMEOUT`;
- timeout duration;
- elapsed bounded wait;
- number of polls; and
- `conditionMet: false`.

Cumulative logical waiting is charged against the frozen 60-second run budget.

7C static validation also counts worst-case wait polling as browser-command leaves using `ceil(timeoutMs / intervalMs)`. Therefore a program that is structurally valid under the frozen 7A grammar but would mathematically require more than its declared command budget is rejected before execution.

## RETRY

`RETRY` is observation-only in this checkpoint. It does not broaden the read-only effect policy.

A retry is allowed only when a yielded read-only observation fails with a structured transient error. The accepted transient vocabulary is deliberately narrow and includes timeout/network/temporary-unavailable style failures.

The following classes never retry:

- ambiguous or unknown completion;
- authorization/authority failure;
- stale target or stale document;
- invalid input/schema/argument;
- contradiction; and
- any other non-transient or unclassified failure.

Those failures suspend once with a typed reason instead of amplifying effects.

Retry delay is represented with host logical time and yields `WAITING_RETRY` until its `notBeforeMs`. Exhaustion terminates as `LIMIT_REACHED` with limit `RETRY_ATTEMPTS`, the declared attempt cap, and the last structured error code.

Both command leaves and retry attempts are consumed conservatively. Static validation multiplies retry-body worst-case command usage by the declared attempt count, and runtime counters enforce the same frozen limits independently.

## Effect integrity and provenance

7C preserves the 7B effect boundary:

- browser work is yielded as an effect request rather than executed in the core;
- request digest and method must match the pending request;
- tenant, device, tab, and applicable document-generation provenance must match before a value can affect VM state;
- sensitive/credential-like fields and values remain rejected;
- page/tool content remains untrusted data and cannot define VM structure, change the goal, grant authority, or modify retry policy.

Pending request digests in 7C also bind the relevant loop/until iteration and retry attempt through the control vector. Mutating control state therefore invalidates the request/result relationship.

Browser command success remains process evidence only. 7C does not mint `PROVED`, does not infer real-world exhaustiveness, and does not bypass the Milestone 6 Goal/Constraint Ledger or Proof Engine.

## Checkpoint isolation

`COLLECT` and `DEDUP` remain structurally part of `OA_REACTIVE_VM_V1` but are explicitly rejected by the 7C executable layer. Collection, deduplication, ambiguity-preserving identity handling, and proof bindings belong to Checkpoint 7D.

Durable leases/checkpoints, queueing, crash recovery, production database objects, and feature-flag hosting remain Checkpoint 7E work.

## Validation evidence

The initial PR-runner gate on the 7C implementation passed completely:

- focused Checkpoint 7C tests: **11/11 pass**;
- bounded LOOP/UNTIL fuzz programs: **1,000 pass with no infinite loop or cap escape**;
- forced-clock WAIT cases: **100 deterministic timeout cases pass**;
- transient retry / non-retry classification: **pass**;
- cancellation at pending-effect, wait, and retry-delay boundaries: **pass**;
- full `npm test`: **142/142 pass, 0 fail**;
- `npm run check`: **pass**, reporting `26 allowlisted browser primitives, version 1.6.0`;
- controlled Chromium extension regression: **pass**;
- background focus audit: **55 commands, focus preserved**;
- bounded burst stability: **20/20**;
- background screenshot focus preservation: **pass**.

Same-runner ordinary 7B-compatible transition benchmark:

- 7B p95: **0.9787 ms**;
- 7C p95: **0.9949 ms**;
- ratio: **1.017**;
- measured p95 regression: approximately **1.7%**, below the frozen 15% stop/review gate.

The repository's existing 7B 1,000-transition gate also remained green in the same run at **0.9664 ms p95**.

The session-close procedure must additionally run focused 7C tests, full `npm test`, `npm run check`, and Chromium regression against the exact branch head after documentation is synchronized. A temporary draft PR may be used only as a GitHub Actions runner and must be closed without merge; any temporary CI checkout instrumentation must be restored before final branch closure.

## Compatibility and production boundary

Checkpoint 7C preserves:

- extension version `1.6.0`;
- protocol `1`;
- extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`;
- 26 public browser capabilities;
- 18 MCP tools with unchanged names/input schemas;
- established extension signing identity;
- existing pairing;
- background-first focus isolation;
- no silent foreground fallback; and
- the signed 1.5.2 rollback path.

No extension source, MCP source, production migration, Supabase function, feature flag, production row, pairing state, signing material, or production browser behavior is changed by 7C.

## Next checkpoint

Checkpoint 7D is next. It may add only the frozen `COLLECT` and `DEDUP` semantics plus bounded bindings to Milestone 6 evidence, preserving ambiguity and proof separation. It must not start Checkpoint 7E durable hosting or broaden the public MCP/extension surface.

## Rollback

Rollback is repository-only: remove `lib/reactive-vm-7c.js`, `tests/reactive-vm-7c.test.mjs`, and this checkpoint record, then restore the context/handoff documents. The accepted 7B core remains unchanged and usable. There is no production Supabase, extension, pairing, or signed-artifact rollback associated with 7C.
