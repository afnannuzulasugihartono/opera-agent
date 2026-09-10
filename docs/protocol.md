# Command Protocol

Opera Agent protocol version: `1`.

## Command envelope

```json
{
  "id": "uuid-or-request-id",
  "method": "page.click",
  "params": {},
  "timeoutMs": 10000
}
```

The extension validates method, parameter shape, and timeout bounds locally before execution.

## Result envelope

```json
{
  "id": "same-command-id",
  "ok": true,
  "result": {},
  "timingMs": 42
}
```

Failures return a structured error object rather than raw stack traces.

## Method policy

All low-level methods are registered in `opera_methods` and mirrored by the extension protocol allowlist. High-level workflows such as YouTube search/captions or research crawl are stored in Supabase and composed from those methods; they are not extension primitives.

## Current generic primitive groups

- `browser.*`
- `tabs.*`
- `page.*`
- `media.*`

Trusted input is selected through safe parameters on supported page actions rather than through arbitrary debugger commands.

## Bounded same-tab bursts

Opera Agent 1.2.0 adds `browser.burst` without changing protocol version 1. A burst executes 1-8 already-allowlisted page actions sequentially on one resolved tab and returns per-step results and timings. Supported actions are `read`, `find`, `click`, `fill`, `key`, `scroll`, `wait`, and `pointer`.

The primitive is intentionally not a general workflow language: steps cannot override `tabId`, open/navigate/close tabs, loop, branch, nest another burst, or execute JavaScript. The extension enforces a 12-second total timeout, a 256 KiB result limit, trusted-input safety checks, and stop-on-first-failure behavior. Trusted debugger input is attached lazily and reused only until that burst finishes.

## Backward-compatible read shaping

`page.read` keeps its existing element-rich response by default. Text-oriented callers can request a smaller response without adding a public primitive:

```json
{
  "method": "page.read",
  "params": {
    "tabId": 123,
    "offset": 0,
    "limit": 12000,
    "includeElements": false
  }
}
```

When `includeElements` is `false`, the `elements` field is omitted. Text continuation still uses `hasMore` and `nextOffset`. The internal `content.ping` message is restricted to extension-to-content-script readiness checks and is not part of the remote protocol allowlist.
