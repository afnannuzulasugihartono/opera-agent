@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [README.md](README.md) - [docs/runbook.md](../docs/runbook.md)
# supabase/ scope

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.
Simplify first, code first, comments second. State what is true now, never its history.
Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

Root `[AGENTS.md](../AGENTS.md)` binds; read it first.

Edge functions in Deno, and migrations in timestamp order. Backend serves the site's promises.
- Read `[docs/HANDOFF.md](../docs/HANDOFF.md)`, then the function, then the migration.- Write the migration before the deploy. CI never applies migrations, so an RPC without one fails at call time.
- One owner-scoped RPC per dashboard need; additive migrations only, dashboard copy changes in the same commit.
- Never rewrite an applied migration. Add a new one. Deploy and release promotion are owner decisions.
