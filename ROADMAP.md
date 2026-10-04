@last-edited: 2026-10-05 00:56 UTC+7.
@related: [`AGENTS.md`](AGENTS.md) - [`CHANGELOG.md`](CHANGELOG.md) - [`docs/HANDOFF.md`](docs/HANDOFF.md)

# Roadmap

Simplify first, code first, comments second. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](AGENTS.md) name.

Current version: `1.6.15` (`[extension/manifest.json](extension/manifest.json)` is the source of truth).


Shipped work lives in git history and in [`CHANGELOG.md`](CHANGELOG.md). This file holds
only what is still open.

## Open

- [ ] Live production workflow benchmarks with an active paired browser session.
- [ ] Fresh pairing acceptance for the replacement signing key, kept outside the repo.
- [ ] The legacy signed identity stays installed and is never routed to the new CRX.
- [ ] A landing page for Opera Agent and its downloads. New top-level entry, so it needs
      the owner's call on host and path first; the extension store listing is the other
      place it has to appear.
- [ ] An end-to-end artefact run: ask an assistant for a Word document, the document
      exists. Blocked on Google credentials in the live suite, not on the runtime.
- [ ] Hand a compiled plan to the device. `lib/goal-plan.js` is the gate and
      `buildPlanRequest` is the prompt; both proven, neither wired. Needs a model endpoint
      and key, a `SECURITY.md` decision on page content leaving the device, and a new RPC
      so the VM host can execute a program rather than a named workflow.

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
