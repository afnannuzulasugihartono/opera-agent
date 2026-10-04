# Delta-First Runtime

Simplify first. State what is true now, never its history.

Related: [AGENTS.md](../AGENTS.md) - [benchmarks.md](benchmarks.md) - [ax-observation.md](ax-observation.md)

Status: **ACCEPTED / CLOSED.** Not reopened. The per-phase commits, CI runs, and
acceptance records live in git history.

- Keep canonical browser and semantic state inside the bounded runtime.
- Process changes incrementally and wake reasoning only when a change needs a decision.
- **Full snapshot is a recovery primitive**, not the desired steady-state path.
- A follow-up track remains paused and needs an explicit start instruction.

## Frozen invariants

- Normal automation is background-first, with zero silent foreground takeover.
- Protocol `1`, 26 browser capabilities, and the public MCP tool set are unchanged.
- Semantic `logicalId` is observational, never direct action authority.
- Webpage, model, and tool text is data, never authority.
- Action success alone is never task-completion proof.
- No arbitrary JavaScript, no unrestricted raw CDP, no shell, no SQL, no generated code.
- No site-specific selector or opcode logic in the extension.
- No password, PIN, OTP, 2FA, CVV, or payment-credential handling.
- Every cache, history, buffer, loop, wait, delta, and payload stays bounded.
- Unsafe continuity fails closed to `RESET` and a trusted full snapshot.
- Caller, model, and page assertions cannot mint accepted dependency authority.
- With cutover metadata present, only a valid accepted `APPLY_AND_CONTINUE` may continue
  local VM execution. Everything else fails closed.

## Target architecture

```text
BOOTSTRAP
  -> full snapshot
  -> bounded semantic working state

ACTION / PAGE CHANGE
  -> browser signals
  -> bounded change epoch
  -> semantic delta
  -> canonical state update
  -> causal invalidation
  -> relevance gate
       -> IGNORE_FOR_TASK
       -> APPLY_AND_CONTINUE
       -> REASON_REQUIRED

APPLY_AND_CONTINUE
  -> bounded Reactive VM local execution
  -> explicit read-only browser effects
  -> typed local yield

REASON_REQUIRED / INVALID AUTHORITY
  -> compact or fresh reasoning observation
  -> reasoning or trusted recovery

CONTINUITY FAILURE
  -> RESET
  -> full snapshot
  -> rebuild canonical state
```

Reset rather than continue stale state on any of:

- first observation
- navigation or document-generation change
- an SPA or history transition that invalidates continuity
- a revision gap
- restart or epoch mismatch
- ambiguity or overflow
- a privacy transition
- required fresh verification
- any unknown staleness condition

## Measurement contract

`[tests/fixtures/delta-performance-baseline-p0-v1.json](../tests/fixtures/delta-performance-baseline-p0-v1.json)` freezes:

- the workload matrix
- the metrics
- the target gates

No benchmark may hide retries, resets, browser effects, correctness failures, stale
state, or foreground takeover to look faster.

## What each phase delivered

- **Plan freeze and baseline.** Froze the invariants, the workload matrix, and the
  measurement contract.
- **Persistent semantic working state.** Bounded ephemeral canonical state with
  exact revision continuity, identity isolation, replay idempotency, bounded retention,
  and fail-closed reset.
- **Delta-first observation pipeline.** Compact changed-fact and view patches for
  proven contiguous updates, with canonical state retained internally. Bootstrap,
  recovery, and fresh-verification paths still take full snapshots. Controlled paired
  evidence: 93.80% median payload reduction with zero stale continuation, false
  completion, foreground takeover, or relevant semantic loss.
- **Multi-signal coalescer and relevance gate.** Emits exactly `IGNORE_FOR_TASK`,
  `APPLY_AND_CONTINUE`, or `REASON_REQUIRED`. Only accepted goal and constraint
  dependency context grants relevance authority; missing or invalid context forces
  conservative reasoning.
- **Event-driven local reactive execution.** Composes the accepted relevance output with
  the Reactive VM. Controlled evidence: 88.89% fewer model-mediated round trips with all
  eight read effects exposed and zero false `PROVED` or foreground takeover.
- **Real-Opera performance acceptance.** Acceptance only, no runtime, extension,
  public MCP, schema, signing, or OAuth change. Maps lazy growth and stable completion,
  GitHub SPA-route reset, YouTube semantic no-change filtering, 80% steady-state
  full-snapshot reduction, zero safety regressions. The 8.724x long-task figure is a
  mediation-elision transport proxy, not integrated host speed evidence.
- **Durable runtime cutover, maximal safe subset.** Wires track state and relevance
  reconciliation into the DB-backed VM effect loop after `opera_await`, preserving the
  database lease, checkpoint, effect-reservation and idempotency, host-token, and
  low-level command-queue authority.

### The cutover does not trust the caller

It ignores caller-supplied `taskDependencies`. Until a server-authoritative dependency
source exists, live task context is missing and normal observation updates resolve
conservatively to `REASON_REQUIRED`. That is the maximal safe subset: the full live
speedup is **not** claimed to be enabled.

With a `performanceCutover` result present, local VM continuation is an explicit allowlist:

| Condition | Outcome |
|---|---|
| valid accepted `APPLY_AND_CONTINUE`, no reasoning wake | may bind and continue |
| reset required | suspend `STALE_TARGET` |
| `REASON_REQUIRED`, `IGNORE_FOR_TASK`, unknown or missing decision, malformed context | suspend, fail closed |
| no cutover metadata | keep the low-level VM path used before the cutover |

## Stop conditions

Stop and review if reconstructed incremental state differs from trusted recomputation, a
relevant signal is lost, stale state can drive an action, reset cannot restore
continuity, reasoning suppression harms correctness, a foreground takeover occurs, plain
latency exceeds the frozen bound, or safe implementation would need wider browser or
transaction authority.

## Rollback

- Production rollback point is the immediately previous `opera-agent-vm` Edge deployment.
- Signed extension rollback to 1.5.2 remains available.
- Do not keep a duplicate live `legacy/` implementation only for rollback; git keeps it.
