#!/usr/bin/env python3
"""Install the pinned Repowise CLI into a repository-local virtual environment."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import venv

MIN_PYTHON = (3, 11)
REPOWISE_VERSION = "0.51.0"
ROOT = Path(__file__).resolve().parents[2]
VENV_DIR = ROOT / ".repowise-venv"
REQUIREMENTS = Path(__file__).with_name("requirements.txt")


def _venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def main() -> int:
    if sys.version_info < MIN_PYTHON:
        print(
            "Repowise 0.51.0 requires Python >= 3.11; "
            f"found {sys.version_info.major}.{sys.version_info.minor}.",
            file=sys.stderr,
        )
        return 2

    if not REQUIREMENTS.is_file():
        print(f"Missing requirements file: {REQUIREMENTS}", file=sys.stderr)
        return 2

    if not VENV_DIR.exists():
        print(f"Creating isolated environment: {VENV_DIR}")
        venv.EnvBuilder(with_pip=True).create(VENV_DIR)

    python = _venv_python()
    env = os.environ.copy()
    env["DO_NOT_TRACK"] = "1"
    env["REPOWISE_TELEMETRY_DISABLED"] = "1"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"

    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-input",
            "--requirement",
            str(REQUIREMENTS),
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )

    probe = subprocess.run(
        [
            str(python),
            "-c",
            "import importlib.metadata; "
            "print(importlib.metadata.version('repowise'))",
        ],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    installed = probe.stdout.strip()
    if installed != REPOWISE_VERSION:
        print(
            f"Repowise version mismatch: expected {REPOWISE_VERSION}, "
            f"found {installed}.",
            file=sys.stderr,
        )
        return 1

    print(f"Repowise {installed} installed locally in {VENV_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
