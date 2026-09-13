# Checkpoint 8D: isolated dark host candidate

Historical local review record. Latest authorized production installation and
remaining gates: `docs/milestone-8-checkpoint-8d-cloud-install.md`. The undeployed/
no-permission statements below describe this record's original boundary only.

2026-09-13. **Local synthetic candidate audited PASS; Checkpoint 8D remains IN
PROGRESS. No production promotion, migration or browser dispatch. Stop before 8E.**

This supersedes the admission-only and primitive-journal continuation records as
the latest local state. Earlier accepted milestone/checkpoint facts are unchanged.
Session started clean at local/remote branch head
`919cacd24c2ae338620cec897c3f2c74e37aa672`.

## Implemented boundary

- Server-installed Supabase SDK verifies claims and user identity. Fixed issuer,
  authenticated audience/role, signed OAuth client, session and token expiry bind
  a private synthetic principal. User metadata, request identity and static bearer
  labels cannot substitute for verified claims.
- Prepare authenticates/decrypts the ledger token with the existing ledger key,
  resolves an immutable server-owned synthetic exact source/target/action binding,
  and runs the actual 8B/8C admission verifier. It then persists one AES-GCM
  prepared token through a service-only database bridge.
- Database preparation, challenge issuance and finalization lock current principal,
  session, binding, goal head and run state. Expiry is rechecked after relevant lock
  waits. Cancellation locks tenant/run before checking identity immediately before
  mutation; authenticated OFF-mode cancellation remains available for rollback.
- Private RLS tables retain immutable identity metadata, declared limits, preview
  digest and authentic synthetic 8C challenge alongside the journal. No OAuth
  bearer credential, raw arguments, page content or private key enters these
  metadata tables. One narrow fixed-path SECURITY DEFINER helper locks
  `auth.sessions` without adding service-role UPDATE grants to auth columns.
- Actual 8C challenge identifiers, user/client, exact preview/prepare/target,
  goal revision, nonce, digest and timestamps are preserved and checked. A bound
  consumption digest is required. Consumption, validation marker, journal
  advancement and one deterministic `tx1:` slot occur in one SQL transaction.
  The slot never dispatches a browser command.
- Applicable declared prepare/total lifetime, approval lifetime/delay, validation
  delay, lease, pending, rates, concurrency and retention budgets reach durable
  operations. Pure admission retains count/byte/provenance checks. This is not
  execution of compensation or post-commit browser observation, which belongs
  to later checkpoints.
- Cancel/expiry null encrypted prepared payloads immediately; digest tombstones
  preserve exact replay/collision evidence. Random-IV resealing of an authenticated
  identical prepare returns original metadata without replacing payload/expiry.
- The isolated Edge candidate defaults OFF. Its HTTP boundary caps declared and
  streamed body bytes, strips error details, returns no-store metadata, and exposes
  only prepare/status/cancel. It exposes no approve/finalize/browser/MCP route.

These are **synthetic journal-only** authority adapters. The server-owned registry
is not an arbitrary submitted `BROWSER_OBSERVED` label or a real browser collector.
Nonempty constraints/nonGoals fail closed: generic clicks do not prove score,
focus or freeform real-world restrictions. Real first-party human confirmation
and ChatGPT/MCP approval transport remain 8F work, not claimed here.

## Verified local evidence

Tests failed before missing host/identity/HTTP, challenge binding and cancellation
lock-wait behavior were implemented. The cancellation regression specifically
failed with `Missing expected rejection`, reproducing mutation after session
expiry, then passed with preserved `PREPARED:0` after remediation.

| Gate | Writer | Independent reviewer |
| --- | --- | --- |
| Native PG + host/HTTP/identity/token, five-file suite | 44/44 PASS, zero skips | 44/44 PASS, zero skips, 35.866 s |
| Full default unit suite | 239/239 PASS | Not rerun by reviewer |
| Actual pinned SDK/Deno malformed-token tests | 2/2 PASS, no network permission | 2/2 PASS, no network permission |
| Edge typecheck / static / diff checks | PASS | PASS |

Native tests integrate host/admission/crypto with real prepare/status/cancel RPCs,
including a smaller pending limit and release after cancellation. Positive auth
there uses explicit SDK doubles. Separate Deno tests load actual SDK `2.57.4` and
reject malformed credentials; they do **not** prove live signed OAuth acceptance.

Real Node worker processes are terminated before and after primitive and bound
finalization. The bound case uses an authentic synthetic 8C challenge/response,
reclaims through lease epoch3 and preserves one slot/one rate debit. Simulated
short remaining leases accelerate recovery; this is not death of a hosted Edge
worker or an actual browser executor. Native after-hooks stop the fresh loopback
PostgreSQL server; synthetic diagnostic directories are retained.

