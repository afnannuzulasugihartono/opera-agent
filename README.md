# Opera Agent

**A private, local-browser control bridge for Opera.**

Opera Agent lets ChatGPT and other MCP clients drive the user's *own* Opera
session through a strict allowlist of generic browser primitives, and receive
structured results — without moving the browsing session to a cloud browser.
The extension is deliberately thin (`receive → validate → execute → collect →
return`); site-specific behavior lives in server-side Supabase workflows that
hot-update independently of the installed extension.

## Current release and contract

| | |
| --- | --- |
| Production release | **`1.6.13`** — signed, audited, activated; served live by the update service |
| Protocol | `1` |
| Browser primitives | **26** allowlisted generic methods |
| MCP surface | **22** frozen tools (Protocol 1, U-T rebaseline) |
| Extension ID | `ohbbpamcljckmjhcpkcmefdobkoeaick` (legacy: `pagjlnohdemoohcncicjmaejedcmcocm`) |
| Distribution | Signed CRX3 self-updates from the Opera Agent update service; GitHub releases are archive pages only |
| CI | CircleCI (tests) · Vercel (deploy/preview) · SonarCloud (PR quality gate) |

Older releases `1.6.10`/`1.6.11` remain intact inactive rows as rollback
targets. Full release records: [`docs/project-context.md`](docs/project-context.md),
[`docs/releases/`](docs/releases/README.md).

## Architecture

```text
ChatGPT / MCP client
    → opera-agent-mcp        (tool discovery + authentication)
    → Supabase workflow layer (two-phase command/workflow API)
    → opera_commands         (queue; committed before consumption)
    → opera-agent-bridge     (Edge Function)
    → Opera Agent extension  (MV3 service worker + content runtime)
    → local Opera            (trusted CDP input, bounded reads, media, tabs)
    → structured result / bounded image → back to the client
```

## Capabilities

**Navigation and observation**
- Tab list/find/open/activate/close/navigate/reload.
- Bounded semantic page reads (adaptive chunks up to 12,000 characters with
  continuation, not repeated default-size dumps).
- Structured element state: `aria-pressed`/`aria-checked`/`aria-expanded`/
  `aria-selected`, `checked`, `selected`, `disabled`, visibility, geometry,
  stable element keys, and delta-first observations so re-reads stay small.

**Action**
- CSS query, semantic find, link collection, wait-for, focus, fill, scroll,
  navigation keys, and atomic click/fill bursts.
- Trusted debugger/CDP click and key paths with expect-based post-action
  verification; slow SPA/OAuth redirects resolve without a re-click.
- Generic media state/play/pause/seek.

**Safety**
- Password/PIN/OTP/2FA/CVV/CVC/security-code interaction protection.
- File-upload interaction protection; sensitive and clipped controls stay
  non-actionable.
- One-time pairing with per-device token hashing; bounded command authority.

**Reliability**
- Reconnect/retry across network drops and browser restarts.
- Idempotent command completion with request IDs; coded timeout outcomes.
- Versioned Supabase workflow registry with rollback; server-side revisions
  improve behavior without reinstalling the extension.

## Efficiency model

Round trips are optimized first while keeping the browser layer generic:
state-based waits instead of fixed sleeps, fast paths that avoid unnecessary
navigation, ad polling only on detection, one workflow per higher-level
intent, a fast-start bridge polling window, and bounded background
screenshots. Benchmarks and the latency model live in
[`docs/efficiency.md`](docs/efficiency.md); the vision-guided navigation
track builds on these foundations ([`docs/roadmap.md`](docs/roadmap.md)).

## Repository layout

```text
extension/            MV3 Opera extension (service worker, content runtime, UI)
lib/                  shared runtime modules
supabase/migrations/  database schema, command helpers, workflow registry
supabase/functions/   Edge bridge, workflow runner, MCP server, update service
oauth-consent/        OAuth consent page (deployed to Vercel)
scripts/              validation/build/ops scripts
tests/                unit, security, efficiency, and Chromium regression suites
docs/                 architecture, protocol, checkpoints, releases, governance
specs/                Spec Kit feature artifacts
release-trigger/      release-automation input (.github/workflows/release.yml)
tools/                vendored tooling (repowise)
```

## Quick start

Install and pair once via [`docs/install.md`](docs/install.md). After that,
most new behavior arrives through Supabase workflow hot-updates; core
extension upgrades are delivered as signed CRX through the Opera update
service (`update.xml` → self-hosted signed artifact).

Development checks:

```bash
npm test        # full deterministic suite
npm run check   # static contract + runtime parse gate
```

Live browser acceptance runs `tests/browser_extension_test.py` against a
headless Chromium/Edge (see [`docs/testing.md`](docs/testing.md)).

## Documentation

- [Architecture](docs/architecture.md) · [Protocol](docs/protocol.md) · [Versioning](docs/versioning.md)
- [Roadmap](docs/roadmap.md) · [Efficiency](docs/efficiency.md) · [Performance](docs/performance.md)
- [Installation](docs/install.md) · [MCP server](docs/mcp.md) · [Testing](docs/testing.md)
- [Release process](docs/release-process.md) · [Release archive](docs/releases/README.md)
- [Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)
- [Project history](docs/history.md) · [Durable context](docs/project-context.md) · [Handoff](docs/next-session-handoff.md)
- Milestone plans: [6](docs/milestone-6-plan.md) · [7](docs/milestone-7-plan.md) · [8](docs/milestone-8-plan.md)

## Status

Local unit/security tests, real Chromium extension regression, Supabase cloud
integration, and real Opera acceptance have passed for pairing, updates, ping,
tab operations, bounded bursts, trusted debugger input, chunked semantic
reads, ARIA state, media state, and bounded background screenshots. The
pre-8E usability repair track ships as sequential U-* checkpoints; `main` is
fast-forwarded only after CircleCI + Vercel succeed on the exact head.
Production deployment, signed-release promotion, and Milestone 8E start
remain explicit owner decisions — see [`AGENTS.md`](AGENTS.md) for the
binding session, branch, and naming governance rules.
