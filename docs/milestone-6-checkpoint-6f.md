# Milestone 6 Checkpoint 6F: production acceptance

Status: **in progress on 2026-09-12**. Automated and isolated gates pass; the
feature remains dark pending the user-session OAuth and normal-profile cross-site
acceptance pass.

## Defect found and fixed

The first production metadata-head probe exposed a transaction timestamp race.
Postgres `now()` is fixed at transaction start, while the Edge Function supplies a
`createdAt` timestamp generated after that boundary. A first insert could therefore
violate `updated_at >= created_at` by a few milliseconds.

Migration `20260912143000_opera_agent_goal_head_timestamp_order.sql` replaces only
the head compare-and-swap function. Inserts now use
`greatest(clock_timestamp(), p_created_at)` and revisions use
`greatest(clock_timestamp(), v_head.created_at)`. Expiry comparisons also use the
wall-clock value. Historical migrations were not modified. Supabase recorded the
deployment as `20260911231331 opera_agent_goal_head_timestamp_order`.

## Automated acceptance evidence

- Node suite: 112/112 passed, including deterministic, property, mutation-fuzz,
  hostile proof, lineage, narrowing, expansion, contradiction, expiry, and zero
  false-`PROVED` cases.
- Static gate: version 1.6.0, protocol 1, and 26 allowlisted browser primitives.
- Controlled Chromium semantic benchmark: 3/3 browser runs passed, replay
  agreement 1.0, focus changes 0, sensitive values persisted 0, semantic delta
  p95 6,087 bytes and delta/snapshot ratio 0.12.
- Isolated installed Opera regression: established extension ID
  `ohbbpamcljckmjhcpkcmefdobkoeaick`, all 54 focus audits preserved, 20/20 burst
  stability runs passed, and network plus browser-restart reconnect passed.
- Ledger benchmark, 1,000 iterations per operation across three runs: validation
  median 0.2793 ms and p95 1.0067 ms; creation median 0.2820 ms and p95 0.4307 ms.
- Proof benchmark, 500 evidence items across 30 runs: median 3.9297 ms, p95
  6.7532 ms, maximum 7.8636 ms against the p95 target below 10 ms.
- Production Supabase synthetic transaction: queue/claim passed; enqueue and
  completion retries were idempotent; expired work was not claimed; exact initial
  head replay succeeded; stale revision acceptance was zero; cross-tenant accepted
  reads were zero; cleanup deleted expired metadata.
- Cleanup verification: feature flag `false`, head rows 0, synthetic devices 0,
  synthetic commands 0. The goal-head RPC remains unavailable to `anon` and
  `authenticated`, and available only to `service_role`.
- Missing and invalid bearer requests to `opera-agent-ledger` both returned HTTP
  401. The function remains active at version 3 with `verify_jwt:true`.
- `opera-agent-mcp` remains version 12. Its 18 tool names and schemas retain the
  frozen source contract; no client schema refresh is required.
- Security advisors report no new ledger ERROR/WARN. The private metadata table's
  `rls_enabled_no_policy` INFO is intentional because client roles have no schema,
  table, or RPC grant. Other WARN findings predate Milestone 6 and are outside this
  change.

## Remaining promotion gates

Do not mark 6F or Milestone 6 complete until both gates below are captured through
the user's already-connected ChatGPT/Opera session:

1. A real allowlisted OAuth request succeeds without copying, logging, or exposing
   the bearer token.
2. Read-only normal-profile scenarios on Google Maps, YouTube, and GitHub confirm
   the goal/proof rules, including Maps narrowing/expansion, contradiction and
   expired-evidence handling, zero focus takeover, and zero sensitive persistence.

The isolated live-Google-Maps option was intentionally not enabled for the local
Opera suite. It is variable network/UI coverage and does not substitute for the
signed normal-profile test.

## Deployment identity and rollback

- Extension: unchanged at 1.6.0; no CRX, signing, pairing, protocol, or capability
  change.
- Ledger Edge Function: version 3, bundle SHA-256
  `235a432b208f182743fb62216b0d6262ebae11624aee68e7b71b2134789f57bc`.
- MCP Edge Function: version 12; tool inventory remains 18.
- Milestone 6 migrations now include production versions `20260911162525`,
  `20260911162819`, and `20260911231331`.
- Immediate rollback remains `milestone6_ledger_enabled=false`. This is the current
  state, so Opera Agent 1.6.0 and the existing MCP tools remain usable. The
  timestamp migration changes no table shape and requires no extension reinstall,
  reconnect, logout, or re-pairing.
