# Opera Agent agent instructions

These instructions apply to the entire repository.

## Required session close

Before ending any work session that changes code, infrastructure, release state,
architecture, milestone status, accepted decisions, known limitations, or the next
task:

1. Update `docs/project-context.md` with the durable factual state.
2. Update `docs/next-session-handoff.md` so a fresh ChatGPT Web or Codex session
   can continue without relying on chat history.
3. Exclude transient quota values, speculation, passwords, tokens, pairing codes,
   OAuth secrets, private signing-key contents, raw sensitive page content, and
   other credentials.
4. Verify both documents against the repository and completed test evidence.
5. Include the context updates in the session's final commit and push them when
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
- When the required CI on an exact head turns green, synchronize the task list,
  roadmap, project context, and handoff before starting the next task. Never leave
  the documented exact-next action pointing at work that is already green.

## Checkpoint implementation and milestone audit policy

Use one active writer on the milestone branch at a time. ChatGPT Web may own the
individual checkpoint implementation and live Opera/MCP acceptance. Codex performs
an independent audit after the complete milestone, before work starts on the next
milestone. Do not let two agents edit or push the same branch concurrently.

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

Request a Codex audit before production mutation, or immediately after a bounded
dark probe and before promotion, when a checkpoint changes authentication,
authorization, tenant isolation, encryption, signing identity, public MCP schemas,
extension/CRX distribution, irreversible actions, or production database shape.
An unexplained repeated failure or a proposed deviation from a frozen contract is
also an early-audit trigger.

At a milestone boundary, do not start the next milestone until Codex independently
reviews the complete diff and reruns proportionate tests. The audit must distinguish
code present, automated tests passing, live acceptance passing, and production
promotion. Its verdict is `PASS`, `CONDITIONAL PASS`, or `FAIL`; only `PASS` permits
the next milestone unless the user explicitly accepts documented residual risk.

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

## Spec Kit workflow guardrail

Spec Kit is a workflow guardrail for bounded feature/checkpoint work; it is not
a new authority above this file or `SECURITY.md`. Active Spec Kit artifacts
must agree with the applicable roadmap/checkpoint records and current Git/CI/
runtime evidence.

For non-trivial implementation using Spec Kit, run its consistency analysis
before implementation and convergence after implementation. Treat unrequested
implementation as scope creep: remove or defer it rather than widening the
active checkpoint. Spec Kit never authorizes automatic advancement to the next
checkpoint or milestone.
