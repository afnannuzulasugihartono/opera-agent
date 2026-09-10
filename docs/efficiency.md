# Efficiency and Flexibility Plan

> Historical implementation record. For the current milestone order and acceptance gates, see [roadmap.md](roadmap.md). Background-first execution now precedes adaptive screenshots and vision-guided navigation.

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

The runner does not repeatedly fetch `opera_commands` over Edge-to-database HTTP while waiting. A single `opera_await` RPC keeps the wait loop inside PostgreSQL, where completion is checked at the existing bounded 50 ms cadence. This preserves the transaction fix introduced in 1.0.1 because enqueue and await remain separate RPC transactions, while reducing repeated network requests from the runner.

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
- `youtube.get_transcript` — reuse an already-open transcript panel, prefer a normal DOM click, wait for actual transcript rows, activate an inactive YouTube tab only when rendering is throttled, restore the previously active tab, and collect long text internally.

## Phase 2 — extension efficiency (next backward-compatible feature release)

These changes originally required the installed extension's signing identity for an in-place update. Because that private key is unavailable, the explicitly authorized 1.1.0 build uses a new identity and must be installed and paired separately; the installed extension is not replaced.

Planned generic changes:

1. **Lightweight internal content ping** — replace the current small `page.read` probe in `ensureContent()` with a zero-payload `content.ping` internal message.
2. **Text-only read mode** — allow `page.read` to omit interactive-element serialization entirely (`includeElements: false`) while keeping the current default for compatibility.
3. **Navigation readiness modes** — support a generic readiness mode such as `committed` / `complete` so workflows can avoid waiting for every page resource when only document navigation is needed.
4. **Bounded local plan/batch execution** — evaluate a generic, allowlisted sequence of existing primitives locally in the extension. Site-specific workflow definitions still live on the server; the extension only executes a validated declarative plan. This is intended to collapse many backend command round trips into one claimed command.
5. Keep strict bounds on number of local plan steps, loops, waits, total result bytes, and command deadline. Recursive plan execution and remote JavaScript remain forbidden.

Phase 2 can be released as a normal SemVer feature build only after Chromium regression, real Opera acceptance, CRX identity verification, and fresh-pairing acceptance. Same-ID update acceptance remains specific to the legacy signing key.

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

Median workflow queue: **336 ms**. Median workflow total: **3,294 ms**.

The median runner time not explained by the three browser-command totals was approximately **363 ms**.

### Phase 1 production acceptance after `opera_await`

The same three-command `research.read_url` workload was repeated after deploying runner v4:

| Run | Workflow queue | Workflow total | Runner duration |
| --- | ---: | ---: | ---: |
| 1 | 3,139 ms | 4,844 ms | 1,705 ms |
| 2 | 286 ms | 3,393 ms | 3,107 ms |
| 3 | 276 ms | 5,976 ms | 5,700 ms |

The browser/network path was visibly noisy during these runs, so the end-to-end median did **not** improve in this small sample and must not be presented as a speedup. However, the median runner time not explained by the command totals fell from roughly **363 ms to 271 ms** (about 25%). This supports keeping the single-`opera_await` design because it removes repeated Edge HTTP status reads without changing browser semantics.

A one-command `browser.status` smoke test after runner v4 completed in **1,382 ms** total with a **278 ms** workflow queue; a later sample completed in **1,571 ms**, while another noisy sample reached **3,509 ms** because command queue time spiked. Queue/extension scheduling therefore remains a larger source of variance than the runner's completion-detection loop.

### YouTube transcript acceptance

Real Opera testing on NASA Goddard's 20-minute Apollo 11 documentary exposed a background-tab rendering edge case: YouTube could mark the transcript engagement panel expanded before any `ytd-transcript-segment-renderer` rows existed.

Workflow v3 now waits for an actual transcript row. If rows do not render while the tab is inactive, it activates the YouTube tab without focusing the window, waits for rows, extracts the transcript, and restores the previously active tab.

Observed production runs:

| State | Result | Total |
| --- | --- | ---: |
| Panel already open/rendered | ~20,525 page-text chars, 12k continuation completed, no activation fallback | 4,622 ms |
| Cold/reloaded inactive tab | ~20,428 page-text chars, activation fallback used, previous active tab restored | 13,368 ms |

The cold path is slower because YouTube itself delays transcript-row rendering in an inactive tab, but it is bounded, verified, and no longer returns a false 2k “transcript” consisting mostly of page chrome.

These measurements are intentionally retained even when noisy; later improvements should append new evidence instead of rewriting history.

## Version and history policy

- Installed/stable extension remains **1.0.1** until a same-key signed successor is actually published and verified.
- Server-side workflows can receive new internal versions independently of the extension version.
- Existing migration files and release notes are not rewritten to make history look cleaner.
- Legacy Final 1 / Final 2 remain documented in `docs/releases/` until explicit retirement.
- New stable extension releases get their own `docs/releases/<version>.md`, GitHub Release, changelog entry, hash record, and acceptance evidence.

## Rollback

Server workflow changes are designed to be reversible through the existing workflow version registry. Edge Function changes retain prior Git revisions so an earlier implementation can be redeployed. Extension 1.0.1 remains the browser-side fallback while Phase 2 is unreleased.
