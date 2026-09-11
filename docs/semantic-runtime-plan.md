# Semantic Runtime implementation plan

This document is the gated implementation plan that follows the Opera Agent 1.5.0
vision-navigation candidate. It translates the product research into incremental,
testable releases. It does not authorize implementing every research idea in one
release.

## Product direction

Opera Agent should evolve from a collection of browser-control primitives into a
background-first semantic runtime for the user's real Opera session. The long-term
model is a live, transactional semantic database for AI:

```text
browser facts
  -> stable semantic entities
  -> incremental task-relevant views
  -> causal decisions and constraints
  -> verified transactions
  -> completion evidence
```

The differentiator is the combination of live semantic views, causal invalidation,
multi-sensor execution planning, decision-selective revalidation, explicit
completion classes, and provenance-aware transactions. No individual component is
treated as novel by itself.

The product continues to use ordinary SemVer. The research phrase "Opera Agent
2.0" is architectural shorthand only; it is not a release name or a new product
line.

## Non-negotiable invariants

1. Normal automation never activates a tab, focuses an Opera window, moves the OS
   cursor, or redirects user input.
2. Every page operation targets an explicit `tabId`; cross-tab state is never
   inferred from whichever tab happens to be active.
3. Protocol 1, the 26 browser capabilities, the 18 MCP tool names, and their input
   schemas remain unchanged throughout the next release.
4. New result fields are optional and additive. An older MCP server must safely
   ignore them, and a newer MCP server must tolerate a 1.5.0 extension that omits
   them.
5. The extension remains site-agnostic. Google Maps is an acceptance scenario, not
   extension architecture.
6. Raw page text, screenshots, form values, credentials, OTPs, payment data, and
   private-tab content are not persisted as telemetry.
7. All loops, caches, payloads, waits, retries, event streams, and retained entities
   have explicit bounds.
8. A successful browser action is not evidence that the user's goal was achieved.
9. Claims about external projects or research must be checked against primary,
   current sources before they drive implementation.

## Release decision

The immediate sequence is:

```text
finish 1.5.0 production acceptance
  -> promote or roll back 1.5.0
  -> measure the accepted baseline
  -> build 1.6.0 Semantic Runtime Foundation
  -> promote only after controlled, real-Opera, cloud, and native-MCP acceptance
```

No 1.6.0 implementation begins while 1.5.0 still has an unresolved production
gate. This prevents semantic-runtime failures from being confused with unfinished
vision-navigation behavior.

---

## Milestone 4B — close the 1.5.0 production gate

Target: promote the existing signed candidate without adding scope.

### Checkpoint 4B.1 — installed-version confirmation

Status: **complete on 2026-09-11**. The normal device returned a fresh heartbeat and
a real queued `browser.ping` with `paired: true`, extension `1.5.0`, protocol `1`,
and 26 capabilities. MCP Edge Function version 12 is active and registers the
unchanged 18-tool inventory; health and OAuth metadata returned HTTP 200 and an
unauthenticated POST returned HTTP 401. The active update row still uses extension
ID `ohbbpamcljckmjhcpkcmefdobkoeaick` and the recorded 1.5.0 SHA-256. Finally, the
already-connected ChatGPT UI called only `browser_status` and reported `paired:
true`, extension `1.5.0`, protocol `1`, and 26 capabilities without logout,
reconnect, re-pairing, or any tab change.

- Update the normal Opera profile through the existing same-identity channel.
- Confirm heartbeat reports extension `1.5.0`, protocol `1`, and 26 capabilities.
- Confirm pairing, OAuth, and the ChatGPT connection survive the update.
- Confirm the MCP still exposes exactly the existing 18 tools.

Exit evidence:

- one current device heartbeat from the normal Opera profile;
- extension ID `ohbbpamcljckmjhcpkcmefdobkoeaick` unchanged;
- no repair, reinstall, logout/login, or re-pair required.

### Checkpoint 4B.2 — Google Maps production acceptance

