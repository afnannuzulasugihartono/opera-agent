# Opera Agent roadmap

This is the current execution plan after the stable 1.3.1 background-input release. Historical phase descriptions remain in the repository as evidence; this document is the source of truth for upcoming work.

## Product invariant

Normal automation must not activate a tab, focus an Opera window, move the operating-system cursor, or redirect the user's keyboard input. The tab the user is viewing and the tab the agent is operating are independent.

```text
userActiveTab != automationTargetTab
```

Foreground interaction is an explicit exception. A background failure must return `FOREGROUND_REQUIRED`; it must not silently activate a tab or focus a window.

## Budget envelope

With 50 percentage points of ChatGPT usage available, use a stop-and-verify budget rather than attempting all remaining work in one run:

| Work | Budget cap | Stop condition |
| --- | ---: | --- |
| Milestone 2: background-first execution | 20 points | production no-focus acceptance passes |
| Milestone 3: adaptive screenshots | 15 points | bounded background capture passes |
| Milestone 4: vision-guided navigation | 10 points | bounded observe/act/verify loop passes |
| Debug and release reserve | 5 points | used only for regressions or rollout |

The percentages are planning caps, not guaranteed usage measurements. Stop at each checkpoint if its acceptance evidence is missing.

## Milestone 1 — bounded browser bursts

Status: **complete in Opera Agent 1.2.0**.

- `browser.burst` executes 1-8 validated same-tab page actions through one relay command.
- `run_browser_burst` exposes the capability through MCP.
- The extension preserves the existing signing identity, pairing, protocol 1, and local safety enforcement.
- Production acceptance completed three steps in 7.6 ms browser time and 613 ms queue-to-result.

## Milestone 2 — background-first execution

Priority: **P0**. Target: the next backward-compatible feature release, expected SemVer 1.3.0; do not change protocol 1 unless testing proves it unavoidable.

### Checkpoint 2A — focus audit and regression harness

Status: **complete on the Opera 1.2.0 baseline**. The real-Opera harness preserved user tab A and the focused window across all 22 audited command executions. See `docs/background-execution.md` for the support matrix; media actions remain explicitly unresolved for Checkpoint 2C rather than being assumed safe.

- Classify every primitive as background-safe, explicitly foreground-only, or unresolved.
- Add a two-tab real-Opera fixture: tab A remains user-active while tab B is the automation target.
- Record active tab ID, focused window ID, and target tab ID before and after every tested command.
- Fail the test if a background command changes the active tab or focused window.
- Cover `read`, `query`, `find`, `collect_links`, `wait_for`, `scroll`, fill, synthetic click, trusted CDP click/key, navigation, reload, and burst.

Exit criterion: the test can reliably detect focus theft before behavior is changed.

### Checkpoint 2B — safe MCP and tab defaults

Status: **implemented, deployed as MCP Edge Function version 9, and locally verified**. Runtime schema inspection confirms explicit `tabId` requirements and background defaults; the real-Opera two-tab suite passes. Final acceptance from the connected ChatGPT session remains pending before this checkpoint is marked complete.

- Make `open_url` default to `active: false`.
- Require or propagate an explicit `tabId` after the automation target is selected. Do not fall back to the user's active tab during a multi-step task.
- Update MCP instructions to prefer background tabs and forbid `activate_tab` unless the user asks to see the tab or explicitly permits foreground interaction.
- Keep `activate_tab` available as an explicit tool; never call it as an implicit recovery step.
- Introduce `executionMode: "background" | "foreground"` where input behavior needs the distinction. Default to `background`.
- Do not add an `auto` mode that can silently take foreground. Background failures return structured `FOREGROUND_REQUIRED` details.

Exit criterion: ordinary MCP open/read/find/click/fill/key flows do not activate or focus their target tab.

### Checkpoint 2C — background CDP input matrix

Status: **implemented and verified on controlled real-Opera fixtures plus live Google Maps in isolated Chromium**. Background mouse, key, and text CDP paths preserve the active tab/window; the support matrix records the isolated Opera policy limitation. Signed installed-Opera acceptance remains gated with Checkpoint 2D.

- Verify `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText` against a debugger session attached directly to an inactive target tab.
- Test normal DOM pages, controlled canvas fixtures, Google Maps, and one editor-style application.
- Keep ref-based trusted click as the preferred input path.
- Separate coordinate input from presentation: background CDP coordinates must not require a visible overlay; the visible pointer remains an explicit foreground diagnostic tool.
- Preserve sensitive-field, file-upload, HTTP/HTTPS, viewport, deadline, and output-size enforcement.
- Do not use operating-system mouse or keyboard injection.

