# Performance Track P — Checkpoint P4 acceptance record

Date: 2026-09-17

Status: **FINAL CANDIDATE — exact-head CircleCI + Vercel/status required. P5 has not started.**

## Boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Accepted P3 head: `d5310508aeb5c156657bd4d4abd06a4d172daaba`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Milestone 8: 8A–8D accepted; 8E paused/not started
- Signing/pairing and signed rollback `1.5.2`: unchanged
- Production/Supabase/transaction-authority changes in P4: **none**

## Objective

P4 makes accepted `APPLY_AND_CONTINUE` relevance decisions executable locally by a
bounded consumer/runtime host over the already accepted Reactive Browser VM. The
purpose is to keep repetitive read/observe/filter/collect/wait work inside the local
runtime until a typed yield requires reasoning, instead of mediating each safe
read-only browser effect through the reasoning layer.

P4 does not create a new VM grammar or browser primitive. It composes P3 relevance
output with Reactive VM 7D and exposes only a small host-facing local-execution API.

## Implementation

P4 adds:

- `lib/event-driven-local-execution-p4.js`
- `tests/event-driven-local-execution-p4.test.mjs`

The implementation uses the accepted `createReactiveVm7D()` and
`advanceReactiveVm7D()` APIs without modifying Reactive VM 7B/7C/7D bytes.

P4 exports a closed outcome vocabulary:

```text
IDLE
LOCAL_EFFECT_REQUIRED
LOCAL_TERMINAL
REASON_REQUIRED
```

and a closed yield-reason vocabulary:

```text
AMBIGUITY
BUDGET_EXHAUSTED
CANCELLED
DECISION_REQUIRED
EXPIRED
FAILURE
RESET_REQUIRED
STABLE_BOUNDARY
SUCCESS
```

## Authority boundary

Local execution starts only from a structurally valid P3 decision that is exactly
`APPLY_AND_CONTINUE` and that also proves all of the following:

- `reasoningWakeRequired` is false;
- canonical state is present;
- relevance context status is `ACCEPTED`;
- at least one accepted continuation dependency matched;
- no reason dependency matched;
- no safety reason is present.

Malformed, self-asserted, untrusted, or contradictory continuation decisions fail
conservative to `REASON_REQUIRED`.

`IGNORE_FOR_TASK` leaves the registered VM run idle. `REASON_REQUIRED` never starts
or advances local VM execution.

## Local execution behavior

Each local run is isolated by trusted runtime identity:

```text
tenant + device + tab + documentGeneration + runtimeEpoch
```

A registered program is validated and instantiated by the accepted Reactive VM 7D
runtime. One P4 execution slice advances the VM only up to a bounded local-step cap.
The slice stops when it reaches one of these boundaries:

- a read-only VM browser effect request;
- VM success;
- VM suspension requiring reasoning;
- VM failure;
- VM limit exhaustion;
- cancellation;
- expiry;
- the P4 local slice-step budget.

Read-only VM effect requests are surfaced as `LOCAL_EFFECT_REQUIRED` and are not
counted as reasoning wakes. Host effect results return through the accepted VM
verification path before the run can continue.

P4 performs an additional trusted-identity provenance check over returned effects so
an effect result from another tenant, device, tab, or document generation cannot
continue the local run.

## Typed conservative yields

P4 maps important VM/P3 boundaries conservatively:

- P3 decision required -> `DECISION_REQUIRED` + reasoning;
- P3/P2 reset-required state -> `RESET_REQUIRED` + reasoning and stale local run is dropped;
- VM `AMBIGUOUS_TARGET` suspension -> `AMBIGUITY` + reasoning;
- VM failure or invalid/untrusted effect result -> `FAILURE` + reasoning;
- VM `LIMIT_REACHED` or P4 slice cap -> `BUDGET_EXHAUSTED` + reasoning;
- VM `CANCELLED` -> bounded `LOCAL_TERMINAL` / `CANCELLED` without reasoning;
- VM `EXPIRED` -> bounded `LOCAL_TERMINAL` / `EXPIRED` without reasoning;
- VM `RETURNED` -> bounded `LOCAL_TERMINAL` / `SUCCESS` without reasoning.

P4 does not synthesize universal completion proof. A local `SUCCESS` means the
bounded Reactive VM returned successfully; it does not create `PROVED` evidence.

## Tests-first chain

