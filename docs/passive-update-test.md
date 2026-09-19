# Passive update validation

Baseline started: 2026-09-08 14:42 WIB (2026-09-08T07:42Z).

Current installed production baseline:

- Opera Agent 1.0.1
- protocol 1
- extension ID `pagjlnohdemoohcncicjmaejedcmcocm`
- device `opera` online with 23 capabilities

## Phase A — passive polling

The production `opera-agent-update` Edge Function now records minimal update-request telemetry in `public.opera_update_events` for only two request kinds: `update_xml` and `crx`.

Stored fields are request time, request kind, GET/HEAD method, path/query, served release version/checksum, User-Agent, and Accept header. IP addresses are intentionally not stored.

Telemetry self-test event uses User-Agent `Opera-Agent-Telemetry-SelfTest/1` and must be excluded from passive-poll conclusions.

Success for Phase A means a later `update_xml` request appears without the user pressing the Extensions-page Update button and without our self-test User-Agent.

## Phase B — passive installation

A real higher-version CRX signed by the same original private key is required to prove automatic installation. Do not replace the signing identity: changing the key changes the extension identity and invalidates the continuity test.

Until the original signing key is available for the next patch, keep 1.0.1 as the active release and use Phase A to measure whether Opera autonomously polls the configured `update_url`.
