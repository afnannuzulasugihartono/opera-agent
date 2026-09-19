# Opera Agent next-session handoff

Last synchronized: 2026-09-19.

## Latest repair continuation — read before historical instructions below

Continue the user's explicit R6–R8 request sequentially, not Milestone 8E.
R5 is **ACCEPTED / CLOSED**. Implementation/evidence head
`15270d5875bd9fa9ae350d1a866332895519abbb` has CircleCI #250 + Vercel SUCCESS;
documentation closeout head `50b19ee1f4ea91fd0be866565a1c1733bc8ff87b`
has CircleCI #251 + Vercel SUCCESS. T028/T029 are complete and Protocol 1 / 26
primitives / 18 public MCP tools/input schemas remain unchanged. Exact next:
R6/T030–T033, starting with the required Spec Kit consistency/constitution analysis
and measurement. T033 must STOP for separate review if Realtime wake is still
justified. No production deployment, signed release, Realtime cutover, or 8E
permission was added.
Worktree location is `C:/Users/ASUS/.zcode/workspace/default/opera-agent`.
Use `SPECIFY_FEATURE_DIRECTORY` (not `SPECIFY_FEATURE`) for Spec Kit prerequisites.

Checkpoint 8D remains closed. Performance Track P0–P6 is **ACCEPTED / CLOSED**.
The audited P6 candidate `96ef1cfdbecc7c5c0e40486b6378501db606b84d` has
CircleCI #118 + Vercel SUCCESS. PR #46 merged as
`6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`, with CircleCI #169 + Vercel
SUCCESS. Production promotion is verified at `opera-agent-vm` version 27
(`ACTIVE`, `verify_jwt=true`, deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`).
All 14 deployed source/import files match the merge commit byte-for-byte.
`milestone7_vm_enabled` remains `false`, VM tables remain empty, and Milestone
8E remains paused/not started until separately instructed.

## Authoritative boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Accepted P5 / canonical P6 base:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- Candidate source branch:
  `feat/performance-runtime-cutover-p6-4571636311958769504`
- Exact P6 audited-candidate head:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- Exact audited-candidate CI: CircleCI #118 + Vercel SUCCESS
- Merge target branch: `feat/performance-runtime-cutover-p6`
- PR #46 merge commit:
  `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`
- Merge-commit CI: CircleCI #169 + Vercel SUCCESS
- Stable extension: 1.6.0
- Protocol: 1
- Browser capabilities: 26
- Public MCP tools: 18
- Signed rollback: 1.5.2
- 8E: paused/not started
- P6 production deploy/promotion: **DONE / VERIFIED**
- Production VM host: `opera-agent-vm` version 27, ACTIVE, `verify_jwt=true`
- Production deployment SHA:
  `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`
- Post-promotion safety state: feature flag false; VM tables 0/0/0

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
- The candidate implementation itself introduced no schema migration,
  OAuth/signing/pairing/public-schema expansion, transaction authority, or 8E work.
  A later explicit production-promotion step deployed only the exact P6 VM-host
  source to `opera-agent-vm` version 27; it did not enable the VM feature flag.

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
- R6 validation evidence: **PASS with documented limitations** at
  `7fae3a095e7096cec6945b7c4ea274764881b609`; CircleCI #147 + #148 +
  Vercel SUCCESS.
- R6 closeout head
  `6c1f06a2e7d11c62dc8ebfb0a0a13cb31e28140d`: CircleCI #149 + Vercel
  SUCCESS.
- R7 final closeout: **PASS / CLOSED** at final-candidate
  `0338f83c198ff38d0bbc4e864692c01c9a34d327`; CircleCI #150 + Vercel
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

## Repowise R6 validation gate

R6 validation evidence is **PASS with documented limitations**.

Exact evidence head:
`7fae3a095e7096cec6945b7c4ea274764881b609`.

- #147 Repowise validation: SUCCESS.
- #148 normal regression including Chromium: SUCCESS.
- Vercel: SUCCESS.
- zero nonexistent paths from ten MCP calls.
- A/B/C are strong structural/impact/state cases.
- D is useful for archaeology but decision/history output must be verified against
  the authoritative plan.
- E proves exact literal inventory remains a grep-first task.
- baseline: 5 `git grep` calls, 84 per-question candidate hits, 51 unique files.
- Repowise: 10 MCP calls, 47 per-question surfaced paths.
- first #146 failure was only missing `rg` in the CI image; fixed by using
  `git grep`.

Detailed evidence is in `docs/repowise-r6-validation.md`. The reusable validation
harness remains at `tools/repowise/r6_validate.py`. Temporary R6 CI wiring is
removed.

R7 is closed. The final record is `docs/repowise-integration-closeout.md`.
There is no implicit R8 or automatic Repowise scope expansion after closure.
The P6 independent audit, repository merge, and production-promotion gates are
closed. A planned Pre-8E Performance Usability Repair now precedes 8E. Do not start
8E without R8 acceptance plus a separate explicit instruction.

## Pre-8E repair track inserted

User-approved planning on 2026-09-18 adds
`docs/pre-8e-performance-usability-repair-plan.md` and Spec Kit feature
`specs/001-pre-8e-performance-usability-repair/`.

Status: **R0–R4 ACCEPTED / CLOSED; R4 closeout head CircleCI #245 + Vercel SUCCESS; R5 AUTHORIZED / IN PROGRESS.**

Do not jump to 8E. R0–R3 are ACCEPTED/CLOSED. R3 (T017–T020) closed with durable evidence in `docs/pre-8e-performance-usability-r3.md`: runtime evidence head `285374f20ef1592d16246fe1e53ab4c9d8b8da81`, governance head `5b5ed172770e5b1ce6bc428c84902d48762ce8bf`, and closeout head `3f765cf` have CircleCI SUCCESS + Vercel SUCCESS, local full gates 423/423 PASS + `npm run check` PASS, and every R3 failure chain recorded. On 2026-09-19 the user accepted R3 on the CI basis and granted a standing authorization to proceed sequentially through the repair checkpoints without per-checkpoint manual sign-off, with CircleCI + Vercel SUCCESS on each checkpoint's evidence head as the acceptance criterion and computer-use assistance allowed. Safety rails remain: no production deployment or signed-release promotion without a separate explicit instruction; R6 T033's conditional transport stop stays binding; 8E start stays a separate explicit decision.

A permanent **Evidence-First Bug Repair Loop** lives in `AGENTS.md`, the reusable
ChatGPT Web checkpoint prompt, and the active Spec Kit feature artifacts
(`spec.md`, `plan.md`, `tasks.md`, `research.md`) using the repository's
official Spec Kit template structure. For every unexpected error/bug/CI/browser
regression: capture exact evidence, reproduce/localize, research the root cause
(repository evidence first; primary external docs/upstream sources when relevant),
add or identify a deterministic regression, apply the smallest generic fix, and
rerun focused + required full gates. No blind retries or guess-patching. Three
repetitions of the same failure without new evidence means blocked + diagnostics
and early audit.

## Exact next gate

The P6 independent audit gate is now **PASS / CLOSED WITH USER-ACCEPTED REVIEWER
DEVIATION**.

- audited P5:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- audited exact P6 candidate:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`
- reviewer: Jules, used because Codex quota was exhausted;
- reviewer deviation/residual risk: explicitly accepted by the user after
  disclosure;
- Jules verdict: **PASS**;
- canonical exact-head CI: CircleCI **#118 SUCCESS** + Vercel **SUCCESS**;
- durable record: `docs/p6-independent-audit-closeout.md`.

PR #46 is merged at `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`, and
CircleCI #169 + Vercel are SUCCESS on that merge commit. Production promotion is
verified at `opera-agent-vm` version 27 with
`verify_jwt=true` and deployment SHA
`0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`.
All deployed files match the merge commit, the VM feature flag remains false, and
the VM tables remain empty. P6 is **ACCEPTED / CLOSED**.

**Exact next product action for any coding agent (including Z Code):** verify the current R5 T028 ready-media fixture repair with exact-head CI. T027 implementation head `bafddea8168d0f1933b18c0f394703ba453e0c83` has CircleCI #247 + Vercel SUCCESS. T028 candidate `3384757f3e1249be0ed0fbfd222b601a8b55d12a` failed CircleCI #248 because `focus_audit` was referenced before initialization; repair `0bb99e6d14251b2b9e0e40dcb39c9cd254338297` fixed that but CircleCI #249 exposed a second benchmark defect: target 0.25s returned `currentTime: 0` while the WAV was only `readyState: 1` / HAVE_METADATA. Primary WHATWG media semantics confirm metadata-only is not ready-media and seekability depends on available seekable ranges, commonly enabled for simple files by HTTP Range support. The current repair makes the local WAV byte-range seekable, requires `readyState >= 2`, tightens position verification to 50ms, keeps nine measured `media.seek` commands and p50 <=1s, and still forbids `tabs.navigate`/`tabs.reload`. If exact-head CircleCI + Vercel are green, mark T028 complete and execute T029: re-verify Protocol 1 / 26 primitives / 18 public MCP tools/input schemas, run required full/static/browser gates, write R5 durable evidence/closeout, then STOP for R5 acceptance. Any different failure enters Evidence -> Research -> Regression Proof -> Minimal Repair -> Verification. R6 and Milestone 8E remain not started.

## Preserved rollback / stash warning

- Accepted P5 remains the clean rollback baseline for this candidate.
- Signed rollback 1.5.2 remains available.
- Two accidental untracked 8E files remain preserved in the git stash named
  **"preserve accidental 8E files before completing checkpoint 8D"**.
  Never pop/apply/delete/build from that stash automatically.


## Spec Kit governance adoption gate

Branch: `chore/spec-kit-governance`.

The adoption vendors the official Spec Kit 1.0.8 Codex/PowerShell core, adds a
repository constitution derived from existing governance, and adds a regression
test preventing loss of the P6/8E scope lock.

Acceptance evidence head:
`f8e860df9803805704ac70c894800b47b6bf3dc4`.

- CircleCI #163: **SUCCESS**.
- Vercel: **SUCCESS**.
- Spec Kit governance adoption: **PASS / CLOSED**.

Do not use the Spec Kit tooling change itself to merge/promote P6 or start 8E.
The separate P6 audit gate is now closed by
`docs/p6-independent-audit-closeout.md`. There is no implicit next Spec Kit
checkpoint.
