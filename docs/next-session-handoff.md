# Opera Agent next-session handoff

Use this as the starting point after accepted Milestone 8 Checkpoint 8C. Verify repository head and accepted evidence before making claims.

## Handoff prompt

```text
Continue the private Opera Agent project from repository:
https://github.com/afnannuzulasugihartono/opera-agent

Working branch:
feat/semantic-runtime-1.6.0

Read first, in order:
1. AGENTS.md
2. docs/project-context.md
3. docs/next-session-handoff.md
4. docs/milestone-8-plan.md
5. docs/milestone-8-checkpoint-8a.md
6. docs/milestone-8-checkpoint-8b.md
   Also read docs/milestone-8-checkpoint-8c.md and
   docs/milestone-8-checkpoint-8d-preflight.md before any 8D work.
7. docs/milestone-7-codex-audit.md
8. docs/milestone-7-plan.md
9. docs/milestone-7-checkpoint-7a.md through docs/milestone-7-checkpoint-7f.md
10. docs/semantic-runtime-plan.md
11. docs/roadmap.md
12. SECURITY.md

Verified compatibility baseline:
- extension 1.6.0
- protocol 1
- extension ID ohbbpamcljckmjhcpkcmefdobkoeaick
- 26 browser capabilities
- 18 MCP tools with unchanged current names/input schemas
- production device opera
- established signing identity and pairing preserved
- background-first focus isolation preserved
- no silent foreground fallback
- immediate signed rollback 1.5.2
- signed 1.6.0 CRX SHA-256:
  cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0
- canonical-LF MCP source SHA-256:
  f8735a2797175c4bd96f990bea4d1f750c14db5b6d963929eae3ff2d096fcf11
- locked 7A inventory digest:
  sha256:8d75fff529a85a9ac2b3d4544996f27ae0e2366a935211a8f6a1778bb1e8367a

Milestones 1-7 are complete. Independent Codex audit of Milestone 7 is PASS.
Milestone 8 Checkpoints 8A–8C are accepted. No Milestone 8 external runtime or production implementation has started.

MILESTONE 8 REVISED PLAN STATUS:
- docs/milestone-8-plan.md was revised after the first independent Codex review.
- Three blocking findings are resolved in the plan contract, and the second
  independent Codex review returned PASS at revision
  11a285bfb464cc3a1c157befe6e0aa0aa557f2fc.
- Durable review: docs/milestone-8-plan-codex-review.md.
- Checkpoint 8A is accepted as contract/tests/docs only; contract/test commit 4c84dab.
- Checkpoint 8B is accepted as a pure environment-neutral engine; implementation/test commit 0f333a1.
- Checkpoint 8C is accepted as a pure environment-neutral authority verifier; implementation/test commit e2b228b.
- Acceptance records: docs/milestone-8-checkpoint-8a.md through docs/milestone-8-checkpoint-8c.md.
- The full suite is 204/204; npm run check passes.
- Local 8D preflight is recorded, but it is self-review, not independent PASS.
- Reproduced inherited boundaries: imported digest-valid overlong challenge TTL
  passes verification; syntactically valid ledger source digests are not resolved
  against trusted authority. No production writes or browser dispatch occurred.
- Next action is fresh-session independent review of the baseline and preflight,
  then separately authorized tests-first remediation/candidate construction.
- Independently audit the actual SQL/host candidate before production mutation.

BLOCKER 1 — TRANSACTION ENFORCEMENT/CUTOVER:
- logical modes are OFF, DARK, ENFORCED.
- OFF preserves accepted legacy behavior and exposes no Milestone 8 transaction
  commit.
- DARK permits only synthetic/internal transaction acceptance identities; no
  ordinary agent has production transaction commit authority.
- ENFORCED makes transaction capability and legacy mutation gating one cutover.
- The same agent must never have both transaction commit and ungated direct
  mutation.
- Direct agent open_url/tab mutation/click/fill/key/scroll/pointer operations and
  mutating browser.burst return TRANSACTION_REQUIRED before dispatch unless called
  through trusted server-derived transaction-executor authority.
- Observational browser_status/list_tabs/read_page/capture_page/find_elements and
  read/find/wait-only burst remain compatible.
- Internal executor authority is not an MCP argument/header/token available to the
  model. Any separate operator identity must be outside the agent credential realm.
- Inconsistent cutover state fails closed.

BLOCKER 2 — SINGLE CONSEQUENTIAL ACTION V1:
- a V1 transaction has at most ONE state-changing commit action and therefore at
  most one consequential external action.
- read-only PREPARE/VALIDATE/OBSERVE/VERIFY may perform bounded observations and do
  not count as commit actions.
- a second mutation requires a second transaction.
- there is no V1 multi-action ordering/partial-commit/remaining-action state.
- compensation is ALWAYS a new transaction with its own Goal Ledger check,
  provenance, prepare digest, approval when required, tx1 idempotency, commit,
  observe/verify, and receipt.
- original approval never implicitly authorizes compensation.

BLOCKER 3 — MCP 2026 APPROVAL BINDING:
- 2026-07-28 is stateless and must not depend on Mcp-Session-Id.
- modern capabilities are declared/checked per request.
- missing required form elicitation returns -32021 MissingRequiredClientCapability
  and advances no approval/transaction state.
- server returns input_required with inputRequests + opaque requestState; client
  obtains actual user input and retries the original call with a fresh JSON-RPC ID,
  exact requestState echo, and per-round inputResponses.
- V1 permits one approval MRTR round.
- requestState is untrusted until verified and binds authenticated user, trusted
  OAuth client identity, tenant, transactionId, prepareDigest, previewDigest,
  nonce, issued/expiry, and protocol era.
- JSON-RPC request ID, Mcp-Session-Id, page/model prose, and MCP clientInfo are not
  approval authority.
- legacy initialize-era clients may use compatible elicitation only when their
  transport can show a real user confirmation; session ID is routing only.
- incapable legacy/stateless transports fail cleanly, never infer approval.
- actual ChatGPT confirmation is mandatory in 8F. If ChatGPT cannot visibly obtain
  a real user decision, consequential production commit remains unavailable.

REVISED CHECKPOINTS:
8A contract + hostile corpus + enforcement decision table + dual-era approval
   vectors; ACCEPTED
8B pure single-action prepare engine + enforcement policy decision logic; ACCEPTED
8C provenance + approval challenge verifier; ACCEPTED
8D durable transaction/approval journal + dark Supabase host; early Codex before
   production mutation
8E controlled single-action executor; compensation only as new transaction
8F trusted modern/legacy approval transport + enforcement cutover + MCP/OAuth
   compatibility; early Codex before deployment/promotion
8G bounded dark/live acceptance including direct legacy bypass tests
8H compatibility/performance closeout + independent milestone audit

PLANNING-REVISION BOUNDARY:
- this revision changes documentation only.
- no code, database, migration, Edge Function, extension, MCP runtime/schema, OAuth
  runtime config, signing state, or feature flag is changed.
- production Milestone 7 VM remains in its accepted dark state.

NEXT ACTION:
Stop for user review. Do not begin Checkpoint 8D implementation or any database,
Edge, or production mutation until its required early independent Codex audit is
completed and the user separately authorizes 8D. MCP transport, OAuth runtime,
extension, signing, and browser-commit work remain later checkpoint scope.
```

