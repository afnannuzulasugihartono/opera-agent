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
- R3: **PASS** at full-history evidence head
  `3a83bbed0177a67ce882237965bc6d3706335b4c`.
- R4 local MCP: **PASS** at offline evidence head
  `abaf20e28fb93fe2488be4ce9f9cbe0721225992`.
- R5 AI codebase-context documentation: **PASS** at
  `e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`; CircleCI #143 + Vercel
  SUCCESS.


## Repowise R3 initial-index gate

R3 is **PASS**.

Exact full-history evidence head:
`3a83bbed0177a67ce882237965bc6d3706335b4c`.

Evidence:

- CircleCI #134 `repowise_r3_full`: SUCCESS.
- CircleCI #133 normal regression: SUCCESS.
- Vercel: SUCCESS.
- Repowise 0.51.0.
- Initial indexing: 34.984s.
- Index size: 18,730,491 bytes (~17.86 MiB).
- 301 graph-indexed files from 312 Git-tracked files.
- 1,429 symbols; 74 deterministic/index-only wiki pages.
- 0 parse errors.
- Git history available: 348/348 commits; 121 `git_metadata` rows.
- 7/7 required files graph-indexed with no parse errors.
- working tree clean before/after; no unexpected project side effects.
- telemetry/editor setup/key persistence/prose generation disabled; mock embedder;
  no provider keys passed to Repowise.
- no Repowise DB/index/cache committed or uploaded.

Important diagnostic lesson: CircleCI checkout is blobless partial-clone by default,
so a plain checkout caused Repowise to skip Git history. The final R3 evidence job
hydrated the full Git object set and removed promisor/partial-clone config before
indexing. The validator was also corrected not to require a generated wiki page for
Markdown/test files; R3 verifies graph indexing + parse health, while separately
requiring Git-history coverage.

Temporary R3-specific CircleCI jobs are removed at closeout. The bounded
`tools/repowise/r3_probe.py` and `tools/repowise/r3_assert.py` utilities remain.

## Repowise R4 local MCP gate

R4 is **PASS**.

Exact offline evidence head:
`abaf20e28fb93fe2488be4ce9f9cbe0721225992`.

Evidence:

- tests-first `9f7ee9d...`: CircleCI #136 expected red; normal #137 + Vercel
  SUCCESS.
- initial MCP implementation `555044f...`: #139 MCP acceptance SUCCESS,
  normal #138 + Vercel SUCCESS, but its log revealed Repowise's advisory PyPI
  release check and therefore did not satisfy the offline boundary.
- offline hardening `abaf20e...`: CircleCI #141 MCP acceptance SUCCESS,
  normal #140 SUCCESS, Vercel SUCCESS.
- final smoke: stdio transport, exactly 10 tools, `get_overview` call OK, and no
  PyPI/HTTP request in the MCP step output.

R4 files retained:

- `tools/repowise/mcp_stdio.py`
- `tools/repowise/mcp_smoke.py`
- `tools/repowise/MCP_CONFIG_TEMPLATES.md`

The launcher is single-repo, stdio-only, provider/embedder `mock`, does not load
project-local provider secrets, disables the release poll, and denies DNS/TCP/UDP
egress. It exposes only:
`get_overview`, `get_context`, `get_symbol`, `search_codebase`,
`get_risk`, `get_change_risk`, `get_why`, `get_dead_code`, `get_health`,
and `get_dependency_path`.

Client configuration remains manual. No Claude/Codex/Gemini/user/editor config was
overwritten, no public MCP endpoint was created, and no ChatGPT tunnel/remote bridge
was configured. No Opera Agent runtime/prod/public-MCP surface changed.

Temporary R4 CircleCI instrumentation is removed at closeout.

## Repowise R5 documentation gate

R5 is **PASS**.

Exact documentation head:
`e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`.

Evidence:

- `docs/AI_CODEBASE_CONTEXT.md` is the durable Repowise operating guide.
- CircleCI #143: SUCCESS.
- Vercel: SUCCESS.
- scope stayed documentation-only; no Opera Agent runtime/prod/public-MCP
  behavior changed.

The guide covers bootstrap, index/rebuild, status, provider-free incremental
updates, CLI queries, local MCP usage, source-of-truth precedence, privacy,
freshness, partial-clone/history caveats, mock-embedder limitations, and the rule
that Repowise is derived context rather than governance/runtime authority.

No npm helper scripts were added because the existing Python entry points are
already cross-platform and avoid shell-specific assumptions.

Exact next Repowise checkpoint: **R6 validation questions + comparison against
normal grep/read exploration**, only after an explicit user request to continue.

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
