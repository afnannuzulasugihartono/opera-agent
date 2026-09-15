# Chat control fallback (MCP-independent)

Status: **PROVEN LIVE** on 2026-09-15. This is the reliable normal-Chat control
path when ChatGPT custom Developer-MCP eligibility is unavailable or when the
conversation also needs native/connected apps such as GitHub or Supabase.

It does **not** change extension bytes, the public MCP contract, pairing, signing,
protocol version, or the browser runtime. It reuses the same durable Supabase
command queue that the MCP server already uses.

## Why this exists

Two upstream ChatGPT issues reproduce the relevant host-side failure pattern:

- `openai/openai-apps-sdk-examples#230`: a custom MCP can work repeatedly and then
  become forbidden in the same conversation while the MCP backend remains healthy.
- `openai/openai-apps-sdk-examples#235`: a native app such as GitHub and a custom
  Developer MCP can become mutually exclusive in one standard Chat conversation.

The repository cannot patch ChatGPT's invocation router. Therefore the reliable
solution is to remove custom-MCP availability from the critical browser-control
path. In mixed-app ordinary Chat, use this Supabase-backed path **before** invoking
the custom Developer MCP so a custom-MCP-first lockout cannot remove the native
connector needed for recovery. The typed custom MCP remains useful in a dedicated
Opera-only chat, when explicitly requested, or in another host mode whose MCP
eligibility has already been proven.

## Architecture

```text
Normal Chat
  -> Supabase connector
  -> public.opera_enqueue(...)
  -> existing durable opera_commands queue
  -> paired Opera Agent extension
  -> named browser primitive
  -> public.opera_await(...) / public.opera_await_capture(...)
  -> Normal Chat
```

The custom MCP path remains:

```text
ChatGPT custom MCP
  -> opera-agent-mcp
  -> the same opera_enqueue/opera_await queue
  -> the same extension
```

Both paths therefore converge before browser execution. The fallback does not
create a second browser controller.

## Frozen mapping

Machine-readable mapping:

`tests/fixtures/chat-control-fallback-v1.json`

It must cover the locked 18-tool MCP surface exactly and map only to the existing
named internal methods. `tests/chat-control-fallback.test.mjs` enforces that
contract and rejects generic SQL/shell/JavaScript/pairing escape hatches.

Parameter transforms must remain equivalent to
`supabase/functions/opera-agent-mcp/index.ts`. In particular, the fallback must
preserve background-first defaults, explicit `tabId` targeting, trusted element
input, bounded timeouts, and foreground permission semantics.

## Connector protocol

Use two separate connector calls for each browser primitive.

First enqueue the named method with an opaque unique request id:

```sql
select public.opera_enqueue(
  '<allowlisted.method>',
  '<json params>'::jsonb,
  <bounded timeout ms>,
  'opera',
  '<opaque unique request id>'
) as result;
```

Then, after the enqueue call has committed, await the returned command UUID:

```sql
select public.opera_await('<command uuid>'::uuid, <bounded wait ms>) as result;
```

For `page.capture`, use `public.opera_await_capture` instead so screenshot bytes
follow the existing bounded capture path.

**Do not combine enqueue and await into one SQL statement/transaction.** The
extension must be able to observe the committed queued row before the await begins.

## Strict connector boundary

For browser-control fallback, the Supabase connector is restricted operationally
to these fixed calls:

- `select public.opera_enqueue(...)`;
- `select public.opera_await(...)`;
- `select public.opera_await_capture(...)` for captures;
- narrowly scoped read-only health/status queries when diagnosing the relay.

Do not use fallback access for arbitrary DML/DDL, generic RPC invocation, secret
inspection, pairing, device-token handling, `opera_complete_command`, or direct
writes to command/result tables. Do not retrieve or expose service-role keys,
pairing tokens, OAuth tokens, passwords, OTPs, payment data, or private signing
material.

Browser policy remains identical to the MCP instructions: ordinary automation is
background-first; never silently activate a tab; never substitute the active tab
for an explicit target; never enter passwords/OTPs/payment data or upload/publish/
purchase/send/delete without the user's explicit instruction.

## Live acceptance evidence (2026-09-15)

The fallback was exercised from a normal Chat session through the connected
Supabase project while the local extension was online:

1. `browser.ping` completed end-to-end through the queue in 447 ms total and
   reported Opera Agent 1.6.0 / protocol 1.
2. `tabs.list` completed in 710 ms, proving read-only browser observation without
   the custom MCP namespace. Raw user tab contents are intentionally not recorded
   here.
3. A bounded mutation/read/cleanup probe opened `https://example.com` in a new
   **background** tab, read the page through `page.read`, and closed only that
   temporary tab. Observed command totals were 2635 ms, 718 ms, and 620 ms.
4. A second bounded background probe verified the special capture result path:
   `tabs.open` PASS (978 ms), `page.capture` + `public.opera_await_capture` PASS
   (2254 ms, bounded 320x161 JPEG / 1193 encoded bytes), then exact temporary-tab
   cleanup PASS (1428 ms). Screenshot bytes are not persisted in repository docs.
5. No custom Opera Agent MCP invocation was used for any of these probes.

This proves that browser control itself, Supabase durable transport, pairing, the
extension, ordinary result delivery, and the bounded screenshot result path can
remain operational even when ChatGPT's custom-MCP invocation binding is
unavailable.

## Failure classification

When custom MCP fails:

1. If this fallback `browser.ping` succeeds, classify the incident as
   **MCP_HOST_PATH_FAILED / BROWSER_PATH_HEALTHY**. Continue through the fallback;
   do not redeploy the MCP or extension merely to chase a ChatGPT routing error.
2. If enqueue succeeds but await times out, diagnose the extension/queue path.
3. If enqueue itself fails, diagnose Supabase/device state before browser work.
4. If both custom MCP and this fallback are unavailable, stop and report the
   exact failing boundary rather than guessing.

## Operational decision

For **ordinary Chat that also uses GitHub/Supabase/other native connectors, this
fallback is the default Opera control path**. Do not invoke the custom Developer MCP
first merely because it is available: upstream evidence shows doing so can lock the
conversation to one app family and prevent recovery with the native connector.

Use the typed custom MCP in a dedicated Opera-only chat, when the user explicitly
requests it despite the host risk, or in another mode where its eligibility is
known to persist. Work mode is not required for normal Opera Agent browser control.
