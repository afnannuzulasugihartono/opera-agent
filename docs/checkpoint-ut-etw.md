# Checkpoint U-T — Event-Triggered Workflows (LiveWatch) (2026-09-22)

## Motivation (owner's diagnosis, confirmed by live data)

The remaining latency after U-S was the model round trip itself: AI requests a
snapshot → agent reads the tab → AI analyzes (seconds) → AI sends the next
request. The T041 1.6.4 audit showed a 14.1 s find→click gap; even after the
645.7 ms burst, the full task loop is dominated by model thinking time between
trips. The requested architecture eliminates the trip pattern, not just its
cost: the device watches the page live and reacts locally; the AI subscribes
to events instead of polling snapshots.

## Research grounding

- **Trigger-Action Programming** (Sugilite line, UIST; survey arXiv
  2504.19838): the model compiles intent into event-condition-action rules
  that execute locally; the model leaves the reactive loop.
- **Playwright actionability doctrine**: synchronize on UI state and events,
  never poll snapshots or sleep between model trips.
- **Plan-then-execute** (JIT-Planner ICML 2026: 10.4x faster; UI-TARS class):
  one planning trip, local execution. Contrast: OpenAI CUA and Anthropic
  computer use still run per-step screenshot→model loops — the exact pattern
  removed here.

## Architecture (1.6.6)

```
Platform AI (GPTs/Actions · Claude/MCP · n8n · curl) — ONE trip:
  start_watch { trigger, action, mode, deadlineMs, maxEvents }
  … model MAY go idle …
DEVICE: content.js reports FACTS on mutations (presence/url/adState/mediaTime/
  text) → background evaluates rules via lib/watch.js (pure, Node-tested)
  → match fires ±50 ms → LOCAL action (page.click trusted path / burst /
  relay workflow) → watch_event → bridge → opera_watch_events
MODEL: wait_events long-poll (opera_watch_events_wait, 5 ms SQL ramp then
  deadline) → returns the instant an event lands, with action evidence.
Universal fastpath: opera-agent-gateway POST /command = ONE HTTP hop
  (opera_run_fast: enqueue + adaptive await in a single SQL call);
  GET /openapi.json is GPT-Actions-ready (token via body.apiKey — GPT
  Actions cannot set custom headers).
```

Key semantics (locked by tests/etw-watch-engine.test.mjs, 8/8):
already-true-at-arm fires immediately (the T041 lesson); selectorGone fires
only after observed presence; once-rules retire; debounce throttles repeats;
deadline/maxEvents bound every rule; 8 watchers/tab, 32 global, fail-closed.

Safety: rules are scoped to an explicit tab; site knowledge (ad selectors)
lives in the RULE supplied by the model — the extension stays site-agnostic
(governance test enforced); watch.* is an internal extension family (protocol
stays frozen at 26 primitives); the gateway verifies the device token via
opera_verify_device before touching the queue.

## Evidence

- Browser regression (Edge headless, EXIT=0): `ut.watch.start` arms on the
  U-I fixture; a control that appears 1.2 s AFTER arming is clicked locally
  (`SavedByWatcher` marker present) with zero model trips; `watch.list`
  reflects the registry.
- Node suite 471/472 (the single fail is the pre-existing local-governance
  artifact #250, unrelated); `check` PASS at 1.6.6.
- MCP inventory 19→22 (`start_watch`, `wait_events`, `stop_watch` — all
  OBSERVATION class in the transaction decision table); contracts,
  thresholds, and hash-locks rebaselined with this recorded reason.
- Gateway bridge latency budget: ~180–230 ms infra per one-hop command
  (vs ~350 ms two-hop), plus adaptive await saving 25–75 ms on MCP path.

## Rollout

Hosted deploy: migration (events table + wait/adaptive/run_fast/verify RPCs)
applied through the audited DPAPI write path; gateway deployed through the
Management API. CRX 1.6.6 packed/signed offline and uploaded INACTIVE; live
acceptance (watcher skips a real YouTube ad with zero analysis trips) gates
activation per repo policy.
