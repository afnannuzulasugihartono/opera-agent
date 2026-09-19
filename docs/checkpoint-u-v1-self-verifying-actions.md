# U-V1 — Self-verifying actions

Date: 2026-09-20

Status: **ACCEPTED / CLOSED (CI-evidence acceptance under the 2026-09-19
standing authorization).**

Branch: `feat/pre-8e-usability-repair-r3`

## Scope

U-V1 implements the verification methods from
`docs/research/perception-identity-verification-2026-09-20.md`: expected-state
checks evaluated in-page at action time, a bounded retry, an automatic anchor
`href` fallback, absence waits, and partial-result preservation for bursts.
The public MCP inventory stays frozen at 18 tools with unchanged input schemas
(`expect`/`retry` are extension-internal parameters following the R4
`view:"compact"` precedent); protocol 1 and the 26 primitives are unchanged.

## What changed

`extension/content.js`:

- `preparePostAction` now records the pre-action URL.
- `normalizeExpectSpec` + `evaluateExpectations`: `expect` supports
  `urlChanged`, `urlContains`, `selectorAppears`, `selectorGone`, `textGone`,
  and `minMutationDelta`, evaluated inside `postActionEvidence` right after
  the settle — verification costs no extra round trip and no full re-read.
- `postActionEvidence` attaches `verified: true|false` plus per-check
  `expectations`, and exposes `fallbackHref` when an unverified anchor has a
  usable href.
- `clickSynthetic` accepts `retry: {attempts}` (bounded 1–3, 150 ms spacing);
  verification failure drives the retry loop, and the anchor href is attached
  when verification still fails.
- `page.wait_for` accepts `absent: true` (requires ref/selector/text):
  succeeds when the target disappears, and reports `stillPresent: true` on
  timeout.

`extension/background.js`:

- `trustedClick` accepts `{expect, attempts}` (threaded from `page.click`
  params) with the same bounded retry; `page.post_action` receives the expect
  spec so both click paths share one verification contract.
- `runBurst` loop-top deadline check now returns
  `{ok:false, timedOut:true, completedSteps, failedAt, error:{code:"BURST_TIMEOUT", message:"... completed steps may have taken effect."}, results}`
  instead of throwing away the successful prefix (unknown-outcome contract,
  matching V2's `AWAIT_OUTCOME_UNKNOWN` semantics).

## Acceptance evidence (local headed Chromium + CI)

Controlled-browser scenarios in `tests/browser_extension_test.py` (tab
`uv1`), all green locally and in CI:

- `expect.textGone` passes on a click that flips the target state
  (`verified: true`, per-check details);
- `expect.urlContains` with a never-matching value reports `verified: false`
  with the failing check identified;
- `absent: true` wait succeeds after the removal click;
- an anchor click with failing expectation returns `fallbackHref` ending in
  the anchor target;
- a burst whose second step is a failing wait returns the successful read
  prefix (`completedSteps: 1`, `failedAction: 'wait'`, prefix results intact).

Source-contract locks in `tests/perception-identity-verification-quickwins.test.mjs`
cover the burst loop-top partial return (`timedOut: true`, `BURST_TIMEOUT`,
"completed steps may have taken effect" at the deadline check).

## Boundary notes (recorded honestly)

- The loop-top burst-timeout branch is locked by source contract rather than
  a live scenario: `browser.burst` rejects a caller-provided `timeoutMs`
  (allowlisted params), so the 12 s internal budget cannot be compressed
  deterministically in a test; the live scenario proves the equivalent
  partial-preservation contract through the wait-failure path.
- Trusted clicks inside bursts still require window focus
  (`FOREGROUND_REQUIRED` is correct behavior); the burst scenario therefore
  uses a read prefix.
- Frozen-byte locks for `extension/content.js` and `extension/background.js`
  were rebaselined (recorded reason: U-V1 runtime change); all 449 Node tests
  and the static check pass.

## Disposition

Next proposed checkpoints remain U-I (identity hardening), U-P1 (CDP
accessibility-tree observation), U-P3 (stale pruning), U-P2 (vision
sampling); R8 still requires an Opera environment.
