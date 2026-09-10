# Opera Agent

Opera Agent is a private local-browser bridge for Opera. It lets ChatGPT/Supabase send **allowlisted browser primitives** to the user's local Opera session and receive structured results without moving the browsing session to a cloud browser.

- **Stable extension:** `1.5.1`
- **Current stable release:** `1.5.1`
- **Next planned release:** `1.6.0` (Semantic Runtime Foundation)
- **Protocol:** `1`
- **Legacy extension ID:** `pagjlnohdemoohcncicjmaejedcmcocm`
- **Current extension ID:** `ohbbpamcljckmjhcpkcmefdobkoeaick`

## Architecture

```text
ChatGPT
   |
   v
opera-agent-mcp (tool discovery and authentication)
   |
   v
Supabase workflow/command layer
   |
   v
opera_commands
   |
   v
opera-agent-bridge (Edge Function)
   |
   v
Opera Agent extension
   |
   v
Local Opera
   |
   v
structured result or bounded image
   |
   v
Supabase
   |
   v
ChatGPT
```

The extension is deliberately thin: **receive → validate → execute → collect → return**. Site-specific behavior belongs in Supabase workflows, not in the extension.

## What 1.0.x includes

- 23 allowlisted generic browser primitives.
- Tab list/find/open/activate/close/navigate/reload.
- Bounded semantic page reads up to 12,000 characters per chunk.
- Structured element state including `aria-pressed`, `aria-checked`, `aria-expanded`, `aria-selected`, `checked`, `selected`, `disabled`, visibility, and geometry.
- CSS query, semantic find, link collection, wait-for, focus, fill, scroll, and navigation keys.
- Trusted debugger/CDP click and key paths.
- Generic media state/play/pause/seek.
- Password/PIN/OTP/2FA/CVV/CVC/security-code protection.
- File-upload interaction protection.
- One-time pairing with per-device token hashing.
- Reconnect/retry behavior after network and browser restarts.
- Idempotent command completion and request IDs.
- Versioned Supabase workflow registry with rollback.
- Server-side workflow DSL (`command`, `set`, `if`, `wait`, `repeat`, `foreach`, `fail`).
- Seed workflows for browser status, research, YouTube search, recommendations/ad handling, and captions.

## Efficiency model

Opera Agent optimizes **round trips first** while keeping the browser layer generic. Server-side workflow revisions can improve performance without replacing the installed extension.

Current efficiency work includes:

- adaptive 12k text reads with continuation instead of repeated default-size reads;
- stable element keys, viewport presence, zoom, and scroll-container metrics for bounded visual navigation;
- text-oriented workflows that request minimal element metadata by default;
- one workflow per higher-level intent so ChatGPT does not orchestrate every browser primitive separately;
- state-based waits instead of fixed sleeps where possible;
- fast paths that avoid unnecessary navigation/reload;
- ad polling only when an ad is actually detected;
- a short fast-start bridge polling window that returns to conservative idle polling afterward;
- versioned workflow rollback and preserved historical migrations/releases.

See [Efficiency and flexibility plan](docs/efficiency.md) for the latency model, completed server-side work, extension-level next steps, benchmarks, and rollback rules.

The current roadmap builds vision-guided navigation on the completed background-execution and adaptive-screenshot foundations. See [Roadmap](docs/roadmap.md).

## Repository

```text
extension/                 MV3 Opera extension
supabase/migrations/       Database schema, command helpers, workflow registry
supabase/functions/        Edge bridge, workflow runner, signed update service
scripts/                   Validation/build scripts
tests/                     Unit, security, efficiency, and Chromium regression tests
docs/                      Architecture, protocol, install, testing, releases
.github/workflows/         CI and release automation
```

## Quick start

See [docs/install.md](docs/install.md). The initial installation/pairing is a one-time trust step. After that, most new behavior is hot-updated through Supabase workflows; core extension releases are served as signed CRX updates from the Opera Agent update service.

## Documentation

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Efficiency and flexibility](docs/efficiency.md)
- [Protocol](docs/protocol.md)
- [Installation](docs/install.md)
- [MCP server](docs/mcp.md)
- [Testing](docs/testing.md)
- [Versioning](docs/versioning.md)
- [Release process](docs/release-process.md)
- [Release archive](docs/releases/README.md)
- [Project history](docs/history.md)
- [Changelog](CHANGELOG.md)
- [Security](SECURITY.md)

## Status

Opera Agent has passed local unit/security tests, real Chromium extension regression, Supabase cloud integration, and real Opera acceptance for pairing, updates, ping, tab operations, bounded bursts, trusted debugger input, chunked semantic reads, ARIA state, media state, and bounded background screenshots. The backend uses a two-phase command/workflow API so queued work is committed before the browser consumes it.

The stable release is **1.5.1** under extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`; **1.5.0** remains the immediate same-identity rollback. Both retain protocol 1 and 26 capabilities. Version 1.5.1 adds a professional responsive popup while preserving the 1.5.0 vision-navigation primitives and unchanged 18-tool MCP inventory.
