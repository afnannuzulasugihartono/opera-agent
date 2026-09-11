# Milestone 6 implementation plan

Status: **Checkpoints 6A through 6D complete; Checkpoint 6E is next**

Milestone 6 adds a Goal and Constraint Ledger plus a scoped Proof Engine above the
accepted Opera Agent 1.6.0 semantic runtime. It must turn an explicit user request
into revisioned, inspectable claims without confusing browser-action success with
task completion.

This milestone is primarily an MCP/server concern. The 1.6.0 extension remains the
accepted sensing and action substrate unless a measured gap proves that a browser-
local change is necessary.

## Outcome

At the end of Milestone 6, Opera Agent can represent:

- what the user asked to achieve;
- what must remain true while working;
- what the user did and did not authorize;
- which observations would count as evidence;
- which evidence is fresh, relevant, contradictory, or invalidated;
- why a claim is `PROVED`, `BOUNDED_COMPLETE`, `PARTIAL`, `BLOCKED`, or `UNKNOWN`;
- what remains unresolved;
- how a narrowed or expanded goal revision reuses only still-valid evidence.

It does not yet execute a general loop, transaction, planner, learned skill, or
parallel worker. Those belong to Milestones 7–11.

## Product boundary

### In scope

- A bounded, versioned goal-ledger schema.
- Deterministic structured compilation from model-supplied fields.
- Optimistic revision control and stale-revision rejection.
- Goal constraints, authorization limits, evidence requirements, and explicit
  non-goals.
- Typed evidence references and a deterministic proof evaluator.
- Separation of process evidence, outcome evidence, and authorization.
- Contradiction, freshness, scope, dependency, and invalidation rules.
- Safe reuse of evidence across compatible goal revisions.
- Minimal tenant-isolated head metadata in Supabase when persistence is enabled.
- A deliberately small, separately accepted MCP surface if an invocable public
  surface is required.
- Read-only production acceptance on Google Maps, YouTube, and GitHub.

### Out of scope

- Natural-language goal interpretation inside the extension.
- A general `LOOP`, `IF`, `UNTIL`, or parallel execution VM.
- Automatic execution of ledger steps.
- Direct action targeting by logical semantic ID.
- Consequential transaction commit, compensation, or rollback orchestration.
- Persistent storage of raw page text, screenshots, DOM, private URLs, form
  values, passwords, OTPs, credentials, payment data, or uploads.
- Treating authorization as evidence that an outcome happened.
- Learning selectors or site-specific procedures.
- Google Maps-specific goal or proof rules.
- Continuous audio, video, or desktop streaming.

## Non-negotiable invariants

1. `action.ok === true` can never by itself yield `PROVED` or
   `BOUNDED_COMPLETE`.
2. Authorization permits an operation; it never proves its result.
3. Every completion result names its scope, evidence, limits, unresolved claims,
   goal revision, and evaluator version.
4. A proof may use only evidence attached to the same tenant and goal lineage.
5. Evidence outside its freshness window or invalidated dependency revision is not
   silently reused.
6. A stale ledger revision is rejected, not merged heuristically.
7. Goal revisions never broaden authority implicitly.
8. Narrowing a goal may reuse evidence only when its scope and predicates imply
   the revised claim. Expanding a goal cannot inherit completeness for the new
   scope.
9. Contradictory trusted evidence remains visible and prevents a positive proof
   until resolved by an explicit rule.
10. Page-provided text cannot create user intent, authorization, or proof policy.
11. Persistent state contains no raw goal prose or page content.
12. All payloads, counts, strings, revisions, dependencies, and retention windows
    are bounded.
13. Existing browser commands remain background-first with zero tab/window focus
    takeover.
14. Opera Agent 1.6.0 remains usable if the Milestone 6 server feature is disabled
    or rolled back.

## Trust and evidence model

### Evidence categories

