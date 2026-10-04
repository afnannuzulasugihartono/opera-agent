# supabase/ scope
Simplify first. State what is true now, never its history.
Cover every button on every site. After the main sites hold, add sites that teach new functions.

Root `[AGENTS.md](../AGENTS.md)` binds; read it first.

Edge functions in Deno, and migrations in timestamp order.

- Read `[docs/HANDOFF.md](../docs/HANDOFF.md)`, then the function, then the migration.
- Write the migration before the deploy. CI never applies migrations, so an RPC
  without one fails at call time.
- Never rewrite an applied migration. Add a new one.
- Deploy and release promotion are owner decisions.
- Related: [AGENTS.md](../AGENTS.md) - [README.md](README.md) - [docs/runbook.md](../docs/runbook.md)
