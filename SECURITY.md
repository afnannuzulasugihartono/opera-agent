@last-edited: 2026-10-22 UTC+7.
@related: [`docs/security.md`](docs/security.md) - [`README.md`](README.md) - [`AGENTS.md`](AGENTS.md)

# Security

Opera Agent can interact with a local browser, and a local browser is the most
trusted thing on a person's machine. The whole model is that the extension
exposes a small allowlist of generic primitives, and everything site-specific
lives server-side where it can be reviewed and updated without touching the
installed extension.

## The boundary

| Question | Answer |
| --- | --- |
| What may the extension do? | The primitives in [`extension/lib/protocol.js`](extension/lib/protocol.js), and nothing else. |
| Where does site-specific behaviour live? | Server-side workflows in [`supabase/functions/`](supabase/functions/), which hot-update independently. |
| Where do credentials live? | GitHub Secrets and the project's secret store, never the repository. |
| What is never read or typed? | Passwords, PINs, OTP and 2FA codes, CVV, and any security-code field. |
| What is the full policy? | [`docs/security.md`](docs/security.md) |

The rules that hold it, the gates that prove it, and the operator procedure for
a real device are in [`docs/security.md`](docs/security.md). This page is the
short version GitHub shows on the security tab.

## Supported versions

Only the latest patch of the current minor line receives security fixes: 1.6.x is
supported, anything below it is not. The version in
[`extension/manifest.json`](extension/manifest.json) is the source of truth.

## Reporting a vulnerability

- Do not open a public issue.
- Report privately via the repository Security tab (Report a vulnerability) or direct
  contact with the maintainer.
- Include: affected version, reproduction steps, and impact.
- Acknowledgement within 5 business days, and a critical fix or mitigation within 30
  days. Both targets are proposed, and the owner may adjust them during review.
