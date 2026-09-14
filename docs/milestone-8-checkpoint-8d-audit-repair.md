# Checkpoint 8D: follow-up ownership audit repair

Date: 2026-09-14. Status: local repair tested; independent review pending.
8D remains IN PROGRESS. 8E has not started.

## Scope and baseline

Repair the remaining local lease race, server release clean-state gap, and
recovery bundle-verification gap in candidate `fcbec8943117ac4a2f1be1de2b9fe0bfd7239ac0`.
Preserve the separately committed reliability diagnostics in parent `c6548c8`.
No production mutation, OAuth, deployment, browser interaction, extension change,
public MCP change, signing, pairing, or feature promotion was performed.

## Test-first evidence and fixes

Before implementation, regression tests failed for an unfinished active lock,
parallel acquisition/reclaim, an unexpected remote bundle during recovery, and
native PostgreSQL release after a late owned-row insertion.

1. Publish a complete nonempty staged lease directory with atomic rename. An
   existing lock without lease metadata is BUSY, never permission to delete it.
   Release/reclaim atomically retires the directory to a permanent nonempty
   per-claim witness, preventing stale contenders from replacing a successor.
   Internal lease format 2 adds a random claim identity; valid format 1 leases and
   manifest format 1 remain readable. This is not a product version change.
2. Inside the server release's exclusive control-row lock, require zero owned
   rows in all 11 candidate tables and private goal_heads before clearing owner.
   A late admitted writer makes release fail with
   `SERVER_FENCE_OWNED_ROWS_REMAIN`; ownership remains intact. Old epoch operations
   after successful release fail with `SERVER_FENCE_LOST`.
3. Recovery descriptor verification now reads actual Management API function
   metadata and checks the fixed slug, ACTIVE state, JWT requirement and bundle
   pin before server control mutations. The all-zero fenced bundle pin remains
   deliberately unchanged: production cannot pass live preflight yet.

The edited fence migration is still an undeployed review-only candidate.

## Verification

- Full default Node suite: 314/314 PASS, zero skips.
- Focused ownership/controller/backend/fence tests: 46/46 PASS.
- Windows two-contender stress: 150/150 single owners, zero dual owners;
  losing contenders returned BUSY rather than filesystem-race errors.
- Native PostgreSQL release regression: each of the 12 owned tables rejects
  release with residual rows. A concurrent admitted insert holds the shared
  fence lock; release waits and then rejects the newly committed row.
  This release test uses the exact candidate migration on a minimal related
  schema, not a claim of full production DDL or live cloud acceptance.
- Combined native journal and release gates: 29/29 PASS, zero skips.
- `npm run check`: PASS, extension 1.6.0 and 26 capabilities.
- No fresh GitHub CI, Chromium regression, or live production acceptance is
  claimed by this local record. Earlier candidate CI remains historical evidence.

Native gates require `OPERA_PG_BIN` and run with
`node --test tests/postgres/*.test.mjs`. An initial invocation used the wrong
environment variable for the older journal test; it was corrected and rerun.
Both ephemeral PostgreSQL clusters are stopped by their test finalizers.

## Retention and recovery limitations

Retired lease witnesses contain only nonsecret operator metadata and intentionally
remain on disk. Do not garbage-collect them while an old process or pending I/O
could still resume. Interrupted staging directories are not active ownership.
An unknown/unfinished legacy active lock remains fail-closed and requires inspected
recovery; it is not automatically removed. This is an acceptance operator, not a
long-running general lock service. Process-crash coverage does not assert
power-loss durability.

## Next boundary

Independent review must inspect the exact committed candidate and rerun the
parallel acquisition/reclaim, real PostgreSQL release, and recovery-integrity
gates. Only an accepted independent review permits the separately bounded
installation/deployment/hash-pin and cloud acceptance work. Do not start 8E or
label 8D accepted from this implementation's own passing tests.
