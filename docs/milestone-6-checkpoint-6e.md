# Milestone 6 Checkpoint 6E: server integration and security gate

Completed: 2026-09-12

## Accepted decision

Checkpoint 6E uses a separate internal OAuth-authenticated ledger endpoint instead
of adding MCP tools. The existing MCP tools do not receive structured goal state,
and accepting client-supplied observation evidence would allow forged proof.
Therefore:

- `opera-agent-mcp` remains byte-for-byte unchanged with its existing 18 tools;
- ChatGPT has no schema change to refresh, so logout, reconnect, extension reload,
  reinstall, and re-pairing are not required;
- `opera-agent-ledger` exposes only `open`, `revise`, `inspect`, `cancel`, and
  `expire` to allowlisted OAuth users;
- proof evaluation remains internal until a server workflow can bind evidence to
  authenticated browser-command provenance.

This is the smallest invocable surface that preserves the 6A threat model.

## Persistence and token boundary

Ledger contents are carried in opaque `oal1` tokens encrypted and authenticated
with AES-256-GCM. The key is generated inside Supabase and stored in Vault; it is
read only through a `service_role`-only function. Source, migrations, logs, and
documentation contain no key material.

Supabase persists exactly one private head table with these columns:

```text
tenant_id
goal_id
head_revision
head_digest
status
created_at
updated_at
expires_at
```

It stores no objective, constraint, authorization, claim, evidence, page text,
screenshot, private URL, form value, credential, or token. The schema is outside
the exposed API schemas, RLS is enabled, and `anon`/`authenticated` have no schema,
table, or function permission. Only narrowly scoped `service_role` functions can
read, compare-and-swap, or clean up heads.

## Authentication, tenancy, and retries

Supabase JWT verification is enabled on the Edge Function. The handler also calls
`auth.getUser`, requires the same configured user-ID/email allowlist as the MCP
server, and derives `tenant_id` from the verified user. A caller cannot select
another tenant. The database key is `(tenant_id, goal_id)`, so another tenant sees
`HEAD_NOT_FOUND` rather than another user's metadata.

Head updates use revision/digest compare-and-swap. An exact repeated create or
transition returns `replayed: true` without another revision. A retry with
different output is rejected as `GOAL_EXISTS` or `STALE_HEAD`. Token validation
and encryption happen before database mutation, so malformed request IDs or
oversized tokens cannot leave a partial head.

## Bounds and cleanup

- Request body: at most 131,072 bytes.
- Opaque ledger token: at most 65,536 bytes.
- Goal lifetime: at most seven days.
- Revision: at most 2,147,483,647.
- Ledger structure and evidence bounds: unchanged from the frozen 6A contract.
- Per-Edge-isolate defense: 20 mutations and 60 reads per user per minute, with a
  bounded 1,000-user in-memory window map.
- Cleanup RPC: terminal or expired metadata can be purged after a bounded
  retention of one hour through seven days; the default is one day.

The rate window is a local defense, not a claim of globally exact distributed
throttling. A later multi-worker milestone must add shared rate state or an
upstream gateway if globally exact quotas become necessary.

## Deployment and verification

- Local migrations:
  - `20260911164000_opera_agent_goal_head.sql`
  - `20260911165500_opera_agent_goal_head_first_apply.sql`
- Recorded Supabase migrations:
  - `20260911162525 opera_agent_goal_head`
  - `20260911162819 opera_agent_goal_head_first_apply`
- Edge Function: `opera-agent-ledger`, version 3, `verify_jwt: true`.
- Deployed bundle SHA-256:
  `235a432b208f182743fb62216b0d6262ebae11624aee68e7b71b2134789f57bc`.
- Feature flag: `milestone6_ledger_enabled=false` after testing.
- Persistent integration-probe rows after testing: zero.
- Unauthenticated HTTP probe: rejected with status 401.
- Database integration: first write `replayed:false`; exact transition retry
  `replayed:true`; conflicting retry `STALE_HEAD`; other-tenant read
  `HEAD_NOT_FOUND`.
- Permissions: `anon=false`, `authenticated=false`, `service_role=true` for every
  new RPC.
- Supabase security advisor: no relevant new ERROR/WARN. The only new relevant
  notice is INFO (`rls_enabled_no_policy`), expected because the private table has
  no client policies or grants.
- Existing MCP source SHA-256 remains
  `6235edffe31b47fb3771e805d9a46b08ab6d576420ac4867a69b75c7a86906d0`.
- Full local suite: 112/112 tests passed; static `npm run check` passed with
  version 1.6.0 and 26 allowlisted browser primitives.

The production deployment is intentionally dark until Checkpoint 6F performs the
full compatibility and acceptance ladder.

## Rollback

Immediate rollback is to keep or set `milestone6_ledger_enabled=false`. This makes
the key and head RPCs return `FEATURE_DISABLED` while Opera Agent 1.6.0 and all 18
MCP tools continue unchanged. If removal is later required, restore or delete only
the separate `opera-agent-ledger` function and purge the private metadata through
the cleanup RPC. Do not alter the extension, pairing, MCP function, or signing
identity.

## Checkpoint 6F boundary

Checkpoint 6F must run the full Node/static suite, controlled Chromium, isolated
Opera, queue/restart/timeout checks, a real allowlisted OAuth success path, and
normal-profile read-only Maps/YouTube/GitHub scenarios while recording zero focus
changes and zero sensitive persistence. Only 6F may decide whether to enable the
feature and record Milestone 6 as a server release.
