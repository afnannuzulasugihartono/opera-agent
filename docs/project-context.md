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
- R3 initial indexing has **NOT STARTED**.

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
