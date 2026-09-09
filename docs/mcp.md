# Opera Agent MCP server

Opera Agent exposes a stateless Streamable HTTP MCP server at:

```text
https://<project-ref>.supabase.co/functions/v1/opera-agent-mcp
```

The MCP layer gives AI clients focused, discoverable browser tools. Supabase remains an internal authenticated command transport, so users can ask to operate Opera without naming the database or relay.

## Tools

The server exposes focused tools for browser health, tabs, page reading, semantic element discovery, trusted element clicks, safe field input, navigation keys, page scrolling, and visible pointer move/click/drag/wheel operations. It intentionally does not expose a raw command tool.

The extension remains the enforcement boundary. It validates the method allowlist and blocks password, PIN, OTP, payment/security-code, and file-upload targets.

## Authentication

Every MCP request requires a Bearer token. Two authentication modes are supported:

- `OPERA_AGENT_MCP_TOKEN`: a private static token for MCP Inspector, development, and controlled service clients.
- Supabase Auth JWT: intended for ChatGPT and other OAuth clients. The user's ID or lowercase email must also appear in `OPERA_AGENT_MCP_USER_IDS` or `OPERA_AGENT_MCP_USER_EMAILS` (comma-separated).

Never place the service-role key, static token, or extension device token in a client configuration, URL, repository file, or chat message.

For OAuth clients, enable the Supabase Auth OAuth 2.1 server, configure the deployed Vercel authorization page, and allowlist the owner's Supabase Auth user ID or email. The `opera-agent-auth/config` Edge route exposes only the public Supabase client configuration to that page. The MCP protected-resource metadata points clients to the Supabase authorization server.

## Deploy

```powershell
npx --yes supabase@latest secrets set OPERA_AGENT_MCP_TOKEN=<random-secret> --project-ref <project-ref>
npx --yes supabase@latest functions deploy opera-agent-mcp --project-ref <project-ref> --no-verify-jwt --use-api
```

`--no-verify-jwt` is required because the function validates both development tokens and allowlisted Supabase JWTs itself. It does not make the endpoint anonymous.

## Verification

Health check:

```text
GET /functions/v1/opera-agent-mcp/health
```

Schema portability and discovery:

```powershell
npx --yes @modelcontextprotocol/inspector --cli <mcp-url> --transport http --method tools/list --strict --header "Authorization: Bearer <token>"
```

The production acceptance sequence is:

1. Confirm an unauthenticated MCP POST returns HTTP 401.
2. Run MCP Inspector `tools/list --strict`.
3. Call `browser_status` and confirm the paired extension version.
4. List tabs and choose an HTTP/HTTPS tab.
5. Read a bounded page sample.
6. Move the visible pointer without clicking.
7. Restore the previously active tab.

## ChatGPT setup

After OAuth is enabled and tested, enable Developer mode in ChatGPT, create a custom app/connector named `Opera Agent`, and enter the MCP URL. Its server instructions and tool descriptions tell the model when to use the local browser, so the user does not need to mention Supabase in each chat.
