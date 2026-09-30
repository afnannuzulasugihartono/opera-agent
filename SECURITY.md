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
