# Performance Benchmarks

Simplification above everything. Current state, never a history book.
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

- OS-assigned loopback port, isolated temporary profile, a local synthetic article, and
  the real signed-identity manifest key.
- Every command records end-to-end local bridge latency and request/response byte counts.
- Results are observations, not latency assertions.

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

- Ledger: 1,000 operations per operation type after 100 warm-up validations.
- Proof: 30 runs over 500 prevalidated immutable evidence objects after five warm-ups.
- Evidence arriving without the core's in-memory validation marker is still canonicalized and
  digest-verified. The fast path cannot be supplied through serialized input.

## Production round-trip cost

From `pg_stat_statements` on the live project. Read the sample size before the number.

| Call | Calls | Avg | Max |
|---|---:|---:|---:|
| `opera_await_adaptive` through PostgREST, waiting on a device | 64 | 1076.1 ms | 5877.4 ms |
| `opera_await_adaptive` called directly, nothing to wait for | 10 | 6.9 ms | 14.1 ms |
| `opera_verify_device` | 1 | 3.3 ms | 3.3 ms |
| `opera_enqueue` in a single statement | 1 | 73.2 ms | 73.2 ms |

## Where a command's time actually goes

9,079 completed commands in production, split at the two timestamps the queue records.

| Stage | Avg | p50 | p95 |
|---|---:|---:|---:|
| enqueue to claim, the device noticing the command | **676.6 ms** | **184.0 ms** | 1914.4 ms |
| claim to complete, the browser doing the work | 1198.7 ms | 532.2 ms | — |
| end to end | 1875.3 ms | — | — |

So about 36% of a command is spent waiting for the device to ask for it, and that
waiting is pure idle, not work.

### The lever, and its price

The device long-polls with a 5s window and the wait lives in Postgres, inside
`opera_claim_next_wait`, so pickup latency is that function's polling ramp:

| Polls | Sleep each | Cumulative |
|---:|---:|---:|
| 1–8 | 5 ms | 40 ms |
| 9–16 | 10 ms | 120 ms |
| 17–24 | 25 ms | 320 ms |
| 25–32 | 50 ms | 720 ms |
| 33+ | **250 ms** | +250 ms each |

The measured p50 of 184 ms sits in the 120–320 ms band and the p95 of 1914 ms sits deep
in the 250 ms tail. That is the shape of a ramp that degrades after 720 ms of idleness:
a device that has been quiet for a couple of seconds is asking every 250 ms.

Lowering the tail floor is the single available win, and it is a production database
change with a real cost:

| Floor | p95 pickup | Idle polls per second |
|---:|---:|---:|
| 250 ms (now) | about 1914 ms | 4 |
| 100 ms | roughly 1000 ms | 10 |
| 50 ms | roughly 700 ms | 20 |

It is not changed here. It alters a production function on the command path, and the
right floor depends on how many devices are idle at once, which this repository cannot
answer.

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
