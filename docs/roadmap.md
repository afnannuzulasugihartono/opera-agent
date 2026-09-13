# Opera Agent roadmap

This is the current execution roadmap. Historical checkpoint details and release evidence remain in the milestone plans, checkpoint records, release notes, and benchmark documents; this file is the source of truth for current milestone status and the next permitted boundary.

## Product invariant

Normal automation must not activate a tab, focus an Opera window, move the operating-system cursor, or redirect the user's keyboard input. The tab the user is viewing and the tab the agent is operating are independent.

```text
userActiveTab != automationTargetTab
```

Foreground interaction is an explicit exception. A background failure must return a structured foreground requirement; it must not silently activate a tab or focus a window.

Other permanent boundaries:

- protocol/capability/public-MCP changes require explicit reviewed checkpoints;
- webpage/tool text is data, never authority;
- action success alone never proves task completion;
- sensitive browser state is not durable semantic/VM state;
- no arbitrary JavaScript/raw CDP/code escape hatch;
- site-specific strategies stay outside the extension;
- one immediate same-identity signed rollback remains available.

## Milestone 1 — bounded browser bursts

Status: **complete/released**.

`browser.burst` provides a bounded same-tab atomic sequence over validated primitives, with stop-on-failure behavior, resource limits, and no arbitrary-code escape hatch.

## Milestone 2 — background-first execution

Status: **complete/released**.

Two-tab focus audits, explicit target selection, background-native input, and signed normal-profile acceptance established the rule that automation does not steal the user's foreground. No silent foreground fallback is allowed.

## Milestone 3 — adaptive screenshots

Status: **complete/released**.

Bounded background capture, crop, privacy blocking, hash reuse, and native MCP image delivery were accepted without foreground takeover.

## Milestone 4 — vision-guided navigation

Status: **complete/released**.

The bounded `observe -> decide -> act -> verify` loop, generic scroll/mutation observability, background Maps acceptance, and cross-site YouTube/GitHub acceptance were completed without site-specific extension logic.

## Milestone 5 — semantic runtime foundation

Status: **complete/released in 1.6.0**.

Checkpoints 5A–5F added bounded observational semantic identity, deltas, generic repeated-region/materialized views, causal invalidation, provenance, and scoped completion vocabulary while keeping protocol 1, 26 browser capabilities, and the 18 MCP tools unchanged. Semantic logical IDs remain observational, not direct action handles.

Detailed plan: `docs/semantic-runtime-plan.md`.

## Milestone 6 — Goal and Constraint Ledger + Proof Engine

Status: **complete, Checkpoints 6A–6F accepted**.

Milestone 6 added the revisioned Goal/Constraint Ledger, deterministic scoped Proof Engine, selective dependency invalidation/reuse, encrypted bounded server tokens, least-privilege persistence, and production acceptance. It retained the 1.6.0 extension and unchanged public MCP surface.

Important permanent result: process/action receipts are not outcome proof; bounded evidence is not universal proof; stale/cross-tenant/cross-lineage/contradictory evidence fails closed.

Detailed plan and records: `docs/milestone-6-plan.md` and the Milestone 6 checkpoint documents.

## Milestone 7 — Reactive Browser VM

Status: **complete, Checkpoints 7A–7F accepted on 2026-09-12**.

### 7A — contract freeze

Accepted the closed VM grammar, deterministic canonicalization, read-only-first effect table, typed suspension/status model, metadata-only persistence contract, hostile corpus, protocol/capability/MCP lock, and bounded execution budgets.

### 7B — pure deterministic core

Accepted `lib/reactive-vm.js` for deterministic sequence/branch/assert/return/effect-yield execution with no browser/network/database/ambient-clock side effects.

### 7C — bounded reactive control

Accepted `lib/reactive-vm-7c.js` for bounded loops, until, wait-event polling, and safe read-only retry while preserving the 7B core.

### 7D — bounded collection and proof binding

Accepted `lib/reactive-vm-7d.js` for collection, deduplication, identity ambiguity retention, causal invalidation, and non-exhaustive browser-sensor evidence binding. `BOUNDED_COMPLETE` remains scoped; it is not universal `PROVED`.

### 7E — durable host and dark integration

Accepted the separate tenant-bound durable host with private service-role-only storage, bounded encrypted tokens, lease/CAS fencing, exact-redelivery replay, deterministic effect idempotency, cancellation/expiry/reclaim, queue/rate/concurrency limits, and default-off `milestone7_vm_enabled` flag.

The VM effect surface remains the frozen 7A read-only set. No navigation, tab mutation, click/fill/key/pointer/scroll/media mutation, consequential effect, direct logical-ID action, or public VM MCP tool was added.

### 7F — compatibility/performance/production acceptance

