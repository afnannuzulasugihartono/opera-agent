#!/usr/bin/env python3
"""Privacy-hardened repo-local Repowise MCP server launcher (stdio only)."""

from __future__ import annotations

import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
VENV = ROOT / ".repowise-venv"
INDEX_DB = ROOT / ".repowise" / "wiki.db"

LOCAL_TOOLS = (
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
)

PROVIDER_KEYS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
    "KIMI_API_KEY",
    "EDENAI_API_KEY",
)


def _repowise_executable() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "repowise.exe"
    return VENV / "bin" / "repowise"


def main() -> int:
    repowise = _repowise_executable()
    if not repowise.is_file():
        print(
            "Repowise is not installed in .repowise-venv; "
            "run: python tools/repowise/bootstrap.py",
            file=sys.stderr,
        )
        return 2
    if not INDEX_DB.is_file():
        print(
            "Repowise index is missing (.repowise/wiki.db); "
            "run the privacy-hardened local index before starting MCP.",
            file=sys.stderr,
        )
        return 3

    env = os.environ.copy()
    env.update(
        {
            "DO_NOT_TRACK": "1",
            "REPOWISE_TELEMETRY_DISABLED": "1",
            "REPOWISE_SKIP_EDITOR_SETUP": "1",
            "REPOWISE_NO_SAVE_KEY": "1",
            "REPOWISE_HOST": "127.0.0.1",
        }
    )

    # Repowise's MCP command loads .repowise/.env. Pre-seeding provider keys as
    # empty keeps python-dotenv from filling them later, so this R4 launcher
    # cannot silently turn local codebase context into provider-backed synthesis.
    for name in PROVIDER_KEYS:
        env[name] = ""

    argv = [
        str(repowise),
        "mcp",
        str(ROOT),
        "--transport",
        "stdio",
        "--tools",
        ",".join(LOCAL_TOOLS),
        "--no-workspace",
    ]

    # Replace this process so the MCP client is the server's direct ancestor and
    # Repowise's stdio parent-death watchdog keeps its intended lifecycle.
    os.execve(str(repowise), argv, env)
    return 127


if __name__ == "__main__":
    raise SystemExit(main())
