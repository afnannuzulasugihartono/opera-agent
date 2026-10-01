# Extension

Browser-local Opera Agent code lives here.

The extension should remain a thin bridge responsible for:

- receiving validated commands
- executing allowlisted browser primitives
- reading structured browser/page state
- using trusted CDP input where required
- returning results to Supabase
- reconnecting safely after service-worker, browser, sleep, or network interruptions

Site-specific workflows should normally live outside the extension.

## Permissions rationale (for review)

Every entry in `manifest.json` is listed here with the code that needs it and the
narrowest alternative that was considered. Line references are to the current
tree; a reviewer who finds one stale should treat that as a defect in this
document.

The complete set of browser APIs this extension calls is small enough to
enumerate, which is how each claim below was checked: `chrome.alarms.*`,
`chrome.debugger.*`, `chrome.runtime.*`, `chrome.scripting.executeScript`,
`chrome.storage.local` / `onChanged`, `chrome.tabs.*`, and `chrome.windows.*`
(`get` and `update`, used only to read a tab's window and to focus it; these
need no manifest permission). Nothing else.

### `tabs`

**Needs it for.** Reading `Tab.url` and `Tab.title` on tabs the host
permissions do not cover. `publicTab()` returns `title` and `url`
(`background.js:118-130`) and `tabs.find` filters on `urlContains` and
`titleContains` (`background.js:1004-1009`), so a missing `tabs` permission
would leave URL and title blank for privileged-scheme tabs such as
`opera://extensions`, a settings page, or an add-on store.

**Narrower alternative.** The `http://*/*` and `https://*/*` host permissions
already grant URL and title on ordinary web pages, and every page primitive is
gated on an http(s) URL before it runs (`background.js:157,363`). So for the
paths that matter most, `tabs` adds nothing.

**Honest assessment.** `tabs` is close to a **convenience** permission here,
not a necessity: its only unique contribution is visible URL/title on
privileged-scheme tabs in list/find output. None of the `chrome.tabs.*` calls in
this extension — `query`, `get`, `create`, `update`, `remove`, `reload`,
`sendMessage`, `getZoom`, and the three event listeners — requires the `tabs`
permission itself. **That last sentence is a platform-behaviour assumption, not
a repository fact:** the call enumeration is verified against the tree, but
which of them the `tabs` permission gates is Chrome's own behaviour and is
recorded here from documentation, not from anything in this repository. Subject
to that, a reviewer who wants the smallest possible surface should consider
dropping it and accepting blank URLs on non-web tabs — and should check the
platform behaviour against the current Chrome extension documentation first.

### `activeTab`

**Needs it for.** Nothing that can be found in the code.

**Honest assessment — this one should be looked at.** `activeTab` appears
exactly once outside `manifest.json`, at `background.js:1626`, where it is a
**field name in the self-test result object**, not an API call. No
`chrome.*` API that this extension uses is gated behind `activeTab`: content
scripts are declared in the manifest with `matches`, so they inject without it,
and `chrome.scripting.executeScript` is authorized by the host permissions. The
identifier also appears as the extension ID origin in the CORS default list
(`supabase/functions/_shared/cors.js:2`), which is unrelated to the permission.

**Recommendation.** Treat `activeTab` as removable pending reviewer dissent.
It is declared, granted to the extension, and unused. This is flagged rather
than acted on because changing `manifest.json` is outside the scope of this
document.

### `scripting`

**Needs it for.** Two things. `ensureContent()` re-injects the content-script
bundle when a tab has no live content bridge — after a service-worker restart,
a tab that was already loaded, or a navigation the content script missed
(`background.js:155-165`). `assertCaptureFramesSafe()` runs a privacy probe
across **all** frames of a tab before any screenshot, including iframes, because
the content script cannot see inside them (`background.js:227-246`). That
all-frames probe is the reason `scripting` is a distinct permission and not just
a side effect of the content-script declaration.

**Narrower alternative.** None for the frame probe: a content script declared
with `all_frames: false` cannot reach sibling frames. Dropping `scripting`
would leave screenshot capture able to miss a sensitive field in an embedded
frame, which is the exact case the probe exists to block.

### `storage`

**Needs it for.** All persistent extension state in `chrome.storage.local`: the
pairing flag, device name, device token, device ID, bridge URL override, log
level (`background.js:32`), the private-tab id list (`background.js:33,198`),
and the pending completion record that lets a command result survive a
service-worker restart (`background.js:1568`). `storage.onChanged` is what
restarts the pull loop when the operator saves a new bridge URL
(`background.js:1685-1690`). Without it, a saved settings change would not take
effect until the browser restarted.

**Narrower alternative.** None. `sync` would be worse, not narrower: the device
token would leave the machine. See `SECURITY.md`.

### `alarms`

**Needs it for.** Keeping the long-poll loop alive. A Manifest V3 service worker
is torn down when idle; `chrome.alarms.create('opera-agent-wake',
{ periodInMinutes: 0.5 })` plus an `onAlarm` listener that re-runs `heartbeat()`
and re-arms the pull loop is the wake mechanism
(`background.js:1670-1683`, and the eager `create` at `:1710`). This is not a
background convenience — it is what makes the device visible to the gateway at
all, and the gateway treats 90 seconds of silence as offline.

**Narrower alternative.** A `setTimeout` chain would not survive service-worker
termination, which is the problem `alarms` solves here.

### `debugger`

This one is broader than "trusted input", so the four distinct uses are listed
separately. Only the first is a hard requirement for the method set the
extension advertises.

