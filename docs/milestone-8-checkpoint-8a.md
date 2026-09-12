# Milestone 8 Checkpoint 8A — transaction contract freeze

Status: accepted contract-only checkpoint on 2026-09-12.

## Scope

Checkpoint 8A freezes the V1 transaction, action-provenance, approval, enforcement, replay, and quantitative contracts for Decision-Causal Transactions and Provenance Enforcement. It does **not** implement transaction preparation or execution, change production Supabase, modify the extension, alter OAuth/runtime configuration, expose a new MCP tool, enable enforcement, or change signing.

The checkpoint started from accepted plan-review head `1a9b39f7eb7d18b27aad45361d7a252a94c9f4a1` on `feat/semantic-runtime-1.6.0`. The contract/test implementation commit is `4c84dab`.

## Frozen artifacts

- `tests/fixtures/transaction-contract-v1.json`
- `tests/fixtures/transaction-schema-v1.json`
- `tests/fixtures/action-provenance-schema-v1.json`
- `tests/fixtures/approval-schema-v1.json`
- `tests/fixtures/transaction-examples-v1.json`
- `tests/fixtures/transaction-digest-vectors-v1.json`
- `tests/fixtures/transaction-replay-v1.json`
- `tests/fixtures/transaction-thresholds-v1.json`
- `tests/transaction-contract-8a.test.mjs`

The frozen schema identifiers are `OA_TRANSACTION_V1`, `OA_ACTION_PROVENANCE_V1`, and `OA_APPROVAL_V1`. Canonical digests retain `OA_CANONICAL_JSON_V1` semantics.

## Transaction and authority boundary

V1 permits exactly one state-changing action and at most one consequential action per transaction. The contract has a singular `action` field and rejects `actions`. Compensation is always a separate transaction with independent authority, prepare digest, approval, idempotency, commit, observation, verification, and receipt.

Only `USER_EXPLICIT`, `LEDGER_AUTHORITY`, and `TRUSTED_POLICY` provenance may carry the `AUTHORITY` role. Browser, tool, model, and server-derived values remain operands/evidence/display data and cannot broaden authority. Provenance is tenant- and goal-revision-bound with a closed transform vocabulary.

## Enforcement contract

The logical modes are frozen as `OFF`, `DARK`, and `ENFORCED`. The enforcement matrix covers all 18 accepted MCP tools:

- observation tools remain compatible;
- every direct mutation is rejected with `TRANSACTION_REQUIRED` before dispatch under `ENFORCED`;
- a mutating `run_browser_burst` is also gated, while read/find/wait-only bursts remain observational;
- only server-derived, transaction-bound, non-client-supplied internal executor authority may cross the gate;
- inconsistent policy state fails closed.

This checkpoint implements no enforcement runtime. Production behavior remains `OFF` in the sense that no Milestone 8 transaction runtime or commit capability exists.

## Approval transport contract

Approval binds the authenticated user, trusted OAuth client identity, tenant, transaction, goal revision, prepare digest, preview digest, target digest, effect class, nonce, timestamps, expiry, and protocol era. MCP session IDs, JSON-RPC request IDs, self-reported `clientInfo`, model/page prose, and OAuth consent are not approval authority.

The modern MCP vector is stateless and checks capability per request. Missing required elicitation capability returns `-32021` without advancing transaction state. V1 permits one `input_required` round. Legacy transport is accepted only when it can produce an actual user confirmation; incapable transports fail closed.

## Quantitative and hostile gates

- canonical PREPARE, APPROVAL, COMMIT, and IDEMPOTENCY vectors: identical across 100 replays;
- hostile corpus: 74 unique cases, exceeding the 64-case minimum;
- rejected hostile inputs: zero browser dispatches;
- approval bypasses, authority broadening, cross-boundary acceptance, sensitive persistence, false `PROVED`, and focus changes: zero;
- proposal/prepared/receipt bounds: 64/128/64 KiB;
- prepare/approval lifetime: 10 minutes / 2 minutes;
- one commit request timeout: 30 seconds;
- public inventory: extension 1.6.0, protocol 1, 26 browser capabilities, and 18 MCP tools.

## Validation evidence

- initial TDD run failed with `ENOENT` for the not-yet-created transaction contract fixture;
- focused checkpoint suite: 10/10 pass;
- full deterministic suite: 181/181 pass;
- `npm run check`: pass, reporting 26 allowlisted browser primitives and version 1.6.0;
- GitHub Actions CI run `34700088793` (`#169`) on pushed acceptance head `1c53520625e1e56867319bc57390616f0a210da4`: pass, including standard Chromium extension regression;
- all eight new JSON fixtures parse successfully;
- `git diff --check`: pass.

Temporary draft PR `#24` was used only to trigger the standard workflow and was closed without merge after success. No live Opera, OAuth, or production database acceptance was required because 8A is contract/tests/docs only. The Supabase platform changelog was checked for current compatibility; no production project was queried or changed.

## Compatibility and rollback

Checkpoint 8A changes no extension source/version/ID, protocol, public browser capability, MCP source/tool/schema, Edge Function, migration, OAuth configuration, signing material, feature flag, pairing, browser tab, or production row.

Rollback is repository-only: revert the 8A fixture/test/documentation commits. There is no runtime or production rollback action.

## Next checkpoint

Checkpoint 8B is the next permitted unit after user review. It may implement only the pure deterministic single-action prepare engine and enforcement decision logic against these frozen fixtures. Approval verification, durable hosting, production changes, browser commit, public MCP changes, and extension/signing work remain outside 8B.

## Post-acceptance erratum

During 8B implementation review, the missing explicit effect-classification table required by the frozen 8A plan was identified. The fixture was corrected to map every generic primitive conservatively to `IRREVERSIBLE_OR_UNKNOWN`, declare client-supplied effect classes untrusted, and freeze no narrower trusted descriptors. The correction is locked by the 8A suite, adds no authority, and changes no runtime or production surface. See `docs/milestone-8-checkpoint-8b.md`.
