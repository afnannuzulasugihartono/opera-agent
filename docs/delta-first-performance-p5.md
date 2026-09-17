# Performance Track P — Checkpoint P5 acceptance record

Date: 2026-09-17

Status: **FINAL CANDIDATE — exact-head CircleCI + Vercel/status required. Independent Performance Track P audit has not started.**

## Boundary

- Repository: `afnannuzulasugihartono/opera-agent`
- Branch: `feat/semantic-runtime-1.6.0`
- Accepted P4 head: `e550bc90f49df2541dfd91789d99b2b33e4bf2aa`
- P4 exact-head checks: CircleCI #98 SUCCESS + Vercel SUCCESS
- Stable extension: `1.6.0`
- Protocol: `1`
- Public browser capabilities: `26`
- Public MCP tools: `18`
- Milestone 8: 8A–8D accepted; 8E paused/not started
- P5 runtime/extension/MCP/schema/function/signing/transaction mutation: **none**

P5 is an acceptance checkpoint. It adds only an evidence fixture, deterministic
acceptance tests, this record, and synchronized planning/handoff documents.

## Frozen gates

P0 froze the following P5 gates and P5 does not rewrite them:

- false completion: `0`;
- foreground takeover: `0`;
- stale-state action: `0`;
- relevant-signal loss: `0`;
- small-change reasoning-payload reduction: `>=75%` median;
- repetitive reasoning/tool-round-trip reduction: `>=60%` median;
- steady-state full-snapshot reduction: `>=80%`;
- long repetitive task speedup: `>=2.0x` median;
- simple-operation median regression: `<=15%`.

Correctness remains a hard prerequisite for any latency result.

## Fresh real-Opera environment

The accepted Opera Agent relay reported the paired `opera` device online with
extension `1.6.0`, protocol `1`, and `26` capabilities. P5 used the existing accepted
command path only. No database schema/function, Edge function, OAuth, extension, MCP,
signing, pairing, or transaction policy was changed.

All dedicated P5 tabs were opened with `active:false`. The P5 command audit recorded
zero `tabs.activate`, zero `page.pointer`, and zero `page.fill`/`page.key` commands.
All dedicated P5 tabs were closed after the probe.

One cleanup close initially returned a transient Opera tab-edit error and succeeded
on one retry. One earlier `page.read` preflight referenced a stale tab ID and failed
with `No tab with id`; it is recorded and excluded from acceptance measurements
rather than relabeled as a success.

## Google Maps real-site evidence

A background Google Maps restaurant search produced a real repeated `feed` region.
The feed grew from **16** to **25** loaded entities after lazy loading with
`duplicateKeyCount=0`.

The first bottom observation remained **PARTIAL**. A later bottom observation reached
the measured boundary with stable-observation count `1` and still remained
**PARTIAL**. The immediately unchanged second boundary observation had stable count
`2`, classification `NO_RELEVANT_CHANGE`, and became **BOUNDED_COMPLETE**.

The five accepted rich observations were:

```text
RESET -> MOVE -> MIXED -> MOVE -> NO_RELEVANT_CHANGE
```

Only one of the five reads was a full bootstrap; four were steady-state delta reads.
That is an **80.00% full-snapshot reduction**, meeting the frozen `>=80%` gate.
The delayed stable-boundary completion is also fresh evidence of zero false
completion in this probe.

## GitHub real-site evidence

A background repository page produced `11` semantic regions, including a repeated
list with `10` loaded entities and `0` duplicate keys.

A background-safe click on the repository Issues link changed the target tab to
`/issues` while the tab remained `active:false`. The next semantic observation
reported:

- document generation **1 -> 2**;
- reset reason **SPA_ROUTE**;
- classification **RESET**.

The runtime therefore discarded old-route continuity instead of using stale state.

## YouTube real-site evidence

On the existing live YouTube media page, two consecutive read-only semantic
observations recorded a mutation-version change **112707 -> 112708** while the second
observation classified as `NO_RELEVANT_CHANGE`, with zero semantic changes and zero
changed semantic regions.

