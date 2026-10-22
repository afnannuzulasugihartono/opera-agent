# Browser latency: architecture and measured bottlenecks

Status: investigation, then implemented. The local burst, the Node-polled settle,
and the read second-sample settle are in the tree and gated by tests. The 50 ms key
beat and the OS focus tail are unchanged.

Measured: 2026-10-22, Windows, Node 22.22.2, headless Chrome 153, local CDP.
The fixture is a synthetic page with 100 rows; a 5,000-row page is used for scaling.
The numbers below are code-path numbers, not model-turn numbers. The real-page
checks used the already-open Chrome on debugging port 9450; no document text was
edited.

## TL;DR

The local CDP primitives are already fast: a click is ~1.4 ms, a snapshot ~1 ms,
and a `pageState` read ~0.4 ms. The slow part is what the MCP tool adds around
them:

- `afterAction()` used to always sleep `SETTLE_MS = 120` ms, then took a snapshot
  and a page state. A `click` tool call measured **p50 137.9 ms**, while the click
  itself measured **p50 1.4 ms**. It now polls a Node settle: **p50 46.3 ms** on
  the same job and machine, with the page watching itself through a
  `MutationObserver`.
- `read_page()` used to always sleep 100 ms for a second read. It measured
  **p50 106.77 ms** on the small page before, and **p50 45.34 ms** after the
  second sample began waiting on the same Node-polled settle.
- Every chord pays `KEY_BEAT_MS = 50` ms. `Ctrl+A` measured **p50 61.5 ms**.
- `wait_for` calls `read()` and then `afterAction`; even when the text is
  already present it measured **p50 230.4 ms** before the settle change. The
  read inside each poll is now a settle rather than a fixed 100 ms sleep, but
  the wait itself still polls on a timer.
- `wait_still` has a 400 ms quiet window plus 120 ms polling; it measured
  **p50 512 ms** directly and **p50 632.6 ms** through MCP.
- When the page reports no focus, the OS window query measured **p50 1.14 s**
  (n=3, p95 1.74 s). That is the worst tail in the code path.
- The local path is much cheaper than the cloud path, but a tool call is not
  "under 1 ms": the README's `<1 ms` is per CDP primitive, not per MCP call.

The biggest latency lever is not another CDP command. It is **fewer round trips**:
one local burst for dependent steps, and event-driven waits instead of sleeps.
Both are now in the local surface: `browser_burst` runs 1-8 dependent steps and
pays one final `afterAction`; the settle watches the page and stops on quiet.
The model turn is outside this harness and was not measured; on a real agent run
it can still dominate everything below.

## Architecture: the local path

```
MCP client (stdio)
  -> local/bin/opera-local.js
     -> createMcpServer(context)
        -> tools/call
           -> resolvedTab()          // fallback.tabs(): one tab listing
           -> driverFor(tabId)       // context.resolveTab(): another listing
              -> sessionStore.open()
                 -> openSession()
                    -> bridgeReachable()
                       ? openBridgeSession()  -> extension loopback -> chrome.debugger
                       : CDP WebSocket       -> /json/list -> target WebSocket
                    -> createPrimitives(cdp)
           -> INPUT_TOOLS: driver.ensureFront()
              -> page hasFocus()     // one Runtime.evaluate
              -> if false: windowState() -> PowerShell window enumeration
           -> action primitive(s)
           -> afterAction()
              -> settle()            // MutationObserver + Node clock, 32/120 ms
              -> snapshot(60)        // DOM walk in Runtime.evaluate
              -> pageState()         // body.innerText + focus
```

The device path in the extension is the same CDP primitives over a loopback
socket. The cloud path is a different, slower road:

```
MCP client -> Supabase edge function -> Postgres enqueue/await
           -> device command row -> extension socket -> chrome.debugger
           -> Postgres -> edge function -> client
```

The cloud path pays isolate boot and database crossings before the browser sees
anything. This report does not re-measure it; existing code comments record
~1.8 s for an edge isolate boot, 269/417 ms for two data-API crossings, and
238 ms browser work against 496 ms transport for a six-step burst
(`supabase/functions/opera-agent-mcp/index.ts:660`,
`supabase/functions/opera-agent-mcp/index.ts:243`,
`extension/worker/execute-pull.js:148`).

## Measurements

### Direct primitives and local MCP tools

