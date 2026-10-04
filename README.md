# Opera Agent

A private, local-browser control bridge.

- Lets MCP clients drive the user's own browser session through a strict allowlist of
  generic browser primitives.
- Returns structured results; the session never moves to a cloud browser.
- The extension is deliberately thin: receive, validate, execute, collect, return.
- Site-specific behavior lives in server-side Supabase workflows, which hot-update
  independently of the installed extension.

## Boundary

- **`README.md` is for a person.** What this is, what the contract is, how to run it.
- **`AGENTS.md` is for an agent working in the repo.** Rules, triggers, priority, and
  which document answers which question.
- Nothing belongs in both. A rule that changes what you may do belongs in `AGENTS.md`
  and nowhere else.

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
npm test          # fast suite
npm run check     # runtime discovery + version pins
```

```bash
OA_REAL_SITE=1 py tests/real_site_smoke.py   # live internet, opt-in
```

Local green is not acceptance. The acceptance rule is in [`AGENTS.md`](AGENTS.md).

## Reference

- Rules, triggers, priority, and the map of which file answers which question:
  [`AGENTS.md`](AGENTS.md)
- Pairing, incidents, manual steps: [`docs/runbook.md`](docs/runbook.md)
- Command and response contract: [`docs/api.md`](docs/api.md)
- Latency baselines and locked ceilings: [`docs/benchmarks.md`](docs/benchmarks.md)
- Security boundary and token transport: [`SECURITY.md`](SECURITY.md)

Spent detail is recoverable from git history. There is no archive file.
