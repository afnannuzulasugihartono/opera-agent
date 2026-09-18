#!/usr/bin/env python3
"""Privacy-hardened repo-local Repowise MCP server launcher (stdio only)."""

from __future__ import annotations

import errno
import os
from pathlib import Path
import socket
import sys
from typing import NoReturn

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


def _venv_python() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def _privacy_environment() -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "DO_NOT_TRACK": "1",
            "REPOWISE_TELEMETRY_DISABLED": "1",
            "REPOWISE_SKIP_EDITOR_SETUP": "1",
            "REPOWISE_NO_SAVE_KEY": "1",
            "REPOWISE_HOST": "127.0.0.1",
            "REPOWISE_PROVIDER": "mock",
            "REPOWISE_EMBEDDER": "mock",
            "REPOWISE_R4_LOCAL_ONLY": "1",
        }
    )
    for name in PROVIDER_KEYS:
        env[name] = ""
    return env


def _reexec_in_venv() -> NoReturn:
    python = _venv_python()
    if not python.is_file():
        print(
            "Repowise is not installed in .repowise-venv; "
            "run: python tools/repowise/bootstrap.py",
            file=sys.stderr,
        )
        raise SystemExit(2)
    os.execve(
        str(python),
        [str(python), str(Path(__file__).resolve())],
        _privacy_environment(),
    )
    raise AssertionError("os.execve returned unexpectedly")


def _disable_outbound_network() -> None:
    """Deny DNS/TCP/UDP egress while preserving local AF_UNIX IPC."""

    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def blocked_getaddrinfo(*_args, **_kwargs):
        raise OSError(errno.EPERM, "Outbound network disabled by local Repowise MCP launcher")

    def blocked_create_connection(*_args, **_kwargs):
        raise OSError(errno.EPERM, "Outbound network disabled by local Repowise MCP launcher")

    def guarded_connect(sock: socket.socket, address):
        if sock.family == getattr(socket, "AF_UNIX", object()):
            return original_connect(sock, address)
        raise OSError(errno.EPERM, "Outbound network disabled by local Repowise MCP launcher")

    def guarded_connect_ex(sock: socket.socket, address):
        if sock.family == getattr(socket, "AF_UNIX", object()):
            return original_connect_ex(sock, address)
        return errno.EPERM

    socket.getaddrinfo = blocked_getaddrinfo
    socket.create_connection = blocked_create_connection
    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex


def _disable_release_poll() -> None:
    """Replace Repowise's advisory PyPI poll with an offline local result."""

    from repowise.core.upgrade import release

    def offline_release_check(current_version: str, **_kwargs):
        return release.ReleaseCheck(
            current_version=current_version,
            latest_version=None,
            update_available=None,
            error="release check disabled by Opera Agent local MCP launcher",
        )

    release.check_latest_version_cached = offline_release_check


def _run_server() -> int:
    if not INDEX_DB.is_file():
        print(
            "Repowise index is missing (.repowise/wiki.db); "
            "build the privacy-hardened local index before starting MCP.",
            file=sys.stderr,
        )
        return 3

    # Direct run avoids repowise.cli.ui.load_dotenv(), so project-local provider
    # secrets are never imported into this R4 process.
    _disable_outbound_network()
    _disable_release_poll()

    from repowise.server.mcp_server import run_mcp

    run_mcp(
        transport="stdio",
        repo_path=str(ROOT),
        host="127.0.0.1",
        tools=",".join(LOCAL_TOOLS),
        workspace_mode=False,
    )
    return 0


def main() -> int:
    python = _venv_python()
    try:
        inside_venv = python.is_file() and Path(sys.executable).resolve() == python.resolve()
    except OSError:
        inside_venv = False

    if not inside_venv:
        _reexec_in_venv()

    # Reassert the privacy boundary even when a host launched the venv Python
    # directly instead of entering through the re-exec path.
    os.environ.update(_privacy_environment())
    return _run_server()


if __name__ == "__main__":
    raise SystemExit(main())
