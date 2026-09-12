# Milestone 8 implementation plan

Status: **REVISED PLAN FROZEN FOR SECOND INDEPENDENT CODEX REVIEW on 2026-09-12; implementation not started. Checkpoint 8A MUST NOT start until this revision receives the required review and the user explicitly approves implementation.**

Milestone 8 is **Decision-Causal Transactions and Provenance Enforcement**. It extends the accepted Milestone 7 read-only Reactive Browser VM with a separate transaction authority and durability layer for state-changing browser work. It does not silently broaden the Milestone 7 VM effect allowlist, reinterpret OAuth consent as transaction approval, or let page/model/tool text become authority.

This revision incorporates three blocking findings from the first independent Codex review:

1. the transaction enforcement/cutover boundary is now explicit, so the same agent identity cannot bypass approval through legacy mutation tools;
2. V1 is simplified to one state-changing commit action and at most one consequential external action per transaction; compensation is always a new transaction;
3. MCP 2026-07-28 approval is explicitly stateless, capability-negotiated, and bound through verified `requestState`/`inputResponses`, never through `Mcp-Session-Id`.

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
- Milestone 7 VM effect surface remains the frozen read-only set until a separately accepted Milestone 8 transaction path is promoted.

The existing `opera_start_command -> opera_await` split is transport asynchrony, not transaction safety. It does not satisfy the Milestone 8 prepare/validate/approval/commit contract by itself.

## Outcome

At completion, Opera Agent can represent one bounded state-changing operation as a versioned transaction, prove exactly which user-authorized decision caused it, freeze the exact value and target before execution, obtain fresh human approval when required, commit at most once logically across worker crashes/redelivery, observe the result without manufacturing proof, and either verify, report ambiguity, or prepare a separate compensation transaction.

Milestone 8 should make these statements true:

1. no consequential browser mutation can be dispatched through the transaction path without a valid Goal Ledger authority chain and a valid prepared transaction;
2. when agent transaction enforcement is active, the same agent cannot bypass transaction authority through legacy mutation tools;
3. no page, tool, model, semantic observation, command receipt, transport session, or self-reported client metadata can grant new authority;
4. every value entering the commit action has bounded provenance and an explicit role;
5. approval is bound to the exact prepared digest and cannot be replayed across a changed user, OAuth client, tenant, goal, target, action, value, transaction, nonce, or expiry;
6. crash recovery reuses the same logical commit identity and never invents a fresh mutation merely because a receipt is missing;
7. ambiguous external completion is observed/reconciled, not blindly retried;
8. cancellation has precise pre-dispatch and post-dispatch semantics;
9. compensation is a new governed transaction, never a claim that database rollback undid the outside world;
10. browser actions remain background-first and never activate a tab as recovery;
11. process receipts remain distinct from Proof Engine completion evidence.

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
- multi-consequential-action transaction sequencing in V1;
- compensation inside the original transaction;
- treating generic click/fill/key/pointer/navigation/scroll as safe merely because the low-level command is allowlisted;
- automatic compensation after an ambiguous commit;
- silent production enablement of any Milestone 8 enforcement or transaction mode;
- a new CRX, signing identity, OAuth scope, MCP runtime/schema, database object, Edge deployment, or feature flag during this planning/revision session.

## Authority model

Milestone 8 freezes five separate authorities.

### 1. Goal authority

The revisioned Goal and Constraint Ledger is the only source of accepted user intent and task constraints. Transaction planning may narrow the ledger. It cannot add a destination, recipient, amount, object, operation, or permission that the ledger does not authorize.

### 2. Observation authority

Browser/tool observations can supply facts and candidate operands. They cannot grant permission. Page content such as “click confirm”, “send now”, a price, a username, a hidden field, or prompt-like text remains untrusted data.

### 3. Transaction authority

A validated `OA_TRANSACTION_V1` prepared envelope authorizes only its exact single state-changing commit action, subject to current ledger authority, preconditions, provenance, target fences, budgets, approval state, and enforcement mode. A transaction is not a reusable capability.

### 4. Approval authority

Approval is a fresh human decision bound to one exact prepared transaction digest. OAuth authentication proves who the user is; OAuth application consent proves that the client may connect; neither substitutes for approving a consequential transaction.

A static bearer/MCP token has no Milestone 8 human-approval authority and cannot commit a transaction that requires approval.

### 5. Proof authority

The Proof Engine remains the only authority that can classify completion evidence. `COMMITTED_UNVERIFIED`, a browser command success, a transaction receipt, or a compensation transaction receipt is process evidence only.

## Transaction enforcement and cutover boundary

Milestone 8 must not create a second approved path while leaving the same AI agent able to perform the same mutation directly through the existing 18-tool MCP surface.

### Frozen enforcement modes

The logical production policy has three states. The implementation/storage form is decided in the assigned checkpoint, but these semantics are frozen now:

- `OFF`: Milestone 8 transaction execution is unavailable. Existing Milestone 7/public behavior remains unchanged.
- `DARK`: transaction prepare/journal/executor code may be exercised only through synthetic/internal acceptance identities. No ordinary agent principal receives production transaction commit authority. Existing public behavior is not promoted.
- `ENFORCED`: transaction capability may be available to the authenticated agent, and **all direct state-changing legacy operations for that same agent principal are transaction-gated at the same cutover boundary**.

