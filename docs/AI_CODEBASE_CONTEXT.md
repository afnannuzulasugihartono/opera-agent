# AI Codebase Context

This document is the operational entry point for AI-assisted codebase context in
Opera Agent. The current integration uses **Repowise 0.51.0** as a local,
derived intelligence layer over the repository.

Repowise is intended to reduce repeated broad grep/read cycles by exposing
precomputed structure, symbols, dependency relationships, Git-history signals,
risk/health information, and architectural rationale through local CLI/MCP
queries.

## Authority and trust boundary

**Repowise is not a source of truth and is not an Opera Agent runtime or
governance authority.**

When information conflicts, use this order:

1. `AGENTS.md` and `SECURITY.md`;
2. the applicable roadmap/checkpoint/acceptance documents;
3. current repository code and Git state;
4. exact CI, browser, deployment, and production evidence required by the
   checkpoint;
5. Repowise-derived context.

Repowise output is a **lead**. Verify consequential claims against the real
files, Git history, tests, or runtime evidence before changing behavior,
security boundaries, schemas, releases, or milestone state.

The local Repowise graph/index can become stale after source or Git changes.
A stale graph must never override newer repository reality.

## What is installed

The integration is intentionally isolated from the Node runtime:

- `tools/repowise/requirements.txt` pins `repowise==0.51.0`;
- `tools/repowise/bootstrap.py` creates the local `.repowise-venv/`;
- `.repowise/` stores the local index/database/cache;
- both `.repowise/` and `.repowise-venv/` are gitignored;
- `tools/repowise/mcp_stdio.py` launches the R4 privacy-hardened MCP server;
- `tools/repowise/mcp_smoke.py` is the bounded MCP acceptance smoke;
- `tools/repowise/MCP_CONFIG_TEMPLATES.md` contains manual client templates.

No Repowise database, vector store, generated cache, provider key, or private
source upload belongs in Git.

## Bootstrap

From the repository root:

```text
python tools/repowise/bootstrap.py
```

The bootstrap creates the isolated Python environment and verifies the pinned
Repowise version. It does not change Opera Agent's Node dependencies.

## Initial local index / rebuild

The privacy-hardened structural/index-only form used by this integration is:

```text
.repowise-venv/bin/repowise init . --yes --no-prose --no-editor-setup --no-save-key --embedder mock
```

On Windows, use the equivalent executable under
`.repowise-venv\\Scripts\\repowise.exe`.

Important properties:

- no model-written prose;
- no editor or machine-wide MCP registration;
- no provider-key persistence;
- mock embedder;
- local `.repowise/` persistence only.

R3 acceptance additionally proved full Git-history indexing after hydrating a
CircleCI blobless partial clone. A local normal clone should retain its real Git
history; if Repowise reports that history was skipped because the clone is
partial/shallow, fix the Git checkout before treating history/ownership/churn
answers as complete.

## Check index status

```text
.repowise-venv/bin/repowise status .
```

Use status to check whether an index exists and whether it is behind the current
repository state. Treat freshness warnings as a reason to update before relying
on graph/history answers.

## Update after code changes

For routine local refreshes that must remain provider-free:

```text
.repowise-venv/bin/repowise update . --index-only --no-workspace
```

Repowise 0.51.0 defines `--index-only` to re-parse changed files, rebuild the
dependency graph, and refresh Git/dead-code artifacts without LLM page
regeneration.

If the index scope/configuration itself changed materially or incremental state
is suspect, rebuild with the privacy-hardened `init` command above rather than
forcing a questionable incremental result.

## Query from the CLI

Useful provider-free queries include:

```text
.repowise-venv/bin/repowise context lib/reactive-vm.js
.repowise-venv/bin/repowise context lib/reactive-vm.js --include callers --include ownership
.repowise-venv/bin/repowise search "advanceReactiveVm"
.repowise-venv/bin/repowise symbol "lib/reactive-vm.js::advanceReactiveVm"
.repowise-venv/bin/repowise why "reactive vm"
.repowise-venv/bin/repowise risk main..HEAD
```

Prefer targeted Repowise queries when they can answer the structural question,
then open the real source files needed to verify the answer. Do not replace
source inspection with a generated summary when exact behavior matters.

## Query through MCP

