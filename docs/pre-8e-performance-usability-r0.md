# Pre-8E Performance Usability Repair — R0 Evidence

Status: **R0 CLOSEOUT CANDIDATE — implementation evidence green; exact closeout CI pending**

Date: 2026-09-18

Branch: `test/pre-8e-usability-repair-r0`

Planning/base head:
`32655bd59337596337b9b87fdb86c533e0c89aaf`

R0 implementation evidence head:
`f39c6e3d6a3aef149c30f729c01335358a308088`

## Scope

R0 implements only the benchmark/fixture lock from
`specs/001-pre-8e-performance-usability-repair/tasks.md` T001–T006.

No extension/runtime behavior, Edge Function, workflow definition, production
schema, public MCP surface, VM feature flag, transaction authority, Realtime
transport, Milestone 8E work, or preserved 8E stash state is changed.

## Pre-implementation gates

- Source-of-truth order was re-read from `AGENTS.md`, `SECURITY.md`, roadmap,
  canonical repair plan, Spec Kit artifacts, project context/handoff, Git/CI, and
  production state.
- Read-only Spec Kit consistency analysis found no CRITICAL R0 conflict.
- The user explicitly authorized R0 only.
- Exact starting head `32655bd...` had CircleCI #177 SUCCESS + Vercel SUCCESS.
- Production read-only verification before R0:
  - `opera-agent-vm` version 27 ACTIVE, `verify_jwt=true`;
  - deployment SHA
    `0f2c3ada9562d7d3ccea492bd46e83f4994dc321319e37a539939de6dbd12455`;
  - `milestone7_vm_enabled=false`;
  - private `vm_runs`, `vm_effects`, and `vm_rate_windows` row counts were
    0 / 0 / 0.

## T001 — frozen empirical baseline

Added:
`tests/fixtures/pre-8e-usability-baseline-r0-v1.json`.

It records the 2026-09-18 single live run and explicitly marks it
non-distributional. Frozen values include:

- browser.ping ~562 ms;
- tabs.list ~407 ms;
- YouTube Home navigation ~5,224 ms;
- Home read ~652 ms;
- recommendation find ~947 ms;
- recommendation click ~497 ms;
- watch read ~992 ms;
- Skip find ~663 ms;
- media.state ~514 ms;
- youtube.get_transcript v4 ~20,514 ms total with ~4,123 ms workflow start/queue.

The Home/watch observation facts are frozen at ~686/~3,331 text characters and
~119/~139 observed entities.

## T002 — controlled-browser fixture

Added:
`tests/fixtures/pre-8e-usability-r0.html`.

The generic fixture contains:

- CSS-visible but offscreen `Skip navigation`;
- on-screen enabled `Skip`;
- same-document Skip re-render;
- irrelevant counter mutation;
- one media element;
- transcript plus unrelated sponsored/recommendation/comment-shaped noise.

The fixture intentionally contains no YouTube selectors or YouTube-specific
extension logic.

## T003/T004 — legacy failure locks

Added:
`tests/pre-8e-usability-r0.test.mjs` and extended the existing
`tests/browser_extension_test.py` fixture path.

The tests keep the suite green while proving the legacy behavior fails later
acceptance criteria:

- `page.find("Skip")` returns offscreen `Skip navigation` before the real
  on-screen `Skip`;
- after a benign same-document re-render, the fresh Skip ref differs and clicking
  the old ref is rejected as stale.

This records the pre-R1/pre-R2 failure behavior; it does not implement R1 or R2.

## T005 — deterministic payload baseline

The focused Node test constructs deterministic legacy `page.read`-equivalent
payloads for the frozen useful facts.

Measured/locked serialized payload:

- Home: **39,424 bytes** for 686 useful text characters / 119 entities.
- Watch: **48,908 bytes** for 3,331 useful text characters / 139 entities.

These are controlled fixture measurements, not claims about live percentile
performance.

The controlled Chromium suite also measures the actual R0 fixture's legacy
`page.read` payload during regression execution.

## Verification evidence

Focused R0 Node test before push:

- **6/6 PASS**;
- 0 failures.

Exact implementation head `f39c6e3d6a3aef149c30f729c01335358a308088`:

- CircleCI **#182 SUCCESS**;
- Vercel **SUCCESS**.

The repository CircleCI job runs:

1. `npm test`;
2. `npm run check`;
3. Playwright install;
4. Chromium extension regression via
   `python tests/browser_extension_test.py`.

Therefore #182 covers the new Node tests, static invariant checks, and the
controlled Chromium R0 assertions.

Diff from planning head `32655bd...` to implementation evidence head
`f39c6e3...` is limited to four test/fixture files:

- `tests/browser_extension_test.py`;
- `tests/fixtures/pre-8e-usability-baseline-r0-v1.json`;
- `tests/fixtures/pre-8e-usability-r0.html`;
- `tests/pre-8e-usability-r0.test.mjs`.

No runtime source or production artifact is in the diff.

## Closeout gate

T001–T005 have evidence. T006 records this checkpoint state.

This documentation closeout must itself receive exact-head CircleCI + Vercel
SUCCESS before R0 may be called ACCEPTED/CLOSED. While that CI is pending,
STOP at R0. Do not start R1 or Milestone 8E.