- `USER_ASSERTION`: a fact explicitly supplied by the authenticated user.
- `USER_AUTHORIZATION`: explicit permission with scope and optional expiry.
- `DIRECT_OBSERVATION`: data read from a browser sensor at a specific revision.
- `DERIVED_OBSERVATION`: a deterministic calculation over named evidence.
- `ACTION_RECEIPT`: proof that an attempted primitive returned a result.
- `BOUNDARY_OBSERVATION`: evidence that a bounded enumeration protocol reached
  and rechecked its defined boundary.
- `EXTERNAL_ATTESTATION`: a separately authenticated source, reserved until a
  later accepted integration supplies it.

`ACTION_RECEIPT` and `USER_AUTHORIZATION` are never outcome evidence on their own.
Untrusted webpage statements may appear only as observed data with provenance.

### Proof result

Every evaluation returns a bounded object containing:

```text
goalId
goalRevision
claimId
status
scope
evidenceRefs[]
rejectedEvidenceRefs[]
contradictions[]
limits[]
unresolved[]
evaluatedAt
evaluatorVersion
proofDigest
```

Status rules:

- `PROVED`: a closed-world claim has sufficient fresh, trusted, exhaustive
  evidence and no unresolved contradiction.
- `BOUNDED_COMPLETE`: the declared finite observation protocol reached a stable
  boundary, but the result is limited to that protocol and scope.
- `PARTIAL`: some relevant evidence exists, but requirements remain unmet.
- `BLOCKED`: a named constraint, missing authority, contradiction, unavailable
  sensor, or hard dependency prevents progress.
- `UNKNOWN`: no admissible evidence supports a stronger result.

No general web search or open-ended geographic enumeration is closed-world merely
because a result list stopped changing.

## Ledger model

The model compiles user intent into explicit structured fields. The server validates
and canonicalizes them; it does not infer additional permission from prose.

Required ledger concepts:

```text
schemaVersion
goalId
tenantId
revision
parentDigest
objective
scope
constraints[]
authorizations[]
claims[]
evidenceRequirements[]
nonGoals[]
status
createdAt
expiresAt
ledgerDigest
```

Recommended bounds for Checkpoint 6A fixtures, to be confirmed before code:

- objective: 1 item, at most 1,000 UTF-8 characters;
- constraints: at most 32;
- authorizations: at most 16;
- claims: at most 64;
- evidence requirements per claim: at most 16;
- non-goals: at most 32;
- dependency refs: at most 256 total;
- revision: monotonically increasing positive integer;
- default lifetime: 24 hours, maximum 7 days;
- canonical serialized token: at most 64 KiB;
- proof response: at most 128 KiB.

Raw values that are not necessary for evaluation should be represented by typed
identifiers, normalized predicates, or digests. Credential-like values are
rejected at validation, not merely redacted after storage.

## State-minimized persistence

The preferred architecture is a bounded signed/encrypted ledger token plus a
minimal server-side head record.

The token carries the structured ledger needed by the client. Supabase stores only:

```text
tenant_id
goal_id
head_revision
head_digest
status
created_at
updated_at
expires_at
```

This supports tenant isolation, expiry, stale-revision rejection, cancellation,
and linear history without persisting raw goal prose or page data. If token
encryption cannot be implemented with an existing managed secret boundary, the
checkpoint must stop; it must not embed a new secret in extension or repository
code.

Any new table must live outside exposed schemas when practical, have explicit
ownership and grants, and be covered by Supabase security advisors. Schema changes
must be migrations. Production rows are not created during unit tests.

## Public API decision gate

The existing 18 MCP tools do not receive conversation text and therefore cannot
create or revise a goal ledger without an explicit structured input. Checkpoint 6E
must compare two options:

1. Internal-only engine used by versioned server workflows.
2. A minimal dedicated MCP surface for opening, revising, inspecting, and
   evaluating a ledger.

The second option is useful but changes the MCP inventory and triggers ChatGPT
schema-cache/reconnect acceptance. It may proceed only if Checkpoint 6E records:

- exact tool names and schemas;
- backward compatibility with all existing 18 tools;
- OAuth tenant binding;
- payload and retention limits;
- threat-model tests;
- rollout and removal behavior;
- the user-facing reconnect requirement.

