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
- [`CONTRIBUTING.md`](CONTRIBUTING.md) says what a change has to look like when it arrives
  here, and how a reviewer reads it. It repeats no rule.
- [`CHANGELOG.md`](CHANGELOG.md) says what each release contained, and points at the notes.
- [`SECURITY.md`](SECURITY.md) is the private route for a vulnerability, where GitHub renders
  it; [`docs/security.md`](docs/security.md) holds the detail.

## Contract

| | |
| --- | --- |
| Protocol | `1` |
| Browser primitives | **31** allowlisted generic methods ([`extension/lib/protocol.js`](extension/lib/protocol.js)) plus device-local `watch.*`/`loop.*` async methods |
| Cloud MCP surface | **34** tools ([`supabase/functions/opera-agent-mcp/index.ts`](supabase/functions/opera-agent-mcp/index.ts)) |
| Local MCP surface | **40** tools ([`local/mcp-server.js`](local/mcp-server.js)) - the operator's own signed-in Chrome, no cloud hop |
| Distribution | Signed CRX3 self-updates from the update service |

Every number in that table is measured, not typed: `tests/readme.test.mjs` reads the
primitives from the protocol, the tools from the frozen contract and the local server,
and the edge functions from the directories that hold an `index.ts`. A number that
drifts fails the suite instead of ageing in the file.
## Layout

| Directory | Role |
|---|---|
| `extension/` | MV3 runtime — background worker, content scripts, popup, options |
| `lib/` | Shared pure modules the server and extension both read |
| `local/` | The local MCP server: CDP straight to the browser on this machine, plus the statement job |
| `supabase/functions/` | Deno edge: auth, billing, bridge, gateway, listen, MCP, runner, update, VM (9 deployed) plus `_shared/` |
| `supabase/migrations/` | SQL in timestamp order, never rewritten |
| `tests/` | Fast suite is `npm test`; `cloud` and `postgres` are live-only |
| `landing/` | The site Cloudflare Pages serves |
| `store/` | Generated Chrome Web Store form: `scripts/build-store-package.py` writes the manifest and the zip from `extension/` |

## Commands

```bash
npm test          # fast suite
npm run check     # runtime discovery + version pins
```

```bash
OA_REAL_SITE=1 py tests/real_site_smoke.py   # live internet, opt-in
OA_LIVE_SITE_TESTS=1 py tests/browser_extension_test.py   # drives Google Maps for real, opt-in
```

Local green is not acceptance. The acceptance rule is in [`AGENTS.md`](AGENTS.md).

## Which document answers what

| Question | Answer |
| --- | --- |
| Where is the code map for agents and reviewers? | [`docs/agent-map.md`](docs/agent-map.md) |
| What are the rules that bind every task? | [`AGENTS.md`](AGENTS.md) |
| What does a change have to look like, and how is it reviewed? | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| What is true right now, and what is next? | [`docs/handoff.md`](docs/handoff.md) |
| What may I do with a credential, and where is the boundary? | [`docs/security.md`](docs/security.md) |
| How do I report a vulnerability privately? | [`SECURITY.md`](SECURITY.md) |
| What primitives may the extension expose, and over what wire? | [`docs/api.md`](docs/api.md) |
| What happens on a site nobody has a workflow for? | [`docs/unknown-site.md`](docs/unknown-site.md) |
| How does this repo resist slop and silent drift? | [`docs/anti-drift.md`](docs/anti-drift.md) |
| What is the statement job, and what does a delivery claim? | [`docs/jobs/statements.md`](docs/jobs/statements.md) |
| How do the first bookkeepers get reached, and how does a session run? | [`docs/product/first-three-bookkeepers.md`](docs/product/first-three-bookkeepers.md) and [`docs/product/pilot-runbook.md`](docs/product/pilot-runbook.md) |
| What is a delivery worth, and what may an agent hand to its own user? | [`docs/product/monetization.md`](docs/product/monetization.md) |
| What did a release contain, and why? | [`CHANGELOG.md`](CHANGELOG.md) and [`docs/releases/`](docs/releases/) |
| What design references informed this? | [`docs/design-references.md`](docs/design-references.md) |
| What is the product aiming at? | [`docs/uec-north-star.md`](docs/uec-north-star.md) |

A design spec under [`docs/superpowers/specs/`](docs/superpowers/specs/) records why a
subsystem is shaped the way it is, and several of its rules are still enforced by
`tests/structure-gates.test.mjs`. The implementation plans that used to sit beside them
were execution checklists for work that has since shipped; they are deleted, and `git log`
holds them.

Spent detail is recoverable from git history; there is no archive file.