## Revision baseline

The first Milestone 8 plan was committed at
`434faa1894479a5f7dd264049614c6d814022f77` from planning baseline
`538dbb5cb8b7b8ff1d8be9c6ac36ba37d22669d4`.

The first independent Codex review did not authorize implementation; it identified
three blocking plan defects: legacy mutation bypass at cutover, multi-action V1
partial-commit complexity, and incorrect MCP 2026 approval/session assumptions.
The revised plan resolves those at documentation/contract level only.

## Review gate

**Independent Codex PASS on 2026-09-12** for revision
`11a285bfb464cc3a1c157befe6e0aa0aa557f2fc`. Durable record:
`docs/milestone-8-plan-codex-review.md`.

## Checkpoint 8A acceptance

Checkpoint 8A is accepted at contract/test commit `4c84dab`. It freezes the three
V1 schemas, single-action rule, `OFF`/`DARK`/`ENFORCED` policy, all 18 public-tool
decisions, internal executor boundary, dual-era approval bindings, four canonical
digest vectors replayed 100 times, quantitative limits, and 74 hostile cases.

No extension, MCP runtime/schema, database, migration, Edge Function, OAuth
configuration, signing identity, production flag/row, pairing, or browser state
changed.

## Checkpoint 8B acceptance

Checkpoint 8B is accepted at pure implementation/test commit `0f333a1`. It adds
immutable preparation/validation, predicate dependency compilation, selective or
fail-closed revalidation, bounded previews, conservative effect classification,
and policy decisions. It performs no approval verification, commit, browser,
network, database, or ambient-clock work. The recorded full suite is 193/193 and
64-predicate revalidation p95 is 0.0324 ms.

The 8A fixture also received a conservative erratum for its previously omitted
effect-classification table: all generic methods default to
IRREVERSIBLE_OR_UNKNOWN, client classification is untrusted, and no narrower
trusted descriptor is frozen.

## Checkpoint 8C acceptance

Checkpoint 8C is accepted at pure implementation/test commit `e2b228b`. It adds
exact-bound provenance/freshness/authority validation, immutable OAuth-user
approval challenges, modern one-round requestState/inputResponses verification,
TTL and consumed-nonce rejection, and deterministic consumption claims. It has no
network, persistence, browser, MCP public-runtime, OAuth configuration, extension,
signing, or production integration. Focused 8C tests are 11/11, 10,000 fuzzed
provenance/challenge chains pass, the full suite is 204/204, and npm run check
still reports 1.6.0 with 26 capabilities.

Durable one-shot consumption is deliberately not claimed: atomic CAS, journal,
leases, recovery, and production authorization state belong to 8D.

**STOP HERE.** Do not start Checkpoint 8D without its required early independent
audit and a separate explicit user instruction. No production mutation or public
runtime integration is permitted in the current handoff state.

## Checkpoint 8D local preflight

Read `docs/milestone-8-checkpoint-8d-preflight.md`. Inspected baseline is
`5933a6c1f2448fe82142bf83a68bc1d607ae4f79`; diagnostics reproduced the validity-window
and trusted-source-resolution boundaries with zero browser dispatches and zero
production writes. There is no 8D implementation, migration, deployment, or
acceptance. The author of 8C performed this preflight, so independent review is
still required. Do not label it PASS or proceed to 8E.
