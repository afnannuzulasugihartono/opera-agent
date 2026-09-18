# Feature Specification: Pre-8E Performance Usability Repair

**Feature Branch**: `test/pre-8e-usability-repair-r0` (R0 only; later checkpoints require separate explicit authorization)

**Created**: 2026-09-18

**Status**: R0 Accepted / Closed; R1 Not Started

**Input**: User-approved repair plan derived from a live Opera Agent YouTube responsiveness test. This feature is inserted after closed Performance Track P0-P6 and before Milestone 8E. It does not reopen P0-P6 and does not authorize 8E.

## User Scenarios & Testing

### User Story 1 - Direct actionable targeting (Priority: P1)

As the AI controlling Opera, I want the first page observation to prioritize controls that are actually usable now, so I can act without a second target-search round trip.

**Why this priority**: The live YouTube test showed that the page text already contained `Skip`, but target resolution still required an additional search and returned the offscreen `Skip navigation` before the actual ad button.

**Independent Test**: A controlled page contains an offscreen `Skip navigation` control and an on-screen enabled `Skip` control. One page observation must rank/expose the on-screen actionable target ahead of the offscreen control without site-specific selectors.

**Acceptance Scenarios**:

1. **Given** duplicate or similar labels, **When** one target is visible, in the viewport, enabled, non-sensitive, and actionable, **Then** that target is prioritized over hidden/offscreen/disabled alternatives.
2. **Given** an element whose CSS visibility is true but geometry is outside the viewport, **When** the observation is created, **Then** its viewport/actionability state is not reported as equivalent to an on-screen target.
3. **Given** a bounded element cap, **When** many irrelevant DOM controls precede the useful control, **Then** prioritization occurs before the model-facing cap can discard the useful control.

---

### User Story 2 - Fresh dynamic actions (Priority: P1)

As the AI, I want a dynamic target to be safely revalidated close to action time, so a harmless SPA re-render does not force another model reasoning cycle while stale or ambiguous targets still fail closed.

**Why this priority**: In the live test the correct ad `Skip` ref became stale between `page.find` and `page.click`.

**Independent Test**: Re-render a unique button between observation and action while preserving same-document identity evidence. The controller may rebind only when the current target is unique and safely equivalent; ambiguity, route reset, sensitive state, or document discontinuity must produce `STALE_TARGET`/equivalent failure without clicking.

**Acceptance Scenarios**:

1. **Given** one uniquely equivalent current target in the same trusted document continuity, **When** the old action ref is stale, **Then** the controller may revalidate/rebind locally and perform the action.
2. **Given** multiple plausible replacements or a document/route reset, **When** the old ref is stale, **Then** the action fails closed and no coordinate/ref action is guessed.
3. **Given** a sensitive target, **When** revalidation is attempted, **Then** existing sensitive-field protections remain authoritative.

---

### User Story 3 - Local action verification and compact observation (Priority: P2)

As the AI, I want a click to return bounded evidence of what changed, and I want routine observations to contain task-useful information before internal semantic detail, so I do not need a full page reread for every simple action.

**Why this priority**: The test required extra reads for verification, and model-facing `read_page` responses were tens of thousands of tokens despite only hundreds or thousands of useful page-text characters.

**Independent Test**: Perform a bounded click on a controlled dynamic page. The result must provide fresh post-action change evidence while preserving the rule that action success is not task-completion proof. A compact model-facing observation must retain the relevant target/change while materially reducing payload.

**Acceptance Scenarios**:

1. **Given** a successful click that removes/changes the target, **When** the bounded settle completes, **Then** the result reports fresh revision/change evidence without asserting the user's goal is complete.
2. **Given** irrelevant hidden dialogs and offscreen controls, **When** a model-facing observation is produced, **Then** they do not dominate the compact view.
3. **Given** continuity uncertainty, **When** compact state cannot be trusted, **Then** the system falls back to trusted full observation/reset rather than hiding relevant state.

---

### User Story 4 - Efficient media and YouTube workflow execution (Priority: P3)

As the AI, I want existing local media primitives and server-side workflows to avoid unnecessary navigation/reload and page-wide noise, so video sampling and summarization are responsive.

**Why this priority**: `media.state` completed in roughly half a second in the live test, while URL/navigation-based seeking can cost several seconds and the transcript workflow took about 20.5 seconds while returning comments/recommendations/ads in addition to transcript content.

**Independent Test**: Existing internal `media.state/play/pause/seek` primitives can be used by approved internal workflows without adding a public MCP tool or changing the 18 public tool input schemas. YouTube transcript/content workflow output excludes unrelated page material where possible and improves over the frozen baseline.

**Acceptance Scenarios**:

1. **Given** an existing media element, **When** an approved internal workflow seeks, **Then** it uses `media.seek` rather than URL reload when safe.
2. **Given** transcript extraction, **When** transcript rows are available, **Then** workflow output prioritizes transcript/title/chapter/media state over comments/recommendations/sponsored content.
3. **Given** direct public media-tool exposure would require a public MCP surface change, **When** that need is discovered, **Then** it is deferred to a separately reviewed scope rather than added here.

### Edge Cases

