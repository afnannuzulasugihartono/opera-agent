# Testing

Opera Agent uses layered tests so browser-core changes are not promoted based only on unit tests.

## Local/static

```bash
npm test
npm run check
```

These cover protocol validation, workflow DSL invariants, manifest constraints, forbidden remote code patterns, sensitive-field protections, and server/extension allowlist consistency.

## Chromium extension regression

```bash
python tests/browser_extension_test.py
```

The regression suite launches a real Chromium extension profile and validates:

- extension startup
- page query/read
- explicit semantic reads beyond the legacy 2,400-character cap
- trusted debugger click
- ARIA state change after trusted input
- normal field fill
- password protection
- file upload protection
- network/reconnect behavior
- full browser restart/reconnect behavior

The 1.0.0 test run returned more than 7,500 characters from an explicit semantic read and passed all listed checks.

## Cloud integration

Cloud acceptance includes:

- `system.self_test`
- pairing lifecycle
- queue claim/complete/await
- idempotency
- workflow validation against the method allowlist
- workflow versioning and rollback
- cleanup of synthetic test devices

## Distribution/update

The signed CRX3 release endpoint is checked for XML validity, HTTPS codebase URL, release hash consistency, content type, and exact content length. A managed Chromium profile successfully self-updated a signed Opera Agent prerelease from `0.9.0` to `0.9.1` through the self-hosted update manifest.

## Target Opera acceptance

Before marking a browser-core release complete, also verify the user's actual Opera installation can install/pair, execute browser primitives, recover after restart, and—where browser policy permits—consume the self-hosted signed update channel.
