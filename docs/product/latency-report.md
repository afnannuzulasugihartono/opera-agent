// @last-edited: 2026-11-03 UTC+7.
// @title: latency-report — the numbers the handoff quotes, and the command that re-measures them.
// @state: the baseline measured before the wait and burst change, the same bench after it, and what moved.

# Latency, measured

The local driver's cost was measured on 2026-11-03 with
`node scripts/latency-benchmark.mjs --runs=15`: Google Chrome, headless, a 100-row
fixture, the real driver and the real MCP surface. Both runs are the same command on
the same machine, so the difference is the change and not the hardware.

## What moved

| Tool call | Before, p50 | After, p50 | Why |
|---|---|---|---|
| `wait_for` (found) | 41.96 ms | 2.97 ms | the wait had already settled the page; the look settled it a second time |
| `browser_burst`, click → wait_for_row → wait | three calls, ~150 ms | one call, 48.54 ms | a burst can now wait inside itself |
| `click` | 48.02 ms | 48.14 ms | unchanged |
| `read_page` | 41.12 ms | 41.67 ms | unchanged |

A wait that found its text used to answer in 41.96 ms because the look after it paid
the 32–120 ms settle again: the wait polls until the page stops moving, and the reply's
automatic page look then asked the same question. `wait_for`, `wait_for_row` and
`wait_still` now hand their own settle verdict on, the same way `stream_keys` already
did, so that round trip is gone. A wait that timed out is unchanged: it did not settle.
`wait_still` also stopped claiming a settle after two reads on a page that never went
quiet; only `still: true` is passed on now, so a look after a timed-out wait settles for
itself.

The second change is for tasks that used to need several calls. `browser_burst` takes
`wait` and `wait_for_row` steps, so "click the button, wait for the row it raises, wait
for the text it writes" is one call with one page look, and the wait steps inside it
settle the page themselves. The page does not move between the click and the first look
in the fixture, so the burst costs the same 48 ms it cost for three resolves; on a page
that really moves, the wait is the price of being right instead of fast.

## What was not changed, and why

- Every input tool still looks at the page after acting (`click` 48 ms, `click_row`
  48 ms, `press_key` 70 ms). That look is what makes one action into one decision, and
  removing it would trade a round trip for a second call by every agent that needs to
  see what happened.
- The settle itself was measured at 41.90 ms p50. Its floor is 32 ms of quiet, which is
  the page watching itself between two Node polls; a shorter quiet window was not tried
  because a menu that opens a frame late is exactly what the settle exists to catch.
- `read_page` at 41.67 ms is the page read plus its own settle; it is the cost of a
  correct read, not a defect.

## Reproducing it

```bash
node scripts/latency-benchmark.mjs --runs=30
```

The script launches its own headless browser on a throwaway profile, serves its own
fixture, and kills both on the way out. No user tab, profile or credential is touched.