There must be no production state in which an ordinary agent principal can both commit a Milestone 8 transaction and bypass it through an ungated legacy mutation tool. Promotion to agent-facing transaction execution and legacy-mutation enforcement is one policy transition. If the policy state is inconsistent or cannot be verified, fail closed: transaction commit is unavailable and direct agent mutations return `TRANSACTION_REQUIRED`.

### Public-tool behavior under `ENFORCED`

Observational compatibility remains available to the agent:

- `browser_status`;
- `list_tabs`;
- `read_page`;
- `capture_page`;
- `find_elements`;
- the read/find/wait-only subset of `run_browser_burst`.

The following existing generic mutation surfaces are not transaction authority and, for an ordinary agent principal in `ENFORCED`, must fail before browser dispatch with structured `TRANSACTION_REQUIRED` unless invoked by the trusted internal transaction executor:

- `open_url`;
- `activate_tab`;
- `navigate_tab`;
- `close_tab`;
- `click_element`;
- `fill_element`;
- `press_key`;
- `scroll_page`;
- `move_pointer`;
- `click_at`;
- `drag_pointer`;
- `wheel_at`;
- any `run_browser_burst` request containing a state-changing step.

A request is not exempt merely because the mutation looks local or reversible. Generic click/fill/key/pointer/navigation/scroll and other unclassified mutation requests default to `IRREVERSIBLE_OR_UNKNOWN` at the transaction-policy boundary until a trusted server-side operation descriptor proves a narrower class.

### Trusted executor boundary

Only a server-derived internal transaction-executor authority may cross the legacy primitive gate after the durable commit slot, authority, approval, and final validation checks succeed. This authority:

- is not an MCP argument, HTTP header supplied by the model, page value, or reusable bearer capability;
- is derived from authenticated server context plus the durable transaction/commit record;
- is bound to one transaction, one prepare digest, one target, one commit identity, and one action;
- is never returned to the model/client;
- cannot be minted from an approval artifact alone.

If a separate manual/operator bypass is ever retained, it must use a distinct operator identity/credential realm that is unavailable to ChatGPT/agent OAuth and static MCP credentials. The normal agent endpoint must not expose that identity.

### Required bypass/compatibility tests

Before `ENFORCED` can be accepted, hostile and compatibility tests must prove:

- the same OAuth-authenticated agent that obtained approval cannot call `click_element`, `fill_element`, `press_key`, pointer tools, navigation, tab mutation, scrolling, or another generic mutator directly to bypass the transaction;
- adding transaction IDs, approval nonces, fake executor fields, headers, or page-sourced values to a legacy call does not satisfy the gate;
- a mixed `run_browser_burst` with one mutation step rejects the whole burst before any step dispatch;
- static bearer credentials cannot bypass enforcement or satisfy human approval;
- cross-user/client/tenant executor claims are rejected;
- inconsistent cutover state fails closed;
- observational tools retain their current names/input schemas and remain usable;
- `OFF` preserves the accepted legacy compatibility baseline;
- `DARK` exposes no production agent consequential commit;
- `ENFORCED` returns deterministic `TRANSACTION_REQUIRED` for direct agent mutation without transaction authority.

## Effect classification

Every state-changing transaction action receives a trusted server-side effect class before preparation. Page/model/tool output cannot choose or downgrade the class.

| Class | Meaning | V1 approval rule |
| --- | --- | --- |
| `READ_ONLY` | Existing observation effect with no mutation | No transaction needed for observation |
| `LOCAL_REVERSIBLE` | Browser-local mutation with a trusted bounded inverse and no trustedly-known durable external consequence | Transaction authority + pre/post verification; policy may require approval |
| `STAGED_EXTERNAL` | Trusted operation that changes external draft/staged state but does not finalize the consequential effect | Fresh approval if staging itself is durable/user-visible or safety cannot be proven |
| `COMPENSABLE_EXTERNAL` | External effect with a separately describable inverse | Fresh explicit approval |
| `IRREVERSIBLE_OR_UNKNOWN` | No safe inverse is proven, or semantics are not trustedly classified | Fresh explicit approval |

Unknown classification is never treated as reversible. A generic low-level primitive is not itself a trusted effect descriptor.

Milestone 8 does not mutate the frozen Milestone 7 read-only VM command set. State-changing work flows through the separate transaction executor and enforcement boundary so `OA_REACTIVE_VM_V1` remains auditable and rollbackable.

## V1 single-action transaction rule

V1 intentionally avoids partial multi-action commit semantics.

- A transaction contains **at most one state-changing commit action**.
- Therefore it contains at most one consequential external action.
- Read-only PREPARE/VALIDATE/OBSERVE/VERIFY operations are not commit actions and may occur multiple times within their independent bounds.
- There is no V1 action array, action ordering, remaining-action queue, or partial multi-action commit state.
- A request that attempts to encode two state-changing actions is invalid before preparation.
- A second desired external mutation requires a second transaction and, when required, a second fresh approval.
- Compensation is always a new transaction referencing the original transaction/receipt; it never executes as a second action inside the original transaction.

