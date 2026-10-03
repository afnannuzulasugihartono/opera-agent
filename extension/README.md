# Extension

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

## Permissions

Six declared. Each row says what would break without it, which is the only question a
reviewer needs answered.

| Permission | Needed for | Function |
|---|---|---|
| `tabs` | URL and title on privileged-scheme tabs such as `opera://extensions`; every page primitive is gated on an http(s) URL, so ordinary pages already have it from the host permissions | `publicTab()`, `tabs.find` |
| `scripting` | Re-injecting the content bundle after a service-worker restart or a missed navigation, and the all-frames privacy probe before any screenshot | `ensureContent()`, `assertCaptureFramesSafe()` |
| `storage` | Pairing flag, device name, device token, bridge URL override, log level, private-tab list, and the pending completion record that survives a service-worker restart | `chrome.storage.local` |
| `alarms` | Keeping the long-poll loop alive. MV3 tears the worker down when idle, and the gateway treats 90 seconds of silence as offline | `opera-agent-wake` alarm |
| `debugger` | Trusted input, screenshots, accessibility tree, focus emulation | see below |
| `activeTab` | Nothing found in the code | — |

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

- `activeTab` appears unused. Consider removing it.
- `tabs` is a convenience given the host permissions already in place. Removing it
  costs blank URLs on non-web tabs.
- `debugger` is load-bearing for trusted input and is the only screenshot path, but
  two of its four uses are not essential.
- Host patterns cannot be narrowed below "any web page". The boundary is in code.
