# Operator runbook

Simplify first. State what is true now, never its history.

Related: [AGENTS.md](../AGENTS.md) - [api.md](api.md) - [SECURITY.md](../SECURITY.md)

For whoever holds the pager. Assumes no chat history.

- Every claim here was checked against the repository when written.
- If a step contradicts what you observe, **trust what you observe** and treat
  this document as the bug.
- SQL blocks run in the Supabase SQL editor, not PostgREST — the four
  operator-facing RPCs are revoked from `public`/`anon`/`authenticated`, so a
  PostgREST call fails on permissions.

## Bases

```bash
SUPABASE_URL="https://nenmkmtvjremqphfqnfw.supabase.co"
GATEWAY="$SUPABASE_URL/functions/v1/opera-agent-gateway"
BRIDGE="$SUPABASE_URL/functions/v1/opera-agent-bridge"
UPDATE="$SUPABASE_URL/functions/v1/opera-agent-update"
```

| Document | Covers |
|---|---|
| `docs/api.md` | Gateway request/response contract, error codes |
| `SECURITY.md` | Security principles, token transport |

## Disabled devices — one rule for every incident

- A row in `public.opera_devices` with `status = 'disabled'` was set by a human
  with direct database access: **nothing in this repository writes `disabled`**.
- Re-enabling one is owner-only, and takes direct SQL.
- If you find yourself wanting a second way to do this, that is the signal to
  write the writer first, not to reach for SQL.
