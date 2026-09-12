# Checkpoint 8D independent prerequisite review

Date: 2026-09-12.
Exact inspected head: `7270753eeddceabae7980a747e6716f2d2278c9a`.
Reviewer: separate read-only Codex agent `independent_8d_gate`, with fresh task context and no edit/commit/production authority.

Verdict: **CONDITIONAL PASS for bounded local tests-first remediation and candidate construction only.** This is not 8D acceptance or production approval. No SQL/host candidate exists yet. Production migration, deployment, or probe remains prohibited pending real PostgreSQL evidence and independent exact-candidate review. Do not begin 8E.

## Independent evidence

- Branch/head matched the inspected baseline and worktree was clean.
- Focused 8C suite: 11/11 PASS, including the 10,000-case generator (about 49.8 seconds).
- `npm run check`: PASS, 26 browser primitives / version 1.6.0.
- `git diff --check`: PASS.
- No production call sites/imports for the transaction modules were found.
- Since accepted 8C `5933a6c…`, only three documentation files had changed.
- No files, production rows/configuration, or browser state were changed by the reviewer.

## Confirmed findings

1. **Imported approval interval invariant.** Creation enforces global TTL and prepared-window containment; verification only checks evaluation inside the supplied interval. Independent synthetic diagnostics returned `APPROVAL_ACCEPTED` for an eight-minute imported interval and an interval issued before preparation. Recomputed unkeyed digests are integrity fingerprints, not authentication. This is a local invariant/defense-in-depth defect, not a demonstrated remote production bypass.
2. **Narrower declared lifetime budgets.** Declared prepare, total-transaction and approval lifetimes of 1 ms still permitted the ordinary ten-minute prepared interval and two-minute approval. Enforce the minimum of global and applicable declared budgets during creation and import verification. Other applicable count/size budgets must be checked in candidate review; this diagnostic specifically confirmed lifetime budgets.
3. **Source authentication and operand coverage prerequisite.** Forged well-formed ledger source digest plus removal of every operand record still produced a provenance report. The current pure module validates structural consistency, not authenticated ledger/source state. The host must derive identity and current ledger authority, verify ownership/revision/head/digest/cancel/expiry and permission narrowing, validate targets/sources, and establish coverage of actual action arguments. Request-supplied labels/digests cannot substitute for these checks.
4. **Expected external trust boundaries.** A caller-provided consumed-nonce set is not durable CAS; `OAUTH_USER` is not performed authentication; an `APPROVE` value alone does not prove human interaction. Durable atomic replay protection belongs to 8D, actual trusted approval transport to 8F.

The passing generated corpus recreates challenges through the safe creator and mostly varies permitted IDs/digests; it does not prove hostile imported interval rejection or source authentication. The prior 8C acceptance remains pure/structural only, not an authorization or deployment acceptance.

## Permitted next unit

Local tests-first remediation: failing imported overlong/reversed/out-of-prepare/boundary-expiry tests and narrower declared lifetime-budget tests, followed by shared invariant enforcement. Then construct an isolated default-OFF/dark host candidate without browser enqueue/dispatch or public MCP/OAuth/extension changes. Host-admission tests must reject forged sources, changed/cancelled/expired goals, client-claimed identity, uncovered arguments and wrong targets before durable transitions.

Use immutable trusted journal state or authenticated sealed state for challenge lookup. Prepare/provenance/request-state digests remain data, not authority. Production remains closed until the exact SQL/host candidate demonstrates role/RLS/grant isolation, atomic nonce/transition/slot CAS, lease fencing, encryption, quota enforcement, worker recovery and cleanup on real PostgreSQL and passes independent review.