This rule removes the need for V1 semantics around partial commit ordering, remaining-action suppression, and in-transaction compensation recovery.

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
action
provenance[]
expectedPostconditions[]
compensationDescriptorDigest?
compensatesTransactionId?
budgets
preparedAt / expiresAt
prepareDigest
```

`action` is singular. `compensationDescriptorDigest` is descriptive/audit metadata only; it grants no authority to execute an inverse. A compensation transaction has its own `transactionId`, prepare digest, approval, commit identity, and receipt.

The trusted host derives tenant identity from authenticated server context. Client-provided tenant identity is never authoritative.

### Decision predicates and causal revalidation

Each decision predicate declares the semantic/provenance dependencies that made it true. Examples include target identity, selected recipient, exact amount, item identity, current document generation, a required page state, and a ledger constraint.

Before commit:

- user/tenant identity, OAuth client identity where approval applies, goal revision, exact action digest, target device/tab/document, approval validity, sensitive-field policy, effect class, enforcement mode, and idempotency reservation are always revalidated;
- other page-state predicates may be selectively revalidated only when accepted semantic-delta dependency coverage proves whether they changed;
- if dependency coverage is incomplete, stale, ambiguous, reset, or unavailable, revalidate the predicate or fail closed;
- no “unchanged” inference may be made merely because the DOM or command queue did not report an error.

Any change to an authority-bearing predicate, action argument, target, provenance chain, effect class, expected postcondition, authenticated user, or approval-bound OAuth client invalidates the prepare digest and approval.

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
```

Rules:

- `PREPARED` is immutable except by explicit replacement with a new transaction/digest.
- `AWAITING_APPROVAL` has executed no consequential commit.
- `APPROVED` is one-shot and expires.
- the durable commit slot is reserved before browser dispatch;
- one transaction has one commit action and one logical commit slot;
- `COMMITTED_UNVERIFIED` means the mutation command is known to have been accepted/completed by transport but outcome proof is still pending;
- `AMBIGUOUS` means the system cannot safely determine whether the outside-world effect occurred;
- `CANCELLED` after dispatch means “stop non-reconciliation work”, not “the outside-world effect was undone”;
- only read-only observation/reconciliation is allowed from `COMMITTED_UNVERIFIED` or `AMBIGUOUS`;
- compensation does not transition the original transaction into a compensation state; it is represented by a separate transaction linked to the original receipt.

## Prepare -> validate -> approve -> commit

### PREPARE

Preparation freezes the exact singular action and arguments, target fences, effect class, decision predicates, provenance chain, postconditions, optional compensation descriptor digest, budgets, and canonical digest.

No external mutation occurs in PREPARE.

### VALIDATE

Validation rechecks the frozen authority and every required causal dependency against current state. It must run again after user approval immediately before commit.

### APPROVE

Approval, when required, displays a bounded user-facing preview derived from the exact prepared payload. The preview is not authoritative by itself; the approval artifact binds the underlying prepare digest.

### COMMIT

Commit first reserves the durable logical commit identity, then dispatches the singular action using that same deterministic request identity. Recovery may look up the existing command/result; it may not synthesize a new mutation ID for the same logical action.

### OBSERVE

After dispatch, the transaction engine uses read-only browser observations to reconcile actual state. Observation cannot expand authority or rewrite the approved action.

### VERIFY

Expected postconditions are evaluated through the accepted evidence/proof boundary. Verification may produce scoped evidence, `PARTIAL`, contradiction, or ambiguity. It cannot turn action success into `PROVED`.

### RECEIPT

The receipt is bounded process metadata: transaction/prepare digest, commit/idempotency identity, timestamps, terminal state, effect class, verification summary, enforcement mode, and optional linked compensation transaction ID. It excludes raw page text, screenshots, private URLs, credentials, form values, tokens, and other sensitive browser state.

## User approval rules

1. Approval is required for every `COMPENSABLE_EXTERNAL` and `IRREVERSIBLE_OR_UNKNOWN` transaction.
2. `STAGED_EXTERNAL` requires approval when the staging operation itself has durable/user-visible consequence or trusted policy cannot prove it consequence-free.
3. Policy may elevate `LOCAL_REVERSIBLE` to require approval; it may not downgrade an external class based on page/model/tool input.
4. No V1 standing/bulk approval exists for dynamic consequential actions.
5. One approval binds one exact `prepareDigest`, authenticated user, OAuth client identity, tenant, goal revision, transaction ID, target digest, preview digest, effect-class summary, nonce, and expiry.
6. An approval cannot be reused after any prepared field changes.
7. Approval expires after the frozen TTL and is consumed by at most one commit attempt.
8. A user denial/cancel terminalizes the transaction as `REJECTED`; no consequential action may have been dispatched.
9. Model prose, webpage text, tool output, a previous chat instruction, generic OAuth consent, static bearer token, JSON-RPC request ID, or MCP transport session cannot manufacture approval authority.
10. If the approval transport cannot be proven to represent an actual user confirmation, consequential commit remains unavailable.
11. Because V1 has one state-changing action, one approval covers only that exact action; compensation requires a new transaction and fresh approval when its effect class requires it.

## MCP approval transport: frozen dual-era behavior

The 2026-07-28 MCP revision is stateless and explicit opt-in. Milestone 8 approval must not depend on `Mcp-Session-Id`.

### Modern 2026-07-28 path

For a `2026-07-28` request:

- there is no `initialize` handshake and no security dependence on `Mcp-Session-Id`;
- client capabilities are authoritative only from the current request's MCP capability metadata; they must not be inferred from a previous request;
- transaction confirmation requires the client to declare the required form-elicitation capability for that request;
- if the required capability is absent, the server returns structured `-32021 MissingRequiredClientCapability` with `requiredCapabilities` and performs no transaction-state advance or commit;
- the handler returns `resultType: "input_required"` with a bounded `inputRequests` confirmation request and opaque `requestState`;
- the client obtains the input and retries the original call with a fresh JSON-RPC request ID, byte-exact echoed `requestState`, and that round's `inputResponses`;
- `inputResponses` are per-round rather than accumulated; V1 permits exactly one approval round;
- the server treats returned `requestState` and `inputResponses` as untrusted until verification succeeds.