This is real dynamic-page churn. P3's accepted deterministic storm suite separately
retains the safety counterpart: 1,280 irrelevant signals cause zero unnecessary
reasoning wakes, and one later relevant signal is detected exactly 1/1.

## Small-change payload gate

The byte-locked P2 paired benchmark remains the deterministic reasoning-layer
measurement:

- rich payload median **22,244 bytes**;
- compact patch median **1,380 bytes**;
- median reduction **93.80%** versus frozen `>=75%`;
- zero fallback/reset on valid pairs;
- zero stale continuation;
- zero false completion;
- zero foreground takeover;
- zero relevant semantic information loss.

## Repetitive round-trip gate

The byte-locked P4 controlled workload remains the deterministic local-host authority:

- browser effects **8/8**;
- hidden effects **0**;
- local reasoning wakeups **0**;
- baseline model-mediated round trips **9**;
- P4 model-mediated round trips **1**;
- reduction **88.89%** versus frozen `>=60%`.

## Fresh live long-task timing

Both live arms execute the same eight small `page.read` effects. The baseline issues
each effect only after the preceding effect completes and the model/tool boundary
returns. The comparison arm bulk-enqueues the same independent effects.

This is explicitly a **mediation-elision transport proxy**, not a claim that the P4
JavaScript host directly drove the external browser. The actual P4 host semantics,
effect accounting, typed yields, and zero local reasoning wakeups are established by
the deterministic P4 suite.

| Run | Baseline | Mediation-elided | Speedup |
| --- | ---: | ---: | ---: |
| 1 | 40,010.506 ms | 4,894.013 ms | 8.175x |
| 2 | 43,704.939 ms | 5,009.552 ms | 8.724x |
| 3 | 53,733.039 ms | 4,976.989 ms | 10.796x |

Median speedup: **8.724x**, above the frozen **>=2.0x** gate. Both arms contain eight
browser effects; none are hidden from accounting.

## Simple-operation regression gate

In the same live Opera environment, 24 baseline and 24 mediation-elided small reads
had paired `claimed_at -> completed_at` medians:

- baseline **309.192 ms**;
- mediation-elided **291.628 ms**;
- regression **-5.68%**.

This is within the frozen `<=15%` ceiling. These live relay timings are not compared
directly to the historical isolated-browser 19.83 ms reference because the
environments are different.

## Gate summary

| Gate | Frozen target | Evidence |
| --- | ---: | ---: |
| false completion | 0 | 0 |
| foreground takeover | 0 | 0 |
| stale-state action | 0 | 0 |
| relevant-signal loss | 0 | 0 |
| small-change payload reduction | >=75% | 93.80% |
| repetitive reasoning round-trip reduction | >=60% | 88.89% |
| steady-state full-snapshot reduction | >=80% | 80.00% |
| long repetitive task median speedup | >=2.0x | 8.724x |
| simple-operation median regression | <=15% | -5.68% |

Machine-readable evidence: `tests/fixtures/delta-performance-p5-v1.json`.
Deterministic gate test: `tests/delta-performance-p5.test.mjs`.

## Net boundary

P5 leaves P4, P3, P2, Reactive VM 7B/7C/7D, extension content/background/manifest,
and public MCP source byte-for-byte unchanged. P5 adds no browser primitive, no
extension observer, no direct logical-ID action, no VM write authority, no
transaction/approval authority, and no Milestone 8E implementation.

## Acceptance rule

P5 becomes accepted only when the exact final-candidate head containing the evidence,
tests, acceptance record, plan, roadmap, project context, and handoff has both:

1. CircleCI SUCCESS;
2. Vercel/status SUCCESS.

The normal CI path must also keep the full test/static/controlled-browser suite and
all runtime byte locks green. Pending/queued/in-progress => **STOP**. Failure =>
diagnose only the P5 failure. Green exact-head checks accept P5 without a status-only
follow-up commit.

## Exact next gate

After P5 acceptance, **do not start 8E**. Performance Track P has reached its final
checkpoint, but `AGENTS.md` and the frozen plan require an **independent
proportionate performance/correctness audit of the complete track**. Only an audit
verdict `PASS` permits returning to Milestone 8 at 8E unless the user explicitly
accepts documented residual risk.
