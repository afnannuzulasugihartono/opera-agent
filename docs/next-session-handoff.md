# Opera Agent next-session handoff

Last synchronized: 2026-09-15.

## Current boundary

The user asked to solve recurring ChatGPT custom-MCP failure in ordinary Chat,
especially `FORBIDDEN: This conversation does not support developer MCPs`, without
requiring Work-mode quota or routinely forcing a fresh conversation.

Reliability work is isolated on branch `fix/chat-control-fallback`, cut from exact
Milestone-8 head `80e44483f2cdba400681dc6279522d0d55d24c98`.
Do **not** merge it into `feat/semantic-runtime-1.6.0` casually while 8D is open.
Milestone 8 remains: 8A-8C accepted, **8D IN PROGRESS**, 8E not started.

Read first:

- `AGENTS.md`
- `docs/project-context.md`
- `docs/chat-control-fallback.md`
- `docs/mcp-reliability-investigation.md`
- `tests/fixtures/chat-control-fallback-v1.json`
- `tests/chat-control-fallback.test.mjs`

## Root-cause classification

The conversation failure is not proven to originate in Opera Agent. Strong
upstream evidence points to ChatGPT host/router eligibility:

- OpenAI public issue `openai/openai-apps-sdk-examples#230` reproduces a custom MCP
  working repeatedly then becoming `FORBIDDEN` in the same conversation while its
  backend remains healthy.
- OpenAI public issue `#235` reproduces native apps such as GitHub and a custom
  Developer MCP becoming mutually exclusive in one standard Chat conversation;
  reports reproduce the same pattern with Gmail.
- A minimal report in that discussion used the official MCP TypeScript SDK,
  stateless HTTPS, two tools, and no OAuth, so OAuth/tool count/statefulness cannot
  be a universal cause of the whole failure class.
- Official MCP TypeScript SDK docs explicitly support stateless Streamable HTTP;
  converting Opera Agent to stateful MCP is not a justified host-router repair.
- OpenAI's current Developer Mode docs describe full write-capable MCP as beta for
  Business/Enterprise/Edu and frozen tool snapshots until refreshed. Snapshot drift
  can explain individual stale-tool errors but not an already-working conversation
  becoming globally Developer-MCP-ineligible.

Do not redeploy/restart Opera Agent merely because a conversation returns this
host-level `FORBIDDEN` error.

## Final operational solution

`opera-agent-mcp` is an adapter in front of the existing durable Supabase command
queue. The same browser runtime can be driven directly from ordinary Chat through
the connected Supabase connector:

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

This does not create a second browser controller and does not change extension
bytes, pairing, signing, protocol, public MCP schema, production DB shape, or
Milestone-8 transaction policy.

### Default routing rule

**In ordinary Chat that also needs native/connected apps such as GitHub or
Supabase, use the Supabase-backed Opera path as PRIMARY. Do not invoke the custom
Developer MCP first merely because it is visible.**

Reason: upstream issue #235 shows custom-MCP-first use can lock the standard
conversation away from the native-app family. Waiting for `FORBIDDEN` and only
then trying to recover through Supabase is therefore weaker than avoiding the
known trigger entirely.

Use typed custom MCP in a dedicated Opera-only chat, when the user explicitly asks
to take that host risk, or in another mode whose custom-MCP eligibility is already
proven. Work mode is optional rather than a dependency.

### Critical connector rule

Enqueue and await are two separate connector calls. Never combine them in one SQL
statement/transaction: the extension must see the committed queued row before the
await begins.

For browser control, restrict connector use to:

- `select public.opera_enqueue(...)`;
- `select public.opera_await(...)`;
- `select public.opera_await_capture(...)` for captures;
- narrowly scoped read-only relay/device health queries when diagnosing transport.

Do not use this browser path for arbitrary DML/DDL, generic SQL/RPC execution,
direct command/result-table writes, pairing/device-token operations, secret
inspection, `opera_complete_command`, or credential retrieval.

