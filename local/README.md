# opera-local

Drive your own Chromium browser from an MCP client, over the Chrome DevTools
Protocol, with no cloud round trip and no dependencies.

```bash
npx opera-local
```

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

The transport is a held `POST /poll` plus a `POST /reply`, not a WebSocket. It
was one, and this Chrome never handed an inbound loopback frame to an extension
service worker: the worker's own counters read zero messages after hundreds sent,
the same frames reached a real WebSocket client every time, and the identical
code path delivers inbound frames from the cloud relay without trouble. A fetch
is the one thing Chrome will start a service worker for, so the poll is the
transport, the wake-up and the keepalive at once.

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

The server advertises 41 tools; `guide()` returns them as tasks rather than a list.

`browser_status`, `focus_window`, `dialog_state`, `dialog_type`, `dialog_press`,
`list_tabs`, `open_url`, `close_tab`, `surface_profile`, `read_page`, `find_elements`, `click`,
`resolve_row`, `click_row`, `hover`, `press_key`, `type`, `get_computed`, `scroll`,
`append`, `stream_keys`, `browser_burst`, `wait_for`, `ask_page`, `wait_for_row`,
`wait_still`, `caret_line`, `upload`, `drop_file`, `intercept_file_chooser`, `download`,
`list_menus`, `open_menu`, `guide`, `capture_page`, `ax_snapshot`, `statement_card`,
`statement_delivered`, `report_build`, `document_build`, `document_write`.

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

`document_build` plans a paper on disk and rechecks every figure against its table;
`document_write` carries that paper into a live tab — it draws each graph as a picture,
puts the styled paper on the machine clipboard, pastes it at the caret, and asks the
page which headings it now holds, so a paste that did not land is reported rather than
assumed. A paper with a cover gets its cover page, and the pages it asks for are broken
by the page itself; a paper that asks for a table of contents gets one the page makes,
with page numbers, and a list of the headings as the fallback. With `nativeCharts` the
graphs are made by the page itself — a scratch spreadsheet draws them and the document
takes them as charts that carry their data and can be edited — and a graph that cannot be
made that way falls back to the picture, so the answer says which graph is a chart and
which is a picture.

A paper names its look with `"template"`. `"journal"` is Overleaf's Basic Academic
Journal Article Template, and the rules are that class's own: a 20pt bold sans title on
the left, a Helvetica bold 12pt author, an abstract in a box filled RGB(182,193,251), a
Times 10pt body, numbered headings in capitals, a table captioned above it as
`Table 1.`, a figure captioned below it as `Figure 1.`, and references numbered as a
bold superscript. A paper with no template keeps the plain look. The margins and the
page-number footer of the class are the page's own settings, not the paper's, so they
are left as the document has them.

## Native OpenCode tools

`local/bin/opera-opencode.js` is an OpenCode plugin. It registers the whole table as
native tools under the `opera` namespace, so the model calls `opera_read_page` and
`opera_click` directly instead of reaching them through an MCP server, and it asks
OpenCode's permission rules before every call.

Load it by putting one line in `~/.config/opencode/plugins/opera-agent.js`:

```js
export { default } from 'file:///D:/GitHub/opera-agent/local/bin/opera-opencode.js';
```

It registers 42 tools: the 41 above, and `opera_fetch`.

`opera_fetch` is the one call that walks the whole road. It opens its own tab, waits
for the page to settle, reads it, and closes the tab again, and it answers with the
url it ended on, the title, and the page text. Give it `waitFor` when the content
arrives late. Use it when the page needs JavaScript or a signed-in session, where an
HTTP fetch gets nothing back; for a page you have to click through, `opera_open_url`
and `opera_browser_burst` are the road.

A permission rule is what turns a click into a question:

```json
{ "action": "click", "resource": "*", "effect": "ask" }
```

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

**A character the code page cannot hold travels as a numbered entity.** The rich
HTML goes through PowerShell, which writes CF_HTML in the console's code page, while
the page reads CF_HTML as UTF-8 — so an em dash arrived as `�`. A numbered entity
is ASCII, survives every code page, and the page decodes it back.

## Licence

MIT