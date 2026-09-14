# Checkpoint 8D reviewed fence installation

2026-09-14. Installation verified; 8D IN PROGRESS, 8E not started.

After explicit user authority and independent PASS at f1e6f944, the sole writer
set only `OPERA_AGENT_TRANSACTION_DARK_8D=false` through the authenticated CLI.
No encryption/signing key was rotated or printed. The reviewed fence migration
was applied through Supabase MCP to project opera-agent/nenmkmtvjremqphfqnfw.
Actual migration history version is 20260914043049; the candidate file was renamed
to match history, with only the introductory status comment changed. No existing
history or unrelated schema was repaired or rewritten.

The isolated opera-agent-transactions-8d Edge was deployed with verify_jwt=true
and its existing pinned SDK/import map. Deployment version 8 is ACTIVE; integrity
authority is bundle hash, not deployment version:

`96485822bdebdcb2c474b2f7879a63b20f26d4741d6a90d4c51679c5b57a42f1`

All 13 retrieved deployed module/configuration bodies match the reviewed local
bodies after explicit CRLF/lone-CR normalization to LF. Existing MCP, ledger, VM,
bridge, runner, update and auth Edge functions were not redeployed.
The Management backend pin is changed only to that observed exact hash.
Independent pin-delta review and exact-head CI still precede enabled acceptance.

Fresh SQL after installation showed epoch0, owner/namespace/lease null,
hostEnabled=false, hosted_gate=false, policy OFF, legacy_gated=false,
agent_commit_enabled=false; principals/runs/goals zero. Before installation all
11 candidate data tables and private goal_heads were freshly verified zero.
All eight operator routines deny anon/authenticated EXECUTE, allow service_role,
and set search_path=pg_catalog. The control table has RLS enabled and no client
table authority. No fixture, OAuth or browser mutation was performed.

Post-install advisors: no ERROR, inherited WARN31 unchanged, INFO31 to INFO32;
the only added finding is private operator_control RLS with no client policy,
intentional service-only storage. CLI migration list confirms the new history
version local=remote; unrelated older history mismatches remain untouched.
Full default Node suite after pin: PASS (314 tests, zero skips), static 1.6.0/26
and whitespace PASS. Deno checks of Edge and acceptance CLI PASS. The initial
focused run retained the old sentinel assertion and failed that one assertion;
it was replaced with the exact observed deployed hash, not a wildcard acceptance.

## Remaining closure work

Fresh signed OAuth binding/negative/revocation and hosted lifecycle; actual hosted
worker loss/reclaim/nonce durability; concurrent cloud/quota/minute rollover,
payload/retention/crypto negative matrix; final OFF/zero cleanup, advisors and
independent overall acceptance remain open. Existing prepare/replay/status/cancel
CLI does not cover that entire matrix. Never claim an HTTP abort terminates an
Edge worker or that native evidence is hosted acceptance.

Rollback remains master OFF, host gate false and transaction policy OFF.
Additive private storage may remain installed; extension1.6.0/protocol1/26,
public MCP18, signing, pairing and CRX are unchanged.