Status: **complete with `BOUNDED_COMPLETE` evidence on 2026-09-11**. The normal Opera profile kept
Google Maps tab `584940597` inactive while the active tab in each of two Opera
windows remained unchanged. A bounded run performed 13 measured background wheel
operations against the detected `role: feed` results container. Both debugger and
the deterministic DOM fallback paths worked and settled. The first two passes grew
the observed unique Place identities from 6 to 12 and then 18 while preserving all
six initial stable keys. Later bounded passes reached 46, 60, and finally 72 unique
Place stable keys. A reported boundary was correctly invalidated when lazy loading
expanded `scrollHeight`; the final verification also loaded more results, so no
exhaustion claim was made. Three background captures passed blank checking at
1280x643 and about 153 KB, but Maps continued to change between frames, so the
hashes differed and this run did not produce an unchanged-frame suppression proof.
The bounded continuation later observed 112 Place links representing 108 unique
stable keys; a six-wheel burst hit the 12-second deadline and returned a structured
timeout, after which a smaller three-wheel burst recovered without foreground
fallback. A cropped results-panel capture produced a real 402x650 JPEG of 41,163
bytes; its immediate `previousHash` capture returned the identical SHA-256 with
`unchanged: true` and no duplicate image data. A short isolated
`tabs.list -> page.read -> tabs.list` audit preserved both windows' active-tab IDs
and kept Maps inactive. The final bounded continuation reached a settled feed with
120 Place links representing 116 unique stable keys. One additional verification
wheel did not move, did not change content or `mutationVersion`, retained all 116
unique identities, and reported `reachedBoundary: true` with identical before/after
`scrollTop`, `scrollHeight`, and maximum extent. A final active-tab audit again
preserved both windows and kept Maps inactive. This proves exhaustion only for the
defined Google Maps result-feed protocol and is not a claim that every physical
restaurant in the geographic area exists in the result set.

- Keep ChatGPT active while Google Maps remains an inactive target tab.
- Read the results panel and verify `stableKey`, `inViewport`, viewport/zoom, and
  mutation metadata.
- Scroll the intended nested results container through at least one lazy-load
  expansion and then to a final bounded boundary.
- Verify the response distinguishes movement, new content, settling, and boundary.
- Capture once, capture again with `previousHash`, and verify unchanged suppression.
- Audit active tab and focused window before and after every action.

Exit evidence:

- at least one lazy-load pass with new identities;
- a later boundary with no new identities;
- no focus takeover;
- no claim that Google Maps is universally exhaustive.

### Checkpoint 4B.3 — cross-site acceptance

Status: **complete on 2026-09-11**. Read-only acceptance covered two
applications unrelated to Google Maps while preserving the user's foreground tabs:

- YouTube tab `584940639` stayed inactive during `read -> background scroll ->
  read -> delayed verification`. The document ID and mutation version stayed
  stable, scrolling moved from `0` to `650.18`, and all 30 deduplicated video-link
  identities were retained. The delayed read confirmed the same settled position.
- GitHub tab `584940617` stayed inactive during the same sequence. The document ID
  and mutation version stayed stable, scrolling moved from `0` to `700`, and all 85
  deduplicated repository-link identities were retained. A delayed read confirmed
  the same scroll position and semantic state.
- The final tab audit matched the initial audit: Typecelerate remained active in
  window `584940409`, CNN remained active in window `584940603`, and neither test
  target was activated. No click, input, media control, navigation, or foreground
  fallback was used.

Together with Checkpoint 4B.2 on Google Maps, this satisfies the three distinct
application-shape gate with zero foreground takeovers. The acceptance validates the
existing generic runtime behavior; it does not claim that every site has identical
lazy-loading behavior.

Use at least two unrelated complex applications:

- YouTube: dynamic/media page and changing DOM;
- GitHub: structured semantic page with repeated links/items.

Tests are read-only except for reversible scrolling and field focus. Each test must
exercise observe, one background action, settle, and verify while another tab stays
active. If a chosen live site becomes unsuitable, substitute another unrelated SPA
and record the reason; do not weaken the three-site requirement.

Exit evidence:

- all existing behavior still passes on three distinct application shapes;
- zero foreground takeovers;
- failures are structured rather than silently recovered through activation.

### Checkpoint 4B.4 — stable promotion and rollback record

Status: **complete on 2026-09-11**. All 40 Node tests and static validation
passed. The complete controlled-Chromium and isolated-real-Opera suites passed
under the established extension ID with 20/20 burst stability runs. Supabase
`system.self_test`, the release/method registry audit, and a fresh normal-profile
ping passed. MCP health and OAuth metadata returned HTTP 200 while an
unauthenticated POST returned HTTP 401. The identity-aware updater returned version
1.5.0 and the expected extension ID; its 25,462-byte CRX matched the local artifact
and release row at SHA-256
`7f23c265b78ea3b9e09ce5e07cb9e77ab0d33c85f9e5dfe7288178a5d7f21c44`.
Version 1.4.0 remains stored as the inactive same-identity rollback.

