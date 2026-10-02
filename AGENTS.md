# Opera Agent agent instructions

These instructions apply to the entire repository.

## Required session close

Three files carry session state, and each has one job. Do not blur them.

| File | Job | Cap |
|---|---|---|
| `docs/next-session-handoff.md` | What just happened, what to do next | ~150 lines |
| `docs/project-context.md` | Durable facts that cannot be recovered from the code | ~120 lines |
| `docs/context-archive.md` | Relocated history. Existing sections are never edited; new sessions append a dated section when retiring detail out of the two live files | none |

Before ending any work session that changes code, infrastructure, release state,
architecture, milestone status, accepted decisions, known limitations, or the next
task:

1. Update `docs/next-session-handoff.md` so a fresh session can continue without
   relying on chat history: current state, what changed, owner decisions pending,
   and the exact next action.
2. Update `docs/project-context.md` only when a fact was learned that cannot be
   derived by reading the code — a toolchain pin, a platform trap, a blind alley
   already walked, a claim that code contradicts.
3. When a session's detail is no longer actionable, move it into
   `docs/context-archive.md`. **Do not append history to the two live files.**
   Before this rule existed, those two files reached 67 and 43 sections and 238 KB
   combined, and both were read at the start of every task.
4. Exclude transient quota values, speculation, passwords, tokens, pairing codes,
   OAuth secrets, private signing-key contents, raw sensitive page content, and
   other credentials.
5. Verify the updates against the repository and completed test evidence.
6. Include the context updates in the session's final commit and push them when
   the rest of that session is pushed.

For read-only questions that do not change project state, do not create noisy
context-only edits. If a session stops unexpectedly, perform this closeout at the
start of the next resumed session before taking new architectural work.

The durable context is a handoff aid, not a substitute for inspecting current code
and git state.

## Repository discipline

Keep the repository easy for coding agents to reason about. Prefer a few enforced
rules over overlapping process.

- Never assume `main` is the current implementation baseline. Resolve the active
  execution branch from the current roadmap/context, then verify its remote SHA
  before every commit and push. If `main` is behind, do not compare or implement
  against it as though it were current.
- CircleCI is the canonical code/test CI gate. Vercel is the deployment/preview
  check. SonarQube Cloud is the PR static-quality check when a PR exists. Do not add
  a duplicate GitHub Actions test workflow; `.github/workflows/release.yml` is
  release automation, not a second everyday CI.
- Regression tests should verify behavior or parsed/structured artifacts. Raw
  source-text regex or byte locks are allowed only when an exact literal/contract
  is intentionally frozen and the test states why exact text is required.
- `npm run check` must discover runtime JS/TS/SQL files automatically under
  `extension/`, `lib/`, `supabase/functions/`, and
  `supabase/migrations/`. Do not maintain a hand-picked safety-file list.
- Temporary diagnostic PRs and branches must be closed/removed after their evidence
  is captured. Do not create a branch per task unless isolation is actually needed.

### Session and branch lifecycle (binding)

These rules exist because past sessions violated them; each maps to a real
failure that cost reconciliation work. They are not advisory.

1. **One writer per checkout.** Never run or continue a session that writes the
   same working tree while another session may be active. Before the first
   write, verify `git status` is clean and `HEAD` equals the SHA recorded in
   `docs/next-session-handoff.md`. If the tree is dirty or the head is unknown,
   STOP: preserve the state to an `archive/<topic>` branch, record it in the
   handoff, and align to the canonical branch before doing anything else.
2. **No session ends dirty or diverged.** A session may not stop with
   uncommitted changes or unpushed commits. Commit with a descriptive message,
   push, and record the exact head SHA in the handoff. Incomplete work is
   recorded as exact state, not left in the working tree.
3. **`main` is the consolidated truth.** At every checkpoint close (CI green on
   the evidence head), `main` is fast-forwarded to that head with
   `--ff-only`. `main` must never lag the accepted state by more than one
   closed checkpoint, and its README/version documentation must match the
   artifacts the update service actually serves. Do not merge an *in-progress*
   checkpoint into `main`.
4. **Branches are born to die.** A work branch exists for one bounded track and
   is merged or archive-tagged when it closes. Before deleting any ref, create
   an immutable archive tag (`archive/<branch-name>`) pointing at its tip so
   nothing is unrecoverable. A healthy remote holds only: `main`, the one
   active work branch, explicit `release/*` branches, and `archive/*` tags.
5. **Divergent lines need a decision, not neglect.** Any remote branch not
   contained in the active line is either (a) merged, (b) cherry-picked for
   unique value, or (c) archive-tagged and deleted with a one-line recorded
   reason in the handoff. Unreviewed divergent branches older than the current
   checkpoint are not allowed to accumulate.