- Similar labels such as `Skip navigation` and `Skip`.
- CSS-visible but offscreen geometry.
- A target disappears because an ad naturally ends before action.
- SPA route/document-generation reset between observation and action.
- Multiple replacement elements share text/role/stable-key evidence.
- Element becomes sensitive/disabled between observation and action.
- Mutation storms/animation counters create irrelevant churn.
- Background rendering throttles a transcript panel.
- No transcript/captions are available.
- Page navigation time dominates transport latency.
- Supabase queue latency is small relative to browser navigation, so transport changes must not be credited for page-load time they cannot remove.

## Requirements

### Functional Requirements

- **FR-001**: The repair track MUST preserve Protocol 1, the 26 allowlisted browser primitives, and the existing 18 public MCP tool names and input schemas unless a later separately reviewed boundary explicitly authorizes a public-surface change.
- **FR-002**: Actionable-target prioritization MUST be generic and site-agnostic; YouTube is an acceptance scenario, not extension-specific selector logic.
- **FR-003**: Model-facing target priority MUST account for actual viewport geometry, visibility, enabled/disabled state, sensitivity, and actionability before bounded result truncation.
- **FR-004**: A CSS-visible control outside the viewport MUST NOT be ranked as equivalent to an on-screen actionable control.
- **FR-005**: Stale-ref recovery MUST use current browser evidence close to action time and MUST fail closed on ambiguity, route/document discontinuity, sensitivity changes, or insufficient evidence.
- **FR-006**: Stale-ref recovery MUST NOT authorize direct action by observational `logicalId` alone.
- **FR-007**: Post-action verification MUST be bounded, fresh, and additive to existing safety checks; it MUST NOT treat action success as task completion.
- **FR-008**: Compact observations MUST retain a trusted full-snapshot/reset recovery path and MUST NOT drop task-relevant changes to improve payload metrics.
- **FR-009**: Existing semantic state/delta machinery remains canonical; this repair MUST NOT create a second competing browser-state system.
- **FR-010**: Existing `media.state/play/pause/seek` primitives may be used internally by workflows without adding public MCP tools in this scope.
- **FR-011**: Navigation optimization MUST prefer reuse, local action, SPA behavior, and existing media primitives before proposing a transport rewrite.
- **FR-012**: Realtime wake/polling replacement is not automatically authorized. It may proceed only if later benchmark evidence shows transport remains material after local/action fixes and the required production review boundary is explicitly approved.
- **FR-013**: Background-first behavior and all existing sensitive-data protections MUST remain unchanged; no silent foreground takeover is allowed.
- **FR-014**: Milestone 8E, transaction authority, `milestone7_vm_enabled`, production VM tables, the preserved accidental 8E stash, and public MCP expansion are out of scope.
- **FR-015**: Behavior-changing implementation MUST be tests-first and each repair checkpoint MUST stop for its own acceptance evidence before the next checkpoint begins.

### Key Entities

- **Actionable Observation**: A bounded model-facing view of current controls ranked by fresh usability evidence while referencing canonical semantic state.
- **Action Target Descriptor**: Non-authoritative evidence used to revalidate a stale ref, such as document continuity, stable key source, tag/role/label, geometry, sensitivity and uniqueness.
- **Post-Action Evidence**: Fresh revision/change/target-presence evidence returned after a bounded action settle; never completion proof.
- **YouTube Skip Benchmark**: The frozen real-world acceptance scenario derived from the 2026-09-18 live test.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In the YouTube Skip benchmark, one observation exposes the real on-screen ad `Skip` target ahead of offscreen `Skip navigation`, eliminating the model-mediated refind/filter step.
- **SC-002**: A same-document benign re-render either safely revalidates a unique equivalent target locally or fails closed; stale-state action count remains zero.
- **SC-003**: The normal Skip path becomes `observe -> action/revalidate+verify -> compact delta`, with no mandatory model-mediated full reread between target selection and verification.
- **SC-004**: Controlled compact-observation payload is at least 70% smaller than the frozen legacy model-facing result for the same relevant facts, with zero relevant-target/change loss.
- **SC-005**: Internal media seek does not require URL navigation/reload and reaches a controlled real-Opera p50 of <=1 second when the media element is already ready.
- **SC-006**: The YouTube transcript/content workflow improves total time by at least 50% from the frozen ~20.514 second run, or records evidence that browser rendering dominates the remaining time without adding foreground takeover.
- **SC-007**: Protocol remains 1, allowlisted browser primitive count remains 26, public MCP tool count remains 18, and public MCP input schemas remain unchanged throughout this repair track.
- **SC-008**: No regression introduces foreground takeover, sensitive-value leakage, false completion, stale-state action, or missed relevant semantic change.

## Assumptions

- Opera Agent extension 1.6.0 and current Supabase command path remain the baseline.
- Performance Track P0-P6 remains closed and is not reopened by this repair.
- The live YouTube measurements are empirical baseline evidence; deterministic fixtures/tests must be created before behavior changes.
- Site-specific orchestration may remain in versioned server workflows; site-specific extension logic remains prohibited.
- iframe/shadow-root/canvas universal navigation is important but not part of this findings-driven repair unless required to keep an existing acceptance scenario working.
