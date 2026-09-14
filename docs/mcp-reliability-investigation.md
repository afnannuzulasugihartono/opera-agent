# Persistent MCP reliability investigation

Date: 2026-09-14. Baseline: `fcbec8943117ac4a2f1be1de2b9fe0bfd7239ac0`.
Status: **PERSISTENT_MCP_BLOCKED**. Investigation/diagnostics only; not a
connection-recovery implementation or acceptance. Checkpoint 8D remains open.

## Observed architecture

```text
ChatGPT/Codex host tool catalog and OAuth client (outside this repository)
  -> HTTPS stateless Streamable HTTP MCP Edge Function
  -> authenticated service-role enqueue/await RPCs
  -> durable Supabase commands
  <- extension HTTP long-pull + bounded completion retry
  -> named Opera primitives
```

There is no production local relay process, WebSocket, EventSource, or stdio
server in this path. The loopback OAuth test listener is not the browser relay.
The MCP handler constructs its server/transport for each authenticated POST,
uses JSON responses, and does not allocate persistent MCP session IDs. It returns
405 for non-POST transport requests. Tools are registered independently of whether
the browser is paired. Gating discovery on browser readiness would make browser
outages unnecessarily remove discovery availability.

The extension already has one single-flight pull loop (`loopPromise`), a generation
counter, 250 ms to 5000 ms retry backoff, an 8-second heartbeat request, a 30-second
wake alarm, persisted pairing config, and module-start/startup recovery. It lacks
jitter and checks generation only at the loop boundary. Heartbeat status writes
also do not carry generation. READY presently means a successful relay response,
not that a host has registered tools or that pending completion has settled.

## Evidence gathered

- Live, unauthenticated read-only probes: MCP `/health` 200 in 3317 ms;
  protected-resource metadata 200 in 1303 ms; unauthenticated `tools/list` POST
  denied with 401 in 2122 ms. These are reachability/auth-denial evidence only,
  not authenticated discovery or extension health.
- This assistant's available tool metadata contains no callable Opera Agent
  browser tool. We did not observe the user's host configuration/UI in this run;
  this absence does not prove an enabled connection was lost or identify why.
- Deterministic local simulation of the actual extension `pullLoop` function:
  hold generation-0 pull pending, invalidate to generation 1, then resolve old
  pull with no command. The old callback writes `ready` under generation 1.
  No browser action or real network call occurred in this simulation. This proves
  a status-generation defect, not the cause of missing host namespace.
- Existing MCP tests: 14/14 PASS. New diagnostics tests: 3/3 PASS.
- Full `npm test`: 310/310 PASS, zero skips, 55884.9984 ms. `npm run check`
  PASS (1.6.0 / 26 primitives); `git diff --check` PASS. These are local tests,
  not new exact-head CI, Chromium regression, or real host acceptance.
- New diagnostic CLI without bearer: public health 200 in 3228 ms, followed by
  `AUTHENTICATED_DISCOVERY_UNTESTED`, as designed. No credential was used.

## Ownership of recovery

| Layer | Repository control | What remains unknown |
| --- | --- | --- |
| Extension/bridge | pull lifecycle, heartbeat, state and retries | actual SW restart/idle recovery latency |
| MCP server | POST discovery/call responses and OAuth metadata | authenticated discovery during reported outage |
| Host | no host connection manager or registry code here | whether connection is enabled/selected, why namespace disappeared, dynamic rediscovery behavior |

OpenAI documents manual metadata Refresh after server metadata changes. That is
not evidence that every transient outage requires Refresh, nor proof that this
particular incident is a metadata-cache defect. Official Codex docs describe
startup discovery timeouts and optional-server catalog grace; those settings have
not been inspected or changed in the user's environment.

Sources:
[ChatGPT connect/test and metadata refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt),
[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Safe diagnostics now available

Run `node scripts/mcp-connection-diagnostics.mjs`. Without an explicitly supplied
`OPERA_AGENT_DIAGNOSTIC_BEARER` environment variable it checks public health only
and reports authenticated discovery UNTESTED. Do not paste credentials into chat,
command-line arguments, files, or logs. The script does not retrieve stored tokens.

With a legitimate memory/environment-supplied bearer it performs initialize,
initialized notification, tools/list, and only `browser_status`. It passes the
negotiated protocol header, bounds requests to 10 seconds and responses to 64 KiB,
rejects redirects, and emits whitelisted stage/status/latency metadata only.
Direct success explicitly does not claim the ChatGPT/Codex tool catalog is ready.
There are no navigation, input, pairing, enrollment, or transaction calls.

## Next bounded reliability subplan

1. Obtain authenticated direct discovery and host execution diagnostics during
   the SAME reported outage; compare with host tool availability without Refresh.
   Use user-driven OAuth or an existing explicitly authorized credential source,
   never extract/forge a bearer. Root cause remains UNRESOLVED until this evidence.
2. Approve a separate reliability/release subplan before changing extension bytes
   or the locked public MCP runtime. This follows the current frozen Milestone 8
   plan; do not move transaction work into 8F or change signing identity.
3. Tests-first extension hardening: generation checks after awaited boundaries,
   cancellation of superseded pull requests, generation-bound heartbeat updates,
   jittered bounded backoff, one connection authority, and redacted transition
   telemetry. Never retry browser mutation merely to heal a connection.
4. Test relay failure/recovery, 20 concurrent wake/request triggers, stale callbacks,
   pairing restoration after worker restart, multi-minute idle, and actual latency.
   There is no local production relay to kill; fault injection targets bridge HTTP.
5. Only if authenticated MCP lifecycle evidence identifies a server defect, make
   its minimal contract-preserving fix through the separately reviewed runtime
   boundary. Do not add SSE/session storage merely to imitate a different design.
6. Verify unchanged-input tools in the real host without refresh after each fault.
   If host behavior blocks recovery, retain exact host/server evidence and report
   the limitation; never fake host re-registration or automate page reload.

## Unmet acceptance

No real relay/extension/transport restart, 20-request reconnect-storm test,
multi-minute idle, browser recovery latency, or same-conversation no-refresh
acceptance was performed. Network-failure/redaction/size-bound diagnostics unit
tests do not substitute for those tests. No self-healing fix is deployed. Recovery
time is **UNMEASURED**; health-request timings are not recovery timings.

Production flags, database, OAuth, extension/MCP source, signing, pairing and CRX
were not changed. No 8D acceptance or 8E start is implied by this investigation.