`Mcp-Session-Id`, if injected by an intermediary into a modern request, is neither required nor an authority signal. The approval verifier does not read it as part of the approval binding.

### Approval `requestState` binding

For the transaction-confirmation leg, `requestState` must be either a server-sealed bounded token or an opaque random handle resolving to trusted durable challenge state. The client cannot define its security fields.

The verified challenge binds at minimum:

```text
approvalChallengeId
authenticatedUserId
authenticatedOAuthClientId
tenantId
transactionId
prepareDigest
previewDigest
nonce
issuedAt
expiresAt
protocolEra
```

The authenticated OAuth client identity comes from trusted authorization-server/server context, not self-reported MCP `clientInfo`. If the server cannot establish a trustworthy OAuth client identity for a consequential approval, the approval path fails closed.

The fresh JSON-RPC request ID used by the MRTR retry is **not** an approval identity and is expected to change. Security continuity comes from verified authenticated identity plus the exact transaction/digest/nonce/expiry binding in `requestState`.

A valid positive `inputResponses` confirmation creates/consumes approval only after all challenge bindings and TTL are verified. Decline, cancel, malformed response, missing response, duplicate nonce, changed user/client, changed transaction/digest, or expired state produces no commit authority.

### Legacy 2025-era path

For initialize-capable 2025-era clients:

- capabilities may come from the authenticated initialized connection according to the legacy protocol;
- an SDK compatibility shim may service the same `input_required` handler semantics by issuing a real `elicitation/create` over a supported legacy transport and then re-entering the handler with `inputResponses`;
- `Mcp-Session-Id` may be used by the legacy transport for routing, but it is **not** approval authority and is not a required field in `OA_APPROVAL_V1`;
- the same authenticated user, OAuth client, transaction ID, prepare digest, nonce, preview digest, and expiry binding applies;
- a legacy/stateless or otherwise incapable transport that cannot deliver a real human confirmation must cleanly refuse the transaction rather than fall back to model prose or inferred consent.

### Capability negotiation and actual ChatGPT requirement

The server must support dual-era compatibility without weakening approval:

- modern 2026 clients explicitly opt in per request to required confirmation capability;
- missing modern capability produces `-32021`, not an implicit fallback;
- legacy capability is honored only on a transport that can actually carry the confirmation interaction;
- protocol fallback/downgrade is transport compatibility, never approval authority;
- actual ChatGPT acceptance must visibly render a real user confirmation and return approve/decline through the accepted channel;
- if ChatGPT auto-fulfills, suppresses, or cannot expose a real user decision, Checkpoint 8F stops and production consequential commit remains unavailable.

There is **no** fallback that asks the model to pass `approved:true`, echo a nonce from page content, assert that the user approved, or reuse OAuth app consent as transaction approval.

## Provenance enforcement

Every value entering the commit action carries a bounded provenance record with:

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

Because V1 has one state-changing action, each transaction has one logical commit identity:

```text
tx1:<sha256(
  tenant,
  transactionId,
  prepareDigest,
  targetDigest
)>
```

The same key with the same action material resolves to the same durable dispatch/receipt. Reuse with different material is `IDEMPOTENCY_COLLISION`.

The deterministic transaction commit key must also be reused as the underlying Opera command `request_id`. Recovery first resolves the existing queued/terminal command. It never creates a fresh request ID merely because an Edge worker restarted.

### Crash ambiguity

If the worker dies after dispatch but before durable receipt persistence:

1. reclaim the durable transaction lease;
2. inspect the existing single commit slot and underlying command by the same idempotency key;
3. if completion is known, continue to read-only OBSERVE/VERIFY;
4. if completion cannot be determined safely, mark `AMBIGUOUS`;
5. do not redispatch an irreversible/unknown action.

Automatic retry after dispatch is permitted only if the external operation itself has a separately proven idempotency guarantee bound to the same logical key. Browser transport idempotency alone is not enough to assume the remote site is idempotent.

### Cancellation

- before commit dispatch: cancellation guarantees zero transaction mutation and becomes `CANCELLED`;
- after dispatch begins: cancellation cannot undo the singular action; it stops non-reconciliation work while read-only reconciliation may continue;
- cancellation racing an ambiguous commit resolves to `AMBIGUOUS` plus cancellation-requested metadata, then read-only reconciliation.

### Compensation

Compensation is always a **new transaction**, not a second action/state inside the original transaction and not a database rollback.

- the original PREPARE may retain only a bounded compensation descriptor/digest for explanation and later proposal generation;
- the inverse does not inherit original approval authority;
- compensation receives a new transaction ID, Goal Ledger check, provenance, effect classification, PREPARE, validation, approval when required, idempotency key, commit slot, observation, verification, and receipt;
- the compensation transaction references `compensatesTransactionId` and the verified original receipt/effect identity;
- compensation is never prepared/committed automatically while original completion is ambiguous;
- compensation must verify that the original effect occurred and that current inverse preconditions still hold;
- failed or ambiguous compensation is the terminal state of the compensation transaction; the original transaction is not rewritten to claim restored state;
- V1 permits at most one active compensation transaction for one original transaction at a time; chains require a separately reviewed later design.

## Frozen V1 quantitative bounds

These bounds are intentionally tighter than the Milestone 7 VM budgets because consequential work must be small enough for a human to review and for recovery to remain diagnosable.

