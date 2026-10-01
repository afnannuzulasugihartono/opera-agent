# Gateway API

The machine source of truth for this gateway is the live
`GET /openapi.json` served by the gateway itself. This file is the narrative
reference for operators and integrators. It is drift-pinned by
`tests/api-docs.test.mjs`, which extracts the routed paths and error codes from
the gateway source and fails if this document stops covering them. If this
document and the live spec ever disagree, the live spec wins and the
discrepancy is a bug worth reporting.

## Base URLs

Project functions root:

```
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1
```

Gateway base (append the routed paths to this):

```
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-gateway
```

The gateway does not trust the incoming request URL when it advertises its own
base. The hosted proxy rewrites the request URL, so the base path in the served
`servers[].url` entry is derived from the `SUPABASE_URL` environment variable,
never from the request. Callers should always address the base above directly.

## Authentication

The token is a **device token** for the single fixed device name `opera`. The
gateway always looks up that one device; there is no device selector in the
request, and the caller cannot target a different device.

The gateway accepts the token in three carriers, checked in this order:

1. `x-opera-agent-token: <device-token>` request header.
2. `Authorization: Bearer <device-token>` request header. The `Bearer ` prefix is
   optional and matched case-insensitively, so a bare token is accepted too.
3. `apiKey` in the JSON request body.

The body carrier exists because GPT Actions cannot set custom request headers.
Header carriers are preferred: they keep the token out of request bodies that
may be logged.

A `?apiKey=` query parameter is **never** read by the gateway. The three
carriers above are the complete list; a token sent as a query parameter is
ignored on every route.

`GET /openapi.json` and `GET /health` require no token at all — they are
unauthenticated.

## Endpoints

| Endpoint | Method | Purpose | Auth |
| --- | --- | --- | --- |
| `/command` | `POST` | Run one browser action and wait for its result | Device token required |
| `/openapi.json` | `GET` | Live OpenAPI document for the gateway | None |
| `/health` | `GET` | Liveness probe: service name, version, server time | None |

`POST` is the only method the gateway executes. An `OPTIONS` preflight is
answered with `204` on any path before routing happens, and every other method
on any path — including an unrouted one — returns `METHOD_NOT_ALLOWED`. CORS is
fail-closed: an allow-origin header is echoed only for an exact allowlist match,
so a browser-based caller from an unlisted origin will see its request blocked.

## `POST /command` request body

Body must be JSON. A body over 256 KiB (256 * 1024 bytes) is rejected with
`TOO_LARGE`, but only when the client sends a `content-length` header. The
gateway reads that header alone, so a chunked body sent without one is not
size-checked.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `method` | string | Yes | The browser action to run, e.g. `tabs.list`, `page.find`, `browser.burst`. Must match `/^[a-z][a-z0-9_.]{1,48}$/` or the request is rejected with `INVALID_METHOD`. |
| `params` | object | No | Method-specific arguments. A missing or non-object value is treated as an empty object. |
| `waitMs` | integer | No | How long to wait for the device to report back. Clamped to 500–32000 ms; default 12000 ms when absent, non-numeric, or zero. |
| `requestId` | string | No | Idempotency key. Must match `/^[A-Za-z0-9_-]{1,100}$/`. A value that does not match is ignored rather than rejected, so a malformed key silently gives up replay protection. |
| `apiKey` | string | No | Device token carrier, for clients that cannot set headers. |

A successful command and a structured device-side failure both return HTTP 200
with an envelope the caller is expected to read: `ok: true` on success, or
`ok: false` with an actionable error such as a stale element or an element not
found. Do not treat HTTP 200 alone as success.

The device must be paired and must have been seen within the last 90 seconds.
A paired-but-offline device answers with HTTP 200 whose error body is a plain
string with `lastSeenAt`, not an error-code object, so there is no `error.code`
to switch on in that case.

## Error codes

Every code the gateway emits, with the HTTP status it is returned with:

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_JSON` | 400 | The request body could not be parsed as JSON. |
| `UNAUTHORIZED` | 401 | No token was supplied, or the token is not valid for device `opera`. |
| `INVALID_METHOD` | 400 | `method` is missing or does not match the method pattern. |
| `DEVICE_NOT_PAIRED` | 401 | Device `opera` is not paired, is disabled, or reported "not paired" while the command was in flight. |
| `AWAIT_TIMEOUT` | 504 | The device did not report back before `waitMs`. The action may still have succeeded; verify page state before repeating it. |
| `GATEWAY_ERROR` | 502; also 200 on the empty-result path | The gateway could not complete the round trip: a database failure, an empty result, or a lost wait response after the command was enqueued. The action may still have succeeded; verify page state before repeating it. |
| `METHOD_NOT_ALLOWED` | 405 | The route does not accept this HTTP method. `/command` accepts `POST` only. |
| `TOO_LARGE` | 413 | The request body exceeds 256 KiB. Only detected when the client sends a `content-length` header. |
| `NOT_FOUND` | 404 | The path is not one the gateway routes. Only a `POST` can reach this: any other method on an unrouted path is answered with `METHOD_NOT_ALLOWED` 405 instead. |

When a `504` or `502` occurs, the command may already have been enqueued and
executed. Verify page state rather than blindly retrying a non-idempotent
action; pass `requestId` when you need replay protection.

`GATEWAY_ERROR` is the one code the gateway returns with two statuses. Its
`502` cases — a database failure, or a lost wait response after the command was
already committed to the queue — may have run the action. Its `200` case is the
empty result instead: the gateway got no command row back from the database, so
no command was enqueued and no action ran. That one is still a failure and must
be read from the `ok` field, never from the status.

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

Export `$OPERA_AGENT_TOKEN` from the device token issued at pairing time. Do
not paste a real token into a script, a shell history file, or a commit.

## If this document disagrees with the gateway

Fetch `GET /openapi.json` and trust it. Report the drift instead of trusting
this file: `tests/api-docs.test.mjs` only pins routed paths, error codes, and
the base URL, so it cannot catch a changed field constraint or response shape.
