from __future__ import annotations

import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VENV = ROOT / ".spec-kit-venv"
PIN = "specify-cli==1.0.8"


def run(args: list[str]) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def main() -> int:
    if sys.version_info < (3, 11):
        raise SystemExit("Spec Kit requires Python 3.11+")
    if not VENV.exists():
        venv.EnvBuilder(with_pip=True).create(VENV)
    python = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    specify = VENV / ("Scripts/specify.exe" if os.name == "nt" else "bin/specify")
    run([str(python), "-m", "pip", "install", "--disable-pip-version-check", PIN])
    result = subprocess.run(
        [str(specify), "--version"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    print(result.stdout.strip() or result.stderr.strip())
    print("Spec Kit scaffold is repository-managed; do not rerun init blindly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