Exit criterion: the support matrix documents which input paths work in background and which return `FOREGROUND_REQUIRED`.

### Checkpoint 2D — background-native burst and production acceptance

Status: **complete**. Production acceptance installed 1.3.0 with identity and pairing preserved, exposed a Google Maps page-focus limitation, and verified the 1.3.1 patch with bounded CDP page-focus emulation during input only. The signed installed extension completed the seven-step background Maps scenario and a coordinate result click without activating its tab; foreground mode still rejected the inactive target.

- Make a burst pin one explicit automation target for its lifetime.
- Reject steps that attempt to activate, focus, or switch tabs.
- Assert the user's active tab and focused window are unchanged before and after the burst.
- Run a production scenario in which tab A remains active while tab B performs `read -> find -> click -> wait -> fill -> key -> read`.
- Verify concurrent manual typing/mouse use is unaffected, then test restart, reconnect, timeout, partial failure, and rollback.

Exit criterion met: production runs completed without focus theft, the evidence is recorded in the 1.3.1 release note, and MCP version 10 passed health, OAuth metadata, and unauthenticated-rejection checks.

### Milestone 2 rollback

- Preserve Opera Agent 1.2.0 as the inactive rollback CRX after 1.3.1 acceptance.
- Keep new MCP fields optional during rollout so the 1.2.0 client remains compatible.
- If a site needs foreground, return a structured failure rather than weakening the global default.

## Milestone 3 — adaptive screenshots

Priority: **P1**, only after Milestone 2 passes.

Status: **Complete and released in 1.4.0**. Controlled Chromium, isolated real Opera, the signed installed Opera profile, Supabase relay, and native ChatGPT image delivery all passed. Live Google Maps capture and unchanged-frame suppression succeeded in background without changing the active tab.

- Add a bounded `capture_page` capability using target-tab CDP `Page.captureScreenshot`; do not depend on `captureVisibleTab` for hidden tabs.
- Support viewport capture and validated crop rectangles first; defer full-page stitching until required.
- Enforce maximum dimensions, encoded bytes, frequency, deadline, and retained captures.
- Return capture metadata and a content hash. Reuse the previous image when the page has not materially changed.
- Capture only on initial observation, meaningful state change, low-confidence targeting, or failed verification—not after every action.
- Block internal Opera pages, incognito contexts, password/payment/OTP surfaces, and user-designated private tabs.
- Test hidden-tab rendering, canvas pages, zoom/device scale, background throttling, blank-frame detection, and rollback.

Exit criterion met: an inactive HTTP/HTTPS tab was captured without changing the user's active tab or focused window, with deterministic resource bounds and native image delivery in a connected ChatGPT conversation.

## Milestone 4 — vision-guided navigation

Priority: **P1**, built on background execution and adaptive capture.

Status: **Checkpoint 4A implemented, signed, and passing controlled Chromium plus isolated real-Opera regression in the 1.5.0 candidate**. Existing tool responses now expose generic scroll/viewport observability, mutation settling, and stable element identity. MCP version 12 is deployed with the same tool inventory and passes public health/auth checks. The same-identity update channel serves the verified candidate; installed-Opera and multi-site acceptance remain before stable release.

- Implement a bounded `observe -> decide -> browser.burst -> verify` loop.
- Prefer DOM refs and accessibility data; use visual coordinates only when semantic targeting is unavailable.
- Invalidate coordinates when the document ID, viewport, zoom, or screenshot hash changes.
- Require confidence thresholds and a fresh verification capture before retrying a coordinate action.
- Bound iterations, screenshots, commands, elapsed time, and result bytes.
- Evaluate Google Maps plus at least two unrelated complex applications so the design remains site-agnostic.
- Keep purchases, publishing, sending, deletion, credentials, OTP, payment data, and uploads behind the existing safety rules and explicit user intent.

Checkpoint 4A details and its bounded decision contract are recorded in [Vision-guided navigation](vision-navigation.md).

Exit criterion: representative visual tasks complete without foreground takeover, unbounded screenshot loops, or site-specific extension code.

## Explicitly deferred

- Continuous video/desktop streaming.
- Operating-system mouse and keyboard control.
- Arbitrary JavaScript or raw CDP exposed to the model.
- Silent foreground fallback.
- A site-specific Google Maps implementation inside the extension.

These can be reconsidered only with a separate threat model and measurable need.
