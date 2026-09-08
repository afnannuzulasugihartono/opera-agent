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

- Add an internal zero-payload content-script ping so `ensureContent()` does not probe with `page.read`.
- Add a backward-compatible text-only `page.read` mode that can omit interactive element serialization.
- Add generic navigation readiness modes so workflows can wait for navigation commit instead of full resource completion when appropriate.
- Evaluate a bounded generic local plan/batch executor composed only of allowlisted primitives, with strict step/loop/wait/result/deadline limits.
- Preserve password/payment/file-upload protections and prohibit remote JavaScript/eval.
- Verify same extension ID, Chromium regression, real Opera acceptance, reconnect, and rollback before release.

## Higher-level workflows

Higher-level capabilities should primarily ship as server-side workflows, for example:

- YouTube transcript/video study workflows
- deep website crawling and research
- form-filling workflows
- LinkedIn/Google Maps/site-specific automations composed from generic primitives
- UII workflows composed from the same generic primitive layer

Legacy Final 2 remains a documented fallback until explicit retirement; performance work must not silently mutate that legacy path.
