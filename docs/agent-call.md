# Calling Opera Agent

One command, two modes. Pick the one that matches where the agent runs and
where the browser already is.

| mode | the browser | the caller needs |
|---|---|---|
| `opera-agent-mcp local` | the everyday profile on this machine | Node 20+, the extension, a paired device |
| `opera-agent-mcp cloud` | the paired device's browser | an account, an OAuth login, a paired device |

The install is one command:

```bash
npm i -g opera-agent-mcp
```

## 1. Hosted MCP

As of 2026-11-10, the server speaks MCP over HTTP and asks for an OAuth token before it answers.

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
2026-11-10 by `node scripts/hosted-mcp-check.mjs`, which also probes that the OAuth
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
adds 40 tools to the browser primitives, and every one of them acts on the
paired device's browser, not on the machine the agent runs on. Two of them
reach the extension itself rather than a page: `check_update` says what the
device runs and what the update service serves, and `apply_update` asks the
device to write the newest build over its own folder and restart. The page
`update.html` can be closed at any time; the pull lives on the tool, not on
the page. `browser_status`
answers with the plan, the quota and the remaining count; a call past the
quota is answered `PLAN_LIMIT_REACHED` with the plan named, and the local
road shares the same daily count.

The named device answers every call while it is awake, because a tab id lives
inside one browser: a call that lands on your everyday profile and the next call
that lands on another profile leaves the agent holding a tab id that exists on
neither. When the named device is asleep the server refuses by name instead of
switching - `pinned_device_not_live`, naming how long it has been silent, which
browsers are awake, and the header to send. Send `X-Opera-Device: any` when you
want the freshest awake browser and do not care which one it is.

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

### The whole page, not one window

`read_page` reads one viewport at a time. `read_page_map` reads the document:
every meaningful element, named by one of seventeen classes, with a rectangle
in **document coordinates** — so a map taken before a scroll still names the
right place after it, while `ref` stays the key that clicks.

Call it once with no `class` and it answers the skeleton: the document size,
one row per class with a count and a box, the regions, the headings, the tables
and the images. Call it again with one `class`, `offset` and `limit` (default
200, maximum 1000) and it answers that class. `hasMore` and `nextOffset` name
the next pull; when a pull would cross the device's 512 KiB ceiling it keeps
its head, sets `truncated: true`, and `nextOffset` still points at the first
element it did not send.

```json
{ "ok": true, "tabId": 12, "class": "link", "offset": 0, "limit": 200,
  "total": 2274, "hasMore": true, "nextOffset": 200, "elements": [ ... ] }
```

`capture_page { "fullPage": true }` takes the whole document as one image. When
that image would be unreadable — under 320 px wide, or scaled below 0.2 — or
when the capture fails, the page comes back as `tiles` instead: strips one
viewport tall at scale 1, cut on document coordinates without scrolling the
page the person is watching. Each tile is one image block; the set is walked
with `tileOffset`, and `tileCount`, `coveredHeight` and `nextTileOffset` say how
much of the document a slice covers.

### When the worker itself fails

The extension's service worker catches its own faults: errors it does not
catch, promise rejections nobody handled, and named API failures like an
accessibility probe or a page-content ping that broke. They are not lost to
`chrome://extensions` any more. `browser_status` answers with them as `errors`
— one row per distinct fault, carrying `code`, `message`, `count`, `firstAt`
and `lastAt` — and `errorCount`, the total seen since the worker started, which
does not shrink when the list is cleared. Twenty distinct faults are kept;
if the answer would not fit, the oldest rows are dropped and the answer says
`errorsTruncated` with `omittedErrors`.

## 2. `opera-agent-mcp local`

The same tools over stdio, driving the everyday browser on this machine
through the loopback bridge — no cloud round trip per command.

```bash
npm i -g opera-agent-mcp
```

Point a client at it:

```json
{
  "mcpServers": {
    "opera-agent": {
      "command": "opera-agent-mcp",
      "args": ["local"]
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
cloud cannot be reached. A command past the session allowance is answered
`PLAN_LIMIT_REACHED` with the plan named. The usage is reported when the
session ends, so the local road and the hosted road share one daily count
per account — `plan.pilot` carries 200 commands per day and 50 per session;
`plan.firm` carries 5000 and 500. The gate lives in the bridge and in the
hosted MCP, never in readable client code. `opera-agent-mcp doctor` prints
the bridge, the device, the extension version, the plan, and the quota.

`browser_status` answers with the port the drive is really on, so read it
first: `port: 9451` means the extension road.

The server advertises 54 tools. `guide()` returns them as tasks rather than a
list, and the full list is in [`local/README.md`](../local/README.md).

The local wire prints the same shape as the hosted one: one flat document per
call, `{ ok: true, ...facts }` with the cost of the call under `elapsedMs`, and a
refused tool answering `{ ok: false, error: { code, message } }` with the next
move in the message. A refusal is an answer, not a broken protocol.

## 3. `opera-agent-mcp cloud` and the extension road

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

`opera-agent-mcp cloud` points the same tools at the hosted server through
OAuth (or `OPERA_AGENT_MCP_TOKEN`), for machines and callers that should pay
through the account instead of the loopback road.

What a caller gets wrong: the bridge keeps every browser it is given and names
each one apart, so the second browser on the machine is a device too, not a
rejection. Every new browser re-pairs as itself instead of displacing the
other's token.

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

The hosted server and the installed package are two modes of one command. The
cloud mode needs an account and a paired device; the local mode needs the
extension, a paired browser, and one cloud call per session. Both roads are
metered by the same shared daily count, with the gate in the bridge and in the
hosted MCP — never in readable client code.
