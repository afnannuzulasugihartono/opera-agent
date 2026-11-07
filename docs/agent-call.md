# Calling Opera Agent

Three surfaces reach the same browser. Pick the one that matches where the agent
runs and where the browser already is.

| surface | the agent runs | the browser is | the caller needs |
|---|---|---|---|
| hosted MCP | anywhere | the paired device's browser | an account, an OAuth login, a paired device |
| local stdio MCP | on the browser's machine | a browser with a debugging port | Node 20, a Chromium |
| the extension road | on the browser's machine | the everyday browser | the extension loaded, the loopback bridge |

## 1. Hosted MCP

As of 2026-11-06, the server speaks MCP over HTTP and asks for an OAuth token before it answers.

```
https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp
```

A client that has no token is told so, and the answer names where the token
comes from:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://.../.well-known/oauth-protected-resource"
```

The record of what it answered without a token is
[`proof/hosted-mcp.json`](../proof/hosted-mcp.json) — a one-shot snapshot taken on
2026-11-06 by `node scripts/hosted-mcp-check.mjs`, which also probes that the OAuth
client below is still accepted by the authorization server.

Add it to `opencode.json` (OpenCode V2 reads servers from `mcp.servers`, and its
OAuth fields are snake_case):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "opera-agent": {
        "type": "remote",
        "url": "https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp",
        "oauth": {
          "client_id": "bbc5eb76-f385-435b-8b13-8e339b45e633",
          "redirect_uri": "http://127.0.0.1:19876/mcp/oauth/callback"
        },
        "headers": {
          "X-Opera-Device": "opera",
          "X-Opera-Provider": "opencode",
          "x-region": "ap-southeast-1"
        }
      }
    }
  }
}
```

The client id is the `Opera Agent` OAuth client registered in this Supabase project.
Its only accepted redirect is `http://127.0.0.1:19876/mcp/oauth/callback`, which is
OpenCode's default callback — any other port is refused by the authorization server
with `invalid redirect_uri`. Sign in once with `opencode mcp auth opera-agent`.

Or add it from the terminal:

```bash
claude mcp add --transport http opera-agent https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp --header "X-Opera-Device: opera" --header "X-Opera-Provider: claude" --header "x-region: ap-southeast-1"
```

What a caller gets wrong: the device header names which of your devices does
the work, and the server uses the first paired device when the header is
missing. A device that is offline is a device that answers nothing. The server
adds 35 tools to the browser primitives, and every one of them acts on the
paired device's browser, not on the machine the agent runs on.

### What a call answers

A hosted call answers with the answer, not with the transport. The envelope the
command rides in — `commandId`, `status`, `result`, `timing` — is opened, so the
tool's own fields sit at the top of the object:

```json
{ "ok": true, "tabs": [{ "id": 12, "title": "Example", "url": "https://example.com/", "active": false }] }
```

The rules are the same for every tool:

- `ok` is said once, at the top.
- `commandId`, `runId` and `timing` are gone: no tool takes them, so no caller can spend them.
- `status: "completed"` is gone: a call that failed says `ok: false` and carries `error`.
- A tab keeps its page facts and loses its window chrome: `muted`, `pinned`, `audible` and `windowId` are window facts.
- `bridge` keeps only `lastError`, and is absent when the bridge has nothing to report.

`OPERA_AGENT_MCP_RAW=1` on the function turns the tidying off and hands back the
raw envelope, which is what a person reads when one run has to be followed end to end.

The other half of the surface is the input. Every tool carries a title and a
`Returns:` sentence, and every field of every input says what it is, what it
defaults to, and what it changes.

## 2. Local stdio MCP

The server speaks MCP over stdio and drives a browser on this machine.

```bash
node local/bin/opera-local.js
```

Point a client at it:

```json
{
  "mcpServers": {
    "opera-local": {
      "command": "node",
      "args": ["local/bin/opera-local.js"]
    }
  }
}
```

| variable | default | meaning |
|---|---|---|
| `OPERA_LOCAL_PORT` | `9333` | the debugging port to drive |
| `OPERA_LOCAL_BROWSER` | first installed | which browser a session that opens one is aimed at |
| `OPERA_LOCAL_TRANSPORT` | unset (auto) | unset picks the bridge when an extension is linked, CDP otherwise; `bridge`/`cdp` force one |
| `OPERA_BRIDGE_PORT` | `9451` | the loopback port the extension dials into |

What a caller gets wrong: Chrome refuses a debugging port on the Default profile,
so the everyday window cannot be driven over CDP at all. A client pointed at port
9333 with nothing listening there is refused with `No browser is listening on port 9333.` — the server does not open a second
browser. Start a browser with a debugging port the way
[`local/README.md`](../local/README.md) shows, or link the extension and let the
bridge carry the drive. `browser_status` answers with the port the drive is
really on, so read it first: `port: 9451` means the extension road, `port: 9333`
means a debugging port.

The server advertises 54 tools. `guide()` returns them as tasks rather than a
list, and the full list is in [`local/README.md`](../local/README.md).

## 3. The extension road

The extension in `extension/` opens a socket to this machine and carries CDP
both ways, so the everyday browser can be driven without a debugging port and
without a cloud round trip. The socket is one WebSocket on `127.0.0.1:9451`.

1. Install the extension. The archive is on the site's download page, and
   `chrome://extensions` with developer mode on loads it unpacked.
2. Start the local server with `OPERA_LOCAL_TRANSPORT=bridge`.
3. Read `browser_status`. `port: 9451` means the extension is linked.

What a caller gets wrong: the bridge holds one device socket, so a second
extension connection evicts the first. Two drivers on one machine share the
bridge rather than fight for it, and the everyday Chrome can only be linked to
one bridge at a time.

### The record

`scripts/extension-run.mjs` drives a real browser through the extension and
writes what happened:

```bash
node scripts/extension-run.mjs
node --test tests/extension-run.test.mjs
```

- [`proof/extension-run.md`](../proof/extension-run.md) — the readable record.
- [`proof/extension-run.jsonl`](../proof/extension-run.jsonl) — one line per call.
- [`proof/extension-portal.jpg`](../proof/extension-portal.jpg) — the picture the run took.

The last recorded run carried seven calls over the bridge — `browser_status`,
`open_url`, `read_page`, `find_elements`, `download`, `capture_page`,
`close_tab` — and the CSV it pulled down hashed equal to the file the portal
served. `tests/extension-run.test.mjs` re-hashes that fixture and compares it
with the hash in the record; it does not drive a browser again.

## Which road is this product on?

The hosted server and the local driver are two ways to call the same tools. The
hosted one needs an account and a paired device; the local one needs a browser
on the machine. The extension is what makes the local road reach the browser
you are already using.
