@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [extension/AGENTS.md](../extension/AGENTS.md) - [supabase/AGENTS.md](../supabase/AGENTS.md)
# landing/ scope

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.
Ease of use first, code first, comments second. State what is true now, never its history.
Root `[AGENTS.md](../AGENTS.md)` binds; read it first. Static site, no build step.
- UI: one shared palette (`#0b0d10` `#14181d` `#262c34` `#e8eaed` `#9aa4b2` `#14b8a6`), one nav and footer everywhere, readable at 320px.
- UX: a stranger completes every flow, every action answers with a status line, copy is Indonesian.
- Frontend: single file per page, no framework, no external origin; one network origin per page pinned in `vercel.json` and locked.
- Copy never claims what the runtime cannot do; change both in the same commit.
- Locks prove layperson flows red before green. Runtime digests live in `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)`.