6. **Preserve before overwrite.** Never discard or reset away work you did not
   create without archiving it first. Parallel-session work is assumed valuable
   until inspected.
   - **Mention, do not delete, pre-existing code this work did not create.** Dead
     code, a superseded constant, a stale comment, or a function that cannot work
     is something to **report to the owner in the same session**, not something to
     remove as tidying-up. "It is dead and nobody calls it" is an argument for
     asking, not for acting.
   - Removing it *is* allowed when the removal is **required** by the change being
     made — a constant whose continued presence would mislead, a lock that pins
     behavior this commit supersedes, a value this commit's own logic replaces.
     Say which of the two it is, in the commit message.
   - **Never lock a removal in a test.** A test that *requires* an artifact to stay
     deleted converts a preference into an irreversible decision. Tests may require
     that a superseded artifact is gone; a test that forbids its restoration is a
     decision the owner did not make.
   - This rule existed as "preserve before overwrite" alone and was still violated:
     `opera_run_fast` was dropped and locked in a test on 2026-10-02, then restored
     on 2026-10-03 after review. The gap was that the rule covered *overwriting* and
     said nothing about *discovering* something unusable.
7. **Acceptance basis is CI evidence.** Checkpoint acceptance = CircleCI +
   Vercel SUCCESS on the exact evidence head plus a durable evidence record,
   per the standing authorization of 2026-09-19. Production deployment, signed
   release promotion, transport cutover, and Milestone 8E start remain separate
   explicit user decisions and are never granted by CI green alone.

- When the required CI on an exact head turns green, synchronize the task list,
  roadmap, project context, and handoff before starting the next task. Never leave
  the documented exact-next action pointing at work that is already green.

### Naming conventions (binding)

Enforced by `tests/repo-naming-governance.test.mjs`. A naming violation fails
CI; do not weaken the test to admit a violation — fix the name or, when an
exception is genuinely required, extend the test's explicit allowlist in the
same commit with a one-line recorded reason.

- **Repository root is allowlisted.** New top-level files/directories require a
  conscious allowlist update with justification in the same commit. Ad-hoc
  scripts, notes, helpers, and one-click entrypoints do not belong in the root.
- **Filenames are lowercase kebab-case** for markdown and source files. Tracked
  filenames must not contain process-lifecycle tokens (`tmp`, `temp`, `draft`,
  `wip`, `untitled`, `backup`, `copy`, `old`, `final<N>`) — a name describes
  content, not workflow state. Exemptions: conventional root documents
  (`README.md`, `AGENTS.md`, `CHANGELOG.md`, and peers), vendored layouts under
  `.specify/`, `.agents/`, and `tools/repowise/`, and `docs/releases/`, a frozen
  historical archive whose filenames are the actual historical artifact names.
- **Entrypoints (`.cmd`, `.bat`, `.ps1`, `.sh`) live under `scripts/`** (legacy
  ones under `scripts/legacy/`); vendored tooling may keep its own layout under
  `.specify/` and `.agents/`. Manual test/helper pages live under
  `tests/fixtures/`.
- **Branches**: `main`, `release/<semver>`, and
  `feat|fix|chore|docs|test|perf|refactor/<kebab-description>` only. The
  `tmp/`, `next/`, `ops/`, `autodev/`, `audit/`, and `sonar/` namespaces are
  retired and must not be recreated; no tool-generated numeric-ID suffixes.
- **Tags**: `archive/<original-branch-path>` preserves deleted branches;
  `v<semver>` marks releases. Deleted refs without an archive tag are a
  violation of the session lifecycle rules.
- **Evidence records** follow the existing families: repair-track records are
  `docs/pre-8e-performance-usability-r<N>.md`, milestone records are
  `docs/milestone-<n>-checkpoint-<id>*.md`. Do not invent a new top-level doc
  family without updating this section in the same commit.
- **Context records** are `docs/next-session-handoff.md` (current, capped),
  `docs/project-context.md` (durable facts, capped), and
  `docs/context-archive.md` (relocated history). A session appends new state to
  the handoff. The archive receives content only by **relocation** — a dated
  section moved out of a live file — and never by editing what is already there.
  Adding a new dated section to the archive is expected; rewriting an archived
  section is a violation.
- `release-trigger/` is release automation input (`release.yml`); do not
  repurpose or rename it without updating the workflow.

## Checkpoint implementation and milestone audit policy

Use one active writer on the milestone branch at a time. ChatGPT Web may own the
individual checkpoint implementation and live Opera/MCP acceptance. The audit after
the complete milestone, before work starts on the next milestone, is performed by
a machine: a separate agent session, or Codex. Do not let two agents edit or push
the same branch concurrently.

For every checkpoint implementation:

1. Read the repository instructions, current context, handoff, milestone plan,
   and all earlier acceptance records before editing.
2. State the exact checkpoint scope and explicit non-goals. Do not implement work
   assigned to a later checkpoint merely because it is convenient.
3. Inspect the current branch and remote head. Begin only from the latest accepted
   checkpoint commit and keep unrelated user changes intact.
