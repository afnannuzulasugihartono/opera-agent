Last edited: 2026-10-04 17:52.

# Roadmap

Simplify first. State what is true now, never its history.

Cover every button on every site. After the main sites hold, add sites that teach new functions.

Current version: `1.6.15` (`[extension/manifest.json](extension/manifest.json)` is the source of truth).

Related: [`AGENTS.md`](AGENTS.md) - [`CHANGELOG.md`](CHANGELOG.md) - [`docs/HANDOFF.md`](docs/HANDOFF.md)

Shipped work lives in git history and in [`CHANGELOG.md`](CHANGELOG.md). This file holds
only what is still open.

## Open

- [ ] Live production workflow benchmarks with an active paired browser session.
- [ ] Fresh pairing acceptance for the replacement signing key, kept outside the repo.
- [ ] The legacy signed identity stays installed and is never routed to the new CRX.

## Standing rules

- Protocol 1 and the 26-primitive public allowlist are unchanged by feature work.
- Password, payment, and file-upload protections stay; remote JavaScript and eval stay prohibited.
- Higher-level capability ships as server-side workflows over generic primitives, never as
  site-specific code in the extension.
- Legacy Final 2 stays a documented fallback until explicit retirement; performance work must
  not silently mutate that path.
- Deployment and release promotion are owner decisions, never implied by CI green.

## References

- Contract surface: [`docs/api.md`](docs/api.md)
- Operations: [`docs/runbook.md`](docs/runbook.md)
- Measurements and locked ceilings: [`docs/benchmarks.md`](docs/benchmarks.md)
- Agent rules and triggers: [`AGENTS.md`](AGENTS.md)
