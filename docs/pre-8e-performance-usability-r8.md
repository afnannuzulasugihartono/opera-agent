# Pre-8E performance/usability repair R8 evidence

Date: 2026-09-20

Verdict: **FAIL / SAFELY ROLLED BACK**. R8 is not closed and Milestone 8E
remains paused.

## Accepted starting evidence

- Candidate implementation head `c71b8a2` had CircleCI #299 and Vercel SUCCESS.
- The final independent pre-production audit returned PASS for a bracketed
  1.6.1 activation with signed forward rollback 1.6.2.
- Production database-decoded bytes, identity-specific update XML/health, and
  public CRX download matched the signed 1.6.1 artifact: 40,441 bytes, SHA-256
  `8c980dbe37cbccf2f272e45e8045fd7d6e91ad0d666dd289bc65eccaa6d49b1e`,
  extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick`.
- Opera installed `1.6.1_0` in place and preserved pairing. A direct production
  `browser.ping` completed in 880 ms with version 1.6.1, Protocol 1, and all 26
  capabilities.

## T039 — original real-Opera prompt

The original recommendation/click/skip/summarize prompt completed end-to-end in
real Opera through the production connector. It selected a current recommended
technology video, opened it, encountered a pre-roll advertisement, skipped the
advertisement through a coordinate fallback, and produced a useful topical
summary from page-visible title, description, chapters, and source information.

The end result was useful, but the normal Skip path did not satisfy the frozen
R8 contract. YouTube's auxiliary AI panel also accepted a summary request but
did not expose its response through the subsequent Opera Agent observations;
the final summary therefore used the retained video-page evidence.

## T040 — measured trace

The production command trace from 11:36:26Z through 11:40:01Z contained 33 tool
commands over 215,348 ms wall time, including 2 failed ref clicks. Aggregate
serialized result payload was 845,701 bytes.
The production trace establishes 33 tool round trips; separate model-only
reasoning rounds are not emitted by this command schema and are therefore not
invented from timing gaps.

| Method | Calls | Average | Maximum |
|---|---:|---:|---:|
| `browser.ping` | 1 | 722 ms | 722 ms |
| `tabs.list` | 1 | 388 ms | 388 ms |
| `tabs.open` | 1 | 3,114 ms | 3,114 ms |
| `page.read` | 11 | 860 ms | 2,175 ms |
| `page.find` | 10 | 979 ms | 1,368 ms |
| `page.click` | 6 | 1,400 ms | 2,075 ms |
| `page.pointer` | 1 | 2,344 ms | 2,344 ms |
| `page.fill` | 1 | 1,704 ms | 1,704 ms |
| `page.key` | 1 | 720 ms | 720 ms |

Queue latency was 165 ms average, 176 ms p50, and 333 ms maximum; average
browser execution after claim was 945 ms. No `tabs.activate` command occurred
and every action requested background execution. The trace does not expose an
independent before/after active-tab field, so focus preservation is supported by
command intent and absence of activation rather than claimed as stronger proof.

## T041 failure evidence

The first `page.find("Skip")` call explicitly supplied `limit:20`. It returned
two candidates and selected the wrong default item:

- `Skip navigation`: visible but at `y=-1000`, `inViewport:false`,
  `actionable:false`;
- real `Skip`: rectangle `x=833.24`, `y=482`, width `85.22`, height `36`, but
  also reported `inViewport:false`, `actionable:false`.

The caller therefore had to filter the second candidate. Its ref click failed
with `Element not found or reference is stale.` A second find returned only
offscreen `Skip navigation`; another ref click failed stale. A background
coordinate click at the previously observed real Skip center then succeeded.

This violates the required normal path
`observe -> action/revalidate+verify -> compact delta`: it used model-mediated
candidate filtering, two refind/read cycles, two stale failures, and coordinate
fallback. It also proves the R8 candidate's omitted-limit dominance projection
does not cover the real MCP caller behavior when the model supplies an explicit
limit. The live geometry/actionability mismatch is a second independent issue.

Falsifiable repair hypothesis for a separately authorized continuation:

1. an explicit multi-result request needs a model-facing dominant-item signal or
   safe projection that preserves genuine equal actionable ambiguity; and
2. live viewport geometry must explain why an element centered at `(875.85,500)`
   was marked outside the viewport before any ranking repair is attempted.

No new repair was attempted after this failure.

## Audited forward rollback

The signed 1.6.2 forward rollback was activated atomically after the failed gate.
Production database state, identity-specific XML/health, and public download now
serve its 35,631-byte CRX with SHA-256
`bca7d9d5199f0075ac41fcc929e260943acd8c4e1e076fc26cf9294c408a085a`.
Opera installed `1.6.2_0` in place. Post-rollback `browser.ping` completed in
408 ms with pairing preserved, version 1.6.2, Protocol 1, and 26 capabilities.

## Stop state

- T039 and T040 are complete.
- T041 failed; T042-T045 remain open.
- Production is safely on 1.6.2, which carries accepted 1.6.0 extension behavior.
- R8 remains blocked pending a separately authorized evidence-first repair.
- Do not tag/release 1.6.1 as accepted, fast-forward it to `main`, or start 8E.