Keep the same browser policy as MCP: background-first, explicit tab IDs, no silent
foreground activation, and no password/OTP/payment entry, upload, publish,
purchase, send, or destructive action without explicit user instruction.

## Live evidence completed

On 2026-09-15, from ordinary Chat and without invoking the custom Opera Agent MCP
namespace, connected Supabase completed these end-to-end browser probes:

- `browser.ping`: PASS, Opera Agent 1.6.0 / protocol 1, 447 ms;
- `tabs.list`: PASS, 710 ms; raw user tab data not persisted;
- background `tabs.open` for `https://example.com`: PASS, 2635 ms;
- `page.read` on that exact temporary tab: PASS, 718 ms;
- exact temporary-tab cleanup: PASS, 620 ms;
- second background open: PASS, 978 ms;
- `page.capture` + `public.opera_await_capture`: PASS, 2254 ms, bounded 320x161
  JPEG / 1193 encoded bytes;
- second exact temporary-tab cleanup: PASS, 1428 ms.

This proves ordinary structured browser results and the bounded screenshot-result
path both work through normal Chat -> Supabase -> durable queue -> extension ->
Opera -> result queue -> Chat.

## Frozen fallback contract

`tests/fixtures/chat-control-fallback-v1.json` maps the locked 18 public MCP tools to
the existing named Opera methods and bounded timeouts, including the special
`public.opera_await_capture` path for `capture_page`.

`tests/chat-control-fallback.test.mjs` verifies:

- exact coverage/order against `tests/fixtures/mcp-contract-v1.json`;
- only existing allowlisted browser methods;
- bounded timeouts;
- no generic SQL/shell/JavaScript/secret/pair escape path;
- no invented WebSocket/EventSource/stdio/localhost transport;
- no direct completion or pairing operation.

No MCP runtime or extension source changed on this reliability branch.

## Exact next work on this side branch

1. Resolve the exact current branch HEAD from GitHub; do not trust an older chat SHA.
2. Check **exact-head CircleCI**. Required tests must be green before calling the
   side branch validated. Vercel status is separate.
3. If CircleCI is red, inspect the exact failing job/log and repair only the
   deterministic reliability test/docs problem. Do not alter browser/MCP runtime to
   chase a host-router symptom.
4. If CircleCI is green, keep this as a reviewed reliability side branch. Do not
   merge it into active 8D until doing so is compatible with one-writer/exact-head
   milestone governance.
5. Ordinary mixed-app Chat should immediately use the Supabase-backed Opera path;
   do not wait for a custom MCP failure first.

## MCP-specific investigation remains optional

For a future same-outage proof, if needed:

1. observe custom MCP `FORBIDDEN`;
2. confirm Supabase-backed `browser.ping` succeeds;
3. check public MCP health;
4. only with an already-authorized bearer source, perform authenticated direct MCP
   initialize/tools-list/browser-status diagnostics;
5. if direct MCP works while ChatGPT invocation remains `FORBIDDEN` and no request
   reaches the service, classify host invocation-router failure.

Never extract stored credentials or ask the user to paste a bearer/token into chat.
This investigation is not a prerequisite for ordinary Opera control anymore.

## Milestone 8 continuation

Canonical milestone branch: `feat/semantic-runtime-1.6.0`.
Exact candidate before the side branch:
`80e44483f2cdba400681dc6279522d0d55d24c98`, with required CircleCI green.

Latest verified production 8D baseline remained policy OFF, legacy gate false,
agent commit false, operator unowned/host false, synthetic rows zero;
`opera-agent-transactions-8d` was ACTIVE v18/JWT-required with reviewed hash pin.
The reliability work did not mutate 8D production state.

The one-click local PKCE launcher remains on the milestone branch. Loopback PKCE
at `127.0.0.1:6276` is inherently local; ChatGPT cloud cannot bind the user's
localhost. After PKCE, continue the remaining 8D cloud matrix exactly as documented
in `docs/project-context.md` and checkpoint records. Do not start 8E until final
independent 8D PASS.
