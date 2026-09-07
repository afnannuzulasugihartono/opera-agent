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

## Reporting

Security-sensitive findings should not be published in public issue threads until reviewed.
