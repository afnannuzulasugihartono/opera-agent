@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [README.md](README.md)
# extension/ scope

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.
Simplify first, code first, comments second. State what is true now, never its history.
Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

Root `[AGENTS.md](../AGENTS.md)` binds; read it first.

MV3 runtime: background worker, content scripts, popup, options.

- Read `[docs/HANDOFF.md](../docs/HANDOFF.md)`, then `[extension/manifest.json](manifest.json)`, then `[extension/background.js](background.js)`.
- Start every file and function with a comment naming it and what it does.
- Re-freeze the digests in `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` and
  `tests/fixtures/*.json` in the same commit as any edit to a pinned file.
