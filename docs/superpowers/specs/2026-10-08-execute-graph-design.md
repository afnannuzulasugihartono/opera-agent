@last-edited: 2026-10-08 UTC+7.
@related: [`AGENTS.md`](../../../AGENTS.md) - [`../uec-north-star.md`](../../uec-north-star.md) - [`../../handoff.md`](../../handoff.md)

# Spec: execute(graph) runtime + plan-path compiler

One spec, two layers. Runtime first, compiler second. Approved in chat 2026-10-08.

## Intent

Multi-step tasks finish in one model round trip: the model composes a plan
once, the device executes it locally, verification evidence returns in one
response. Stage 1 success: a hand-written read-only graph
`find -> read -> verify` completes in a single local execution; the collect
VM is read-only, so write actions stay on the registered-workflow path until
Stage 2. No new browser primitive, no per-site extension code, no free `eval`.

Stage 1 ruling (2026-10-08, from Task 1's proven joint probe): the
compiler-to-VM joint only holds for VM-true programs — `children` (never
`steps`), read-only methods, sealed `programDigest`, all 17 budget keys.
The caller-facing path seals gate output into that shape; it never widens
the VM.

## Non-goals

No benchmark chase, no RL/training loop, no per-site gadgets in the
extension, no new queue transport, no model key leaving the device.

## Architecture

The graph is versioned JSON like a registered workflow
(`opera_register_workflow`), but ad-hoc: no pre-registration. Flow:
model text -> `extension/lib/goal-plan.js` gate validates against the same allowlist
as `extension/lib/protocol.js` -> one `execute(graph)` command enqueued ->
device executes every node locally with existing burst/workflow primitives
-> structured result plus per-node verification evidence returns once.

## Components and schema

Nodes: `command` (one allowlisted primitive), `workflow` (one registered
workflow, e.g. `youtube.skip_ads`), `if` / `repeat` (bounded branch and
retry, same vocabulary the runner already runs). Edges: order plus
`refFromStep` between steps; refs never cross tabs
(`burstCrossTabRef` refusal stays). Constraints: `maxIterations`,
`timeoutMs`, step budget. Verification per node: `expect` (a semantic
condition such as count > 0) plus `recover` (re-query and retry, or degrade
such as the caption-less fallback). Output: result plus an honest
per-node pass/fail trail. Stage 1 node set is `SEQUENCE` plus read-only
`COMMAND` children — the shape Task 1's probe proved the collect VM
accepts; `workflow`, `if`, and `repeat` nodes stay Stage 2 until a VM phase
accepts them.

## Data flow and error handling

Compile: `goal-plan.js` parses and rejects unknown methods,
cross-tab refs, and over-budget graphs before enqueue. Execute: the device
claims one command, runs nodes in order through the existing
observe-act-verify-recover pipeline. Failed verification runs `recover`
first (fresh re-query, bounded retry); exhausted budget stops the graph
with an honest partial status naming which nodes passed and which failed,
never a blind error. Polling keeps the existing `opera_claim_next_wait`
ramp; no new queue path. Model endpoint, key, and model name live in the
user's own device configuration and never enter the graph, the queue,
or the database.

## Testing

All in `npm test`, no live fleet: schema pins (known node types,
allowlisted methods, `refFromStep` to earlier steps only), rejection pins
(unknown method, cross-tab ref, over-budget graph refused by the gate),
termination pins (bounded repeat, exhausted budget yields honest partial
status). One integration test: the hand-written `find -> click -> verify`
graph passes in a single local execution.

## Security

`docs/security.md` gains one paragraph before the compiler activates:
what leaves the device (plan text plus structured results to the user's
own model endpoint; the key stays on the device and never enters the
queue or the database). The compiler stays off until that paragraph lands;
the runtime is testable without it.

## Staging

Stage 1 (buildable now): runtime — read-only program intake, device-local
read/verify execution, honest partial status, tests. The caller path
(`run_program`) seals gate output to VM-true shape and never widens the VM.
Stage 2 (blocked on owner config): compiler — endpoint/key/model settings
on the device, security paragraph, VM host wiring that hands a compiled
program to the run path — plus write-action execution for ad-hoc programs,
which today exists only as registered workflows.
