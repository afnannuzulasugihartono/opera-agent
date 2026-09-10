# Background execution support matrix

This matrix records the Opera Agent 1.2.0 baseline established by the two-tab real-Opera focus audit. "Verified" means the command completed against inactive tab B while user tab A remained active and the focused Opera window ID remained unchanged.

| Primitive | Classification | Evidence or constraint |
| --- | --- | --- |
| `browser.ping` | Background-safe | Extension-only metadata; no tab mutation. |
| `browser.burst` | Background-safe with safe steps | Verified with `find`, `wait`, `scroll`, `read`, trusted fill, and invisible pointer. `executionMode` defaults to background. Foreground pointer presentation requires an already active/focused target. |
| `tabs.list` | Background-safe | Verified. |
| `tabs.get` | Background-safe | Verified with an explicit inactive `tabId`. |
| `tabs.find` | Background-safe | Verified. |
| `tabs.open` | Conditional | Verified background-safe with `active: false`; `active: true` intentionally changes the active tab. |
| `tabs.activate` | Foreground-only | Its documented purpose is to activate a tab and optionally focus its window. |
| `tabs.close` | Conditional | Verified when closing an inactive tab. Closing the active tab necessarily changes which tab is active. |
| `tabs.navigate` | Background-safe | Verified with an explicit inactive `tabId`. |
| `tabs.reload` | Background-safe | Verified with an explicit inactive `tabId`. |
| `page.read` | Background-safe | Verified. |
| `page.query` | Background-safe | Verified. |
| `page.find` | Background-safe | Verified. |
| `page.collect_links` | Background-safe | Verified. |
| `page.click` | Background-safe | Synthetic and trusted CDP ref clicks both verified. |
| `page.pointer` | Conditional | Background mode dispatches invisible CDP coordinates directly to inactive tab B. Wheel actions report their actual scroll container and use a deterministic DOM fallback only if debugger input cannot move it. Foreground mode displays the overlay and returns `FOREGROUND_REQUIRED` unless the target is already active/focused. Neither mode activates a tab automatically. |
| `page.fill` | Background-safe | DOM fill and trusted CDP `Input.insertText` are verified. Input and `contenteditable` focus inside tab B did not activate tab B. |
| `page.focus` | Background-safe | Verified. DOM focus inside tab B did not activate tab B. |
| `page.scroll` | Background-safe | Verified with before/after document metrics, movement/mutation settling, and boundary state. |
| `page.key` | Background-safe on fixture | Synthetic and trusted CDP keys verified. Broader site compatibility remains Checkpoint 2C. |
| `page.wait_for` | Background-safe | Verified. |
| `media.state` | Unresolved | Uses the background content channel, but needs a media fixture and site coverage. |
| `media.play` | Unresolved | Browser autoplay/site policies need targeted verification. |
| `media.pause` | Unresolved | Needs a media fixture and site coverage. |
| `media.seek` | Unresolved | Needs a media fixture and site coverage. |

## Regression invariant

The harness creates two normal Opera tabs in one temporary profile. Tab A is activated as the simulated user tab, while all audited commands explicitly target inactive tab B. Before and after each command it records:

- focused window ID;
- active tab ID and URL;
- automation target tab ID;
- command success and focus-preservation result.

The test fails immediately if either the focused window ID or active tab ID changes. This is a browser-level invariant; it does not claim that every website accepts background CDP input. Site and canvas compatibility belongs to Checkpoint 2C.

## Checkpoint 2C input matrix

| Input path | Inactive normal DOM | Controlled canvas/editor | Google Maps | Focus behavior |
| --- | --- | --- | --- | --- |
| `Input.dispatchMouseEvent` | Pass | Canvas click pass in real Opera | Background search-button click pass in isolated Chromium | Active tab/window unchanged |
| `Input.dispatchKeyEvent` | Pass | Navigation key pass in real Opera | Available as the ref-first fallback | Active tab/window unchanged |
| `Input.insertText` | Input replacement pass | `contenteditable` replacement pass in real Opera | Search query insertion pass in isolated Chromium | Active tab/window unchanged |
| Visible pointer overlay | Pass only on active/focused target | Foreground diagnostic only | Foreground diagnostic only | Inactive target returns `FOREGROUND_REQUIRED` |

Google Maps cannot be scripted by an unpacked extension in Opera's isolated test profile because Opera applies an `ExtensionsSettings` policy to that domain. The same generic extension path passes on live Google Maps in isolated Chromium. Final validation on the signed, installed Opera identity therefore remained part of Checkpoint 2D production acceptance; the daily Opera profile was not modified by the automated harness.

Production acceptance of 1.3.0 showed that installed Opera could accept CDP input while Google Maps ignored the event because the inactive document reported itself unfocused. Version 1.3.1 therefore enables `Emulation.setFocusEmulationEnabled` only around each background debugger input call and disables it in a `finally` path. This changes the page-reported focus state briefly without activating the real tab, focusing its window, or taking the operating-system pointer/keyboard.

The signed 1.3.1 production build passed the background Google Maps burst and coordinate-click acceptance while the target remained inactive. Version 1.4.0 subsequently completed adaptive-screenshot production acceptance. Version 1.5.0 adds generic nested-scroll observability and passed background production acceptance on Google Maps, YouTube, and GitHub while keeping the same focus-preservation invariant.
