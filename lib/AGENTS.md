@last-edited: 2026-10-04 18:25 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [docs/api.md](../docs/api.md)
# lib/ scope
Simplify first, code first, comments second. State what is true now, never its history.
Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](../AGENTS.md) name.

Root `[AGENTS.md](../AGENTS.md)` binds; read it first.

Shared pure modules the server and the extension both read.

- Read `[docs/HANDOFF.md](../docs/HANDOFF.md)`, then the module and its test.
- Keep it pure: no DOM, no chrome, no network.
- Make a lock fail on a realistic violation before accepting it.
- Re-freeze the digests in `[tests/helpers/boundary-locks.mjs](../tests/helpers/boundary-locks.mjs)` in the same commit.
