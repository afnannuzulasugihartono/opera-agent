@last-edited: 2026-10-23 UTC+7.
@related: [`AGENTS.md`](../AGENTS.md) - [`agent-map.md`](agent-map.md) - [`api.md`](api.md) - [`product/browser-latency.md`](product/browser-latency.md)

# Naming

Four name spaces meet in this product, and each one is read by a different machine. The separator a name uses says which space it belongs to, so a name that arrives in a log, a stack trace or a model's tool list can be placed without being told.

The rule in one line: **a dot separates namespaces, an underscore separates words, and a hyphen is not used as a separator anywhere.**

## The four spaces

| Space | Shape | Example | Read by |
|---|---|---|---|
| MCP tool name | `snake_case` | `browser_status`, `click_row`, `wait_for`, `ax_snapshot` | the model, and the person reading a tool list |
| OpenCode native tool name | `namespace_snake_case` | `opera_read_page`, `opera_fetch` | the model, in OpenCode's own tool list |
| Wire method name | `namespace.action` | `tabs.list`, `page.click`, `browser.burst`, `page.wait_for` | the service worker, the bridge and the gateway |
| Postgres function and argument name | `snake_case` | `opera_claim_next_wait`, `p_device_name` | Postgres, and the edge functions that call it |

## Why the MCP tool names are underscored

The tool name is the product's surface: it is the word a model types and the line a human reads in a tool list. It is underscored for two reasons that are both mechanical rather than aesthetic.

**A dot is already taken.** The dot is the namespace separator of the wire protocol underneath, where `page.click` and `tabs.list` name the method a tool ends up calling. A tool named `page.click` would be the transport wearing the product's name, and one line in a log would not say which layer had answered. Two layers need two names.

**A hyphen is refused by every identifier this tree writes.** The Postgres functions, the workflow names in the migrations, and the plugin manifest's `name_for_model` are all read as bare identifiers, and a hyphen forces quoting in each of them. An underscore survives JavaScript, TypeScript and SQL unquoted, so it is the one separator that never has to be escaped.

The same reasoning holds one layer down, which is why the wire protocol uses an underscore *inside* a name as well: `page.wait_for`, not `page.waitfor` and not `page.wait-for`.

## Why the OpenCode native tool names carry a namespace

OpenCode joins a namespace and a tool name with an underscore, so `opera` plus `read_page` is the native `opera_read_page`.

The prefix keeps Opera's tools apart from the built-ins the model already knows — `read`, `write`, `webfetch` — and it tells the model which surface it is standing on, the same way `tabs.list` says the wire is talking.

The name behind the prefix is the same snake_case the MCP surface uses, because it is the same tool: `local/tools.js` is one table, and `local/bin/opera-opencode.js` registers it as native tools without copying a single name.

## Where each shape lives

The wire contract is one file, `extension/lib/protocol.js`, and it is the source both the service worker and the Node tests read:

- `METHOD_SPECS` holds the dotted methods: `browser.ping`, `browser.burst`, `tabs.list`, `tabs.open`, `tabs.navigate`, `page.read`, `page.click`, `page.key`, `page.wait_for`.
- `BURST_ACTION_METHODS` maps a burst step's short verb to the dotted method it runs: `read` to `page.read`, `wait` to `page.wait_for`, `navigate` to `tabs.navigate`.

The tool surface is data, in two places for two surfaces:

- `local/tools.js` — the local stdio server's tools, and the table the OpenCode plugin registers as native tools.
- `supabase/functions/opera-agent-mcp/tools.ts` — the cloud server's tools, registered one `registerTool` call each.

The Postgres names are in the migrations, and the edge functions refuse anything that is not a bare identifier before it reaches the database: `supabase/functions/opera-agent-mcp/index.ts` and `supabase/functions/opera-agent-bridge/index.ts` both reject a function or argument name that fails `^[a-z_][a-z0-9_]*$`.

## What enforces it

The shapes are pinned by tests, so a name in the wrong shape fails a gate rather than reaching a user:

- `tests/readme.test.mjs` reads the local tool names out of `local/tools.js` and counts them against the number the README claims.
- `tests/ax-observation.test.mjs` counts the cloud tools by matching `server.registerTool("([a-z_]+)"`, and pins the total at 34.
- `docs/api.md` documents the gateway's `method` parameter and the pattern it must match, and `tests/api-docs.test.mjs` fails when that document stops covering the routed paths.

## Adding a name

A new name belongs to exactly one of the three spaces, and the shape follows from the space rather than from taste.

A cloud tool that wraps one wire method is named for the job the caller asks for, never for the method it sends: the surface calls it `click_element` while the method underneath is `page.click`, `fill_element` for `page.fill`, and `run_browser_burst` for `browser.burst`. The local surface names the same jobs the same way — `click_row`, `browser_burst`, `read_page` — and it sends no wire method at all, because it drives the browser over CDP directly.

A new wire method is added to `METHOD_SPECS` in `extension/lib/protocol.js` and nowhere else. That file is the one the service worker, the MCP server and the Node tests all read, which is why a second copy of the list has never been allowed to exist.
