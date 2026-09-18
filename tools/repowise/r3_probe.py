#!/usr/bin/env python3
"""Run a privacy-hardened Repowise initial index and emit non-sensitive R3 metrics."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
VENV_DIR = ROOT / ".repowise-venv"
REPOWISE_DIR = ROOT / ".repowise"
IMPORTANT_FILES = [
    "lib/reactive-vm.js",
    "lib/reactive-vm-host-7e.js",
    "lib/multi-signal-relevance-p3.js",
    "supabase/functions/opera-agent-vm/index.ts",
    "tests/performance-runtime-cutover-p6.test.mjs",
    "AGENTS.md",
    "docs/delta-first-performance-plan.md",
]
PROVIDER_KEY_NAMES = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
)
PROJECT_SIDE_EFFECT_PATHS = (
    ".mcp.json",
    ".claude/CLAUDE.md",
    ".vscode/mcp.json",
    ".vscode/extensions.json",
    ".codex/config.toml",
)


def _repowise_executable() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "repowise.exe"
    return VENV_DIR / "bin" / "repowise"


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def _directory_size(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def _count(conn: sqlite3.Connection, sql: str, params: tuple[object, ...] = ()) -> int:
    row = conn.execute(sql, params).fetchone()
    return int(row[0]) if row else 0


def _write_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    repowise = _repowise_executable()
    report: dict[str, object] = {
        "schema": "opera-agent-repowise-r3-v1",
        "repository_head": _git("rev-parse", "HEAD"),
        "repository_branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
        "git_commit_count": int(_git("rev-list", "--count", "HEAD")),
        "tracked_file_count": len(_git("ls-files").splitlines()),
        "important_files": {},
        "privacy": {
            "telemetry_disabled": True,
            "editor_setup_disabled": True,
            "key_persistence_disabled": True,
            "prose_generation_disabled": True,
            "embedder": "mock",
            "provider_keys_removed_from_child_environment": list(PROVIDER_KEY_NAMES),
        },
    }

    if not repowise.is_file():
        report["error"] = f"Repowise executable missing at {repowise.relative_to(ROOT)}"
        _write_report(args.report, report)
        return 2

    before_status = _git("status", "--porcelain=v1")
    before_side_effects = {
        path: (ROOT / path).exists() for path in PROJECT_SIDE_EFFECT_PATHS
    }

    env = os.environ.copy()
    for name in PROVIDER_KEY_NAMES:
        env.pop(name, None)
    env.update(
        {
            "DO_NOT_TRACK": "1",
            "REPOWISE_TELEMETRY_DISABLED": "1",
            "REPOWISE_SKIP_EDITOR_SETUP": "1",
            "REPOWISE_NO_SAVE_KEY": "1",
            "REPOWISE_GIT_WINDOW_ANCHOR": "head",
            "PYTHONIOENCODING": "utf-8",
        }
    )

    command = [
        str(repowise),
        "init",
        str(ROOT),
        "--yes",
        "--no-prose",
        "--no-editor-setup",
        "--no-save-key",
        "--embedder",
        "mock",
    ]
    started = time.perf_counter()
    proc = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    elapsed = time.perf_counter() - started

    report["repowise_version"] = subprocess.run(
        [str(repowise), "--version"],
        cwd=ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    ).stdout.strip()
    report["init"] = {
        "returncode": proc.returncode,
        "elapsed_seconds": round(elapsed, 3),
    }

    if proc.returncode != 0:
        report["init"]["stdout_tail"] = proc.stdout.splitlines()[-20:]
        report["init"]["stderr_tail"] = proc.stderr.splitlines()[-20:]
        _write_report(args.report, report)
        return proc.returncode

    db = REPOWISE_DIR / "wiki.db"
    if not db.is_file():
        report["error"] = "Repowise init exited 0 but .repowise/wiki.db is missing"
        _write_report(args.report, report)
        return 3

    with sqlite3.connect(db) as conn:
        indexed_file_count = _count(
            conn, "SELECT COUNT(*) FROM graph_nodes WHERE node_type = 'file'"
        )
        parse_error_count = _count(
            conn,
            "SELECT COUNT(*) FROM graph_nodes WHERE node_type = 'file' AND has_error = 1",
        )
        parse_error_files = [
            row[0]
            for row in conn.execute(
                "SELECT node_id FROM graph_nodes "
                "WHERE node_type = 'file' AND has_error = 1 ORDER BY node_id"
            ).fetchall()
        ]
        page_count = _count(conn, "SELECT COUNT(*) FROM wiki_pages")
        symbol_count = _count(conn, "SELECT COUNT(*) FROM wiki_symbols")
        git_metadata_count = _count(conn, "SELECT COUNT(*) FROM git_metadata")
        repo_row = conn.execute(
            "SELECT head_commit, total_commit_count FROM repositories LIMIT 1"
        ).fetchone()

        important: dict[str, object] = {}
        for path in IMPORTANT_FILES:
            graph_row = conn.execute(
                "SELECT language, has_error, symbol_count, is_entry_point "
                "FROM graph_nodes WHERE node_type = 'file' AND node_id = ? LIMIT 1",
                (path,),
            ).fetchone()
            page_row = conn.execute(
                "SELECT id, freshness_status FROM wiki_pages "
                "WHERE target_path = ? LIMIT 1",
                (path,),
            ).fetchone()
            important[path] = {
                "graph_indexed": graph_row is not None,
                "wiki_page_present": page_row is not None,
                "parse_error": bool(graph_row[1]) if graph_row else None,
                "language": graph_row[0] if graph_row else None,
                "symbol_count": int(graph_row[2]) if graph_row else None,
                "entry_point": bool(graph_row[3]) if graph_row else None,
                "freshness": page_row[1] if page_row else None,
            }
        report["important_files"] = important

    after_status = _git("status", "--porcelain=v1")
    after_side_effects = {
        path: (ROOT / path).exists() for path in PROJECT_SIDE_EFFECT_PATHS
    }
    unexpected_side_effects = [
        path
        for path in PROJECT_SIDE_EFFECT_PATHS
        if not before_side_effects[path] and after_side_effects[path]
    ]

    report["index"] = {
        "size_bytes": _directory_size(REPOWISE_DIR),
        "indexed_file_count": indexed_file_count,
        "parse_error_count": parse_error_count,
        "parse_error_files": parse_error_files,
        "wiki_page_count": page_count,
        "symbol_count": symbol_count,
        "git_metadata_count": git_metadata_count,
        "indexed_head_commit": repo_row[0] if repo_row else None,
        "indexed_total_commit_count": int(repo_row[1])
        if repo_row and repo_row[1] is not None
        else None,
    }
    report["working_tree"] = {
        "clean_before": not bool(before_status),
        "clean_after": not bool(after_status),
        "unexpected_project_side_effects": unexpected_side_effects,
    }

    important_ok = all(
        isinstance(value, dict)
        and value.get("graph_indexed")
        and value.get("wiki_page_present")
        and value.get("parse_error") is False
        for value in report["important_files"].values()
    )
    report["verification_passed"] = bool(
        proc.returncode == 0
        and parse_error_count == 0
        and important_ok
        and not unexpected_side_effects
        and not after_status
        and repo_row
        and repo_row[0] == report["repository_head"]
    )

    _write_report(args.report, report)
    return 0 if report["verification_passed"] else 4


if __name__ == "__main__":
    raise SystemExit(main())