| Resource | V1 maximum |
| --- | ---: |
| Serialized transaction proposal | 64 KiB |
| Prepared transaction/checkpoint | 128 KiB |
| Receipt | 64 KiB |
| State-changing commit actions per transaction | **1** |
| Consequential external actions per transaction | **1** |
| `IRREVERSIBLE_OR_UNKNOWN` actions per transaction | **1** |
| Decision predicates | 64 |
| Provenance records | 128 |
| Transform-chain depth | 8 |
| Approval preview | 16 KiB |
| Approval MRTR rounds | **1** |
| Prepare lifetime | 10 minutes |
| Approval lifetime | 2 minutes |
| Approval-to-dispatch delay | 15 seconds |
| Final validation-to-dispatch delay | 5 seconds |
| One commit command timeout | 30 seconds |
| Post-commit observation attempts | 3 |
| Post-commit observe/verify window | 30 seconds |
| Concurrent commit per target tab | 1 |
| Concurrent committing transactions per tenant | 2 |
| Pending prepared/approval transactions per tenant | 8 |
| Prepare rate per tenant | 20/minute |
| Commit rate per tenant | 10/minute |
| Total transaction lifetime | 10 minutes |
| Active compensation transactions per original transaction | 1 |
| Nonterminal encrypted payload retention | <= 24 hours |
| Terminal metadata retention | <= 7 days |

Hitting a bound yields a typed `LIMIT_REACHED`, `EXPIRED`, or `AMBIGUOUS` outcome as appropriate. It never silently truncates an action set or implies success.

## Threat model

Milestone 8 acceptance must cover at least these adversarial classes:

- page text attempting to invent intent, effect class, approval, recipient, amount, or target;
- model/tool output attempting to launder an untrusted value into `AUTHORITY`;
- the same approved agent attempting direct legacy click/fill/key/pointer/navigation/scroll/tab mutation instead of transaction commit;
- a legacy `run_browser_burst` hiding one state-changing step among observational steps;
- forged transaction IDs/nonces/executor headers/arguments attempting to bypass `TRANSACTION_REQUIRED`;
- static bearer credentials attempting to bypass cutover enforcement or satisfy human approval;
- inconsistent enforcement mode exposing both transaction commit and direct agent mutation;
- attempts to encode a second state-changing/consequential action in one V1 transaction;
- stale approval after price/recipient/destination/item/target/action/postcondition change;
- approval replay across tenant, user, OAuth client, goal revision, transaction, target tab, document generation, nonce, or expiry;
- approval nonce theft/reuse and preview/digest mismatch;
- MCP 2026 request missing per-request elicitation capability;
- forged/replayed `requestState`, malformed or cross-challenge `inputResponses`, and dependence on `Mcp-Session-Id` as fake authority;
- modern MRTR retry using a fresh JSON-RPC request ID;
- incapable legacy client/transport attempting to fall back to model-inferred approval;
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
- compensation requested for an action that never occurred;
- compensation preconditions changing before inverse execution;
- duplicate/concurrent compensation transaction attempts;
- compensation failure or ambiguity;
- worker/lease theft, stale lease epoch, stale goal, stale program/transaction digest;
- cross-tenant/device/tab/document command/result confusion;
- forged command receipt, forged Proof Engine result, or process receipt used as completion proof;
- raw sensitive page/form/screenshot/private URL persistence;
- rate/queue/concurrency exhaustion;
- user foreground takeover used as “recovery”;
- observational MCP compatibility drift during enforcement;
- OAuth issuer/user/client-binding confusion;
- self-reported MCP `clientInfo` treated as OAuth client identity;
- signing identity or extension update drift.

Required security outcome: fail closed with diagnosable state, zero silent authority broadening, zero agent legacy-mutation bypass when enforcement is active, zero duplicate logical irreversible commits, zero cross-tenant acceptance, zero approval bypass, zero prohibited sensitive persistence, zero false `PROVED`, and zero silent foreground takeover.

## Checkpoint 8A — transaction contract, hostile corpus, enforcement policy, and baseline

Status: **BLOCKED pending second independent Codex review and explicit user approval.**

Freeze only the transaction data model, enforcement/cutover policy contract, dual-era approval contract, and tests. Do not implement runtime behavior.

Deliverables:

- `OA_TRANSACTION_V1`, `OA_ACTION_PROVENANCE_V1`, and `OA_APPROVAL_V1` fixtures/schemas;
- canonical prepare/approval/commit/idempotency digest vectors;
- singular-action transaction schema and invalid multi-action vectors;
- state-transition table;
- trusted effect-classification table with unknown-default behavior;
- transaction enforcement modes and `TRANSACTION_REQUIRED` decision table for every current MCP tool;
- trusted internal executor-authority contract that is not client-supplied;
- provenance source/role/transform vocabulary;
- decision-predicate dependency vocabulary;
- MCP modern/legacy approval-state vectors covering per-request capabilities, `-32021`, `requestState`, `inputResponses`, OAuth client binding, nonce, and expiry;
- approval/replay/expiry rules;
- at least 64 hostile/boundary cases spanning the revised threat model, including direct legacy bypass attempts;
- locked V1 quantitative thresholds;
- inventory lock for extension/protocol/capabilities/MCP/VM effect baseline;
- explicit compatibility decision: no runtime/MCP/extension/Supabase/OAuth/signing change in 8A.

Acceptance:

