# Opera Agent next-session handoff

Last synchronized: 2026-09-18.

Checkpoint 8D remains closed. Performance Track P0–P5 is accepted. P6 is a
**FINAL CANDIDATE**, not yet accepted: exact head
`96ef1cfdbecc7c5c0e40486b6378501db606b84d` has CircleCI #117 + Vercel
SUCCESS, while the required independent audit remains pending. Milestone 8E is
paused/not started. The current active workstream is the separate, bounded Repowise
integration track; P6 audit work is intentionally deferred in this session.

## Authoritative boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Accepted P5 / canonical P6 base:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- Candidate branch:
  `feat/performance-runtime-cutover-p6-4571636311958769504`
- Exact P6 final-candidate head:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- Exact-head CI: CircleCI #117 + Vercel SUCCESS
- Stable extension: 1.6.0
- Protocol: 1
- Browser capabilities: 26
- Public MCP tools: 18
- Signed rollback: 1.5.2
- 8E: paused/not started
- P6 production deploy/promotion: not done

## P6 candidate facts

- Durable 7E host consumes P1/P2/P3 reconciliation after `opera_await`; DB lease,
  checkpoint, effect reservation/idempotency, and host tokens remain authoritative.
- Caller `taskDependencies` are rejected. Without a trustworthy
  server-authoritative dependency source, live context is MISSING and relevance
  conservatively yields REASON_REQUIRED. Do **not** claim full integrated P3/P4
  speedup yet.
- Cold start/lost continuity -> RESET_REQUIRED + FULL_SNAPSHOT.
- With P6 metadata, only a valid accepted APPLY_AND_CONTINUE may continue VM
  execution. IGNORE_FOR_TASK, REASON_REQUIRED, unknown/missing/malformed or
  inconsistent decisions fail closed; reset suspends STALE_TARGET.
- Effect results without P6 metadata retain pre-P6 compatibility.
- Low-level `opera_enqueue` / `opera_await`, full page text/snapshot recovery,
  18 MCP tools, Protocol 1, and 26 capabilities remain intact.
- No production deploy, schema migration, OAuth/signing/pairing/public-schema
  expansion, transaction authority, or 8E work occurred.

## Evidence

- `b8cd79f27f135923a63657beced8563ed7e7a0c7` — tests-first;
  CircleCI #114 expected red.
- `5652435e26f534126bfcee7c48df9ffd597fc52e` — control-flow allowlist
  implementation; P6 tests green, historical byte locks exposed as stale.
- `49731c49e75df058dcd48218e680a8ad9aaf7195` — authorized lock rebaseline;
  CircleCI #116 + Vercel SUCCESS.
- #116 full suite: **416/416 PASS**, 0 fail, 0 skipped.
- `npm run check`: PASS, 26 primitives, version 1.6.0.
- Chromium extension regression: PASS.


## Repowise integration state

- Branch: `chore/repowise-integration`
- R1: **PASS** — Repowise 0.51.0 compatibility/privacy/local-MCP research complete.
- R2 repo setup head:
  `706001747aefb9b629d4e301a30d814f5e9754e3`
- R2 CI: CircleCI #119 + Vercel **SUCCESS**.
- Repo changes are limited to:
  - `.gitignore`: local `.repowise/` and `.repowise-venv/`;
  - `tools/repowise/requirements.txt`: `repowise==0.51.0`;
  - `tools/repowise/bootstrap.py`: isolated repo-local installer/version check with
    telemetry disabled.
- No Node dependency was added; no unrelated dependency was upgraded.
- No editor/user MCP config, AGENTS.md managed section, provider key, Repowise
  database/index, or generated cache was committed.
- Runtime installation could not be executed in the ChatGPT sandbox because DNS
  egress to GitHub/PyPI is unavailable. The sandbox otherwise satisfies the runtime
  floor (Python 3.13.5, Git 2.47.3).
- **R3 has not started.** When explicitly resumed, run the pinned bootstrap in an
  environment with package access, then initialize Repowise locally with no prose,
  no editor setup, no saved key, and telemetry disabled before measuring the index.


## Repowise R3 initial-index gate

R3 is **BLOCKED ON EVIDENCE RETRIEVAL**.

Exact diagnostic head:
`48f5943bca165088a329d40a55c8cdf54571a221`.

Known facts:

- CircleCI #129 Repowise install: SUCCESS.
- CircleCI #126 raw privacy-hardened `repowise init`: SUCCESS.
- CircleCI #128 metrics collection: SUCCESS; private artifact
  `repowise-r3-report.json` exists.
- CircleCI #127 normal regression suite: SUCCESS.
- Vercel: SUCCESS.
- CircleCI #125 earlier strict verification: FAILURE; do not infer why without the
  report.
- GitHub Actions was not a usable runner on this account for the probe; its failed
  run never executed steps.
- Current ChatGPT tools cannot authenticate to the private CircleCI log/artifact
  surface. Do not guess elapsed time, size, counts, parse errors, or important-file
  verification.

The temporary multi-job CircleCI diagnostics are removed at session close; normal
CI is restored. `tools/repowise/r3_probe.py` and
`tools/repowise/r3_assert.py` remain as bounded R3 utilities.

Next R3 action only: read the job #128 metrics artifact through an authenticated
CircleCI session, evaluate every required field and the seven important files, then
either close R3 or make one evidence-driven correction. Do not start R4.

## Exact next gate

1. Require CircleCI + Vercel SUCCESS on the documentation closeout head.
2. If either is pending: STOP. If failure: diagnose P6 only.
3. When both are green, freeze that SHA as the P6 final candidate.
4. Run a fresh independent audit over accepted P5
   `a215dd0ddb4d7be9b0c0276862ced3ea26439c77` -> exact P6 candidate.
5. `AGENTS.md` currently specifically names **Codex** as the independent milestone
   auditor. Do not treat another reviewer as satisfying that literal gate unless the
   user explicitly accepts the documented reviewer deviation/residual risk.
6. Do not merge/promote P6 or start 8E until the gate above is resolved.

## Preserved rollback / stash warning

- Accepted P5 remains the clean rollback baseline for this candidate.
- Signed rollback 1.5.2 remains available.
- Two accidental untracked 8E files remain preserved in the git stash named
  **"preserve accidental 8E files before completing checkpoint 8D"**.
  Never pop/apply/delete/build from that stash automatically.
