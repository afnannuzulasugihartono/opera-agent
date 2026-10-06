@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [api.md](api.md) - [security.md](security.md)

# Operator runbook

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

Simplify first, code first, comments second. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.


For whoever holds the pager. Assumes no chat history.

- Every claim here was checked against the repository when written.
- If a step contradicts what you observe, **trust what you observe** and treat
  this document as the bug.
- SQL blocks run in the Supabase SQL editor, not PostgREST â€” the four
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
| `[docs/api.md](api.md)` | Gateway request/response contract, error codes |
| `[security.md](security.md)` | Security principles, token transport |

## Publish

- The site publishes through `.github/workflows/deploy-site.yml`, dispatched by hand: `wrangler pages deploy landing --project-name=opera-agent --branch=main`.
- A green push publishes nothing; the CRX publishes through `.github/workflows/publish-crx.yml`.

## Disabled devices â€” one rule for every incident

- A row in `public.opera_devices` with `status = 'disabled'` was set by a human
  with direct database access: **nothing in this repository writes `disabled`**.
- Re-enabling one is owner-only, and takes direct SQL.
- If you find yourself wanting a second way to do this, that is the signal to
  write the writer first, not to reach for SQL.
