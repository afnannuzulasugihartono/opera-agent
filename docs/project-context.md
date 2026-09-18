# Opera Agent project context

Last synchronized: 2026-09-18

Repository/CI/production evidence outranks chat summaries. Follow `AGENTS.md`,
`SECURITY.md`, accepted checkpoint records, and the selected execution plan.

## Current boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Accepted P5 / canonical P6 base: `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- P6 candidate branch: `feat/performance-runtime-cutover-p6-4571636311958769504`
- P6 exact final-candidate head:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- P6 exact-head CI: CircleCI #117 + Vercel **SUCCESS**
- P6 independent audit: **PENDING**
- Repowise integration branch: `chore/repowise-integration`
- Repowise R1 compatibility: **PASS**
- Repowise R2 repo setup head:
  `706001747aefb9b629d4e301a30d814f5e9754e3`
- Repowise R2 CI: CircleCI #119 + Vercel **SUCCESS**
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Extension ID: `ohbbpamcljckmjhcpkcmefdobkoeaick`
- Signed rollback: `1.5.2`
- Milestone 8: 8A–8D **ACCEPTED**; 8E paused/not started
- Durable 8D closeout: `696f8eb9730f4a8bf0c1bc309d0d56077ebec8ab`
- Performance Track: P0–P5 **ACCEPTED**; P6 **FINAL CANDIDATE**
- P6 production promotion/deploy: **NOT DONE**

Canonical plan: `docs/delta-first-performance-plan.md`.
P6 record: `docs/delta-first-performance-p6.md`.

## P6 candidate — durable runtime cutover, maximal safe subset

1. **Durable consuming path**
   - `supabase/functions/opera-agent-vm/index.ts` invokes
     `reconcileVmEffectObservation7E` after successful `opera_await`.
   - DB-backed 7E lease/checkpoint/effect-reservation/idempotency remains
     authoritative; the in-memory P4 host does not replace durable state.

2. **Cold-start / continuity safety**
   - missing P1/P2/P3 continuity fails closed to `RESET_REQUIRED` and
     `FULL_SNAPSHOT`; stale continuation is not permitted.

3. **Dependency authority boundary**
   - caller-asserted `taskDependencies` are rejected.
   - live task context therefore remains `MISSING` until a trustworthy
     server-authoritative dependency source exists.
   - ordinary live relevance updates conservatively yield `REASON_REQUIRED`;
     **full integrated P3/P4 speedup is not yet enabled by this safe subset**.

4. **Continuation allowlist**
   - if `performanceCutover` metadata is present, only a valid accepted
     `APPLY_AND_CONTINUE` with `reasoningWakeRequired=false`,
     `reasoningObservation=null`, and `contextStatus=ACCEPTED` may continue.
   - reset-required -> `SUSPENDED / STALE_TARGET`.
   - REASON_REQUIRED, IGNORE_FOR_TASK, unknown/missing decision, malformed or
     inconsistent flags/context -> `SUSPENDED / NEEDS_MODEL`.
   - effect results without P6 metadata retain pre-P6 compatibility.

5. **Preserved surface**
   - full page text/snapshot recovery retained;
   - `opera_enqueue` / `opera_await` and required browser primitives retained;
   - Protocol 1, 26 browser capabilities, 18 public MCP tools retained;
   - no production deploy, DB migration, OAuth/signing/pairing change, public schema
     expansion, transaction authority, or 8E implementation.

## Exact implementation/regression evidence

- tests-first `b8cd79f27f135923a63657beced8563ed7e7a0c7`:
  CircleCI #114 FAILURE as expected.
- implementation `5652435e26f534126bfcee7c48df9ffd597fc52e`:
  new P6 allowlist/fail-closed tests PASS; CircleCI #115 exposed only stale historical
  P3/P4/P5 byte locks for intentionally changed `lib/reactive-vm.js`.
- authorized lock rebaseline
  `49731c49e75df058dcd48218e680a8ad9aaf7195`:
  CircleCI #116 + Vercel SUCCESS.
- #116 `npm test`: **416/416 PASS**, 0 fail, 0 skipped.
- #116 `npm run check`: PASS; 26 allowlisted primitives, version 1.6.0.
- #116 Chromium extension regression: PASS.

The exact P6 final-candidate head is
`96ef1cfdbecc7c5c0e40486b6378501db606b84d`; CircleCI #117 and Vercel are
SUCCESS. The required independent audit remains pending.


## Repowise integration track

