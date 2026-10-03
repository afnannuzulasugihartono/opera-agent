# Supabase

Edge functions and migrations. `supabase/AGENTS.md` binds; read it first.

- `functions/opera-agent-mcp` — MCP server, the 22-tool client surface
- `functions/opera-agent-bridge` — command queue; owns the wait loops the client polls
- `functions/opera-agent-gateway` — auth and request shaping
- `functions/opera-agent-runner` — workflow step execution
- `functions/_shared` — modules shared across functions
- `migrations/` — timestamp order, never rewritten

Order before a deploy: the migration first, then the function that calls it. CI
never applies migrations.