| Use | CDP command | Is it required? |
| --- | --- | --- |
| Trusted input | `Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent` (`background.js:665-801`) | **Yes for `browser.burst` and for any action sent with `trusted: true`.** A content-script `el.click()` or `dispatchEvent` produces an untrusted event that page code can reject; `Input.*` produces a browser-trusted one. |
| Screenshots | `Page.getLayoutMetrics`, `Page.captureScreenshot` (`background.js:400-457`) | **Yes.** There is no other screenshot path in the extension — `chrome.tabs.captureVisibleTab` and `chrome.tabs.captureTab` are not called anywhere. |
| Accessibility tree | `Accessibility.enable`, `Accessibility.getFullAXTree` (`background.js:284-301`) | **No.** This only enriches a page read. Every failure path returns `null` and leaves the observation intact. |
| Focus emulation | `Emulation.setFocusEmulationEnabled` (`background.js:475-485`) | **No.** Narrow scope, applied around a focus-gated action. |

**Why `browser.burst` forces it.** `burstStepParams()` sets
`params.trusted = true` for every `click`, `fill`, `key`, and `hover` step
unconditionally (`background.js:835-851`). A burst therefore has no non-debugger
path at all, and `browser.burst` is a first-class method advertised in the
gateway's own OpenAPI examples.

**Honest assessment.** The permission is broad — it can read and alter anything
in the tab, and it is one of the permissions users are most likely to hesitate
over — but on this codebase it is exercised by a real, load-bearing path rather
than held "just in case". The two non-essential uses above are the ones a
reviewer should push on; the trusted-input and screenshot uses are not
removable without changing what the extension does. See `SECURITY.md` for the
data-handling boundary that sits on top of this.

### `http://*/*` and `https://*/*` host permissions

**Needs them for.** The product is remote control of a browser over pages the
operator does not control the origin of. `ensureContent()` injects into whatever
tab id the command names, and `tabs.open` / `tabs.navigate` target arbitrary
URLs, so the set of origins cannot be enumerated in advance.

**Narrower alternative — and this is the honest answer.** A pattern list cannot
be narrowed to "the user's own pages" in the manifest, because the user does not
declare those pages to the extension; the operator issues a URL at runtime. The
effective boundary is drawn in code instead:

- every page primitive is refused for a non-http(s) tab
  (`background.js:157,363`);
- screenshots are refused outright for a tab the user marked private in the
  popup (`background.js:365`), and refused again by the all-frames sensitive
  field probe (`background.js:227-246`);
- `document_start` injection plus `all_frames: false` means the content script
  observes the top document only;
- sensitive fields (password, OTP/2FA, PIN, card, CVV) are blocked
  (`SECURITY.md`).

`<all_urls>` is deliberately **not** used: it would add `file://` and `ftp://`
and similar schemes that the product has no use for. The two patterns are the
narrowest expression of "any web page the operator can name".

### Content scripts: `document_start`, top frame only

**Why `document_start`.** The content script builds a `MutationObserver` over the
whole document and publishes stable semantic element references
(`content.js:32-36`). A late injection would miss the initial DOM and would race
the page's own first paint; `document_start` is what lets the identity engine
observe the document from the beginning. The practical consequence operators
see is that the content bridge is answering immediately after a navigation
instead of intermittently.

**Why `all_frames: false`.** Refs are resolved against the top document, and
frame identity is not part of the addressing scheme — a ref means "this element
in the page the user is looking at". Injecting into every frame would multiply
the observer cost and produce ambiguous refs for the same visual element. The
one thing that genuinely needs frame access, the screenshot privacy probe, is
handled through `chrome.scripting` instead (see `scripting` above).

### Module service worker

`background: { service_worker: "background.js", type: "module" }`. The service
worker imports from `lib/` — `protocol.js`, `watch.js`, `action-pipeline.js`,
`focus-gate.js`, `keyboard.js`, `endpoints.js`, `ax-summary.js`,
`popup-events.js` (`background.js:1-30`). MV3 module workers are the only way to
share those modules between the worker and the Node-based tests without
duplicating source. `extension/lib/agent-log.js` and `extension/role-reconcile.js`
are side-effect imports that publish on `globalThis`, because the manifest loads
the same files as classic content scripts which cannot import
(`background.js:17-27`). The consequence for review: module type costs nothing
extra here and is load-bearing.

### Content security policy

Not a permission, but it bounds what the permissions above can reach:
`extension_pages` is `script-src 'self'; object-src 'self'; connect-src 'self'
http://127.0.0.1:* https://*.supabase.co`. No remote code execution, no inline
script, and network egress limited to the local loopback and the Supabase
project. `SECURITY.md` records the same principle.

### Where the settings and the operator docs live

- The only UI for settings is the extension **Options page**
  (`extension/options.html`, reachable from `opera://extensions` → this
  extension → Options). It sets the bridge URL override and the log level, and
  it never displays the device token, a pairing code, or any other secret.
- [Operator runbook](../docs/runbook.md) — incidents, retention, proposed SLOs.
- [Install, pairing, and smoke test](../docs/install.md).
- [Gateway API reference](../docs/api.md).

### Summary of reviewer-facing notes

1. `activeTab` appears unused; consider removing it.
2. `tabs` is a convenience permission given the host permissions already in
   place; consider removing it and accepting blank URLs on privileged tabs.
3. `debugger` is required for trusted input and is the only screenshot path, but
   two of its four uses (accessibility tree, focus emulation) are non-essential.
4. The host patterns cannot be narrowed below "any web page", and the real
   boundary is enforced in code, not in the manifest.
