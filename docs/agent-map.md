# Agent map

A navigation map for humans and coding agents. It is deliberately small: if a
directory is not listed here, it is generated state, user data, or an archive.

## First reads

- [`AGENTS.md`](../AGENTS.md): rules, goals, acceptance bar.
- [`README.md`](../README.md): product, layout, commands, contract numbers.
- [`docs/handoff.md`](handoff.md): current state and next move.
- [`docs/security.md`](security.md): trust boundary.

## Runtime areas

| Area | Entry | Responsibility | Tests |
|---|---|---|---|
| Extension runtime | `extension/background.js`, `extension/content.js` | MV3 worker, content injection, generic primitives | `tests/browser_extension_test.py`, `tests/*extension*.test.mjs` |
| Shared pure modules | `lib/*.js` | Expressions, focus, protocol, working state | `tests/*semantic*.test.mjs`, `tests/*working-state*.test.mjs` |
| Cloud backend | `supabase/functions/*/index.ts`, `_shared/*.js` | Auth, billing, bridge, gateway, MCP, runner, update, VM | `tests/mcp-surface.test.mjs`, live Supabase tests |
| Local MCP | `local/bin/opera-local.js`, `local/mcp-server.js` | CDP driver behind an MCP stdio server | `tests/local-*-*.test.mjs` |
| Local primitives | `local/primitives.js`, `local/page-expressions.js` | Generic page actions and expressions | `tests/local-primitives.test.mjs` |
| Local waits | `local/primitives.js`, `local/page-expressions.js` | Mutation-based text/row/stillness waits | `tests/local-primitives.test.mjs` |
| Local burst | `local/burst.js`, `local/mcp-server.js` | One call for 1-8 dependent single-tab steps | `tests/local-burst.test.mjs`, `tests/local-mcp-server.test.mjs` |
| Window focus | `local/window-focus.js`, `local/focus-guard.js`, `local/sessions.js` | Page-first focus, CDP window state, OS fallback | `tests/window-focus.test.mjs`, `tests/local-sessions.test.mjs` |
| Statements/reports | `local/statements.js`, `local/reports.js` | CSV-to-report pipeline and delivery | `tests/*statement*.test.mjs`, `tests/*report*.test.mjs` |
| Landing | `landing/*.html`, `landing/*.js` | Public site and OAuth helpers | `tests/landing-*.test.mjs` |

## Tests

- Fast gate: `npm test`.
- Structural gate: `npm run check`.
- Live gate: `py tests/browser_extension_test.py`.
- Rule: every exported function in `local/` must be named by at least one test.

## Commands

```bash
npm test          # fast suite
npm run check     # runtime discovery + version pins
node scripts/format-comments.mjs --write   # canonical comment form
```

## Modularity rules

- One file answers one question.
- Pure expressions stay in `page-expressions.js`.
- IO and CDP stay in `primitives.js`.
- MCP protocol stays in `mcp-server.js`.
- Fixed gaps and dead code are not allowed; replace waits with measured waits.
- Prefer splitting a growing file by job, not by line count.
- Keep barrel exports explicit and tested.
- Run `npm test` and `npm run check` after every structural change.