- Run Node tests, static checks, controlled Chromium, isolated Opera, Supabase cloud
  integration, update-download verification, and normal-profile smoke tests.
- Promote the exact accepted commit to `main` and create the normal SemVer tag.
- Mark 1.5.0 stable only after the tag, artifact hash, release metadata, and served
  CRX all agree.
- Retain 1.4.0 as the immediate inactive rollback artifact until the observation
  window closes.

Stop condition: any focus theft, identity change, MCP inventory drift, sensitive
capture, or unexplained cross-site regression returns the release to candidate
status.

---

## Milestone 5 — Opera Agent 1.6.0 Semantic Runtime Foundation

Objective: produce bounded, generic stable semantic identity and incremental deltas
without exposing a new public tool or permitting semantic identity to perform an
action yet.

### Checkpoint 5A — telemetry and deterministic replay baseline

Status: **complete on 2026-09-11**. The accepted 1.5.2 patch release was used as
the behavioral baseline because its changes after 1.5.0 were UI-only and it is the
current rollback anchor for 1.6.0 work. A versioned, synthetic-only nine-scenario
corpus now covers the required static, lazy, virtualized, SPA, mutation-noise,
canvas, stale-reference, reconnect, and restart shapes. The checked-in
`npm run benchmark:semantic` command ran the complete controlled browser suite
three times, with zero foreground-focus changes and a stable corpus fingerprint.
Median/p95 latency and payload measurements are recorded in `docs/benchmarks.md`
and locked in `tests/fixtures/semantic-baseline-thresholds-v1.json`. No telemetry
file is written and no raw page content or sensitive value is retained. Semantic
identity agreement and delta compression are explicitly unavailable in 1.5.2;
their thresholds are locked now and become measurable exit gates in Checkpoints
5B and 5C rather than being fabricated for the baseline.

Before changing semantics, measure the accepted stable path.

Build controlled fixtures for:

- a static form and landmark layout;
- a nested lazy-loaded list;
- a virtualized list that detaches and recreates DOM nodes;
- a SPA route change without full document navigation;
- relevant and irrelevant mutation storms;
- a canvas region alongside semantic controls;
- stale refs, failed actions, reconnect, and browser restart.

Record only bounded operational metadata:

- observation and action duration;
- returned bytes and entity counts;
- full-snapshot versus delta bytes;
- mutation count and relevant-delta count;
- reconciliation matches, ambiguity, and collisions;
- retries, reset reasons, and focus audits;
- model/tool round trips in end-to-end acceptance.

Do not record page text, screenshots, form values, complete URLs with private query
parameters, or user-entered data. Reuse existing workflow telemetry if sufficient.
If a new Supabase structure is truly required, keep it out of exposed schemas when
possible, use least privilege, and review RLS/function grants before deployment.

Checkpoint output:

- a versioned replay corpus made only of synthetic/scrubbed fixtures;
- a checked-in benchmark command;
- baseline median and p95 measurements;
- performance and payload thresholds locked before Checkpoint 5B.

Provisional targets, subject to the measured baseline:

- zero active-tab/focused-window changes;
- zero sensitive-value persistence;
- no more than 15% median regression for an ordinary element-rich `page.read`;
- a one-item change in a 100-item fixture returns materially fewer bytes than a full
  snapshot;
- deterministic replay produces the same semantic IDs and delta classification.

### Checkpoint 5B — Stable Semantic Identity Engine

Status: **implementation and controlled acceptance complete on 2026-09-11**. A
bounded per-document in-memory engine now enriches ordinary rich `page.read`
results with observational logical identity and semantic revision. Intrinsic
stable keys take precedence over hashed canonical hrefs and bounded semantic
fingerprints; geometry has its own revision and never determines identity. The
cache has entity, estimated-byte, and age limits, hashes URL bindings, excludes
sensitive controls, and resets on SPA route change or extension runtime epoch
change. Full navigations and tab closure destroy the content-script scope. Tests
prove compatible rerender survival, deterministic replay, no collision across 500
distinct synthetic entities, explicit duplicate ambiguity, independent semantic
and geometry revisions, stale-ref preservation, and bounded eviction. The
controlled-browser regression proves the same behavior through `page.read`, keeps
20/20 burst stability, and records zero foreground takeover. A paired same-machine comparison
against accepted 1.5.2 measured about 7.2% median rich-read regression, below the
locked 15% gate. `logicalId` is absent from every action schema and cannot be used
as an action target.

