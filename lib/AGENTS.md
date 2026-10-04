# lib/ scope

Simplification above everything. Current state, never a history book.

Root `AGENTS.md` binds; read it first.

Shared pure modules the server and the extension both read.

- Read `docs/HANDOFF.md`, then the module and its test.
- Keep it pure: no DOM, no chrome, no network.
- Make a lock fail on a realistic violation before accepting it.
- Re-freeze the digests in `tests/helpers/boundary-locks.mjs` in the same commit.
- Related: [AGENTS.md](../AGENTS.md) - [docs/api.md](../docs/api.md)
