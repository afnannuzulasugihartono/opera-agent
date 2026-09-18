# Performance Track P6 — Durable Runtime Cutover (Maximal Safe Subset)

Status: **ACCEPTED / CLOSED — audit PASS, PR #46 merged, production promotion verified**

Accepted predecessor: P5 at
`a215dd0ddb4d7be9b0c0276862ced3ea26439c77`.

## Scope

P6 makes the safe portion of Performance Track P part of the durable 7E VM
observation/effect path without replacing DB-backed VM authority or widening the
public browser surface.

It intentionally retains required low-level transport/browser primitives rather
than duplicating an `old-runtime/` implementation for rollback.

## Runtime contract

- `supabase/functions/opera-agent-vm/index.ts` reconciles successful observation
  results through `reconcileVmEffectObservation7E` after `opera_await`.
- durable DB lease/checkpoint/effect-reservation/idempotency remains authoritative;
  P4's in-memory host does not impersonate durable state.
- missing continuity fails closed to RESET_REQUIRED + FULL_SNAPSHOT.
- caller-supplied `taskDependencies` cannot grant relevance authority. The live
  safe subset currently supplies no accepted server dependency context, therefore
  ordinary updates conservatively resolve to REASON_REQUIRED.
- when `performanceCutover` metadata is present, local continuation is allowed
  only for:
  - decision = APPLY_AND_CONTINUE
  - reasoningWakeRequired = false
  - reasoningObservation = null
  - contextStatus = ACCEPTED
- reset-required suspends STALE_TARGET.
- REASON_REQUIRED, IGNORE_FOR_TASK, unknown/missing decision, malformed/inconsistent
  flags/context suspend/fail closed.
- no P6 metadata preserves compatibility with the pre-P6 low-level VM effect path.

Because authoritative dependency plumbing is deliberately absent, **P6 does not yet
enable the full live P3/P4 acceleration path**. P5/P4 performance evidence remains
historical/proxy or controlled evidence as documented; do not reinterpret it as
integrated production P6 speed.

## Tests-first / correction history

1. `b8cd79f27f135923a63657beced8563ed7e7a0c7`
   - added adversarial control-flow tests;
   - CircleCI #114 FAILURE, expected before implementation.
2. `5652435e26f534126bfcee7c48df9ffd597fc52e`
   - implemented explicit P6 continuation allowlist;
   - new P6 tests passed;
   - CircleCI #115 failed because P3/P4/P5 historical byte-lock tests still pinned
     the intentionally changed `lib/reactive-vm.js`.
3. `49731c49e75df058dcd48218e680a8ad9aaf7195`
   - rebaselined only the authorized `reactive-vm.js` historical locks and renamed
     those tests to state P6 supersession explicitly;
   - all other frozen boundary hashes stayed locked;
   - CircleCI #116 + Vercel SUCCESS.

## Exact #116 regression evidence

- `npm test`: **416 tests, 416 PASS, 0 fail, 0 cancelled, 0 skipped, 0 todo**.
- `npm run check`: **PASS**, 26 allowlisted browser primitives, version 1.6.0.
- Chromium extension regression: **PASS**.
- P6-specific assertions prove:
  - valid accepted APPLY_AND_CONTINUE may continue;
  - IGNORE_FOR_TASK cannot continue;
  - unknown/missing/malformed/inconsistent cutover decisions cannot continue;
  - RESET_REQUIRED and REASON_REQUIRED remain fail-closed;
  - caller-forged accepted dependency labels cannot mint continuation authority.

## Preserved boundaries

- 18 public MCP tools.
- Protocol 1.
- 26 browser capabilities.
- full page text and snapshot recovery.
- background-first / no silent foreground takeover.
- low-level `opera_enqueue` / `opera_await`.
- no production schema, OAuth, signing, pairing, extension-distribution,
  consequential transaction authority, or 8E change.

## Audit / merge / production status

- independent audit: **PASS / CLOSED WITH USER-ACCEPTED REVIEWER DEVIATION**;
- exact audited candidate:
  `96ef1cfdbecc7c5c0e40486b6378501db606b84d`;
- exact candidate CI: CircleCI #118 + Vercel SUCCESS;
- PR #46: **MERGED** at
  `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac`;
- merge-commit CI: CircleCI #169 + Vercel SUCCESS;
- production promotion/deploy: **DONE / VERIFIED**;
- production Edge Function: `opera-agent-vm` version 27, `ACTIVE`,
  `verify_jwt=true`;
- production deployment SHA-256:
  `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`;
- source verification: all 14 deployed source/import files match merge commit
  `6cfd7e61ebb0117a90872f17ba8cc82185cfe3ac` byte-for-byte;
- safety state: `milestone7_vm_enabled=false`; `vm_runs=0`,
  `vm_effects=0`, `vm_rate_windows=0`;
- security advisor: baseline retained with no new P6-specific finding;
- temporary PR #47: **CLOSED / NOT MERGED** after GitHub Actions #280 failed
  before runner allocation; CircleCI #172 and Vercel were SUCCESS;
- 8E: paused / not started.

The production promotion used the official Supabase Edge Function deployment path
with the exact merged source tree rather than the historical CI-minified transport
wrapper. The resulting deployed files were re-read and verified byte-for-byte
against the merge commit. No schema, OAuth, signing, pairing, public MCP, protocol,
browser-capability, or extension change was made.

P6 and Performance Track P are **ACCEPTED / CLOSED**. This does not authorize 8E
automatically.
