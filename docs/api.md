@last-edited: 2026-10-07 UTC+7.
@related: [AGENTS.md](../AGENTS.md) - [security.md](security.md)

# Gateway API

- Machine source of truth: the live `GET /openapi.json` the gateway serves itself.
- This file is the narrative reference for operators and integrators.
- Drift-pinned by `[tests/api-docs.test.mjs](../tests/api-docs.test.mjs)`, which reads routed paths and error
  codes out of the gateway source and fails when this document stops covering them.
- If this document and the live spec disagree, the live spec wins and the discrepancy
  is a bug worth reporting.

## Base URLs

Project functions root:

```
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1
```

Gateway base (append the routed paths to this):

```
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway
```

- The gateway does not trust the incoming request URL when advertising its own base: the
  hosted proxy rewrites it, so `servers[].url` is derived from the `SUPABASE_URL`
  environment variable, never from the request.
- Callers should always address the base above directly.

## Authentication

- The token is a **device token** for the single fixed device name `opera`.
- There is no device selector in the request; a caller cannot target another device.

The gateway accepts the token in three carriers, checked in this order:

1. `x-opera-agent-token: <device-token>` request header.
2. `Authorization: Bearer <device-token>` request header. The `Bearer ` prefix is
   optional and matched case-insensitively, so a bare token is accepted too.
3. `apiKey` in the JSON request body.

- Why the body carrier: GPT Actions cannot set custom request headers.
- Prefer header carriers: they keep the token out of request bodies that may be logged.

- A fourth path applies only to per-user callers such as the ChatGPT plugin
  OAuth bundle in `landing/chatgpt-plugin/`: when device-token verification
  fails, the gateway verifies the value as a Supabase user JWT with
  `supabase.auth.getUser` (signature plus expiry) and resolves the caller's
  own first non-disabled device by `user_id`, ordered by creation time —
  never by the fixed name — so one account cannot drive another account's
  browser.

- A `?apiKey=` query parameter is **never** read by the gateway: the three carriers
  above are the complete list, and a token sent as a query parameter is ignored on
  every route.

- `GET /openapi.json` and `GET /health` require no token at all; both are unauthenticated.

## Device transport

The gateway above is the model-facing surface. Between the gateway and the
extension there is a second surface, and it is a socket rather than a poll.

The extension opens one WebSocket to the bridge (`wss://<bridge host>/bridge`)
and holds it. Nothing on that connection asks a question: the bridge pushes a
`command` frame the moment a row appears in `opera_commands`, and the device
pushes its `complete` frame back up the same connection. Before this, the device
POSTed `/pull` every 500 ms and POSTed `/complete` afterwards, which cost two
round trips per action; measured on one machine, a six step burst spent 238 ms
in the browser and 496 ms in transport.

Frames, in both directions:

| Frame | Direction | Carries |
| --- | --- | --- |
| `hello` | device | `token`, `deviceName`, `protocolVersion` |
| `ready` | bridge | `serverTime`, sent only after the device is authenticated |
| `command` | bridge | `id`, `method`, `params`, `timeoutMs`, `serverTime` |
| `complete` | device | `commandId`, `ok`, and exactly one of `result` or `error` |
| `ack` / `error` | bridge | The outcome of a frame, for diagnosis |

Three rules the transport depends on:

- **The token travels in the first frame, not in a header.** An MV3 service
  worker cannot set arbitrary headers on a WebSocket handshake, and the alternative,
  a query parameter, would put a credential into every access log on the path.
- **Nothing is executed before `ready`.** An open socket proves the TCP
  connection and nothing about the identity behind it, so `ready` is the only
  thing that unlocks work.
- **Authentication is not claiming.** The handshake calls `opera_auth_device`,
  a lookup; the claim RPC is what takes ownership of a queued command, so using
  it to authenticate would silently swallow the one command the device was
  waiting for.

Why there is no polling fallback: a device that cannot connect is a device that is
down, and says so, because a quiet fallback would restore the latency this replaced
while looking perfectly healthy.

