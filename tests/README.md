# Tests

Opera Agent should be tested at several layers:

- unit tests
- protocol validation
- Supabase integration tests
- mock browser pages
- trusted-input tests
- reconnect and restart tests
- timeout and retry tests
- duplicate-command/idempotency tests
- sensitive-field safety tests
- real Chromium regression tests
- real Opera acceptance tests

Known legacy bugs should become regression tests so they do not return in the rebuilt architecture.

## Real Opera focus audit

Checkpoint 2A is implemented in `browser_extension_test.py`. It uses a temporary Opera profile and two tabs, then fails if a background command changes the user's active tab or the focused Opera window.

On Windows:

```powershell
$env:OA_BROWSER_EXECUTABLE='C:\Users\ASUS\AppData\Local\Programs\Opera\opera.exe'
$env:OA_BROWSER_HEADLESS='0'
py -3 tests\browser_extension_test.py
```

The JSON result must contain `backgroundFocusPreserved: true`. The tested command matrix and explicit foreground-only exceptions are documented in `docs/background-execution.md`.

Set `OA_LIVE_SITE_TESTS=1` to include the opt-in Google Maps matrix. Live-site coverage is intentionally separate from deterministic local fixtures because network/UI changes can fail independently of the extension regression suite. Opera may block unpacked-extension scripting on Google domains through `ExtensionsSettings`; run that case with isolated Chromium and reserve the signed installed-Opera check for production acceptance.

## Goal-ledger contract gate

Checkpoint 6A is locked by `goal-ledger-contract.test.mjs` and three versioned
fixtures: contract, hostile replay corpus, and thresholds. These tests define
canonical serialization, bounded schemas, state-minimized persistence, false-
completion cases, authority and tenant isolation, stale/forked revisions, and the
accepted 1.6.0 public-surface baseline. They intentionally do not implement or
deploy the ledger runtime.

Checkpoint 6B is implemented by the environment-neutral `lib/goal-ledger.js` and
`goal-ledger.test.mjs`. It covers immutable creation, validation, canonical
digests, revisions, stale/fork rejection, explicit authority broadening,
cancel/expire, metadata-only inspection, strict bounds, secret-like fields, and a
10,000-step lineage sequence. Run `npm run benchmark:ledger` for its non-persisted
three-run performance baseline.

Checkpoint 6C is implemented by the environment-neutral `lib/proof-engine.js`,
`proof-engine.test.mjs`, and `fixtures/proof-replay-v1.json`. Coverage includes
typed evidence and trust, canonical digests, freshness, tenant/lineage/revision/
scope isolation, dependencies, duplicate-boundary resistance, contradiction
blocking, process-versus-outcome separation, closed-world exhaustiveness, bounded
receipts, and zero false `PROVED` across the adversarial corpus. Run
`npm run benchmark:proof` for the non-persisted 500-evidence performance gate.

Checkpoint 6D is implemented by `lib/revision-reuse.js`, the local-test-only
`lib/minimal-head-store.js`, and `revision-reuse.test.mjs`. It covers deterministic
dependency fingerprints, equivalent/narrow/expand/incompatible revisions,
selective view/entity invalidation, reorder safety, removal and ambiguity,
expiry, bounded carry-forward receipts, stale/fork rejection, restart, cancellation,
and an exact metadata-only head schema. SQLite files exist only under temporary
test directories; no production or Supabase database is modified.
