@last-edited: 2026-10-05 01:10 UTC+7.
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
- [ ] A landing page for Opera Agent: OAuth sign-in for MCP, a model provider picker, and
      the device pairing code. It is never a place where a shared model key is issued; the
      key is entered on the user's own device. New top-level entry, so it needs the owner's
      call on host and path, and it is also where the store listing link lives.
- [ ] An end-to-end artefact run: ask an assistant for a Word document, the document
      exists. Blocked on Google credentials in the live suite, not on the runtime.
- [ ] Hand a compiled plan to the device. `lib/goal-plan.js` is the gate and
      `buildPlanRequest` is the prompt; both proven, neither wired. The endpoint, key and
      model name come from the user's own configuration on their device, never from ours,
      because the product is distributed at scale. Needs a `SECURITY.md` decision and a new
      RPC so the VM host can execute a program rather than a named workflow.
- [ ] Mass distribution. Chrome Web Store listing and its review, a privacy policy that
      says plainly what leaves the device and to where, per-device pairing that can be
      revoked one device at a time, and a rate limit on pairing. The store will ask about
      both the user-configured model endpoint and any host permission the landing page
      takes.
- [ ] Bind a device to an account. The MCP server already authenticates with Supabase Auth
      and an allowlist of user ids or emails; pairing is still a bare code. Mass production
      wants "this device belongs to this account", which is a schema change and therefore
      production DB shape. The allowlist also has to become a policy: open sign-up, or a
      plan.

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