Add a bounded in-memory identity layer per tab/document. A logical entity contains:

```text
logicalId
revision
kind / role
bounded semantic label
source bindings (ref, stableKey, canonical href or intrinsic ID when safe)
region membership
geometry revision
confidence and ambiguity
firstSeen / lastSeen
```

Identity precedence:

1. safe site/intrinsic identifiers and canonical hrefs;
2. stable element IDs and accessibility relationships;
3. bounded semantic fingerprint plus structural neighborhood;
4. geometry only as supporting evidence, never as identity by itself.

Required behavior:

- the same entity survives a compatible rerender or virtual-list detach/reinsert;
- a genuinely different item does not inherit the previous logical identity;
- ambiguous matches are reported, not silently merged;
- document navigation resets document-scoped action refs while retaining only
  explicitly safe cross-document knowledge;
- hidden, sensitive, incognito, private, and non-HTTP(S) content follows existing
  protections;
- caches have explicit entity, byte, and time limits and are cleared on tab close,
  privacy transition, logout-sensitive navigation, extension restart, or eviction.

Safety boundary: `logicalId` is observational in 1.6.0. `page.click`, `page.fill`, and
pointer methods continue to accept only their established inputs. This makes an
identity error diagnosable without turning it into a wrong action.

Exit evidence:

- deterministic identity across repeated controlled rerenders;
- no collision in the replay corpus;
- explicit ambiguity/reset output for intentionally indistinguishable fixtures;
- current `ref` invalidation behavior remains intact.

### Checkpoint 5C — Semantic Delta Engine

Status: **implementation and controlled acceptance complete on 2026-09-11**.
Successive rich reads now return an optional bounded `semanticDelta` alongside the
existing complete page result. The engine classifies `INSERT`, `UPDATE`, `REMOVE`,
`MOVE`, `RESET`, `NO_RELEVANT_CHANGE`, and mixed changes with source/result
revisions, reason, confidence, and snapshot requirements. A one-observation grace
window prevents transient virtual-list detach/reinsert from becoming a false
remove/insert pair; actual absence becomes `REMOVE` after that bounded window.
Initial observation, SPA/restart reset, and output overflow request a complete
snapshot rather than fabricating continuity. Unit tests prove irrelevant churn,
single-item update, virtual replacement, removal grace, deterministic reset, and
cap behavior. Controlled-browser acceptance produced one real semantic `UPDATE`,
a delta/snapshot ratio of 12.88%, zero focus takeover, and a three-run 19.10 ms
median rich read—about 1.7% over the paired accepted baseline. No input schema or
action target changed.

Derive entity changes from successive observations:

```text
INSERT logical entity
UPDATE selected semantic fields
REMOVE entity
MOVE region/order/viewport position
RESET document or cache generation
NO_RELEVANT_CHANGE
```

`mutationVersion` remains a browser signal, not proof of a task-relevant change.
The engine must distinguish DOM churn from changes to the bounded semantic entity
set. Each delta includes source revision, resulting revision, reason, confidence,
and whether a complete snapshot is required.

Compatibility design:

- return optional `semanticState` and `semanticDelta` fields inside existing
  `page.read` results;
- do not change `read_page` input schema or add an MCP tool;
- after restart, eviction, version mismatch, or missed history, return a bounded
  snapshot plus `resetReason` instead of fabricating a delta;
- MCP instructions may describe the optional fields only after both old and new
  extension combinations have passed compatibility tests.

Exit evidence:

- one relevant fixture mutation produces exactly the expected semantic delta;
- irrelevant animation/mutation noise produces `NO_RELEVANT_CHANGE`;
- virtualized-node replacement preserves identity instead of emitting false
  remove/insert pairs;
- missing history causes a safe reset;
- output caps force a reset/summary rather than truncating an apparently complete
  delta.

### Checkpoint 5D — generic regions and materialized-view prototype

Status: **implementation and controlled acceptance complete on 2026-09-11;
live cross-site acceptance remains scheduled for Checkpoint 5F**. Rich reads now
include bounded `semanticViews` derived from generic landmarks, forms, dialogs,
repeated ARIA regions, document structure, and measured scroll containers. Each
view reports its own revision, loaded/visible/actionable counts, canonical-link
uniqueness, duplicate and ambiguity evidence, and conservative scroll exhaustion.
The controlled browser fixture proved incremental lazy-list growth from two to
four actionable entities, required two stable bottom observations before returning
`BOUNDED_COMPLETE`, preserved the feed revision across an unrelated page mutation,
and retained the active foreground tab throughout. No site-specific selector,
new capability, MCP tool, action target, or protocol change was introduced.

