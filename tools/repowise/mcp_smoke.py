#!/usr/bin/env python3
"""R4 acceptance smoke test for the repo-local Repowise MCP stdio wrapper."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
WRAPPER = ROOT / "tools" / "repowise" / "mcp_stdio.py"
EXPECTED_TOOLS = {
    "get_overview",
    "get_context",
    "get_symbol",
    "search_codebase",
    "get_risk",
    "get_change_risk",
    "get_why",
    "get_dead_code",
    "get_health",
    "get_dependency_path",
}


async def _run() -> dict[str, object]:
    if not WRAPPER.is_file():
        raise RuntimeError(f"R4 MCP wrapper is missing: {WRAPPER.relative_to(ROOT)}")

    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(WRAPPER)],
        cwd=str(ROOT),
    )

    async with stdio_client(params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            listed = await session.list_tools()
            tool_names = {tool.name for tool in listed.tools}
            if tool_names != EXPECTED_TOOLS:
                raise RuntimeError(
                    "Unexpected MCP tool surface: "
                    f"expected={sorted(EXPECTED_TOOLS)} actual={sorted(tool_names)}"
                )

            overview = await session.call_tool("get_overview", {})
            if getattr(overview, "isError", False):
                raise RuntimeError("get_overview returned an MCP error")

    return {
        "transport": "stdio",
        "tool_count": len(EXPECTED_TOOLS),
        "tools": sorted(EXPECTED_TOOLS),
        "overview_call": "ok",
    }


def main() -> int:
    try:
        result = asyncio.run(_run())
    except Exception as exc:
        print(f"R4 MCP smoke failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
