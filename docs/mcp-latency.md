# @last-edited: 2026-11-14 UTC+7.
# @title: mcp latency — the measured cost of the Opera Agent MCP tools, and where the floor really sits.
# @state: the numbers as measured on 2026-11-14 for release 1.6.51 on the remote MCP path, the transport floor from docs/api.md, and the two tools that could not be measured.
# @dependencies: none.

# The benchmark

Measured 2026-11-14, release 1.6.51, on the everyday browser: Opera on LAPTOP-6OU03OTB, paired device `opera-9` (plan.firm), driven through the **remote MCP path** that this machine's OpenCode actually uses:

```
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp
```

One call per tool, wall-clock around the call, on a fresh test tab (`example.com`, then `https://httpbin.org/forms/post`) that was created for this run and closed afterwards. Not a controlled lab: latencies include the network, the edge, the change channel and the page's own settle waits. Each number is one sample, indicative not rigorous — reruns move by hundreds of milliseconds.

## What was measured

| Tool | Latency | Note |
|---|---|---|
| `skill_recall` | 0.7 s | one sample |
| `press_key` | 1.3 s | |
| `stream_keys` | 1.3 s | three events |
| `switch_device` | 1.3 s | read-only mode (no arguments) |
| `read_page` | 1.4 s | `view: "brief"` |
| `dump_page` | 1.4 s | 3,000 char budget |
| `start_watch` | 1.5 s | arms a device-side watcher |
| `save_page` | 1.6 s | wrote a 1.478 byte scan to Downloads, deleted after |
| `record_start` | 1.7 s | warm; 10.9 s on the first ever arm |
| `list_tabs` | 1.9 s | 47 tabs |
| `media_state` | 6.4 s | page without a media element; answered `count: 0` |
| `check_update` | 2.5 s | installed 1.6.51, served 1.6.51, no update available |
| `find_elements` (role) | 1.9 s | five textboxes |
| `find_elements` (text) | 2.1 s | |
| `fill_element` | 2.4 s | |
| `scroll_page` | 2.4 s | `moved: false` (short page) |
| `run_browser_burst` | 2.2 s | read + find, two steps |
| `wait_events` | 2.7 s | 1,000 ms timeout, zero events, cursor 0 |
| `click_element` | 3.6 s | `stabilizationMs` 920 |
| `open_url` | 3.8 s | new tab |
| `browser_status` | 5.5 s | reported `bridge degraded`; the tools still worked |
| `capture_page` | 6.7 s | JPEG, 48 KB |
| `pointer` (wheel) | 6.1 s | |
| `navigate_tab` | 11.1 s | example.com to httpbin.org/forms/post |
| `stop_watch` | 11.2 s | slowest successful call |
| `close_tab` | 11.7 s | test tab |

## What could not be measured

| Tool | Why |
|---|---|
| `record_stop` | `record_start` armed twice (10.9 s cold, 1.7 s warm) but the stop path never returned a result: one `COMMAND_TIMEOUT` against `page.record_stop`, one `SESSION_NOT_ARMED`. No `latensi-test2.webm` was written; the first cycle's 2 KB `latensi-test.webm` was produced and then deleted. The armed session appears to have evaporated between calls on this machine — a real anomaly, not a latency number. |
| `statement_manifest` | the server stopped waiting before the browser reported back (`AWAIT_OUTCOME_UNKNOWN`); not retried, per the tool's own guidance |
| `activate_tab` | forces a tab to the foreground; the everyday window was in use, so this was not taken without explicit permission |
| `apply_update` | writes the next build over the folder and reloads the extension — the machine had just been updated to 1.6.51; not a measurement, a state change |
| `skill_save` | writes the shared skill memory; not a read |
| `statement_deliver`, `invoice_create` | real deliveries and real billing; not for measurement |
| `media_play`, `media_pause`, `media_seek`, `media_listen_read`, `media_stream_start`, `media_stream_stop` | no media element on the test tab; on an empty page these behave like `media_state` or fail with the same shape |
| `run_workflow`, `run_adhoc`, `run_program` | each needs a real definition — a workflow name, a task graph, a sealed program — and runs server-side effects; not a benchmark harness |

## The floor, from the transport that exists

`docs/api.md` carries the transport measurements this repo already made against the deployed bridge, from `opera_commands` timestamps. For one command inserted on a stable socket:

- insert to claim: 58, 146, 155, 205, 250, 256, 289, 297 ms — then, after the 100 ms claim poll: 24, 43, 84, 146, 160 ms —
- claim to complete on a trivial ping: ~486-810 ms.

The ~380 ms figure for a command through the hosted MCP function is the honest end-to-end term this table sits on. Adding page settle waits puts the fast tools at 1.3-2.7 s, exactly as measured above.

## Sub-256 ms, stated plainly

Sub-256 ms for the whole surface is not available on the remote path: the transport alone spends ~380 ms before the page is asked anything, and the README's own figure for the cloud path is ~380 ms per action. The one road that gets there is the local driver on this machine:

```
npm i -g opera-agent-mcp@1.6.51   # replaces the stale 1.6.46 install
```

then point the OpenCode MCP entry for `opera-agent` at `opera-agent-mcp local` instead of the remote URL (as of 2026-11 this machine's `~/.config/opencode/opencode.json` registers the remote one), and restart the session. The README measures the same action as under 1 ms through that road — the remaining milliseconds are the device's settle waits, not the transport.

Expectation on that road, tool by tool: state reads and page reads land in the low tens of milliseconds; `open_url`, `navigate_tab`, `capture_page`, `record_stop` and `close_tab` stay above 256 ms because the browser work itself — load, JPEG encode, record finalize, tab teardown — is real work, not overhead. Those can only be batched (`browser_burst`) or avoided, never compressed below the work they do.

Two further notes the record should keep:

- 256 ms is already the *median-ish* target printed by the poll tuning (insert-to-claim 24-160 ms with a 100 ms poll; halving that again buys ~50 ms and costs ten trivial indexed RPCs per second per connected device — not nothing, and not free).
- Merging verify-plus-enqueue into the await call would save ~100 ms but touches authentication and pinned RPC surfaces. `docs/api.md` records it as deliberately unwritten. It should stay that way until an owner decides otherwise.

## Reproducing this table

Drive a fresh tab on example.com, then httpbin.org/forms/post, and call each tool once with the wall clock around it. Delete the tab, delete the downloaded artifacts the tools write. What you should expect: the same order of magnitude, because the bottleneck is the path, not the caller.
