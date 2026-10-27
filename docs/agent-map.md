# Agent map

A navigation map for humans and coding agents. It is deliberately small: if a
directory is not listed here, it is generated state, user data, or an archive.

## First reads

- [`AGENTS.md`](../AGENTS.md): rules, goals, acceptance bar.
- [`README.md`](../README.md): product, layout, commands, contract numbers.
- [`docs/handoff.md`](handoff.md): current state and next move.
- [`docs/security.md`](security.md): trust boundary.
- [`docs/naming.md`](naming.md): which name space a name belongs to, and the shape it takes.

## Runtime areas

| Area | Entry | Responsibility | Tests |
|---|---|---|---|
| Extension runtime | `extension/background.js`, `extension/content.js` | MV3 worker, content injection, generic primitives | `tests/browser_extension_test.py`, `tests/*extension*.test.mjs` |
| Shared pure modules | `lib/*.js` | Expressions, focus, protocol, working state | `tests/*semantic*.test.mjs`, `tests/*working-state*.test.mjs` |
| Cloud backend | `supabase/functions/*/index.ts`, `_shared/*.js` | Auth, billing, bridge, gateway, MCP, runner, update, VM | `tests/mcp-surface.test.mjs`, live Supabase tests |
| Local MCP | `local/bin/opera-local.js`, `local/agent/mcp-server.js` | CDP driver behind an MCP stdio server | `tests/local-*-*.test.mjs` |
| Local primitives | `local/drive/primitives.js` | The driver assembled: navigation, focus, and one verb per module below | `tests/local-primitives.test.mjs` |
| Local typing | `local/drive/input.js` | type, append, key, keys, selectAll, clear, and the edit signature that proves the page moved | `tests/local-input.test.mjs` |
| Local pointer | `local/drive/pointer.js` | clickAt, clickFraction, hover, hoverRow, clickHandle, handleBox, resolveHandle | `tests/local-pointer.test.mjs` |
| Local reads | `local/drive/observe.js` | snapshot, resolveRow, menuTree, openMenu, computed, scroll, viewport, capture | `tests/local-observe.test.mjs` |
| Local waits | `local/drive/waits.js` | The page settle, waitForIdle, and the text, row and stillness waits on it | `tests/local-waits.test.mjs` |
| Local canvas read | `local/surface/canvas.js` | A Google Doc read through its own copy path, with the caret put back | `tests/local-canvas.test.mjs` |
| Local file verbs | `local/drive/primitives-file.js` | Upload, drop and download, proven by the bytes on disk | `tests/local-file.test.mjs` |
| Local MCP tools | `local/agent/tools.js` | The advertised tool surface, its descriptions and its schemas | `tests/advice.test.mjs`, `tests/local-mcp-server.test.mjs` |
| Local burst | `local/drive/burst.js`, `local/agent/mcp-server.js` | One call for 1-8 dependent single-tab steps | `tests/local-burst.test.mjs`, `tests/local-mcp-server.test.mjs` |
| Window focus | `local/core/window-focus.js`, `local/drive/focus-guard.js`, `local/core/sessions.js` | Page-first focus, CDP window state, OS fallback | `tests/window-focus.test.mjs`, `tests/local-sessions.test.mjs` |
| Statements/reports | `local/jobs/statements.js`, `local/jobs/reports.js` | CSV-to-report pipeline and delivery | `tests/*statement*.test.mjs`, `tests/*report*.test.mjs` |
| Documents | `local/jobs/documents.js` | JSON paper to a checked document plan, with every graph recomputed from its named table | `tests/document-job.test.mjs` |
| Landing | `landing/*.html`, `landing/*.js` | Public site and OAuth helpers | `tests/landing-*.test.mjs` |

### Local package groups

`local/` is one package in six groups. The table above names the files; the group
is the job each file does, so a new module goes to the group that answers its
question.

| Group | Job |
|---|---|
| `local/core` | Find a browser, speak CDP, hold the driver and its per-tab sessions, read the OS window |
| `local/bridge` | The loopback conversation with the extension, both ends and the frames between |
| `local/drive` | The verbs that act on a page, and the page-side expressions they share |
| `local/surface` | What a surface measures as, and the read or action ladder that measurement justifies |
| `local/jobs` | Disk work that opens no tab: statements, reports, documents |
| `local/agent` | The MCP surface: the stdio server, the tool table, the advice, the task guide |

`local/package.json` ships the groups by name, so the list changes only when a
group is added. `tests/local-package.test.mjs` walks the imports from the bin to
prove every reachable module lands inside one.

## Tests

- Fast gate: `npm test`.
- Structural gate: `npm run check`.
- Live gate: `py tests/browser_extension_test.py`.
- Rule: every exported function in `local/` must be named by at least one test.
- Rule: one test file per module, sharing the fakes in `tests/helpers/local-page.mjs`.

## Commands

```bash
npm test          # fast suite
npm run check     # runtime discovery + version pins
node scripts/format-comments.mjs --write   # canonical comment form
```

## Modularity rules

- One file answers one question.
- Pure expressions stay in `drive/page-expressions.js`.
- A verb and the read that proves it took stay together: `drive/input.js`, `drive/pointer.js`, `drive/observe.js`.
- `drive/primitives.js` assembles them and holds only navigation, focus and the raw escape hatch.
- MCP protocol stays in `agent/mcp-server.js`.
- Fixed gaps and dead code are not allowed; replace waits with measured waits.
- Prefer splitting a growing file by job, not by line count.
- A module takes `cdp`, `primitives` and `sleep`, and is assigned onto the object it belongs to.
- Run `npm test` and `npm run check` after every structural change.