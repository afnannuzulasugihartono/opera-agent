# Repowise integration final closeout

Date: 2026-09-18

This record closes the bounded Repowise integration track on
`chore/repowise-integration`.

The integration adds local/private codebase intelligence for AI-assisted
orientation, dependency/impact analysis, Git-history context, and MCP queries.
It does **not** replace repository source, governance, tests, CI, or runtime
evidence.

## Base and scope

Integration base:

`96ef1cfdbecc7c5c0e40486b6378501db606b84d`

That base is the existing P6 final candidate. Repowise work does not accept,
merge, promote, or deploy P6 and does not start Milestone 8E.

Net integration scope before this closeout record:

- `.gitignore`
- `docs/AI_CODEBASE_CONTEXT.md`
- `docs/project-context.md`
- `docs/next-session-handoff.md`
- `docs/repowise-r6-validation.md`
- `tools/repowise/MCP_CONFIG_TEMPLATES.md`
- `tools/repowise/bootstrap.py`
- `tools/repowise/mcp_smoke.py`
- `tools/repowise/mcp_stdio.py`
- `tools/repowise/r3_assert.py`
- `tools/repowise/r3_probe.py`
- `tools/repowise/r6_validate.py`
- `tools/repowise/requirements.txt`

No Node dependency or npm script changed. No Opera Agent runtime file, Supabase
function/migration, browser capability, public MCP tool, protocol version,
OAuth/signing/pairing path, production state, or release artifact changed.

Temporary R3/R4/R6 CircleCI instrumentation was removed before closeout. The
canonical `.circleci/config.yml` is back to the normal test/check/Chromium
pipeline.

## Checkpoint summary

### R1 — compatibility research

**PASS**

Repowise 0.51.0 was verified as compatible with the repository's JS/TS-heavy
shape, local index-only usage, Git-history analysis, and stdio MCP operation.
Privacy constraints were frozen before installation.

### R2 — isolated pinned local setup

**PASS**

Pinned install:

`repowise==0.51.0`

The repo-local `.repowise-venv/` and local `.repowise/` state are ignored.
No Node dependency was added.

### R3 — initial index and evidence

**PASS**

Full-history evidence head:

`3a83bbed0177a67ce882237965bc6d3706335b4c`

Accepted evidence included:

- 312 Git-tracked files;
- 301 graph-indexed file nodes;
- 1,429 symbols;
- 74 deterministic/index-only pages;
- 0 parse errors;
- 348/348 Git commits covered;
- 7/7 checkpoint-critical files graph-indexed;
- no index/cache/provider secret committed or uploaded.

The CircleCI blobless partial-clone issue was diagnosed and the final evidence
hydrated the full Git object set before indexing.

### R4 — local offline MCP integration

**PASS**

Offline evidence head:

`abaf20e28fb93fe2488be4ce9f9cbe0721225992`

The committed launcher is stdio-only, single-repo, provider/embedder `mock`,
telemetry/editor/key persistence disabled, advisory release polling disabled,
and DNS/TCP/UDP egress blocked while preserving local IPC.

The MCP surface is frozen to ten tools:

- `get_overview`
- `get_context`
- `get_symbol`
- `search_codebase`
- `get_risk`
- `get_change_risk`
- `get_why`
- `get_dead_code`
- `get_health`
- `get_dependency_path`

No public HTTP/SSE endpoint or ChatGPT tunnel was created.

### R5 — AI codebase-context operating guide

**PASS**

Documentation head:

`e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`

`docs/AI_CODEBASE_CONTEXT.md` defines setup, indexing, refresh, query workflow,
MCP usage, freshness/privacy boundaries, source-of-truth precedence, and fallback
to exact source/grep.

### R6 — validation against normal repository exploration

**PASS with documented limitations**

Evidence head:

`7fae3a095e7096cec6945b7c4ea274764881b609`

Closeout head:

`6c1f06a2e7d11c62dc8ebfb0a0a13cb31e28140d`

CI evidence:

- CircleCI #147 Repowise validation: SUCCESS.
- CircleCI #148 normal regression: SUCCESS.
- CircleCI #149 exact R6 closeout regression: SUCCESS.
- Vercel: SUCCESS.

Five frozen questions validated dependency paths, change impact, durable-state
authority, the P6 P3/P4 limitation, and public MCP inventory.

Repowise emitted zero nonexistent paths in ten MCP calls. The benchmark also
proved an important boundary: exact literal inventory such as
`server.registerTool` remains a grep-first task.

Detailed record: `docs/repowise-r6-validation.md`.

## Accepted operating model

Use Repowise to reduce broad exploratory reads when the question is structural,
impact-oriented, history-oriented, or risk-oriented:

`Repowise orientation -> exact source verification -> tests/CI evidence`

Do not use:

`Repowise output -> assumed truth`

Repository authority remains:

1. `AGENTS.md` / `SECURITY.md`;
2. applicable roadmap/checkpoint/acceptance records;
3. current source and Git state;
4. exact CI/runtime/production evidence;
5. Repowise-derived context.

Use repository grep/search directly for exhaustive literal inventory, rename
sweeps, or exact bytes.

## Privacy and security state

Final integration retains all frozen privacy boundaries:

- no provider key required for accepted operation;
- mock embedder;
- no source upload;
- no Repowise index/database/cache committed;
- no public MCP exposure;
- no automatic user/editor configuration overwrite;
- no production Supabase mutation;
- no OAuth/signing/pairing change;
- no arbitrary shell/SQL/browser escape hatch.

## R7 final gate

R7 is documentation/verification-only. It introduces no runtime behavior.

The final R7 closeout commit must pass the repository's canonical CircleCI job,
which runs:

- `npm test`;
- `npm run check`;
- Chromium extension regression.

Vercel must also be SUCCESS.

Pending required CI means R7 remains pending. Only exact-head SUCCESS closes the
Repowise integration track.

After R7 closes, the Repowise track has no automatic next checkpoint. Any future
Repowise expansion—remote/public MCP, external provider, cloud upload,
machine-wide/editor auto-configuration, or runtime coupling—requires a new
explicitly scoped review rather than silently extending this track.

The unresolved product boundary remains unchanged: P6 is still a FINAL CANDIDATE
with its independent audit pending, and Milestone 8E remains paused/not started.