### Measured

Against the deployed bridge, timestamps taken from `opera_commands` rather than
from either end's clock. Four consecutive commands on one held socket, each
queued while the socket was idle:

| | insert to claim | claim to complete | total |
| --- | --- | --- | --- |
| sample 1 | 454 ms | 227 ms | 681 ms |
| sample 2 | 436 ms | 130 ms | 566 ms |
| sample 3 | 574 ms | 375 ms | 949 ms |
| sample 4 | 213 ms | 399 ms | 612 ms |

The old polling path measured about 810 ms per action end to end, so the change
is real but it is not the order of magnitude it looks like on paper. Polling is
gone, and what replaced it is now the cost: roughly 445 ms is the change channel
delivering the insert event, and roughly 300 ms is the edge round trip out to the
device and back.

The change channel is therefore the next thing to attack: the enqueue side
already calls this bridge, so it could push the command directly over the socket
it already knows about, removing the insert-event leg entirely rather than making
it faster. Until that happens, the honest description of this transport is
"no polling", not "instant".

### Broadcast (tried, measured, and removed)

Two event feeds were tried for insert-to-claim. postgres_changes measured
650-1000 ms. A Realtime broadcast fired 46 ms after insert still claimed
anywhere between 200 and 1300 ms, because the subscriber websocket held by the
edge isolate proved flaky — sometimes fast, sometimes silent. Faster signalling
into an unreliable subscriber does not make anything reliable, so both feeds
were removed. A 200 ms claim poll in the bridge replaced them: deterministic
where both feeds were not, at four trivial indexed RPCs per second per connected
device.

Measured after the change, direct inserts on a stable socket: insert-to-claim
58, 146, 155, 205, 250, 256, 289, 297 ms. Claim-to-complete on a trivial ping
runs another ~600 ms on the measured network, most of it the device round trip
rather than anything the bridge does.

Why the poll interval was halved to 100 ms: pg_stat_statements showed the
claim RPC executes in 0.30 ms server-side, so ten trivial indexed RPCs per
second per connected device cost nothing, and the poll phase averages half the
interval. Measured after that: insert-to-claim 24, 43, 84, 146, 160 ms,
completing in 486-810 ms.

What remains is counted, not guessed: DB execution across all RPCs on the path
is under 15 ms total with optimal index usage, and the await wakes on a 5-50 ms
ramp. What is left is round trips — five edge-to-database hops and two socket
traversals per command. Merging verify-plus-enqueue into the await call would
save one hop (~100 ms) but touches authentication and pinned RPC surfaces for
a tenth of a second, so it stays unwritten; the device round trip on a slow
network is the biggest term and only batching amortizes it.

One series showed every claim landing 30 seconds late in a batch. That was not
the transport — ten inserts issued inside one DO block share one transaction
and stay invisible until it commits.

## Endpoints

| Endpoint | Method | Purpose | Auth |
| --- | --- | --- | --- |
| `/command` | `POST` | Run one browser action and wait for its result | Device token required |
| `/openapi.json` | `GET` | Live OpenAPI document for the gateway | None |
| `/health` | `GET` | Liveness probe: service name, version, server time | None |

- `POST` is the only method the gateway executes.
- An `OPTIONS` preflight is answered `204` on any path, before routing.
- Every other method on any path, including an unrouted one, returns
  `METHOD_NOT_ALLOWED`.
- CORS is fail-closed: an allow-origin header is echoed only on an exact allowlist
  match, so a browser caller from an unlisted origin is blocked.

## `POST /command` request body

- Body must be JSON.
- A body over 256 KiB is rejected with `TOO_LARGE`, whatever framing the
  client used (`content-length` or chunked): the gateway buffers and measures
  the actual bytes before parsing.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `method` | string | Yes | The browser action to run, e.g. `tabs.list`, `page.find`, `browser.burst`. Must match `/^[a-z][a-z0-9_.]{1,48}$/` or the request is rejected with `INVALID_METHOD`. |
