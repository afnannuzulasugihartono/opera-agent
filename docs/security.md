@last-edited: 2026-10-06 11:55 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [runbook.md](runbook.md) - [api.md](api.md)

# Security

> Standard: military-grade correctness, company-grade trust, Apple-grade finish — full freedom, every word binds the agent.

Simplify first, code first, comments second. State what is true now, never its history.

Cover every button on every site, and grow the capability the Goals in [`AGENTS.md`](AGENTS.md) name.


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

- Do not open a public issue.
- Report privately via the repository Security tab (Report a vulnerability) or direct
  contact with the maintainer.
- Include: affected version, reproduction steps, and impact.

- Acknowledgement within 5 business days.
- Critical fix or mitigation within 30 days.
- Both targets are proposed, and the owner may adjust them during review.

## Token transport

The gateway accepts device tokens via header (`x-opera-agent-token`,
`Authorization: Bearer`) or `body.apiKey`, because GPT Actions cannot set
custom headers. No gateway route reads the query string, so `?apiKey=` is not a
token carrier anywhere. Tokens are verified then
dropped: regression tests pin that they never appear in logs, error payloads,
or persisted records, and pin the carrier set inside `extractToken`. Enforced by
[`tests/api-docs.test.mjs`](tests/api-docs.test.mjs). A carrier
reached through a helper function, or read by a route handler outside
`extractToken`, stays covered by review rather than by that test.