Do not add a generic command escape hatch or a tool that executes arbitrary proof
code. The extension protocol and 26 browser capabilities should remain unchanged.

## Checkpoint 6A — contract, threat model, and replay baseline

Status: **complete on 2026-09-11**. Three synthetic-only versioned fixtures now
lock the contract, hostile replay corpus, quantitative gates, state-minimized
persistence shape, and public-surface baseline. Five contract tests pass inside a
79-test full suite. `OA_CANONICAL_JSON_V1` reproduced one ledger digest across 100
runs, rejects non-safe-integer numbers, normalizes strings to NFC, preserves array
order, and sorts printable-ASCII object keys by byte. The corpus covers 15 hostile
and boundary scenarios. Protocol 1, 26 capabilities, the existing 18 MCP tools,
extension 1.6.0, and production schemas remain unchanged. The MCP public-API
decision is intentionally deferred to Checkpoint 6E.

Freeze the milestone contract before runtime changes.

Deliverables:

- versioned JSON fixtures for ledgers, revisions, evidence, contradictions, and
  proof results;
- canonical serialization and digest rules;
- trust-category and status-transition tables;
- credential-like input rejection cases;
- adversarial fixtures for prompt-injected page text, forged authorization,
  cross-tenant evidence, stale revision, expired evidence, contradiction, and
  action-success false completion;
- paired 1.6.0 performance and payload baseline;
- a public-API decision record that remains unresolved until 6E.

Exit gates:

- every schema and bound is explicit;
- deterministic fixtures reproduce identical digests across 100 runs;
- baseline records zero focus changes and zero secret persistence;
- no production schema, MCP tool, or extension change occurs;
- full existing tests remain green.

Rollback: delete only the new fixtures/tests/docs commit; runtime remains 1.6.0.

## Checkpoint 6B — deterministic ledger core

Status: **complete on 2026-09-11**. A portable pure-ESM ledger core now validates
and canonicalizes the frozen 6A contract, creates immutable digested ledgers,
forms monotonic parent-digest revision chains, rejects stale/forked revisions and
implicit authority broadening, and provides explicit cancel/expire transitions
plus metadata-only inspection. Ten focused tests include a 10,000-step bounded
revision sequence; the full suite passes 89 tests. Three runs of 1,000 operations
record medians of 0.2949 ms validation, 0.2919 ms creation, and 0.0009 ms safe
inspection. Because 6A intentionally had no ledger runtime, there is no honest
prior validation latency for a percentage comparison; this reviewed 6B result is
the first runtime baseline and the 15% regression ceiling applies from here.
There are no browser, network, database, MCP, extension, or production changes.

Implement a pure, dependency-light ledger library with no browser or network side
effects.

Deliverables:

- validation and canonicalization;
- immutable goal IDs and monotonic revisions;
- parent-digest lineage;
- typed constraints, authorizations, claims, evidence requirements, and non-goals;
- explicit revise, cancel, and expire operations;
- stale, forked, broadened-authority, and over-limit rejection;
- bounded inspection output with no secret echo.

Exit gates:

- 100% deterministic digest agreement;
- 100% rejection of stale revision and implicit authority broadening fixtures;
- zero cross-goal or cross-tenant reuse;
- 10,000-step property/fuzz sequence respects all caps;
- ordinary ledger validation median regression remains below 15% of its frozen 6A
  baseline or receives a documented stop/review.

Rollback: feature flag disables ledger creation; pure library has no stored state.

## Checkpoint 6C — scoped proof engine

