# Milestone 8 Checkpoint 8D — Chat writer readiness record

Date: 2026-09-14

Status: **WRITER READINESS PASS — NOT CHECKPOINT ACCEPTANCE — NOT AN INDEPENDENT AUDIT**.

This record captures the maximum Checkpoint 8D verification completed by the active ChatGPT Web writer without bypassing the independent-audit gate. It does not authorize fresh OAuth, production DARK mutation, Checkpoint 8E, or Milestone 9.

## Candidate

- Branch: `feat/semantic-runtime-1.6.0`.
- Code candidate before this documentation closeout: `0bc958eb782de17b22b2c19081c5f85e908ccc7a`.
- Exact-head CI run `34796100802`: SUCCESS.
- Unit/static gate: PASS.
- Playwright install: PASS.
- Chromium extension regression: PASS.
- Extension 1.6.0, protocol 1, 26 capabilities, 18 public MCP tools, signing identity, pairing, and CRX remain unchanged.

## Writer self-audit scope

The writer re-read and cross-checked the 8D production-shaped boundary:

- `tests/helpers/transaction-cloud-controller-8d.mjs`;
- `tests/helpers/transaction-cloud-operator-8d.mjs`;
- `tests/helpers/transaction-cloud-management-backend-8d.mjs`;
- `tests/cloud/transaction-cloud-acceptance-8d.mjs`;
- `supabase/migrations/20260913143306_transaction_journal_8d_dark.sql`;
- `supabase/functions/opera-agent-transactions-8d/index.ts`;
- `lib/transaction-host-8d.js`;
- `lib/transaction-http-8d.js`;
- focused controller/operator/backend/live-runner tests.

This review is deliberately labelled writer self-review. It is not independent PASS and does not satisfy the `AGENTS.md` production-mutation audit requirement.

## Findings fixed during writer review

### Cleanup ordering

The normal controller cleanup path previously continued to exact-owned row deletion even when host disablement was failed or ambiguous. The controller now restores both control-plane safety gates first:

1. disable the 8D host flag;
2. restore transaction policy `OFF`;
3. only if both operations succeed, perform exact-owned fixture cleanup;
4. verify host false, mode OFF, zero owned/payload rows, agent commit false, and legacy gate false.

If host disablement or OFF restoration cannot be confirmed, no fixture deletion or clean verification is attempted. The dirty durable ownership manifest remains available for the recovery runner, and the controller fails closed with `CLOUD_CLEANUP_FAILED`.

A deterministic regression test locks this behavior for both host-disable and OFF-restoration failure.

### Ownership lifetime

The opt-in live acceptance runner now uses `LEASE_TTL_MS_8D=180000` rather than a lease window equal to the controller's 60-second acceptance deadline. This leaves bounded room for control-plane restoration and cleanup without a live acceptance owner losing its own lease. The operator still caps leases at 300000 ms and retains live-PID split-brain fencing.

### Transaction encryption-key preflight

The fixed Management backend validates the installed transaction key through the existing 32-byte decoder before any OAuth URL is emitted, and zeroes decoded key bytes. Management secret response values not required by the selected secret are cleared from the in-memory parsed response. Existing ledger key bytes are also zeroed after token sealing.

## Authority and escape-hatch review

No model/page/public caller gains the 8D operator object. The acceptance runner is explicit opt-in test infrastructure. The fixed backend pins:

- Supabase project `nenmkmtvjremqphfqnfw`;
- the existing OAuth client and loopback callback;
- Management API origin;
- Edge function slug;
- host flag secret name;
- transaction key secret name;
- Edge bundle SHA-256;
- fixed parameterized SQL statements.

The exposed backend contains no caller-supplied SQL, URL, secret-name, shell, raw-CDP, JavaScript, or generic RPC surface. Provisioning is insert-only. Auth session admission binds exact signed user + OAuth client + session identity before fixture installation. The live runner does not extract stored user tokens and does not write or print Management credentials, PKCE verifier, OAuth bearer, ledger key, or payload token.

The Edge/HTTP 8D boundary accepts only `prepare`, `status`, and `cancel`; it has no finalize/commit/browser routing and reports `browserDispatchAllowed:false`.

## Database quiescence review

Every mutating 8D candidate RPC passes the policy `assert_dark()` fence, which obtains a share lock on the singleton policy row. Restoring `OFF` updates that same row and therefore cannot complete ahead of an already-admitted mutating database transaction. This makes successful OFF restoration a real database quiescence fence before exact-owned cleanup, not merely a flag observation.

## Fresh production read-only evidence

No production mutation was performed for this readiness review.

Fresh read-only Supabase checks showed:

- policy `OFF`;
- `legacy_gated=false`;
- `agent_commit_enabled=false`;
- all 11 8D synthetic data tables contain zero rows;
- `opera_agent_private.goal_heads` contains zero rows;
- migration `20260913143306_transaction_journal_8d_dark` is present in applied migration history;
- all 12 `opera_agent_tx_candidate` tables have RLS enabled and no client policies;
- all reviewed candidate routines deny `anon` and `authenticated` execute authority;
- no public `opera_tx_%` routine was exposed by the reviewed privilege query.

The installed Edge function `opera-agent-transactions-8d` is ACTIVE, `verify_jwt=true`, currently reports deployment version 6, and has exact bundle SHA-256 `bad0ae493209891e45bc90a11d91ef85dac72022f70f7aaf8ba9e8152c822769`, matching the fixed backend pin. Deployment version number is not used as integrity authority; the exact bundle hash is.

## Advisor reconciliation

Fresh security advisors reported no ERROR. Existing WARNs are inherited legacy/public findings; the 8D private service-only tables appear as expected RLS-without-policy informational findings. Fresh performance advisors reported no ERROR/WARN; 8D-relevant findings are informational, including one unindexed `runs` foreign key and unused-index notices.

These informational findings are retained for later optimization/reconciliation and do not waive any authorization rule.

## Residual writer-known limitation

The local PID-liveness fence can conservatively keep an expired stale lease BUSY if the operating system has reused the old PID for another live process. This is a fail-closed availability limitation: it can delay recovery but does not allow a second owner or broaden authority.

## Remaining gate

The writer has exhausted the work that can be completed in-chat without violating governance. 8D remains **IN PROGRESS** because the following are still required:

1. an independent review of the exact final candidate with explicit PASS; the current Codex review path is unavailable because the account reports its code-review usage limit reached;
2. only after independent PASS, one fresh user-driven PKCE acceptance process with memory-only bearer and exact server Auth-session/client binding;
3. bounded production DARK hosted acceptance, including replay/collision, worker-loss/reclaim, one-shot nonce, cancellation/expiry, quota/concurrency/minute rollover, payload/retention, crypto tamper/cross-tenant negative cases, followed by host false + policy OFF + zero synthetic rows;
4. final advisor reconciliation and 8D acceptance record.

No independent PASS is fabricated here. No fresh OAuth, DARK enablement, production write, browser dispatch, public MCP/extension/signing/pairing/CRX change, Checkpoint 8E work, or Milestone 9 work occurred during this readiness closeout.