Construct generic regions from semantic landmarks, forms, dialogs, repeated-item
groups, scroll containers, and document structure. Do not add Google Maps selectors.

The prototype maintains bounded views such as:

```text
actionable elements in region
repeated entities in region
visible versus loaded entities
unique canonical links
scroll exhaustion evidence
```

The view engine supports incremental insert/update/remove and a unique key when the
source provides one. It reports duplicates and ambiguity rather than deleting data
based on a weak name match.

This is not yet a general natural-language query language. It is the internal data
model needed to prove that query semantics can be added later without recoding the
browser primitives.

Exit evidence:

- the lazy-list fixture grows its repeated-item view incrementally;
- scrolling to a measured boundary plus a stable window yields bounded exhaustion
  evidence;
- changing an unrelated page region does not rebuild the repeated-item view;
- Google Maps, YouTube, and GitHub observations map into the same generic region
  model without site code in the extension (live acceptance pending Checkpoint 5F).

### Checkpoint 5E — causal dependency and proof vocabulary

Status: **implementation and controlled acceptance complete on 2026-09-11**.
Every materialized region now declares bounded entity-set and scroll-state
dependencies. `viewDelta` names only previously materialized views invalidated by
those causal inputs, while observation provenance records category, timestamp,
source revision, sensor, and confidence. Completion results use the fixed
`PROVED`, `BOUNDED_COMPLETE`, `PARTIAL`, `BLOCKED`, and `UNKNOWN` vocabulary and
always include scope, evidence, limits, and unresolved items. `PROVED` requires
explicit exhaustive evidence over a closed-world scope; action success is ignored
by the classifier and cannot manufacture proof. Controlled tests verify isolated
feed invalidation, unrelated-region stability, provenance, bounded evidence, and
the false-`PROVED` regression case. These fields remain read-only additions to
rich `page.read`; protocol, capabilities, tools, and action schemas are unchanged.

Introduce only the minimum read-only structures needed by later releases:

- facts and derived views declare their dependencies;
- a delta marks which derived views became stale;
- irrelevant changes do not invalidate unrelated views;
- observations carry provenance category, timestamp, revision, sensor, and
  confidence;
- results can report `PROVED`, `BOUNDED_COMPLETE`, `PARTIAL`, `BLOCKED`, or
  `UNKNOWN`, with evidence and scope.

In 1.6.0, completion is descriptive and attached to observation workflows. It does
not authorize autonomous state-changing actions. Google Maps scanning may return
`BOUNDED_COMPLETE` for a documented scan protocol, never `PROVED` for every physical
business that exists.

Exit evidence:

- an irrelevant notification mutation leaves a result-list view valid;
- a changed result item invalidates only dependent counts/order/filter outputs;
- every completion claim names its scope, evidence, limits, and unresolved items;
- no test can obtain `PROVED` from action success alone.

### Checkpoint 5F — compatibility, security, and release acceptance

Status: **candidate gate in progress on 2026-09-11**. Static validation and 74
Node tests pass, including a byte-for-byte lock on the unchanged 18-tool MCP
contract and a deterministic 250-step mutation fuzz suite. Controlled Chromium
and isolated Opera 135 pass with zero focus takeover, reconnect/restart coverage,
and all semantic runtime features enabled. The three-run candidate rich-read
median is 19.83 ms, about 5.6% above the paired 18.78 ms baseline and below the
15% ceiling. Production preflight retains active 1.5.2, protocol 1, and 26
capabilities; HTTP health/OAuth checks, cloud `system.self_test`, transactional
idempotency, and timeout behavior pass. The 35,855-byte CRX3 is verified under the
established extension identity with SHA-256
`cd50933e7cbd2857b08488b018f6123ef5088e0b1bbfa28c18a52b6caffbfbf0`.
The database-decoded candidate reproduces the same hash and size and is stored as
inactive while 1.5.2 remains active. Normal-profile update, live cross-site checks,
and final served-artifact equality remain open, so 1.6.0 is not yet promoted.

Compatibility matrix:

| Extension | MCP/server | Required result |
| --- | --- | --- |
| 1.5.0 | current | unchanged behavior |
| 1.5.0 | updated | optional semantic fields absent, no error |
| 1.6.0 | current | extra result fields ignored safely |
| 1.6.0 | updated | semantic identity/delta available |

Required verification:

