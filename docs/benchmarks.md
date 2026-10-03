# Performance Benchmarks
Do not turn one machine's timings into test assertions.

Related: [AGENTS.md](../AGENTS.md) rules - [runbook.md](runbook.md) reproduce commands - [api.md](api.md)
# Performance Benchmarks

Observations, never latency assertions. One machine's timings are not a threshold.

## Reproduce

| Suite | Command |
|---|---|
| Browser harness | `py tests/browser_extension_test.py` |
| Semantic baseline | `npm run benchmark:semantic` |
| Ledger | `npm run benchmark:ledger` |
| Proof evaluator | `npm run benchmark:proof` |
| Live internet (opt-in) | `OA_REAL_SITE=1 py tests/real_site_smoke.py` |

The browser harness uses an OS-assigned loopback port, an isolated temporary profile,
a local synthetic article, and the real signed-identity manifest key. Every command
records end-to-end local bridge latency and request/response byte counts. Results are
observations, not latency assertions.

## Locked ceilings

- Ordinary element-rich read: at most 15% median regression against the paired baseline.
- One-item delta: at most 50% of the corresponding snapshot payload.
- Semantic identity: 100% agreement.
- Future target: p95 below 10 ms at 500 evidence items.
- Proof response: below 128 KiB, or fail closed with `OVER_LIMIT`.

A machine that cannot produce a paired comparison must record why, not a number.

## Accepted rich-read baseline — 1.6.0

Paired consecutive runs on one Windows machine, isolated profile, three runs each.

| Metric | Value |
|---|---:|
| rich `page.read` median | 19.83 ms |
| rich `page.read` p95 | 20.65 ms |
| enriched snapshot median response | 50,953 bytes |
| single-update delta | 6,087 bytes |
| delta / snapshot ratio | 12% |
| text-only read payload | 12,266 bytes |
| semantic read payload | 33,801 bytes |
| foreground focus changes | 0 |
| persisted sensitive values | 0 |

Text-only mode cuts the page payload about 63.7% on the element-heavy synthetic page
while returning more text per chunk.

## Pure-runtime baselines

Node 22.22.2, Windows x64. No browser, network, database, or MCP path is exercised,
and no output file is written.

| Target | Median | p95 |
|---|---:|---:|
| ledger: validate accepted | 0.2949 ms | 0.4494 ms |
| ledger: create and digest | 0.2919 ms | 0.4510 ms |
| ledger: metadata-only inspection | 0.0009 ms | 0.0011 ms |
| proof: 500 evidence items | 1.9055 ms | 2.4166 ms |

Ledger numbers are 1,000 operations per operation type after 100 warm-up validations.
Proof numbers are 30 runs over 500 prevalidated immutable evidence objects after five
warm-up evaluations. Evidence arriving without the core's in-memory validation marker
is still canonicalized and digest-verified; the fast path cannot be supplied through
serialized input.

## Contract digests

| Artifact | SHA-256 |
|---|---|
| Scrubbed replay corpus | `277d87d655859bd2a291cf286e9584e0bdc20ff9272d8059758641dd49f8e091` |
| Goal-ledger contract | `sha256:d6a0bdfa18f559266f6fbc677face2f94f7ca5071305a3be752548f658bada79` |
| Ledger replay | `sha256:71e8e9d71d0ed3ea5021d0078d1e333be9179b65f5efe1c80f99aced04c7d7d5` |

## Record during any live run

- workflow queue time and execution time
- command count and browser timing
- returned bytes, retries, fixed waits

Do not turn one machine's timings into test assertions.
