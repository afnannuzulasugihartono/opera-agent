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
