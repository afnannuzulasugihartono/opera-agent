# Opera Agent next-session handoff

Last synchronized: 2026-09-18.

Checkpoint 8D remains closed. Performance Track P0–P5 is accepted. P6 is a
**FINAL CANDIDATE**, not yet accepted: implementation/regression evidence is green,
the documentation closeout still needs exact-head CI, and the required independent
audit remains pending. Milestone 8E is paused/not started.

## Authoritative boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Accepted P5 / canonical P6 base:
  `a215dd0ddb4d7be9b0c0276862ced3ea26439c77`
- Candidate branch:
  `feat/performance-runtime-cutover-p6-4571636311958769504`
- Pre-docs P6 evidence head:
  `49731c49e75df058dcd48218e680a8ad9aaf7195`
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
