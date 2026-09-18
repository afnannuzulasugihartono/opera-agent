# Repowise R4 MCP client templates

These are **manual paste templates**. R4 does not write user-level or editor MCP
configuration. Replace `<ABS_REPO>` with the absolute path to the Opera Agent
checkout. The committed launcher always uses local **stdio**, exposes no HTTP/SSE
port, and starts the isolated `.repowise-venv` install.

The launcher deliberately exposes this local deterministic surface only:
`get_overview`, `get_context`, `get_symbol`, `search_codebase`,
`get_risk`, `get_change_risk`, `get_why`, `get_dead_code`,
`get_health`, and `get_dependency_path`.

## Claude Code / generic mcpServers clients

Paste the server object into the client's project-local MCP configuration when
you explicitly want to enable it:

```json
{
  "mcpServers": {
    "repowise": {
      "command": "python",
      "args": ["<ABS_REPO>/tools/repowise/mcp_stdio.py"]
    }
  }
}
```

Repowise documents the same `mcpServers` shape as the generic paste-config
fallback for hosts such as Gemini CLI. Use that host's MCP settings location;
R4 does not create or overwrite it.

## Codex CLI

Project-local TOML shape:

```toml
[mcp_servers.repowise]
command = "python"
args = ["<ABS_REPO>/tools/repowise/mcp_stdio.py"]
cwd = "<ABS_REPO>"
startup_timeout_sec = 20
```

Do not add Repowise hooks or managed AGENTS sections as part of R4. This
checkpoint is MCP context only.

## ChatGPT

No direct local-stdio ChatGPT template is installed by R4. ChatGPT's custom MCP
connection is a remote-MCP surface rather than a local stdio child process.
A Secure MCP Tunnel can bridge a private/local server without exposing it to the
public internet, but configuring such a tunnel changes the connectivity boundary
and is intentionally outside R4. Do not expose this server on `0.0.0.0` or a
public URL to make ChatGPT reach it.

## Local prerequisites

```text
python tools/repowise/bootstrap.py
# build/update the local .repowise index using the R2/R3 privacy rules
python tools/repowise/mcp_stdio.py
```

The last command speaks MCP on stdin/stdout and is normally launched by an MCP
client rather than by a person.
