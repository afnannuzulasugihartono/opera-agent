# Independent Codex review — revised Milestone 8 plan

Date: 2026-09-12

Verdict: **PASS**

Reviewed revision:

`11a285bfb464cc3a1c157befe6e0aa0aa557f2fc`

The second independent review confirms that the three blocking findings from the
first review are resolved at the frozen planning/contract level. This verdict
approves the plan for explicit user consideration; it does not start Checkpoint
8A, authorize production mutation, or enable a transaction policy mode.

## Resolved findings

### Same-agent legacy mutation bypass

The plan now freezes one atomic `OFF` / `DARK` / `ENFORCED` cutover policy. An
ordinary agent principal cannot simultaneously receive transaction commit
capability and retain ungated direct mutation. Under `ENFORCED`, every generic
mutation surface fails before browser dispatch with `TRANSACTION_REQUIRED`
unless invoked through server-derived, transaction-bound internal executor
authority. That authority is not client/model supplied. Observational tools
remain compatible, mixed mutating bursts fail atomically, and inconsistent
policy state fails closed.

### Partial multi-action ambiguity

V1 now permits at most one state-changing commit action and therefore at most one
consequential external action per transaction. A second mutation requires a new
transaction. Compensation is also a new transaction with independent authority,
provenance, preparation, approval when required, idempotency, execution,
observation, verification, and receipt. V1 no longer needs partial multi-action
commit semantics.

### MCP 2026 approval identity

The plan now treats MCP `2026-07-28` as stateless and explicit opt-in. Approval
does not depend on `Mcp-Session-Id` or the JSON-RPC request ID. Modern capability
is checked on each request; missing elicitation capability returns `-32021`
without advancing state. The one-round `input_required` flow binds verified
`requestState` and `inputResponses` to the authenticated user, trusted OAuth
client identity, tenant, transaction, prepare/preview digests, nonce, protocol
era, and expiry. Legacy routing may use a session identifier, but never as
approval authority. Actual ChatGPT confirmation remains a mandatory 8F gate.

## Verification performed

- fetched and reviewed exact remote revision `11a285b...`;
- confirmed its diff from `434faa1...` contains only
  `docs/milestone-8-plan.md`, `docs/project-context.md`, and
  `docs/next-session-handoff.md`;
- confirmed no runtime, database, migration, Edge Function, extension, public MCP
  schema, OAuth configuration, signing, workflow, or feature-flag change;
- `git diff --check`: pass;
- local `npm test`: **171/171 pass**;
- local `npm run check`: pass with extension `1.6.0` and `26` allowlisted browser
  capabilities;
- reviewed current MCP 2026-07-28 MRTR/stateless migration guidance;
- reviewed the current Supabase changelog and durable Edge Function/Queue
  assumptions; no current platform change invalidates the revised plan.

## Gate result

The revised Milestone 8 plan passes independent review. Checkpoint 8A remains
**unstarted and blocked pending explicit user approval**. When approved, only 8A
contract/fixture/test work may begin; later checkpoint authority does not become
available early.