Start the committed privacy-hardened launcher indirectly from an MCP client:

```text
python tools/repowise/mcp_stdio.py
```

The process speaks MCP over **stdio only**. It is normally spawned by the client,
not run as an interactive shell service.

R4 freezes the local surface to exactly these ten tools:

1. `get_overview`
2. `get_context`
3. `get_symbol`
4. `search_codebase`
5. `get_risk`
6. `get_change_risk`
7. `get_why`
8. `get_dead_code`
9. `get_health`
10. `get_dependency_path`

The launcher:

- forces single-repository mode;
- uses provider/embedder `mock`;
- does not load project-local provider secrets;
- disables Repowise's advisory PyPI release poll;
- blocks DNS/TCP/UDP egress while preserving local IPC;
- disables Repowise telemetry, editor setup, and key persistence;
- does not expose HTTP/SSE or a public port.

Manual Claude/generic MCP and Codex templates are in
`tools/repowise/MCP_CONFIG_TEMPLATES.md`. That file also documents the generic
shape usable by Gemini CLI-style MCP hosts.

R4 deliberately does **not** overwrite user/editor configuration and does not
create a public or remote ChatGPT MCP bridge.

## Recommended AI workflow

For unfamiliar code, prefer:

```text
overview
  -> targeted search/context
  -> exact symbol/source verification
  -> risk/history/why as needed
  -> repository tests and CI evidence
```

Examples:

- Architecture/orientation: `get_overview`.
- A known file/module: `get_context`.
- An exact function/class: `get_symbol`.
- Locate code without broad grep: `search_codebase`.
- Before editing: `get_risk`.
- Before interpreting a change: `get_change_risk`.
- Historical/architectural rationale: `get_why`.
- Cleanup/refactoring leads: `get_dead_code` and `get_health`.
- Structural connection between two paths: `get_dependency_path`.

Fall back to normal repository search/read whenever Repowise has no answer,
reports stale/ambiguous context, or the task requires exact bytes not represented
by the index.

## Known limitations

- The index is derived and can be stale.
- Graph edges and execution relationships are static/inferred intelligence, not
  proof of every runtime path.
- JavaScript/TypeScript are first-class parsed languages, but framework-specific
  or dynamic behavior can evade static graph inference.
- Markdown/JSON/config files may be indexed without receiving generated wiki
  pages; absence of a wiki page does not by itself mean a file was not indexed.
- The R4 mock embedder intentionally avoids external embedding providers, so
  semantic/vector retrieval quality is more limited than a real embedder.
- Provider-free/index-only operation does not create model-written documentation.
- History/risk/ownership answers depend on available Git history. Partial or
  shallow clones can make that evidence incomplete.
- Repowise decisions/history are contextual evidence, not accepted Opera Agent
  architectural decisions unless the repository's authoritative records say so.
- Repowise does not decide whether a checkpoint is accepted, whether CI is green,
  whether a deployment is production, or whether a security boundary may change.

## Accepted integration evidence

Accepted Repowise checkpoints:

- R1 compatibility/privacy research: PASS.
- R2 isolated pinned setup: PASS.
- R3 full-history initial index: PASS.
- R4 local offline MCP integration: PASS.
- R5 AI codebase-context documentation: PASS.
- R6 validation: PASS with documented limitations.

R3 measured a zero-parse-error structural/full-history index. R4 verified a real
offline stdio MCP initialize/list-tools/get-overview path. R6 validated five
concrete Opera Agent questions and established the hybrid operating model:
Repowise for structural/impact/history orientation, exact repository source and
grep for authoritative verification and exhaustive literal work.

Final integration closeout is recorded in
`docs/repowise-integration-closeout.md`.

See `docs/project-context.md` and `docs/next-session-handoff.md` for exact
checkpoint SHAs and CI evidence.

## What this document does not authorize

This document does not authorize:

- merging or promoting the P6 candidate;
- starting Milestone 8E;
- production Supabase mutations;
- OAuth/signing/pairing changes;
- changes to Protocol 1, the 26 browser capabilities, or the 18 public Opera
  Agent MCP tools;
- public exposure of the local Repowise MCP server;
- treating Repowise output as a replacement for repository/CI evidence.

Those boundaries remain governed by the authoritative repository documents.
