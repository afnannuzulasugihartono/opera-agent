# Persistent MCP reliability investigation

Date: 2026-09-15. Original baseline: `fcbec8943117ac4a2f1be1de2b9fe0bfd7239ac0`.
Status: **HOST_MCP_UNRESOLVED / NORMAL_CHAT_FALLBACK_PROVEN**. The upstream
conversation-level Developer-MCP failure remains outside this repository, but
normal Chat browser control no longer depends on that host binding when the
connected Supabase connector is available. Checkpoint 8D remains open.

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

## Upstream host evidence

OpenAI's public issue tracker now contains direct reproductions of the same host
failure family:

- `openai/openai-apps-sdk-examples#230` is open and reproduces
  `SUPPORTED -> successful custom MCP calls -> same conversation -> FORBIDDEN`
  while the MCP backend remains healthy.
- `openai/openai-apps-sdk-examples#235` is open and reproduces native GitHub plus a
  custom Developer MCP becoming mutually exclusive in one standard Chat
  conversation. Community reports in that issue reproduce the same pattern with
  built-in Gmail, so it is not GitHub-specific.

OpenAI's current Developer Mode documentation also states that tool definitions
are snapshotted/frozen until refreshed, which can explain individual stale-tool
errors, but that does not explain an entire already-working conversation becoming
Developer-MCP-ineligible. The same documentation describes full write-capable MCP
as a beta focused on Business/Enterprise/Edu, so personal-plan Developer-MCP
behavior must not be treated as a dependable production control plane.

These facts strengthen the classification that conversation-level `FORBIDDEN` can
occur before a request reaches this repository. They do not prove every MCP error
is host-side; direct diagnostics remain necessary for other failure classes.

## Evidence gathered

- Live, unauthenticated read-only probes: MCP `/health` 200 in 3317 ms;
  protected-resource metadata 200 in 1303 ms; unauthenticated `tools/list` POST
  denied with 401 in 2122 ms. These are reachability/auth-denial evidence only,
  not authenticated discovery or extension health.
- An earlier assistant session had no callable Opera Agent namespace. That absence
  alone did not prove host/server cause.
- Deterministic local simulation of the actual extension `pullLoop` function:
  hold generation-0 pull pending, invalidate to generation 1, then resolve old
  pull with no command. The old callback writes `ready` under generation 1.
  No browser action or real network call occurred in this simulation. This proves
  a status-generation defect, not the cause of missing host namespace.
- Existing MCP tests: 14/14 PASS. New diagnostics tests: 3/3 PASS.
- Full `npm test`: 310/310 PASS, zero skips, 55884.9984 ms. `npm run check`
  PASS (1.6.0 / 26 primitives); `git diff --check` PASS. These are historical local
  tests, not the new fallback branch CI.
- Diagnostic CLI without bearer: public health 200 in 3228 ms, followed by
  `AUTHENTICATED_DISCOVERY_UNTESTED`, as designed. No credential was used.

## Proven normal-Chat fallback

`docs/chat-control-fallback.md` defines an MCP-independent control path through the
already-connected Supabase connector and the same durable queue used by MCP.
Machine-readable mapping is frozen in
`tests/fixtures/chat-control-fallback-v1.json` and checked by
`tests/chat-control-fallback.test.mjs`.

Live acceptance from normal Chat on 2026-09-15 succeeded without invoking the
custom Opera Agent MCP:

- direct queue `browser.ping`: PASS, Opera Agent 1.6.0/protocol 1, 447 ms total;
- direct queue `tabs.list`: PASS, 710 ms total; raw tab data intentionally omitted;
- background `tabs.open` of `https://example.com`: PASS, 2635 ms total;
- `page.read` on that exact temporary tab: PASS, 718 ms total;
- cleanup `tabs.close` of only that temporary tab: PASS, 620 ms total.

This is end-to-end evidence across Chat connector -> Supabase queue -> paired
extension -> Opera -> result queue -> Chat. It proves that a custom-MCP host outage
does not need to stop normal-Chat browser control.

Important: enqueue and await must be separate connector calls. Combining them in
one SQL statement/transaction risks hiding the uncommitted queued row from the
extension until the transaction ends.

## Ownership of recovery

| Layer | Repository control | Current conclusion |
| --- | --- | --- |
| Extension/bridge | pull lifecycle, heartbeat, state and retries | browser path proven live through fallback; stale-generation defect remains a separate hardening item |
| MCP server | POST discovery/call responses and OAuth metadata | backend health exists; authenticated same-outage MCP discovery still useful for MCP-specific diagnosis |
| ChatGPT host | conversation app/tool registry and invocation router | upstream `FORBIDDEN` family reproduced publicly; cannot be patched from this repository |
| Normal-Chat fallback | fixed enqueue/await calls over connected Supabase | live PASS; operational bypass for custom-MCP host failure |

OpenAI documents manual metadata Refresh after server metadata changes. That is
not evidence that every transient outage requires Refresh, nor a reason to refresh
or redeploy when the normal-Chat fallback proves the browser path healthy.

Sources:
[OpenAI Developer Mode and MCP apps](https://help.openai.com/articles/12584461),
[Issue #230](https://github.com/openai/openai-apps-sdk-examples/issues/230),
[Issue #235](https://github.com/openai/openai-apps-sdk-examples/issues/235),
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

## Reliability subplan from here

1. Keep the normal-Chat fallback available immediately for user work. Do not force
   Work mode or chat migration merely because the custom MCP becomes forbidden.
2. For MCP-specific root-cause evidence, obtain authenticated direct discovery and
   host execution diagnostics during the SAME reported MCP outage; compare with
   fallback `browser.ping`. Never extract/forge a bearer.
3. Tests-first extension hardening remains valuable: generation checks after
   awaited boundaries, cancellation of superseded pull requests,
   generation-bound heartbeat updates, jittered bounded backoff, one connection
   authority, and redacted transition telemetry. Never retry browser mutation just
   to heal a connection.
4. Test relay failure/recovery, 20 concurrent wake/request triggers, stale callbacks,
   pairing restoration after worker restart, multi-minute idle, and actual latency.
5. Only if authenticated MCP lifecycle evidence identifies a server defect, change
   the locked MCP runtime through a separately reviewed release boundary. Do not
   add stateful sessions merely to imitate another deployment: official MCP SDK
   documentation explicitly supports stateless Streamable HTTP for simple API-style
   servers.
6. Keep MCP host eligibility and browser-path availability as separate acceptance
   claims. A successful fallback is not evidence that ChatGPT repaired the custom
   MCP binding.

## Remaining limitation

The upstream ChatGPT conversation router can still return Developer-MCP
`FORBIDDEN`; this repository cannot make that host accept a custom MCP tool call.
What is now solved is the user's operational requirement: normal Chat can continue
controlling the paired Opera browser through the existing durable command plane
without consuming Work-mode quota or requiring a new conversation.

No transaction policy, production database schema, extension/MCP source, signing,
pairing, CRX, or Milestone 8 runtime was changed by this fallback work. 8D remains
IN PROGRESS; 8E is not started.
