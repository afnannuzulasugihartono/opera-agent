# Security

Opera Agent can interact with a local browser and therefore uses a strict allowlisted command model.

## Security principles

- No arbitrary `eval` or remote code execution.
- Browser actions must use known, validated primitives.
- Passwords, PINs, OTP/2FA codes, CVV/CVC, and security-code fields remain blocked.
- File uploads remain blocked unless explicitly designed and reviewed later.
- Private extension signing keys must never be committed to the repository.
- Production secrets belong in secure secret storage, not source code.
- Commands should be auditable and bounded by timeouts and payload limits.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.6.x   | :white_check_mark: |
| < 1.6   | :x:                |

Only the latest patch of the current minor line receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Report privately via the repository
Security tab (Report a vulnerability) or direct contact with the
maintainer. Include: affected version, reproduction steps, and impact.

Proposed response targets: acknowledgement within 5 business days,
critical fix or mitigation within 30 days. These targets are proposed
for owner adjustment during review.

## Token transport

The gateway accepts device tokens via header (`x-opera-agent-token`,
`Authorization: Bearer`) or `body.apiKey` because GPT Actions cannot
set custom headers (platform limitation, not a choice). Query tokens
are confined to the read-only `/openapi.json` and `/health` surfaces.
Tokens are verified then dropped: regression tests pin that they never
appear in logs, error payloads, or persisted records.

> **Correction (2026-10-02).** The "query tokens are confined to the read-only
> surfaces" sentence above is wrong and is preserved only as history. No gateway
> route reads the query string: `extractToken` checks the two headers and then
> `body.apiKey`, and there is no `searchParams` read anywhere in the function. So
> `?apiKey=` is **not** a token carrier on any route, and the carriers are exactly
> the three listed. `tests/api-docs.test.mjs` pins the carrier set inside
> `extractToken`, so a query-string carrier added there fails CI. It does not see
> a carrier reached through a helper function or read by a route handler outside
> `extractToken`; those remain covered by review, not by the test.