- 100 canonical digest replays are byte-identical;
- invalid/unknown states, effect classes, provenance roles, transitions, transforms, multi-action proposals, and over-budget proposals reject before execution;
- page/model/tool data cannot validate as authority or approval;
- direct generic mutation without transaction authority maps to `TRANSACTION_REQUIRED` under the frozen enforced-mode policy;
- observational tools remain compatible in the policy vectors;
- stale/cross-user/cross-OAuth-client/cross-tenant/cross-target approval vectors all fail;
- a modern missing-capability vector deterministically returns `-32021` and cannot advance approval state;
- neither modern nor legacy approval security depends on `Mcp-Session-Id`;
- full existing tests and `npm run check` remain green;
- zero production/browser/database/Edge/MCP runtime/schema/extension/flag changes.

Rollback: revert only new docs/fixtures/tests. Milestone 7 remains the active runtime.

Stop condition: any required contract field remains ambiguous, or user asks to change the frozen plan.

## Checkpoint 8B — pure decision-causal prepare engine

Implement a pure environment-neutral prepare/validate engine. It performs no browser, network, database, ambient-clock, OAuth, or Supabase work.

Scope:

- build immutable single-action prepared envelopes;
- compile decision predicates and dependency fingerprints;
- trusted effect classification;
- pure enforcement-policy decision logic for direct-vs-transaction mutation classification;
- selective revalidation from typed semantic deltas;
- always-revalidate authority fences;
- canonical digests and bounded previews;
- no approval transport and no commit.

Acceptance:

- 10,000 generated bounded transaction candidates never escape bounds;
- byte-identical preparation for identical inputs;
- changed authority/action/target/provenance yields a different prepare digest;
- second-action attempts reject deterministically;
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
- bind challenge to authenticated user and trusted OAuth client identity, transaction ID, preview digest, nonce, and expiry;
- model modern `requestState` verification and one-round `inputResponses` semantics without network transport;
- enforce approval TTL/nonce consumption;
- reject static-token approval authority;
- distinguish app OAuth consent from transaction approval;
- no browser commit, no public MCP runtime/schema change, no production schema.

Acceptance:

- replay/cross-user/cross-OAuth-client/cross-tenant/cross-goal/cross-target/cross-document approval succeeds zero times;
- mutated preview or prepared payload invalidates approval;
- browser/model/tool sources can never carry `AUTHORITY`;
- expired/consumed approval fails closed;
- requestState/inputResponses tamper and nonce reuse fail closed;
- a changed JSON-RPC request ID does not invalidate a valid modern retry, while changed security bindings do;
- 10,000 fuzzed provenance/challenge chains cannot exceed depth/byte limits or prototype/unknown-field boundaries;
- zero prohibited sensitive values enter prepared durable material;
- full suite/static gate green.

Rollback: remove 8C verifier/challenge code; 8A/8B remain pure and unreachable.

## Checkpoint 8D — durable transaction journal and dark Supabase host

This is the first production-shape checkpoint and requires an **early independent Codex audit before production mutation** because it changes authorization, durable database shape, encryption/tenancy boundaries, and future consequential-effect state.

Scope after audit approval:

- additive private service-role-only transaction/journal/approval/rate tables and RPCs;
- RLS enabled with no client mutation policies;
- lease/CAS fencing bound to tenant/transaction/prepare/goal/target/approval/logical-transition;
- encrypted bounded payload tokens;
- one deterministic `tx1:` commit slot per transaction;
- durable one-shot approval/nonce consumption state;
- cancellation/expiry/reclaim/cleanup;
- default-off Milestone 8 policy state capable of representing `OFF`/`DARK`/`ENFORCED` semantics without enabling them during migration;
- separate dark internal host or explicitly isolated extension of the 7E host;
- **no browser mutation enabled** in this checkpoint.

Acceptance:

- unauthenticated/anon/authenticated direct private mutation succeeds zero times;
- cross-tenant reads/claims/cancel/approval/commit-slot operations succeed zero times;
- exact redelivery advances a transition once;
- idempotency collision fails closed;
- worker death before any browser dispatch is safely reclaimable;
- approval nonce consumption is one-shot across worker death/redelivery;
- cancel/expiry survive worker loss;
- rate/queue/concurrency/payload/retention bounds enforce exactly;
- crypto tamper/wrong-kind/wrong-tenant tokens fail;
- no policy configuration can represent agent-facing transaction commit with ungated direct mutation; invalid combinations fail closed;
- security advisors show no checkpoint-introduced unresolved relevant ERROR/WARN;
- post-probe Milestone 8 mode remains off/dark as required and all synthetic rows zero.

Rollback: keep/set Milestone 8 policy to `OFF`, stop new claims, purge synthetic/nonterminal rows by bounded cleanup, use the accepted Milestone 7 path. Additive schema need not be dropped during emergency rollback.

## Checkpoint 8E — controlled single-action transaction executor

Wire the transaction journal to existing named browser primitives only in controlled synthetic fixtures. Do not expose public autonomous consequential execution yet.

Scope:

- durable PREPARE/VALIDATE/COMMIT/OBSERVE/VERIFY/RECEIPT orchestration;
- deterministic request ID reused by `opera_enqueue`;
- current refs/coordinates/document fences only; no logical-ID actions;
- exactly one state-changing action per transaction;
- controlled definitions for local-reversible, staged, compensable, and irreversible/unknown fixtures;
- compensation represented only as a separate newly prepared transaction;
- read-only reconciliation of ambiguous commits;
- background-only execution; no activation fallback;
- executor authority is server-derived and inaccessible through public tool arguments.

