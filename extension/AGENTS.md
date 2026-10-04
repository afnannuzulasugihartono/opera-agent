# extension/ scope

Simplify first. State what is true now, never its history.

Root `AGENTS.md` binds; read it first.

MV3 runtime: background worker, content scripts, popup, options.

- Read `docs/HANDOFF.md`, then `extension/manifest.json`, then `extension/background.js`.
- Start every file and function with a comment naming it and what it does.
- Re-freeze the digests in `tests/helpers/boundary-locks.mjs` and
  `tests/fixtures/*.json` in the same commit as any edit to a pinned file.
- Related: [AGENTS.md](../AGENTS.md) - [README.md](README.md)
