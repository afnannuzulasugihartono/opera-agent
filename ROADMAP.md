# Roadmap

## 1.0.x foundation — complete

- Define the Opera Agent command protocol.
- Build the extension bridge from scratch.
- Implement generic tab, page, input, media, and CDP primitives.
- Build the Supabase command queue and workflow registry.
- Add reconnect, retry, timeout, and idempotency handling.
- Add structured element state including ARIA attributes.
- Add bounded chunked page reading.
- Build unit, integration, mock-browser, and real-browser regression tests.
- Validate cross-chat control.
- Validate signed extension packaging and same-ID update flow.

## Server-side efficiency — current

- Collapse chat-side primitive sequences into versioned server workflows.
- Prefer condition/state waits over fixed sleeps.
- Use 12k adaptive read chunks and minimal element payloads for text-heavy work.
- Reuse tabs in sequential crawling where correctness permits.
- Add fast paths that skip redundant navigation/reload.
- Enter ad polling only when an ad is actually detected.
- Keep conservative idle polling while using a short fast-start command-claim window.
- Maintain benchmark evidence and workflow rollback history.

## 1.1.0 candidate — generic extension efficiency

This release must remain site-agnostic and requires the original signing identity.

- [x] Add an internal zero-payload content-script ping so `ensureContent()` does not probe with `page.read`.
- [x] Add a backward-compatible text-only `page.read` mode that can omit interactive element serialization.
- [x] Add generic no-op fast paths while retaining `wait:false` plus semantic `page.wait_for` navigation flows.
- [x] Add metadata-only workflow performance telemetry with bounded per-command records.
- [x] Version text-oriented workflows to use text-only reads without mutating their history.
- [x] Preserve password/payment/file-upload protections and prohibit remote JavaScript/eval.
- [x] Verify the source build in real Opera with the stable extension ID, reconnect, restart, sensitive-field, and file-upload protections.
- [x] Deploy runner v6 and the rollback-capable workflow revisions to production Supabase.
- [x] Verify runner v6 telemetry with a paired Opera 1.0.1 `browser.status` production smoke.
- [ ] Repeat live production workflow benchmarks with an active paired Opera session.
- [ ] Sign the CRX with the original private key and verify same-ID update acceptance before publishing.

The quarantined local-plan/v2 experiment is not part of 1.1.0. Protocol 1 and the 23-method public allowlist remain unchanged.

## Higher-level workflows

Higher-level capabilities should primarily ship as server-side workflows, for example:

- YouTube transcript/video study workflows
- deep website crawling and research
- form-filling workflows
- LinkedIn/Google Maps/site-specific automations composed from generic primitives
- UII workflows composed from the same generic primitive layer

Legacy Final 2 remains a documented fallback until explicit retirement; performance work must not silently mutate that legacy path.