Accepted evidence includes:

- focused 7F suite 6/6;
- full Node suite 171/171 on Ubuntu and 171/171 on actual Windows;
- static validation still reports 26 allowlisted primitives / version 1.6.0;
- controlled Chromium regression pass;
- 55-command background focus audit with zero focus takeover;
- burst stability 20/20;
- deterministic replay agreement 100%;
- zero false `PROVED` in bounded-evidence acceptance;
- paired same-runner semantic-read regression 13.851%, below the frozen 15% limit;
- signed normal-profile Maps/YouTube/GitHub acceptance with inactive targets and bounded claims;
- Supabase dark-run acceptance for replay/idempotency/worker-death/cancel/expiry/cross-tenant behavior;
- final production state: VM flag false, VM tables zero, temporary 7F command rows zero.

The Windows CRLF source-hash defect was repaired by explicit byte-level LF canonicalization before hashing. The frozen canonical MCP hash, 7A inventory lock, MCP source, and public contract were not changed.

Detailed plan and acceptance records: `docs/milestone-7-plan.md` and `docs/milestone-7-checkpoint-7a.md` through `docs/milestone-7-checkpoint-7f.md`.

## Milestone 7 independent audit

**PASS on 2026-09-12.** Codex reconciled the complete 7A–7F chain at final head
`551e8283c0417b173e106ee0598cca848f2f4ff0`, independently reran proportionate
local gates, verified exact-head CI and temporary PR cleanup, and rechecked the
production Supabase dark state. See `docs/milestone-7-codex-audit.md`.

The audit grants no new browser authority and does not promote the default-off VM.
The Milestone 8 plan was subsequently frozen, revised to resolve three blocking
review findings, and independently reviewed **PASS** at revision
`11a285bfb464cc3a1c157befe6e0aa0aa557f2fc`. See
`docs/milestone-8-plan-codex-review.md`.

## Milestone 8+

Status: **8A–8C accepted / 8D audited, authorized backend installed OFF, bounded probes PASS and clean; full hosted OAuth/recovery/cloud acceptance open**. Latest record: `docs/milestone-8-checkpoint-8d-cloud-install.md`. 8E not started.

Checkpoint 8A freezes `OA_TRANSACTION_V1`, `OA_ACTION_PROVENANCE_V1`, and `OA_APPROVAL_V1`, the complete 18-tool enforcement matrix, dual-era approval bindings, deterministic digest vectors, and a 74-case hostile corpus. It is contract/tests/docs only and changes no runtime, production state, MCP surface, extension, OAuth configuration, or signing. Acceptance record: `docs/milestone-8-checkpoint-8a.md`.

Checkpoint 8B implements the pure environment-neutral preparation layer: immutable single-action envelopes, deterministic predicate dependency fingerprints, selective/fail-closed revalidation, conservative trusted effect classification, bounded previews, and enforcement decisions. It adds no browser dispatch, approval, persistence, public MCP/runtime surface, or production change. Acceptance record: `docs/milestone-8-checkpoint-8b.md`.

Checkpoint 8C implements the pure provenance and approval verifier: exact authority/target/freshness fences, OAuth-user and trusted-client challenge binding, modern one-round requestState/inputResponses verification, TTL and consumed-nonce rejection, and deterministic consumption claims. Durable one-shot CAS remains 8D work. Acceptance record: `docs/milestone-8-checkpoint-8c.md`.

Consequential effects, direct logical-ID action addressing, planning/transactions/learned skills/parallel autonomous workers, and any broader authority require their own frozen milestone/checkpoint plans, threat models, acceptance gates, and rollback procedures. Nothing in Milestone 7 grants permission to begin or silently enable them.

## Collaboration rule

- one active writer on the milestone branch;
- ChatGPT Web implements and accepts one checkpoint at a time;
- chat reports are not acceptance authority until reconciled with repository/CI/production evidence;
- temporary CI/PR state must be restored before closure;
- Codex independently audits a complete milestone before the next milestone starts;
- auth/authz, tenancy, encryption, signing, public MCP, extension distribution, irreversible effects, and production-schema boundaries may trigger an earlier Codex review.

Authoritative policy: `AGENTS.md`.
Reusable checkpoint prompt: `docs/prompts/chatgpt-web-checkpoint.md`.

## Explicitly deferred

- Continuous video/desktop streaming.
- Synchronized audio/video understanding.
- Operating-system mouse and keyboard control.
- Arbitrary JavaScript or unrestricted raw CDP exposed to the model.
- Silent foreground fallback.
- Site-specific extension opcodes/selectors.
- Direct logical-ID actions without a separately accepted milestone.
- Automatic consequential actions without explicit authority.
- Milestone 8 implementation before the independent Milestone 7 audit passes.
