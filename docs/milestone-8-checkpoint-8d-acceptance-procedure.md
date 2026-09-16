# Checkpoint 8D — live acceptance procedure

Date: 2026-09-16. This document captures the exact remaining steps to close
Checkpoint 8D. It is a procedure, not acceptance evidence. No production
mutation, OAuth login, Edge deployment, browser dispatch, or 8E work has
occurred by writing this document.

## Current state (inherited from prior sessions)

All local/unit tests PASS (316/316 zero skips). Static check PASS (1.6.0/26
capabilities). The following are already installed in production:

- Migration `20260913143306_transaction_journal_8d_dark.sql` (12 private RLS
  tables, 26 service-only functions, default-OFF policy).
- Migration `20260914043049_transaction_operator_fence_8d.sql` (server-side
  operator fence with epoch, lease, host gate).
- Edge function `opera-agent-transactions-8d` v8 ACTIVE, `verify_jwt=true`,
  bundle SHA-256 `96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`.
- Transaction encryption key installed (32-byte, not in source).
- Master flag `OPERA_AGENT_TRANSACTION_DARK_8D=false` (static kill switch).
- Policy `OFF`, `legacy_gated=false`, `agent_commit_enabled=false`.
- All 11 synthetic 8D data tables zero rows.

## Canonical concurrency interpretation

`docs/milestone-8-plan.md` is the canonical frozen Checkpoint 8D contract. Its
acceptance criteria require worker-death reclaim, exact redelivery/idempotency,
and exact enforcement of rate/queue/concurrency/payload/retention bounds. It does
**not** require externally proving a provider-internal Deno worker PID or V8
isolate identity.

The earlier shorthand in this procedure, "Concurrent cloud races (multiple real
Edge workers)", was therefore too strong and is corrected here. Supabase/Deno and
Cloudflare expose request/execution routing traces, not a stable public
worker/isolate identifier. Acceptance must not claim evidence the provider does
not expose.

For Checkpoint 8D, the hosted concurrency gate means:

- eight independently issued simultaneous authenticated POST requests reach the
  fixed real `opera-agent-transactions-8d` hosted endpoint for `prepare`, and
  eight do the same for `cancel`;
- bounded allowlisted request/execution traces (`x-deno-execution-id` or
  `cf-ray`) demonstrate distinct real hosted request executions without logging
  raw trace values;
- all eight responses converge on the same transaction/commit metadata;
- exactly one response is the non-replay winner and seven are exact replays for
  each raced operation;
- response size remains bounded and `browserDispatchAllowed=false` throughout;
- fenced operator ownership and cleanup/recovery remain fail-closed.

This is operational evidence for the canonical **hosted concurrency/CAS bound**.
It is deliberately **not** evidence that N distinct V8 isolates or process workers
handled the requests. No acceptance record may make that stronger claim.

## Remaining steps (require user action and production access)

### Step 1 — verify exact-head CI

```powershell
cd D:\github\opera-agent
git log --oneline -1
# Verify GitHub Actions CI passes at this exact head
gh run list --branch feat/semantic-runtime-1.6.0 --limit 1
```

CI must show SUCCESS for unit/static + Chromium regression. If CI fails, stop
and fix before proceeding.

### Step 2 — fresh manual PKCE OAuth acceptance

This step requires the user to manually log in through a real browser.

Prerequisites:
- `OPERA_8D_MANAGEMENT_TOKEN` — Supabase Management API bearer (service_role
  equivalent, not stored in source)
- `OPERA_8D_PUBLISHABLE_KEY` — the project's existing public publishable key

```powershell
cd D:\github\opera-agent
$env:OPERA_8D_MANAGEMENT_TOKEN="<management_bearer>"
$env:OPERA_8D_PUBLISHABLE_KEY="sb_publishable_<existing_key>"
deno run --config supabase/functions/opera-agent-transactions-8d/deno.json --allow-env=OPERA_8D_PUBLISHABLE_KEY,OPERA_8D_MANAGEMENT_TOKEN --allow-net=127.0.0.1:6276,nenmkmtvjremqphfqnfw.supabase.co,api.supabase.co tests/cloud/transaction-cloud-acceptance-8d.mjs
```

