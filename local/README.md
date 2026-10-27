# opera-local

Drive your own Chromium browser from an MCP client, over the Chrome DevTools
Protocol, with no cloud round trip and no dependencies.

```bash
npx opera-local
```

## Layout

One package, six groups, split by the job each module does rather than by layer.
`agent/` speaks MCP and touches no page, `drive/` owns the verbs, and one group
imports another only where a single driver shape or page expression is genuinely
shared.

| group | what lives there | entry |
|---|---|---|
| `core` | browser discovery, the CDP client, the transport, the driver and its per-tab sessions, the dev shim, the OS window | `core/driver.js` |
| `bridge` | the loopback conversation with the extension: the driver's transport, the poll server, the websocket primitives | `bridge/bridge.js` |
| `drive` | the verbs that act on a page: typing, pointer, reads, waits, menus, dialogs, bursts, file I/O, the assembled primitives, the page-side expressions they share | `drive/primitives.js` |
| `surface` | what a surface is and how to measure, read and act on it: the profile, the read and action ladders, the caret guard, the canvas read | `surface/canvas.js` |
| `jobs` | disk work that opens no tab: statement cards and manifests, reports, documents | `jobs/statements.js` |
| `agent` | the MCP surface itself: the stdio server, the tool table as data, the advice, the task guide | `agent/mcp-server.js` |

The binary is `bin/opera-local.js`: it decides CDP or bridge, builds the driver and
the per-tab sessions, and hands them to `agent/mcp-server.js`, which is the only
stdio contract in the tree. `package.json` ships the groups by name, so a module
added inside one ships with it.

## Why this exists

The same action measured two ways on one machine:

| | round trip |
|---|---|
| through a cloud MCP function | ~380 ms |
| through this driver | under 1 ms |

It exists because Google Docs, Sheets and Slides all render to canvas. There is no
element to write to and no text to read back, so every action has to go through
browser-level input — and every action the editor silently ignores looks exactly
like one that worked. The recipes at the bottom are what was learned by driving,
not by reading documentation.

## Requirements

Node 20 or newer, and a Chromium browser already running with a debugging port:

```bash
# macOS / Linux
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9333

# Windows
"C:\Program Files\Google Chrome\Application\chrome.exe" --remote-debugging-port=9333
```

## Persistent setup (Windows)

Opening Chrome normally first makes a second launch join the running process and
silently drop the debugging port, and an unpacked extension loaded by hand
vanishes with a temporary profile. The launcher below fixes both: a dedicated
persistent profile, the debugging port, and the extension on every start.

```bat
local\bin\opera-chrome.cmd
```

Sign in to Google once inside it; the profile at
`%LOCALAPPDATA%\OperaAgent\ChromeProfile` keeps the login, and
`--load-extension` keeps `extension/` loaded no matter how often Chrome closes.
Browse in this window whenever the agent is driving: a normally-opened Chrome
window cannot be driven and blocks this one from starting.

### Your everyday Chrome instead: the bridge

Chrome refuses a debugging port on the Default profile, so the everyday window
cannot be driven over CDP at all — the flag dies with an error and no port. The
bridge is the road that remains: the extension polls this machine on loopback and
carries raw CDP both ways, so the whole surface below runs on your real tabs with
no flags, no queue and no cloud.

The transport is one WebSocket the extension opens to `127.0.0.1:9451` and holds:
a `hello` frame in, `ready` back, then `command` and `complete` frames — the same
frames the cloud bridge speaks. The server pings every twenty seconds, because
Chrome ends an idle service worker and an inbound frame does not wake it. A
second driver on the same machine reaches the bridge over `POST /command`
instead of losing the port, so two processes share one browser.

```bash
OPERA_LOCAL_TRANSPORT=bridge npx opera-local
```

Load the extension unpacked once from `extension/` (it persists in the
profile), reload it after pulling, and drive. The touched tab comes forward so
you can watch, and every click and hover leaves a red or blue ring where it
landed. Trust boundary, stated plainly: loopback without auth, exactly what the
debugging port it replaces already was.

Point a client at it:

```json
{
  "mcpServers": {
    "opera-local": {
      "command": "npx",
      "args": ["opera-local"],
      "env": { "OPERA_LOCAL_PORT": "9333" }
    }
  }
}
```

| variable | default | meaning |
|---|---|---|
| `OPERA_LOCAL_PORT` | `9333` | the debugging port to drive |
| `OPERA_LOCAL_BROWSER` | first installed | which browser to launch if none is listening |
| `OPERA_LOCAL_TRANSPORT` | unset (CDP) | `bridge` drives the everyday profile through the extension |
| `OPERA_BRIDGE_PORT` | `9451` | the loopback port the extension dials into |

## Tools

The server advertises 39 tools; `guide()` returns them as tasks rather than a list.

`browser_status`, `focus_window`, `dialog_state`, `dialog_type`, `dialog_press`,
`list_tabs`, `open_url`, `close_tab`, `read_page`, `find_elements`, `click`,
`resolve_row`, `click_row`, `hover`, `press_key`, `type`, `get_computed`, `scroll`,
`append`, `stream_keys`, `browser_burst`, `wait_for`, `ask_page`, `wait_for_row`,
`wait_still`, `caret_line`, `upload`, `drop_file`, `intercept_file_chooser`, `download`,
`list_menus`, `open_menu`, `guide`, `capture_page`, `ax_snapshot`, `statement_card`,
`statement_delivered`, `report_build`, `document_build`.

`browser_burst` runs 1-8 dependent steps on one tab in a single call and reads the page
once at the end; the first failure stops the burst and keeps the steps that finished.
`open_url` always opens its own tab, so a drive never navigates a page someone is
already reading. `capture_page` is clipped to the viewport at one pixel per
clickable coordinate, so a coordinate read off a screenshot can be clicked as-is.
Actions answer with where the page stands and the rows that changed; `ax_snapshot`
is the deliberate look at every row.

`download` writes a file to the folder the caller names and proves it by the file on
disk — a `.crdownload` is not a result. The last two tools are the statement job: a
card that names the file before the drive, and a delivery that verifies it and adds the
client-month to a manifest. See [`docs/jobs/statements.md`](../docs/jobs/statements.md).

## Recipes, measured

These are the rules that the three Google editors actually honour. Each one returns
success while doing nothing if you get it wrong, so there is no error to notice.

**Paragraph breaks are newlines inside the text, never a dispatched Enter.** The
editor ignores the key event entirely and merges every paragraph into one.

**Structure is applied before content.** A style applied to a paragraph that
already holds its text does not take; the same chord applied to an empty paragraph
does, and the heading appears in the outline.

**The first key event after a write is swallowed.** Send one harmless key before
the real one, or the real one is the one that disappears.

**A cell ignores inserted text until a character key opens it**, and the opening
character joins the value. Press a letter, press Backspace, then insert.

**Clearing removes text but not formatting.** The next paragraph inherits the old
bullets. Clear, toggle once, then write.

**A submenu opens on hover.** Move the pointer and settle there; a press closes the
menu instead.

## Licence

MIT