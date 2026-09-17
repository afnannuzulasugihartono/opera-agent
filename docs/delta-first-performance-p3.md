# Performance Track P — Checkpoint P3 acceptance record

Date: 2026-09-17

Status: **FINAL CANDIDATE — exact-head CircleCI + Vercel/status required. P4 has not started.**

## Boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Accepted P2 head: `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d`
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Milestone 8: 8A–8D accepted; 8E paused/not started
- Signing/pairing and signed rollback `1.5.2`: unchanged
- Production/Supabase/transaction authority changes in P3: **none**

## Objective

P3 prevents low-level browser event volume from becoming reasoning-turn volume.
It adds a bounded multi-signal change epoch and a deterministic relevance gate over
the accepted P2 delta-first observation pipeline.

P3 exposes exactly three relevance outcomes:

```text
IGNORE_FOR_TASK
APPLY_AND_CONTINUE
REASON_REQUIRED
```

`IGNORE_FOR_TASK` suppresses only the reasoning wake. Canonical P2/P1 state still
advances. `APPLY_AND_CONTINUE` is permitted only for dependencies explicitly present
in accepted local-continuation context. `REASON_REQUIRED` has precedence and is the
conservative result for any safety or context uncertainty.

## Implementation

P3 adds:

- `lib/multi-signal-relevance-p3.js`
- `tests/multi-signal-relevance-p3.test.mjs`

The implementation wraps `createDeltaFirstObservationPipeline()` rather than
replacing P2 continuity/state logic.

Accepted signal vocabulary is bounded to:

- `ACTION_RESULT`
- `DOM_MUTATION`
- `GEOMETRY_RESIZE`
- `NAVIGATION_HISTORY`
- `RECONNECT_RESET`
- `SCROLL_VIEWPORT`
- `SEMANTIC_MUTATION`
- `WAIT_CONDITION`

Signals contribute only bounded metadata: signal type, logical IDs, region IDs, and
wait-condition IDs. Arbitrary page/model fields on a signal are ignored and are not
retained in P3 output.

## Relevance authority

Task relevance is accepted only from a context with:

- source `ACCEPTED_GOAL_CONSTRAINT_DEPENDENCIES`;
- bounded `goalId`;
- positive ledger revision;
- canonical `sha256:` ledger digest;
- explicit reason dependencies and local-continuation dependencies.

Supported dependency classes are entity ID, semantic view ID, wait-condition ID,
and accepted P3 signal type.

Missing, malformed, untrusted, or oversized dependency context cannot suppress
reasoning and resolves conservatively to `REASON_REQUIRED`.

Page text, model text, raw signal payloads, or signal fields claiming relevance or
authority cannot grant wake/suppress authority.

## Change epochs and safety behavior

Signals are isolated by trusted runtime identity:

```text
tenant + device + tab + documentGeneration + runtimeEpoch
```

Each open epoch is explicitly bounded by signal count, affected-key count, and age.
Overflow and expiry remain visible in epoch accounting and force
`REASON_REQUIRED`.

`NAVIGATION_HISTORY` and `RECONNECT_RESET` are safety signals and are never silently
ignored. Any P2 full-snapshot/reset-required/continuity-loss result is propagated as
`REASON_REQUIRED`; P3 never suppresses a required reset.

Exact semantic replay with no new relevant signal remains idempotent and does not
wake reasoning again.

## Tests-first chain

- `388df28d5795da2cb1fe72ece2ff25f46b7411d5` — P3 contract tests only; CircleCI #92 expected red because `lib/multi-signal-relevance-p3.js` did not yet exist; Vercel SUCCESS.
- `9309debd0db66993e99519f7015bf81a3c0804dd` — P3 implementation; CircleCI #93 SUCCESS + Vercel SUCCESS.

The P3 suite covers:

- frozen decision and signal vocabularies;
- trusted RESET/full-snapshot bootstrap;
- irrelevant mutation storm coalescing;
- later relevant-entity detection;
- accepted `APPLY_AND_CONTINUE` dependencies;
- `REASON_REQUIRED` precedence;
- missing/invalid/untrusted relevance context;
- page/model prompt-injection-like relevance hints being ignored;
- wait-condition and signal-type dependencies;
- navigation/history and reconnect/reset safety signals;
- P2 continuity failure propagation;
- exact replay without duplicate wake;
- signal-count overflow;
- affected-key overflow;
- epoch expiry;
- cross-tab/document/runtime isolation;
- dependency-context bounds;
- raw signal/page secret exclusion when reasoning is suppressed;
- no synthesized completion, foreground/browser authority, or VM execution;
- byte locks on P2, extension, public MCP, and Reactive VM sources;
- clear/reset recovery behavior.

## Controlled irrelevant-mutation-storm evidence

The deterministic P3 acceptance workload runs 10 irrelevant epochs followed by one
relevant change:

- raw irrelevant signals: `10 × 128 = 1,280`;
- later relevant signal: `1`;
- total raw signals: **1,281**;
- unnecessary reasoning wakeups across the 10 irrelevant epochs: **0**;
- total reasoning wakeups after the later relevant update: **1**;
- later relevant update detected exactly: **1/1**;
- relevant-signal loss: **0**;
- false completion: **0**;
- foreground takeover: **0**;
- canonical state failed to advance during suppressed reasoning: **0**.

This is controlled P3 evidence. It is not a claim that P4's >=60% repetitive
reasoning/tool-round-trip target or P5 real-Opera/end-to-end targets are already
accepted.

## Net code boundary

From accepted P2 head `8621e2dc454f8e8f1e977c350522e6fb2b5dc51d` to the
P3 implementation head `9309debd0db66993e99519f7015bf81a3c0804dd`, the net
diff contains only:

- `lib/multi-signal-relevance-p3.js` — added;
- `tests/multi-signal-relevance-p3.test.mjs` — added.

P3 tests additionally freeze byte hashes for:

- `lib/delta-first-observation-p2.js`;
- `extension/content.js`;
- `extension/background.js`;
- `extension/manifest.json`;
- `supabase/functions/opera-agent-mcp/index.ts`;
- `lib/reactive-vm.js`;
- `lib/reactive-vm-7c.js`;
- `lib/reactive-vm-7d.js`.

Therefore P3 does not change extension distribution, `page.read`, public MCP schema,
Reactive VM execution, production state, signing/pairing, or transaction authority.

## Explicit non-goals

P3 does not:

- add MutationObserver/IntersectionObserver/ResizeObserver wiring to the extension;
- add browser primitives or public MCP fields/tools;
- run or resume the Reactive Browser VM;
- implement P4 event-driven local execution;
- add transaction execution or approval authority;
- change Supabase database/Edge/OAuth/production state;
- change extension/CRX/signing/pairing;
- start Milestone 8E.

## P3 acceptance rule

The P3 final candidate is the branch head containing this acceptance record plus the
synchronized performance plan, roadmap, project context, and next-session handoff.
P3 becomes accepted only when on that exact head:

1. the normal CircleCI job is SUCCESS;
2. Vercel/status is SUCCESS;
3. the full Node suite, `npm run check`, and controlled Chromium regression have
   therefore passed through the normal CI path;
4. no P2/extension/public-MCP/VM/production/transaction boundary changed.

Pending/queued/in-progress required CI => **STOP**. Failure => diagnose only that P3
failure. If all required checks are SUCCESS, P3 is accepted without a status-only
follow-up commit.

## Exact next gate

After P3 acceptance, stop. P4 — event-driven local Reactive VM execution — starts
only after explicit user continuation. Milestone 8E remains paused while Performance
Track P is active.