Acceptance:

- commit without valid prepared envelope/authority/approval is impossible;
- any attempt to add a second state-changing action rejects before dispatch;
- crash at every dispatch boundary produces either one logical action or `AMBIGUOUS`, never a blind duplicate;
- same idempotency key plus changed material returns collision;
- post-dispatch timeout never auto-retries irreversible/unknown action;
- cancellation before dispatch produces zero mutation;
- cancellation after dispatch never claims undo;
- an approved agent cannot invoke a direct legacy mutator through the controlled enforcement harness;
- transaction executor can invoke exactly the prepared primitive only after valid internal executor authority;
- compensation can proceed only as a new transaction after original success is known and inverse preconditions are current;
- controlled Chromium verifies zero foreground takeover and exact postconditions;
- no normal-profile irreversible real-world action;
- public MCP runtime/schema remains unchanged.

Rollback: set transaction executor/mode off and return to Milestone 7 read-only VM/current public path.

## Checkpoint 8F — trusted user approval transport, cutover enforcement, and MCP/OAuth compatibility

This checkpoint changes the user-authorization boundary and may change the public MCP surface/protocol behavior. Obtain an **early independent Codex audit before deployment/promotion**.

Preferred design:

- add an additive transaction surface only if the real MCP client proves support for a trustworthy human-confirmation flow;
- use the 2026-07-28 stateless `input_required` MRTR path when the current request explicitly declares the required elicitation capability;
- preserve a tested legacy initialize-era path only when its transport can deliver actual user elicitation;
- if needed, use a first-party OAuth-authenticated transaction approval page with the same user/client/transaction/digest/nonce/expiry binding as a separately reviewed fallback;
- preserve the current 18 tool names and input schemas byte-for-byte;
- any new transaction tools are additive and isolated; existing tools are not silently reinterpreted as approval;
- static bearer authentication may retain legacy/read diagnostics but cannot satisfy human approval for consequential commit;
- no new OAuth scope is preferred; existing OAuth application consent remains connection authorization only;
- agent-facing transaction commit cannot be promoted without the `ENFORCED` legacy-mutation gate for the same agent identity.

If an additive public MCP surface is adopted, proposed V1 names remain:

- `prepare_browser_transaction`
- `commit_browser_transaction`

The final schema must be frozen in 8F before deployment. `commit_browser_transaction` must not accept `approved:true` or arbitrary user-asserted approval material; it consumes only trusted approval state produced by the accepted confirmation channel.

### Required dual-era compatibility matrix

8F must explicitly test:

- modern 2026 request with correct per-request elicitation capability -> `input_required` confirmation path;
- modern request without required capability -> `-32021 MissingRequiredClientCapability` with no approval/commit advancement;
- modern request retry with fresh JSON-RPC ID + exact verified `requestState` + valid `inputResponses` -> same approval challenge continues;
- modern request with changed/tampered/expired requestState, OAuth user/client, transaction, digest, nonce, or preview -> reject;
- modern request carrying `Mcp-Session-Id` -> session ID ignored as security authority;
- legacy initialized client with declared elicitation and usable transport -> real user confirmation through the compatible path;
- incapable legacy/stateless/JSON-only transport -> clean refusal, never model-inferred approval;
- decline/cancel/timeout/disconnect/duplicate invocation -> fail-closed/idempotent;
- actual ChatGPT renders and returns a real user confirmation; otherwise checkpoint stops;
- existing 18 tools retain name/input-schema compatibility;
- observational tools remain usable when enforcement is active;
- direct mutation tools for the same agent identity return `TRANSACTION_REQUIRED` when enforcement is active;
- old/pre-transaction compatibility remains available only in `OFF`, where agent-facing transaction commit is unavailable.

OAuth issuer, user, and trusted client identity binding must remain correct. MCP `clientInfo`, session ID, request ID, model prose, page text, or approval preview alone cannot substitute for that authenticated binding.

Rollback: disable additive transaction surface and set transaction policy to `OFF`; preserve the current 18 tool schemas, OAuth connection, Milestone 7 host, and signed extension. If trustworthy confirmation/cutover cannot be proven, production consequential commit remains unavailable.

## Checkpoint 8G — bounded dark/live acceptance

After required audits, run production acceptance only with synthetic accounts/fixtures or explicitly reversible low-risk test state. Keep Milestone 8 policy `OFF` outside a bounded probe until the enforcement cutover itself is accepted.

Required scenarios:

- exact prepare/approval/commit/verify happy path for one consequential action;
- attempt to encode a second action rejects;
- stale goal, target, tab, document, action, operand, and approval rejection;
- cross-tenant/user/OAuth-client rejection;
- direct legacy-mutation bypass attempts from the same approved agent return `TRANSACTION_REQUIRED`;
- mixed mutation burst bypass rejects before any step;
- observational tools still work under enforced policy;
- modern capability negotiation and `-32021` behavior;
- modern stateless MRTR requestState/inputResponses approval plus actual ChatGPT confirmation;
- legacy-capable confirmation or clean refusal;
- duplicate commit/redelivery and crash-window recovery;
- ambiguous completion requiring read-only reconciliation;
- cancellation before/after dispatch;
- separate compensation transaction success plus compensation failure/ambiguity;
- approval decline/expiry/replay/nonce reuse;
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

