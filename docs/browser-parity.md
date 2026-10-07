# Browser-parity contract

Goal: Opera Agent works like the browser a human uses, but for an AI harness.
Every capability must be reachable through the generic browser primitives in
`extension/lib/protocol.js` and the MCP/gateway surfaces, without relying on a
full browser build.

## Current snapshot (2026-10-07)

| Area | Status | Next gap |
| --- | --- | --- |
| Tab lifecycle | `tabs.list/get/find/open/activate/close/navigate/reload` | Cross-window targeting, per-window state |
| Page read/write | `page.read/query/find/collect_links/click/pointer/capture/fill/focus/scroll/key/wait_for` | Semantic AX parity, richer form/modal state |
| Media | `media.state/play/pause/seek/stream_start/stream_stop` + MCP read | Live tap/transcript polish, broader media element coverage |
| Watch/events | `start_watch`, `wait_events`, `stop_watch`, shared burst primitives | Long-video correlation, richer page-change signals |
| Plan path | `opera_start_workflow`, `opera_await_workflow` | VM handoff RPC (`opera_start_workflow` host migration) |
| Audio | `media_stream_start/stop`, `media_listen_read`, `opera_listen_sessions` | Browser-side chunking/upload hardening, retention policy |
| Consent & allowlist | Static token for OpenCode desktop, OAuth for ChatGPT/OpenCode, dynamic registration | Per-user desktop device routing, easier allowlist editing |

## What "parity" means here

- Same browser the user runs, not a second controlled browser.
- Primitives stay generic. Site-specific behavior lives in server-side workflows,
  not in the extension bundle.
- Every new capability ships with a lock: schema, boundary pins, CI gate, docs.
- No silent fallback: failures return `ok:false` / `outcome:unknown`, never a
  green-looking lie.

## Near-term scope

1. Harden live audio session/lifecycle for cross-harness testing.
2. Expose `opera_start_workflow` host handoff through the same contract.
3. Keep `page.read` / AX coverage honest for long/media pages.
4. Track any new primitive immediately in `PRODUCT_VERSION`, MCP count, site
   copy, and boundary locks.
