# Pre-8E repair R5 — internal media fast path

Date: 2026-09-19

Status: ACCEPTED / CLOSED. Documentation closeout `50b19ee1f4ea91fd0be866565a1c1733bc8ff87b`
has CircleCI #251 + Vercel SUCCESS, independently verified.

Evidence head: `15270d5875bd9fa9ae350d1a866332895519abbb`.
Exact-head statuses independently checked: CircleCI #250 SUCCESS and Vercel
SUCCESS. The unchanged CircleCI workflow runs the full Node suite, static check,
and Chromium extension regression, including nine ready-media seeks, p50 <=1000ms,
50ms position tolerance, zero navigate/reload, and background-focus preservation.
No numeric p50 is inferred from the green status alone. A separate local Chromium
run of `py -3.12 tests/browser_extension_test.py` passed with nine seeks and p50
16.79ms, verified positions and focus preservation; this is not cloud latency.

T026/T027 add the versioned internal `media.sample_at` workflow using existing
state/pause/seek/play primitives, preserving initial playback state. This is a
candidate migration, not evidence of production installation. Public MCP remains
18 tools; Protocol 1 and 26 primitives are unchanged. T028/T029 required automated
gates pass at the evidence head. Local full Node suite and `npm run check` also
passed during this independent continuation. Real Opera end-to-end acceptance is
still assigned to R8, not inferred from controlled Chromium.

## Explained benchmark failures

- #248: benchmark referenced `focus_audit` before its later initialization.
  Repair: its own R5 focus audit, preserving the zero-takeover assertion.
- #249: metadata-only WAV returned position zero for requested 0.25 seconds.
  Repair: seekable byte-range fixture, readyState >=2 before measurement, tighter
  position tolerance. This changes the fixture, not runtime or timing threshold.
- #250: all required gates pass after those bounded repairs.

## Continuation boundary

The current user explicitly authorizes R5 through R8 sequentially. No deployment,
signed release, transport cutover, VM enablement, or Milestone 8E is authorized.
Closeout requires this documentation commit's CI before R6 implementation.
