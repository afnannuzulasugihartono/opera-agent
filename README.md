@last-edited: 2026-10-07 UTC+7.
@related: [`AGENTS.md`](AGENTS.md) - [`docs/security.md`](docs/security.md) - [`docs/api.md`](docs/api.md)

# Opera Agent

A private, local-browser control bridge.


- Lets MCP clients drive the user's own browser session through a strict allowlist of
  generic browser primitives.
- Returns structured results; the session never moves to a cloud browser.
- The extension holds generic primitives only: receive, validate, execute, collect, return.
  It may grow as rich as task-based work needs — including local real-time loops —
  as long as every primitive stays generic. Simple means clear boundaries and no
  dead code, not a small feature count.
- Site-specific behavior lives in server-side Supabase workflows, which hot-update
  independently of the installed extension. No per-site logic and no free `eval`
  ever live in the extension.

## Boundary

- [`AGENTS.md`](AGENTS.md) holds instructions: the rules, guidelines and requirements that
  bind every task, and the map of which document answers which question.
- [`README.md`](README.md) holds the explanation: what this is, what each directory does, how
  to run it, and that same map.
- A rule that changes what you may do lives in [`AGENTS.md`](AGENTS.md) and nowhere else.

## Contract

| | |
| --- | --- |
| Protocol | `1` |
| Browser primitives | **28** allowlisted generic methods ([`extension/lib/protocol.js`](extension/lib/protocol.js)) plus device-local `watch.*`/`loop.*` async methods |
| MCP surface | **39** tools ([`supabase/functions/opera-agent-mcp/index.ts`](supabase/functions/opera-agent-mcp/index.ts)) |
| Distribution | Signed CRX3 self-updates from the update service |

## Layout

| Directory | Role |
|---|---|
| `extension/` | MV3 runtime — background worker, content scripts, popup, options |
| `lib/` | Shared pure modules the server and extension both read |
| `supabase/functions/` | Deno edge: auth, bridge, gateway, ledger, listen, MCP, runner, update, VM (10 deployed) plus `_shared/` |
| `supabase/migrations/` | SQL in timestamp order, never rewritten |
| `tests/` | Fast suite is `npm test`; `cloud` and `postgres` are live-only |
| `store/` | Generated Chrome Web Store form: `scripts/build-store-package.py` writes the manifest and the zip from `extension/` |

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

| Question | Answer |
| --- | --- |
| What are the rules that bind every task? | [`AGENTS.md`](AGENTS.md) |
| What is true right now, and what is next? | [`docs/handoff.md`](docs/handoff.md) |
| What may I do with a credential, and where is the boundary? | [`docs/security.md`](docs/security.md) |
| What primitives may the extension expose, and over what wire? | [`docs/api.md`](docs/api.md) |
| What happens on a site nobody has a workflow for? | [`docs/unknown-site.md`](docs/unknown-site.md) |
| How does this repo resist slop and silent drift? | [`docs/anti-drift.md`](docs/anti-drift.md) |
| What did a release contain, and why? | [`docs/releases/`](docs/releases/) |
| What design references informed this? | [`docs/design-references.md`](docs/design-references.md) |
| What is the product aiming at? | [`docs/uec-north-star.md`](docs/uec-north-star.md) |

A design spec under [`docs/superpowers/specs/`](docs/superpowers/specs/) records why a
subsystem is shaped the way it is, and several of its rules are still enforced by
`tests/structure-gates.test.mjs`. The implementation plans that used to sit beside them
were execution checklists for work that has since shipped; they are deleted, and `git log`
holds them.

Spent detail is recoverable from git history; there is no archive file.