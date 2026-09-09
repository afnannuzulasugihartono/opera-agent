# Testing

Opera Agent uses layered tests so browser-core or orchestration changes are not promoted based only on unit tests.

## Local/static

```bash
npm test
npm run check
```

These cover protocol validation, workflow DSL invariants, manifest constraints, forbidden remote code patterns, sensitive-field protections, server/extension allowlist consistency, efficiency workflow structure, adaptive read continuation, and fast-start/idle polling guardrails.

## Efficiency regression

`tests/efficiency.test.mjs` protects the performance design from accidental regressions. It verifies that:

- the bridge keeps a short 50 ms fast-start window but returns to the 250 ms idle interval;
- long-text workflows use 12k chunks plus `hasMore` / `nextOffset` continuation;
- content readiness uses internal `content.ping`, not semantic `page.read`;
- text-only reads omit interactive elements while the default remains compatible;
- workflow telemetry remains bounded and metadata-only;
- YouTube recommendation handling does not enter the old 600 ms ad loop when no ad exists;
- efficiency migrations do not rewrite/drop legacy history.

Static structure is not enough. For production benchmarks also capture end-to-end workflow queue and total timings before/after deployment. See [efficiency.md](efficiency.md).

## Chromium extension regression

```bash
python tests/browser_extension_test.py
```

On Windows, the test defaults to headed mode because the bundled Chromium service worker is not reliably started in headless mode. To exercise installed Opera explicitly:

```powershell
$env:OA_BROWSER_EXECUTABLE='C:\Users\ASUS\AppData\Local\Programs\Opera\opera.exe'
$env:OA_BROWSER_HEADLESS='0'
py -3 tests/browser_extension_test.py
```

The test uses an OS-assigned loopback port and a temporary browser profile; it does not alter the user's normal Opera profile.

The regression suite launches a real Chromium extension profile and validates:

- extension startup;
- page query/read;
- explicit semantic reads beyond the legacy 2,400-character cap;
- 12k text-only reads, continuation, and omission of element payloads;
- already-active/already-current tab fast paths;
- trusted debugger click;
- ARIA state change after trusted input;
- normal field fill;
- password protection;
- file upload protection;
- network/reconnect behavior;
- full browser restart/reconnect behavior.

The 1.0.0 test run returned more than 7,500 characters from an explicit semantic read and passed all listed checks. Browser-core changes continue to require this regression even when server-only workflow tests pass.

## Cloud integration

Cloud acceptance includes:

- `system.self_test`;
- pairing lifecycle;
- queue claim/complete/await;
- idempotency;
- workflow validation against the method allowlist;
- workflow versioning and rollback;
- optimized workflow registration;
- real-device smoke tests after bridge/workflow deployment;
- cleanup of synthetic test devices.

## Distribution/update

The signed CRX3 release endpoint is checked for XML validity, HTTPS codebase URL, release hash consistency, content type, and exact content length. A managed Chromium profile successfully self-updated a signed Opera Agent prerelease from `0.9.0` to `0.9.1` through the self-hosted update manifest, and real Opera later accepted the signed `1.0.0 → 1.0.1` update while preserving extension identity/pairing.

## Target Opera acceptance

Before marking a browser-core release complete, verify the user's actual Opera installation can install/pair, execute browser primitives, recover after restart, and—where browser policy permits—consume the self-hosted signed update channel.

Server-only efficiency deployments do not require replacing the installed CRX, but they still require a live Opera smoke test because they change orchestration timing and workflow definitions.
