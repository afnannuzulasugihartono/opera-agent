# Pre-8E repair R6 — navigation and residual transport

Date: 2026-09-19. Status: candidate implemented; required full/CI gates pending.

R5 closeout `50b19ee1f4ea91fd0be866565a1c1733bc8ff87b` has CircleCI #251 and
Vercel SUCCESS. Local Chromium also passed: nine ready-media seeks, p50 16.79ms,
verified positions, no navigation/reload and background focus preserved. This is
local controlled timing, not production latency.

## Consistency analysis and scope

Read all R0–R4 acceptance records, repair plan/spec/tasks/research, constitution,
AGENTS and SECURITY. R5–R8 are explicitly authorized by the current user; old
R3-only status text is historical, not a new authority limit. FR-011 maps to
T030/T031; FR-012 to T032/T033; compatibility/focus to T029/T042. No new public
tool, primitive, transport, schema, signing or transaction authority is needed.
Spec Kit prerequisites passed using SPECIFY_FEATURE_DIRECTORY. No extension hooks
or feature checklists are present. R8 live evidence remains distinct from CI.

## T030/T032 — measurements and limits

Read-only aggregate of up to 300 completed eligible production commands from the
last 24 hours, queried 2026-09-19 (no params/results/private page text collected):

| Method | Samples | Mean total ms | Mean queue ms | Queue/total |
| --- | ---: | ---: | ---: | ---: |
| tabs.navigate | 30 | 2971.36 | 189.23 | 6.37% |
| page.click | 30 | 1492.39 | 143.71 | 9.63% |
| browser.ping | 6 | 609.66 | 193.84 | 31.79% |

These are observational, unpaired measurements of the installed version, not
post-deployment candidate improvements. No media.seek sample existed. Queue is
not all network/transport cost; total-minus-queue must not be called pure browser
execution. Frozen baseline navigation: 5224ms with 131ms queue (2.51%).
The local regression also passed existing same-URL navigation reuse and SPA
route-change assertions. Required different-page navigation remains legitimate.

## T031 — bounded candidate

Tests-first commit `b8c0ca89f5efbceaf914fce06c6fd96e352cf082` fails twice for
the missing candidate. Tests execute the actual TypeScript workflow interpreter
with only its browser command boundary mocked, not a replacement interpreter.

The candidate version of youtube.play_recommendation changes only:

- remove unconditional activation of an existing tab;
- open a missing tab with active=false;
- use the observed recommendation ref with page.click instead of tabs.navigate.

Home navigation is retained only when the selected existing tab is not Home.
Failed clicks are not retried by URL, and existing bounded ad/media steps remain.
Three branch tests cover Home reuse, absent tab/stale click, and non-Home reuse.
Generic extension navigation already short-circuits exact same-URL requests.
No extension/MCP/runtime source change is made by R6.

## T033 — decision

Do not migrate transport. Available evidence does not establish Realtime wake as
necessary to fix this workload; navigation and redundant commands remain the
larger actionable costs. No Realtime, schema, production deployment, VM enablement
or 8E action was taken. Live candidate comparison is reserved for R8 after an
authorized candidate installation, not fabricated from these baseline samples.
