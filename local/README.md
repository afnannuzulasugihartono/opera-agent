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

### Your everyday Chrome instead

To drive the Chrome already full of your tabs instead of a separate window:

```bat
local\bin\opera-chrome-main.cmd
```

It starts your Default profile with the debugging port and the extension. Close
every Chrome window first or the flags die silently. Trade-off, stated plainly:
a debugging port lets any program on this machine drive those tabs, so use the
dedicated window above for anything sensitive and this one for daily driving.

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

## Tools

`browser_status`, `list_tabs`, `open_url`, `read_page`, `find_elements`, `click`,
`press_key`, `type`, `capture_page`.

`open_url` always opens its own tab, so a drive never navigates a page someone is
already reading. `capture_page` is clipped to the viewport at one pixel per
clickable coordinate, so a coordinate read off a screenshot can be clicked as-is.

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