# Calling Opera Agent

One road, one command: `opera-agent-mcp local`. Local on the machine where the browser already is.

The install is one command:

```bash
npm i -g opera-agent-mcp
```

## The installer and the driver

`opera-agent-mcp` is one command with one road: stdio on this machine,
driving the everyday browser through the loopback bridge — no cloud round trip
per command.

Point a client at it (OpenCode reads `.mcp.servers` in `~/.config/opencode/opencode.json`; Kilo Code reads the same shape under `mcpServers` in its settings JSON):

```json
{
  "mcp": {
    "servers": {
      "opera-agent": {
        "type": "local",
        "command": "opera-agent-mcp",
        "args": ["local"],
        "timeout": { "startup": 60000, "catalog": 60000, "execution": 600000 }
      }
    }
  }
}
```

| variable | default | meaning |
|---|---|---|
| `OPERA_BRIDGE_PORT` | `9451` | the loopback port the extension dials into |
| `OPERA_AGENT_HOME` | `~/.opera-agent` | where the paired device file lives |
| `OPERA_AGENT_MCP_CONFIG_HOME` | platform config dir | where the OAuth token lives |
| `OPERA_AGENT_MCP_TOKEN` | unset | a static token wins over the OAuth login |

### The meter, and what refuses you

The local drive is metered where it happens: the loopback bridge asks the
cloud once per session (`session_open`, with the device credentials the
extension's hello carries), counts locally, and refuses the session when the
cloud cannot be reached. A command past the session allowance answers
`PLAN_LIMIT_REACHED` with the plan named. The usage is reported when the
session ends, so the local road and the pairing account share one daily count —
`plan.pilot` carries 200 commands per day and 50 per session;
`plan.firm` carries 5000 and 500. The gate lives in the bridge — never in
readable client code. `opera-agent-mcp doctor` prints the bridge, the device,
the extension version, the plan, and the quota.

`browser_status` answers with the port the drive is really on, so read it
first: `port: 9451` means the extension road. When a linked device's daily
quota is spent the device card carries `planExhaustedDevices` with the device
names, so a driver sees it before the next call is refused.

The server advertises 56 tools. `guide()` returns them as tasks rather than a
list, and the full list is in [`local/README.md`](../local/README.md).

### The capture ladder

`read_page` answers with measured text, and everything it says about the page
carries the number it measured, never an assumption: `settled` is true only
when two reads a beat apart agree the text has stopped moving (`settled: null`
means one sample cannot say; `wait_for_stable()` is the companion), and
`grewBy` names how many characters arrived between reads. The read walks a
ladder chosen from what `scan_page()` measured: the accessibility tree
first where a canvas covers the viewport, then the DOM, then a selection copy
(only with `allowCaretMove: true`), then a picture. Every step but the
selection copy asks nothing of the page, the answer names which step it used,
and a missing-but-needed step is reported as skipped with the reason. On a
canvas-rendered page the tree is cut at a depth cap, and `surface.truncated`
says so.

## The extension road

The extension in `extension/` opens a socket to this machine and carries CDP
both ways, so the everyday browser can be driven without a debugging port. The
socket is one WebSocket on `127.0.0.1:9451`.

1. Install the extension. The archive is on the site's download page, and
   `chrome://extensions` with developer mode on loads it unpacked.
2. Pair the browser in the dashboard — the meter needs a paired device to name
   the account the session belongs to.
3. Run `opera-agent-mcp doctor`. It prints the bridge, the device, the
   extension version, the plan, and the quota; a `degraded` verdict names the
   one fix that applies.

### The record

`scripts/dev/extension-run.mjs` drives a real browser through the extension and
writes what happened:

```bash
node scripts/dev/extension-run.mjs
node --test tests/extension/extension-run.test.mjs
```

- [`docs/proof/extension-run.md`](../docs/proof/extension-run.md) — the readable record.
- [`docs/proof/extension-run.jsonl`](../docs/proof/extension-run.jsonl) — one line per call.
- [`docs/proof/extension-portal.jpg`](../docs/proof/extension-portal.jpg) — the picture the run took.

The last recorded run carried seven calls over the bridge — `browser_status`,
`open_url`, `read_page`, `find_elements`, `download`, `capture_page`,
`close_tab` — and the CSV it pulled down hashed equal to the file the portal
served. `tests/extension/extension-run.test.mjs` re-hashes that fixture and compares it
with the hash in the record; it does not drive a browser again.
