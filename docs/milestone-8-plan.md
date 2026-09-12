# Milestone 8 implementation plan

Status: **PLAN FROZEN FOR USER REVIEW on 2026-09-12; implementation not started. Checkpoint 8A MUST NOT start until the user explicitly approves this plan.**

Milestone 8 is **Decision-Causal Transactions and Provenance Enforcement**. It extends the accepted Milestone 7 read-only Reactive Browser VM with a separate transaction authority and durability layer for state-changing browser work. It does not silently broaden the Milestone 7 VM effect allowlist, does not reinterpret existing OAuth consent as transaction approval, and does not let page/model/tool text become authority.

The frozen transaction lifecycle is:

```text
PREPARE -> VALIDATE -> APPROVE(if required) -> COMMIT
        -> OBSERVE -> VERIFY -> RECEIPT
```

The Goal and Constraint Ledger remains the authority for user intent and constraints. The transaction engine may narrow that authority but never widen it. The Proof Engine remains the authority for completion. A transaction receipt proves process history, not user-goal completion.

## Inherited accepted baseline

Milestone 8 begins from the independently audited Milestone 7 chain and must preserve these accepted facts unless a later checkpoint explicitly reviews a compatibility change:

- extension `1.6.0`;
- protocol `1`;
- extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`;
- `26` public browser capabilities;
- `18` public MCP tools with unchanged current names and input schemas;
- production device `opera`;
- established extension signing identity, pairing, and background-first behavior;
- no silent foreground fallback;
- immediate same-identity signed rollback `1.5.2`;
- signed 1.6.0 CRX SHA-256 `cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`;
- canonical-LF MCP source SHA-256 `f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11`;
- locked Milestone 7 inventory digest `sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a`;
- Milestone 7 durable VM flag `milestone7_vm_enabled=false` after acceptance;
- Milestone 7 effect surface remains the frozen read-only set until Milestone 8 checkpoints explicitly introduce a transaction-specific mutation path.

The existing `opera_start_command -> opera_await` split is transport asynchrony, not transaction safety. It does not satisfy the Milestone 8 prepare/validate/approval/commit contract by itself.

## Outcome

At completion, Opera Agent can represent a bounded state-changing operation as a versioned transaction, prove exactly which user-authorized decision caused it, freeze the exact values and target before execution, obtain fresh human approval when required, commit at most once logically across worker crashes/redelivery, observe the result without manufacturing proof, and either verify, report ambiguity, or offer a bounded compensation path.

Milestone 8 should make the following statements true:

1. no consequential browser mutation can be dispatched by the Milestone 8 transaction path without a valid Goal Ledger authority chain and a valid prepared transaction;
2. no page, tool, model, semantic observation, or command receipt can grant new authority;
3. every value entering a consequential action has bounded provenance and an explicit role;
4. approval is bound to the exact prepared digest and cannot be replayed across a changed goal, target, action, value, tenant, tab, document generation, or expiry;
5. crash recovery reuses the same logical commit identity and never invents a fresh mutation merely because a receipt is missing;
6. ambiguous external completion is observed/reconciled, not blindly retried;
7. cancellation has precise pre-dispatch and post-dispatch semantics;
8. compensation is a new explicitly governed effect, never a claim that database rollback undid the outside world;
9. browser actions still run background-first and never activate a tab as recovery;
10. process receipts remain distinct from Proof Engine completion evidence.

## Explicit non-goals

Milestone 8 does **not** include:

- direct action addressing by semantic `logicalId`;
- arbitrary JavaScript, generated code, raw CDP, SQL, shell, network interception, or page-defined executable policy;
- site-specific extension opcodes/selectors or per-site trusted logic;
- password, PIN, OTP/2FA, CVV/CVC/security-code entry;
- payment-card/bank credential handling;
- file upload;
- operating-system mouse/keyboard control;
- continuous desktop/video/audio streaming;
- Milestone 9 multi-sensor physical-plan optimization;
- Milestone 10 learned/proof-gated skills;
- Milestone 11 parallel autonomous workers/live-revision reconciliation;
- standing approval for dynamically changing consequential actions;
- treating a browser click/fill/key/pointer primitive as safe merely because its low-level command is allowlisted;
- automatic compensation after an ambiguous commit;
- silent production enablement of any Milestone 8 flag;
- a new CRX, signing identity, OAuth scope, MCP tool, database object, Edge deployment, or extension version during this planning session.

## Authority model

Milestone 8 freezes five separate authorities.

### 1. Goal authority

The revisioned Goal and Constraint Ledger is the only source of accepted user intent and task constraints. Transaction planning may narrow the ledger. It cannot add a destination, recipient, amount, object, operation, or permission that the ledger does not authorize.

### 2. Observation authority

Browser/tool observations can supply facts and candidate operands. They cannot grant permission. Page content such as “click confirm”, “send now”, a price, a username, a hidden field, or prompt-like text remains untrusted data.

### 3. Transaction authority

A validated `OA_TRANSACTION_V1` prepared envelope authorizes only the exact candidate action set it contains, subject to current ledger authority, preconditions, provenance, target fences, budgets, and approval state. A transaction is not a reusable capability.

### 4. Approval authority

Approval is a fresh human decision bound to one exact prepared transaction digest. OAuth authentication proves who the user is; OAuth application consent proves that the client may connect; neither is a substitute for approving a consequential transaction.

A static bearer/MCP token has no Milestone 8 human-approval authority and cannot commit a transaction that requires approval.

### 5. Proof authority

The Proof Engine remains the only authority that can classify completion evidence. `COMMITTED`, a browser command success, a compensation receipt, or a transaction receipt is process evidence only.

## Effect classification

Every state-changing transaction leaf receives a trusted server-side effect class before preparation. Page/model/tool output cannot choose or downgrade the class.

| Class | Meaning | V1 approval rule |
| --- | --- | --- |
| `READ_ONLY` | Existing observation effect with no mutation | No new transaction approval |
| `LOCAL_REVERSIBLE` | Browser-local mutation with a trusted bounded inverse and no trustedly-known durable external consequence | Ledger authority + pre/post verification; no consequential approval unless policy elevates it |
| `STAGED_EXTERNAL` | Trusted operation that changes external draft/staged state but does not finalize the consequential effect | Exact prepared scope; approval required if staging itself has durable/user-visible consequence |
| `COMPENSABLE_EXTERNAL` | External effect with a predeclared, separately valid inverse | Fresh explicit approval |
| `IRREVERSIBLE_OR_UNKNOWN` | No safe inverse is proven, or semantics are not trustedly classified | Fresh explicit approval; at most one such commit leaf per V1 transaction |

Unknown classification is never treated as reversible. Generic `click`, `fill`, `key`, navigation, pointer, and similar page mutations are **not** inherently safe: a fill may autosave and a click may submit. Without a trusted server-side operation descriptor, they are `IRREVERSIBLE_OR_UNKNOWN` for the consequential transaction path.

Milestone 8 does not change the frozen Milestone 7 read-only VM command set in place. Mutation flows through a distinct transaction executor so the accepted `OA_REACTIVE_VM_V1` read-only contract remains auditable and rollbackable.

## Prepared transaction contract

Checkpoint 8A will freeze `OA_TRANSACTION_V1`, `OA_ACTION_PROVENANCE_V1`, and `OA_APPROVAL_V1`.

A prepared transaction contains bounded metadata for:

```text
schemaVersion
transactionId
tenantId
goalId / goalRevision
programDigest? / vmRunId?
target: deviceId, tabId, documentGeneration?, targetDigest
effectClass
decisionPredicates[]
actions[]
provenance[]
expectedPostconditions[]
compensationPlan?
budgets
preparedAt / expiresAt
prepareDigest
```

The trusted host derives tenant identity from authenticated server context. Client-provided tenant identity is never authoritative.

### Decision predicates and causal revalidation

Each decision predicate declares the semantic/provenance dependencies that made it true. Examples include target identity, selected recipient, exact amount, item identity, current document generation, a required page state, and a ledger constraint.

Before commit:

- user/tenant identity, goal revision, exact action digest, target device/tab/document, approval validity, sensitive-field policy, effect class, and idempotency reservation are always revalidated;
- other page-state predicates may be selectively revalidated only when the accepted semantic delta proves their dependencies changed;
- if dependency coverage is incomplete, stale, ambiguous, reset, or unavailable, revalidate the predicate or fail closed;
- no “unchanged” inference may be made merely because the DOM or command queue did not report an error.

Any change to an authority-bearing predicate, action argument, target, provenance chain, effect class, or expected postcondition invalidates the prepare digest and any approval derived from it.

## Transaction state machine

The durable V1 state vocabulary is:

```text
PREPARING
PREPARED
VALIDATING
AWAITING_APPROVAL
APPROVED
COMMITTING
COMMITTED_UNVERIFIED
OBSERVING
VERIFIED