4. Add deterministic failing tests before runtime behavior, then implement the
   smallest generic mechanism that satisfies the frozen contract.
5. Run focused tests, the full suite, static checks, and every browser/cloud/
   security gate required by the checkpoint plan.
6. Treat model-written reports and prior chat summaries as leads, not verified
   evidence. Record only results supported by repository state, exact commands,
   CI artifacts, browser observations, or production queries.
7. Never call a checkpoint complete when tests are intentionally red, CI is still
   running, temporary instrumentation remains, production cleanup is pending, or
   its acceptance record/context/handoff has not been committed.
8. Restore temporary CI changes, close temporary validation PRs according to the
   checkpoint plan, confirm cleanup/rollback state, record final SHA and net diff,
   update both context files, then commit and push.
9. Stop after the assigned checkpoint. Do not begin the next checkpoint in the
   same turn unless the user explicitly requests it after reviewing the result.

Request an audit before production mutation, or immediately after a bounded dark
probe and before promotion, when a checkpoint changes authentication,
authorization, tenant isolation, encryption, signing identity, public MCP schemas,
extension/CRX distribution, irreversible actions, or production database shape.
An unexplained repeated failure or a proposed deviation from a frozen contract is
also an early-audit trigger.

A machine audit is the required default. The auditor must be a session that did
not write the code under review, must start from fresh task context, and must be
read-only: no edit, commit, push, deployment, or production authority. Give it the
exact head, the diff range, and the question. Do not hand it a summary of your own
reasoning and call that a scope.

At a milestone boundary, do not start the next milestone until the auditor reviews
the complete diff and reruns proportionate tests. The audit must distinguish code
present, automated tests passing, live acceptance passing, and production promotion.
Its verdict is `PASS`, `CONDITIONAL PASS`, or `FAIL`; only `PASS` permits the next
milestone unless the user explicitly accepts documented residual risk. Where the
user waives the audit instead, record the waiver, the residual risk, and who
accepted it in the checkpoint evidence — a missing audit and an accepted risk must
never be readable as the same thing.

Be accurate about what this is. A machine auditor catches anchoring, sunk cost,
stale recall, tests that assert what the author believed, and drift between a
document and the code. It does not bring a category of threat nobody thought to
check for, and it shares its author's blind spots. So state the residual risk in the
record instead of letting a `PASS` stand in for human judgement that never happened.
An auditor that only reruns what the author already ran has not audited anything;
if that is all it managed, it must say so in the verdict.

The reusable ChatGPT Web checkpoint prompt is
`docs/prompts/chatgpt-web-checkpoint.md`.


## Evidence-first bug repair loop

Every unexpected error, bug, CI regression, browser mismatch, or failing acceptance
gate MUST be handled as a research-and-repair loop before normal implementation
continues.

1. Capture the exact failure first: failing command/job, assertion/error text,
   affected SHA, reproduction inputs, and the last known-good behavior.
2. Reproduce or localize the problem using authoritative repository/runtime
   evidence before changing code. Do not patch from a guess and do not blind-rerun
   the same failing gate.
3. Research the root cause before fixing it. Start with source, tests, Git history,
   CI artifacts, browser/runtime observations, and applicable project docs. When
   behavior depends on a browser/platform/library/protocol, or the cause remains
   uncertain, consult primary external sources such as official documentation,
   specifications, release notes, or upstream issue trackers. Prefer primary
   sources over summaries.
4. State a falsifiable root-cause hypothesis and identify the evidence that would
   confirm the repair. If the defect is fully explained by local code, repository
   research is sufficient; record why external research is unnecessary.
5. Add or identify a deterministic regression test that fails for the bug before
   changing runtime behavior. Preserve existing safety/compatibility assertions.
6. Implement the smallest generic fix that addresses the root cause. Do not weaken
   thresholds, delete assertions, broaden authority, add site-specific exceptions,
   or change public contracts merely to make CI green.
7. Run the focused regression first, then the full/static/browser/cloud/security
   gates required by the active checkpoint. Treat a new failure as new evidence and
   repeat this loop.
8. If the same failure recurs three times without materially new evidence, mark the
   work blocked, collect diagnostics, and request an early independent audit rather
   than continuing speculative edits.
9. Record the researched cause, regression evidence, fix, and verification result
   in the checkpoint evidence/context/handoff when the issue materially affects the
   active work.

## Spec Kit skills removed (2026-10-03, owner-ordered)

The ten `speckit-*` skills, their governance test, and `docs/spec-kit-governance.md`
were removed: invoked zero times across a full session of repair, migration,
release, and capability work, while their context cost was paid every task.
`.specify/`, `specs/`, and `tools/spec-kit/` remain untouched, as does the
historical record in `docs/context-archive.md`. Reinstall from upstream if a
future feature-planning task earns it back; until then, unrequested process is
scope creep — remove or defer it rather than widening the active checkpoint.