- all existing Node/static/schema tests;
- controlled Chromium and isolated real-Opera suites;
- replay and identity/delta property tests;
- fuzzed mutation sequences, caps, eviction, restart, and stale generation tests;
- sensitive-field/private-tab/incognito/cross-tab isolation tests;
- normal Opera profile acceptance on Maps, YouTube, and GitHub;
- Supabase queue/idempotency/timeout/reconnect and OAuth health checks;
- signed update identity, update XML, served artifact length, and SHA-256 equality;
- zero MCP tool-name/input-schema changes;
- before/after active-tab and focused-window audit on every browser command.

Promotion rule: 1.6.0 remains a candidate until every required layer passes. Keep
the accepted 1.5.0 CRX and server behavior as the immediate rollback. A server-side
feature flag must be able to ignore semantic enrichments without making the browser
extension unusable.

---

## Explicitly out of scope for 1.6.0

- new public `QUERY`, `WATCH`, `TRANSACT`, or `PROVE` MCP tools;
- a general loop/branch/parallel browser VM;
- actions addressed directly by logical semantic ID;
- persistent storage of user page contents or screenshots;
- network-response scraping or arbitrary JavaScript/raw CDP exposed to the model;
- learned site skills or selector self-modification;
- multi-tab distributed workers;
- automatic purchases, sends, posts, deletions, uploads, or submissions;
- a Google Maps-specific primitive;
- continuous screen/video streaming or OS-level input.

Deferring these is a safety and attribution decision: 1.6.0 must first prove that
the semantic state is stable enough to support later execution.

## Subsequent gated milestones

These milestones describe dependency order, not promised release numbers.

### Milestone 6 — Goal and Constraint Ledger + Proof Engine

- Compile user goals, invariants, evidence requirements, and authorization into a
  revisioned ledger.
- Separate process evidence from outcome evidence.
- Implement scoped completion proofs and false-`DONE` regression tests.
- Support live query/filter revisions without discarding valid collected state.

### Milestone 7 — Reactive Browser VM

- Add bounded `SEQUENCE`, `IF`, `LOOP`, `UNTIL`, `WAIT_EVENT`, `ASSERT`, `COLLECT`,
  `DEDUP`, `RETRY`, and `RETURN` internally.
- Execute deterministic loops locally and call the model only for ambiguity,
  unexpected state, failed verification, or a changed user goal.
- Keep the existing burst as the small atomic execution unit.

### Milestone 8 — Decision-Causal Transactions and provenance enforcement

- Store decision predicates and revalidate only predicates affected by a delta.
- Classify effects as local-reversible, staged-external, compensable, or
  irreversible.
- Use `PREPARE -> VALIDATE -> COMMIT -> OBSERVE -> VERIFY -> RECEIPT`.
- Enforce authority for values entering consequential operations and block page
  content from inventing user intent.

### Milestone 9 — Multi-sensor Physical Plan Optimizer

- Rank site-native/WebMCP, AX/ref, DOM, safe browser/network state, verified skills,
  scoped vision, and pointer plans by measured cost, reliability, safety, freshness,
  and authorization.
- Learn statistics from scrubbed execution outcomes.
- Fall back only when verification fails; never silently weaken safety.

### Milestone 10 — proof-gated skills

- Store logical goal, preconditions, semantic dependencies, program, fallbacks,
  fingerprint, permissions, history, postconditions, and proof requirements.
- Promote a skill only after execution, postconditions, and completion evidence all
  pass.
- Quarantine drifted or ambiguous skills instead of teaching failures permanently.

### Milestone 11 — parallel background workers and live revisions

- Use per-tab locks and a shared semantic view with deterministic reconciliation.
- Parallelize independent read-only sectors; serialize same-tab and consequential
  mutations.
- Reuse already collected coverage when the user narrows or expands a request.
- Preserve one planner, multiple bounded executors, one causal graph, and zero
  foreground takeover.

## Checkpoint discipline

At every checkpoint:

1. freeze the intended contract and explicit non-goals;
2. add a failing deterministic test before changing runtime behavior;
3. implement the smallest generic mechanism that passes it;
4. run focused tests, then the full regression suite;
5. measure against the previous accepted baseline;
6. test controlled Chromium, isolated Opera, cloud relay, then the normal Opera
   profile in that order;
7. record exact evidence, artifact hash, compatibility result, and known limits;
8. stop rather than carrying an unexplained failure into the next checkpoint.

No checkpoint is complete because code exists. It is complete only when its stated
evidence is recorded and its rollback path remains usable.
