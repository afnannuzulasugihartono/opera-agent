# @last-edited: 2026-11-11 UTC+7.
# @title: latency - every tool, both roads, measured on the everyday browser.
# @state: the numbers, how they were taken, and the two defects the measuring found.
# @dependencies: scripts/latency-benchmark.mjs, scripts/start-bridge.mjs.

# WHAT WAS MEASURED, AND WHERE

Measured on 2026-11-11 on the everyday machine: the local road over the loopback
bridge (the same browser, the same commands, no relay), and the hosted road
through the MCP function over the relay. The fixture is a page with a field, a
button and a hundred rows; the local run serves its own copy, the hosted run
drives the same page over the relay.

The local numbers are reproducible with `npm run bridge` in one terminal and
`npm run benchmark:latency` in another. The hosted numbers are what an agent
with the hosted MCP configured pays, and they are reproducible by timing the
same calls through that client.

# THE LOCAL ROAD (p50 / p95, 7 runs each, milliseconds)

| Tool | p50 | p95 |
| --- | --- | --- |
| `read_page` | 13 | 14 |
| `find_elements` | 3 | 4 |
| `click_element` | 4 | 5 |
| `fill_element` | 4 | 5 |
| `press_key` | 47 | 48 |
| `stream_keys` | 46 | 48 |
| `pointer` | 1 | 2 |
| `scroll_page` | 1 | 1 |
| `activate_tab` | 1 | 2 |
| `capture_page` | 61 | 8023 |
| `run_browser_burst` | 1 | 1 |
| `run_workflow` | 1 | 1 |
| `run_program` | 1 | 1 |
| `run_adhoc` | 1 | 3 |
| `start_watch` | 1 | 1 |
| `wait_events` | 1 | 1 |
| `stop_watch` | 1 | 1 |
| `navigate_tab` | 1 | 1 |
| `open_url` | 201 | 204 |
| `close_tab` | 1 | 1 |
| `browser_status` | 5 | 7 |
| `list_tabs` | 1 | 1 |
| `statement_manifest` | 1 | 1 |
| `invoice_create` | 1 | 1 |

Two numbers are worth reading twice. `capture_page` has a p50 of 61 ms and a p95
of 8.0 s, because the first capture attaches the debugger and the rest do not.
`press_key` and `stream_keys` sit at ~47 ms because the key is sent and then the
page is asked whether it landed.

# THE HOSTED ROAD (p50 / p95, 5 runs each, milliseconds)

| Tool | p50 | p95 |
| --- | --- | --- |
| `read_page` | 1322 | 8549 |
| `find_elements` | 1408 | 1561 |
| `list_tabs` | 1335 | 3326 |
| `browser_status` | 1325 | 1396 |
| `scroll_page` | 2092 | 3182 |
| `activate_tab` | 1315 | 1739 |
| `capture_page` | 2627 | 11914 |
| `fill_element` | 1473 | 1516 |
| `press_key` | 1425 | 1883 |
| `stream_keys` | 1404 | 2015 |
| `pointer` | 1447 | 1533 |
| `run_browser_burst` | 1708 | 1968 |
| `skill_recall` | 727 | 945 |
| `statement_manifest` | 1361 | 2293 |
| `media_state` | 1327 | 1501 |
| `run_workflow` | 1819 | 10128 |
| `run_adhoc` | 2017 | 2488 |
| `start_watch` | 1522 | 2513 |
| `stop_watch` | 1228 | 1246 |
| `navigate_tab` | 1281 | 1538 |
| `open_url` | 1263 | 1455 |

# WHAT THE MEASURING FOUND

**The hosted road waited ten seconds for work the device had already done.** The
device claimed the command in 28 ms and completed it in 414 ms, the function's
own HTTP leg cost about 950 ms, and the caller still waited about ten seconds -
which is also how calls began failing with `AWAIT_OUTCOME_UNKNOWN` as the
function's own 12 s budget expired.

The cause was the wait, not the transport. The edge function reaches the
database through PostgREST, and both of its waits - the result and the progress
stream - parked a PostgREST connection for as long as the command took. A few
calls in flight filled PostgREST's pool, and every later call queued behind
them. The waits are now asked in 250 ms slices, so a connection is held for a
slice and not for a command, and the p50 above is what is left: the relay hop
plus the function's own leg.

**The local road could be taken by a debugging port.** The extension asked "did
anything answer on this port" when it looked for the loopback bridge, and a
Chrome running with a remote debugging port answers on 9222. The extension took
it for a bridge, dialled a debugging endpoint forever, and reported "port 9222
discovered" while never linking. The probe now asks the bridge's own question,
so a responder that cannot answer it is not a bridge.

# WHAT THE TWO ROADS COST, IN ONE LINE

The local road answers in single-digit milliseconds for most tools and never
leaves the machine; the hosted road answers in about 1.3 seconds for the same
tool, which is the relay hop and the function's own leg. A hundred calls is a
difference between a second and two minutes.
