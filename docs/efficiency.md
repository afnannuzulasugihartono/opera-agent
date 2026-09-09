# Efficiency and Flexibility Plan

Opera Agent should feel fast without becoming site-specific or fragile. The performance rule is:

> **Keep browser primitives generic; move product/site behavior into versioned workflows; minimize network round trips before micro-optimizing individual DOM operations.**

## Goals

1. One user intent should require as few ChatGPT ↔ Supabase ↔ Opera round trips as possible.
2. Waiting must be condition-based when a condition is observable. Fixed sleeps are a fallback, not the default.
3. Payload size should be proportional to the task. Text-only reads should not ship large interactive-element snapshots by default.
4. The extension remains site-agnostic. YouTube, LinkedIn, Google Maps, UII, and other website logic belongs in workflows.
5. Existing safety boundaries remain unchanged: method allowlist, credential/payment-field protection, file-upload blocking, bounded results, request expiry, and idempotent completion.
6. Historical releases and migrations are immutable documentation. Optimizations are added as new migrations/workflow versions rather than rewriting old history.

## Performance model

A multi-step task has several possible costs:

```text
workflow dispatch
  + command queue/claim latency
  + browser execution
  + command completion detection
  + repeated workflow commands
  + unnecessary waits
  + oversized result payloads
```

The largest practical win is normally to **remove an entire round trip**, not to save a few milliseconds inside a DOM query.

## Phase 1 — server-side efficiency (compatible with extension 1.0.1)

This phase does not require a new CRX and preserves the existing 23 browser primitives.

### Bridge fast-start polling

`opera-agent-bridge` keeps the conservative 250 ms idle polling interval, but each new long-poll request starts with six 50 ms polls before returning to 250 ms.

Why this shape:

- sequential workflows usually enqueue the next command shortly after the extension finishes the previous one;
- the short fast window reduces active-work latency;
- idle connections return to the old 250 ms interval, avoiding permanent high database polling load.

### Command completion wait

The Edge workflow runner uses the existing two-phase command boundary:

```text
opera_enqueue → commit
Opera claims / executes / completes command
opera_await → result
```

The runner should not repeatedly fetch `opera_commands` over Edge-to-database HTTP while waiting. A single `opera_await` RPC keeps the wait loop inside PostgreSQL, where completion is checked at the existing bounded 50 ms cadence. This preserves the transaction fix introduced in 1.0.1 because enqueue and await remain separate RPC transactions, while reducing repeated network requests from the runner.

Safe retry remains limited to read-only/idempotent primitives and known transient browser-message failures. Mutating browser actions are not blindly replayed.

### Adaptive text reads

New/updated research workflows use:

```text
chunk size: 12,000 characters
interactive elements: 1 by default
continuation: nextOffset / hasMore
maximum chunks: bounded by workflow repeat limit
```

The caller can still request a different bounded chunk size or more element metadata when needed. Generic `page.read` itself remains unchanged and flexible.

### One workflow per user intent

Added/updated workflows:

- `research.read_url` — efficient bounded read with 12k/1-element defaults.
- `research.read_current_full` — collect the current tab in adaptive 12k chunks.
- `research.read_url_full` — open, collect adaptive chunks, close.
- `research.crawl_urls` — reuse one background tab instead of opening/closing one tab per URL.
- `research.crawl_urls_parallel` — explicit bounded parallel mode for independent URLs, maximum four concurrent temporary tabs.
- `youtube.search` — do not force a redundant Home navigation before using the existing search box.
- `youtube.captions_on` — verify caption state with `page.wait_for` instead of a fixed post-click delay.
- `youtube.play_recommendation` — check for an ad first; only enter bounded ad polling when an ad is actually present.
- `youtube.get_transcript` — reuse an already-open transcript panel, prefer a normal DOM click, fall back to trusted input only when necessary, and collect long text internally.

## Phase 2 — extension efficiency (next backward-compatible feature release)

These changes require a newly signed CRX with the **same signing identity** as the installed extension. They must not be activated with a new key.

Planned generic changes:

1. **Lightweight internal content ping** — replace the current small `page.read` probe in `ensureContent()` with a zero-payload `content.ping` internal message.
2. **Text-only read mode** — allow `page.read` to omit interactive-element serialization entirely (`includeElements: false`) while keeping the current default for compatibility.
3. **Navigation readiness modes** — support a generic readiness mode such as `committed` / `complete` so workflows can avoid waiting for every page resource when only document navigation is needed.
4. **Bounded local plan/batch execution** — evaluate a generic, allowlisted sequence of existing primitives locally in the extension. Site-specific workflow definitions still live on the server; the extension only executes a validated declarative plan. This is intended to collapse many backend command round trips into one claimed command.
5. Keep strict bounds on number of local plan steps, loops, waits, total result bytes, and command deadline. Recursive plan execution and remote JavaScript remain forbidden.

Phase 2 should be released as a normal SemVer feature release only after Chromium regression, real Opera acceptance, same-ID CRX verification, and signing-key restoration.

## What must not be optimized away

Performance work must not remove:

- the command allowlist;
- password/PIN/OTP/2FA/CVV/CVC/security-code protection;
- file-upload blocking;
- trusted-input boundaries;
- command expiry and timeout enforcement;
- durable completion retry;
- workflow version history and rollback;
- the legacy fallback until it is explicitly retired.

## Benchmarking

Every optimization should be measured end-to-end, not only inside one function.

Record at least:

- workflow queue time;
- workflow total time;
- command count;
- command queue/claim time when available;
- browser execution time when available;
- bytes/characters returned;
- whether a fixed wait was entered;
- whether retry/fallback occurred.

### Foundation baseline

On 2026-09-08, a production `browser.status` workflow using extension 1.0.1 reported approximately:

```text
workflow queue: 787 ms
workflow total: 1,613 ms
```

This is a baseline for the complete asynchronous workflow path, not a claim that the browser primitive itself took 1.6 seconds.

### Phase 1 pre-`opera_await` runner baseline

Before replacing repeated Edge-side command-status reads with one `opera_await` RPC, production `research.read_url` v2 was run three times against `https://example.com/` using extension 1.0.1. Each run performed three browser commands: open, read, close.

| Run | Workflow queue | Workflow total | Runner duration |
| --- | ---: | ---: | ---: |
| 1 | 632 ms | 3,400 ms | 2,768 ms |
| 2 | 336 ms | 2,935 ms | 2,599 ms |
| 3 | 314 ms | 3,294 ms | 2,980 ms |

Median workflow queue: **336 ms**. Median workflow total: **3,294 ms**. These measurements include browser/network variability and are retained as the comparison baseline for the Postgres-await runner deployment.

Post-deployment measurements must be appended rather than replacing these baselines.

## Version and history policy

- Installed/stable extension remains **1.0.1** until a same-key signed successor is actually published and verified.
- Server-side workflows can receive new internal versions independently of the extension version.
- Existing migration files and release notes are not rewritten to make history look cleaner.
- Legacy Final 1 / Final 2 remain documented in `docs/releases/` until explicit retirement.
- New stable extension releases get their own `docs/releases/<version>.md`, GitHub Release, changelog entry, hash record, and acceptance evidence.

## Rollback

Server workflow changes are designed to be reversible through the existing workflow version registry. Edge Function changes should retain the previous Git revision so an earlier implementation can be redeployed. Extension 1.0.1 remains the browser-side fallback while Phase 2 is unreleased.
