# Opera Agent

Opera Agent is a private local-browser bridge for Opera. It lets ChatGPT/Supabase send **allowlisted browser primitives** to the user's local Opera session and receive structured results without moving the browsing session to a cloud browser.

**Version:** `1.0.1`  
**Protocol:** `1`  
**Stable extension ID:** `pagjlnohdemoohcncicjmaejedcmcocm`

## Architecture

```text
ChatGPT
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
structured result
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

## Repository

```text
extension/                 MV3 Opera extension
supabase/migrations/       Database schema, command helpers, workflow registry
supabase/functions/        Edge bridge and signed extension update service
scripts/                   Validation/build scripts
tests/                     Unit, security, and Chromium regression tests
docs/                      Architecture, protocol, install, testing, releases
.github/workflows/         CI and release automation
```

## Quick start

See [docs/install.md](docs/install.md). The initial installation/pairing is a one-time trust step. After that, most new behavior is hot-updated through Supabase workflows; core extension releases are served as signed CRX updates from the Opera Agent update service.

## Documentation

- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Installation](docs/install.md)
- [Testing](docs/testing.md)
- [Versioning](docs/versioning.md)
- [Release process](docs/release-process.md)
- [Project history](docs/history.md)
- [Changelog](CHANGELOG.md)
- [Security](SECURITY.md)

## Status

Opera Agent has passed local unit/security tests, real Chromium extension regression, Supabase cloud integration, and real Opera acceptance for pairing, ping, tab operations, trusted debugger input transport, 6,000-character chunked reads with continuation, ARIA state, and media state. Version 1.0.1 adds durable completion retry handling and the backend now uses a two-phase command/workflow API so queued work is committed before the browser is asked to consume it. Real Opera acceptance now includes the signed self-hosted CRX update from 1.0.0 to 1.0.1 with the same extension ID, preserved pairing, and successful post-update commands. Passive background auto-update without pressing Opera's Update button remains intentionally unverified and will be tested in a later patch release.