| `params` | object | No | Method-specific arguments. A missing or non-object value is treated as an empty object. |
| `waitMs` | integer | No | How long to wait for the device to report back. Clamped to 500â€“32000 ms; default 12000 ms when absent, non-numeric, or zero. |
| `requestId` | string | No | Idempotency key. Must match `/^[A-Za-z0-9_-]{1,100}$/`. A value that does not match is ignored rather than rejected, so a malformed key silently gives up replay protection. |
| `apiKey` | string | No | Device token carrier, for clients that cannot set headers. |

- A successful command and a structured device-side failure both return HTTP 200.
- Read the envelope: `ok: true`, or `ok: false` with an actionable error such as a
  stale element or an element not found.
- Do not treat HTTP 200 alone as success.

- The device must be paired and seen within the last 90 seconds.
- A paired-but-offline device answers HTTP 200 with a plain string error body
  carrying `lastSeenAt`, not an error-code object, so there is no `error.code` to
  switch on.

## Error codes

Every code the gateway emits, with the HTTP status it is returned with:

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_JSON` | 400 | The request body could not be parsed as JSON. |
| `UNAUTHORIZED` | 401 | No token was supplied, or the token is not valid for device `opera`. |
| `INVALID_METHOD` | 400 | `method` is missing or does not match the method pattern. |
| `DEVICE_NOT_PAIRED` | 401 | The device row named `opera` was absent, or had become `disabled`, at the moment of the device lookup that follows token verification. An **already-disabled** device never reaches this code â€” `opera_verify_device` excludes `status = 'disabled'`, so it is rejected earlier with `UNAUTHORIZED`. This code is therefore a missing device row or a narrow race in the window between verification and enqueue, not the ordinary disabled-device case. |
| `AWAIT_TIMEOUT` | 504 | The device did not report back before `waitMs`. The action may still have succeeded; verify page state before repeating it. |
| `GATEWAY_ERROR` | 502; also 200 on the empty-result path | The gateway could not complete the round trip: a database failure, an empty result, or a lost wait response after the command was enqueued. The action may still have succeeded; verify page state before repeating it. |
| `METHOD_NOT_ALLOWED` | 405 | The route does not accept this HTTP method. `/command` accepts `POST` only. |
| `TOO_LARGE` | 413 | The request body exceeds 256 KiB. |
| `NOT_FOUND` | 404 | The path is not one the gateway routes. Only a `POST` can reach this: any other method on an unrouted path is answered with `METHOD_NOT_ALLOWED` 405 instead. |

- On `504` or `502` the command may already have run. Verify page state rather than
  retrying a non-idempotent action, and pass `requestId` when you need replay protection.

- `GATEWAY_ERROR` is the only code returned with two statuses.
- Its `502` cases, a database failure or a lost wait response after the command was
  committed to the queue, may have run the action.
- Its `200` case is the empty result: no command row came back, so nothing was
  enqueued and nothing ran.
- That one is still a failure and must be read from `ok`, never from the status.

## Examples

Run a command with the token in a header:

```bash
curl -X POST \
  "https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway/command" \
  -H "content-type: application/json" \
  -H "x-opera-agent-token: $OPERA_AGENT_TOKEN" \
  -d '{
    "method": "tabs.list",
    "params": {},
    "waitMs": 12000,
    "requestId": "example-request-1"
  }'
```

Fetch the live spec (no token required):

```bash
curl "https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway/openapi.json"
```

- Export `$OPERA_AGENT_TOKEN` from the device token issued at pairing time.
- Never paste a real token into a script, a shell history file, or a commit.

## If this document disagrees with the gateway

- Fetch `GET /openapi.json` and trust it.
- Report the drift instead of trusting this file: `[tests/api-docs.test.mjs](../tests/api-docs.test.mjs)` pins only
  routed paths, error codes, and the base URL, so it cannot catch a changed field
  constraint or a changed response shape.
int or a changed response shape.