The script will:
1. Preflight the deployed bundle hash, policy OFF, and clean state.
2. Acquire server fence (epoch, lease).
3. Install synthetic fixture (principal, goal head, binding).
4. Seal ledger with existing crypto key.
5. Enable host flag and set policy DARK.
6. Emit an OAuth URL — **open this URL manually in Opera**.
7. After login, the script verifies:
   - SDK `getClaims` + `getUser` (signed issuer/audience/role/client/session)
   - Server-side Auth session binding
   - Host `prepare -> replay -> status -> cancel -> status`
   - All 7 metadata fields, zero dispatch
8. Finally: disable host, set policy OFF, cleanup fixture, verify clean.

Expected output:
```json
{"checkpoint":"8D","mode":"accept","namespace":"<uuid>","accepted":true,"browserDispatchAllowed":false,"secretsPrinted":false}
```

### Step 3 — hosted worker-loss/reclaim probe

After Step 2 passes, exercise real worker death against the hosted DB:

The native test `tests/postgres/transaction-journal-8d.test.mjs` already
verifies worker death, reclaim, and nonce durability against a local
PostgreSQL instance. The remaining gate is to verify this against the
**actual hosted Supabase DB** with a real bound worker.

This requires a separately reviewed live probe script that:
1. Prepares a synthetic transaction with a real bound worker.
2. Kills the worker process mid-transaction.
3. Verifies the transaction can be reclaimed by a new fence epoch.
4. Verifies nonce consumption is one-shot across the crash.
5. Verifies no duplicate logical commit.

### Step 4 — remaining cloud quantitative gates

The SQL probe `tests/postgres/transaction-cloud-bounds-8d.sql` already
verified 8 grouped assertions on the real project. Remaining gates:

- Hosted concurrent cloud races using the canonical concurrency interpretation
  above: eight simultaneous authenticated requests per raced operation, distinct
  hosted request/execution traces, exactly one winner/seven replays, convergent
  metadata, bounded responses, and zero browser dispatch. This tests the real
  hosted concurrency/CAS boundary and does not claim provider-internal isolate
  identity.
- Minute-rollover rate reset
- Payload size at exact 196608/196609 byte boundary (already verified)
- Crypto tamper with real installed key
- Cross-tenant rejection with real authenticated sessions

### Step 5 — advisor reconciliation

```powershell
# Through Management API, fetch security and performance advisors
# before and after the probe. Verify:
# - No new ERROR/WARN from 8D
# - Existing legacy WARNs unchanged
# - 8D private RLS tables appear as INFO only
```

### Step 6 — restore and verify

After all probes:
- Master flag restored to `false`
- Policy `OFF`
- `legacy_gated=false`, `agent_commit_enabled=false`
- All 11 synthetic 8D data tables zero rows
- `opera_agent_private.goal_heads` zero rows
- Server fence unowned, host false

### Step 7 — final 8D acceptance record

Write `docs/milestone-8-checkpoint-8d-acceptance.md` with:
- Exact head SHA and CI run ID
- All probe results
- Advisor reconciliation
- Clean state verification
- Independent audit verdict

Only after this record is committed may 8E begin.

## What cannot be automated from a coding session

The following require human action or production access that cannot be
performed from a code editor:

- Manual OAuth login (user must enter credentials in a real browser)
- Management API calls (require a service bearer not stored in source)
- Live Edge deployment (requires Supabase CLI with production access)
- Independent Codex audit (requires a separate review agent)

The code, tests, and infrastructure are ready. These steps complete the
remaining gates defined in `docs/milestone-8-plan.md` Checkpoint 8D.
