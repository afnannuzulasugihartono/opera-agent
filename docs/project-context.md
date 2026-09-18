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
- P6 exact candidate CI: CircleCI #118 + Vercel **SUCCESS**
- P6 independent audit: **PASS / CLOSED WITH USER-ACCEPTED REVIEWER DEVIATION**
- PR #46: **MERGED** at `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`
- P6 merge CI: CircleCI #169 + Vercel **SUCCESS**
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
- Performance Track: P0–P6 **ACCEPTED / CLOSED**
- P6 production promotion/deploy: **DONE / VERIFIED**
- Production `opera-agent-vm`: version **27**, `ACTIVE`, `verify_jwt=true`
- Production deployment bundle SHA-256:
  `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`
- Production source verification: all 14 deployed source/import files match merge
  commit `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac` byte-for-byte
- Safety state after promotion: `milestone7_vm_enabled=false`; VM run/effect/rate
  tables remain 0/0/0

Canonical plan: `docs/delta-first-performance-plan.md`.
P6 record: `docs/delta-first-performance-p6.md`.

## P6 accepted — durable runtime cutover, maximal safe subset

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

The exact audited P6 candidate head is
`96ef1cfdbecc7c5c0e40486b6378501db606b84d`; CircleCI #118 and Vercel are
SUCCESS. The independent audit is PASS/CLOSED with the documented user-accepted
Jules reviewer deviation. PR #46 was explicitly merged as
`6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`; CircleCI #169 and Vercel are
SUCCESS on that merge commit. Production promotion is complete: `opera-agent-vm`
version 27 is ACTIVE with `verify_jwt=true`, deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`,
and all 14 deployed files match the merge commit byte-for-byte. The VM feature flag
remains false and VM tables remain empty.


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
- R5 AI codebase-context documentation is **PASS**. Documentation head:
  `e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`; CircleCI #143 and
  Vercel are SUCCESS.
- R6 validation evidence is **PASS with documented limitations** at
  `7fae3a095e7096cec6945b7c4ea274764881b609`; CircleCI #147 validation,
  #148 normal regression, and Vercel are SUCCESS.
- R6 exact closeout head
  `6c1f06a2e7d11c62dc8ebfb0a0a13cb31e28140d`: CircleCI #149 + Vercel
  SUCCESS.
- R7 final Repowise closeout is **PASS / CLOSED**. Final-candidate head
  `0338f83c198ff38d0bbc4e864692c01c9a34d327`: CircleCI #150 + Vercel
  SUCCESS; canonical test/check/Chromium regression passed.


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

## Repowise R5 AI codebase-context documentation

R5 is **PASS**.

Exact documentation head:
`e9d6dc8659ac1d7c02bf753a6a2d46bfdae70887`.

Evidence:

- `docs/AI_CODEBASE_CONTEXT.md` added as the durable operational entry point for
  AI-assisted codebase context.
- CircleCI #143: **SUCCESS**.
- Vercel: **SUCCESS**.
- no Opera Agent runtime, production Supabase, OAuth/signing/pairing, Protocol 1,
  browser capability, or public MCP surface changed.

The document records:

- Repowise 0.51.0 bootstrap and isolated local install;
- privacy-hardened initial/rebuild indexing;
- `repowise status` freshness checks;
- provider-free incremental refresh with
  `repowise update . --index-only --no-workspace`;
- CLI query examples for context/search/symbol/why/risk;
- the R4 local stdio MCP launcher and exact ten-tool allowlist;
- the repository/source-of-truth hierarchy;
- stale-index, static-analysis, partial-clone, mock-embedder, and
  provider-free/index-only limitations;
- an explicit rule that Repowise is a derived context layer, not runtime,
  governance, CI, release, or architectural authority.

No npm script was added in R5 because the committed cross-platform Python tooling
already provides the required entry points without adding shell portability
assumptions to `package.json`.

## Repowise R6 validation

R6 validation evidence is **PASS with documented limitations**.

Exact evidence head:
`7fae3a095e7096cec6945b7c4ea274764881b609`.

Evidence:

- CircleCI #147 `repowise_r6_validation`: SUCCESS.
- CircleCI #148 normal test/check/Chromium regression: SUCCESS.
- Vercel: SUCCESS.
- ten Repowise MCP calls across the five frozen A-E questions;
- zero nonexistent path mentions;
- five baseline `git grep` calls produced 84 candidate-file hits in aggregate
  and 51 unique candidate files;
- Repowise surfaced 47 paths in aggregate.

Question findings:

- A: exact two-branch runtime structure recovered:
  `index.ts -> reactive-vm-7d.js -> reactive-vm.js` and
  `index.ts -> reactive-vm-host-7e.js -> multi-signal-relevance-p3.js`.
- B: `advanceReactiveVm` callers/dependents and relevant P6/reactive tests were
  surfaced correctly; risk data reported five direct dependents and ten
  transitive affected paths.
- C: durable-state discovery correctly led to the DB-backed reactive-host
  migration/RPCs and the Edge VM host; in-memory P4 is not authoritative.
- D: Repowise correctly surfaced the unauthoritative-`taskDependencies` history
  and P3/P4 gate context, but `get_why` had no decision record and reported no
  file-specific history for the performance plan. The plan/source remains
  authoritative.
- E: target file `supabase/functions/opera-agent-mcp/index.ts` and
  `createServer()` were identified, but exact literal `server.registerTool`
  inventory is better served by grep; Repowise explicitly warned its result was
  fuzzy.

The first R6 job #146 failed only because the CircleCI image lacked `rg`; all
ten MCP calls had already completed. The baseline was switched to repository-native
`git grep` and #147 passed. This is a harness portability fix, not a Repowise
behavior fix.

Detailed record: `docs/repowise-r6-validation.md`.
Reproducible harness: `tools/repowise/r6_validate.py`.
Temporary R6 CircleCI instrumentation is removed at closeout.

R6 establishes a hybrid policy: use Repowise for orientation/structure/impact/
history, then verify consequential claims against exact source and CI. Prefer
normal repository grep for exhaustive literal inventory.

The Repowise integration track is closed after R7. No later Repowise checkpoint
or scope expansion is authorized implicitly. Any remote/public MCP, external
provider, cloud upload, editor auto-configuration, or runtime coupling requires a
new explicitly scoped review.

## Pre-8E Performance Usability Repair — R0–R2 accepted

On 2026-09-18 the user approved inserting a findings-driven repair track before
Milestone 8E after a live production-path YouTube test.

Canonical plan:
`docs/pre-8e-performance-usability-repair-plan.md`.

Spec Kit feature:
`specs/001-pre-8e-performance-usability-repair/`.

Status: **R0–R2 ACCEPTED / CLOSED; R3 AUTHORIZED / IN PROGRESS; R4 NOT AUTHORIZED**.

Frozen findings include:
- on-screen ad `Skip` competing with offscreen `Skip navigation`;
- the correct dynamic Skip ref becoming stale before click;
- Home/watch `page.read` model-facing results becoming very large despite only
  ~686/~3,331 text characters and ~119/~139 observed entities;
- `media.state` working in ~514ms while media primitives remain internal;
- YouTube Home navigation ~5.224s with only ~131ms queue;
- `youtube.get_transcript v4` ~20.514s total.

The repair sequence is R0 benchmark lock -> R1 actionability -> R2 fresh target
revalidation -> R3 local act+verify -> R4 compact observation -> R5 internal media
fast path -> R6 navigation/residual transport -> R7 workflow cleanup -> R8 full
real-Opera acceptance.

R1 changed only generic observation/actionability behavior in `extension/content.js` plus tests/docs: viewport truth and actionability are exposed, actionable controls are ranked before bounded truncation, and equal-rank ordering remains stable.

R2 adds bounded action-time fresh-target revalidation in `extension/content.js`: a stale ref may rebind only to one same-document/same-route equivalent current target that matches frozen descriptor identity/metadata and is actionable/non-sensitive. Ambiguity, route reset, sensitivity change, weak evidence, or disappearance fail closed. Caller-provided observational `logicalId`/coordinates are not action authority. No production deployment/schema mutation, VM enablement, public MCP expansion, transaction authority, or 8E work was performed.

## Governance / next boundary

- one active writer;
- tests before runtime behavior;
- pending required CI = STOP;
- the P6 independent audit gate is **PASS / CLOSED WITH USER-ACCEPTED REVIEWER
  DEVIATION**;
- exact audited range:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77..96ef1cfdbecc7c5c0e40486b6378501db606b84d`;
- Jules returned **PASS** as the independent read-only reviewer because Codex
  quota was exhausted; the user explicitly authorized continuation after the
  reviewer-deviation/residual-risk condition was disclosed;