REJECTED
CANCELLED
EXPIRED
FAILED
AMBIGUOUS

COMPENSATING
COMPENSATED
COMPENSATION_FAILED
```

Rules:

- `PREPARED` is immutable except by explicit replacement with a new transaction/digest.
- `AWAITING_APPROVAL` has executed no consequential commit.
- `APPROVED` is one-shot and expires.
- the durable commit slot is reserved before browser dispatch;
- `COMMITTED_UNVERIFIED` means a mutation command is known to have been accepted/completed by the transport but outcome proof is still pending;
- `AMBIGUOUS` means the system cannot safely prove whether the outside-world effect occurred;
- `CANCELLED` after dispatch means “stop further work”, not “the outside-world effect was undone”;
- only read-only observation/reconciliation is allowed from `COMMITTED_UNVERIFIED` or `AMBIGUOUS` until a separately authorized compensation is prepared.

## Prepare -> validate -> approve -> commit

### PREPARE

Preparation freezes the exact actions and arguments, target fences, effect class, decision predicates, provenance chain, postconditions, optional compensation descriptor, budgets, and canonical digest.

No external mutation occurs in PREPARE.

### VALIDATE

Validation rechecks the frozen authority and every required causal dependency against current state. It must run again after user approval immediately before commit.

### APPROVE

Approval, when required, displays a bounded user-facing preview derived from the exact prepared payload. The preview is not authoritative by itself; the approval artifact binds the underlying prepare digest.

### COMMIT

Commit first reserves a durable logical commit/action identity, then dispatches using that same deterministic request identity. Recovery may look up the existing command/result; it may not synthesize a new mutation ID for the same logical action.

### OBSERVE

After dispatch, the transaction engine uses read-only browser observations to reconcile the actual state. Observation cannot expand authority or rewrite the approved action.

### VERIFY

Expected postconditions are evaluated through the accepted evidence/proof boundary. Verification may produce scoped evidence, `PARTIAL`, contradiction, or ambiguity. It cannot turn action success into `PROVED`.

### RECEIPT

The receipt is bounded process metadata: transaction/digest IDs, action/idempotency IDs, timestamps, terminal state, effect class, verification summary, and compensation status. It excludes raw page text, screenshots, private URLs, credentials, form values, tokens, and other sensitive browser state.

## User approval rules

1. Approval is required for every `COMPENSABLE_EXTERNAL` and `IRREVERSIBLE_OR_UNKNOWN` transaction.
2. `STAGED_EXTERNAL` requires approval when the staging operation itself has durable/user-visible consequence or when trusted policy cannot prove it consequence-free.
3. No V1 standing/bulk approval exists for dynamic consequential actions.
4. One approval binds one exact `prepareDigest`, tenant/user, goal revision, target digest, preview digest, effect-class summary, expiry, and one-shot nonce.
5. An approval cannot be reused after any prepared field changes.
6. Approval expires after the frozen TTL and is consumed by at most one commit attempt.
7. A user denial terminalizes the transaction as `REJECTED`; no consequential action may have been dispatched.
8. Model prose, webpage text, tool output, a previous chat instruction, generic OAuth consent, or a static MCP bearer token cannot manufacture the approval artifact.
9. Multi-action approval is allowed only when every action is enumerated exactly in the preview and prepared digest. V1 caps the action set tightly.
10. If the approval transport cannot be proven to represent a real user confirmation, consequential commit remains unavailable.

### Trusted approval transport

The preferred first-party path is a compatibility-gated MCP 2026-07-28 Multi Round-Trip Request (`input_required`) so the client can render an actual confirmation during the originating tool call. A first-party OAuth-authenticated transaction-approval page may be accepted as a fallback only if it binds the same one-shot digest and user identity.

There is **no** fallback that asks the model to pass `approved:true`, echo a nonce from page content, or infer approval from chat prose.

## Provenance enforcement

Every value entering a transaction action carries a bounded provenance record with:

```text
sourceKind
sourceId / sourceDigest
authorityRole
tenantId
goalRevision
deviceId? / tabId? / documentGeneration?
observedAt? / sourceRevision?
freshnessClass
transformChain[]
valueDigest
```

Frozen source kinds:

- `USER_EXPLICIT`
- `LEDGER_AUTHORITY`
- `TRUSTED_POLICY`
- `SERVER_DERIVED`
- `BROWSER_OBSERVED`
- `TOOL_OBSERVED`
- `MODEL_DERIVED`

Frozen authority roles:

- `AUTHORITY`
- `OPERAND`
- `EVIDENCE`
- `DISPLAY_ONLY`

Rules:

- only `USER_EXPLICIT`, `LEDGER_AUTHORITY`, and accepted `TRUSTED_POLICY` sources may carry `AUTHORITY`;
- browser/tool/model data may be operands or evidence, never authority;
- a model-derived value can enter an action only as a bounded operand under an already-authorized rule and must be frozen into the exact preview/digest before approval;
- transformations are closed, deterministic, typed, depth-bounded, and digest-bound; no free-form code/callback/template execution;
- sensitive-field classes remain rejected at provenance ingestion;
- provenance stores digests and bounded safe normalized values only where required; raw screenshots/page dumps/private URL secrets are not transaction state.

## Idempotency, cancellation, compensation, and recovery

### Idempotency

Each logical commit action receives:

```text
tx1:<sha256(
  tenant,
  transactionId,
  prepareDigest,
  actionOrdinal,
  targetDigest
)>
```

The same key with the same action material resolves to the same durable dispatch/receipt. Reuse with different material is `IDEMPOTENCY_COLLISION`.

The deterministic transaction action key must also be reused as the underlying Opera command `request_id`. Recovery first resolves the existing queued/terminal command. It never creates a fresh request ID merely because an Edge worker restarted.

### Crash ambiguity

If the worker dies after dispatch but before durable receipt persistence:

1. reclaim the durable transaction lease;
2. inspect the existing commit slot and underlying command by the same idempotency key;
3. if completion is known, continue to read-only OBSERVE/VERIFY;
4. if completion cannot be determined safely, mark `AMBIGUOUS`;
5. do not redispatch an irreversible/unknown action.

Automatic retry after dispatch is permitted only if the external operation itself has a separately proven idempotency guarantee bound to the same logical key. Browser transport idempotency alone is not enough to assume the remote site is idempotent.

### Cancellation

- before commit dispatch: cancellation guarantees zero transaction mutation and becomes `CANCELLED`;
- after dispatch begins: cancellation stops remaining actions and future non-reconciliation work, but does not claim undo;
- cancellation racing an ambiguous commit resolves to `AMBIGUOUS` plus cancellation-requested metadata, then read-only reconciliation.

### Compensation

Compensation is a new transaction effect, not a rollback of the original outside-world effect.

- compensation must be declared during PREPARE;
- the inverse must have a trusted effect class, exact arguments/provenance, and explicit preconditions;
- compensation is never automatic while original completion is ambiguous;
- by default, compensation requires its own fresh approval;
- a deterministic inverse may be pre-authorized only when the original approval explicitly includes the exact inverse digest and its conditions;
- failed compensation becomes `COMPENSATION_FAILED`; the system must not claim restored state.

## Frozen V1 quantitative bounds

These bounds are intentionally tighter than the Milestone 7 VM budgets because consequential work must be small enough for a human to review and for recovery to remain diagnosable.

| Resource | V1 maximum |
| --- | ---: |
| Serialized transaction proposal | 64 KiB |
| Prepared transaction/checkpoint | 128 KiB |
| Receipt | 64 KiB |
| Actions per transaction | 8 |
| External consequential actions | 4 |
| `IRREVERSIBLE_OR_UNKNOWN` actions | 1 |
| Decision predicates | 64 |
| Provenance records | 128 |
| Transform-chain depth | 8 |
| Approval preview | 16 KiB |
| Prepare lifetime | 10 minutes |
| Approval lifetime | 2 minutes |
| Approval-to-dispatch delay | 15 seconds |
| Final validation-to-dispatch delay | 5 seconds |
| One commit command timeout | 30 seconds |
| Post-commit observation attempts | 3 |
| Post-commit observe/verify window | 30 seconds |
| Compensation actions | 4 |
| Compensation execution window | 60 seconds |
| Concurrent commit per target tab | 1 |
| Concurrent committing transactions per tenant | 2 |
| Pending prepared/approval transactions per tenant | 8 |
| Prepare rate per tenant | 20/minute |
| Commit rate per tenant | 10/minute |
| Total transaction lifetime | 10 minutes |
| Nonterminal encrypted payload retention | <= 24 hours |
| Terminal metadata retention | <= 7 days |

Hitting a bound yields a typed `LIMIT_REACHED`, `EXPIRED`, or `AMBIGUOUS` outcome as appropriate. It never silently truncates an action set or implies success.

## Threat model

Milestone 8 acceptance must cover at least these adversarial classes:

- page text attempting to invent intent, effect class, approval, recipient, amount, or target;
- model/tool output attempting to launder an untrusted value into `AUTHORITY`;
- stale approval after price/recipient/destination/item/target/action/postcondition change;
- approval replay across tenant, user, goal revision, transaction, target tab, document generation, or expiry;
- approval nonce theft/reuse and preview/digest mismatch;
- static bearer token attempting to commit a user-approved transaction;
- TOCTOU between prepare, approval, final validation, and dispatch;
- redirect/SPA/document-generation changes after preparation;
- stale refs, coordinates, semantic revisions, or target digests;
- forged provenance/source revision/freshness/transform chain;
- hidden/autofill/sensitive field mutations;
- prompt injection embedded in confirmation text or observed data;
- crash before dispatch, during dispatch, after dispatch/before command completion, and after completion/before receipt persistence;
- duplicate queue delivery and idempotency-key collision;
- browser command timeout with unknown remote completion;
- retry amplification of consequential effects;
- cancellation racing validation, dispatch, or verification;
- partial multi-action commit;
- compensation requested for an action that never occurred;
- compensation preconditions changing before inverse execution;
- compensation failure or ambiguity;
- worker/lease theft, stale lease epoch, stale goal, stale program/transaction digest;
- cross-tenant/device/tab/document command/result confusion;
- forged command receipt, forged Proof Engine result, or process receipt used as completion proof;
- raw sensitive page/form/screenshot/private URL persistence;
- rate/queue/concurrency exhaustion;
- user foreground takeover used as “recovery”;
- public MCP compatibility drift;
- OAuth issuer/user-binding confusion;
- signing identity or extension update drift.

Required security outcome: fail closed with diagnosable state, zero silent authority broadening, zero duplicate logical irreversible commits, zero cross-tenant acceptance, zero approval bypass, zero prohibited sensitive persistence, zero false `PROVED`, and zero silent foreground takeover.

## Checkpoint 8A — transaction contract, hostile corpus, and baseline

Status: **BLOCKED pending explicit user approval of this plan.**

Freeze only the transaction data model and tests. Do not implement runtime behavior.

Deliverables:

- `OA_TRANSACTION_V1`, `OA_ACTION_PROVENANCE_V1`, and `OA_APPROVAL_V1` fixtures/schemas;
- canonical prepare/approval/action/idempotency digest vectors;
- state-transition table;
- trusted effect-classification table with unknown-default behavior;
- provenance source/role/transform vocabulary;
- decision-predicate dependency vocabulary;
- approval/replay/expiry rules;
- at least 48 hostile/boundary cases spanning the threat model;
- locked V1 quantitative thresholds;
- inventory lock for extension/protocol/capabilities/MCP/VM effect baseline;
- explicit compatibility decision: no runtime/MCP/extension/Supabase/OAuth/signing change in 8A.

Acceptance:

- 100 canonical digest replays are byte-identical;
- invalid/unknown states, effect classes, provenance roles, transitions, transforms, and over-budget proposals reject before execution;
- page/model/tool data cannot validate as authority or approval;
- stale/cross-tenant/cross-target approval vectors all fail;
- full existing tests and `npm run check` remain green;
- zero production/browser/database/Edge/MCP/extension/flag changes.

Rollback: revert only new docs/fixtures/tests. Milestone 7 remains the active runtime.

Stop condition: any required contract field remains ambiguous, or user asks to change the frozen plan.

## Checkpoint 8B — pure decision-causal prepare engine

Implement a pure environment-neutral prepare/validate engine. It performs no browser, network, database, ambient-clock, OAuth, or Supabase work.

Scope:

- build immutable prepared envelopes;
- compile decision predicates and dependency fingerprints;
- trusted effect classification;
- selective revalidation from typed semantic deltas;
- always-revalidate authority fences;
- canonical digests and bounded previews;
- no approval transport and no commit.

Acceptance:

- 10,000 generated bounded transaction candidates never escape bounds;
- byte-identical preparation for identical inputs;
- changed authority/action/target/provenance yields a different prepare digest;
- unrelated semantic deltas revalidate only dependent predicates;
- incomplete/ambiguous/reset dependency coverage fails closed or triggers revalidation;
- 64-predicate revalidation p95 target below 10 ms on the controlled Node baseline;
- full suite/static gate green;
- zero browser/production changes.

Rollback: remove/disable the pure 8B module and tests; retain 8A contracts.

## Checkpoint 8C — provenance and approval verifier

Add the pure authority-verification layer; still no external mutation.

Scope:

- validate provenance source kind, role, freshness, tenant/target binding, and transform chain;
- generate/verify one-shot approval challenges bound to exact prepare digest;
- enforce approval TTL/nonce consumption;
- reject static-token approval authority;
- distinguish app OAuth consent from transaction approval;
- no browser commit, no public MCP change, no production schema.

Acceptance:

- replay/cross-user/cross-tenant/cross-goal/cross-target/cross-document approval succeeds zero times;
- mutated preview or prepared payload invalidates approval;
- browser/model/tool sources can never carry `AUTHORITY`;
- expired/consumed approval fails closed;
- 10,000 fuzzed provenance chains cannot exceed depth/byte limits or prototype/unknown-field boundaries;
- zero prohibited sensitive values enter prepared durable material;
- full suite/static gate green.

Rollback: remove 8C verifier/challenge code; 8A/8B remain pure and unreachable.

## Checkpoint 8D — durable transaction journal and dark Supabase host

This is the first production-shape checkpoint and therefore requires an **early independent Codex audit before production mutation** because it changes authorization, durable database shape, encryption/tenancy boundaries, and future consequential-effect state.

Scope after audit approval:

- additive private service-role-only transaction/journal/rate tables and RPCs;
- RLS enabled with no client mutation policies;
- lease/CAS fencing bound to tenant/transaction/prepare/goal/target/approval/logical-transition;
- encrypted bounded payload tokens;
- deterministic `tx1:` commit slots;
- cancellation/expiry/reclaim/cleanup;
- default-off flag `milestone8_transactions_enabled=false`;
- separate dark internal host or explicitly isolated extension of the 7E host;
- **no browser mutation enabled** in this checkpoint.

Acceptance:

- unauthenticated/anon/authenticated direct private mutation succeeds zero times;
- cross-tenant reads/claims/cancel/approval/commit-slot operations succeed zero times;
- exact redelivery advances a transition once;
- idempotency collision fails closed;
- worker death before any browser dispatch is safely reclaimable;
- cancel/expiry survive worker loss;
- rate/queue/concurrency/payload/retention bounds enforce exactly;
- crypto tamper/wrong-kind/wrong-tenant tokens fail;
- security advisors show no checkpoint-introduced unresolved relevant ERROR/WARN;
- post-probe flag false and all synthetic rows zero.

Rollback: keep/set flag false, stop new claims, purge synthetic/nonterminal rows by bounded cleanup, use the accepted Milestone 7 path. Additive schema need not be dropped during emergency rollback.

## Checkpoint 8E — controlled transaction executor and compensation semantics

Wire the transaction journal to existing named browser primitives only in controlled synthetic fixtures. Do not expose public autonomous consequential execution yet.

Scope:

- durable PREPARE/VALIDATE/COMMIT/OBSERVE/VERIFY/RECEIPT orchestration;
- deterministic request IDs reused by `opera_enqueue`;
- current refs/coordinates/document fences only; no logical-ID actions;
- controlled definitions for local-reversible, staged, compensable, and irreversible/unknown fixtures;
- compensation as a second governed effect;
- read-only reconciliation of ambiguous commits;
- background-only execution; no activation fallback.

Acceptance:

- commit without valid prepared envelope/authority/approval is impossible;
- crash at every dispatch boundary produces either one logical action or `AMBIGUOUS`, never a blind duplicate;
- same idempotency key plus changed material returns collision;
- post-dispatch timeout never auto-retries irreversible/unknown action;
- cancellation before dispatch produces zero mutation;
- cancellation after dispatch never claims undo;
- compensation runs only when original success and inverse preconditions are known;
- compensation ambiguity/failure is preserved;
- controlled Chromium verifies zero foreground takeover and exact postconditions;
- no normal-profile irreversible real-world action;
- public MCP remains unchanged.

Rollback: set executor/dark transaction flag off and return to Milestone 7 read-only VM/legacy direct tools.

## Checkpoint 8F — trusted user approval transport and MCP/OAuth compatibility

This checkpoint changes the user-authorization boundary and may change the public MCP surface or protocol behavior, so obtain an **early independent Codex audit before deployment/promotion**.

Preferred design:

- add an additive transaction surface only if the real MCP client proves support for a trustworthy human-confirmation flow;
- use MCP 2026-07-28 Multi Round-Trip Requests (`input_required`) for exact transaction confirmation when supported;
- if needed, use a first-party OAuth-authenticated transaction approval page with the same exact digest/nonce/expiry as a separately reviewed fallback;
- preserve the current 18 tool names and input schemas byte-for-byte;
- any new transaction tools are additive and isolated; existing tools are not silently reinterpreted as approval;
- static bearer authentication may retain legacy/read diagnostics but cannot satisfy human approval for consequential commit;
- no new OAuth scope is preferred; existing OAuth application consent remains connection authorization only.

If an additive public MCP surface is adopted, the proposed V1 names are:

- `prepare_browser_transaction`
- `commit_browser_transaction`

The final schema must be frozen in 8F before deployment. `commit_browser_transaction` must not accept `approved:true` or arbitrary user-asserted approval material; it consumes only a trusted approval artifact produced by the accepted confirmation channel.

Acceptance:

- actual ChatGPT/MCP client renders and returns a real user confirmation, or the checkpoint stops;
- decline, timeout, disconnect, retry, and duplicate client calls are fail-closed/idempotent;
- existing 18 tools pass byte-for-byte name/input-schema compatibility;
- old client behavior remains usable for non-transaction tools;
- OAuth issuer/user binding remains correct;
- transaction approval cannot be replayed through a different client/user/session/request;
- no approval is inferred from model prose;
- reconnect/cache/protocol-version behavior is recorded.

Rollback: remove/disable only the additive transaction surface/approval route; preserve the current 18 tools, OAuth connection, and Milestone 7 host. If trustworthy confirmation cannot be proven, production consequential commit remains unavailable.

## Checkpoint 8G — bounded dark/live acceptance

After the required audits, run production acceptance only with synthetic accounts/fixtures or explicitly reversible low-risk test state. Keep `milestone8_transactions_enabled=false` outside a bounded probe.

Required scenarios:

- exact prepare/approval/commit/verify happy path;
- stale goal, target, tab, document, action, operand, and approval rejection;
- cross-tenant/user rejection;
- duplicate commit/redelivery and crash-window recovery;
- ambiguous completion requiring read-only reconciliation;
- cancellation before/after dispatch;
- compensation success plus compensation failure/ambiguity;
- approval decline/expiry/replay;
- queue/rate/concurrency limits;
- browser restart/worker death during each nonterminal phase;
- background focus audit;
- production cleanup and security-advisor reconciliation.

Prohibited live acceptance:

- purchases;
- financial transfers/payment credential entry;
- passwords/PIN/OTP/security-code entry;
- real sends/posts/deletions to user data;
- file upload;
- destructive irreversible actions on user-owned production content.

Acceptance requires zero duplicate logical irreversible commits, zero approval bypass, zero cross-tenant acceptance, zero false `PROVED`, zero prohibited sensitive persistence, zero focus takeover, flag false after probe, and zero synthetic transaction rows after cleanup.

Rollback: flag off, stop claims/commits, allow read-only reconciliation to terminate, purge probe state, keep Milestone 7 path active.

## Checkpoint 8H — compatibility/performance closeout and milestone audit

Close the milestone without beginning Milestone 9.

Required evidence:

- focused 8A–8G suites;
- full Node suite and `npm run check`;
- hostile/property/fuzz/replay tests;
- controlled Chromium;
- isolated Opera only if extension bytes or browser-local behavior changed; otherwise inherit unchanged signed-1.6.0 compatibility and record the distinction;
- signed normal-profile background acceptance for approved non-destructive fixtures;
- Supabase dark/live bounded acceptance and cleanup;
- MCP/OAuth compatibility matrix if 8F changed the public surface;
- security-advisor reconciliation;
- deterministic transaction replay agreement 100%;
- approval bypass 0;
- duplicate logical irreversible commits 0;
- cross-tenant acceptance 0;
- prohibited sensitive persistence 0;
- false `PROVED` 0;
- foreground takeover 0;
- ordinary non-transaction workflow latency regression below 15%, otherwise stop/review;
- one immediate same-identity signed rollback remains available.

If extension source did not change, keep extension `1.6.0` and produce no CRX. If any extension-local gap requires a source change, stop Milestone 8 implementation and approve a separate release/signing subplan before editing manifest/signing/distribution state.

Before Milestone 8 is considered complete, Codex independently audits the complete diff and proportionate automated/live evidence. Only `PASS` permits Milestone 9 planning unless the user explicitly accepts documented residual risk.

Rollback: keep transaction flag off, disable additive transaction MCP/approval surfaces, retain Milestone 7 read-only host and current signed extension, and preserve durable receipts only for their bounded retention/audit window.

## MCP, Supabase, extension, OAuth, and signing impact

### MCP

- 8A–8E: public inventory stays at 18, names/input schemas unchanged.
- 8F is the only checkpoint permitted to propose additive transaction tools/protocol confirmation behavior.
- Existing tools cannot be treated as proof of human transaction approval.
- Any MCP protocol/tool change requires early Codex review and an explicit compatibility fixture/matrix.
- Failure to prove a trustworthy confirmation transport blocks consequential production commit rather than triggering an unsafe fallback.

### Supabase

- 8A–8C: no database/function/config change.
- 8D may add private least-privilege durable transaction state only after early audit.
- queues/leases/CAS remain the durability mechanism; `EdgeRuntime.waitUntil` is not the transaction recovery mechanism.
- transaction operations are short, idempotent, bounded slices; worker shutdown is expected and recovered through durable state.
- feature flag defaults false and must be false after every probe unless a later separately accepted promotion decision changes it.

### Extension

- Expected Milestone 8 path uses existing named primitives and leaves extension 1.6.0 unchanged.
- semantic logical IDs remain observational.
- no new site-specific primitive or hidden foreground fallback.
- if server-side safety cannot be achieved without an extension change, stop and create a separate version/signing/release plan before editing extension code.

### OAuth

- existing OAuth authenticates/authorizes the client connection;
- transaction approval is separate and one-shot;
- no new scope/redirect/client registration is preferred in V1;
- static bearer authentication does not carry human approval authority;
- any transaction approval page must use authenticated first-party identity and exact server-issued digest/nonce/expiry.

### Signing and distribution

- no signing-key change;
- no private key material enters source, logs, planning docs, transaction state, or approval state;
- no new CRX if extension source is unchanged;
- immediate signed rollback remains 1.5.2 during the milestone;
- any extension-byte change stops the normal Milestone 8 path until a separately reviewed release/signing subplan is approved.

## Milestone-wide rollback and stop rules

Stop immediately rather than continuing when:

- a proposed implementation widens Goal Ledger authority;
- page/model/tool content can become approval or authority;
- a crash can produce a second irreversible logical action;
- the system cannot distinguish unknown completion from failure;
- the approval preview can diverge from committed arguments;
- a compensation path is assumed safe without its own authority/preconditions;
- a checkpoint requires direct logical-ID action addressing;
- a checkpoint needs arbitrary code/raw CDP/site-specific extension logic;
- foreground activation is used as recovery;
- a public MCP/auth/signing/production-schema change appears outside its reviewed checkpoint;
- a required early Codex audit is not PASS;
- an unexplained security/performance/compatibility regression remains.

The system-wide fallback is the accepted Milestone 7 read-only VM plus the current signed extension/MCP path, with all Milestone 8 flags and additive transaction surfaces disabled.

## Planning-session acceptance

This planning session is complete only when:

- this plan is committed on `feat/semantic-runtime-1.6.0`;
- `docs/project-context.md` and `docs/next-session-handoff.md` record that Milestone 8 is planned but not started;
- documentation structure/references/whitespace are checked;
- no code, database, Edge Function, extension, MCP schema, OAuth runtime configuration, signing state, or feature flag changed;
- the branch is pushed;
- work stops for user review.

**Checkpoint 8A remains blocked until the user explicitly approves this plan.**

## References

Repository:
- `AGENTS.md`
- `SECURITY.md`
- `docs/project-context.md`
- `docs/milestone-7-plan.md`
- `docs/milestone-7-checkpoint-7a.md` through `docs/milestone-7-checkpoint-7f.md`
- `docs/milestone-7-codex-audit.md`
- `docs/semantic-runtime-plan.md`
- `docs/roadmap.md`

Current platform references used for planning:
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
- Supabase background tasks: <https://supabase.com/docs/guides/functions/background-tasks>
- Supabase Queues: <https://supabase.com/docs/guides/queues>
- MCP 2026-07-28 release: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- MCP TypeScript SDK 2026-07-28 migration: <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>
