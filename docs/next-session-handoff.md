# Opera Agent next-session handoff

Last synchronized: 2026-09-15.

## Current task boundary

The user asked to solve the recurring ChatGPT custom-MCP failure in ordinary Chat,
especially `FORBIDDEN: This conversation does not support developer MCPs`, without
requiring Work mode quota or forcing a fresh conversation.

This work is isolated on branch `fix/chat-control-fallback`, cut from exact
Milestone-8 branch head `80e44483f2cdba400681dc6279522d0d55d24c98`.
Do **not** merge it into `feat/semantic-runtime-1.6.0` merely for convenience while
8D is still open. Milestone 8 remains: 8A-8C accepted, **8D IN PROGRESS**, 8E not
started.

Read first:

- `AGENTS.md`
- `docs/project-context.md`
- `docs/chat-control-fallback.md`
- `docs/mcp-reliability-investigation.md`
- `tests/fixtures/chat-control-fallback-v1.json`
- `tests/chat-control-fallback.test.mjs`

## Root-cause classification

The custom-MCP conversation failure is not currently proven to originate in Opera
Agent. Strong upstream evidence points to a ChatGPT host/router problem:

- OpenAI public issue `openai/openai-apps-sdk-examples#230` reproduces a custom MCP
  working repeatedly and then becoming `FORBIDDEN` in the same conversation while
  the MCP backend remains healthy.
- OpenAI public issue `#235` reproduces native apps such as GitHub and a custom
  Developer MCP becoming mutually exclusive in one standard Chat conversation;
  issue comments reproduce the same symptom with Gmail.
- A separate minimal custom MCP reproduction in that discussion used the official
  TypeScript SDK, stateless HTTPS, and no OAuth, so OAuth cannot explain the whole
  failure class.
- Official MCP TypeScript SDK documentation explicitly supports stateless
  Streamable HTTP; converting Opera Agent to stateful MCP is therefore not a
  justified repair for this host-level symptom.
- OpenAI's current Developer Mode documentation says full write-capable MCP is beta
  for Business/Enterprise/Edu and that MCP tool definitions can be frozen snapshots
  until refreshed. Snapshot drift can explain individual stale-tool errors but not
  an already-working conversation becoming globally Developer-MCP-ineligible.

Do not redeploy/restart Opera Agent merely because a conversation returns this
host-level `FORBIDDEN` error.

## Operational solution: normal-Chat fallback

The key architecture fact is that `opera-agent-mcp` is only an adapter in front of
an existing durable Supabase command queue. The MCP server already translates its
18 public browser tools into `public.opera_enqueue(...)` followed by
`public.opera_await(...)`; `page.capture` uses `public.opera_await_capture(...)`.

A connected Supabase connector can therefore drive the **same** browser execution
path directly from normal Chat when the custom MCP binding is unavailable:

```text
Normal Chat
  -> Supabase connector
  -> public.opera_enqueue
  -> durable opera_commands queue
  -> paired Opera Agent extension
  -> named browser primitive
  -> public.opera_await / public.opera_await_capture
  -> Normal Chat
```

This is not a second browser runtime and does not change extension bytes, pairing,
signing, protocol, public MCP schema, or production database shape.

### Critical connector rule

Enqueue and await are two separate connector calls. Do not combine them into one
SQL statement/transaction: the extension must be able to see the committed queued
row before the await begins.

For browser fallback, connector use is operationally restricted to:

- `select public.opera_enqueue(...)`;
- `select public.opera_await(...)`;
- `select public.opera_await_capture(...)` for capture results;
- narrowly scoped read-only health/status queries when diagnosing transport.

Do not use this fallback for arbitrary DML/DDL, generic SQL/RPC execution, direct
command/result table writes, pairing/device-token operations, secret inspection,
`opera_complete_command`, or credential retrieval.

Keep the same browser policy as MCP: background-first, explicit tab IDs, no silent
foreground activation, and no password/OTP/payment entry, upload, publish,
purchase, send, or destructive action without explicit user instruction.

## Live evidence already completed

On 2026-09-15, from a normal Chat session and without invoking the custom Opera
Agent MCP namespace, the connected Supabase project completed these end-to-end
browser probes:

- `browser.ping`: PASS, Opera Agent 1.6.0 / protocol 1, 447 ms total;
- `tabs.list`: PASS, 710 ms total;
- bounded background `tabs.open` for `https://example.com`: PASS, 2635 ms;
- `page.read` on that exact temporary tab: PASS, 718 ms;
- `tabs.close` cleanup of only that temporary tab: PASS, 620 ms.

Raw user tab contents were intentionally not persisted in repository documentation.
The temporary test tab was closed.

This proves the browser path can remain healthy and usable from normal Chat even
when ChatGPT's custom-MCP invocation binding is unavailable.

## Frozen fallback contract

`tests/fixtures/chat-control-fallback-v1.json` maps the locked 18 public MCP tools to
the existing named Opera methods and bounded timeouts. It also pins
`public.opera_await_capture` for `capture_page`.

`tests/chat-control-fallback.test.mjs` verifies:

- exact coverage/order against `tests/fixtures/mcp-contract-v1.json`;
- only existing allowlisted browser methods;
- bounded timeouts;
- no generic SQL/shell/JavaScript/secret/pair escape path;
- no invented WebSocket/EventSource/stdio/localhost transport;
- no direct completion or pairing operations.

No MCP runtime or extension source was changed by this reliability branch.

## Exact next work on this side branch

1. Verify the latest exact branch HEAD after this handoff commit.
2. Wait for/check exact-head CircleCI. Required test gate must be green; unrelated
   Vercel build-rate-limit failures do not substitute for CircleCI.
3. If CircleCI is red, inspect the exact failing job/log and repair only the
   deterministic fallback test/docs issue. Do not change Opera runtime to chase a
   host-router symptom.
4. If CircleCI is green, keep this branch as a reviewed reliability side branch;
   do not merge into the active 8D milestone branch until doing so is compatible
   with the one-writer/exact-head milestone boundary.
5. For ordinary user browser work, prefer typed custom MCP while it works. On
   conversation-level Developer-MCP `FORBIDDEN`, immediately use the documented
   Supabase fallback. Work mode and a fresh chat are no longer operational
   requirements for browser control.

## Remaining MCP-specific investigation (optional, not a blocker for user work)

To prove the upstream boundary even more strongly during a future same-outage
incident:

1. observe custom MCP `FORBIDDEN`;
2. run fallback `browser.ping` and confirm browser path healthy;
3. check public MCP health;
4. only with an existing explicitly authorized bearer source, perform authenticated
   direct MCP initialize/tools-list/browser-status diagnostics;
5. if direct MCP succeeds while ChatGPT invocation remains `FORBIDDEN` and no MCP
   request reaches the service, classify it as host invocation-router failure.

Never extract stored credentials or ask the user to paste a bearer/token into chat.

## Milestone 8 continuation

The canonical milestone branch remains `feat/semantic-runtime-1.6.0`; the latest
8D candidate before this side branch was `80e44483f2cdba400681dc6279522d0d55d24c98`
with exact-head CircleCI success. Production 8D state was clean/off and no browser
mutation is authorized by 8D. Return to the authoritative 8D records in
`docs/project-context.md` and the milestone acceptance documents before continuing
8D. Do not start 8E until final independent 8D acceptance.