Scope is limited to local/private codebase intelligence and supporting
documentation/utility. It does not change Opera Agent runtime behavior, production
Supabase, OAuth/signing/pairing, protocol, browser capabilities, or public MCP tools.

- R1 compatibility research passed for Repowise 0.51.0.
- R2 created an isolated local Python setup on
  `chore/repowise-integration` at
  `706001747aefb9b629d4e301a30d814f5e9754e3`.
- Added `tools/repowise/requirements.txt` pinned to `repowise==0.51.0` and
  `tools/repowise/bootstrap.py`, which creates `.repowise-venv/`, disables
  Repowise telemetry during bootstrap, installs the pinned version, and verifies
  the installed version.
- `.repowise/` and `.repowise-venv/` are gitignored and must remain local.
- CircleCI #119 + Vercel are SUCCESS for the R2 setup head.
- This ChatGPT sandbox has Python 3.13.5, Git 2.47.3, pip 25.1.1, and uv 0.10.0,
  but DNS/network egress to GitHub/PyPI is unavailable. The Repowise wheel could
  therefore not be installed or indexed in this sandbox.
- No Repowise index/database/cache has been committed or uploaded.
- R3 initial indexing is **PASS**. Full-history evidence head:
  `3a83bbed0177a67ce882237965bc6d3706335b4c`; CircleCI #134, normal
  regression #133, and Vercel are SUCCESS.
- R4 local MCP integration is **PASS**. Offline evidence head:
  `abaf20e28fb93fe2488be4ce9f9cbe0721225992`; CircleCI #141, normal
  regression #140, and Vercel are SUCCESS.


## Repowise R3 initial-index status

R3 is **PASS**.

Exact full-history evidence head:
`3a83bbed0177a67ce882237965bc6d3706335b4c`.

Verified evidence:

- Repowise version: `0.51.0`.
- CircleCI #134 `repowise_r3_full`: **SUCCESS**.
- CircleCI #133 normal regression: **SUCCESS**.
- Vercel: **SUCCESS**.
- Initial-index elapsed time: **34.984 seconds**.
- Local Repowise index size: **18,730,491 bytes** (~**17.86 MiB**).
- Git-tracked files at the evidence head: **312**.
- Repowise graph-indexed file nodes: **301**.
- Symbols indexed: **1,429**.
- Generated deterministic/index-only wiki pages: **74**.
- Parse errors: **0**; parse-error file list is empty.
- Git-history indexing: **available**, covering **348/348 commits** with
  **121** persisted `git_metadata` rows.
- Indexed head exactly matches the evidence SHA above.
- Working tree was clean before and after indexing with no unexpected project-file
  side effects.
- All seven required R3 files were graph-indexed with no parse error:
  - `lib/reactive-vm.js`
  - `lib/reactive-vm-host-7e.js`
  - `lib/multi-signal-relevance-p3.js`
  - `supabase/functions/opera-agent-vm/index.ts`
  - `tests/performance-runtime-cutover-p6.test.mjs`
  - `AGENTS.md`
  - `docs/delta-first-performance-plan.md`

Privacy/isolation remained intact: telemetry disabled, no LLM/provider key exposed,
provider keys removed from the child environment, prose generation disabled,
editor setup disabled, key persistence disabled, and the mock embedder used.
No `.repowise/` database/cache/index was committed or uploaded.

Diagnostic history worth preserving:

- The first successful structural index at `48f5943...` exposed a CircleCI
  blobless partial clone (`remote.origin.promisor=true`, filter `blob:none`).
  Repowise correctly skipped Git history in that environment, yielding zero
  `git_metadata` rows.
- The R3 validator initially also required every important file to have a generated
  wiki page. That was too strict for Markdown/test files in deterministic/index-only
  mode; the correct R3 requirement is graph-indexed + no parse error.
- The final R3 job hydrated the checkout to a complete Git object set, removed
  partial-clone/promisor config, verified no missing objects, then required both
  complete Git-history coverage and the seven-file graph checks before PASS.
- CircleCI #131 failed only because of a shell quoting defect in the temporary
  full-history guard after object hydration had succeeded; the quoting defect was
  corrected at `3a83bbe...`.

Temporary R3-specific CircleCI jobs are removed at closeout; normal CI remains the
canonical pipeline. `tools/repowise/r3_probe.py` and
`tools/repowise/r3_assert.py` remain bounded local/CI diagnostic utilities.

## Repowise R4 local MCP status

R4 is **PASS**.

Exact offline evidence head:
`abaf20e28fb93fe2488be4ce9f9cbe0721225992`.

