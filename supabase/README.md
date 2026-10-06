@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md) rules - [supabase/AGENTS.md](AGENTS.md) - [api.md](../docs/api.md) - [runbook.md](../docs/runbook.md)

# Supabase

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

Simplify first, code first, comments second. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.


Edge functions and migrations. `[supabase/AGENTS.md](AGENTS.md)` binds; read it first.

- `functions/opera-agent-mcp` — MCP server, the 22-tool client surface
- `functions/opera-agent-bridge` — command queue; owns the wait loops the client polls
- `functions/opera-agent-gateway` — auth and request shaping
- `functions/opera-agent-runner` — workflow step execution
- `functions/_shared` — modules shared across functions
- `migrations/` — timestamp order, never rewritten

Order before a deploy: the migration first, then the function that calls it. CI
never applies migrations.