Runtime/test freeze hashes were stable before/after independent rerun:

| File | SHA-256 of reviewed LF bytes |
| --- | --- |
| SQL candidate | `95babfa78a434b913c10bf7b5a46bca03ba5734aa95d9d522fe0588c8d6f00d0` |
| Native tests | `48e1c279db4275b18f555b41c76140337e306fed5b0850dd5d0b6a3a69e53936` |
| Host | `6187a3799bb6001c6ca09d9b8fb5ca94a2d178839d1f3737ed886dc28827e179` |
| HTTP | `ca78a987cad0e73045b200d001576b15a3c5d9fd71a7351955c0e933afaa9b1d` |
| Identity | `0c8fd7c61249d69d5f06033b197fde77515b63ba67f0f47dc514459b341cb291` |

Normalize CRLF/lone CR to LF before comparing on another checkout. The reviewer
examined the dirty candidate over the baseline above; do not mistake the baseline
commit for a commit containing these changes. Verify the pushed candidate commit
and exact-head standard CI/Chromium artifacts before reusing evidence.

```powershell
$env:OPERA_PG_BIN='C:/absolute/path/to/postgresql/bin'
node --test tests/postgres/transaction-journal-8d.test.mjs tests/transaction-host-8d.test.mjs tests/transaction-http-8d.test.mjs tests/transaction-identity-8d.test.mjs tests/transaction-token-8d.test.mjs
deno test --config supabase/functions/opera-agent-transactions-8d/deno.json tests/deno/transaction-runtime-8d.test.ts
deno check --config supabase/functions/opera-agent-transactions-8d/deno.json supabase/functions/opera-agent-transactions-8d/index.ts
npm test
npm run check
```

Native gates are outside the default glob and fail if tooling is absent, not skip.
Use the absolute portable Deno executable for the commands above when Deno is
not installed on PATH.
The portable [official Deno 2.5.6 release](https://github.com/denoland/deno/releases/tag/v2.5.6)
was downloaded into a temporary directory. Archive SHA-256
`1327356cd63e23d0da7d11d5f5ca6b45902b1b62ee2debd4fbbd0aad2aab9786`
matched its official GitHub asset API digest. No global install/service created.

## Fresh read-only cloud prerequisites

On project `opera-agent` (`nenmkmtvjremqphfqnfw`), read-only checks confirmed:

- candidate schema absent; `opera-agent-transactions-8d` absent from Edge inventory;
- M7 flag `false`; VM runs/effects/rate windows all0;
- real session metadata columns include id/user_id/oauth_client_id/not_after;
- session owner `supabase_auth_admin`; postgres SELECT/UPDATE true and service-role
  goal-head SELECT/UPDATE true, prerequisites for the chosen locking strategy;
- security advisors: ERROR0/WARN31/INFO19; performance INFO5. Existing WARN groups
  concern legacy search paths, pg_net placement, legacy callable definer functions,
  anonymous-access policies and password-protection configuration. None proves
  the absent 8D candidate has passed a post-migration security gate; do not fix
  unrelated legacy objects as part of this checkpoint without direction.

No tokens, sessions' secret/HMAC fields or signing keys were read. No production
rows/configuration, migration, deployment or feature flag were changed.

## Remaining conditions before 8D closure

1. Obtain explicit production authority after this exact bounded candidate review.
   Do not apply candidate SQL or deploy merely because local tests pass.
2. Generate a real migration through the Supabase CLI, inspect exact additive
   shape/ownership/grants/default OFF and deploy the isolated host with securely
   installed key/configuration. No extension/MCP/OAuth/signing expansion.
3. Run actual cloud role/tenant/CAS/nonce/rate/retention/recovery probes and real
   signed OAuth positive/negative/session-revocation checks. Never extract a
   person's OAuth token from private storage or ask for credentials in chat.
4. Install authenticated, bounded synthetic source/target bindings; run no browser
   mutation. These source attestations must not originate in model/page requests.
5. Compare advisors before/after, verify rollback/default OFF, and remove all
   temporary synthetic runs/journal/approval/slot/identity/limits/preview/challenge/
   binding/principal/rate rows. Record actual hosted recovery evidence separately
   from native Node worker tests.
6. Complete exact-head CI/Chromium, production cleanup and committed acceptance
   context/handoff. Close temporary CI PR without merge; do not edit standard CI.

The independent verdict is PASS **only for the frozen local synthetic
no-dispatch candidate**. Overall 8D remains unaccepted. Public release is still
1.6.0 / protocol1 / 26 capabilities / 18 MCP tools, unchanged pairing/signing,
and no new CRX. No work on 8E occurred.
