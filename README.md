# Opera Agent

A private, local-browser control bridge.

- Lets MCP clients drive the user's own browser session through a strict allowlist of
  generic browser primitives.
- Returns structured results; the session never moves to a cloud browser.
- The extension is deliberately thin: receive, validate, execute, collect, return.
- Site-specific behavior lives in server-side Supabase workflows, which hot-update
  independently of the installed extension.

## Boundary

- **`AGENTS.md` holds instructions**: rules, guidelines, requirements, triggers.
- **`README.md` holds the explanation**: what this is, which file does what, where to
  find the rest of the documentation.
- A rule that changes what you may do lives in `AGENTS.md` and nowhere else.

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

## Which document answers what

| Question | File |
|---|---|
| What may I do, and in what order | [`AGENTS.md`](AGENTS.md) |
| Area scope for `extension/`, `lib/`, `supabase/` | [`extension/AGENTS.md`](extension/AGENTS.md), [`lib/AGENTS.md`](lib/AGENTS.md), [`supabase/AGENTS.md`](supabase/AGENTS.md) |
| Command and response contract | [`docs/api.md`](docs/api.md) |
| Pairing, incidents, manual steps | [`docs/runbook.md`](docs/runbook.md) |
| Latency baselines and locked ceilings | [`docs/benchmarks.md`](docs/benchmarks.md) |
| The delta-first runtime plan | [`docs/delta-first-performance-plan.md`](docs/delta-first-performance-plan.md) |
| The accessibility-tree checkpoint | [`docs/checkpoint-up1-ax-observation.md`](docs/checkpoint-up1-ax-observation.md) |
| Traps that caused a false claim | [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| What shipped last session | [`docs/HANDOFF.md`](docs/HANDOFF.md) |
| What is still open | [`ROADMAP.md`](ROADMAP.md) |
| What changed in a release | [`CHANGELOG.md`](CHANGELOG.md) |
| Security boundary and token transport | [`SECURITY.md`](SECURITY.md) |
| How to propose a change | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Where to ask for help | [`SUPPORT.md`](SUPPORT.md) |
| What the extension may do | [`extension/README.md`](extension/README.md) |
| What the edge functions and migrations are | [`supabase/README.md`](supabase/README.md) |
| What the scripts folder is for | [`scripts/README.md`](scripts/README.md) |
| What the suites cover | [`tests/README.md`](tests/README.md) |

Spent detail is recoverable from git history. There is no archive file.
