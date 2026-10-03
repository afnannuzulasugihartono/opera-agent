# Opera Agent

**A private, local-browser control bridge.** Lets MCP clients drive the user's
own browser session through a strict allowlist of generic browser primitives,
returning structured results without moving the browsing session to a cloud
browser.

The extension is deliberately thin (`receive → validate → execute → collect →
return`). Site-specific behavior lives in server-side Supabase workflows, which
hot-update independently of the installed extension.

## Contract

| | |
| --- | --- |
| Protocol | `1` |
| Browser primitives | **26** allowlisted generic methods (`extension/lib/protocol.js`) |
| MCP surface | **22** tools (`supabase/functions/opera-agent-mcp/index.ts`) |
| Distribution | Signed CRX3 self-updates from the update service |

## Layout

| Directory | Role |
|---|---|
| `extension/` | MV3 runtime — background worker, content scripts, popup, options |
| `lib/` | Shared pure modules the server and extension both read |
| `supabase/functions/` | Deno edge: MCP server, bridge, gateway, runner, VM |
| `supabase/migrations/` | SQL in timestamp order, never rewritten |
| `tests/` | Fast suite (`npm test`); `tests/cloud`, `tests/postgres`, `tests/deno` are live-only |

## Commands

```bash
npm test          # fast suite, 772 tests
npm run check     # runtime discovery + version pins
```

Local green is not acceptance — see the acceptance rule in `AGENTS.md`.

## Where to start

Start at `AGENTS.md`. Its Triggers table says what to do; this table says which file answers which question.

| Question | File |
|---|---|
| What am I allowed to do, and in what order | [`AGENTS.md`](AGENTS.md) |
| What shipped last session | [`docs/HANDOFF.md`](docs/HANDOFF.md) |
| What is still open, and what is still undecided | [`ROADMAP.md`](ROADMAP.md) |
| Commands, pairing, manual steps | [`docs/runbook.md`](docs/runbook.md) |
| Command and response contract | [`docs/api.md`](docs/api.md) |
| Latency baselines and locked ceilings | [`docs/benchmarks.md`](docs/benchmarks.md) |
| Traps that caused a false claim | [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| What changed in each release | [`CHANGELOG.md`](CHANGELOG.md) |

Spent detail is recoverable from git history. There is no archive file.