| Operation | p50 | p95 | Notes |
|---|---:|---:|---|
| `pageState` | 0.36 ms | 0.44 ms | 100-row page |
| `snapshot(60)` | 1.01 ms | 1.42 ms | 100-row page |
| `click` primitive | 1.38 ms | 2.05 ms | includes viewport + hit test |
| `clickRow` primitive | 5.27 ms | 5.92 ms | snapshot + resolve + box + click |
| `type` primitive | 1.59 ms | 2.28 ms | normal input, edit landed immediately |
| `find("Row")` | 0.51 ms | 0.71 ms | 100-row page |
| `read` primitive | 108.08 ms | 110.53 ms | includes 100 ms sleep |
| `key("a", ["Control"])` | 61.50 ms | 62.69 ms | includes 50 ms beat |
| `waitForText` (already present) | 0.32 ms | 0.36 ms | one read, no settle |
| `waitForStill` | 512.02 ms | 523.34 ms | 400 ms quiet + polling |
| `openTab + openSession` | 34.47 ms | 71.96 ms | one-time per tab, n=5 |
| `Page.bringToFront` | 0.66 ms | 13.41 ms | headless; real browser unverified |

### Local MCP tool calls

These were measured by calling `createMcpServer.handle()` directly, not by
writing JSON-RPC through the stdio pipe. The stdio framing and JSON
serialization are not included; the browser and `afterAction` work is.

| Tool call | p50 | p95 | What dominates |
|---|---:|---:|---|
| `click` | 137.87 ms | 140.11 ms | 120 ms settle + snapshot/pageState |
| `click_row` | 138.75 ms | 141.46 ms | 120 ms settle + snapshot/pageState |
| `press_key` | 183.73 ms | 186.80 ms | 50 ms key beat + 120 ms settle |
| `read_page` | 107.13 ms | 109.45 ms | 100 ms second-read sleep |
| `wait_for` (found) | 230.39 ms | 232.50 ms | 100 ms read + 120 ms settle |
| `wait_still` | 632.57 ms | 634.82 ms | 400 ms quiet + 120 ms settle |
| `ax_snapshot` | 1.01 ms | 1.13 ms | no afterAction |

### Scaling on a 5,000-row page

| Operation | p50 | p95 |
|---|---:|---:|
| `snapshot(60)` | 3.96 ms | 5.10 ms |
| `snapshot(120)` | 4.57 ms | 4.98 ms |
| `pageState` | 3.82 ms | 12.17 ms |
| `find("Row 4999")` | 23.03 ms | 23.32 ms |
| `read` | 151.85 ms | 154.93 ms |

The snapshot's DOM walk is bounded by the 60/120 row cap, but
`querySelectorAll(CANDIDATES)` still scans the whole document, and `nameOf`
reads `innerText`. The page-state read gets more expensive as `body.innerText`
grows. The fixed sleeps still dominate both.

### Post-change: local settle and local burst

Same machine, same 100-row fixture, same headless Chrome launch, same job. The
`before` column is the tree at the investigation commit; the `after` column is
the current tree. The three-call job is `click_row` -> `press_key Tab` -> `hover`.

| Operation | Before p50 | Before p95 | After p50 | After p95 | What changed |
|---|---:|---:|---:|---:|---|
| `driver.settle()` | n/a | n/a | 46.06 ms | 47.53 ms | Node polls a `MutationObserver`; 32 ms quiet, 120 ms cap |
| MCP `click` | 136.82 ms | 139.34 ms | 45.73 ms | 47.40 ms | one settle instead of `sleep(120)` |
| MCP `click_row` | 137.78 ms | 139.13 ms | 46.04 ms | 47.20 ms | same |
| MCP `press_key` | 182.97 ms | 185.45 ms | 106.85 ms | 108.89 ms | 50 ms key beat still pays; settle no longer does |
| MCP `read_page` | 106.77 ms | 108.18 ms | 45.34 ms | 47.06 ms | second sample waits on settle, not `sleep(100)` |
| three dependent MCP calls | 456.94 ms | 463.65 ms | 198.98 ms | 201.52 ms | each call now settles once |
| one `browser_burst` of those three steps | n/a | n/a | 107.87 ms | 109.14 ms | one settle and one page look at the end |

A read-only `browser_burst` also passed on the real, already-open Google Docs
and Google Sheets tabs (debugging port 9450, no click, no key, no navigation):

| Real page | settle p50 | settle p95 | burst result |
|---|---:|---:|---|
| Google Docs | 45.78 ms | 46.71 ms | 2 `resolve` steps, two handles, text unchanged |
| Google Sheets | 45.94 ms | 47.21 ms | 2 `resolve` steps, two handles, text unchanged |

