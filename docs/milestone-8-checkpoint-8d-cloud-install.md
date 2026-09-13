# Checkpoint 8D — authorized backend installation

Latest continuation: `docs/milestone-8-checkpoint-8d-cloud-bounds.md`.

2026-09-13. **Installation/listed probes PASS; overall 8D IN PROGRESS.** Stop
before 8E. Supersedes the host-candidate record's undeployed/no-permission state,
not its acceptance limitations or the frozen contract.

## Authority and installation

The user explicitly authorized new Supabase backend components after explanation
of OFF/DARK synthetic testing, zero browser action, unchanged extension/MCP/
pairing/signing and cleanup. Writer started clean at local/remote
`cd3d2c034fb86073c0ea33142512bee7bf839664`; independent exact candidate PASS
preceded mutation. Project `opera-agent` / `nenmkmtvjremqphfqnfw`.

- CLI 2.117.0 generated version 20260913143147. MCP applied
  transaction_journal_8d_dark successfully with history 20260913143306.
  Generated file renamed to 20260913143306_transaction_journal_8d_dark.sql to
  match actual history; CLI migration list confirms this version local=remote.
  Older unrelated history mismatches remain untouched; no bulk db push/repair.
  Only introductory comments differ from reviewed SQL.
  No DB history/body rewritten. Independent installed/audited body SHA-256,
  LF-normalized/outer-whitespace trimmed:
  `3ebdff4b3ac4d4a40e760a9f299033fe0810ae31068f46d0eae3ad32d5bd5489`.
- Separate Edge opera-agent-transactions-8d v1 ACTIVE, verify_jwt=true, full 13
  module files. Bundle SHA-256:
  `bad0ae493209891e45bc90a11d91ef85dac72022f70f7aaf8ba9e8152c822769`.
  Independent deployed/local 13 bodies matched ignoring line endings. Existing
  MCP/ledger/VM/bridge hosts were not redeployed.
- Fresh independent 32-byte encryption key installed through authenticated CLI;
  value not printed, committed or written to plaintext file. Existing keys not
  rotated. Host flag OPERA_AGENT_TRANSACTION_DARK_8D=false at closeout; temporarily
  true only for denial probes with finally restoration. SQL policy stayed OFF
  during HTTP probes. No auth/session/OAuth-client/config/browser/extension/MCP/
  pairing/signing/workflow mutation occurred.

## Actual evidence

- All 12 private tables RLS=true, no client policies/table access/schema USAGE.
  All 26 reviewed functions deny ordinary roles. Actual anon/authenticated
  opera_tx_identity_read calls denied 42501. Only private assert_live_identity
  definer, postgres-owned/fixedpg_catalog; service_role metadataSELECT allowed,
  auth.sessions UPDATE denied.
- tests/postgres/transaction-cloud-install-8d.sql ran 15 assertions successfully
  on real project: disabled agent commit, prepare/replay/cipher collision,
  foreign read/cancel, claim/lease theft, transition replay, atomic synthetic
  finalization, one slot/journal/rate debit, nonce reuse, cancel payload removal/
  replay, retention cascade. Short transaction rolled back ALL synthetic data
  and temporary DARK together. Privileged synthetic primitives are not OAuth,
  hosted prepare, genuine approval or hosted worker-death acceptance.
- Opt-in tests/cloud/transaction-host-install-8d.mjs DARK: public anon reached
  enabled host 401 AUTHENTICATION_REQUIRED/dispatchfalse; malformed JWT gateway 401.
  OFF: anon 503 TRANSACTION_DISABLED/dispatchfalse, malformed JWT401. Missing auth
  gateway 401. Earlier inline Node quoting error was local harness failure; finally
  restored false before successful file-backed rerun. Public anon grants no user/
  approval authority. No person's token/bearer/HMAC read from storage.
- Final query: policy OFF/legacy_gated=false/agent_commit_enabled=false; all 11
  synthetic data tables 0, policy singleton remains. M7 flag false/VM runs/effects/
  rate windows 0. Zero browser dispatch/enqueue by these probes.

## Advisors and regression

Security ERROR0/WARN31/INFO19→ERROR0/WARN31/INFO31: +12 deliberate private RLS
no-policy INFO; no new ERROR/WARN. Performance INFO5→INFO8, ERROR/WARN0: principal
FK unindexed INFO +2 unused indexes. Review covering index before broader use;
unrelated legacy warnings not changed. Independent reviewer reproduced isolation,
deployed bodies/advisors. Initial installation CONDITIONAL PASS pending timestamp
reconciliation; filename now matches observed history without DB/body mutation.
Final independent verdict: **PASS for bounded OFF/DARK installation and migration
reconciliation only**, not overall 8D. Reviewer reverified clean OFF/M7 state and
SQL equivalence, inspected probe scope but did not rerun mutating/network probes.
The flagged stale active context bullet was corrected before final commit.

Fresh native PG+host/HTTP/identity/token 44/44 PASS/no skips, 38.166s; full Node 239/239
PASS/no skips, 56.397s; static PASS/still 1.6.0/26 capabilities.
Fresh actual pinned SDK/Deno tests 2/2 PASS and Edge typecheck PASS.
Verify exact-final-head CI/Chromium from GitHub artifacts and temporary PR closed without
merge. Never alter standard CI for a pass.

## Open official 8D gates

Real signed OAuth positive/negative/client/session-revocation and bound hosted
prepare/status/cancel; actual hosted worker-loss/reclaim/nonce durability;
remaining full cloud quota/concurrency/payload/retention/crypto gates and final
independent acceptance remain open. Native workers, rolled-back SQL and anon
denial do not prove them. Genuine human approval transport remains 8F.

No forged identity, storage-extracted bearer, secrets in chat, new public MCP
approval surface, OAuth scopes/clients/redirects or browser executor. If existing
legitimate OAuth cannot supply the required probe, stop for reviewed acceptance
approach, not a gate waiver. Overall8D not accepted; 8E not started.

Rollback: policy OFF/hostflag false, additive private schema/encryption secret may
remain. Signed 1.6.0/protocol1/26 capabilities/MCP18, signing/pairing, immediate
rollback 1.5.2 unchanged; no new CRX.
