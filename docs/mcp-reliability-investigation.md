# Persistent MCP reliability investigation

Date: 2026-09-15. Original baseline: `fcbec8943117ac4a2f1be1de2b9fe0bfd7239ac0`.
Status: **HOST_MCP_UNRESOLVED / NORMAL_CHAT_CONTROL_PROVEN**. The upstream
conversation-level Developer-MCP failure remains outside this repository, but
ordinary Chat browser control no longer depends on that host binding when the
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

OpenAI's public issue tracker contains direct reproductions of the same host
failure family:

- `openai/openai-apps-sdk-examples#230` is open and reproduces
  `SUPPORTED -> successful custom MCP calls -> same conversation -> FORBIDDEN`
  while the MCP backend remains healthy.
- `openai/openai-apps-sdk-examples#235` is open and reproduces native GitHub plus a
  custom Developer MCP becoming mutually exclusive in one standard Chat
  conversation. Community reports in that issue reproduce the same pattern with
  built-in Gmail, so it is not GitHub-specific.
- A minimal reproduction reported in that discussion used the official MCP
  TypeScript SDK, stateless HTTPS, two tools, and no OAuth. OAuth, a large tool
  catalog, and a particular application backend therefore cannot be universal
  root causes for the whole failure class.

OpenAI's current Developer Mode documentation states that tool definitions are
snapshotted/frozen until refreshed, which can explain individual stale-tool
errors, but that does not explain an entire already-working conversation becoming
Developer-MCP-ineligible. The same documentation describes full write-capable MCP
as beta for Business/Enterprise/Edu; personal-plan Developer-MCP behavior must not
be treated as a dependable production control plane.

Official MCP TypeScript SDK documentation explicitly supports stateless
Streamable HTTP (`sessionIdGenerator: undefined`) for simple API-style servers.
Changing Opera Agent to stateful MCP would add complexity and resumability state
without evidence that it repairs ChatGPT's conversation eligibility router.

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

## Proven normal-Chat control path

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
- cleanup `tabs.close` of only that temporary tab: PASS, 620 ms total;
- second background `tabs.open`: PASS, 978 ms total;
- `page.capture` delivered through `public.opera_await_capture`: PASS, 2254 ms,
  bounded 320x161 JPEG / 1193 encoded bytes;
- second exact temporary-tab cleanup: PASS, 1428 ms.

This is end-to-end evidence across Chat connector -> Supabase queue -> paired
extension -> Opera -> result queue -> Chat. It covers ordinary structured results
and the special bounded screenshot-result path. It proves that a custom-MCP host
outage does not need to stop normal-Chat browser control.

Important: enqueue and await must be separate connector calls. Combining them in
one SQL statement/transaction risks hiding the uncommitted queued row from the
extension until the transaction ends.

## Ownership of recovery

| Layer | Repository control | Current conclusion |
| --- | --- | --- |
| Extension/bridge | pull lifecycle, heartbeat, state and retries | browser path proven live through fallback; stale-generation defect remains a separate hardening item |
| MCP server | POST discovery/call responses and OAuth metadata | backend health exists; authenticated same-outage MCP discovery still useful for MCP-specific diagnosis |
| ChatGPT host | conversation app/tool registry and invocation router | upstream `FORBIDDEN` family reproduced publicly; cannot be patched from this repository |
| Normal-Chat control | fixed enqueue/await calls over connected Supabase | live PASS; operational control plane independent of custom-MCP eligibility |

OpenAI documents manual metadata Refresh after server metadata changes. That is
not evidence that every transient outage requires Refresh, nor a reason to refresh
or redeploy when the normal-Chat path proves the browser path healthy.

Sources:
[OpenAI Developer Mode and MCP apps](https://help.openai.com/articles/12584461),
[Issue #230](https://github.com/openai/openai-apps-sdk-examples/issues/230),
[Issue #235](https://github.com/openai/openai-apps-sdk-examples/issues/235),
[Official MCP TypeScript SDK server transport docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md),
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

## Reliability decision

The initial idea was to keep custom MCP primary and switch to Supabase only after
`FORBIDDEN`. That is insufficient for mixed-app normal Chat because upstream issue
#235 reports a custom-MCP-first conversation can make the native app unavailable,
which could also remove the recovery connector.

Therefore the final operational rule is:

1. **Mixed-app ordinary Chat (GitHub/Supabase/etc.): Supabase-backed Opera control
   is primary. Do not invoke the custom Developer MCP first.** This avoids entering
   the known mutual-exclusion failure mode and preserves the native connector.
2. Dedicated Opera-only Chat: typed custom MCP may be used when desired; if it
   becomes forbidden and Supabase remains available, switch to the fixed fallback.
3. Work mode is optional rather than required; the user's normal browser-control
   workflow does not depend on Work quota.
4. For MCP-specific root-cause evidence, obtain authenticated direct discovery and
   host execution diagnostics during the SAME reported MCP outage; compare with
   fallback `browser.ping`. Never extract/forge a bearer.
5. Tests-first extension hardening remains valuable for actual bridge failures:
   generation checks after awaited boundaries, cancellation of superseded pulls,
   generation-bound heartbeat updates, jittered bounded backoff, one connection
   authority, and redacted transition telemetry. Never retry browser mutation just
   to heal a connection.
6. Only if authenticated MCP lifecycle evidence identifies a server defect, change
   the locked MCP runtime through a separately reviewed release boundary.
7. Keep MCP host eligibility and browser-path availability as separate acceptance
   claims. Successful normal-Chat control is not evidence that ChatGPT repaired
   the custom MCP binding.

## Honest solution rating

- Redeploy/restart MCP on `FORBIDDEN`: **2/10** — upstream evidence shows requests
  may be rejected before the server.
- OAuth refresh changes as the main fix: **3/10** — useful for token-expiry 401s,
  but a no-OAuth minimal MCP reproduces the conversation failure.
- Convert stateless MCP to stateful sessions: **3/10** — official SDK supports
  stateless mode and there is no evidence session state repairs host eligibility.
- Shrink tool catalog only: **5/10** — can reduce schema/snapshot complexity but
  cannot explain the minimal reproductions or native/custom mutual exclusion.
- Work mode: **8/10 technically, unacceptable operationally** for this user because
  it consumes the quota they explicitly want to preserve.
- Fresh-chat recovery: **6/10** — works around state loss but interrupts workflows.
- Custom-MCP-first then fallback: **8.5/10** — browser fallback works, but the first
  custom MCP call can itself trigger native-app mutual exclusion.
- **Native Supabase control as primary in mixed normal Chat, reusing the same
  durable Opera queue: 10/10 for the user's operational requirement.** It has been
  proven end-to-end, preserves the existing browser runtime and safety semantics,
  avoids Work quota, avoids making the upstream Developer-MCP router a dependency,
  and avoids triggering the known custom-vs-native lockout before recovery.

The 10/10 rating is specifically for **continuing reliable Opera Agent control from
normal Chat**. It is not a claim that this repository has patched OpenAI's upstream
conversation router; only OpenAI can fix that host defect itself.

## Remaining limitation

The upstream ChatGPT conversation router can still return Developer-MCP
`FORBIDDEN`; this repository cannot make that host accept a custom MCP tool call.
What is solved is the user's operational requirement: normal Chat can control the
paired Opera browser through the existing durable command plane without consuming
Work-mode quota or requiring the custom Developer-MCP binding.

No transaction policy, production database schema, extension/MCP source, signing,
pairing, CRX, or Milestone 8 runtime was changed by this reliability work. 8D
remains IN PROGRESS; 8E is not started.