One non-destructive Docs menu burst was driven in a temporary tab: click
`Insert` 31 ms, wait for `Image` 6 ms, `Escape` 72 ms, `ok:true`, three steps
completed, then the temporary tab was closed. The script's wall time was 2,031 ms
because it also opened a tab and waited for the document to be idle; those are
not action timings. No document text was edited.

The hidden-tab trap is recorded because it cost real time: the first settle
shape waited in the page with `setTimeout(120)`, and a hidden Google Doc clamped
that timer. That intermediate shape measured **p50 998.93 ms / p95 1,009.30 ms**,
while `snapshot(120)` of the same page took **4.28 ms**. Moving the quiet clock
to Node is what brought the same page to 46 ms.

### OS focus tail

| Operation | p50 | p95 | n |
|---|---:|---:|---:|
| `document.hasFocus()` | 0.27 ms | 0.31 ms | 20 |
| `windowState()` (PowerShell) | 1,139.55 ms | 1,740.17 ms | 3 |

`ensureFront` asks the page first. When the page reports no focus, it runs a
PowerShell window enumeration with `Add-Type`; that is the 1.1 s path. If the
window is minimized, it also runs a second PowerShell script to focus it.
`focusWindow` was not run in this investigation because it changes the user's
desktop focus.

### Bridge

The live extension was not connected during this run (`bridgeReachable()` was
false), so the real extension path is **unverified**. A synthetic loopback
device on the same `bridge-server` measured:

| Operation | p50 |
|---|---:|
| `ping` round trip | 0.11 ms |
| `tabs.list` round trip | 0.11 ms |
| `ping + tabs.list` (what `attempt()` does by default) | 0.22 ms |

The loopback frames themselves are not the problem. The production cost is in
the extension/worker path and in the per-command liveness proof
(`local/bridge.js:124-168`): `attempt()` sends a `ping` before every command
unless `OPERA_BRIDGE_TRUST_MS` is set. Each CDP primitive is therefore two
bridge commands, not one. That is a code-level finding; its real p50/p95 over
the extension is unverified.

## Ranked findings

### 1. Fixed settle after every action — fixed, with a hidden-tab caveat

`afterAction()` used to wait `SETTLE_MS = 120` unconditionally. It now calls
`driver.settle()`, which arms a `MutationObserver` in the page and polls it from
Node every 8 ms until the page has been quiet for 32 ms or the 120 ms cap is
reached. The 120 ms path remains only as a fallback for a driver with no
`settle()`.

Measured on the same job and machine, MCP `click` fell from **p50 136.82 ms** to
**p50 46.26 ms**, and MCP `click_row` from **p50 137.78 ms** to **p50 46.06 ms**.

The caveat is the one that matters on real pages: a page-side `setTimeout` is
not a safe clock for a hidden tab. The first settle shape waited in the page and
a hidden Google Doc clamped it to **p50 998.93 ms**. The shipped shape keeps the
observer in the page but reads it from Node; the same hidden Doc settles at
**p50 45.78 ms**. Any future settle must keep its clock off the page.

### 2. `read_page` always pays 100 ms — fixed

`read()` used to read the page, sleep 100 ms, then read again to say `settled`
and `grewBy`. The second sample is still there, because `readyState` is not a
signal that a page finished rendering itself — measured live on YouTube, 871
characters at `complete` and 8,478 two seconds later. The fixed sleep is gone:
the second sample now waits on the same Node-polled settle, so a settled page
pays one beat instead of a hundred milliseconds.

Measured on the same fixture and machine: MCP `read_page` fell from **p50
106.77 ms / p95 108.18 ms** to **p50 45.34 ms / p95 47.06 ms**. The Google Docs
path still reports `settled: null`, because a second selection copy would move
the caret twice; that is a correctness cost, not a latency one.

### 3. Key chords pay 50 ms each

`key()` sleeps `KEY_BEAT_MS = 50` between keyDown and keyUp
(`local/primitives.js:520,531`; constant at
`local/page-expressions.js:529`). `Ctrl+A` measured 61.5 ms. A 20-chord walk
costs ~1.2 s of pure sleep.

The comment in `primitives.js` says the two-event chord is already the fast,
correct frame for Docs. The 50 ms beat is therefore a reliability tax that may
be reducible to one frame or ~10 ms, with a Docs/Sheets regression test.

**Expected saving:** ~50 ms per chord; ~1 s per 20-chord menu walk.

### 4. Polling waits and a read inside each poll