- `3786d827d85c247367690825f62bad34ded63689` — P4 contract tests only; CircleCI #95 expected red because `lib/event-driven-local-execution-p4.js` did not yet exist; Vercel SUCCESS.
- `460c3e7a1977792387c347762550aea554a07ebd` — P4 implementation; CircleCI #96 SUCCESS + Vercel SUCCESS.

The P4 suite covers:

- frozen local outcome/yield vocabularies;
- accepted program registration and idle behavior;
- no local execution on `REASON_REQUIRED`;
- conservative rejection of malformed/self-asserted `APPLY_AND_CONTINUE`;
- read-only VM effect surfacing without reasoning mediation;
- integration with a real accepted P3 `APPLY_AND_CONTINUE` decision;
- reset-required stale-run removal;
- ambiguity suspension mapping;
- VM failure mapping;
- local slice-step budget exhaustion;
- cancellation and expiry;
- effect-result provenance/verification failure;
- tenant/device/tab/document/runtime identity isolation;
- repetitive read-workload round-trip reduction;
- byte locks on P3, P2, Reactive VM, extension, and public MCP sources;
- clear/reset behavior.

## Controlled repetitive-read evidence

The deterministic P4 workload uses eight accepted `page.read` VM command leaves and
one final return.

Baseline model-mediated shape:

```text
8 browser command round trips + 1 final reasoning turn = 9 model-mediated round trips
```

P4 controlled shape:

```text
1 initial reasoning/continuation decision + 8 local browser effects + 0 additional reasoning wakes
```

Measured assertions:

- browser effects executed: **8/8**;
- browser effects hidden from accounting: **0**;
- local reasoning wakeups during the run: **0**;
- baseline model-mediated round trips: **9**;
- P4 model-mediated round trips: **1**;
- model-mediated round-trip reduction: **88.89%**;
- frozen initial P4 target: **>=60%**;
- final returned result: correct (`8`);
- synthesized `PROVED`: **0**;
- foreground takeover indicators: **0**.

This is controlled P4 evidence. It is not yet P5 real-Opera/end-to-end acceptance and
it does not by itself establish the P5 long-task speedup, steady-state snapshot, or
simple-operation-regression gates.

## Net code boundary

From accepted P3 head `d5310508aeb5c156657bd4d4abd06a4d172daaba` to P4
implementation head `460c3e7a1977792387c347762550aea554a07ebd`, the net code
diff contains only:

- `tests/event-driven-local-execution-p4.test.mjs` — added;
- `lib/event-driven-local-execution-p4.js` — added.

P4 tests freeze byte hashes for:

- `lib/multi-signal-relevance-p3.js`;
- `lib/delta-first-observation-p2.js`;
- `lib/reactive-vm.js`;
- `lib/reactive-vm-7c.js`;
- `lib/reactive-vm-7d.js`;
- `extension/content.js`;
- `extension/background.js`;
- `extension/manifest.json`;
- `supabase/functions/opera-agent-mcp/index.ts`.

Therefore P4 changes no accepted VM grammar/core source, extension distribution,
public MCP schema/source, browser primitive inventory, production state,
signing/pairing, or transaction authority.

## Explicit non-goals

P4 does not:

- change or widen the Reactive VM read-only effect surface;
- add click/fill/key/pointer/navigation or foreground authority;
- add direct logical-ID browser actions;
- add extension observers or browser primitives;
- change public MCP tools or schemas;
- deploy or mutate Supabase production state;
- add transaction or approval authority;
- start Checkpoint 8E;
- claim P5 real-Opera acceptance.

## P4 acceptance rule

The P4 final candidate is the branch head containing the P4 tests, implementation,
this acceptance record, synchronized performance plan, roadmap, project context, and
next-session handoff.

P4 becomes accepted only when on that exact head:

1. the normal CircleCI job is SUCCESS;
2. Vercel/status is SUCCESS;
3. the full Node suite, `npm run check`, and controlled Chromium extension regression
   have therefore passed through the normal CI path;
4. the P3/P2/Reactive-VM/extension/public-MCP/production/transaction boundaries remain
   unchanged.

Pending/queued/in-progress required CI => **STOP**. Failure => diagnose only that P4
failure. If all required checks are SUCCESS, P4 is accepted without a status-only
follow-up commit.

## Exact next gate

After P4 acceptance, stop. **P5 — real-Opera performance acceptance** starts only
after explicit user continuation. Milestone 8E remains paused while Performance
Track P is active.
