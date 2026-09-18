#!/usr/bin/env python3
"""Assert that a Repowise R3 metrics report passed its verification gates."""

from __future__ import annotations

import json
from pathlib import Path
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: r3_assert.py REPORT.json", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    report = json.loads(path.read_text(encoding="utf-8"))
    if not report.get("verification_passed"):
        print("R3 verification failed; inspect repowise-r3-report.json", file=sys.stderr)
        return 1

    print("R3 verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