Status: **complete on 2026-09-11**. The environment-neutral
`lib/proof-engine.js` now creates immutable typed evidence, validates canonical
digests, enforces category-specific trust, and evaluates freshness, tenant, goal
lineage, revision, scope, dependency, requirement, and contradiction rules. It
separates action/authorization process evidence from outcome evidence and returns
bounded, immutable, tamper-evident proof receipts with an explicit reason for
every rejection. A 12-scenario synthetic adversarial corpus produces zero false
`PROVED`; repeated boundary evidence cannot satisfy the two-observation gate.
The full suite passes 99 tests. A controlled 30-run, 500-evidence benchmark on
Windows x64 and Node 22.22.2 recorded 1.9055 ms median and 2.4166 ms p95, below
the frozen 10 ms p95 target. No browser, network, database, MCP, extension, or
production integration changed.

Implement deterministic claim evaluation over typed evidence.

Deliverables:

- evidence admissibility, freshness, scope, trust, and dependency checks;
- proof status lattice and contradiction handling;
- process-versus-outcome evidence separation;
- bounded proof receipts with canonical digests;
- explicit reasons for every rejected evidence item;
- false-`DONE` regression corpus.

Exit gates:

- zero false `PROVED` across the adversarial corpus;
- action receipt alone always yields `UNKNOWN` or `PARTIAL`;
- authorization alone always yields `UNKNOWN` or `PARTIAL`;
- closed-world proof requires exhaustive evidence;
- bounded enumeration can produce only `BOUNDED_COMPLETE`, not universal proof;
- evaluation of 500 bounded evidence items has a target p95 below 10 ms on the
  controlled baseline machine, subject to the frozen 6A measurement;
- proof output never exceeds its cap or truncates while claiming completeness.

Rollback: disable evaluator exposure; 1.6.0 descriptive completion remains intact.

## Checkpoint 6D — live revisions and selective evidence reuse

Status: **complete on 2026-09-11**. The pure `lib/revision-reuse.js` adds
metadata-only dependency fingerprints, deterministic `EQUIVALENT`, `NARROW`,
`EXPAND`, and `INCOMPATIBLE` revision classification, selective semantic-delta
invalidation, and bounded tamper-evident carry-forward receipts. Unrelated and
geometry-only changes preserve eligible evidence; relevant view/entity changes,
removal, ambiguity, expiry, missing claims, and incompatible revisions invalidate
only affected bindings. Expansion conservatively carries no evidence, so it
cannot inherit completion. `lib/minimal-head-store.js` supplies a Node SQLite
adapter used only with temporary local test databases to verify restart-safe
heads, optimistic revision/digest checks, cancellation, expiry, and the frozen
eight-column metadata-only schema. Nine focused tests bring the suite to 108
passing tests. No production database, Supabase project, MCP tool, extension,
protocol, capability, or browser behavior changed.

Connect ledger revisions to semantic dependencies without adding a browser VM.

Deliverables:

- dependency fingerprints between claims, semantic views, and evidence;
- narrowing/expansion compatibility rules;
- selective invalidation after semantic deltas;
- explicit carry-forward receipts;
- deterministic handling of reordered, removed, ambiguous, or expired entities;
- restart-safe token verification against the minimal head record in a local test
  database or isolated Supabase branch.

Exit gates:

- an unrelated mutation preserves admissible evidence and proof revision;
- a relevant mutation invalidates only dependent claims;
- narrowed scope reuses exactly the logically implied subset;
- expanded scope never inherits completeness;
- a stale or forked revision is rejected;
- restart, expiry, and cancellation tests pass without raw content persistence.

Rollback: remove the state-minimized head migration and disable persistence before
production promotion; tokens remain unusable rather than silently accepted.

## Checkpoint 6E — MCP/Supabase integration and security gate

Choose and implement the smallest invocable server surface justified by the 6A
decision record. Do not change the extension merely to expose the ledger.

Deliverables:

- exact MCP contract fixture for any new tools, or a documented internal-only
  decision;
- OAuth tenant binding on every operation;
- state-minimized head migration with least-privilege grants;
- expiry/cancellation cleanup path;
- idempotency and retry behavior;
- rate, payload, evidence, and revision limits;
- feature flag and server rollback;
- schema-cache/reconnect instructions if the MCP inventory changes.

Exit gates:

