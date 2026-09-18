#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
WRAPPER = ROOT / "tools" / "repowise" / "mcp_stdio.py"

CALLS = {
    "A": [
        ("get_dependency_path", {"source": "supabase/functions/opera-agent-vm/index.ts", "target": "lib/reactive-vm.js"}),
        ("get_dependency_path", {"source": "supabase/functions/opera-agent-vm/index.ts", "target": "lib/multi-signal-relevance-p3.js"}),
    ],
    "B": [
        ("get_context", {"targets": ["lib/reactive-vm.js::advanceReactiveVm"], "include": ["callers", "callees", "ownership", "metrics"], "compact": False}),
        ("get_risk", {"targets": ["lib/reactive-vm.js"], "changed_files": ["lib/reactive-vm.js"]}),
    ],
    "C": [
        ("get_context", {"targets": ["supabase/functions/opera-agent-vm/index.ts"], "include": ["callers", "callees", "ownership", "metrics"], "compact": False}),
        ("search_codebase", {"query": "opera_vm_checkpoint effect reservation idempotency durable VM state", "limit": 8, "mode": "fulltext"}),
    ],
    "D": [
        ("get_why", {"query": "why is full P3 P4 acceleration not enabled in P6", "targets": ["docs/delta-first-performance-plan.md", "lib/reactive-vm-host-7e.js"]}),
        ("search_codebase", {"query": "taskDependencies REASON_REQUIRED APPLY_AND_CONTINUE", "limit": 8, "mode": "fulltext"}),
    ],
    "E": [
        ("search_codebase", {"query": "server.registerTool", "limit": 8, "mode": "fulltext"}),
        ("get_context", {"targets": ["supabase/functions/opera-agent-mcp/index.ts"], "compact": False}),
    ],
}

RG = {
    "A": r"reconcileVmEffectObservation7E|advanceReactiveVm7D|multi-signal-relevance-p3|reactive-vm-7d",
    "B": r"advanceReactiveVm",
    "C": r"opera_vm_(claim|checkpoint|effect_reserve|effect_attach|effect_finish)|idempotency",
    "D": r"taskDependencies|REASON_REQUIRED|APPLY_AND_CONTINUE",
    "E": r"server\.registerTool",
}

PATH_RE = re.compile(r"((?:lib|tests|docs|supabase|extension|scripts|tools)/[A-Za-z0-9_./-]+\.(?:js|mjs|ts|md|json|py|sql))")


def extract_text(result):
    parts = []
    for item in getattr(result, "content", []) or []:
        value = getattr(item, "text", None)
        if isinstance(value, str):
            parts.append(value)
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        parts.append(json.dumps(structured, sort_keys=True, default=str))
    return "\n".join(parts)


def paths_in(text):
    return sorted(set(PATH_RE.findall(text)))


def rg_files(pattern):
    proc = subprocess.run(
        ["rg", "-l", "--glob", "!node_modules/**", "--glob", "!.repowise/**", pattern, "."],
        cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode not in (0, 1):
        raise RuntimeError(proc.stderr)
    return sorted(line[2:] if line.startswith("./") else line for line in proc.stdout.splitlines() if line.strip())


async def run():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    report = {
        "schema": "opera-agent-repowise-r6-v1",
        "repository_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "repowise": {},
        "baseline": {},
    }

    params = StdioServerParameters(command=sys.executable, args=[str(WRAPPER)], cwd=str(ROOT))
    async with stdio_client(params) as streams:
        read_stream, write_stream = streams
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            for qid, specs in CALLS.items():
                entries = []
                all_text = []
                started = time.perf_counter()
                for tool, args in specs:
                    t0 = time.perf_counter()
                    result = await session.call_tool(tool, args)
                    text = extract_text(result)
                    if getattr(result, "isError", False):
                        raise RuntimeError(f"{qid}/{tool}: {text[:500]}")
                    entries.append({
                        "tool": tool,
                        "elapsed_seconds": round(time.perf_counter() - t0, 6),
                        "paths": paths_in(text),
                        "text": text,
                    })
                    all_text.append(text)
                merged = "\n".join(all_text)
                surfaced = paths_in(merged)
                report["repowise"][qid] = {
                    "tool_call_count": len(specs),
                    "elapsed_seconds": round(time.perf_counter() - started, 6),
                    "surfaced_paths": surfaced,
                    "nonexistent_path_mentions": [p for p in surfaced if not (ROOT / p).exists()],
                    "calls": entries,
                }

    for qid, pattern in RG.items():
        t0 = time.perf_counter()
        files = rg_files(pattern)
        report["baseline"][qid] = {
            "grep_call_count": 1,
            "candidate_file_count": len(files),
            "candidate_files": files,
            "elapsed_seconds": round(time.perf_counter() - t0, 6),
        }

    report["summary"] = {
        "repowise_tool_calls": sum(v["tool_call_count"] for v in report["repowise"].values()),
        "baseline_grep_calls": 5,
        "baseline_candidate_files_sum": sum(v["candidate_file_count"] for v in report["baseline"].values()),
        "baseline_unique_candidate_files": len({p for v in report["baseline"].values() for p in v["candidate_files"]}),
        "repowise_nonexistent_path_mentions": sum(len(v["nonexistent_path_mentions"]) for v in report["repowise"].values()),
    }
    return report


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    report = asyncio.run(run())
    payload = json.dumps(report, indent=2, sort_keys=True)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload + "\n", encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