- exact P6 candidate repository evidence is CircleCI **#118 SUCCESS** + Vercel
  **SUCCESS**. The Jules report's #116 reference is historical and not the
  final-candidate CI identifier;
- durable audit record: `docs/p6-independent-audit-closeout.md`;
- PR #46 is merged at `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`;
  CircleCI #169 + Vercel are SUCCESS on the merge commit;
- production promotion is complete and verified at `opera-agent-vm` version 27;
- P6 is **ACCEPTED / CLOSED**;
- Pre-8E repair R0 is **ACCEPTED / CLOSED** with durable evidence in `docs/pre-8e-performance-usability-r0.md`;
- R1 implementation evidence head `b0ff03cd0f3ecbf4498b8392760d9492fb44ff77` has CircleCI #219 + Vercel SUCCESS; durable evidence: `docs/pre-8e-performance-usability-r1.md`;
- R1 is **ACCEPTED / CLOSED** after actionability-first observation, bounded-ranking acceptance, historical hash-lock rebaseline, and controlled Chromium regression;
- R2 implementation evidence head `70c79db6d76ab624d19bd5d6067a1469ef522045` has CircleCI #226 + Vercel SUCCESS; durable evidence: `docs/pre-8e-performance-usability-r2.md`;
- R2 is **ACCEPTED / CLOSED** after unique same-document recovery, unsafe-case fail-closed coverage, authorized content hash-lock rebaseline, and controlled Chromium regression;
- the user explicitly authorized **R3 only**; exact active work is T017–T020 on `feat/pre-8e-usability-repair-r3`; R4 remains unauthorized;
- 8E remains paused/not started and cannot begin until the repair track reaches R8
  acceptance and the user separately authorizes 8E.

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


## Spec Kit governance adoption

A bounded Spec Kit governance adoption is active on
`chore/spec-kit-governance`, based on Repowise closeout
`3620716e27cae595167216fd7ac011ce9a4871d3`.

- pinned Spec Kit: `specify-cli==1.0.8`;
- official v1.0.8 Codex skills + PowerShell shared scaffold are repository-persistent;
- constitution projects existing `AGENTS.md`/`SECURITY.md` rules rather than replacing them;
- optional/community extensions and runtime events are disabled/not adopted;
- regression coverage: `tests/spec-kit-governance.test.mjs`;
- acceptance evidence head: `f8e860df9803805704ac70c894800b47b6bf3dc4`;
- CircleCI #163: **SUCCESS**;
- Vercel: **SUCCESS**;
- status: **PASS / CLOSED**.

This adoption itself did not satisfy the P6 independent audit. That later audit
gate is now closed separately by `docs/p6-independent-audit-closeout.md` with a
user-accepted reviewer deviation. P6 is **ACCEPTED / CLOSED** after PR #46 merge
and verified production promotion to `opera-agent-vm` version 27. 8E remains
paused/not started until separately instructed. No later Spec Kit scope is
authorized implicitly.
