# Pre-8E Performance Usability Repair Plan

Status: **R0–R5 ACCEPTED / CLOSED; R6 AUTHORIZED / IN PROGRESS (T030–T031 complete; T032 next)**

Created: 2026-09-18

Spec Kit feature:
`specs/001-pre-8e-performance-usability-repair/`

This bounded repair track is inserted after closed Performance Track P0-P6 and before
Milestone 8E. It is based on a live production-path YouTube responsiveness test and
addresses usability/latency gaps that controlled Performance Track evidence did not
fully expose.

It does **not** reopen P0-P6, enable the VM, grant transaction authority, or start 8E.

## Locked invariants

- Protocol 1.
- 26 allowlisted browser primitives.
- 18 public MCP tool names and input schemas.
- Background-first; no silent foreground takeover.
- Existing semantic state/delta remains canonical.
- No site-specific selector/opcode logic in the extension.
- No direct action authority from observational `logicalId`.
- No stale-state action, false completion, sensitive-value leak or relevant-change loss.
- `milestone7_vm_enabled=false` remains unchanged.
- The preserved accidental 8E stash remains untouched.
- Public media-tool exposure, production schema changes, transaction authority and
  Realtime transport cutover require separate reviewed authorization.

## Empirical findings frozen from 2026-09-18

| Finding | Evidence |
| --- | --- |
| Basic observation/actions are already sub-second-class | ping ~562ms; tabs.list ~407ms; Home read ~652ms; click recommendation ~497ms; media.state ~514ms |
| Navigation is materially slower | existing-tab navigation to YouTube Home ~5.224s with only ~131ms queue |
| Target resolution adds unnecessary work | watch-page text already contained `Skip`, but `page.find("Skip")` returned offscreen `Skip navigation` plus the real ad `Skip` |
| Dynamic ref freshness is a real failure | real Skip ref became stale before click |
| Model-facing reads are noisy | Home: ~686 text chars + ~119 entities; watch page: ~3,331 text chars + ~139 entities; tool results were large/truncated |
| Media primitives are useful but internal | `media.state` worked in ~514ms; `media.seek/play/pause` exist but are not among 18 public tools |
| Transcript workflow is expensive | `youtube.get_transcript v4` ~20.514s total, ~4.123s workflow start/queue, and broad page-text output |

These are single-run empirical measurements, not percentile/distribution claims.

## Checkpoints

### R0 — benchmark and deterministic fixture lock
Freeze measurements and build generic tests/fixtures reproducing target ambiguity,
viewport truth, stale re-render, irrelevant churn, payload and media/workflow baselines.
No runtime behavior change.

### R1 — actionability-first observation
Make the model-facing target list prioritize actual on-screen, enabled, non-sensitive,
actionable controls before bounded truncation. Correct viewport truth. YouTube is only
an acceptance scenario.

### R2 — fresh target revalidation
Safely revalidate a stale ref near action time using current same-document evidence.
Only a unique trustworthy replacement may be rebound. Ambiguity/reset/sensitivity
changes fail closed.

### R3 — local act + verify
After a simple action, perform bounded local settle/change observation and return fresh
revision/delta/target evidence. Never equate action success with goal completion.

### R4 — compact model-facing observation
Keep rich canonical semantic state internally while projecting a smaller task-useful
view to the model. Target >=70% controlled payload reduction with zero relevant loss.

### R5 — internal media fast path
Use existing `media.state/play/pause/seek` from approved internal workflows to avoid
URL reload/seek where safe. Public MCP surface remains unchanged.

### R6 — navigation and residual transport
First remove unnecessary navigation/reload and prefer reuse/SPA/local action. Measure
residual queue/transport cost afterward. Realtime wake is optional and separately
reviewed only if evidence still justifies it.

### R7 — YouTube workflow cleanup
Reduce redundant query/wait/foreground-render fallback and make transcript/content
output task-focused. Target >=50% improvement from the ~20.514s baseline or record
evidence-backed residual limits.

### R8 — full real-Opera acceptance
Repeat the original recommendation -> click -> skip ad -> summarize prompt and record
latency, round trips, target resolution, stale-ref behavior, payload, foreground audit
and relevant-change audit.

## Primary acceptance benchmark — YouTube Skip

Legacy observed path:

```text
read
-> text already shows Skip
-> find "Skip"
-> receive offscreen Skip navigation + real Skip
-> model filters target
-> click real ref
-> ref is stale
-> fallback/reobserve
```

Target path:

```text
observe
-> real on-screen Skip is directly actionable
-> action performs fresh local revalidation if required
-> bounded local verify
-> compact delta/evidence returned to model
```

No model-mediated refind/filter is required in the normal path.

## Stop rules

Stop immediately if any repair would require:
- a 19th public MCP tool or public input-schema change;
- a new production DB shape;
- VM enablement;
- transaction/approval authority;
- weakened stale-target/sensitive-state protection;
- site-specific extension logic;
- Realtime transport cutover without the separate authorization required by R6.

## Exact next action

R0 is ACCEPTED/CLOSED with durable evidence in `docs/pre-8e-performance-usability-r0.md`.

R1 is ACCEPTED/CLOSED with durable evidence in `docs/pre-8e-performance-usability-r1.md`.

R2 and R3 are ACCEPTED/CLOSED with their durable evidence records. R4 is ACCEPTED/CLOSED with implementation/evidence head `4c1e4cbbe0644b06bf51ce952be78edac8aa9182` (CircleCI #244 + Vercel SUCCESS) and closeout head `c2f2875686014439404b47518f9cc1789e202a7f` (CircleCI #245 + Vercel SUCCESS).

R5 / T026–T029 is **ACCEPTED / CLOSED**. Canonical synchronization head `d0782dd39806bd2a659c632d805d2592d07c4836` has CircleCI #252 + Vercel SUCCESS. R6 is now **IN PROGRESS**. The required Spec Kit consistency/constitution analysis is PASS. T030 navigation measurement is complete. T031 local-SPA recommendation navigation is also complete at exact head `3d21ecc58cfece6e55f40433525a7a6c1db27800` with CircleCI #258 + Vercel SUCCESS. Exact next is **T032** residual queue/transport measurement; T033's mandatory STOP remains binding if Realtime wake is still justified.

Milestone 8E remains paused/not started until R8 is accepted and the user separately
authorizes 8E.
