# Opera Agent

A private, local-browser control bridge.

Related: [`AGENTS.md`](AGENTS.md) - [`SECURITY.md`](SECURITY.md) - [`docs/api.md`](docs/api.md)

- Lets MCP clients drive the user's own browser session through a strict allowlist of
  generic browser primitives.
- Returns structured results; the session never moves to a cloud browser.
- The extension is deliberately thin: receive, validate, execute, collect, return.
- Site-specific behavior lives in server-side Supabase workflows, which hot-update
  independently of the installed extension.

## Boundary

- [`AGENTS.md`](AGENTS.md) holds instructions: rules, guidelines, requirements, triggers,
  and the map of which document answers which question.
- `README.md` holds the explanation: what this is, what each directory does, how to run it.
- A rule that changes what you may do lives in `AGENTS.md` and nowhere else.

## Contract

| | |
| --- | --- |
| Protocol | `1` |
| Browser primitives | **26** allowlisted generic methods ([`extension/lib/protocol.js`](extension/lib/protocol.js)) |
| MCP surface | **22** tools ([`supabase/functions/opera-agent-mcp/index.ts`](supabase/functions/opera-agent-mcp/index.ts)) |
| Distribution | Signed CRX3 self-updates from the update service |

## Layout

| Directory | Role |
|---|---|
| [`extension/`](extension/README.md) | MV3 runtime — background worker, content scripts, popup, options |
| [`lib/`](lib/AGENTS.md) | Shared pure modules the server and extension both read |
| [`supabase/functions/`](supabase/README.md) | Deno edge: MCP server, bridge, gateway, runner, VM |
| `supabase/migrations/` | SQL in timestamp order, never rewritten |
| [`tests/`](tests/README.md) | Fast suite is `npm test`; `cloud`, `postgres`, `deno` are live-only |

## Commands

```bash
npm test          # fast suite
npm run check     # runtime discovery + version pins
```

```bash
OA_REAL_SITE=1 py tests/real_site_smoke.py   # live internet, opt-in
```

Local green is not acceptance. The acceptance rule is in [`AGENTS.md`](AGENTS.md).

## Which document answers what

[`AGENTS.md`](AGENTS.md) holds the map. Spent detail is recoverable from git history;
there is no archive file.