Acceptance requires zero agent legacy-mutation bypass under enforcement, zero duplicate logical irreversible commits, zero approval bypass, zero cross-tenant/client acceptance, zero false `PROVED`, zero prohibited sensitive persistence, zero focus takeover, Milestone 8 policy returned to `OFF` after probe, and zero synthetic transaction rows after cleanup.

Rollback: policy off, stop claims/commits, allow read-only reconciliation to terminate, purge probe state, keep Milestone 7 path active.

## Checkpoint 8H — compatibility/performance closeout and milestone audit

Close the milestone without beginning Milestone 9.

Required evidence:

- focused 8A–8G suites;
- full Node suite and `npm run check`;
- hostile/property/fuzz/replay tests;
- explicit legacy-mutation-bypass hostile suite;
- modern/legacy MCP confirmation compatibility matrix;
- controlled Chromium;
- isolated Opera only if extension bytes or browser-local behavior changed; otherwise inherit unchanged signed-1.6.0 compatibility and record the distinction;
- signed normal-profile background acceptance for approved non-destructive fixtures;
- Supabase dark/live bounded acceptance and cleanup;
- security-advisor reconciliation;
- deterministic transaction replay agreement 100%;
- approval bypass 0;
- agent legacy-mutation bypass under enforcement 0;
- duplicate logical irreversible commits 0;
- cross-tenant/OAuth-client acceptance 0;
- prohibited sensitive persistence 0;
- false `PROVED` 0;
- foreground takeover 0;
- ordinary observational/non-transaction workflow latency regression below 15%, otherwise stop/review;
- one immediate same-identity signed rollback remains available.

If extension source did not change, keep extension `1.6.0` and produce no CRX. If any extension-local gap requires a source change, stop Milestone 8 implementation and approve a separate release/signing subplan before editing manifest/signing/distribution state.

Before Milestone 8 is complete, Codex independently audits the complete diff and proportionate automated/live evidence. Only `PASS` permits Milestone 9 planning unless the user explicitly accepts documented residual risk.

Rollback: set transaction policy `OFF`, disable additive transaction MCP/approval surfaces, retain Milestone 7 read-only host/current signed extension, and preserve durable receipts only for their bounded retention/audit window.

## MCP, Supabase, extension, OAuth, and signing impact

### MCP

- 8A–8E: public inventory stays at 18, names/input schemas unchanged.
- 8F is the only checkpoint permitted to propose additive transaction tools/protocol confirmation behavior and agent mutation enforcement.
- Existing mutation tools cannot be treated as approval and cannot remain an agent bypass after `ENFORCED` cutover.
- Existing observational tools remain compatible.
- Modern approval is stateless MRTR with explicit per-request capability and `-32021` refusal when missing.
- Legacy sessions may route elicitation but `Mcp-Session-Id` is never approval authority.
- Any MCP protocol/tool/enforcement change requires early Codex review and an explicit compatibility matrix.
- Failure to prove trustworthy confirmation and cutover enforcement blocks consequential production commit rather than triggering an unsafe fallback.

### Supabase

- 8A–8C: no database/function/config change.
- 8D may add private least-privilege durable transaction/approval state only after early audit.
- queues/leases/CAS remain the durability mechanism; `EdgeRuntime.waitUntil` is not transaction recovery.
- transaction operations are short, idempotent, bounded slices; worker shutdown is expected and recovered through durable state.
- future policy state defaults `OFF` and must return `OFF` after every bounded probe unless a later separately accepted promotion decision changes it.
- durable policy must not permit an agent-facing commit-enabled/direct-mutation-enabled combination.

### Extension

- Expected Milestone 8 path uses existing named primitives and leaves extension 1.6.0 unchanged.
- semantic logical IDs remain observational.
- no new site-specific primitive or hidden foreground fallback.
- enforcement is expected at the authenticated server/MCP transaction boundary; if safe enforcement requires extension changes, stop and create a separate version/signing/release plan before editing extension code.

### OAuth

- existing OAuth authenticates/authorizes the client connection;
- transaction approval is separate and one-shot;
- approval binds both authenticated user identity and trusted OAuth client identity;
- self-reported MCP `clientInfo` is not an OAuth client identity;
- no new scope/redirect/client registration is preferred in V1;
- static bearer authentication does not carry human approval authority;
- any transaction approval page must use authenticated first-party identity and exact server-issued transaction/digest/nonce/expiry binding.

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
- agent-facing transaction commit can coexist with direct legacy mutation for the same agent identity;
- a transaction can contain more than one state-changing commit action;
- compensation can execute inside the original transaction or inherit its approval implicitly;
- approval security depends on `Mcp-Session-Id`, JSON-RPC request ID, or self-reported `clientInfo`;
- missing modern client capability does not fail cleanly with `-32021`;
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

The system-wide fallback is the accepted Milestone 7 read-only VM plus the current signed extension/MCP path, with Milestone 8 policy `OFF` and additive transaction surfaces disabled.

## Planning-revision acceptance

This revision session is complete only when:

- only `docs/milestone-8-plan.md`, `docs/project-context.md`, and `docs/next-session-handoff.md` change;
- the three Codex blocking findings are explicitly resolved in the plan;
- Checkpoint 8A remains blocked;
- documentation structure/references/whitespace are checked;
- no code, database, Edge Function, extension, MCP runtime/schema, OAuth runtime configuration, signing state, or feature flag changes;
- the revision is committed and pushed on `feat/semantic-runtime-1.6.0`;
- work stops for the second independent Codex review.

**Checkpoint 8A remains blocked. Do not implement it until the revised plan passes the required review and the user explicitly authorizes implementation.**

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
