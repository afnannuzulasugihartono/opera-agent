# Checkpoint 8D preflight — deployment gate remains closed

Date: 2026-09-12.
Inspected baseline: `5933a6c1f2448fe82142bf83a68bc1d607ae4f79`.
Status: local design/security preflight only; **not an independent audit and not 8D acceptance**.

The reviewer wrote the preceding 8C implementation. This report must not be used as the independent Codex PASS required before production mutation. No 8D host, schema, migration, deployment, flag, or production probe was created.

## Reproduced inherited boundaries

### P1 — verify the validity window on imported challenges

`validateApprovalShape` checks timestamp syntax, while `verifyModernApprovalResponse` checks whether evaluation is within the supplied interval. Only `createApprovalChallenge` enforces the 120,000 ms TTL and containment within prepared validity.

A local diagnostic generated a valid challenge, extended its expiry from `00:02:30Z` to `00:08:30Z`, recomputed its unkeyed canonical digest, and supplied it as `trustedChallenge`. Verification at `00:01:00Z` returned `APPROVAL_ACCEPTED`. This is not evidence of a remote exploit: no production endpoint calls 8C, and a genuinely trusted journal must not permit the client to replace that parameter. It is a defense-in-depth gap to resolve tests-first before importing durable challenge state.

Required gate: verifier/import validation rejects over-limit, reversed, out-of-prepare-window, and expired intervals, including digest-valid altered challenges. It must honor narrower declared transaction budgets as well as global maximums.

### P1 — resolve provenance against trusted authority, not labels

The pure provenance verifier allows an authority record based on its closed source-kind label and digest shape. It does not fetch or compare that record against the Goal Ledger. A local diagnostic replaced the ledger source digest with a different well-formed digest, regenerated the prepared envelope, and the provenance report still validated.

This demonstrates the pure module's boundary, not authorization granted in production. Host admission must resolve the current authenticated tenant/user, ledger ID/revision/head/digest, permission narrowing, trusted source records, and operand coverage before persisting any authorizing transition. A request-supplied `LEDGER_AUTHORITY`, `OAUTH_USER`, OAuth client ID, timestamp, target generation, or consumed-nonce list must never populate trusted context directly.

Required gate: forged but syntactically valid authority records, changed ledger heads, cancelled/expired goals, uncovered arguments, and self-reported OAuth client identity reject before journal advancement. Every actual action operand must be bound to checked provenance; matching digest syntax alone is insufficient.

Diagnostic summary: `unresolvedAuthoritySourceAccepted=true`, `overLimitTrustedChallengeTTLAccepted=true`, `browserDispatches=0`, `productionWrites=0`.

## Review checklist for the 8D candidate

These are review requirements derived from the frozen plan, not a replacement contract or permission to implement/deploy:

- Separate internal dark host with no browser dispatch/enqueue dependency; no public MCP or OAuth runtime change.
- Private additive tables, RLS, no anon/authenticated access, explicit function EXECUTE revocation from PUBLIC, and fixed safe search paths. Prefer security-invoker RPCs with explicit service-role grants.
- Trusted identity adapter: validated user and OAuth client identity, ledger authority resolution, target/source verification, and server timestamps. Never use user-editable metadata for authorization.
- Immutable encrypted prepared/challenge payloads, kind/tenant/transaction/digest binding, explicit byte caps, independent key handling, and no raw page/form/credential content.
- Atomic approval verification result, nonce consumption, transition journal update, and unique deterministic commit-slot reservation in one database transaction. No check-then-write race across RPC calls.
- Lease owner/epoch/expiry and logical-transition CAS fences; exact redelivery is idempotent while different payload under the same identity rejects.
- Lock ordering for tenant quotas, target concurrency, transaction, and nonce; all rate/queue/concurrency limits checked under locks. Short DB transactions never span browser/network waits.
- Cancellation, expiry, reclaim, retention and cleanup bounded and durable. Worker death cannot unconsume a nonce or mint a new commit identity.
- Single default-OFF policy authority; no independently toggleable commit-enabled/direct-mutation-enabled pair. ENFORCED must remain unavailable in 8D.
- Real local Postgres concurrent/role/rollback tests, not string scans or SQLite alone; then independent review of exact candidate diff before production migration.
- Any subsequently authorized dark probe uses synthetic identities, no browser mutation, advisor-before/after comparison, exact cleanup, and policy returned OFF.

## Evidence and limitations

Repository local/remote heads matched the baseline and the starting worktree was clean. Both diagnostics were read-only synthetic Node executions. This session did not rerun or supersede the recorded 204-test 8C suite and CI #172. No production state or advisor result was queried, so prior cleanup remains historical evidence, not freshly reverified state.

Supabase skill review required current documentation and least privilege. The changelog was fetched as Markdown using HTTPS after the web reader rejected its content type. Hosted Data API exposure changes reinforce explicit grants; unrelated self-hosted and GraphQL changes do not authorize changes here. Documentation confirms exposed-table RLS and that service credentials bypass RLS, so host-side tenant checks remain mandatory. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Supabase changelog](https://supabase.com/changelog).

## Next action

Obtain an independent fresh-session review of this baseline and report, including the 8C limitations, then authorize bounded tests-first remediation/candidate construction. Review the actual SQL/host candidate independently before production mutation. Checkpoint 8D is not accepted; 8E must not begin.
