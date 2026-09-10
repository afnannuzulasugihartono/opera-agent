# Background execution support matrix

This matrix records the Opera Agent 1.2.0 baseline established by the two-tab real-Opera focus audit. "Verified" means the command completed against inactive tab B while user tab A remained active and the focused Opera window ID remained unchanged.

| Primitive | Classification | Evidence or constraint |
| --- | --- | --- |
| `browser.ping` | Background-safe | Extension-only metadata; no tab mutation. |
| `browser.burst` | Background-safe with safe steps | Verified with `find`, `wait`, `scroll`, and `read`. A burst containing `pointer` remains foreground-only. |
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
| `page.pointer` | Foreground-only | Correctly rejected on an inactive target without changing focus. |
| `page.fill` | Background-safe | Verified. DOM focus inside tab B did not activate tab B. |
| `page.focus` | Background-safe | Verified. DOM focus inside tab B did not activate tab B. |
| `page.scroll` | Background-safe | Verified. |
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
