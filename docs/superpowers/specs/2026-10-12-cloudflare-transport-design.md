# Cloudflare Transport Design

**Status:** spec — the plan at `docs/superpowers/plans/2026-10-12-cloudflare-transport.md` implements this.
**Date:** 2026-10-12.

## Goal

Move the hot path (gateway + bridge) to Cloudflare Workers + Durable Objects so a
command costs hundreds of milliseconds with no polling, no wall-clock death,
and no flaky subscriber — while Supabase Postgres stays the system of record
and the extension protocol stays byte-compatible.

## Why (measured, not theorized)

- Supabase edge isolates die at a ~150 s hard wall clock. The device works
  around it with a 120 s recycle. Cloudflare DOs live as long as a socket is
  connected: no limit, no recycle.
- Both Supabase event feeds proved flaky (postgres_changes 650–1000 ms,
  broadcast 200–1300 ms with a dead-silent failure mode). The current 100 ms
  claim poll is deterministic but costs 10 RPCs/s/device forever.
- A Worker can RPC a DO directly. That single call replaces the poll, the
  signal, and the await: enqueue, then one blocking call that returns when the
  device reports.

## Architecture

```
caller ──POST /command──▶ Worker ──PostgREST──▶ Supabase PG (verify, enqueue)
                              │
                              └──RPC runCommand()──▶ Device DO ──socket──▶ browser
                                                        │                       │
                                                        └──── result ───────────┘
```

- **Worker** (`cloudflare/src/gateway.js`): same `POST /command` API shape as
  `docs/api.md` today. Verifies, enqueues, then calls the device object and
  waits. No change to request/response shapes.
- **Device Durable Object** (`cloudflare/src/device.js`), ONE object for the
  whole fleet via a fixed id (`fleet`): holds device WebSockets with the
  hibernation API, gates each handshake through `opera_auth_device`, claims
  through `opera_claim_next_wait`, pushes frames, records completions through
  `opera_complete_command`, and resolves the waiting gateway call. Single DO
  rather than one per device because routing needs the device name while the
  name only arrives after upgrade, inside the handshake frame — and the
  protocol must not change to accommodate hosting. Single-threaded, so
  same-device commands serialize naturally; the 1,000 rps soft limit is
  orders above this workload. Shard by device later if ever needed.
- **PostgREST client** (`cloudflare/src/postgrest.js`): `rpc(name, args)` over
  `fetch` with apikey + Bearer service key. Used by both modules.
- Keepalive stays: a 20 s alarm sends the ping the *device* needs (Chrome
  kills a worker idle 30 s); pong tracking closes unanswered sockets with
  4003, unchanged from today.
- **Frames**: reused from `extension/lib/socket-protocol.js` by relative
  import. No fork; the existing locks keep covering them.

## Contracts

- `POST /command` request/response: identical to `docs/api.md` (method,
  params, waitMs, requestId in; ok/result/error, UNAUTHORIZED,
  DEVICE_NOT_PAIRED, AWAIT_TIMEOUT out).
- `Device.runCommand({ commandId, method, params, timeoutMs, deadlineMs })`
  returns `{ ok, result?, error? }` and resolves when the completion frame
  arrives or the deadline passes. Late completions are still recorded.
- Ordering: the DO is single-threaded, so same-device commands serialize
  naturally. The claim RPC still arbitrates across isolates callers.

## What stays

- Supabase Postgres: all RPCs, all tables, history, dashboard. Zero data
  migration.
- Extension behavior: only the bridge URL and one CSP line change.
- Supabase bridge: stays deployed as the instant rollback (flip the URL back).
- `opera-local`: untouched; local stays the fastest path by design.

## Constraints

- Node 22, `node:test`, no new npm dependencies (wrangler via npx only).
- Cloudflare modules in plain `.js` (JSDoc types) so unit tests import them
  directly — same precedent as `supabase/functions/_shared/*.js`.
- TDD: every behavior locked before implementation; verify by execution.
- Comments stand above declarations with a blank line each side, never in a body.
- Secrets never in the tree: Supabase service key via `wrangler secret`
  (user step), CI deploy token via GitHub Secrets (user step).
- No polling anywhere on the hot path: no `setInterval` in the DO (it would
  also defeat hibernation billing), alarms only.

## Open questions (resolved in Task 1, before building on them)

1. Alarm precision and cost at 20 s cadence: confirm from docs; keepalive must
   fire strictly inside the device's 30 s idle death.
2. In-flight RPC + hibernation: lifecycle docs say an unfinished request
   prevents hibernation, which is what keeps a pending waiter alive. Confirm
   by reading the installed runtime docs and by the Task 5 live test (a slow
   command must answer, not time out into hibernation).
3. `npx wrangler deploy` from this repo works end to end and prints a stable
   `*.workers.dev` URL; that exact hostname is what the extension CSP will
   pin (Task 4), so record it verbatim.

## Success criteria (all measured, none asserted)

- Gateway ping p50 ≤ 400 ms end to end from the operator network.
- 10-minute hold: zero errors, zero unexpected reconnects.
- Rollback drill: flip the extension URL back to Supabase, one command flows.
- `npm test` green, `npm run check` green, CI green, then merge.
