# Roadmap

## 1.0.0 foundation

- Define the Opera Agent command protocol.
- Build the extension bridge from scratch.
- Implement generic tab, page, input, media, and CDP primitives.
- Build the Supabase command queue and workflow registry.
- Add reconnect, retry, timeout, and idempotency handling.
- Add structured element state including ARIA attributes.
- Add bounded chunked page reading.
- Build unit, integration, mock-browser, and real-browser regression tests.
- Validate cross-chat control.
- Validate signed extension packaging and automatic update flow.

## After 1.0.0

Higher-level capabilities should primarily ship as server-side workflows, for example:

- YouTube captions and video study workflows
- deep website crawling and research
- form-filling workflows
- site-specific automations composed from generic primitives
