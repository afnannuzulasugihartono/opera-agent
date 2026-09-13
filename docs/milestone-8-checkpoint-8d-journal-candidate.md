# Checkpoint 8D: local durable journal candidate

2026-09-13. IN PROGRESS, NOT ACCEPTED. Stop before 8E.

## Local implementation

`supabase/candidates/transaction-journal-8d.sql` is a private review candidate,
NOT a production migration. Seven RLS-enabled tables, revoked client privileges,
security-invoker functions, tenant/row locking, monotonic lease epochs, atomic
nonce/journal advancement and one-shot deterministic tx1 slot reservation exist.
Physical device/tab identifies target concurrency, not a changeable target digest.
Prepare replay binds exact timestamps; approval replay binds requested TTL.
Cleanup bounds root run plus rate deletions to 1–100; each run cascades at most
101 journal rows and one approval/slot. Nonterminal retention starts at registration.
All snapshots deny browser dispatch; OFF is default and agent commit is disabled.

`lib/transaction-token-8d.js` seals bounded closed metadata using AES-256-GCM,
random 12-byte IVs, canonical base64url and domain-separated kind/tenant/transaction/
prepare AAD. Token possession is neither human approval nor commit authority.

## Tests and independent review

Failing tests preceded implementation and cleanup/replay/context-type remediation.
Writer rerun passed native 13/13 and token 4/4. Independent frozen-candidate rerun
also passed 17/17, zero skips, plus static and diff checks.
Full local suite passed 226/226; npm run check preserved 1.6.0 / 26 capabilities.
Implementation/context commit `49f247f14ae079c86105e6c689f74bb26d2dfb6b`
passed standard CI #176 (34740274141), including Chromium regression.
No workflow changes. Session net diff from `f2fdb88` is seven files: candidate
SQL/token and their tests, this record, project context and handoff. Final docs-head
CI and PR #31 closure must be verified independently; close without merge.
Native tests use PostgreSQL 17.11, a fresh loopback cluster and synthetic data.
Two independent psql sessions exercise nonce consumption. Lease expiry is simulated,
not actual executor process death. Test after-hooks stop the native server.

```powershell
$env:OPERA_PG_BIN='C:/absolute/path/to/postgresql/bin'
node --test tests/postgres/transaction-journal-8d.test.mjs tests/transaction-token-8d.test.mjs
npm test
npm run check
```

Native tests are separate from the default unit glob. Missing tooling fails, not
skips. Official EDB 17.11-3 Windows binaries supplied tooling; downloaded archive
observed SHA-256: `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`.
This is a locally observed checksum, not a published signature claim.
Temporary tools/synthetic diagnostics remain; no user data deleted or service installed.

Frozen independent review hashes (SHA-256):

- SQL: `de066992c1b9544400d741515d454e39297c8dcc8aaf58bf1ba7cb79d485bd56`
- Token: `fc89a5a9a1dac8b52b89f17564e32f8a8c735a9d25893573a381aa307485c881`
- Native tests: `58cfe2e6947a46b752ca6336a8090fd4d3a108605615302601583bdc7a8b8829`
- Token tests: `c6bd865a20aada050dd051395e52ac5bcc62e034bab7bbd0fd3b7444c491acc3`

Verdict: CONDITIONAL PASS for local primitives only, not acceptance or deployment.

## Remaining conditions and production blockers

Add native target/concurrent slot/tenant commit/commit-rate boundary tests with
rollback assertions. Constrain journal.status to the frozen vocabulary. Complete
actual worker-death recovery. Source inspection is not coverage of those gates.

The service role bypasses RLS and is trusted; supplied actor/tenant claims are not
authenticated by SQL. Real OAuth/client identity, current owned ledger/head,
constraints and source attestations remain fixtures in admission tests. Tokens do
not prove provenance authority. mark_validated is a host assertion marker, not
proof evaluation. Separate RPCs do not prove end-to-end atomic host validation.
Actual 8C approval artifact/timestamp binding, smaller declared budgets, sensitive
state policy, key handling and complete frozen gates remain required. Terminal
payload minimization remains open: encrypted payload currently stays with terminal
rows until cleanup instead of proving metadata-only terminal retention.

Do not apply candidate SQL. Obtain exact SQL/host review and separate production
authorization before deployment. No production, extension, MCP/OAuth runtime,
signing, pairing, feature flag or workflow changes occurred. Baseline remains
1.6.0 / protocol 1 / 26 capabilities / 18 public MCP tools. Historical production
cleanup was not rechecked this session.
