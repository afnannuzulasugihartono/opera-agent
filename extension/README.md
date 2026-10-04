# Extension

Simplification above everything. Current state, never a history book.

Related: [AGENTS.md](../AGENTS.md) - [extension/AGENTS.md](AGENTS.md) - [api.md](../docs/api.md) - [runbook.md](../docs/runbook.md)

Browser-local Opera Agent code. A thin bridge: receive a validated command, run one
allowlisted browser primitive, return the result. Site-specific workflows belong in
server-side workflows, not here.

Citations below name a function rather than a line number, because a line number is
stale the moment the file is edited.

## What it does

- Receiving validated commands.
- Executing allowlisted browser primitives.
- Reading structured browser and page state.
- Trusted CDP input where required.
- Returning results to Supabase.
- Reconnecting safely after service-worker, browser, sleep, or network interruption.

## Files

| File | What it is |
|---|---|
| `background.js` | The worker. Command dispatch, the pull loop, pairing, and every primitive's host-side half |
| `content.js` | The top-document script. Element refs, semantic reads, hit-testing, pointer input |
| `lib/protocol.js` | The wire contract: the 26 allowlisted primitives and the burst vocabulary |
| `lib/action-pipeline.js` | Pure policy for resolve, wait, heal, verify. No DOM, no chrome |
| `lib/focus-gate.js` | Pure policy for whether a foreground action may proceed |
| `lib/keyboard.js` | Resolves a key or chord request to exact CDP key events |
| `lib/watch.js` | Pure policy for `watch.*` rules |
| `lib/ax-summary.js` | Bounded, value-free accessibility summary for semantically poor surfaces |
| `lib/debugger-session.js` | Lazy, shared CDP attach bookkeeping |
| `lib/deadline-race.js` | Decides a command's deadline against work already in flight |
| `lib/error-messages.js` | Maps error codes to text for the popup and options page |
| `lib/popup-events.js` | Pure policy for popup and redirect follow-through |
| `lib/endpoints.js` | The single source of deployment endpoint truth |
| `lib/options-store.js` | Validates and persists the Options page settings |
| `lib/agent-log.js` | Ring buffer of log entries, published for the popup. Classic script |
| `lib/role-reconcile.js` | Fills roles from the accessibility tree. Classic script |
| `semantic-identity.js` | Stable identity for elements across re-renders |
| `semantic-views.js` | Bounded materialized views over a region |
| `hover-settle.js` | Pointer settle timing before a hover or click is trusted |
| `popup.html`, `options.html` | The only two UI surfaces. Neither shows a secret |

Pure modules under `lib/` have no DOM and no chrome dependency, so the Node suite tests
the same source the browser runs. The MCP server does not import them: it speaks the
wire contract, and `lib/protocol.js` is where that contract is defined on this side.

## Permissions

Five declared. Each row says what would break without it, which is the only question a
reviewer needs answered.

| Permission | Needed for | Function |
|---|---|---|
| `tabs` | URL and title on privileged-scheme tabs such as `opera://extensions`; every page primitive is gated on an http(s) URL, so ordinary pages already have it from the host permissions | `publicTab()`, `tabs.find` |
| `scripting` | Re-injecting the content bundle after a service-worker restart or a missed navigation, and the all-frames privacy probe before any screenshot | `ensureContent()`, `assertCaptureFramesSafe()` |
| `storage` | Pairing flag, device name, device token, bridge URL override, log level, private-tab list, and the pending completion record that survives a service-worker restart | `chrome.storage.local` |
| `alarms` | Keeping the long-poll loop alive. MV3 tears the worker down when idle, and the gateway treats 90 seconds of silence as offline | `opera-agent-wake` alarm |
| `debugger` | Trusted input, screenshots, accessibility tree, focus emulation | see below |

## `debugger` is four separate uses

| Use | CDP command | Required? |
|---|---|---|
| Trusted input | `Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent` | Yes. A content-script `el.click()` is untrusted and page code can reject it. `burstStepParams()` sets `trusted: true` for every `click`, `fill`, `key`, and `hover` step, so a burst has no non-debugger path at all |
| Screenshots | `Page.getLayoutMetrics`, `Page.captureScreenshot` | Yes. There is no other screenshot path; `chrome.tabs.captureVisibleTab` is never called |
| Accessibility tree | `Accessibility.enable`, `Accessibility.getFullAXTree` | No. Enriches a read; every failure path returns null and leaves the observation intact |
| Focus emulation | `Emulation.setFocusEmulationEnabled` | No. Narrow scope, applied around a focus-gated action |

## Host permissions

`http://*/*` and `https://*/*`, deliberately not `<all_urls>`, which would add `file://`
and `ftp://` for no product use.

They cannot be narrowed to "the user's own pages": the operator issues a URL at
runtime, so the set of origins is not knowable in advance. The real boundary is
enforced in code instead.

- Every page primitive refuses a non-http(s) tab.
- Screenshots are refused for a tab the user marked private, and again by the
  all-frames sensitive-field probe in `assertCaptureFramesSafe()`.
- Sensitive fields — password, OTP/2FA, PIN, card, CVV — are blocked. See
  [SECURITY.md](../SECURITY.md).

## Content scripts

- `document_start` so the `MutationObserver` in `content.js` sees the document from the
  beginning. A late injection misses the initial DOM and races first paint.
- `all_frames: false`. Refs resolve against the top document, so a ref means "this
  element in the page the user is looking at". Injecting everywhere would multiply
  observer cost and make the same visual element ambiguous. The one thing that needs
  frame access, the screenshot probe, goes through `chrome.scripting` instead.

## Service worker

`type: "module"`, so the worker and the Node-based tests share the same source in
`extension/lib/` instead of duplicating it. `agent-log.js` and `role-reconcile.js` are
side-effect imports that publish on `globalThis`, because the manifest loads the same
files as classic content scripts which cannot import.

Module type costs nothing extra here and is load-bearing.

## Content security policy

Not a permission, but it bounds what the permissions reach:
`script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* https://*.supabase.co`.
No remote code, no inline script, egress limited to loopback and the Supabase project.

## Settings

The only UI is the Options page (`options.html`, from `opera://extensions`). It sets the
bridge URL override and the log level, and never displays the device token, a pairing
code, or any other secret.

## For a reviewer

- `tabs` is a convenience given the host permissions already in place. Removing it
  costs blank URLs on non-web tabs.
- `debugger` is load-bearing for trusted input and is the only screenshot path, but
  two of its four uses are not essential.
- Host patterns cannot be narrowed below "any web page". The boundary is in code.