- all existing 18 tools retain identical names, input schemas, and behavior;
- unauthenticated access is rejected;
- cross-tenant access succeeds zero times across the adversarial suite;
- repeated request IDs are idempotent;
- stale heads and expired tokens are rejected;
- Supabase security advisors introduce no unresolved relevant ERROR/WARN finding;
- disabling Milestone 6 leaves Opera Agent 1.6.0 fully usable;
- no extension reinstall or re-pairing is required.

Rollback: disable the feature flag, restore the previous MCP function version, and
retain or purge only non-sensitive head metadata according to the documented TTL.

## Checkpoint 6F — compatibility, production acceptance, and release record

Run the full release ladder before declaring Milestone 6 complete.

Required verification:

- all existing Node/static/schema tests plus Milestone 6 unit, property, fuzz, and
  adversarial tests;
- controlled Chromium and isolated real Opera regression;
- Supabase queue, idempotency, timeout, restart, OAuth, tenant isolation, and
  cleanup checks;
- normal-profile, read-only goal/proof scenarios on Google Maps, YouTube, and
  GitHub;
- goal narrowing and expansion during an observation sequence;
- contradiction and expired-evidence scenarios;
- zero active-tab/focused-window changes;
- zero false `PROVED` and zero sensitive content persisted;
- prior MCP clients continue to use the existing 18 tools;
- exact server version, migration set, benchmark results, known limits, and
  rollback evidence are recorded.

If the extension is unchanged, publish Milestone 6 as a server/MCP release and do
not bump the extension merely for matching numbers. If browser-local code changes,
use the established signing identity, normal SemVer, inactive-candidate gate, and
same-identity rollback process.

Promotion rule: every required layer must pass. A partial deployment may remain
behind a disabled feature flag, but it is not a completed milestone.

## Acceptance scenarios

### Google Maps

Goal: analyze restaurants within an explicitly bounded observed protocol while
preserving the distinction between feed completion and geographic exhaustiveness.

- A stable lazy-load feed may yield `BOUNDED_COMPLETE` for that feed scan.
- It cannot yield `PROVED` for every restaurant in a physical radius without a
  closed and exhaustive evidence source.
- Zoom/movement invalidates only claims dependent on the affected viewport or
  result set.
- Narrowing rating/review constraints reuses admissible place evidence.
- Expanding the radius or moving the center creates unresolved coverage claims.

### YouTube

Goal: inspect a video page and bounded transcript/recommendation evidence without
controlling playback unless explicitly authorized.

- Transcript availability and observed transcript coverage are separate claims.
- Playback/action receipts do not prove content analysis.
- Dynamic recommendation changes invalidate only dependent claims.

### GitHub

Goal: inspect repository state under a declared branch/file scope.

- A bounded page read may prove only what was directly observed.
- Repository-wide completeness needs a defined exhaustive source or remains
  bounded/partial.
- Dynamic additions produce deltas without changing stable identities.

All scenarios remain read-only for Milestone 6 production acceptance.

## Quantitative release gates

Values frozen in 6A may become stricter after measurement, but not weaker without
an explicit review:

| Gate | Target |
| --- | ---: |
| Existing regression suite | 100% pass |
| Deterministic digest replay | 100% agreement |
| False `PROVED` adversarial cases | 0 |
| Cross-tenant accepted operations | 0 |
| Stale revision accepted | 0 |
| Implicit authority broadening accepted | 0 |
| Focus/tab takeover | 0 |
| Persisted secret/raw page values | 0 |
| Proof evaluation size | <= 128 KiB |
| Ledger token size | <= 64 KiB |
| Proof evaluation at 500 evidence items | target p95 < 10 ms |
| Ordinary validation median regression | <= 15% |

## Implementation order

```text
6A contract and hostile corpus
  -> 6B pure ledger and revision core
  -> 6C pure proof evaluator
  -> 6D dependency-aware revision reuse
  -> 6E authenticated MCP/Supabase integration
  -> 6F cross-layer production acceptance
```

Do not begin a later checkpoint while an earlier exit gate is unexplained or while
its rollback is untested.