Implementation/evidence chain:

- tests-first `9f7ee9dcfee2ec79e85999940559ff30e244aeb5`:
  - CircleCI #136 `repowise_r4_mcp`: expected **FAILURE** because the launcher
    did not yet exist;
  - CircleCI #137 normal regression: **SUCCESS**;
  - Vercel: **SUCCESS**.
- initial implementation `555044f68513096a6705b77e32ce1deba0018954`:
  - CircleCI #139 MCP acceptance: **SUCCESS**;
  - CircleCI #138 normal regression: **SUCCESS**;
  - Vercel: **SUCCESS**;
  - the acceptance log exposed one outbound PyPI release-version GET at MCP
    startup. It did not upload source or use a provider, but it violated the R4
    offline boundary and was not accepted as final.
- offline hardening `abaf20e28fb93fe2488be4ce9f9cbe0721225992`:
  - CircleCI #141 MCP acceptance: **SUCCESS**;
  - CircleCI #140 normal regression including Chromium extension regression:
    **SUCCESS**;
  - Vercel: **SUCCESS**;
  - the final MCP smoke output contains no PyPI/HTTP request and reports:
    `transport=stdio`, `tool_count=10`, and `overview_call=ok`.

Committed R4 integration:

- `tools/repowise/mcp_stdio.py` — cross-platform repo-local launcher.
- `tools/repowise/mcp_smoke.py` — MCP initialize/list-tools/call acceptance test.
- `tools/repowise/MCP_CONFIG_TEMPLATES.md` — manual client templates; no user or
  editor config is overwritten.

The launcher uses only MCP **stdio** and does not bind an HTTP/SSE/public port.
It forces single-repository mode and exposes exactly these ten local tools:

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

The R4 runtime is deliberately provider-free/offline:

- provider and embedder are forced to `mock`;
- common provider-key environment variables are blanked for the child runtime;
- the launcher calls Repowise MCP directly rather than the CLI path that loads
  project-local `.repowise/.env`;
- Repowise's advisory PyPI release poll is replaced by an offline local result;
- DNS plus TCP/UDP socket egress is denied for the MCP process, while local
  `AF_UNIX` IPC is preserved;
- telemetry, editor setup, and key persistence remain disabled.

Manual templates cover Claude/generic `mcpServers` clients, Codex TOML, and the
Repowise-compatible generic shape for Gemini CLI. R4 does not write those configs.
ChatGPT is not given a public endpoint or local-stdio bridge; any secure tunnel or
remote-MCP bridge would change the connectivity boundary and remains outside R4.

No Opera Agent runtime behavior, production Supabase state, OAuth/signing/pairing,
Protocol 1, 26 browser capabilities, or 18 public Opera Agent MCP tools changed.
No Repowise database/index/cache was committed or uploaded.

Temporary R4-specific CircleCI jobs are removed at closeout; normal CI remains the
canonical pipeline.

Exact next Repowise checkpoint, only when explicitly resumed: **R5 documentation
entry (`docs/AI_CODEBASE_CONTEXT.md`)**. Do not start R5 implicitly.

## Governance / next boundary

- one active writer;
- tests before runtime behavior;
- pending required CI = STOP;
- 8E remains paused;
- after exact-head docs CI is green, perform a fresh independent audit over
  accepted P5 -> exact P6 candidate.
- current `AGENTS.md` explicitly names **Codex** as the required independent
  milestone auditor. A different reviewer is supplemental unless the user explicitly
  accepts a documented governance deviation/residual risk.
- do not merge/promote P6 or start 8E before this boundary is resolved.

## Rollback / preserved state

- accepted P5 `a215dd0ddb4d7be9b0c0276862ced3ea26439c77` remains the clean candidate
  rollback baseline until P6 is accepted.
- signed rollback 1.5.2 remains available.
- two accidental untracked 8E files were previously preserved in the git stash
  named **"preserve accidental 8E files before completing checkpoint 8D"**.
  Do not pop/apply/delete/build from that stash automatically; inspect only against
  canonical 8E scope if 8E later resumes.

## Permanent invariants

- repository/CI/production evidence outranks chat;
- background-first browser operation; no silent foreground takeover;
- no arbitrary JavaScript/raw CDP/SQL/shell/generated-code escape hatch;
- preserve signing identity/pairing and immediate signed rollback;
- never commit/print credentials or sensitive page values;
- action success is not completion proof;
- performance gains never justify stale-state action, false completion, missed
  relevant changes, or foreground takeover.
