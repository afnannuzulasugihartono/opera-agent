@last-edited: 2026-10-04 18:25 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [README.md](README.md) - [docs/runbook.md](../docs/runbook.md)
# supabase/ scope
Simplify first, code first, comments second. State what is true now, never its history.
Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

Root `[AGENTS.md](../AGENTS.md)` binds; read it first.

Edge functions in Deno, and migrations in timestamp order.

- Read `[docs/HANDOFF.md](../docs/HANDOFF.md)`, then the function, then the migration.- Write the migration before the deploy. CI never applies migrations, so an RPC
  without one fails at call time.
- Never rewrite an applied migration. Add a new one.
- Deploy and release promotion are owner decisions.
