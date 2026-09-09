# Performance

## Problem

Opera Agent's browser primitives were individually fast, but high-level tasks paid avoidable costs from caller-to-backend round trips, repeated command-status reads, fixed waits, semantic reads used only as readiness probes, and element serialization during text extraction.

## Optimization order

1. Move high-level orchestration into versioned server workflows.
2. Preserve enqueue/commit and await as separate database transactions.
3. Wait on observable page state rather than full resource completion or fixed sleeps.
4. Reuse browser state and skip no-op activation/navigation.
5. Shape read payloads to the caller's need.
6. Keep polling bounded and return to conservative idle behavior.

## Extension 1.1 source changes

- `ensureContent()` uses internal `content.ping`; it no longer performs a semantic read.
- `page.read` accepts `includeElements:false`. Its default element-rich response is unchanged.
- `tabs.activate` skips an already-active tab update and unnecessary window focus.
- `tabs.navigate` skips navigation when the normalized current and target URLs match.
- Public protocol remains version 1 with 23 allowlisted methods.

## Workflow telemetry

The runner records operational metadata in the workflow context and completion/failure audit entry:

- workflow queue and execution milliseconds;
- command count;
- per-command method, status, queue/execution/total milliseconds, bounded response-byte sample, truncation flag, and retry flag;
- aggregate command timing and sampled returned bytes, using a 16,384-character traversal budget so telemetry never re-serializes an unbounded page result;
- retry count;
- fixed-wait count and total intentional wait milliseconds.

Per-command telemetry is capped at 200 records. It does not store URLs, selectors, page text, form values, command parameters, passwords, or browsing content.

## What was intentionally not changed

- No site-specific code was added to the extension.
- No arbitrary local plan executor was activated.
- No public method or protocol version was added.
- No password/payment/file-upload protections were weakened.
- No enqueue-and-await database transaction was reintroduced.
- The 12-second idle long poll was not shortened blindly.

## Deployment boundary

The source candidate is version 1.1.0, but stable production remains 1.0.1 until the original private signing key is available, the same extension identity is verified, and the signed update passes acceptance. Runner v5 and the workflow revisions are deployed separately and remain rollback-capable; the retained `maxElements:1` fallback keeps installed 1.0.1 clients bounded.