`wait_for` (`local/mcp-server.js:794-809`) loops over `driver.read()` with a
default 250 ms interval. Each read still takes two samples, but the gap between
them is now the settle rather than a fixed 100 ms sleep. A condition that is
already true still measured 230 ms before the settle change because
`afterAction` runs afterwards.
`wait_for_row` polls a snapshot every 150 ms
(`local/mcp-server.js:818-825`), and `wait_still` polls every 120 ms with a
400 ms quiet window (`local/mcp-server.js:826-831`).

A local event-driven wait (MutationObserver / `Page.lifecycleEvent` /
`Network` idle, with a deadline) would return as soon as the condition is true
instead of polling. The cloud surface already has `start_watch` and
`wait_events`; the local surface does not.

**Expected saving:** the poll interval plus the read settle on every wait; the
biggest win for pages that change quickly.

### 5. OS focus query is a 1.1 s tail

`ensureFront` asks the page first, which is cheap (0.27 ms). If the page says
no focus, it asks the OS (`local/focus-guard.js:39-60`), which runs PowerShell
with `Add-Type` (`local/window-focus.js:127-129`) and measured p50 1.14 s.
The machine answer is cached for only 1.5 s (`local/focus-guard.js:34`).

This is not on every action when the tab is fronted. It is a p95 problem for a
minimized browser or a tab that lost focus mid-drive. A longer cache, or
`Browser.getWindowBounds`, would remove most of it.

**Expected saving:** up to ~1.1 s per input in the bad case; this is the tail
that makes a job feel stuck even when p50 looks fine.

### 6. Duplicate tab listing and per-switch front

`resolvedTab()` lists tabs (`local/mcp-server.js:675-684`), then
`driverFor()` calls `context.resolveTab()` again (`local/mcp-server.js:650-660`).
On direct CDP this is ~0.2 ms; over the bridge it is two tab-list commands plus
pings. The session store also calls `front()` on the first touch of every tab
(`local/sessions.js:104-115`); `Page.bringToFront` is one-time per switch, not
per action, but it is awaited.

**Expected saving:** small on direct CDP, larger on the bridge and on tab-heavy
jobs. Fix by passing the resolved tab into the driver lookup and by making
front optional/background.

### 7. The cloud path is architecturally slower

The edge function, Postgres queue, device row, and extension socket add
seconds before the browser acts. Moving the decision loop local is the only way
to get local milliseconds. The cloud path remains useful for remote work and
audit, not for the hot loop.

## What is not measured

- **Model-turn time.** The largest end-to-end cost is outside this harness. A
  real job's p50/p95 must include model time, not just tool time.
- **A full end-to-end job.** The local burst and settle are measured on a
  fixture and on read-only/menu checks on real Docs and Sheets; a real 20-step
  bookkeeping job was not driven.
- **Bank portals and other real portals.** Only Docs and Sheets were touched.
- **Live extension bridge.** The extension bridge was not connected; only the
  synthetic loopback frames were measured.
- **Real minimized-window focus.** `focusWindow` was not run because it changes
  the user's desktop.
- **Cloud path.** Existing comments are cited, not re-measured.

## Recommended order

1. **Local burst — done.** `browser_burst` is one MCP call for 1-8 dependent
   steps, stops on failure, carries `refFromStep`, and returns per-step results
   with one final `afterAction`. It is single-tab only; no navigation, upload,
   download, or script.
2. **Event-driven settle — done.** The 120 ms sleep is replaced by a Node-polled
   `MutationObserver` settle. The clock must stay in Node; a hidden tab clamps a
   page-side timer.
3. **Local watch/wait:** one in-page wait that resolves on a mutation or
   lifecycle event, with `wait_for`, `wait_for_row`, and `wait_still` built on
   it.
4. **Read second-sample settle — done.** `read()` still takes two samples, but
   the gap between them is the settle, not a fixed 100 ms sleep. A caller that
   wants one read can still take `ax_snapshot` or `read_page` and read the
   `settled` field it is given.
5. **Reduce the key beat** to one frame or ~10 ms, with Docs/Sheets tests.
6. **Focus cache / `Browser.getWindowBounds`**, only after the above.
7. **Bridge trust window during a burst**, and pass the resolved tab once.

Guardrails stay: no raw CDP/eval tool, no stealth or OTP bypass, no credential
storage, no per-site code in the extension. Every change needs a test and a
before/after p50/p95 on the same job and machine.

## Reproduce

The measurements were taken with ad-hoc Node scripts in the session temp
directory; they are not committed. The scripts launch a separate headless
Chrome with a temp `--user-data-dir`, serve a local fixture, import
`local/driver.js`, `local/sessions.js`, `local/mcp-server.js`, and time each
operation with `performance.now()`. No user tab, profile, or credential was
used.
